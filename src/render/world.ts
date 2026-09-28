import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng, hash01 } from '../shared/rng';
import { FENCE_RADIUS, MOUTH_R, RIM_H, RIM_OUT, WELL_DEPTH, type Arena } from '../sim/arena';
import { PAL } from './palette';
import type { QualityPreset } from './quality';

const col = (hex: number) => new THREE.Color(hex);

// --- small value noise ----------------------------------------------------------------------
function vnoise(x: number, z: number, seed = 0): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash01(xi, zi, seed), b = hash01(xi + 1, zi, seed), c = hash01(xi, zi + 1, seed), d = hash01(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, z: number, oct = 3, seed = 0): number {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, z * f, seed + i * 17);
    amp *= 0.5;
    f *= 2.03;
  }
  return s;
}

/** Height of the far landscape (outside the playable bowl) including the mountain ring. */
export function farHeight(arena: Arena, x: number, z: number): number {
  const r = Math.hypot(x, z);
  let y = arena.baseHeight(x, z);
  if (r > 120) y += (fbm(x * 0.012, z * 0.012, 3, 5) - 0.5) * 30 * Math.min(1, (r - 120) / 80);
  const t = (r - 430) / 420;
  if (t > 0) {
    const ang = Math.atan2(z, x);
    const prof = Math.pow(Math.sin(Math.min(1, t) * Math.PI), 0.7);
    const ridge = 0.55 + 0.22 * Math.sin(ang * 3 + 1.3) + 0.13 * Math.sin(ang * 7 + 0.4) + 0.1 * Math.sin(ang * 13 + 2.1);
    const peaks = fbm(Math.cos(ang) * 6 + r * 0.004, Math.sin(ang) * 6, 4, 9);
    y += prof * (ridge * 0.7 + peaks * 0.9) * 210;
  }
  return y;
}

export function terrainHeight(arena: Arena, x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < 100) return arena.groundAt(x, z);
  return farHeight(arena, x, z);
}

// --- sky -------------------------------------------------------------------------------------
export function buildSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1500, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: col(PAL.skyTop) },
      mid: { value: col(PAL.skyMid) },
      horizon: { value: col(PAL.horizon) },
      sunDir: { value: new THREE.Vector3(0.45, 0.6, -0.65).normalize() },
      sunCol: { value: col(PAL.sun) },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform float time;
      varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
      float fbm(vec2 p){ float s=0.0; float a=0.5; for(int i=0;i<4;i++){ s+=a*n(p); p*=2.1; a*=0.5;} return s; }
      void main() {
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.25, y));
        c = mix(c, top, smoothstep(0.25, 0.9, y));
        // soft clouds
        vec2 uv = d.xz / (d.y + 0.12) * 1.3 + vec2(time * 0.004, time * 0.002);
        float cl = smoothstep(0.52, 0.8, fbm(uv)) * smoothstep(0.02, 0.2, d.y);
        c = mix(c, vec3(1.0), cl * 0.75);
        // sun
        float s = max(dot(d, sunDir), 0.0);
        c += sunCol * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.18);
        if (d.y < 0.0) c = horizon;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

