import { describe, expect, it } from 'vitest';
import { ARENA_SEED, Arena, HOLE_SPACING, PLAY_RADIUS, generateLayout, layoutForSettings } from '../../src/sim/arena';
import { createMatch } from '../../src/sim/match';
import { orbPos } from '../../src/sim/orbs';
import { sanitizeSettings } from '../../src/sim/settings';
import { roster } from './helpers';

const minDist = (a: Arena) => {
  let d = Infinity;
  for (const h of a.holes) for (const o of a.holes) if (h !== o) d = Math.min(d, Math.hypot(h.x - o.x, h.z - o.z));
  return d;
};

describe('hole layouts', () => {
  it('Auto + default spacing is exactly the classic field', () => {
    const classic = new Arena(ARENA_SEED);
    for (const players of [1, 7, 13]) {
      const a = new Arena(layoutForSettings({ holeCount: 0, holeSpacing: HOLE_SPACING }, players));
      expect(a.holes).toEqual(classic.holes);
      expect(a.fenceRadius).toBe(52);
      expect(a.scale).toBe(1);
      expect(a.activeHoleCount(players)).toBe(classic.activeHoleCount(players));
    }
  });

  for (const [count, spacing] of [
    [4, 11.5],
    [8, 6],
    [12, 25],
    [20, 20],
    [32, 11.5],
  ] as const) {
    it(`${count} holes at least ${spacing} m apart`, () => {
      const L = layoutForSettings({ holeCount: count, holeSpacing: spacing }, 3);
      const a = new Arena(L);
      expect(a.holes.length).toBe(count);
      expect(L.spacing).toBe(spacing);
      expect(minDist(a)).toBeGreaterThanOrEqual(spacing - 1e-9);
      for (const h of a.holes) expect(Math.hypot(h.x, h.z)).toBeLessThanOrEqual(L.radius + 1e-9);
      expect(a.fenceRadius).toBe(L.radius + 12);
      // a custom field puts every hole in play
      expect(a.activeHoleCount(3)).toBe(count);
    });
  }

  it('never has fewer holes than players', () => {
    const L = layoutForSettings({ holeCount: 4, holeSpacing: 10 }, 9);
    expect(L.holes.length).toBe(9);
    const m = createMatch(sanitizeSettings({ holeCount: 4, holeSpacing: 10 }), roster(9), 5, new Arena(L));
    const holes = m.players.filter(Boolean).map((p) => p!.hole);
    expect(new Set(holes).size).toBe(9);
  });

  it('shrinks the spacing a little when the field would get too big', () => {
    const L = layoutForSettings({ holeCount: 32, holeSpacing: 40 }, 2);
    expect(L.holes.length).toBe(32);
    expect(L.spacing).toBeLessThanOrEqual(40);
    expect(minDist(new Arena(L))).toBeGreaterThanOrEqual(L.spacing - 1e-9);
  });

  it('is deterministic and survives the network (JSON) unchanged', () => {
    const a = generateLayout(1234, 12, 18, 60, false);
    expect(generateLayout(1234, 12, 18, 60, false)).toEqual(a);
    const net = JSON.parse(JSON.stringify(a));
    const A = new Arena(a), B = new Arena(net);
    expect(B.holes).toEqual(A.holes);
    for (const [x, z] of [[3, 7], [20, -11], [-35, 40]] as const) expect(B.solidAt(x, z)).toBe(A.solidAt(x, z));
  });

  it('keeps orb paths unchanged on the classic field and widens them on big fields', () => {
    const orb = { seed: 777, spawn: 0 };
    const classic = new Arena();
    const p = orbPos(orb, 600, classic);
    // classic field: the original formula (scale 1)
    expect(classic.scale).toBe(1);
    const big = new Arena(generateLayout(5, 10, 30, PLAY_RADIUS * 2, false));
    const q = orbPos(orb, 600, big);
    expect(Math.hypot(q.x, q.z)).toBeGreaterThan(Math.hypot(p.x, p.z) * 1.5);
  });
});
