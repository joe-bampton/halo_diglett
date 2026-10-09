import { describe, expect, it } from 'vitest';
import { MAX_CATCHUP, newTrack, stepTrack, trackPos, type ProjTrack } from '../../src/render/projtrack';
import { TICK_RATE, secToTicks } from '../../src/sim/constants';
import { stepMatch } from '../../src/sim/match';
import type { Projectile, SimEvent } from '../../src/sim/types';
import { WEAPONS, type WeaponId } from '../../src/sim/weapons';
import { dirFromYawPitch } from '../../src/shared/vec';
import { arena, makeMatch } from './helpers';

function shot(weapon: WeaponId, yaw: number, pitch: number, born: number, from = { x: 0, y: 3, z: 0 }): Projectile {
  const def = WEAPONS[weapon].projectile!;
  const d = dirFromYawPitch(yaw, pitch);
  return {
    id: 999, owner: 0, weapon, x: from.x, y: from.y, z: from.z,
    vx: d.x * def.speed, vy: d.y * def.speed, vz: d.z * def.speed,
    born, bounces: 0, target: -1, fuseAt: def.fuse ? born + secToTicks(def.fuse) : 0,
  };
}

describe('client projectile tracks', () => {
  for (const [weapon, yaw, pitch] of [
    ['grenade', 0.3, 0.12],
    ['grenade', 2.1, -0.05],
    ['grenade', -1.2, 0.2],
    ['grenade', 1.0, 0.6],
    ['rpg', 0.9, -0.08],
    ['crossbow', -2.4, 0.05],
  ] as [WeaponId, number, number][]) {
    it(`fly and bounce exactly like the host's (${weapon}, yaw ${yaw}, pitch ${pitch})`, () => {
      // nobody on the field: only the terrain, the holes and the fuse decide where it ends
      const m = makeMatch(0);
      const pr = shot(weapon, yaw, pitch, m.tick + 1);
      m.projectiles.push({ ...pr });
      const tr = newTrack(pr, pr.born);
      const def = WEAPONS[weapon].projectile!;
      let bounced = 0;
      for (let i = 0; i < secToTicks(def.life) + 5; i++) {
        const ev: SimEvent[] = stepMatch(m, [], arena);
        const r = stepTrack(tr, def, arena, null, null);
        expect(tr.tick).toBe(m.tick);
        const host = m.projectiles.find((p) => p.id === pr.id);
        const end = ev.find((e) => e.k === 'pend');
        if (!host) {
          // the host ended it this tick: so does the track, in the same place
          expect(end).toBeTruthy();
          expect(r).toBe('end');
          if (end?.k === 'pend') {
            expect(tr.pr.x).toBeCloseTo(end.pos[0], 1);
            expect(tr.pr.y).toBeCloseTo(end.pos[1], 1);
            expect(tr.pr.z).toBeCloseTo(end.pos[2], 1);
          }
          break;
        }
        expect(r).toBe('fly');
        bounced = host.bounces;
        expect(tr.pr.bounces).toBe(host.bounces);
        expect(tr.pr.x).toBeCloseTo(host.x, 9);
        expect(tr.pr.y).toBeCloseTo(host.y, 9);
        expect(tr.pr.z).toBeCloseTo(host.z, 9);
      }
      // the flat lobs land before the 1.8 s fuse and bounce at least once
      if (weapon === 'grenade' && pitch > 0 && pitch < 0.3) expect(bounced).toBeGreaterThan(0);
    });
  }

  it('moves at the same speed at 30, 60 and 144 frames per second', () => {
    const def = WEAPONS.grenade.projectile!;
    const fly = (fps: number) => {
      const tr: ProjTrack = newTrack(shot('grenade', 0.3, 0.35, 100), 100);
      let now = 100;
      const seen: Record<number, { x: number; y: number; z: number }> = {};
      for (let f = 0; f < fps * 1.2; f++) {
        now += TICK_RATE / fps;
        for (let n = 0; tr.tick + 1 <= now && n < MAX_CATCHUP; n++) stepTrack(tr, def, arena, null, null);
        seen[tr.tick] = { ...tr.pr };
      }
      return { tr, now, seen };
    };
    const a = fly(30), b = fly(60), c = fly(144);
    // the same host tick is the same place, whatever the frame rate
    for (const tick of [110, 130, 150, 170]) {
      const ref = b.seen[tick];
      for (const other of [a.seen[tick], c.seen[tick]]) {
        if (!ref || !other) continue;
        expect(other.x).toBeCloseTo(ref.x, 9);
        expect(other.y).toBeCloseTo(ref.y, 9);
        expect(other.z).toBeCloseTo(ref.z, 9);
      }
    }
    // after 1.2 s every one of them has flown 72 ticks
    for (const r of [a, b, c]) expect(Math.floor(r.now) - r.tr.tick).toBeLessThanOrEqual(1);
  });

  it('draws between the last two ticks', () => {
    const def = WEAPONS.rpg.projectile!;
    const tr = newTrack(shot('rpg', 0, 0, 10), 10);
    stepTrack(tr, def, arena, null, null);
    stepTrack(tr, def, arena, null, null);
    const mid = trackPos(tr, tr.tick + 0.5, { x: 0, y: 0, z: 0 });
    expect(mid.z).toBeCloseTo((tr.pz + tr.pr.z) / 2, 9);
  });

  it('stops on a target in its way', () => {
    const def = WEAPONS.crossbow.projectile!;
    const tr = newTrack(shot('crossbow', 0, 0, 10), 10);
    // something 1 m in front of the muzzle (a bolt covers ~1.8 m a tick)
    const r = stepTrack(tr, def, arena, null, (o, _d, L) => (L > 1 - Math.abs(o.z) ? 1 - Math.abs(o.z) : Infinity));
    expect(r).toBe('hit');
    expect(tr.stopped).toBe(true);
    expect(tr.pr.z).toBeCloseTo(-1, 4);
    // and stays put while it waits for the host
    expect(stepTrack(tr, def, arena, null, null)).toBe('fly');
    expect(tr.pr.z).toBeCloseTo(-1, 4);
  });
});
