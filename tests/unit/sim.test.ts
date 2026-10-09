import { describe, expect, it } from 'vitest';
import { ARENA_SEED, Arena, visibilityStats } from '../../src/sim/arena';
import { RISE_TIME, TICK_RATE } from '../../src/sim/constants';
import { run, makeMatch, cmd, liveAndStanding, aimAt, faceOff, arena } from './helpers';
import type { PlayerCommand } from '../../src/sim/types';
import { stepMatch } from '../../src/sim/match';

describe('arena', () => {
  it('has 16 well-spaced holes with good sight lines (locked seed)', () => {
    const a = new Arena(ARENA_SEED);
    expect(a.holes.length).toBe(16);
    const st = visibilityStats(a);
    expect(st.worst).toBeGreaterThanOrEqual(0.7);
    for (const h of a.holes) for (const o of a.holes) if (h !== o) expect(Math.hypot(h.x - o.x, h.z - o.z)).toBeGreaterThanOrEqual(11.5);
  });
  it('raycast stops at the ground', () => {
    const d = arena.raycast({ x: 0, y: 20, z: 0 }, { x: 0, y: -1, z: 0 }, 100);
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(25);
  });
});

describe('stance', () => {
  it('rises in ~0.22s and ducks back', () => {
    const m = makeMatch(1);
    const c = [cmd({ stand: true })];
    run(m, Math.ceil(RISE_TIME * TICK_RATE) + 1, c);
    expect(m.players[0]!.exposure).toBe(1);
    run(m, 12, [cmd({ stand: false })]);
    expect(m.players[0]!.exposure).toBe(0);
  });
  it('anti-turtle forces a stand', () => {
    const m = makeMatch(1, { antiTurtleSec: 3 });
    const ev = run(m, m.liveAt + 3 * 60 + 5, [cmd()]);
    expect(ev.some((e) => e.k === 'forced')).toBe(true);
    run(m, 20, [cmd()]);
    expect(m.players[0]!.exposure).toBeGreaterThan(0.5);
  });
});

function shoot(m: ReturnType<typeof makeMatch>, cmds: PlayerCommand[], part: 'head' | 'body') {
  const a = aimAt(m, 0, 1, part);
  cmds[0] = { ...cmds[0]!, yaw: a.yaw, pitch: a.pitch, presses: cmds[0]!.presses + 1 };
  return run(m, 1, cmds);
}

describe('sniper', () => {
  it('kills with one headshot', () => {
    const m = makeMatch(2);
    faceOff(m);
    const cmds = liveAndStanding(m);
    const ev = shoot(m, cmds, 'head');
    const kill = ev.find((e) => e.k === 'kill');
    expect(kill).toMatchObject({ a: 0, v: 1, head: true });
    expect(m.players[0]!.kills).toBe(1);
  });
  it('needs two body shots', () => {
    const m = makeMatch(2);
    faceOff(m);
    const cmds = liveAndStanding(m);
    let ev = shoot(m, cmds, 'body');
    expect(ev.some((e) => e.k === 'dmg' && e.v === 1 && e.sb)).toBe(true);
    expect(m.players[1]!.alive).toBe(true);
    run(m, 40, cmds);
    ev = shoot(m, cmds, 'body');
    expect(ev.some((e) => e.k === 'kill')).toBe(true);
  });
  it('cannot hit a ducked player', () => {
    const m = makeMatch(2);
    faceOff(m);
    const cmds = liveAndStanding(m);
    cmds[1] = cmd({ stand: false });
    run(m, 30, cmds);
    const ev = shoot(m, cmds, 'head');
    expect(ev.some((e) => e.k === 'dmg')).toBe(false);
  });
  it('honours lag compensation for a player popping up', () => {
    const m = makeMatch(2, { maxRewindMs: 150 });
    faceOff(m);
    const cmds = liveAndStanding(m);
    cmds[1] = cmd({ stand: false });
    run(m, 30, cmds);
    cmds[1] = cmd({ stand: true });
    run(m, 9, cmds); // target is most of the way up (~150ms)
    expect(m.players[1]!.exposure).toBeGreaterThan(0.6);
    expect(m.players[1]!.exposure).toBeLessThan(0.8);
    const a = aimAt(m, 0, 1, 'head');
    const viewTick = m.tick;
    run(m, 5, cmds); // fully up by the time the shot reaches the host
    expect(m.players[1]!.exposure).toBe(1);
    const c0 = { ...cmds[0]!, yaw: a.yaw, pitch: a.pitch, presses: 1 };
    // fire with the old view tick: the head is rewound to where the shooter saw it
    const ev = stepMatch(m, [{ ...c0, vt: viewTick }, cmds[1]], arena);
    expect(ev.some((e) => e.k === 'kill')).toBe(true);
  });
  it('favours the ducker: a shot from an older view misses someone who has ducked since', () => {
    const m = makeMatch(2, { maxRewindMs: 250 });
    faceOff(m);
    const cmds = liveAndStanding(m);
    const a = aimAt(m, 0, 1, 'head');
    const viewTick = m.tick;
    cmds[1] = cmd({ stand: false });
    run(m, 10, cmds); // ducked (~170ms), well inside the rewind window
    expect(m.players[1]!.exposure).toBe(0);
    const c0 = { ...cmds[0]!, yaw: a.yaw, pitch: a.pitch, presses: 1 };
    const ev = stepMatch(m, [{ ...c0, vt: viewTick }, cmds[1]], arena);
    expect(ev.some((e) => e.k === 'dmg')).toBe(false);
  });
  it('shields recharge after the delay', () => {
    const m = makeMatch(2);
    faceOff(m);
    const cmds = liveAndStanding(m);
    shoot(m, cmds, 'body');
    const p = m.players[1]!;
    expect(p.shield).toBe(0);
    run(m, 4 * 60 + 60, cmds);
    expect(p.shield).toBeGreaterThan(20);
  });
});

