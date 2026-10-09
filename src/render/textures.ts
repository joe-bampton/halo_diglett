import * as THREE from 'three';
import { SHARED } from './models';

/**
 * High / Ultra surface textures, painted in code at the start of the first match that wants them (no image files to
 * download): tileable grass and rock, each a colour map plus a normal map for relief. The colour maps are near-neutral
 * so the terrain's and stones' own colours still show through (they are multiplied together).
 */
export interface SurfaceMaps {
  map: THREE.Texture;
  normal: THREE.Texture;
}

const SIZE = 512;

/** Tileable value noise: lattice cells wrap every `period` cells. */
function noise2(seed: number) {
  const hash = (x: number, y: number) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  return (x: number, y: number, period: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const w = (v: number) => ((v % period) + period) % period;
    const a = hash(w(x0), w(y0)), b = hash(w(x0 + 1), w(y0)), c = hash(w(x0), w(y0 + 1)), d = hash(w(x0 + 1), w(y0 + 1));
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Fractal noise over the whole tile (u, v in 0..1), `base` cells across at the first octave. */
function fbm(n: ReturnType<typeof noise2>, u: number, v: number, base: number, octaves: number): number {
  let sum = 0, amp = 0.5, norm = 0, period = base;
  for (let o = 0; o < octaves; o++) {
    sum += n(u * period, v * period, period) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/** A normal map from a height field (wrapping at the edges so it tiles). */
function normalFromHeight(h: Float32Array, strength: number): Uint8Array {
  const out = new Uint8Array(SIZE * SIZE * 4);
  const at = (x: number, y: number) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)]!;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * SIZE + x) * 4;
      out[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      out[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      out[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  return out;
}

function texture(data: Uint8Array, srgb: boolean): THREE.Texture {
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  SHARED.add(t);
  return t;
}

/** Short blades scattered over a soft mottled base. */
function paintGrass(): SurfaceMaps {
  const n = noise2(11);
  const height = new Float32Array(SIZE * SIZE);
  const col = new Float32Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      const m = fbm(n, u, v, 6, 4);
      const i = y * SIZE + x;
      height[i] = m * 0.3;
      const k = 0.78 + m * 0.18;
      col[i * 3] = k * 0.97;
      col[i * 3 + 1] = k;
      col[i * 3 + 2] = k * 0.93;
    }
  // blades: thin strokes with a bright tip, wrapping around the tile's edges
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let b = 0; b < 9000; b++) {
    const x0 = rnd() * SIZE, y0 = rnd() * SIZE;
    const ang = rnd() * Math.PI * 2;
    const len = 5 + rnd() * 9;
    const tone = 0.62 + rnd() * 0.5;
    const dry = rnd() < 0.12 ? 0.08 : 0;
    for (let s = 0; s <= len; s++) {
      const t = s / len;
      const x = Math.round(x0 + Math.cos(ang) * s), y = Math.round(y0 + Math.sin(ang) * s);
      const i = ((y % SIZE) + SIZE) % SIZE * SIZE + (((x % SIZE) + SIZE) % SIZE);
      const k = tone * (0.85 + 0.3 * t);
      col[i * 3] = Math.min(1, k * (1 + dry));
      col[i * 3 + 1] = Math.min(1, k);
      col[i * 3 + 2] = Math.min(1, k * (0.9 - dry));
      height[i] = 0.3 + t * 0.7 * tone;
    }
  }
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    rgba[i * 4] = col[i * 3]! * 255;
    rgba[i * 4 + 1] = col[i * 3 + 1]! * 255;
    rgba[i * 4 + 2] = col[i * 3 + 2]! * 255;
    rgba[i * 4 + 3] = 255;
  }
  return { map: texture(rgba, true), normal: texture(normalFromHeight(height, 2.2), false) };
}

/** Weathered stone: warped, mottled warm grey with fine grain and a few lichen spots. */
function paintRock(): SurfaceMaps {
  const n = noise2(23), n2 = noise2(41), n3 = noise2(59), n4 = noise2(71);
  const height = new Float32Array(SIZE * SIZE);
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      const i = y * SIZE + x;
      // domain warping turns the blobs into smeared, layered-looking stone (whole cells keep it tileable)
      const wu = u + (fbm(n2, u, v, 3, 3) - 0.5) * 0.25, wv = v + (fbm(n2, u + 0.37, v + 0.61, 3, 3) - 0.5) * 0.25;
      const m = fbm(n, wu, wv, 4, 5);
      const grain = fbm(n4, u, v, 64, 2);
      const lichen = Math.max(0, (fbm(n3, u, v, 6, 3) - 0.66) / 0.34);
      height[i] = m + grain * 0.3;
      const k = Math.max(0, Math.min(1, 0.72 + (m - 0.5) * 0.55 + (grain - 0.5) * 0.2));
      rgba[i * 4] = Math.min(255, (k * 1.03 + lichen * 0.07) * 255);
      rgba[i * 4 + 1] = Math.min(255, (k + lichen * 0.09) * 255);
      rgba[i * 4 + 2] = Math.min(255, (k * 0.92 - lichen * 0.04) * 255);
      rgba[i * 4 + 3] = 255;
    }
  return { map: texture(rgba, true), normal: texture(normalFromHeight(height, 3), false) };
}

let grass: SurfaceMaps | null = null;
let rock: SurfaceMaps | null = null;

/** Painted once per visit and kept (the textures are shared, never disposed with a scene). */
export function grassMaps(): SurfaceMaps {
  return (grass ??= paintGrass());
}

export function rockMaps(): SurfaceMaps {
  return (rock ??= paintRock());
}
