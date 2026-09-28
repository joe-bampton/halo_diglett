import { CH_CTL, CH_IN, CH_SNAP, type Channel } from './protocol';
import type { ClientNet, HostNet } from './transport';

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
type Room = Awaited<ReturnType<typeof openRoom>>['room'];

async function openRoom(code: string, strategy: Strategy, onError: (msg: string) => void) {
  const mod = strategy === 'nostr' ? await import('trystero') : await import('@trystero-p2p/torrent');
  const joinRoom = mod.joinRoom as typeof import('trystero').joinRoom;
  const cfg: Parameters<typeof joinRoom>[0] = { appId: APP_ID, password: `hd-${code}` };
  const turn = turnConfig();
  if (turn) cfg.turnConfig = turn;
  const room = joinRoom(cfg, `room-${code}`, {
    onJoinError: (d) => onError(d.error),
  });
  const actions = {
    [CH_CTL]: room.makeAction(CH_CTL),
    [CH_IN]: room.makeAction(CH_IN),
    [CH_SNAP]: room.makeAction(CH_SNAP),
  };
  return { room, actions };
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
  const { room, actions } = await openRoom(code, strategy, onError);
  const net: HostNet = {
    kind: `trystero-${strategy}`,
    send(peer, ch, data) {
      return actions[ch].send(data as never, { target: peer });
    },
    broadcast(ch, data) {
      void actions[ch].send(data as never);
    },
    onMessage: null,
    onJoin: null,
    onLeave: null,
    ping: (peer) => room.ping(peer),
    close() {
      void room.leave();
    },
  };
  for (const ch of [CH_CTL, CH_IN] as Channel[]) actions[ch].onMessage = (data, { peerId }) => net.onMessage?.(peerId, ch, data);
  room.onPeerJoin = (p) => net.onJoin?.(p);
  room.onPeerLeave = (p) => net.onLeave?.(p);
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
  const net: ClientNet = {
    kind: 'trystero',
    send(ch, data) {
      if (!host || !current) return;
      return current.actions[ch].send(data as never, { target: host });
    },
    onMessage: null,
    onClose: null,
    close() {
      closed = true;
      void current?.room.leave();
    },
  };
  const attach = async (strategy: Strategy) => {
    const r = await openRoom(code, strategy, onError);
    if (closed) {
      void r.room.leave();
      return;
    }
    current = r;
    r.actions[CH_CTL].onMessage = (data, { peerId }) => {
      const msg = data as { t?: string };
      if (msg?.t === 'host' && !host) host = peerId;
      if (peerId !== host) return;
      net.onMessage?.(CH_CTL, data);
    };
    r.actions[CH_SNAP].onMessage = (data, { peerId }) => {
      if (peerId === host) net.onMessage?.(CH_SNAP, data);
    };
    r.room.onPeerLeave = (p) => {
      if (p === host) net.onClose?.('The host left the game.');
    };
    keep(r.room);
  };
  await attach('nostr');
  setTimeout(() => {
    if (host || closed) return;
    const old = current;
    current = null;
    void old?.room.leave();
    attach('torrent').catch((e) => console.warn('torrent matchmaking unavailable', e));
  }, 9000);
  return net;
}

const rooms: Room[] = [];
function keep(r: Room) {
  rooms.push(r);
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
  const net: ClientNet = {
    kind: 'broadcast',
    send(ch, data) {
      bc.postMessage({ from: id, to: 'host', kind: 'data', ch, data } satisfies BcMsg);
    },
    onMessage: null,
    onClose: null,
    close() {
      bc.postMessage({ from: id, kind: 'leave' } satisfies BcMsg);
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
  window.addEventListener('pagehide', () => bc.postMessage({ from: id, kind: 'leave' } satisfies BcMsg));
  // announce (repeat a few times in case the host tab is still loading)
  let n = 0;
  const hello = () => {
    bc.postMessage({ from: id, kind: 'join' } satisfies BcMsg);
    if (++n < 3) setTimeout(hello, 400);
  };
  hello();
  return net;
}
