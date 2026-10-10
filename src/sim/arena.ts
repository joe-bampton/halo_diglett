import { Rng, hash01 } from '../shared/rng';
import type { V3 } from '../shared/vec';
import { EYE_Y, HEAD_Y } from './constants';

/** Geometry constants (metres). Y is up. */
export const PLAY_RADIUS = 40;
export const FENCE_RADIUS = 52;
export const MOUTH_R = 0.9; // open well radius
export const RIM_OUT = 1.9; // outer radius of the stacked-stone rim
export const RIM_H = 0.45; // rim height above local ground
export const WELL_DEPTH = 2.6; // well bottom below local ground (room for a fully ducked Spartan)
export const FLAT_R = 3.2; // terrain flattened around each hole
export const HOLE_COUNT = 16;
export const HOLE_SPACING = 11.5;
/** Chosen by scripts/findSeed (all holes see >= 70% of the others). Locked by a unit test. */
export const ARENA_SEED = 20261007;
/** Biggest field a custom hole count / spacing may grow to. */
export const MAX_PLAY_RADIUS = 150;

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

/**
 * Everything needed to rebuild an arena exactly. The host generates it and sends it in MatchStart,
 * so every browser gets the same holes even if their floating-point maths differs in the last bit.
 */
export interface ArenaLayout {
  seed: number;
  /** radius the holes are scattered in */
  radius: number;
  /** minimum distance between holes that was achieved */
  spacing: number;
  /** auto: the classic field — a match only uses the most central players + 3 holes */
  auto: boolean;
  hills: Hill[];
  /** [x, z, ground] — most central first */
  holes: [number, number, number][];
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Rolling hills + a bowl that rises beyond `bowl`. No hole features. */
function baseHeightOf(hills: readonly Hill[], bowl: number, x: number, z: number): number {
  let y = 0;
  for (const h of hills) {
    const dx = x - h.x, dz = z - h.z;
    y += h.h * Math.exp(-(dx * dx + dz * dz) / (2 * h.s * h.s));
  }
  const r = Math.hypot(x, z);
  if (r > bowl) {
    const t = (r - bowl) / 50;
    y += Math.min(t * t * 22, 30) + Math.sin(x * 0.07) * Math.cos(z * 0.06) * Math.min(1, t) * 4;
  }
  return y;
}

/**
 * Scatter `count` holes at least `spacing` apart within `radius` (Poisson-disk-ish), avoiding slopes.
 * With the defaults this reproduces the classic arena exactly (same random sequence).
 */
export function generateLayout(seed = ARENA_SEED, count = HOLE_COUNT, spacing = HOLE_SPACING, radius = PLAY_RADIUS, auto = true): ArenaLayout {
  const rng = new Rng(seed);
  const k = radius / PLAY_RADIUS;
  const hills: Hill[] = [];
  const hillCount = Math.min(14, Math.max(3, Math.round(6 * k * k)));
  for (let i = 0; i < hillCount; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(8 * k, 36 * k);
    hills.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, h: rng.range(0.6, 2.4), s: rng.range(6, 11) * Math.max(1, Math.sqrt(k)) });
  }
  const bowl = radius + 6;
  const holes: [number, number, number][] = [];
  let guard = 0;
  while (holes.length < count && guard++ < 20000) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * radius;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (holes.some(([hx, hz]) => Math.hypot(hx - x, hz - z) < spacing)) continue;
    const g = baseHeightOf(hills, bowl, x, z);
    const slope = Math.hypot(baseHeightOf(hills, bowl, x + 1, z) - g, baseHeightOf(hills, bowl, x, z + 1) - g);
    if (slope > 0.35) continue;
    holes.push([x, z, g]);
  }
  // sort by distance from centre so "active holes" are the most central ones
  holes.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  return { seed, radius, spacing, auto, hills, holes };
}

/** How many holes each hole can see (eye → head lines not blocked by hills). */
export function visibilityStats(a: Arena) {
  const hs = a.holes;
  let worst = 1;
  let total = 0;
  let pairs = 0;
  for (const h of hs) {
    let seen = 0;
    for (const o of hs) {
      if (o === h) continue;
      const clear = a.lineClear({ x: h.x, y: h.rim + EYE_Y, z: h.z }, { x: o.x, y: o.rim + HEAD_Y, z: o.z }, 0.5);
      if (clear) seen++;
      pairs++;
      total += clear ? 1 : 0;
    }
    worst = Math.min(worst, seen / Math.max(1, hs.length - 1));
  }
  return { worst, avg: total / Math.max(1, pairs), count: hs.length };
}

const layoutCache = new Map<string, ArenaLayout>();
let defaultLayout: ArenaLayout | null = null;

