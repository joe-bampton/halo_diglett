import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/shared/rng';
import { sub, yawPitchOf } from '../../src/shared/vec';
import { secToTicks } from '../../src/sim/constants';
import { damagePlayer, grantPowerup, hasPowerup, isCamo, playerEye, playerHitbox, stepMatch } from '../../src/sim/match';
import { HELD_UNTIL, SPRING_COOLDOWN, SPRING_H, SPRING_TICKS, inFlight, springLift } from '../../src/sim/spring';
import type { MatchState, PlayerCommand, SimEvent } from '../../src/sim/types';
import { arena, cmd, faceOff, liveAndStanding, makeMatch, run } from './helpers';

const ctx = () => ({ arena, rng: new Rng(1), events: [] as SimEvent[] });

/** Aim from a's eye (Spring Jump included) at b's head as it is now. */
function aim(m: MatchState, a: number, b: number) {
  const pa = m.players[a]!, pb = m.players[b]!;
  return yawPitchOf(sub(playerHitbox(m, arena, pb, pb.exposure, pa).head, playerEye(m, arena, pa)));
}

function shoot(m: MatchState, cmds: PlayerCommand[], a: number, b: number) {
  const ang = aim(m, a, b);
  cmds[a] = { ...cmds[a]!, yaw: ang.yaw, pitch: ang.pitch, presses: cmds[a]!.presses + 1 };
  return run(m, 1, cmds);
}

/** Two holes close enough that someone at the top of a Spring Jump can see into the other one. */
function nearbyPair(m: MatchState) {
  const [a, b] = [m.players[0]!, m.players[1]!];
  for (const h1 of m.activeHoles)
    for (const h2 of m.activeHoles) {
      const A = arena.holes[h1]!, B = arena.holes[h2]!;
      const d = Math.hypot(A.x - B.x, A.z - B.z);
      if (h1 !== h2 && d > 14 && d < 24) {
        a.hole = h1;
        b.hole = h2;
        return;
      }
    }
  throw new Error('no nearby holes');
}

function launch(m: MatchState, cmds: PlayerCommand[], slot: number) {
  cmds[slot] = { ...cmds[slot]!, springs: cmds[slot]!.springs + 1 };
  return run(m, 1, cmds);
}

