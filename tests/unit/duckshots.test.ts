import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/shared/rng';
import { dirFromYawPitch, norm, sub, yawPitchOf } from '../../src/shared/vec';
import { MOUTH_R, wellWall } from '../../src/sim/arena';
import { FIRE_EXPOSURE } from '../../src/sim/constants';
import { eyePos } from '../../src/sim/hitbox';
import { grantPowerup, playerEye, playerHitbox, traceRay } from '../../src/sim/match';
import { orbPos } from '../../src/sim/orbs';
import type { Orb, PlayerCommand, SimEvent } from '../../src/sim/types';
import { WEAPONS, firesFromDuck } from '../../src/sim/weapons';
import { arena, cmd, faceOff, liveAndStanding, makeMatch, run } from './helpers';

/** A bubble (seen `age` ticks after it appeared) that someone ducked in one of the match's holes can see straight up. */
function bubbleOverHole(m: ReturnType<typeof makeMatch>, at: number) {
  for (let seed = 1; seed < 5000; seed++) {
    const orb: Orb = { id: 777, type: 'damage', seed, spawn: at - 600, expire: at + 5000 };
    const c = orbPos(orb, at, arena);
    for (const id of m.activeHoles) {
      const h = arena.holes[id]!;
      const eye = eyePos(h, 0);
      if (wellWall(eye, norm(sub(c, eye)), h) === Infinity && arena.lineClear(eye, c, 0.9)) return { orb, hole: id };
    }
  }
  throw new Error('no bubble over a hole');
}

/** Duck player 0 in `hole` (everyone else somewhere else). */
function duckIn(m: ReturnType<typeof makeMatch>, hole: number) {
  const cmds = liveAndStanding(m);
  m.players[0]!.hole = hole;
  if (m.players[1]!.hole === hole) m.players[1]!.hole = m.activeHoles.find((h) => h !== hole)!;
  cmds[0] = cmd({ stand: false });
  run(m, 30, cmds);
  expect(m.players[0]!.exposure).toBe(0);
  return cmds;
}

function press(m: ReturnType<typeof makeMatch>, cmds: PlayerCommand[], yaw: number, pitch: number) {
  cmds[0] = { ...cmds[0]!, yaw, pitch, presses: cmds[0]!.presses + 1 };
  return run(m, 1, cmds);
}

