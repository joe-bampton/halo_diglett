import type { Channel } from './protocol';

/**
 * Voice chat side-channel. Mic audio goes directly between players (WebRTC full mesh), not
 * through the host, so it lives next to the game channels rather than in the host/client protocol.
 */
export interface VoicePeerInfo {
  slot: number;
  /** false once that player turns their microphone off */
  mic: boolean;
}

export interface VoiceLink {
  /** Publish my mic to every current and future peer (null stops publishing). */
  setStream(stream: MediaStream | null): void;
  /** Tell peers which lobby slot my peer id belongs to (re-sent to late joiners and on mic changes). */
  announce(slot: number): void;
  onStream: ((peer: string, stream: MediaStream) => void) | null;
  onPeerInfo: ((peer: string, info: VoicePeerInfo) => void) | null;
  onPeerGone: ((peer: string) => void) | null;
}

/** Host side of the network: many peers. */
export interface HostNet {
  readonly kind: string;
  /** Only set on transports that can carry audio (WebRTC). */
  voice?: VoiceLink;
  send(peer: string, ch: Channel, data: unknown): Promise<void> | void;
  /**
   * The low-latency path (WebRTC only): unordered, never retransmitted — a late snapshot is a useless one, and a lost
   * one must not hold up the ones after it. Only once that player is known to be listening on it (their inputs arrive
   * that way). Returns false when there's no such path to them, and the caller sends reliably instead.
   */
  sendFast?(peer: string, data: unknown): boolean;
  broadcast(ch: Channel, data: unknown): void;
  onMessage: ((peer: string, ch: Channel, data: unknown) => void) | null;
  onJoin: ((peer: string) => void) | null;
  onLeave: ((peer: string) => void) | null;
  ping?(peer: string): Promise<number>;
  close(): void;
}

/** Client side: exactly one host. */
export interface ClientNet {
  readonly kind: string;
  send(ch: Channel, data: unknown): Promise<void> | void;
  /**
   * Send on the low-latency path if it's open. Returns true once the host is known to be listening on it (snapshots
   * arrive that way); until then the caller sends reliably as well.
   */
  sendFast?(data: unknown): boolean;
  onMessage: ((ch: Channel, data: unknown) => void) | null;
  onClose: ((reason: string) => void) | null;
  voice?: VoiceLink;
  close(): void;
}

/** One VoiceLink over several networks (the host listens on Nostr and BitTorrent at once). */
export function combineVoice(links: VoiceLink[]): VoiceLink | undefined {
  if (!links.length) return undefined;
  if (links.length === 1) return links[0];
  const v: VoiceLink = {
    setStream(stream) {
      for (const l of links) l.setStream(stream);
    },
    announce(slot) {
      for (const l of links) l.announce(slot);
    },
    onStream: null,
    onPeerInfo: null,
    onPeerGone: null,
  };
  for (const l of links) {
    l.onStream = (peer, stream) => v.onStream?.(peer, stream);
    l.onPeerInfo = (peer, info) => v.onPeerInfo?.(peer, info);
    l.onPeerGone = (peer) => v.onPeerGone?.(peer);
  }
  return v;
}

/**
 * In-memory link used for single-player and for the host's own player.
 * Messages are delivered synchronously but through structured cloning, so both sides
 * never share object references (mirrors real network behaviour).
 */
export function loopbackPair(peerId = 'local'): { host: HostNet; client: ClientNet } {
  const host: HostNet = {
    kind: 'loopback',
    send(_peer, ch, data) {
      client.onMessage?.(ch, structuredClone(data));
    },
    broadcast(ch, data) {
      client.onMessage?.(ch, structuredClone(data));
    },
    onMessage: null,
    onJoin: null,
    onLeave: null,
    close() {},
  };
  const client: ClientNet = {
    kind: 'loopback',
    send(ch, data) {
      host.onMessage?.(peerId, ch, structuredClone(data));
    },
    onMessage: null,
    onClose: null,
    close() {},
  };
  queueMicrotask(() => host.onJoin?.(peerId));
  return { host, client };
}

/** Combine several HostNets (e.g. loopback for the host's player + WebRTC for friends). */
export class MuxHostNet implements HostNet {
  readonly kind = 'mux';
  onMessage: HostNet['onMessage'] = null;
  onJoin: HostNet['onJoin'] = null;
  onLeave: HostNet['onLeave'] = null;
  private nets: HostNet[] = [];
  private owner = new Map<string, HostNet>();

  /** Call after all networks were added. */
  get voice(): VoiceLink | undefined {
    this.voiceLink ??= combineVoice(this.nets.flatMap((n) => (n.voice ? [n.voice] : [])));
    return this.voiceLink;
  }
  private voiceLink: VoiceLink | undefined;

  add(net: HostNet) {
    this.nets.push(net);
    net.onMessage = (peer, ch, data) => {
      this.owner.set(peer, net);
      this.onMessage?.(peer, ch, data);
    };
    net.onJoin = (peer) => {
      this.owner.set(peer, net);
      this.onJoin?.(peer);
    };
    net.onLeave = (peer) => {
      // the same peer id can exist on several networks; only the current owner's leave counts
      if (this.owner.get(peer) !== net) return;
      this.onLeave?.(peer);
      this.owner.delete(peer);
    };
  }

  send(peer: string, ch: Channel, data: unknown) {
    return this.owner.get(peer)?.send(peer, ch, data);
  }

  sendFast(peer: string, data: unknown): boolean {
    return this.owner.get(peer)?.sendFast?.(peer, data) ?? false;
  }

  broadcast(ch: Channel, data: unknown) {
    for (const n of this.nets) n.broadcast(ch, data);
  }

  ping(peer: string) {
    const n = this.owner.get(peer);
    return n?.ping ? n.ping(peer) : Promise.resolve(0);
  }

  close() {
    for (const n of this.nets) n.close();
  }
}
