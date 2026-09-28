import type { Channel } from './protocol';

/** Host side of the network: many peers. */
export interface HostNet {
  readonly kind: string;
  send(peer: string, ch: Channel, data: unknown): Promise<void> | void;
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
  onMessage: ((ch: Channel, data: unknown) => void) | null;
  onClose: ((reason: string) => void) | null;
  close(): void;
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
