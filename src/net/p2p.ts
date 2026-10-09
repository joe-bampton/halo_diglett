import { CH_CTL, CH_EV, CH_IN, CH_SNAP, type Channel } from './protocol';
import type { ClientNet, HostNet, VoiceLink, VoicePeerInfo } from './transport';

export const APP_ID = 'halo-diglett-v1';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(len = 5): string {
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (const b of buf) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

export function cleanCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

interface TurnServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export function turnConfig(): TurnServer[] | undefined {
  try {
    const saved = localStorage.getItem('hd.turn');
    if (saved) {
      const t = JSON.parse(saved) as TurnServer[] | TurnServer;
      const arr = Array.isArray(t) ? t : [t];
      if (arr.length && arr.every((x) => x && x.urls)) return arr;
    }
  } catch {
    /* ignore */
  }
  const env = import.meta.env as Record<string, string | undefined>;
  if (env.VITE_TURN_URLS) {
    return [{ urls: env.VITE_TURN_URLS.split(',').map((u) => u.trim()), username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL }];
  }
  return undefined;
}

type Strategy = 'nostr' | 'torrent';

/**
 * Public Nostr relays to meet on. Trystero's default is 5, picked from a list of volunteer-run relays: a few spares
 * mean one or two of them being down doesn't leave friends unable to find the host.
 */
const NOSTR_RELAYS = 8;

async function openRoom(code: string, strategy: Strategy, onError: (msg: string) => void) {
  const mod = strategy === 'nostr' ? await import('trystero') : await import('@trystero-p2p/torrent');
  const joinRoom = mod.joinRoom as typeof import('trystero').joinRoom;
  const cfg: Parameters<typeof joinRoom>[0] = { appId: APP_ID, password: `hd-${code}` };
  if (strategy === 'nostr') cfg.relayConfig = { redundancy: NOSTR_RELAYS };
  const turn = turnConfig();
  if (turn) cfg.turnConfig = turn;
  const room = joinRoom(cfg, `room-${code}`, {
    onJoinError: (d) => onError(d.error),
  });
  const actions = {
    [CH_CTL]: room.makeAction(CH_CTL),
    [CH_IN]: room.makeAction(CH_IN),
    [CH_SNAP]: room.makeAction(CH_SNAP),
    [CH_EV]: room.makeAction(CH_EV),
  };
  // several listeners (game session + voice chat) share the room's single peer callbacks
  const joins = new Set<(peer: string) => void>();
  const leaves = new Set<(peer: string) => void>();
  room.onPeerJoin = (p) => joins.forEach((f) => f(p));
  room.onPeerLeave = (p) => leaves.forEach((f) => f(p));
  const voice = roomVoice(room, joins, leaves);
  return { room, actions, joins, leaves, voice };
}

// ------------------------------------------------------------------------------------------------
// Low-latency channel
// ------------------------------------------------------------------------------------------------

/** `?fastnet=0` switches it off: everything then goes over Trystero's reliable channel, as before. */
const FAST_ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('fastnet') !== '0';
/** both ends open the channel with this id themselves (negotiated: no extra signalling); Trystero's own is 0 or 1 */
const FAST_ID = 7;
/** bigger messages go reliably (an unreliable one this size would rarely make it whole) */
const FAST_MAX = 16_000;
/** when this much is still waiting to go out, skip a message rather than queue it */
const FAST_BACKLOG = 64 * 1024;

/**
 * A second data channel next to Trystero's: unordered and never retransmitted, for state snapshots and inputs. On a
 * reliable channel one lost packet on a phone's Wi-Fi or 4G holds up everything behind it until it's resent — the
 * whole field freezes, then jumps. Here a lost snapshot is just skipped: the next one is 50 ms behind it.
 */
interface FastLink {
  ch: RTCDataChannel;
  /** we've heard from the other end on it, so it's listening */
  heard: boolean;
}

function openFast(pc: RTCPeerConnection | undefined, onData: (data: unknown) => void, onClose: () => void): FastLink | null {
  if (!FAST_ON || !pc || pc.connectionState === 'closed' || typeof pc.createDataChannel !== 'function') return null;
  try {
    const ch = pc.createDataChannel('hd-fast', { negotiated: true, id: FAST_ID, ordered: false, maxRetransmits: 0 });
    const link: FastLink = { ch, heard: false };
    ch.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let data: unknown;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      link.heard = true;
      onData(data);
    };
    ch.onclose = () => {
      link.heard = false;
      onClose();
    };
    return link;
  } catch (e) {
    console.warn('low-latency channel unavailable', e);
    return null;
  }
}