// --- terrain (single polar grid out to the mountains) ----------------------------------------
export function buildTerrain(arena: Arena, q: QualityPreset): THREE.Mesh {
  const rings: number[] = [];
  let r = 0;
  while (r < 900) {
    rings.push(r);
    r += r < 55 ? 0.7 : r < 120 ? 1.6 + (r - 55) * 0.03 : r < 400 ? 7 : 20;
  }
  const segs = q.angularSegs;
  const verts: number[] = [];
  const colors: number[] = [];
  const cA = col(PAL.grassA), cB = col(PAL.grassB), cD = col(PAL.grassDark), cDry = col(PAL.grassDry), cDirt = col(PAL.dirt);
  const cRock = col(PAL.rock), cSnow = col(PAL.snow), cPine = col(0x3d6e3a);
  const tmp = new THREE.Color();
  const heightAt = (x: number, z: number) => terrainHeight(arena, x, z);
  for (let i = 0; i < rings.length; i++) {
    const rr = rings[i]!;
    const n = i === 0 ? 1 : segs;
    for (let j = 0; j < n; j++) {
      const a = (j / segs) * Math.PI * 2 + (i % 2) * (Math.PI / segs);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const y = heightAt(x, z);
      verts.push(x, y, z);
      // colour
      const nz = fbm(x * 0.08, z * 0.08, 3, 1);
      tmp.copy(cA).lerp(cB, nz);
      const dry = fbm(x * 0.02 + 40, z * 0.02, 2, 3);
      if (dry > 0.62) tmp.lerp(cDry, (dry - 0.62) * 1.6);
      tmp.lerp(cD, Math.max(0, 0.5 - fbm(x * 0.25, z * 0.25, 2, 7)) * 0.6);
      const h = arena.nearestHole(x, z);
      if (h) {
        const d = Math.hypot(h.x - x, h.z - z);
        if (d < RIM_OUT + 0.7) tmp.lerp(cDirt, 0.55 * (1 - Math.max(0, d - RIM_OUT) / 0.7));
      }
      if (rr > 200) {
        // far: forest band then rock + snow on the mountains
        const peakness = y / 230;
        if (rr < 440) tmp.lerp(cPine, 0.55);
        const slope = Math.abs(heightAt(x + 4, z) - y) + Math.abs(heightAt(x, z + 4) - y);
        if (peakness > 0.1) tmp.lerp(cRock, Math.min(1, (peakness - 0.1) * 3 + slope * 0.02));
        if (peakness > 0.6 + (fbm(x * 0.01, z * 0.01, 2, 11) - 0.5) * 0.25) tmp.copy(cSnow);
      }
      colors.push(tmp.r, tmp.g, tmp.b);
    }
  }
  const idx: number[] = [];
  const holeCut = (ax: number, az: number) => {
    const h = arena.nearestHole(ax, az);
    return h && Math.hypot(h.x - ax, h.z - az) < MOUTH_R + 0.28;
  };
  const vi = (i: number, j: number) => (i === 0 ? 0 : 1 + (i - 1) * segs + (((j % segs) + segs) % segs));
  const pushTri = (a: number, b: number, c: number) => {
    const cx = (verts[a * 3]! + verts[b * 3]! + verts[c * 3]!) / 3;
    const cz = (verts[a * 3 + 2]! + verts[b * 3 + 2]! + verts[c * 3 + 2]!) / 3;
    if (Math.hypot(cx, cz) < 50 && holeCut(cx, cz)) return;
    idx.push(a, c, b);
  };
  for (let j = 0; j < segs; j++) pushTri(0, vi(1, j), vi(1, j + 1));
  for (let i = 1; i < rings.length - 1; i++) {
    const shift = i % 2;
    for (let j = 0; j < segs; j++) {
      const a = vi(i, j), b = vi(i, j + 1), c = vi(i + 1, j), d = vi(i + 1, j + 1);
      if (shift) {
        pushTri(a, c, d);
        pushTri(a, d, b);
      } else {
        pushTri(a, c, b);
        pushTri(b, c, d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

// --- holes: wells + stacked stone rims --------------------------------------------------------
function stoneGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const rng = new Rng(seed);
  const cache = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let off = cache.get(key);
    if (!off) {
      off = [rng.range(0.85, 1.15), rng.range(0.8, 1.1), rng.range(0.85, 1.15)];
      cache.set(key, off);
    }
    pos.setXYZ(i, pos.getX(i) * off[0], pos.getY(i) * off[1] * 0.42, pos.getZ(i) * off[2]);
  }
  g.computeVertexNormals();
  return g;
}

export function buildHoles(arena: Arena): THREE.Group {
  const group = new THREE.Group();
  group.name = 'holes';
  const rng = new Rng(77);
  // stones
  const stoneGeo = stoneGeometry(3);
  const layers = [
    { r: 1.2, n: 11, sx: 0.42, sz: 0.36, sy: 0.19 },
    { r: 1.62, n: 15, sx: 0.44, sz: 0.34, sy: 0.19 },
  ];
  const perHole = layers.reduce((a, l) => a + l.n, 0) * 3;
  const stones = new THREE.InstancedMesh(stoneGeo, new THREE.MeshLambertMaterial({ flatShading: true }), perHole * arena.holes.length);
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  let k = 0;
  for (const h of arena.holes) {
    for (let layer = 0; layer < 3; layer++) {
      for (const L of layers) {
        for (let i = 0; i < L.n; i++) {
          const a = ((i + (layer % 2) * 0.5) / L.n) * Math.PI * 2 + rng.range(-0.05, 0.05);
          const rr = L.r + rng.range(-0.05, 0.05);
          p.set(h.x + Math.cos(a) * rr, h.ground + 0.1 + layer * 0.14 + rng.range(-0.02, 0.02), h.z + Math.sin(a) * rr);
          e.set(rng.range(-0.08, 0.08), -a + Math.PI / 2, rng.range(-0.08, 0.08));
          quat.setFromEuler(e);
          sc.set(L.sx * rng.range(0.9, 1.25), L.sy * rng.range(0.85, 1.15), L.sz * rng.range(0.9, 1.2));
          m4.compose(p, quat, sc);
          stones.setMatrixAt(k, m4);
          c.setHex(PAL.stone).lerp(new THREE.Color(PAL.stoneDark), rng.range(0, 0.7)).offsetHSL(0, 0, rng.range(-0.04, 0.06));
          stones.setColorAt(k, c);
          k++;
        }
      }
    }
  }
  stones.castShadow = true;
  stones.receiveShadow = true;
  group.add(stones);
  // wells
  const wellGeo = new THREE.CylinderGeometry(MOUTH_R + 0.08, MOUTH_R + 0.02, WELL_DEPTH + RIM_H, 18, 4, true);
  const wc: number[] = [];
  const wp = wellGeo.getAttribute('position') as THREE.BufferAttribute;
  const top = (WELL_DEPTH + RIM_H) / 2;
  for (let i = 0; i < wp.count; i++) {
    const t = (wp.getY(i) + top) / (2 * top);
    c.setHex(0x4a4f52).lerp(new THREE.Color(0x8a9095), t);
    wc.push(c.r, c.g, c.b);
  }
  wellGeo.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
  const wellMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.BackSide });
  const floorGeo = new THREE.CircleGeometry(MOUTH_R + 0.05, 18).rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x3a3a30 });
  const wells = new THREE.InstancedMesh(wellGeo, wellMat, arena.holes.length);
  const floors = new THREE.InstancedMesh(floorGeo, floorMat, arena.holes.length);
  arena.holes.forEach((h, i) => {
    m4.makeTranslation(h.x, h.ground - WELL_DEPTH + top, h.z);
    wells.setMatrixAt(i, m4);
    m4.makeTranslation(h.x, h.ground - WELL_DEPTH + 0.01, h.z);
    floors.setMatrixAt(i, m4);
  });
  group.add(wells, floors);
  return group;
}