describe('Spring Jump', () => {
  it('is held until used, then catapults you ~20 m up and back into your hole', () => {
    const m = makeMatch(2);
    const cmds = liveAndStanding(m);
    const p = m.players[0]!;
    grantPowerup(m, ctx(), p, 'spring');
    expect(p.powerups).toEqual([{ id: 'spring', until: HELD_UNTIL }]);
    run(m, secToTicks(30), cmds);
    expect(hasPowerup(p, 'spring', m.tick)).toBe(true);
    // let go of stand: in the air you can't duck anyway
    cmds[0] = { ...cmds[0]!, stand: false };
    const ev = launch(m, cmds, 0);
    expect(ev.some((e) => e.k === 'spring' && e.p === 0)).toBe(true);
    expect(p.springAt).toBe(m.tick);
    expect(hasPowerup(p, 'spring', m.tick)).toBe(false);
    run(m, Math.round(SPRING_TICKS / 2) - 1, cmds);
    expect(springLift(p.springAt, m.tick)).toBeCloseTo(SPRING_H, 0);
    expect(p.exposure).toBe(1);
    const hole = arena.holes[p.hole]!;
    expect(playerHitbox(m, arena, p).head.y - hole.rim).toBeGreaterThan(SPRING_H);
    run(m, SPRING_TICKS, cmds);
    expect(inFlight(p.springAt, m.tick)).toBe(false);
    expect(playerHitbox(m, arena, p).head.y - hole.rim).toBeLessThan(0.5);
    expect(p.exposure).toBe(0);
  });

  it('one launch per pickup; a new one only after landing', () => {
    const m = makeMatch(2);
    const cmds = liveAndStanding(m);
    const p = m.players[0]!;
    grantPowerup(m, ctx(), p, 'spring');
    launch(m, cmds, 0);
    const first = p.springAt;
    // no spring left
    expect(launch(m, cmds, 0).some((e) => e.k === 'spring')).toBe(false);
    // a second one picked up mid-air waits for the landing
    grantPowerup(m, ctx(), p, 'spring');
    expect(launch(m, cmds, 0).some((e) => e.k === 'spring')).toBe(false);
    run(m, first + SPRING_TICKS + SPRING_COOLDOWN - m.tick, cmds);
    expect(launch(m, cmds, 0).some((e) => e.k === 'spring')).toBe(true);
    expect(p.springAt).toBeGreaterThan(first);
  });

  it('keeps you visible: camo is off while airborne', () => {
    const m = makeMatch(2);
    const cmds = liveAndStanding(m);
    const p = m.players[0]!;
    grantPowerup(m, ctx(), p, 'camo');
    expect(isCamo(m, p)).toBe(true);
    grantPowerup(m, ctx(), p, 'spring');
    launch(m, cmds, 0);
    expect(isCamo(m, p)).toBe(false);
    run(m, SPRING_TICKS, cmds);
    expect(isCamo(m, p)).toBe(true);
  });

  it('airborne players can be shot where they are (not at their hole)', () => {
    const m = makeMatch(2, { weapon: 'sniper' });
    faceOff(m);
    const cmds = liveAndStanding(m);
    // where the head is on the ground
    const ground = aim(m, 1, 0);
    grantPowerup(m, ctx(), m.players[0]!, 'spring');
    launch(m, cmds, 0);
    run(m, 60, cmds);
    cmds[1] = { ...cmds[1]!, yaw: ground.yaw, pitch: ground.pitch, presses: cmds[1]!.presses + 1 };
    const miss = run(m, 1, cmds);
    expect(miss.some((e) => e.k === 'dmg' && e.v === 0)).toBe(false);
    run(m, 40, cmds);
    // from below, the body is in front of the head
    const hit = shoot(m, cmds, 1, 0);
    expect(hit.some((e) => e.k === 'dmg' && e.v === 0 && e.amt > 0)).toBe(true);
  });

  it('from the top of a jump you can shoot down into a ducked player’s hole', () => {
    const m = makeMatch(2, { weapon: 'sniper' });
    nearbyPair(m);
    const cmds = liveAndStanding(m);
    cmds[1] = cmd({ stand: false });
    run(m, 30, cmds);
    expect(m.players[1]!.exposure).toBe(0);
    // from the ground the ducked head is out of reach
    const blocked = shoot(m, cmds, 0, 1);
    expect(blocked.some((e) => e.k === 'dmg' && e.v === 1)).toBe(false);
    run(m, 40, cmds);
    grantPowerup(m, ctx(), m.players[0]!, 'spring');
    launch(m, cmds, 0);
    run(m, Math.round(SPRING_TICKS / 2) - 2, cmds);
    const ev = shoot(m, cmds, 0, 1);
    expect(ev.some((e) => e.k === 'kill' && e.v === 1 && e.head)).toBe(true);
  });

  it('lag compensation rewinds the jump too', () => {
    const m = makeMatch(2, { weapon: 'sniper', maxRewindMs: 150 });
    faceOff(m);
    const cmds = liveAndStanding(m);
    // the shooter saw the target still on the ground, a few ticks before it launched
    const ground = aim(m, 1, 0);
    const seen = m.tick;
    grantPowerup(m, ctx(), m.players[0]!, 'spring');
    cmds[0] = { ...cmds[0]!, springs: 1 };
    stepMatch(m, cmds.map((c) => c && { ...c, vt: m.tick }), arena);
    stepMatch(m, cmds.map((c) => c && { ...c, vt: m.tick }), arena);
    expect(inFlight(m.players[0]!.springAt, m.tick)).toBe(true);
    cmds[1] = { ...cmds[1]!, yaw: ground.yaw, pitch: ground.pitch, presses: cmds[1]!.presses + 1 };
    const ev = stepMatch(m, cmds.map((c, i) => c && { ...c, vt: i === 1 ? seen : m.tick }), arena);
    expect(ev.some((e) => e.k === 'kill' && e.v === 0)).toBe(true);
  });

  it('a grenade that drops into a ducked player’s hole still gets them', () => {
    const m = makeMatch(2, { weapon: 'grenade' });
    faceOff(m);
    const cmds = liveAndStanding(m);
    cmds[1] = cmd({ stand: false });
    run(m, 30, cmds);
    const h = arena.holes[m.players[1]!.hole]!;
    m.projectiles.push({ id: m.nextId++, owner: 0, weapon: 'grenade', x: h.x + 0.1, y: h.rim + 2, z: h.z, vx: 0, vy: -8, vz: 0, born: m.tick - 30, bounces: 0, target: -1, fuseAt: 0 });
    run(m, 30, cmds);
    expect(m.players[1]!.alive).toBe(false);
  });

  it('shot down mid-air: no jump left after respawning', () => {
    const m = makeMatch(2, { respawnSec: 1 });
    const cmds = liveAndStanding(m);
    const p = m.players[0]!;
    grantPowerup(m, ctx(), p, 'spring');
    launch(m, cmds, 0);
    run(m, 30, cmds);
    damagePlayer(m, ctx(), 1, p, 999, { head: false, weapon: 'sniper', kind: 'direct' });
    expect(p.alive).toBe(false);
    run(m, secToTicks(1.2), cmds);
    expect(p.alive).toBe(true);
    expect(p.springAt).toBe(-1);
    expect(hasPowerup(p, 'spring', m.tick)).toBe(false);
  });
});
