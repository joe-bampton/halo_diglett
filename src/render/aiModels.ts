import * as THREE from 'three';
import { HEAD_Y } from '../sim/constants';
import type { WeaponId } from '../sim/weapons';

/**
 * Models made with AI 3D tools (Meshy, Tripo…), dropped into models-src/ and optimised by tools/models/import.mjs into
 * public/models/ai/. They come in any size, facing any way, as one lump of geometry, so here they are turned, scaled
 * and cut up to fit the game: characters stand in the hole with their head where the head hitbox is, and are cut at
 * the waist and neck so the upper body can aim up and down; weapons are held at their grip and fire from their muzzle.
 * Every slot is optional: anything missing keeps the built-in model.
 */
export type AiCharacter = 'spartan' | 'cat';
export type AiProp = 'can' | 'spring';
export type AiSlot = AiCharacter | AiProp | WeaponId;

export const AI_CHARACTERS: readonly AiCharacter[] = ['spartan', 'cat'];
export const AI_PROPS: readonly AiProp[] = ['can', 'spring'];

type V3T = [number, number, number];

/** How to fit one model (models-src/models.json; everything but `file` is optional). */
export interface AiConfig {
  file: string;
  /** turn the model first, in degrees about X, Y, Z (characters should end up facing -Z, the way they look) */
  rotate?: V3T;
  /** weapons: turn it end for end (if it fires backwards) */
  flip?: boolean;
  /** weapons: length (m); characters: height from feet to top of head (m); props: height (m) */
  size?: number;
  /** weapons: where the hand holds it, as fractions of its box: [left→right, bottom→top, muzzle end→butt end] */
  grip?: V3T;
  /** weapons: where shots come out, same fractions */
  muzzle?: V3T;
  /** characters: heights (m, 0 = rim level, head hitbox centre at 0.95) of the cuts between legs | upper body | head */
  waist?: number;
  neck?: number;
  /** characters: where the weapon sits, relative to the chest pivot (m) */
  hand?: V3T;
  /** characters: paint the light grey / white parts of the texture in each player's colour */
  tint?: boolean;
  /** set by the importer */
  triangles?: number;
  bytes?: number;
}

/** Weapon lengths (m), about the built-in models' (the viewmodel shows them at 0.6×). */
export const WEAPON_SIZE: Record<WeaponId, number> = {
  sniper: 1.6, br: 0.85, crossbow: 0.85, rpg: 1.25, grenade: 0.7, railgun: 1.05, hyperbeam: 1.0, needler: 0.65,
  flamethrower: 1.0, minigun: 1.1, orbital: 0.55, soaker: 0.85, frag: 0.16, plasma: 0.16,
};

/** Feet to top of head for a character (m): the top of the head sits just above the head hitbox. */
export const CHARACTER_HEIGHT = 2.35;
const CHARACTER_TOP = HEAD_Y + 0.2;
/** Chest (aim) and head pivots, as the built-in Spartan's (models.ts buildSpartan). */
export const AIM_Y = 0.58;
export const HEAD_PIVOT_Y = HEAD_Y;
export const DEFAULT_HAND: V3T = [0.05, -0.2, -0.3];

const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
const vec = (v: unknown, lo: number, hi: number): V3T | undefined =>
  Array.isArray(v) && v.length === 3 && v.every((x) => num(x, lo, hi) !== undefined) ? (v as V3T) : undefined;

/** Keep only sensible fields (the manifest is hand-edited). */
export function sanitizeAiConfig(raw: unknown): AiConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.file !== 'string' || !/^[\w./-]+\.(glb|gltf)$/i.test(r.file) || r.file.includes('..')) return null;
  const out: AiConfig = { file: r.file };
  const rotate = vec(r.rotate, -360, 360), grip = vec(r.grip, 0, 1), muzzle = vec(r.muzzle, 0, 1), hand = vec(r.hand, -2, 2);
  const size = num(r.size, 0.01, 10), waist = num(r.waist, -1.5, 1.5), neck = num(r.neck, -1.5, 1.5);
  if (rotate) out.rotate = rotate;
  if (r.flip === true) out.flip = true;
  if (size) out.size = size;
  if (grip) out.grip = grip;
  if (muzzle) out.muzzle = muzzle;
  if (waist !== undefined) out.waist = waist;
  if (neck !== undefined) out.neck = neck;
  if (hand) out.hand = hand;
  if (typeof r.tint === 'boolean') out.tint = r.tint;
  return out;
}