// --- white picket fence ------------------------------------------------------------------------
export function buildFence(arena: Arena): THREE.Group {
  const g = new THREE.Group();
  const picket = new THREE.BoxGeometry(0.1, 0.95, 0.035).translate(0, 0.475, 0);
  const tip = new THREE.ConeGeometry(0.072, 0.13, 4).rotateY(Math.PI / 4).translate(0, 1.0, 0);
  tip.scale(1, 1, 0.5);
  const pg = mergeGeometries([picket.toNonIndexed(), tip.toNonIndexed()])!;
  const R = FENCE_RADIUS;
  const spacing = 0.2;
  const count = Math.floor((Math.PI * 2 * R) / spacing);
  const gaps = [0.3, 2.4, 4.3]; // radians where the fence has openings
  const inGap = (a: number) => gaps.some((ga) => Math.abs(((a - ga + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.06);
  const mat = new THREE.MeshLambertMaterial({ color: PAL.fence });
  const pickets = new THREE.InstancedMesh(pg, mat, count);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let k = 0;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    if (inGap(a)) continue;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    q.setFromAxisAngle(up, -a + Math.PI / 2);
    m4.compose(new THREE.Vector3(x, arena.groundAt(x, z) - 0.05, z), q, new THREE.Vector3(1, 1, 1));
    pickets.setMatrixAt(k++, m4);
  }
  pickets.count = k;
  pickets.castShadow = true;
  g.add(pickets);
  // rails
  const railSegs = 180;
  const rail = new THREE.BoxGeometry(1, 0.07, 0.03);
  const rails = new THREE.InstancedMesh(rail, mat, railSegs * 2);
  k = 0;
  for (let i = 0; i < railSegs; i++) {
    const a0 = (i / railSegs) * Math.PI * 2, a1 = ((i + 1) / railSegs) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    if (inGap(am)) continue;
    const x0 = Math.cos(a0) * (R + 0.04), z0 = Math.sin(a0) * (R + 0.04);
    const x1 = Math.cos(a1) * (R + 0.04), z1 = Math.sin(a1) * (R + 0.04);
    const len = Math.hypot(x1 - x0, z1 - z0);
    for (const hy of [0.3, 0.72]) {
      const y0 = arena.groundAt(x0, z0) + hy, y1 = arena.groundAt(x1, z1) + hy;
      const mid = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
      q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      m4.compose(mid, q, new THREE.Vector3(len + 0.02, 1, 1));
      rails.setMatrixAt(k++, m4);
    }
  }
  rails.count = k;
  g.add(rails);
  return g;
}

// --- pines -------------------------------------------------------------------------------------
export function buildTrees(arena: Arena, q: QualityPreset): THREE.InstancedMesh {
  const parts: THREE.BufferGeometry[] = [];
  const tiers = [
    { r: 1.7, h: 2.4, y: 1.6, c: PAL.pine },
    { r: 1.35, h: 2.2, y: 3.0, c: 0x366b3c },
    { r: 0.95, h: 2.0, y: 4.3, c: PAL.pineLight },
    { r: 0.55, h: 1.6, y: 5.4, c: 0x4a8a50 },
  ];
  const addColor = (g: THREE.BufferGeometry, hex: number) => {
    const n = g.getAttribute('position').count;
    const cc = new THREE.Color(hex);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([cc.r, cc.g, cc.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  for (const t of tiers) parts.push(addColor(new THREE.ConeGeometry(t.r, t.h, 7).translate(0, t.y, 0).toNonIndexed(), t.c));
  parts.push(addColor(new THREE.CylinderGeometry(0.16, 0.24, 1.4, 6).translate(0, 0.6, 0).toNonIndexed(), PAL.trunk));
  const geo = mergeGeometries(parts)!;
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), q.trees);
  const rng = new Rng(5);
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const c = new THREE.Color();
  let k = 0;
  let guard = 0;
  while (k < q.trees && guard++ < 5000) {
    const a = rng.range(0, Math.PI * 2);
    const r = FENCE_RADIUS + 5 + Math.pow(rng.next(), 0.8) * 90;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // clusters: skip some areas
    if (vnoise(x * 0.04, z * 0.04, 3) < 0.38) continue;
    const s = rng.range(0.9, 1.9) * (r > 100 ? 1.3 : 1);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6.28));
    m4.compose(new THREE.Vector3(x, terrainHeight(arena, x, z) - 0.2, z), quat, new THREE.Vector3(s, s * rng.range(0.9, 1.25), s));
    mesh.setMatrixAt(k, m4);
    c.setHSL(0.33 + rng.range(-0.03, 0.03), 0.4, rng.range(0.85, 1.1) * 0.5);
    mesh.setColorAt(k, c.setRGB(rng.range(0.85, 1.1), rng.range(0.9, 1.1), rng.range(0.85, 1.05)));
    k++;
  }
  mesh.count = k;
  mesh.castShadow = true;
  return mesh;
}

// --- flowers & little details ----------------------------------------------------------------
export function buildFlowers(arena: Arena): THREE.InstancedMesh {
  const petal = new THREE.CylinderGeometry(0.075, 0.03, 0.1, 6).translate(0, 0.24, 0);
  const stem = new THREE.CylinderGeometry(0.01, 0.01, 0.22, 3).translate(0, 0.11, 0);
  const g = mergeGeometries([petal.toNonIndexed(), stem.toNonIndexed()])!;
  const count = 380;
  const mesh = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff }), count);
  const rng = new Rng(11);
  const m4 = new THREE.Matrix4();
  const colors = [0xe8323c, 0xffffff, 0xf7d23e, 0xe8323c, 0xff7fb0];
  let k = 0;
  while (k < count) {
    // cluster along the fence and near a few holes
    const nearFence = rng.chance(0.7);
    const a = rng.range(0, Math.PI * 2);
    const r = nearFence ? FENCE_RADIUS - rng.range(0.4, 3) : rng.range(6, 46);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = arena.nearestHole(x, z);
    if (h && Math.hypot(h.x - x, h.z - z) < RIM_OUT + 0.3) continue;
    const s = rng.range(0.7, 1.4);
    m4.compose(new THREE.Vector3(x, arena.groundAt(x, z), z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(k, m4);
    mesh.setColorAt(k, new THREE.Color(rng.pick(colors)));
    k++;
  }
  return mesh;
}

// --- instanced grass with wind ----------------------------------------------------------------
export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private uniforms = { time: { value: 0 } };
  constructor(
    private arena: Arena,
    private q: QualityPreset,
  ) {
    // clump of 4 blades
    const blades: THREE.BufferGeometry[] = [];
    const rng = new Rng(21);
    for (let b = 0; b < 4; b++) {
      const w = 0.04, h = rng.range(0.16, 0.32);
      const a = rng.range(0, Math.PI);
      const ox = rng.range(-0.12, 0.12), oz = rng.range(-0.12, 0.12);
      const lean = rng.range(-0.1, 0.1);
      const pos = [-w, 0, 0, w, 0, 0, -w * 0.6, h * 0.55, 0, w * 0.6, h * 0.55, 0, lean, h, 0];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
      g.rotateY(a);
      g.translate(ox, 0, oz);
      const cols: number[] = [];
      const base = new THREE.Color(0x3f7a26), tip = new THREE.Color(0x9fd25a);
      for (let i = 0; i < 5; i++) {
        const t = pos[i * 3 + 1]! / h;
        const c = base.clone().lerp(tip, t);
        cols.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      blades.push(g.toNonIndexed());
    }
    const geo = mergeGeometries(blades)!;
    geo.computeVertexNormals();
    // normals point up-ish for soft lighting
    const n = geo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.time = this.uniforms.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float time;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 wpos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sway = sin(time * 1.7 + wpos.x * 0.35 + wpos.z * 0.2) * 0.6 + sin(time * 3.1 + wpos.z * 0.9) * 0.25;
          float hk = position.y * position.y * 1.4;
          transformed.x += sway * hk * 0.35;
          transformed.z += sway * hk * 0.18;`,
        );
      // light both sides of a blade like the front
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'),
      );
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, q.grassClumps);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.layout(0, 0);
  }

  /** Rebuild density around the camera's hole. */
  layout(cx: number, cz: number) {
    const rng = new Rng(31);
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const R = this.q.grassRadius;
    let k = 0;
    let guard = 0;
    while (k < this.q.grassClumps && guard++ < this.q.grassClumps * 4) {
      // density falls off with distance from the camera
      const d = 1.6 + Math.pow(rng.next(), 1.7) * R;
      const a = rng.range(0, Math.PI * 2);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (Math.hypot(x, z) > FENCE_RADIUS + 12) continue;
      const h = this.arena.nearestHole(x, z);
      if (h && Math.hypot(h.x - x, h.z - z) < RIM_OUT + 0.05) continue;
      const sc = rng.range(0.7, 1.15) * (1 + (d / R) * 0.5) * (d < 6 ? 0.7 : 1);
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6.28));
      s.set(sc, sc * rng.range(0.8, 1.3), sc);
      m4.compose(new THREE.Vector3(x, this.arena.groundAt(x, z) - 0.02, z), quat, s);
      this.mesh.setMatrixAt(k, m4);
      c.setRGB(rng.range(0.85, 1.1), rng.range(0.9, 1.1), rng.range(0.8, 1.0));
      this.mesh.setColorAt(k, c);
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(time: number) {
    this.uniforms.time.value = time;
  }
}
