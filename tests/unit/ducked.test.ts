import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/shared/rng';
import { norm, sub, yawPitchOf, type V3 } from '../../src/shared/vec';
import { Arena, MOUTH_R, generateLayout } from '../../src/sim/arena';
import { HEAD_R, HEAD_Y, HIDDEN_EXPOSURE, TORSO_R, TORSO_Y1 } from '../../src/sim/constants';
import { HIGH_SHOT, eyePos, hitboxOf, rayHitbox } from '../../src/sim/hitbox';
import { grantPowerup, playerEye, stepMatch } from '../../src/sim/match';
import type { MatchState, PlayerCommand, SimEvent } from '../../src/sim/types';
import { WEAPONS } from '../../src/sim/weapons';
import { arena, cmd, faceOff, liveAndStanding, makeMatch, run } from './helpers';

/** Points a shooter on the ground might aim at around a ducked player: the head, the top of the head, the torso and a
 * grid over the hole's mouth. */
function aimPoints(h: { x: number; z: number; rim: number }): V3[] {
  const pts: V3[] = [];
  for (const y of [-0.7, -0.45, -0.2, 0, 0.05])
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) pts.push({ x: h.x + i * MOUTH_R * 0.6, y: h.rim + y, z: h.z + j * MOUTH_R * 0.6 });
  return pts;
}

/** projectile radii in play (0 = hitscan), plus a generous one */
const RADII = [0, ...new Set(Object.values(WEAPONS).map((w) => w.projectile?.radius ?? 0)), 0.6];

describe('ducked players are safe from bullets', () => {
  it('the top of the head is under the rim from HIDDEN_EXPOSURE down', () => {
    const h = { id: 0, x: 0, z: 0, ground: 0, rim: 0.45 };
    for (const e of [0, HIDDEN_EXPOSURE / 2, HIDDEN_EXPOSURE]) {
      const hb = hitboxOf(h, e);
      expect(hb.head.y + hb.headR).toBeLessThanOrEqual(h.rim + 1e-9);
      expect(hb.torsoB.y + hb.torsoR).toBeLessThan(h.rim);
    }
    // fully ducked, the head is well down
    expect(hitboxOf(h, 0).head.y + HEAD_R).toBeLessThan(h.rim - 0.4);
    expect(HEAD_Y + HEAD_R).toBeGreaterThan(TORSO_Y1 + TORSO_R);
  });

  for (const [name, ar] of [
    ['the default field', arena],
    ['holes 6 m apart', new Arena(generateLayout(99, 16, 6, 20, false))],
  ] as const) {
    it(`no shot from a neighbour on the ground reaches them: ${name}`, () => {
      let pairs = 0;
      const hits: string[] = [];
      for (const a of ar.holes)
        for (const b of ar.holes) {
          if (a === b || Math.hypot(a.x - b.x, a.z - b.z) > 40) continue;
          pairs++;
          const eye = eyePos(a, 1);
          const pts = aimPoints(b).map((p) => norm(sub(p, eye)));
          for (const headScale of [1, 2, 4.4])
            for (const e of [0, HIDDEN_EXPOSURE * 0.5, HIDDEN_EXPOSURE]) {
              const hb = hitboxOf(b, e, headScale);
              for (const d of pts) for (const r of RADII) if (rayHitbox(eye, d, hb, r)) hits.push(`hole ${a.id} → ${b.id} e=${e.toFixed(2)} head×${headScale} r=${r}`);
            }
        }
      expect(pairs).toBeGreaterThan(30);
      expect(hits.slice(0, 5)).toEqual([]);
    }, 30_000);
  }

  it('a shot from high above (Spring Jump) still comes down through the mouth', () => {
    const b = arena.holes[0]!;
    const hb = hitboxOf(b, 0);
    const o = { x: b.x + 3, y: b.rim + HIGH_SHOT + 6, z: b.z };
    expect(rayHitbox(o, norm(sub(hb.head, o)), hb)).not.toBeNull();
    // the same line, but a projectile segment that started low (lobbed from the ground) can't
    const low = { x: b.x + 0.5, y: b.rim + 1, z: b.z };
    expect(rayHitbox(low, norm(sub(hb.head, low)), hb, 0.1, b.rim + 0.9)).toBeNull();
    expect(rayHitbox(low, norm(sub(hb.head, low)), hb, 0.1, b.rim + HIGH_SHOT + 6)).not.toBeNull();
  });
});

describe('homing rounds', () => {
  const ctx = () => ({ arena, rng: new Rng(1), events: [] as SimEvent[] });
  function aimAtMouth(m: MatchState, a: number, b: number) {
    const h = arena.holes[m.players[b]!.hole]!;
    return yawPitchOf(sub({ x: h.x, y: h.rim + 0.4, z: h.z }, playerEye(m, arena, m.players[a]!)));
  }
  function fireAt(m: MatchState, cmds: PlayerCommand[], ang: { yaw: number; pitch: number }) {
    cmds[0] = { ...cmds[0]!, yaw: ang.yaw, pitch: ang.pitch, presses: cmds[0]!.presses + 1 };
    return stepMatch(m, cmds.map((c) => c && { ...c, vt: m.tick }), arena);
  }

  it('curve down into a ducked player’s hole', () => {
    const m = makeMatch(2, { weapon: 'sniper' });
    faceOff(m);
    const cmds = liveAndStanding(m);
    cmds[1] = cmd({ stand: false });
    run(m, 30, cmds);
    // without homing: nothing
    let ev = fireAt(m, cmds, aimAtMouth(m, 0, 1));
    expect(ev.some((e) => e.k === 'dmg' && e.v === 1)).toBe(false);
    run(m, 90, cmds);
    grantPowerup(m, ctx(), m.players[0]!, 'homing');
    ev = fireAt(m, cmds, aimAtMouth(m, 0, 1));
    expect(ev.some((e) => e.k === 'dmg' && e.v === 1)).toBe(true);
    const f = ev.find((e) => e.k === 'fire');
    expect(f && f.k === 'fire' && f.v).toBeTruthy();
  });
});
