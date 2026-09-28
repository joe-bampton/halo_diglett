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

export class LagHub implements HostNet {
  readonly kind = 'lag';
  onMessage: HostNet['onMessage'] = null;
  onJoin: HostNet['onJoin'] = null;
  onLeave: HostNet['onLeave'] = null;
  private clients = new Map<string, { net: ClientNet; lat: number; jit: number; lastAt: number }>();
  constructor(private w: FakeWorld) {}

  connect(peer: string, oneWayMs: number, jitterMs = 0): ClientNet {
    const hub = this;
    const w = this.w;
    const entry = { net: null as unknown as ClientNet, lat: oneWayMs, jit: jitterMs, lastAt: 0 };
    let upLast = 0;
    const net: ClientNet = {
      kind: 'lag',
      send(ch: Channel, data: unknown) {
        const copy = structuredClone(data);
        // reliable ordered: never deliver before the previous message
        const at = Math.max(upLast, w.now + oneWayMs + w.rand() * jitterMs);
        upLast = at;
        w.later(at - w.now, () => hub.onMessage?.(peer, ch, copy));
      },
      onMessage: null,
      onClose: null,
      close() {},
    };
    entry.net = net;
    this.clients.set(peer, entry);
    w.later(oneWayMs, () => this.onJoin?.(peer));
    return net;
  }

  send(peer: string, ch: Channel, data: unknown) {
    const c = this.clients.get(peer);
    if (!c) return;
    const copy = structuredClone(data);
    const at = Math.max(c.lastAt, this.w.now + c.lat + this.w.rand() * c.jit);
    c.lastAt = at;
    this.w.later(at - this.w.now, () => c.net.onMessage?.(ch, copy));
  }
  broadcast(ch: Channel, data: unknown) {
    for (const p of this.clients.keys()) this.send(p, ch, data);
  }
  close() {}
}
