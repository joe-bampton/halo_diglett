import type { V3 } from '../shared/vec';

/** Ray (unit dir) vs sphere. Returns distance along ray or -1. Origin inside sphere returns 0. */
export function raySphere(o: V3, d: V3, c: V3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc <= 0) return 0;
  const h = b * b - cc;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}

/** Ray (unit dir) vs capsule with axis pa→pb and radius r. Returns distance or -1. */
export function rayCapsule(o: V3, d: V3, pa: V3, pb: V3, r: number): number {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
  const oax = o.x - pa.x, oay = o.y - pa.y, oaz = o.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * d.x + bay * d.y + baz * d.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = d.x * oax + d.y * oay + d.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  if (a > 1e-9) {
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - r * r * baba;
    const h = b * b - a * c;
    if (h < 0) return -1;
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
  }
  // caps
  const t1 = raySphere(o, d, pa, r);
  const t2 = raySphere(o, d, pb, r);
  if (t1 < 0) return t2;
  if (t2 < 0) return t1;
  return Math.min(t1, t2);
}

/** Closest distance from point p to segment a-b. */
export function pointSegmentDist(p: V3, a: V3, b: V3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 0 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
}
