import type { Channel } from '../../src/net/protocol';
import type { ClientNet, HostNet } from '../../src/net/transport';

/** Deterministic fake network with per-link latency + jitter, driven by a manual clock. */
export class FakeWorld {
  now = 1000;
  private q: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;
  private rnd = 1;
  rand() {
    this.rnd = (this.rnd * 16807) % 2147483647;
    return this.rnd / 2147483647;
  }
  later(ms: number, fn: () => void) {
    this.q.push({ at: this.now + ms, seq: this.seq++, fn });
  }
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const n = this.q[0];
      if (!n || n.at > end) break;
      this.q.shift();
      this.now = n.at;
      n.fn();
    }
    this.now = end;
  }
}

export interface LinkOpts {
  /** chance that a packet is lost */
  loss?: number;
  /** a lost packet on the reliable path is resent after this long — and everything sent after it waits (in order) */
  rto?: number;
  /** offer the low-latency path (unordered, lost packets stay lost) like the WebRTC transport */
  fast?: boolean;
}

interface Link {
  net: ClientNet;
  lat: number;
  jit: number;
  opts: LinkOpts;
  /** reliable, in order, host → client */
  downLast: number;
  /** nothing arrives either way before this (a stalled phone: tunnel, app switch) */
  stalledUntil: number;
  /** the host has heard from this client on the fast path / the client from the host */
  hostHeard: boolean;
  clientHeard: boolean;
  /** what the host sent this client reliably, in order (tests check delivery against it) */
  sent: { ch: Channel; data: unknown }[];
}

export class LagHub implements HostNet {
  readonly kind = 'lag';
  onMessage: HostNet['onMessage'] = null;
  onJoin: HostNet['onJoin'] = null;
  onLeave: HostNet['onLeave'] = null;
  sendFast?: HostNet['sendFast'];
  private clients = new Map<string, Link>();
  constructor(private w: FakeWorld) {}

  /** When a reliable packet would arrive: lost ones are resent after `rto`, and nothing overtakes it. */
  private reliableAt(l: Link, last: number) {
    const lost = (l.opts.loss ?? 0) > 0 && this.w.rand() < l.opts.loss!;
    const at = this.w.now + l.lat + this.w.rand() * l.jit + (lost ? (l.opts.rto ?? 250) : 0);
    return Math.max(last, at, l.stalledUntil);
  }

  connect(peer: string, oneWayMs: number, jitterMs = 0, opts: LinkOpts = {}): ClientNet {
    const hub = this;
    const w = this.w;
    const link: Link = { net: null as unknown as ClientNet, lat: oneWayMs, jit: jitterMs, opts, downLast: 0, stalledUntil: 0, hostHeard: false, clientHeard: false, sent: [] };
    let upLast = 0;
    const net: ClientNet = {
      kind: 'lag',
      send(ch: Channel, data: unknown) {
        const copy = structuredClone(data);
        const at = hub.reliableAt(link, upLast);
        upLast = at;
        w.later(at - w.now, () => hub.onMessage?.(peer, ch, copy));
      },
      onMessage: null,
      onClose: null,
      close() {},
    };
    if (opts.fast) {
      net.sendFast = (data: unknown) => {
        if (!(w.rand() < (opts.loss ?? 0))) {
          const copy = structuredClone(data);
          const at = Math.max(w.now + oneWayMs + w.rand() * jitterMs, link.stalledUntil);
          w.later(at - w.now, () => {
            link.hostHeard = true;
            hub.onMessage?.(peer, 'in', copy);
          });
        }
        return link.clientHeard;
      };
      this.sendFast = (p: string, data: unknown) => {
        const l = this.clients.get(p);
        if (!l?.opts.fast || !l.hostHeard) return false;
        if (!(w.rand() < (l.opts.loss ?? 0))) {
          const copy = structuredClone(data);
          const at = Math.max(w.now + l.lat + w.rand() * l.jit, l.stalledUntil);
          w.later(at - w.now, () => {
            l.clientHeard = true;
            l.net.onMessage?.('snap', copy);
          });
        }
        return true;
      };
    }
    link.net = net;
    this.clients.set(peer, link);
    w.later(oneWayMs, () => this.onJoin?.(peer));
    return net;
  }

  /** Nothing gets through to or from `peer` for `ms`; reliable sends to it hold (backpressure) until then. */
  stall(peer: string, ms: number) {
    const l = this.clients.get(peer);
    if (l) l.stalledUntil = this.w.now + ms;
  }

  /** Everything the host sent `peer` reliably, in order. */
  sentTo(peer: string) {
    return this.clients.get(peer)?.sent ?? [];
  }

  send(peer: string, ch: Channel, data: unknown): Promise<void> | void {
    const c = this.clients.get(peer);
    if (!c) return;
    const copy = structuredClone(data);
    c.sent.push({ ch, data: copy });
    const at = this.reliableAt(c, c.downLast);
    c.downLast = at;
    this.w.later(at - this.w.now, () => c.net.onMessage?.(ch, copy));
    // a stalled link fills up: the send only completes when it can go out (like Trystero's backpressure)
    if (c.stalledUntil > this.w.now) return new Promise<void>((r) => this.w.later(c.stalledUntil - this.w.now, r));
  }
  broadcast(ch: Channel, data: unknown) {
    for (const p of this.clients.keys()) this.send(p, ch, data);
  }
  close() {}
}
