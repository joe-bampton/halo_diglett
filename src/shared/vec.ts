export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const clone = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const addScaled = (a: V3, b: V3, s: number): V3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2D = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function norm(a: V3): V3 {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

export function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/**
 * Aim convention (matches three.js camera): yaw 0 looks toward -Z, positive yaw turns left
 * (counter-clockwise seen from above), positive pitch looks up.
 */
export function dirFromYawPitch(yaw: number, pitch: number): V3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export function yawPitchOf(dir: V3): { yaw: number; pitch: number } {
  const h = Math.hypot(dir.x, dir.z);
  return { yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.atan2(dir.y, h) };
}

/** Smallest signed difference a-b wrapped to (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function wrapAngle(a: number): number {
  return angleDiff(a, 0);
}

/** Angle in radians between two unit vectors. */
export function angleBetween(a: V3, b: V3): number {
  return Math.acos(clamp(dot(a, b), -1, 1));
}

/** Rotate unit vector `d` by random cone of half-angle `rad` using two random numbers in [0,1). */
export function spreadDir(d: V3, rad: number, r1: number, r2: number): V3 {
  if (rad <= 0) return d;
  const up = Math.abs(d.y) < 0.99 ? v3(0, 1, 0) : v3(1, 0, 0);
  const right = norm(cross(d, up));
  const up2 = cross(right, d);
  const ang = Math.sqrt(r1) * rad;
  const phi = r2 * Math.PI * 2;
  const s = Math.sin(ang);
  return norm({
    x: d.x * Math.cos(ang) + (right.x * Math.cos(phi) + up2.x * Math.sin(phi)) * s,
    y: d.y * Math.cos(ang) + (right.y * Math.cos(phi) + up2.y * Math.sin(phi)) * s,
    z: d.z * Math.cos(ang) + (right.z * Math.cos(phi) + up2.z * Math.sin(phi)) * s,
  });
}