describe('match flow', () => {
  it('ends at the score limit and names the winner', () => {
    const m = makeMatch(2, { scoreLimit: 5, respawnSec: 0 });
    faceOff(m);
    const cmds = liveAndStanding(m);
    let ended = false;
    for (let i = 0; i < 400 && !ended; i++) {
      const p1 = m.players[1]!;
      if (p1.alive && p1.exposure >= 1 && m.tick >= m.players[0]!.nextFireAt && m.players[0]!.clip > 0) {
        const ev = shoot(m, cmds, 'head');
        ended = ev.some((e) => e.k === 'end');
      } else run(m, 1, cmds);
    }
    expect(m.phase).toBe('ended');
    expect(m.winner).toBe(0);
    expect(m.players[0]!.kills).toBe(5);
  });
  it('awards double kill medals', () => {
    const m = makeMatch(3, { respawnSec: 5 });
    faceOff(m);
    const cmds = liveAndStanding(m, [0, 1, 2]);
    shoot(m, cmds, 'head');
    // move player 2 into player 1's former hole for simplicity
    m.players[2]!.hole = m.players[1]!.hole;
    m.players[1]!.hole = 15;
    run(m, 40, cmds);
    const a = aimAt(m, 0, 2, 'head');
    cmds[0] = { ...cmds[0]!, yaw: a.yaw, pitch: a.pitch, presses: cmds[0]!.presses + 1 };
    const ev = run(m, 1, cmds);
    const kill = ev.find((e) => e.k === 'kill');
    expect(kill && kill.k === 'kill' && kill.medals).toContain('double');
  });
});

describe('review regressions', () => {
  it('the last hyperbeam charge in a clip lasts the full beam', () => {
    const m = makeMatch(2, { weapon: 'hyperbeam' });
    faceOff(m);
    const cmds = liveAndStanding(m);
    const p = m.players[0]!;
    p.clip = 1;
    const a = aimAt(m, 0, 1, 'body');
    cmds[0] = { ...cmds[0]!, yaw: a.yaw + 1, pitch: a.pitch, trigger: true };
    run(m, 60, cmds); // charge (0.6s) and start the beam aimed away
    expect(p.beamUntil).toBeGreaterThan(m.tick + 60);
    run(m, 30, cmds);
    expect(p.beamUntil).toBeGreaterThan(m.tick);
  });
  it('grenade splash kills count toward accuracy', () => {
    const m = makeMatch(2, { weapon: 'rpg' });
    faceOff(m);
    const cmds = liveAndStanding(m);
    const a = aimAt(m, 0, 1, 'body');
    cmds[0] = { ...cmds[0]!, yaw: a.yaw, pitch: a.pitch, presses: 1 };
    run(m, 120, cmds);
    const p = m.players[0]!;
    expect(p.shots).toBe(1);
    expect(p.hits).toBe(1);
  });
});
