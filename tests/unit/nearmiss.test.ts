import { describe, expect, it } from 'vitest';
import { add, norm, scale, sub, yawPitchOf } from '../../src/shared/vec';
import { HEAD_R } from '../../src/sim/constants';
import { NEAR_R, playerEye, playerHitbox } from '../../src/sim/match';
import type { MatchState, PlayerCommand, SimEvent } from '../../src/sim/types';
import { WEAPONS } from '../../src/sim/weapons';
import { arena, cmd, faceOff, liveAndStanding, makeMatch, run } from './helpers';

const pitre = { pitre: true, pitreVoices: true, weapon: 'sniper' as const };

/** Aim from a's eye at a point `offset` m to the side of b's head. */
function aimPast(m: MatchState, a: number, b: number, offset: number) {
  const pa = m.players[a]!, pb = m.players[b]!;
  const to = sub(playerHitbox(m, arena, pb, pb.exposure, pa).head, playerEye(m, arena, pa));
  const side = norm({ x: -to.z, y: 0, z: to.x });
  return yawPitchOf(add(to, scale(side, offset)));
}

function shoot(m: MatchState, cmds: PlayerCommand[], a: number, aim: { yaw: number; pitch: number }) {
  m.players[a]!.nextFireAt = 0;
  cmds[a] = { ...cmds[a]!, yaw: aim.yaw, pitch: aim.pitch, presses: cmds[a]!.presses + 1 };
  return run(m, 1, cmds);
}

const nears = (ev: SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { k: 'near' }> => e.k === 'near');

describe('Pitre near misses ("Bitch please")', () => {
  it('a shot just past someone’s head is a near miss for them', () => {
    const m = makeMatch(2, pitre);
    faceOff(m);
    const cmds = liveAndStanding(m);
    const ev = shoot(m, cmds, 0, aimPast(m, 0, 1, HEAD_R + NEAR_R / 2));
    expect(ev.some((e) => e.k === 'dmg')).toBe(false);
    expect(nears(ev)).toEqual([expect.objectContaining({ a: 0, v: 1, w: 'sniper' })]);
  });

  it('not when it was a hit, a wide miss, or Pitre voices are off', () => {
    for (const s of [{ ...pitre, pitreVoices: false }, { ...pitre, pitre: false }]) {
      const m = makeMatch(2, s);
      faceOff(m);
      const cmds = liveAndStanding(m);
      expect(nears(shoot(m, cmds, 0, aimPast(m, 0, 1, HEAD_R + NEAR_R / 2)))).toEqual([]);
    }
    const m = makeMatch(2, pitre);
    faceOff(m);
    const cmds = liveAndStanding(m);
    expect(nears(shoot(m, cmds, 0, aimPast(m, 0, 1, 1.2)))).toEqual([]);
    run(m, 40, cmds);
    const hit = shoot(m, cmds, 0, aimPast(m, 0, 1, 0));
    expect(hit.some((e) => e.k === 'kill' && e.v === 1)).toBe(true);
    expect(nears(hit)).toEqual([]);
  });

  it('at most one per victim every half second', () => {
    const m = makeMatch(2, pitre);
    faceOff(m);
    const cmds = liveAndStanding(m);
    const aim = aimPast(m, 0, 1, HEAD_R + NEAR_R / 2);
    const ev = [...shoot(m, cmds, 0, aim), ...run(m, 10, cmds), ...shoot(m, cmds, 0, aim)];
    expect(nears(ev)).toHaveLength(1);
    run(m, 30, cmds);
    expect(nears(shoot(m, cmds, 0, aim))).toHaveLength(1);
  });

  it('ducking under the shot just in time counts — but not ducking long before', () => {
    const m = makeMatch(2, pitre);
    faceOff(m);
    const cmds = liveAndStanding(m);
    const aim = aimPast(m, 0, 1, 0);
    cmds[1] = cmd({ stand: false });
    run(m, 20, cmds);
    expect(m.players[1]!.exposure).toBe(0);
    const ev = shoot(m, cmds, 0, aim);
    expect(ev.some((e) => e.k === 'dmg')).toBe(false);
    expect(nears(ev)).toEqual([expect.objectContaining({ v: 1 })]);
    run(m, 60, cmds);
    expect(nears(shoot(m, cmds, 0, aim))).toEqual([]);
  });

  it('a crossbow bolt whizzing past counts once', () => {
    const m = makeMatch(2, { ...pitre, weapon: 'crossbow' });
    faceOff(m);
    const cmds = liveAndStanding(m);
    const head = playerHitbox(m, arena, m.players[1]!).head;
    const speed = WEAPONS.crossbow.projectile!.speed;
    // flying sideways past the head, just clear of it
    const miss = HEAD_R + WEAPONS.crossbow.projectile!.radius + NEAR_R / 2;
    m.projectiles.push({ id: m.nextId++, owner: 0, weapon: 'crossbow', x: head.x - 6, y: head.y, z: head.z + miss, vx: speed, vy: 0, vz: 0, born: m.tick - 30, bounces: 0, target: -1, fuseAt: 0 });
    const ev = run(m, 10, cmds);
    expect(ev.some((e) => e.k === 'dmg')).toBe(false);
    expect(nears(ev)).toEqual([expect.objectContaining({ a: 0, v: 1, w: 'crossbow' })]);
  });
});