/** Send on the fast channel. False: it isn't there or open (send reliably instead). A full backlog skips the message. */
function sendOn(link: FastLink | null | undefined, data: unknown): boolean {
  if (!link || link.ch.readyState !== 'open') return false;
  if (link.ch.bufferedAmount > FAST_BACKLOG) return true;
  const str = JSON.stringify(data);
  if (str.length > FAST_MAX) return false;
  try {
    link.ch.send(str);
    return true;
  } catch {
    return false;
  }
}

/** Voice chat over one Trystero room: every player streams their mic straight to every other player. */
export function roomVoice(room: Awaited<ReturnType<typeof import('trystero').joinRoom>>, joins: Set<(p: string) => void>, leaves: Set<(p: string) => void>): VoiceLink {
  const vc = room.makeAction<{ slot: number; mic: boolean }>('vc');
  let stream: MediaStream | null = null;
  let slot = -1;
  const warn = (e: unknown) => console.warn('voice stream failed', e);
  const info = () => ({ slot, mic: !!stream });
  const v: VoiceLink = {
    setStream(s) {
      if (s === stream) return;
      if (stream) {
        try {
          room.removeStream(stream);
        } catch {
          /* peer already gone */
        }
      }
      stream = s;
      if (s) for (const p of room.addStream(s)) p.catch(warn);
      if (slot >= 0) vc.send(info()).catch(() => {});
    },
    announce(n) {
      slot = n;
      vc.send(info()).catch(() => {});
    },
    onStream: null,
    onPeerInfo: null,
    onPeerGone: null,
  };
  joins.add((peer) => {
    if (stream) for (const p of room.addStream(stream, { target: peer })) p.catch(warn);
    if (slot >= 0) vc.send(info(), { target: peer }).catch(() => {});
  });
  leaves.add((peer) => v.onPeerGone?.(peer));
  room.onPeerStream = (s, peer) => v.onStream?.(peer, s);
  vc.onMessage = (d, { peerId }) => {
    const m = d as Partial<VoicePeerInfo> | null;
    if (typeof m?.slot === 'number' && m.slot >= 0) v.onPeerInfo?.(peerId, { slot: m.slot, mic: !!m.mic });
  };
  return v;
}

/**
 * WebRTC host (Trystero, no server of our own). Listens for friends via public Nostr relays and
 * BitTorrent trackers at the same time, so matchmaking still works if one network is down.
 */
export async function trysteroHosts(code: string, onError: (msg: string) => void): Promise<HostNet[]> {
  const nets: HostNet[] = [];
  for (const strategy of ['nostr', 'torrent'] as Strategy[]) {
    try {
      nets.push(await trysteroHost(code, strategy, onError));
    } catch (e) {
      console.warn(`matchmaking via ${strategy} unavailable`, e);
    }
  }
  if (!nets.length) throw new Error('No matchmaking network available');
  return nets;
}

async function trysteroHost(code: string, strategy: Strategy, onError: (msg: string) => void): Promise<HostNet> {
  const { room, actions, joins, leaves, voice } = await openRoom(code, strategy, onError);
  const fast = new Map<string, FastLink>();
  const net: HostNet = {
    kind: `trystero-${strategy}`,
    voice,
    send(peer, ch, data) {
      return actions[ch].send(data as never, { target: peer });
    },
    // only once that player's inputs arrive on it: then we know their end is open too
    sendFast: (peer, data) => {
      const link = fast.get(peer);
      return !!link?.heard && sendOn(link, data);
    },
    broadcast(ch, data) {
      void actions[ch].send(data as never);
    },
    onMessage: null,
    onJoin: null,
    onLeave: null,
    ping: (peer) => room.ping(peer),
    close() {
      for (const l of fast.values()) l.ch.close();
      fast.clear();
      release(room);
    },
  };
  for (const ch of [CH_CTL, CH_IN] as Channel[]) actions[ch].onMessage = (data, { peerId }) => net.onMessage?.(peerId, ch, data);
  joins.add((p) => {
    const link = openFast(
      room.getPeers()[p],
      (data) => net.onMessage?.(p, CH_IN, data),
      () => {
        if (fast.get(p) === link) fast.delete(p);
      },
    );
    if (link) fast.set(p, link);
    net.onJoin?.(p);
  });
  leaves.add((p) => {
    fast.get(p)?.ch.close();
    fast.delete(p);
    net.onLeave?.(p);
  });
  keep(room);
  return net;
}