/** A piece of a model: geometry in its part's own space, and the material it came with. */
export interface AiPiece {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

export interface AiCharacterModel {
  kind: 'character';
  /** legs (relative to the rim, at the body pivot), upper body (relative to the chest pivot), head (head pivot) */
  lower: AiPiece[];
  upper: AiPiece[];
  head: AiPiece[];
  hand: V3T;
  tint: boolean;
}

export interface AiObjectModel {
  kind: 'weapon' | 'prop';
  pieces: AiPiece[];
  /** weapons: where shots come out (the model's origin is the grip) */
  muzzle: THREE.Vector3;
}

export type AiModel = AiCharacterModel | AiObjectModel;

/** The loaded, fitted models (filled in by assets.ts). */
export const AI: Partial<Record<AiSlot, AiModel>> = {};

/** Every mesh's geometry with its transform baked in (skinned meshes in their rest pose), after turning by `rotate`. */
export function bakeMeshes(root: THREE.Object3D, rotate: V3T = [0, 0, 0]): AiPiece[] {
  const holder = new THREE.Group();
  holder.rotation.set(...(rotate.map((d) => (d * Math.PI) / 180) as V3T));
  holder.add(root);
  holder.updateMatrixWorld(true);
  const out: AiPiece[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const geo = new THREE.BufferGeometry();
    // plain floats (compressed files store packed integers, which can't be moved, scaled and cut in place)
    for (const k of ['position', 'normal', 'uv', 'color']) {
      const a = m.geometry.getAttribute(k);
      if (a) geo.setAttribute(k, toFloat(a));
    }
    if (m.geometry.index) geo.setIndex(m.geometry.index.clone());
    for (const g of m.geometry.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    geo.applyMatrix4(m.matrixWorld);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.length > 1 && geo.groups.length) {
      // one piece per material group
      for (const g of geo.groups) out.push({ geo: subGeometry(geo, g.start, g.count), mat: mats[g.materialIndex ?? 0]! });
    } else out.push({ geo, mat: mats[0]! });
  });
  holder.remove(root);
  return out;
}

function toFloat(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
  return new THREE.BufferAttribute(out, a.itemSize);
}

function subGeometry(geo: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(flat.attributes)) {
    const attr = a as THREE.BufferAttribute;
    out.setAttribute(k, new THREE.BufferAttribute((attr.array as Float32Array).slice(start * attr.itemSize, (start + count) * attr.itemSize), attr.itemSize, attr.normalized));
  }
  return out;
}

export function boundsOf(pieces: AiPiece[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const p of pieces) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox!);
  }
  return box;
}

/**
 * Cut a geometry into bands by triangle height: band i holds the triangles whose centre is below cuts[i] (and above
 * the cut before it). Whole triangles stay together, so a band's edge is a little ragged rather than sliced.
 */
export function splitByHeight(geo: THREE.BufferGeometry, cuts: number[]): THREE.BufferGeometry[] {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  const pos = flat.getAttribute('position');
  const tris = pos.count / 3;
  const band = new Uint8Array(tris);
  const counts = new Array<number>(cuts.length + 1).fill(0);
  for (let t = 0; t < tris; t++) {
    const cy = (pos.getY(t * 3) + pos.getY(t * 3 + 1) + pos.getY(t * 3 + 2)) / 3;
    let b = 0;
    while (b < cuts.length && cy >= cuts[b]!) b++;
    band[t] = b;
    counts[b]!++;
  }
  return counts.map((n, b) => {
    const out = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(flat.attributes)) {
      const attr = a as THREE.BufferAttribute;
      const size = attr.itemSize;
      const src = attr.array as Float32Array;
      const dst = new Float32Array(n * 3 * size);
      let w = 0;
      for (let t = 0; t < tris; t++) {
        if (band[t] !== b) continue;
        dst.set(src.subarray(t * 3 * size, (t + 1) * 3 * size), w);
        w += 3 * size;
      }
      out.setAttribute(k, new THREE.BufferAttribute(dst, size, attr.normalized));
    }
    return out;
  });
}

const place = (pieces: AiPiece[], m: THREE.Matrix4) => {
  for (const p of pieces) {
    p.geo.applyMatrix4(m);
    if (!p.geo.getAttribute('normal')) p.geo.computeVertexNormals();
  }
};

