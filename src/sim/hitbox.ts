import type { V3 } from '../shared/vec';
import type { Hole } from './arena';
import { MOUTH_R } from './arena';
import { DUCK_DROP, EYE_Y, HEAD_R, HEAD_Y, HIDDEN_EXPOSURE, TORSO_R, TORSO_Y0, TORSO_Y1 } from './constants';
import { raySphere, rayCapsule } from './geom';

export interface Hitbox {
  head: V3;
  headR: number;
  torsoA: V3;
  torsoB: V3;
  torsoR: number;
  rim: number;
  /** hole centre (shots from above can come down through the mouth) */
  cx: number;
  cz: number;
}

export function drop(exposure: number): number {
  return -DUCK_DROP * (1 - exposure);
}

/** `lift`: height above the hole (Spring Jump). */
export function eyePos(hole: Hole, exposure: number, lift = 0): V3 {
  return { x: hole.x, y: hole.rim + EYE_Y + drop(exposure) + lift, z: hole.z };
}

export function hitboxOf(hole: Hole, exposure: number, headScale = 1, lift = 0): Hitbox {
  const dy = drop(exposure) + lift;
  const headR = HEAD_R * headScale;
  return {
    // big heads grow upward so they stay attached to the neck
    head: { x: hole.x, y: hole.rim + HEAD_Y + dy + (headR - HEAD_R) * 0.8, z: hole.z },
    headR,
    torsoA: { x: hole.x, y: hole.rim + TORSO_Y0 + dy, z: hole.z },
    torsoB: { x: hole.x, y: hole.rim + TORSO_Y1 + dy, z: hole.z },
    torsoR: TORSO_R,
    rim: hole.rim,
    cx: hole.x,
    cz: hole.z,
  };
}

export function isExposed(exposure: number): boolean {
  return exposure > HIDDEN_EXPOSURE;
}

/**
 * Ray vs hitbox. Hits below the rim are blocked by the stone wall — unless the ray comes down
 * from above through the open mouth (someone on a Spring Jump shooting into a hole).
 */
export function rayHitbox(o: V3, d: V3, hb: Hitbox, extraR = 0): { t: number; head: boolean } | null {
  let best: { t: number; head: boolean } | null = null;
  const ok = (t: number) => o.y + d.y * t >= hb.rim || throughMouth(o, d, hb, t);
  const th = raySphere(o, d, hb.head, hb.headR + extraR);
  if (th >= 0 && ok(th)) best = { t: th, head: true };
  const tb = rayCapsule(o, d, hb.torsoA, hb.torsoB, hb.torsoR + extraR);
  if (tb >= 0 && ok(tb) && (!best || tb < best.t)) best = { t: tb, head: false };
  return best;
}

/** Does a descending ray cross the rim's level inside the mouth before reaching distance t? */
function throughMouth(o: V3, d: V3, hb: Hitbox, t: number): boolean {
  if (d.y >= 0 || o.y <= hb.rim) return false;
  const tr = (hb.rim - o.y) / d.y;
  if (tr > t) return false;
  return Math.hypot(o.x + d.x * tr - hb.cx, o.z + d.z * tr - hb.cz) < MOUTH_R;
}