/**
 * WebRTC client: finds the host in the room (the peer that says {t:'host'}). Tries Nostr first
 * and falls back to BitTorrent trackers if no host answers within a few seconds.
 */
export async function trysteroClient(code: string, onError: (msg: string) => void): Promise<ClientNet> {
  let host: string | null = null;
  let current: Awaited<ReturnType<typeof openRoom>> | null = null;
  let closed = false;
  // the voice link follows the client if it falls back from Nostr to BitTorrent
  let myStream: MediaStream | null = null;
  let mySlot = -1;
  const voice: VoiceLink = {
    setStream(s) {
      myStream = s;
      current?.voice.setStream(s);
    },
    announce(slot) {
      mySlot = slot;
      current?.voice.announce(slot);
    },
    onStream: null,
    onPeerInfo: null,
    onPeerGone: null,
  };
  let fast: FastLink | null = null;
  const net: ClientNet = {
    kind: 'trystero',
    voice,
    send(ch, data) {
      if (!host || !current) return;
      return current.actions[ch].send(data as never, { target: host });
    },
    // sent whenever it's open (that's how the host learns it's there); trusted once snapshots arrive on it
    sendFast(data) {
      return sendOn(fast, data) && !!fast?.heard;
    },
    onMessage: null,
    onClose: null,
    close() {
      closed = true;
      fast?.ch.close();
      fast = null;
      if (current) release(current.room);
    },
  };
  const attach = async (strategy: Strategy) => {
    const r = await openRoom(code, strategy, onError);
    if (closed) {
      void r.room.leave();
      return;
    }
    keep(r.room);
    current = r;
    r.actions[CH_CTL].onMessage = (data, { peerId }) => {
      const msg = data as { t?: string };
      if (msg?.t === 'host' && !host) {
        host = peerId;
        fast = openFast(
          r.room.getPeers()[peerId],
          (d) => net.onMessage?.(CH_SNAP, d),
          () => (fast = null),
        );
      }
      if (peerId !== host) return;
      net.onMessage?.(CH_CTL, data);
    };
    r.actions[CH_SNAP].onMessage = (data, { peerId }) => {
      if (peerId === host) net.onMessage?.(CH_SNAP, data);
    };
    r.actions[CH_EV].onMessage = (data, { peerId }) => {
      if (peerId === host) net.onMessage?.(CH_EV, data);
    };
    r.leaves.add((p) => {
      if (p === host) net.onClose?.('The host left the game.');
    });
    r.voice.onStream = (p, s) => voice.onStream?.(p, s);
    r.voice.onPeerInfo = (p, i) => voice.onPeerInfo?.(p, i);
    r.voice.onPeerGone = (p) => voice.onPeerGone?.(p);
    if (myStream) r.voice.setStream(myStream);
    if (mySlot >= 0) r.voice.announce(mySlot);
  };
  await attach('nostr');
  setTimeout(() => {
    if (host || closed) return;
    const old = current;
    current = null;
    if (old) release(old.room);
    attach('torrent').catch((e) => console.warn('torrent matchmaking unavailable', e));
  }, 9000);
  return net;
}

/** Rooms in use (left and forgotten when the game is closed, so a long evening of games doesn't pile them up). */
type Room = Awaited<ReturnType<typeof openRoom>>['room'];
const rooms = new Set<Room>();
function keep(r: Room) {
  rooms.add(r);
}
function release(r: Room) {
  if (!rooms.delete(r)) return;
  void r.leave();
}

// ------------------------------------------------------------------------------------------------
// BroadcastChannel transport: several tabs on one machine (dev + automated tests, no internet)
// ------------------------------------------------------------------------------------------------

interface BcMsg {
  from: string;
  to?: string;
  kind: 'join' | 'leave' | 'data';
  ch?: Channel;
  data?: unknown;
}

export function bcHost(code: string): HostNet {
  const bc = new BroadcastChannel(`hd-${code}`);
  const id = 'host';
  const peers = new Set<string>();
  const net: HostNet = {
    kind: 'broadcast',
    send(peer, ch, data) {
      bc.postMessage({ from: id, to: peer, kind: 'data', ch, data } satisfies BcMsg);
    },
    broadcast(ch, data) {
      bc.postMessage({ from: id, kind: 'data', ch, data } satisfies BcMsg);
    },
    onMessage: null,
    onJoin: null,
    onLeave: null,
    ping: async () => 1,
    close() {
      bc.postMessage({ from: id, kind: 'leave' } satisfies BcMsg);
      bc.close();
    },
  };
  bc.onmessage = (ev: MessageEvent<BcMsg>) => {
    const m = ev.data;
    if (m.to && m.to !== id) return;
    if (m.kind === 'join') {
      peers.add(m.from);
      net.onJoin?.(m.from);
    } else if (m.kind === 'leave') {
      if (peers.delete(m.from)) net.onLeave?.(m.from);
    } else if (m.kind === 'data' && m.ch) net.onMessage?.(m.from, m.ch, m.data);
  };
  return net;
}