describe('shooting bubbles from a duck', () => {
  it('the hole wall: only steep shots get out of the mouth', () => {
    const h = arena.holes[0]!;
    const eye = eyePos(h, 0);
    expect(eye.y).toBeLessThan(h.rim);
    expect(wellWall(eye, { x: 0, y: 1, z: 0 }, h)).toBe(Infinity);
    expect(wellWall(eye, dirFromYawPitch(0.3, (70 * Math.PI) / 180), h)).toBe(Infinity);
    const flat = wellWall(eye, dirFromYawPitch(0.3, (20 * Math.PI) / 180), h);
    expect(flat).toBeGreaterThan(MOUTH_R * 0.99);
    expect(flat).toBeLessThan(MOUTH_R * 1.1);
    // standing, the eye is above the rim: nothing in the way
    expect(wellWall(eyePos(h, 1), dirFromYawPitch(0.3, 0), h)).toBe(Infinity);
  });

  it('which weapons can: single-shot and burst guns, not grenades, automatics, charge or one-use weapons', () => {
    const ok = (Object.keys(WEAPONS) as (keyof typeof WEAPONS)[]).filter((w) => firesFromDuck(WEAPONS[w]));
    expect(ok.sort()).toEqual(['br', 'crossbow', 'rpg', 'sniper']);
  });

  it('a steep shot from a duck pops a bubble overhead', () => {
    const m = makeMatch(2, { weapon: 'sniper' });
    const { orb, hole } = bubbleOverHole(m, m.liveAt + 31);
    const cmds = duckIn(m, hole);
    m.orbs.push({ ...orb, spawn: orb.spawn + (m.tick + 1 - (m.liveAt + 31)) });
    const p = m.players[0]!;
    const a = yawPitchOf(sub(orbPos(m.orbs[0]!, m.tick + 1, arena), playerEye(m, arena, p)));
    const ev = press(m, cmds, a.yaw, a.pitch);
    expect(ev.some((e) => e.k === 'orbPop' && e.p === 0)).toBe(true);
    expect(ev.some((e) => e.k === 'got' && e.p === 0)).toBe(true);
    // still ducked, and not counted as a shot at anyone
    expect(p.exposure).toBe(0);
    expect(p.shots).toBe(0);
  });

  it('a shallow shot from a duck hits the side of the hole', () => {
    const m = makeMatch(2, { weapon: 'sniper' });
    const cmds = duckIn(m, m.activeHoles[0]!);
    const ev = press(m, cmds, 1, 0.25);
    const f = ev.find((e): e is Extract<SimEvent, { k: 'fire' }> => e.k === 'fire');
    expect(f?.hit).toBe('world');
    expect(Math.hypot(f!.e[0] - f!.o[0], f!.e[2] - f!.o[2])).toBeLessThan(MOUTH_R + 0.05);
  });

  it('a shot from a duck goes past players (it only pops bubbles)', () => {
    const m = makeMatch(2, { weapon: 'sniper' });
    faceOff(m);
    liveAndStanding(m);
    const [a, b] = [m.players[0]!, m.players[1]!];
    const o = playerEye(m, arena, a);
    const d = norm(sub(playerHitbox(m, arena, b).head, o));
    expect(traceRay(m, arena, a, o, d, 400, m.tick).hits.some((h) => h.kind === 'player')).toBe(true);
    expect(traceRay(m, arena, a, o, d, 400, m.tick, true).hits.some((h) => h.kind === 'player')).toBe(false);
  });

  it('a rocket fired up from a duck fizzles out: no blast', () => {
    const m = makeMatch(2, { weapon: 'rpg' });
    const cmds = duckIn(m, m.activeHoles[0]!);
    const ev = press(m, cmds, 0, 1.4);
    const proj = ev.find((e) => e.k === 'proj');
    expect(proj).toBeDefined();
    expect(m.projectiles[0]?.orbOnly).toBe(true);
    const later = run(m, 60 * 7, cmds);
    expect(later.some((e) => e.k === 'pend' && e.gone)).toBe(true);
    expect(later.some((e) => e.k === 'boom' || e.k === 'dmg')).toBe(false);
  });

  it('a click on the way up still waits until you are up (and then it can hit)', () => {
    const m = makeMatch(2, { weapon: 'sniper' });
    faceOff(m);
    const cmds = liveAndStanding(m);
    cmds[0] = cmd({ stand: false });
    run(m, 30, cmds);
    const [a, b] = [m.players[0]!, m.players[1]!];
    // aim from where the eye will be when the shot goes
    const ang = yawPitchOf(sub(playerHitbox(m, arena, b).head, eyePos(arena.holes[a.hole]!, FIRE_EXPOSURE + 0.05)));
    cmds[0] = { ...cmds[0]!, stand: true, yaw: ang.yaw, pitch: ang.pitch, presses: 1 };
    expect(run(m, 1, cmds).some((e) => e.k === 'fire')).toBe(false);
    const ev = run(m, 10, cmds);
    expect(ev.some((e) => e.k === 'fire' && e.p === 0)).toBe(true);
    expect(ev.some((e) => e.k === 'dmg' && e.v === 1 && e.amt > 0)).toBe(true);
  });

  it('a press made standing (say mid-reload) doesn’t go off into the wall once you’ve ducked', () => {
    const m = makeMatch(2, { weapon: 'sniper' });
    const cmds = liveAndStanding(m);
    const p = m.players[0]!;
    p.clip = 0;
    p.reloadUntil = m.tick + 6;
    cmds[0] = { ...cmds[0]!, stand: false, pitch: 0.2, presses: cmds[0]!.presses + 1 };
    const ev = run(m, 14, cmds);
    expect(p.exposure).toBeLessThan(FIRE_EXPOSURE);
    expect(ev.some((e) => e.k === 'fire')).toBe(false);
  });

  it('automatic weapons still need you up', () => {
    const m = makeMatch(2);
    const cmds = duckIn(m, m.activeHoles[0]!);
    grantPowerup(m, { arena, rng: new Rng(1), events: [] }, m.players[0]!, 'minigun');
    cmds[0] = { ...cmds[0]!, pitch: 1.4, trigger: true };
    expect(run(m, 90, cmds).some((e) => e.k === 'fire')).toBe(false);
  });
});
