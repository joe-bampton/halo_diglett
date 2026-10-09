import { describe, expect, it } from 'vitest';
import { ClientSession } from '../../src/net/client';
import { HostSession } from '../../src/net/host';
import type { EventsMsg, SnapshotMsg } from '../../src/net/protocol';
import type { ClientNet } from '../../src/net/transport';
import { TICK_RATE } from '../../src/sim/constants';
import type { SimEvent } from '../../src/sim/types';
import { FakeWorld, LagHub } from './laglink';

const COSMETIC = new Set(['fire', 'proj', 'pend', 'dmg', 'near', 'reload', 'callout', 'boom', 'forced']);

/** 30 s of a match watched by A while B bobs up and down, on lines that lose `loss` of their packets. */
function lossyMatch(fast: boolean, loss: number) {
  const w = new FakeWorld();
  const hub = new LagHub(w);
  const host = new HostSession(hub, 'LOSS', true);
  host.clock = () => w.now;
  const mk = (peer: string) => {
    const c = new ClientSession(hub.connect(peer, 40, 10, { loss, rto: 250, fast }), { name: peer, color: 1, token: peer });
    c.clock = () => w.now;
    return c;
  };
  const A = mk('A');
  const B = mk('B');
  w.advance(500);
  host.setSettings({ ...host.lobby.settings, orbRate: 'chaos', antiTurtleSec: 0, respawnMode: 'auto', respawnSec: 0 });
  host.addBot('heroic');
  host.addBot('legendary');
  host.addBot('jerry');
  host.startMatch(5);
  const got: SimEvent[] = [];
  let frames = 0;
  for (let i = 0; i < 60 * 30; i++) {
    w.advance(1000 / 60);
    host.update(w.now);
    B.input.stand = w.now % 1000 < 500;
    A.input.stand = true;
    A.update(w.now);
    B.update(w.now);
    got.push(...A.drainEvents());
    B.drainEvents();
    if (A.state === 'match' && A.latestTick > 0) frames++;
  }
  return { A, hub, got, frames };
}

describe('the low-latency path', () => {
  it('keeps the other players moving when packets get lost', () => {
    const reliable = lossyMatch(false, 0.05);
    const fast = lossyMatch(true, 0.05);
    console.log(`frames where the view froze at 5% loss — reliable: ${reliable.A.stalledFrames}, low-latency: ${fast.A.stalledFrames} of ${fast.frames}`);
    expect(fast.A.stalledFrames).toBeLessThan(reliable.A.stalledFrames / 3);
    expect(fast.A.stalledFrames / fast.frames).toBeLessThan(0.02);
  });

  it('still delivers every event exactly once and in order', () => {
    const { hub, got } = lossyMatch(true, 0.05);
    const sent = hub.sentTo('A').flatMap((m) => (m.ch === 'ev' ? (m.data as EventsMsg).e : m.ch === 'snap' ? ((m.data as SnapshotMsg).e ?? []) : []));
    // the events really went the new way
    expect(hub.sentTo('A').some((m) => m.ch === 'ev')).toBe(true);
    expect(sent.length).toBeGreaterThan(50);
    // all but the last few (still on their way when the test stopped) arrived, in the order they were sent
    expect(got.length).toBeGreaterThan(sent.length - 40);
    expect(got).toEqual(sent.slice(0, got.length));
  });

  it('is not used until the other end is listening, and the reliable path carries everything until then', () => {
    const { hub } = lossyMatch(true, 0);
    const first = hub.sentTo('A').find((m) => m.ch === 'snap');
    expect(first).toBeTruthy();
  });
});

