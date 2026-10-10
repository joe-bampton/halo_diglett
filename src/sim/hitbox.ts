import type { V3 } from '../shared/vec';
import type { Hole } from './arena';
import { MOUTH_R } from './arena';
import { DUCK_DROP, EYE_Y, HEAD_R, HEAD_Y, HIDDEN_EXPOSURE, TORSO_R, TORSO_Y0, TORSO_Y1 } from './constants';
import { raySphere, rayCapsule } from './geom';
import type { Seat } from './seats';

const MIDDLE: Seat = { x: 0, z: 0 };

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

/** `lift`: height above the hole (Spring Jump). `seat`: where in the hole they stand (sharing it: see seats.ts). */
export function eyePos(hole: Hole, exposure: number, lift = 0, seat: Seat = MIDDLE): V3 {
  return { x: hole.x + seat.x, y: hole.rim + EYE_Y + drop(exposure) + lift, z: hole.z + seat.z };
}

/**
 * How far a big head's centre moves (relative to a normal head's) at this exposure. Standing, big heads grow upward so
 * they stay attached to the neck; hidden, they sink by their extra radius so the top stays as far under the rim as a
 * normal head's.
 */
export function bigHeadShift(extraR: number, exposure: number): number {
  const k = Math.max(0, exposure - HIDDEN_EXPOSURE) / (1 - HIDDEN_EXPOSURE);
  return extraR * (1.8 * k - 1);
}

/** The mouth stays where it is (`cx/cz`); a body sharing the hole stands off to one side of it (`seat`). */
export function hitboxOf(hole: Hole, exposure: number, headScale = 1, lift = 0, seat: Seat = MIDDLE): Hitbox {
  const dy = drop(exposure) + lift;
  const headR = HEAD_R * headScale;
  const x = hole.x + seat.x, z = hole.z + seat.z;
  return {
    head: { x, y: hole.rim + HEAD_Y + dy + bigHeadShift(headR - HEAD_R, exposure), z },
    headR,
    torsoA: { x, y: hole.rim + TORSO_Y0 + dy, z },
    torsoB: { x, y: hole.rim + TORSO_Y1 + dy, z },
    torsoR: TORSO_R,
    rim: hole.rim,
    cx: hole.x,
    cz: hole.z,
  };
}

export function isExposed(exposure: number): boolean {
  return exposure > HIDDEN_EXPOSURE;
}

/** Only shots from this high above a hole's rim (a Spring Jump) can come down through its mouth. */
export const HIGH_SHOT = 4;

/**
 * Ray vs hitbox. Hits below the rim are blocked by the stone wall — unless the ray comes down
 * from high above through the open mouth (someone on a Spring Jump shooting into a hole).
 * `extraR` (a projectile's radius) only widens the parts that stick out above the rim. `from`: the height the shot was
 * fired from (a projectile's segment starts lower down its flight). `inside`: the shot comes from someone squeezed
 * into the same hole — no wall between them, ducked or not.
 */
export function rayHitbox(o: V3, d: V3, hb: Hitbox, extraR = 0, from = o.y, inside = false): { t: number; head: boolean } | null {
  let best: { t: number; head: boolean } | null = null;
  // (a part whose top is level with the rim counts as hidden)
  const above = (top: number) => top > hb.rim + 1e-6;
  const ok = (t: number, top: number) => inside || (above(top) && o.y + d.y * t >= hb.rim) || throughMouth(o, d, hb, t, from);
  const headTop = hb.head.y + hb.headR;
  const th = raySphere(o, d, hb.head, hb.headR + (above(headTop) ? extraR : 0));
  if (th >= 0 && ok(th, headTop)) best = { t: th, head: true };
  const torsoTop = hb.torsoB.y + hb.torsoR;
  const tb = rayCapsule(o, d, hb.torsoA, hb.torsoB, hb.torsoR + (above(torsoTop) ? extraR : 0));
  if (tb >= 0 && ok(tb, torsoTop) && (!best || tb < best.t)) best = { t: tb, head: false };
  return best;
}

/** Does a ray from high above come down across the rim's level inside the mouth before reaching distance t? */
function throughMouth(o: V3, d: V3, hb: Hitbox, t: number, from: number): boolean {
  if (d.y >= 0 || o.y <= hb.rim || from < hb.rim + HIGH_SHOT) return false;
  const tr = (hb.rim - o.y) / d.y;
  if (tr > t) return false;
  return Math.hypot(o.x + d.x * tr - hb.cx, o.z + d.z * tr - hb.cz) < MOUTH_R;
}