/** Stand a character in the hole: feet down, top of the head just above the head hitbox, cut into three parts. */
export function fitCharacter(root: THREE.Object3D, cfg: AiConfig): AiCharacterModel {
  // AI tools export characters facing +Z; the game's face -Z
  const pieces = bakeMeshes(root, cfg.rotate ?? [0, 180, 0]);
  const box = boundsOf(pieces);
  const h = Math.max(1e-6, box.max.y - box.min.y);
  const s = (cfg.size ?? CHARACTER_HEIGHT) / h;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  place(pieces, new THREE.Matrix4().makeTranslation(0, CHARACTER_TOP - box.max.y * s, 0).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-cx, 0, -cz)));
  const waist = cfg.waist ?? 0.05, neck = cfg.neck ?? 0.76;
  const lower: AiPiece[] = [], upper: AiPiece[] = [], head: AiPiece[] = [];
  for (const p of pieces) {
    const [a, b, c] = splitByHeight(p.geo, [waist, neck]);
    if (a!.getAttribute('position').count) lower.push({ geo: a!, mat: p.mat });
    if (b!.getAttribute('position').count) upper.push({ geo: b!.translate(0, -AIM_Y, 0), mat: p.mat });
    if (c!.getAttribute('position').count) head.push({ geo: c!.translate(0, -HEAD_PIVOT_Y, 0), mat: p.mat });
  }
  return { kind: 'character', lower, upper, head, hand: cfg.hand ?? DEFAULT_HAND, tint: cfg.tint ?? false };
}

/** Lay a weapon along -Z (muzzle forward), `size` long, with its grip at the origin. */
export function fitWeapon(root: THREE.Object3D, cfg: AiConfig, length: number): AiObjectModel {
  let pieces = bakeMeshes(root, cfg.rotate ?? [0, 0, 0]);
  let box = boundsOf(pieces);
  // the long way round is the barrel
  const turn = new THREE.Matrix4();
  if (box.max.x - box.min.x > box.max.z - box.min.z) turn.makeRotationY(Math.PI / 2);
  if (cfg.flip) turn.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
  place(pieces, turn);
  box = boundsOf(pieces);
  const s = (cfg.size ?? length) / Math.max(1e-6, box.max.z - box.min.z);
  const at = (f: V3T) => new THREE.Vector3(box.min.x + (box.max.x - box.min.x) * f[0], box.min.y + (box.max.y - box.min.y) * f[1], box.min.z + (box.max.z - box.min.z) * f[2]);
  const grip = at(cfg.grip ?? [0.5, 0.3, 0.62]);
  const muzzle = at(cfg.muzzle ?? [0.5, 0.62, 0]).sub(grip).multiplyScalar(s);
  place(pieces, new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-grip.x, -grip.y, -grip.z)));
  pieces = pieces.filter((p) => p.geo.getAttribute('position').count > 0);
  return { kind: 'weapon', pieces, muzzle };
}

/** Props stand `size` tall: the can centred on its middle, the spring on its base (the game stretches it upward). */
export function fitProp(root: THREE.Object3D, cfg: AiConfig, height: number, base: 'centre' | 'bottom'): AiObjectModel {
  const pieces = bakeMeshes(root, cfg.rotate ?? [0, 0, 0]);
  const box = boundsOf(pieces);
  const s = (cfg.size ?? height) / Math.max(1e-6, box.max.y - box.min.y);
  const c = box.getCenter(new THREE.Vector3());
  const y0 = base === 'bottom' ? box.min.y : c.y;
  place(pieces, new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-c.x, -y0, -c.z)));
  return { kind: 'prop', pieces, muzzle: new THREE.Vector3() };
}

/**
 * Which pixels of a character's colour map take the player's colour: light, unsaturated ones (the white or grey
 * armour the AI prompt asks for), with soft edges. Returns 0–255 per pixel.
 */
export function tintMaskFromPixels(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]! / 255, g = rgba[i * 4 + 1]! / 255, b = rgba[i * 4 + 2]! / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max > 0 ? (max - min) / max : 0;
    const grey = Math.min(1, Math.max(0, (0.3 - sat) / 0.12));
    const light = Math.min(1, Math.max(0, (max - 0.35) / 0.15));
    out[i] = Math.round(grey * light * 255);
  }
  return out;
}
