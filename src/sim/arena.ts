import { Rng } from '../shared/rng';
import type { V3 } from '../shared/vec';

/** Geometry constants (metres). Y is up. */
export const PLAY_RADIUS = 40;
export const FENCE_RADIUS = 52;
export const MOUTH_R = 0.9; // open well radius
export const RIM_OUT = 1.9; // outer radius of the stacked-stone rim
export const RIM_H = 0.45; // rim height above local ground
export const WELL_DEPTH = 2.4; // well bottom below local ground
export const FLAT_R = 3.2; // terrain flattened around each hole
export const HOLE_COUNT = 16;
export const HOLE_SPACING = 11.5;
/** Chosen by scripts/findSeed (all holes see >= 70% of the others). Locked by a unit test. */
export const ARENA_SEED = 20261007;

export interface Hole {
  id: number;
  x: number;
  z: number;
  /** local ground height at the hole */
  ground: number;
  /** top of the stone rim */
  rim: number;
}

interface Hill {
  x: number;
  z: number;
  h: number;
  s: number;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class Arena {
  readonly seed: number;
  readonly hills: Hill[] = [];
  readonly holes: Hole[] = [];
  private grid = new Map<number, number[]>();
  private static readonly CELL = 6;

  constructor(seed = ARENA_SEED) {
    this.seed = seed;
    const rng = new Rng(seed);
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(8, 36);
      this.hills.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, h: rng.range(0.6, 2.4), s: rng.range(6, 11) });
    }
    // Poisson-disk-ish sampling of hole positions
    let guard = 0;
    while (this.holes.length < HOLE_COUNT && guard++ < 20000) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * PLAY_RADIUS;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (this.holes.some((h) => Math.hypot(h.x - x, h.z - z) < HOLE_SPACING)) continue;
      const g = this.baseHeight(x, z);
      const slope = Math.hypot(this.baseHeight(x + 1, z) - g, this.baseHeight(x, z + 1) - g);
      if (slope > 0.35) continue;
      this.holes.push({ id: this.holes.length, x, z, ground: g, rim: g + RIM_H });
    }
    // sort by distance from centre so "active holes" are the most central ones
    this.holes.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    this.holes.forEach((h, i) => (h.id = i));
    for (const h of this.holes) {
      const key = this.cellKey(Math.floor(h.x / Arena.CELL), Math.floor(h.z / Arena.CELL));
      // register in all neighbouring cells so a lookup only needs its own cell
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const k = key + dx * 1000 + dz;
          const arr = this.grid.get(k);
          if (arr) arr.push(h.id);
          else this.grid.set(k, [h.id]);
        }
    }
  }

  private cellKey(cx: number, cz: number) {
    return cx * 1000 + cz;
  }

  /** Rolling hills + a bowl that rises beyond the fence. No hole features. */
  baseHeight(x: number, z: number): number {
    let y = 0;
    for (const h of this.hills) {
      const dx = x - h.x, dz = z - h.z;
      y += h.h * Math.exp(-(dx * dx + dz * dz) / (2 * h.s * h.s));
    }
    const r = Math.hypot(x, z);
    if (r > 46) {
      const t = (r - 46) / 50;
      y += Math.min(t * t * 22, 30) + Math.sin(x * 0.07) * Math.cos(z * 0.06) * Math.min(1, t) * 4;
    }
    return y;
  }

  nearestHole(x: number, z: number): Hole | undefined {
    const ids = this.grid.get(this.cellKey(Math.floor(x / Arena.CELL), Math.floor(z / Arena.CELL)));
    if (!ids) return undefined;
    let best: Hole | undefined;
    let bd = Infinity;
    for (const id of ids) {
      const h = this.holes[id]!;
      const d = (h.x - x) ** 2 + (h.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  /** Visible ground surface (flattened around holes). */
  groundAt(x: number, z: number): number {
    const b = this.baseHeight(x, z);
    const h = this.nearestHole(x, z);
    if (!h) return b;
    const d = Math.hypot(h.x - x, h.z - z);
    if (d >= FLAT_R) return b;
    const w = smooth((FLAT_R - d) / (FLAT_R - RIM_OUT));
    return b + (h.ground - b) * w;
  }

  /** Collision height: ground + stone rims, open wells. */
  solidAt(x: number, z: number): number {
    const h = this.nearestHole(x, z);
    if (h) {
      const d = Math.hypot(h.x - x, h.z - z);
      if (d < MOUTH_R) return h.ground - WELL_DEPTH;
      if (d < RIM_OUT) return h.rim;
    }
    return this.groundAt(x, z);
  }

  /** March a ray against the solid terrain. Returns hit distance or Infinity. */
  raycast(o: V3, d: V3, maxDist: number): number {
    let t = 0;
    let prevT = 0;
    while (t < maxDist) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const gap = y - this.solidAt(x, z);
      if (gap < 0) {
        // bisection refine
        let lo = prevT, hi = t;
        for (let i = 0; i < 8; i++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m - this.solidAt(o.x + d.x * m, o.z + d.z * m) < 0) hi = m;
          else lo = m;
        }
        return hi;
      }
      // above everything and climbing: nothing more to hit
      if (y > 45 && d.y >= 0) return Infinity;
      prevT = t;
      t += gap < 1.2 ? 0.3 : Math.min(2.5, (gap - 0.5) * 1.2);
    }
    return Infinity;
  }

  /** Is there a clear line from a to b (ignoring the last `slack` metres)? */
  lineClear(a: V3, b: V3, slack = 0.3): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return true;
    const d = { x: dx / L, y: dy / L, z: dz / L };
    return this.raycast(a, d, L - slack) === Infinity;
  }

  /** Hole ids used for a match of `players` participants (most central first). */
  activeHoleCount(players: number): number {
    return Math.max(6, Math.min(this.holes.length, players + 3));
  }
}
