import { describe, expect, it } from 'vitest';
import { ClientSession } from '../../src/net/client';
import { HostSession } from '../../src/net/host';
import { loopbackPair } from '../../src/net/transport';
import { Rng } from '../../src/shared/rng';
import { yawPitchOf } from '../../src/shared/vec';
import { eyePos, hitboxOf } from '../../src/sim/hitbox';
import { damagePlayer } from '../../src/sim/match';
import { FakeWorld, LagHub } from './laglink';

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('loopback session', () => {
  it('runs an offline match against bots', async () => {
    const { host: hn, client: cn } = loopbackPair();
    let now = 0;
    const host = new HostSession(hn, 'LOCAL', false);
    host.clock = () => now;
    const client = new ClientSession(cn, { name: 'Me', color: 0x3d7bff, token: 'tok' });
    client.clock = () => now;
    await flush();
    expect(client.state).toBe('lobby');
    host.addBot('heroic');
    host.addBot('legendary');
    host.setSettings({ ...host.lobby.settings, orbRate: 'high' });
    host.startMatch(42);
    expect(client.state).toBe('match');
    let kills = 0;
    let fires = 0;
    for (let i = 0; i < 60 * 60; i++) {
      now += 1000 / 60;
      host.update(now);
      client.update(now);
      for (const e of client.drainEvents()) {
        if (e.k === 'kill') kills++;
        if (e.k === 'fire') fires++;
      }
    }
    expect(fires).toBeGreaterThan(10);
    expect(kills).toBeGreaterThan(2);
    expect(client.players.filter(Boolean).length).toBe(3);
    expect(client.me).not.toBeNull();
    expect(client.renderTick).toBeGreaterThan(3000);
  });
});

describe('manual respawn over the wire', () => {
  it('a dead player stays down until they press Jump', async () => {
    const { host: hn, client: cn } = loopbackPair();
    let now = 0;
    const host = new HostSession(hn, 'LOCAL', false);
    host.clock = () => now;
    const client = new ClientSession(cn, { name: 'Me', color: 0x3d7bff, token: 'tok' });
    client.clock = () => now;
    await flush();
    host.setSettings({ ...host.lobby.settings, orbRate: 'off', antiTurtleSec: 0, respawnMode: 'manual', respawnSec: 1 });
    host.startMatch(5);
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        now += 1000 / 60;
        host.update(now);
        client.update(now);
        client.drainEvents();
      }
    };
    step(host.match!.liveAt + 10);
    const m = host.match!;
    damagePlayer(m, { arena: host.arena, rng: new Rng(1), events: [] }, -1, m.players[client.slot]!, 9999, { head: false, weapon: 'sniper', kind: 'direct' });
    step(150);
    expect(client.me?.al).toBe(false);
    expect(client.me?.rq).toBe(false);
    client.input.respawns++;
    step(4);
    expect(client.me?.al).toBe(true);
  });
});