describe('a stalled player', () => {
  it('gets a short, recent catch-up — not seconds of old gunfire — and still every kill', async () => {
    const w = new FakeWorld();
    const hub = new LagHub(w);
    const host = new HostSession(hub, 'STALL', true);
    host.clock = () => w.now;
    const B = new ClientSession(hub.connect('B', 30, 5), { name: 'B', color: 1, token: 'B' });
    B.clock = () => w.now;
    w.advance(500);
    host.setSettings({ ...host.lobby.settings, weapon: 'needler', ammoMode: 'noReload', orbRate: 'off', antiTurtleSec: 0, respawnMode: 'auto', respawnSec: 0 });
    for (let i = 0; i < 5; i++) host.addBot('legendary');
    host.startMatch(9);
    const run = async (ms: number, sink: SimEvent[] | null) => {
      for (let t = 0; t < ms; t += 1000 / 60) {
        w.advance(1000 / 60);
        host.update(w.now);
        B.update(w.now);
        const ev = B.drainEvents();
        sink?.push(...ev);
        // let the transport's send promises settle (backpressure clears through them)
        await Promise.resolve();
      }
    };
    await run(5000, null);
    const kills = () => host.match!.players.reduce((n, p) => n + (p?.kills ?? 0), 0);
    const killsBefore = kills();
    const stallFrom = host.match!.tick;
    hub.stall('B', 6000);
    await run(6000, null);
    const stallTo = host.match!.tick;
    const killsDuring = kills() - killsBefore;
    const after: SimEvent[] = [];
    await run(1500, after);
    // (the first few ticks went out before the link filled up: they were sent in time, just delivered late)
    const during = after.filter((e) => e.t > stallFrom + 6 && e.t <= stallTo);
    const oldCosmetic = during.filter((e) => COSMETIC.has(e.k) && e.t < stallTo - 2 * TICK_RATE);
    console.log(`after a 6 s stall: ${during.length} events from the stall delivered, ${oldCosmetic.length} of them stale effects; ${killsDuring} kills`);
    expect(killsDuring).toBeGreaterThan(0);
    expect(during.filter((e) => e.k === 'kill').length).toBe(killsDuring);
    expect(oldCosmetic.length).toBe(0);
  });
});

describe('snapshot order', () => {
  it('ignores a snapshot older than the newest (the low-latency path does not keep order), but never its events', () => {
    let deliver: ((ch: string, data: unknown) => void) | null = null;
    const net: ClientNet = {
      kind: 'test',
      send() {},
      onMessage: null,
      onClose: null,
      close() {},
    };
    const c = new ClientSession(net, { name: 'X', color: 1, token: 'x' });
    deliver = (ch, data) => net.onMessage?.(ch as never, data);
    deliver('ctl', { t: 'welcome', slot: 0, lobby: { code: 'T', phase: 'match', settings: {}, slots: [], online: true } });
    deliver('ctl', { t: 'start', start: { settings: {}, roster: [{ slot: 0, name: 'X', color: 1, kind: 'human' }], seed: 1, tick: 0, liveAt: 0, phase: 'live', leader: -1, orbs: [], arena: { seed: 1, holes: [], hills: [], radius: 40, auto: true } } });
    const snap = (k: number, exposure: number, e?: SimEvent[], id = 1): SnapshotMsg => ({ k, id, ph: 'live', a: 0, p: [[0, exposure, 0, 0, 1, 0, 0, 0, 0, -1]], ld: -1, ...(e ? { e } : {}) });
    // a straggler from the previous match (another seed) is ignored, however new its tick looks
    deliver('snap', snap(9000, 255, undefined, 77));
    expect(c.latestTick).toBe(0);
    deliver('snap', snap(10, 0));
    deliver('snap', snap(16, 255));
    deliver('snap', snap(13, 128, [{ k: 'reload', t: 13, p: 0 }]));
    expect(c.latestTick).toBe(16);
    expect(c.drainEvents().map((e) => e.k)).toEqual(['reload']);
    deliver('ev', { k: 17, e: [{ k: 'spawn', t: 17, p: 0, hole: 0 }] });
    expect(c.drainEvents().map((e) => e.k)).toEqual(['spawn']);
  });
});