/**
 * The field for a match: `holeCount` 0 = Auto (the classic 16 holes, a match uses the central players + 3);
 * otherwise exactly max(holeCount, players) holes, all in play. `holeSpacing` is the minimum distance between
 * holes; the field grows to fit (and, past MAX_PLAY_RADIUS, the spacing shrinks a little). Deterministic and
 * memoised, but only the host needs to call it — clients get the result in MatchStart.
 */
export function layoutForSettings(s: { holeCount: number; holeSpacing: number }, players: number): ArenaLayout {
  const auto = s.holeCount <= 0;
  if (auto && s.holeSpacing === HOLE_SPACING) return (defaultLayout ??= generateLayout());
  const count = auto ? HOLE_COUNT : Math.max(4, s.holeCount, players);
  const key = `${count}|${s.holeSpacing}|${auto}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  let spacing = s.holeSpacing;
  // a random scatter covers roughly 27% of the disc with spacing-sized circles
  let radius = Math.min(MAX_PLAY_RADIUS, Math.max(10, Math.ceil((spacing / 2) * Math.sqrt(count / 0.27) - spacing / 2)));
  let best: { layout: ArenaLayout; worst: number } | null = null;
  for (let attempt = 0; attempt < 24 && !best; attempt++) {
    for (let i = 0; i < 8; i++) {
      const seed = 1 + Math.floor(hash01(count * 7919 + Math.round(spacing * 10), attempt * 31 + i, 4242) * 2 ** 30);
      const layout = generateLayout(seed, count, spacing, radius, auto);
      if (layout.holes.length < count) continue;
      const worst = visibilityStats(new Arena(layout)).worst;
      if (!best || worst > best.worst) best = { layout, worst };
      if (worst >= 0.7) break;
    }
    if (best) break;
    if (radius < MAX_PLAY_RADIUS) radius = Math.min(MAX_PLAY_RADIUS, Math.ceil(radius * 1.1));
    else spacing = Math.max(1, Math.floor(spacing * 0.95 * 2) / 2);
  }
  const layout = best?.layout ?? generateLayout(ARENA_SEED);
  layoutCache.set(key, layout);
  return layout;
}

/**
 * A ray that starts inside a hole's well (under the rim, within the mouth): how far it goes before the stone wall stops
 * it, or Infinity when it gets out through the mouth (or doesn't start in there). Arena.raycast can't be trusted with
 * this: from down in a well its first step is long enough to jump the wall.
 */
export function wellWall(o: V3, d: V3, hole: Hole): number {
  const rx = o.x - hole.x, rz = o.z - hole.z;
  const c = rx * rx + rz * rz - MOUTH_R * MOUTH_R;
  if (o.y >= hole.rim || c >= 0) return Infinity;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return Infinity; // straight up and out (straight down: the floor, which raycast finds)
  const b = 2 * (rx * d.x + rz * d.z);
  // where the ray's footprint leaves the mouth (c < 0: one root ahead, one behind)
  const t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return o.y + d.y * t < hole.rim ? t : Infinity;
}

export class Arena {
  readonly seed: number;
  readonly layout: ArenaLayout;
  readonly hills: Hill[];
  readonly holes: Hole[];
  /** holes are scattered within this radius; the fence and the rising bowl sit outside it */
  readonly playRadius: number;
  readonly fenceRadius: number;
  readonly bowlRadius: number;
  /** field size relative to the classic arena (1 = classic) */
  readonly scale: number;
  readonly auto: boolean;
  private grid = new Map<number, number[]>();
  private static readonly CELL = 6;

  constructor(src: number | ArenaLayout = ARENA_SEED) {
    const layout = typeof src === 'number' ? generateLayout(src) : src;
    this.layout = layout;
    this.seed = layout.seed;
    this.hills = layout.hills.map((h) => ({ ...h }));
    this.holes = layout.holes.map(([x, z, g], id) => ({ id, x, z, ground: g, rim: g + RIM_H }));
    this.playRadius = layout.radius;
    this.fenceRadius = layout.radius + (FENCE_RADIUS - PLAY_RADIUS);
    this.bowlRadius = layout.radius + 6;
    this.scale = layout.radius / PLAY_RADIUS;
    this.auto = layout.auto;
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
    return baseHeightOf(this.hills, this.bowlRadius, x, z);
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

  /** The hole nearest (x, z), however far away (nearestHole only looks close by). */
  closestHole(x: number, z: number): Hole {
    let best = this.holes[0]!;
    let bd = Infinity;
    for (const h of this.holes) {
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
    if (!this.auto) return this.holes.length;
    return Math.max(6, Math.min(this.holes.length, players + 3));
  }
}