function lagMatch(oneWay: number, jitter: number, maxRewindMs: number) {
  const w = new FakeWorld();
  const hub = new LagHub(w);
  const host = new HostSession(hub, 'LAG', true);
  host.clock = () => w.now;
  const mk = (peer: string) => {
    const c = new ClientSession(hub.connect(peer, oneWay, jitter), { name: peer, color: 1, token: peer });
    c.clock = () => w.now;
    return c;
  };
  const A = mk('A');
  const B = mk('B');
  w.advance(500);
  host.setSettings({ ...host.lobby.settings, orbRate: 'off', antiTurtleSec: 0, maxRewindMs, respawnSec: 1, respawnMode: 'auto' });
  // put A and B in facing holes
  host.startMatch(7);
  const m = host.match!;
  const pa = m.players[A.slot]!, pb = m.players[B.slot]!;
  const ar = host.arena;
  outer: for (const h1 of m.activeHoles)
    for (const h2 of m.activeHoles) {
      const H1 = ar.holes[h1]!, H2 = ar.holes[h2]!;
      const d = Math.hypot(H1.x - H2.x, H1.z - H2.z);
      if (h1 !== h2 && d > 25 && ar.lineClear({ x: H1.x, y: H1.rim + 0.88, z: H1.z }, { x: H2.x, y: H2.rim + 0.95, z: H2.z })) {
        pa.hole = h1;
        pb.hole = h2;
        break outer;
      }
    }
  let shots = 0;
  let hits = 0;
  let lastPress = 0;
  for (let i = 0; i < 60 * 40; i++) {
    w.advance(1000 / 60);
    host.update(w.now);
    // B pops up for 0.5s every 1.2s
    const phase = (w.now % 1200) / 1200;
    B.input.stand = phase < 0.42;
    A.input.stand = true;
    B.update(w.now);
    A.update(w.now);
    // A aims at B's head as A sees it and fires the moment B looks fully up
    const vb = A.players[B.slot];
    const va = A.players[A.slot];
    if (vb && va && A.me?.al && vb.alive) {
      const hb = hitboxOf(ar.holes[vb.hole]!, vb.exposure);
      const eye = eyePos(ar.holes[va.hole]!, A.myExposure);
      const a = yawPitchOf({ x: hb.head.x - eye.x, y: hb.head.y - eye.y, z: hb.head.z - eye.z });
      A.input.yaw = a.yaw;
      A.input.pitch = a.pitch;
      if (vb.exposure > 0.95 && A.myExposure >= 1 && (A.me.clip ?? 0) > 0 && A.renderTick > A.me.nf + 2 && w.now - lastPress > 700) {
        A.input.presses++;
        lastPress = w.now;
        shots++;
      }
    }
    for (const e of A.drainEvents()) if (e.k === 'dmg' && e.a === A.slot && e.v === B.slot) hits++;
    B.drainEvents();
  }
  return { shots, hits, kills: m.players[A.slot]!.kills };
}

describe('lag compensation', () => {
  it('lands shots at 60ms one-way with rewind, fewer without', () => {
    const withR = lagMatch(60, 20, 250);
    const without = lagMatch(60, 20, 0);
    console.log('with rewind', withR, 'without', without);
    expect(withR.shots).toBeGreaterThan(5);
    expect(withR.hits / withR.shots).toBeGreaterThan(0.8);
    expect(without.hits / Math.max(1, without.shots)).toBeLessThan(withR.hits / withR.shots);
  });
});

describe('rejoin robustness', () => {
  it('a late leave for the old connection does not disconnect a rejoined player', () => {
    const w = new FakeWorld();
    const hub = new LagHub(w);
    const host = new HostSession(hub, 'RJ', true);
    host.clock = () => w.now;
    const a1 = new ClientSession(hub.connect('A1', 20), { name: 'A', color: 1, token: 'tokA' });
    a1.clock = () => w.now;
    w.advance(300);
    host.startMatch(3);
    w.advance(300);
    const slot = a1.slot;
    // same player comes back on a new connection (e.g. phone switched networks)…
    const a2 = new ClientSession(hub.connect('A2', 20), { name: 'A', color: 1, token: 'tokA' });
    a2.clock = () => w.now;
    w.advance(300);
    expect(a2.slot).toBe(slot);
    // …and only then does the old connection's leave arrive
    hub.onLeave?.('A1');
    expect(host.match!.players[slot]!.connected).toBe(true);
    expect(host.lobby.slots.find((s) => s.slot === slot)!.connected).toBe(true);
  });

  it('forgets rejoin tokens of players dropped when returning to the lobby', () => {
    const w = new FakeWorld();
    const hub = new LagHub(w);
    const host = new HostSession(hub, 'RJ2', true);
    host.clock = () => w.now;
    const a = new ClientSession(hub.connect('A', 10), { name: 'A', color: 1, token: 'tokA' });
    a.clock = () => w.now;
    w.advance(200);
    host.startMatch(3);
    w.advance(200);
    hub.onLeave?.('A');
    host.backToLobby();
    const c = new ClientSession(hub.connect('C', 10), { name: 'C', color: 2, token: 'tokC' });
    c.clock = () => w.now;
    w.advance(200);
    const a2 = new ClientSession(hub.connect('A2', 10), { name: 'A', color: 1, token: 'tokA' });
    a2.clock = () => w.now;
    w.advance(200);
    expect(a2.slot).not.toBe(c.slot);
  });
});