export function bcClient(code: string): ClientNet {
  const bc = new BroadcastChannel(`hd-${code}`);
  const id = `c-${Math.random().toString(36).slice(2, 10)}`;
  let closed = false;
  const post = (m: BcMsg) => {
    if (!closed) bc.postMessage(m);
  };
  const net: ClientNet = {
    kind: 'broadcast',
    send(ch, data) {
      post({ from: id, to: 'host', kind: 'data', ch, data });
    },
    onMessage: null,
    onClose: null,
    close() {
      post({ from: id, kind: 'leave' });
      closed = true;
      bc.close();
    },
  };
  bc.onmessage = (ev: MessageEvent<BcMsg>) => {
    const m = ev.data;
    if (m.from !== 'host') return;
    if (m.kind === 'leave') net.onClose?.('The host left the game.');
    if (m.kind !== 'data' || (m.to && m.to !== id) || !m.ch) return;
    net.onMessage?.(m.ch, m.data);
  };
  window.addEventListener('pagehide', () => post({ from: id, kind: 'leave' }));
  // announce (repeat a few times in case the host tab is still loading)
  let n = 0;
  const hello = () => {
    post({ from: id, kind: 'join' });
    if (++n < 3 && !closed) setTimeout(hello, 400);
  };
  hello();
  return net;
}

// ------------------------------------------------------------------------------------------------
// Test hook (?test): the low-latency channel in a real browser, without any matchmaking
// ------------------------------------------------------------------------------------------------

/**
 * Two connections inside this page, joined directly, each opening the low-latency channel the way a host and a friend
 * do: the reliable channel first, the host's end at once, the friend's a moment later (once it knows who the host is).
 */
export async function fastChannelSelfTest(timeoutMs = 15_000) {
  const res = { enabled: FAST_ON, connected: false, reliable: false, ordered: null as boolean | null, maxRetransmits: null as number | null, hostGot: 0, friendGot: 0 };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (ok: () => boolean) => {
    for (const end = performance.now() + timeoutMs; !ok(); ) {
      if (performance.now() > end) throw new Error('timed out');
      await sleep(30);
    }
  };
  // no network needed: browsers name local addresses *.local, which only resolve over multicast DNS
  const local = (sdp: string) => sdp.replace(/ (\S+\.local) (\d+) typ host/g, ' 127.0.0.1 $2 typ host');
  const a = new RTCPeerConnection({ iceServers: [] });
  const b = new RTCPeerConnection({ iceServers: [] });
  try {
    const data = a.createDataChannel('data');
    b.ondatachannel = (e) => (e.channel.onmessage = () => (res.reliable = true));
    const host = openFast(a, () => res.hostGot++, () => {});
    // (some sandboxes never call gathering "complete": a first candidate is enough here)
    const gathered = (pc: RTCPeerConnection) => () => pc.iceGatheringState === 'complete' || /a=candidate/.test(pc.localDescription?.sdp ?? '');
    await a.setLocalDescription(await a.createOffer());
    await until(gathered(a));
    await b.setRemoteDescription({ type: 'offer', sdp: local(a.localDescription!.sdp) });
    await b.setLocalDescription(await b.createAnswer());
    await until(gathered(b));
    await a.setRemoteDescription({ type: 'answer', sdp: local(b.localDescription!.sdp) });
    await until(() => data.readyState === 'open');
    res.connected = true;
    data.send('hello');
    const friend = openFast(b, () => res.friendGot++, () => {});
    if (!host || !friend) return res;
    res.ordered = friend.ch.ordered;
    res.maxRetransmits = friend.ch.maxRetransmits;
    await until(() => host.ch.readyState === 'open' && friend.ch.readyState === 'open');
    // the friend's inputs open the way; the host answers only once it has heard from them
    for (let i = 0; i < 100 && !(res.hostGot && res.friendGot && res.reliable); i++) {
      sendOn(friend, { s: i });
      if (host.heard) sendOn(host, { k: i });
      await sleep(30);
    }
  } catch (e) {
    console.warn('fast channel self-test:', e);
  } finally {
    a.close();
    b.close();
  }
  return res;
}
