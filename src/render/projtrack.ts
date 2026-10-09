import type { V3 } from '../shared/vec';
import { MOUTH_R, type Arena } from '../sim/arena';
import { TICK_RATE, secToTicks } from '../sim/constants';
import { bounceOffTerrain, integrateProjectile } from '../sim/match';
import type { Projectile } from '../sim/types';
import type { ProjectileDef } from '../sim/weapons';

/**
 * A projectile as the client draws it: flown one host tick at a time with the host's own physics (gravity, homing
 * hand-off, bounces), so it moves at the same speed at any frame rate and lands where the host's does.
 */
export interface ProjTrack {
  /** state at the end of `tick` */
  pr: Projectile;
  tick: number;
  /** position at the end of the tick before (drawn in between) */
  px: number;
  py: number;
  pz: number;
  /** stuck in the ground / in a player / at the bottom of a hole: waits there for the host to end it */
  stopped: boolean;
}

/** `pr` as fired (its spawn point) on host tick `born`: the first step brings it to where the host has it after that tick. */
export function newTrack(pr: Projectile, born: number): ProjTrack {
  return { pr: { ...pr }, tick: born - 1, px: pr.x, py: pr.y, pz: pr.z, stopped: false };
}

/**
 * Distance along the segment (o + d·t, t ≤ L) to the nearest thing a projectile of radius `r` would stop on other
 * than the terrain (players, power-up orbs) at host tick `tick`, or Infinity.
 */
export type TargetTest = (o: V3, d: V3, L: number, tick: number, r: number) => number;

/** 'hit': stopped on a target; 'end': stopped by the ground (or its fuse there); 'expire': ran out in the air */
export type StepResult = 'fly' | 'hit' | 'end' | 'expire';

/**
 * One host tick of flight, in the same order the host checks things (targets, then the hole mouth, then the ground).
 * `homing`: the host-reported position of a homing projectile, which the view eases towards instead of guessing.
 * Returns 'hit' when it stopped on a target, 'end' when the ground (or the bottom of a hole) stopped it, 'expire' when
 * it ran out (life, fuse) in the air; a stopped track keeps returning 'fly' and stays put.
 */
export function stepTrack(t: ProjTrack, def: ProjectileDef, arena: Arena, homing: V3 | null, targets: TargetTest | null): StepResult {
  const pr = t.pr;
  t.tick++;
  t.px = pr.x;
  t.py = pr.y;
  t.pz = pr.z;
  if (t.stopped) return 'fly';
  if (homing) {
    pr.x += (homing.x - pr.x) * 0.35;
    pr.y += (homing.y - pr.y) * 0.35;
    pr.z += (homing.z - pr.z) * 0.35;
    return 'fly';
  }
  const ox = pr.x, oy = pr.y, oz = pr.z;
  integrateProjectile(pr, def, null);
  const sx = pr.x - ox, sy = pr.y - oy, sz = pr.z - oz;
  const L = Math.hypot(sx, sy, sz) || 1e-9;
  const o = { x: ox, y: oy, z: oz };
  const d = { x: sx / L, y: sy / L, z: sz / L };
  let best = L;
  const tt = targets ? targets(o, d, L, t.tick, def.radius) : Infinity;
  const onTarget = tt < best;
  if (onTarget) best = tt;
  const tw = arena.raycast(o, d, best);
  const hitWorld = tw < best;
  if (hitWorld) best = tw;
  const at = { x: ox + d.x * best, y: oy + d.y * best, z: oz + d.z * best };
  if (onTarget && !hitWorld) {
    stopAt(t, at);
    return 'hit';
  }
  const hole = arena.nearestHole(at.x, at.z);
  if (def.bounce && hole && Math.hypot(hole.x - at.x, hole.z - at.z) < MOUTH_R && at.y < hole.rim) {
    // dropped into someone's hole: it goes off at the bottom
    stopAt(t, { x: hole.x, y: hole.ground - 1.2, z: hole.z });
    return 'end';
  }
  const fused = pr.fuseAt > 0 && t.tick >= pr.fuseAt;
  if (hitWorld) {
    if (def.bounce && pr.bounces < def.bounce.max && !fused) {
      bounceOffTerrain(pr, arena, at, def.bounce.restitution);
      return 'fly';
    }
    stopAt(t, at);
    return 'end';
  }
  if (t.tick - pr.born >= secToTicks(def.life) || fused || pr.y < -20) {
    t.stopped = true;
    return 'expire';
  }
  return 'fly';
}

function stopAt(t: ProjTrack, at: V3) {
  const pr = t.pr;
  pr.x = at.x;
  pr.y = at.y;
  pr.z = at.z;
  pr.vx = pr.vy = pr.vz = 0;
  t.stopped = true;
}

/** Where to draw it at (fractional) host tick `now`: between the last two ticks it has flown. */
export function trackPos(t: ProjTrack, now: number, out: V3): V3 {
  const a = Math.min(1, Math.max(0, now - t.tick));
  out.x = t.px + (t.pr.x - t.px) * a;
  out.y = t.py + (t.pr.y - t.py) * a;
  out.z = t.pz + (t.pr.z - t.pz) * a;
  return out;
}

/** Most ticks a view catches up in one frame (more means it fell far behind, e.g. a hidden tab). */
export const MAX_CATCHUP = Math.round(0.5 * TICK_RATE);
