import * as THREE from 'three';
import { DISPLAY_COLOR } from './shaderUtil';

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  g: number;
  drag: number;
  life: number;
  age: number;
  s0: number; s1: number;
  r: number; gg: number; b: number;
  r1: number; g1: number; b1: number;
  a0: number; a1: number;
}

export interface EmitOpts {
  count?: number;
  pos: THREE.Vector3 | { x: number; y: number; z: number };
  speed?: [number, number];
  dir?: THREE.Vector3;
  spread?: number; // 0..1 (1 = sphere)
  gravity?: number;
  drag?: number;
  life?: [number, number];
  size?: [number, number];
  color?: number;
  color1?: number;
  alpha?: [number, number];
  jitter?: number;
}

const particleVS = /* glsl */ `
  attribute vec3 iPos; attribute vec4 iCol; attribute float iSize;
  varying vec4 vCol; varying vec2 vUv;
  void main(){
    vUv = position.xy;
    vCol = iCol;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    mv.xy += position.xy * iSize;
    gl_Position = projectionMatrix * mv;
  }`;
const particleFS = /* glsl */ `
  ${DISPLAY_COLOR}
  varying vec4 vCol; varying vec2 vUv;
  void main(){
    float d = length(vUv) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    a *= a;
    #ifdef SOLID
    // a gloopy drop: firm edge, darker rim, glossy highlight
    a = smoothstep(1.0, 0.8, d);
    float hl = smoothstep(0.3, 0.0, length(vUv - vec2(-0.14, 0.16)));
    vec3 c = mix(vCol.rgb * (0.8 + 0.2 * (1.0 - d)), vec3(1.0), hl * 0.7);
    #else
    vec3 c = vCol.rgb;
    #endif
    if (a * vCol.a < 0.004) discard;
    gl_FragColor = displayColor(vec4(c, a * vCol.a));
  }`;

const deadParticle = (): Particle => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, life: 0, age: 1, s0: 0, s1: 0, r: 0, gg: 0, b: 0, r1: 0, g1: 0, b1: 0, a0: 0, a1: 0 });
const c0 = new THREE.Color();
const c1 = new THREE.Color();

/** Only the live part of an instanced attribute goes to the GPU. */
function upload(a: THREE.BufferAttribute, items: number) {
  a.clearUpdateRanges();
  if (items > 0) a.addUpdateRange(0, items * a.itemSize);
  a.needsUpdate = true;
}

/**
 * CPU-simulated billboard particles, one draw call per system. A fixed ring of particles: emitting reuses the oldest
 * slot (once it's full the oldest particle makes way), so nothing is allocated while effects play.
 */
export class Particles {
  readonly mesh: THREE.Mesh;
  private pool: Particle[];
  private head = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private geo: THREE.InstancedBufferGeometry;
  /** `solid`: opaque, glossy drops (Gerry Sauce) drawn in their exact palette colours. */
  constructor(private max: number, additive: boolean, private solid = false) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pool = Array.from({ length: max }, deadParticle);
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iCol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      vertexShader: particleVS,
      fragmentShader: particleFS,
      defines: solid ? { SOLID: '' } : {},
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 6 : 5;
  }

  emit(o: EmitOpts) {
    if (!this.max) return;
    const n = o.count ?? 10;
    // the shader writes colours out untouched, so "exact" colours skip the sRGB → linear conversion
    const cs = this.solid ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
    c0.setHex(o.color ?? 0xffffff, cs);
    c1.setHex(o.color1 ?? o.color ?? 0xffffff, cs);
    for (let i = 0; i < n; i++) {
      const p = this.pool[this.head]!;
      this.head = (this.head + 1) % this.max;
      const sp = o.speed ? o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]) : 1;
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      if (o.dir) {
        const s = o.spread ?? 0.3;
        dx = o.dir.x + dx * s; dy = o.dir.y + dy * s; dz = o.dir.z + dz * s;
        const l2 = Math.hypot(dx, dy, dz) || 1;
        dx /= l2; dy /= l2; dz /= l2;
      }
      const j = o.jitter ?? 0;
      p.x = o.pos.x + (Math.random() - 0.5) * j;
      p.y = o.pos.y + (Math.random() - 0.5) * j;
      p.z = o.pos.z + (Math.random() - 0.5) * j;
      p.vx = dx * sp;
      p.vy = dy * sp;
      p.vz = dz * sp;
      p.g = o.gravity ?? 0;
      p.drag = o.drag ?? 0;
      p.life = o.life ? o.life[0] + Math.random() * (o.life[1] - o.life[0]) : 0.6;
      p.age = 0;
      p.s0 = o.size?.[0] ?? 0.3;
      p.s1 = o.size?.[1] ?? 0.1;
      p.r = c0.r;
      p.gg = c0.g;
      p.b = c0.b;
      p.r1 = c1.r;
      p.g1 = c1.g;
      p.b1 = c1.b;
      p.a0 = o.alpha?.[0] ?? 1;
      p.a1 = o.alpha?.[1] ?? 0;
    }
  }

  update(dt: number) {
    let k = 0;
    for (const p of this.pool) {
      if (p.age >= p.life) continue;
      p.age += dt;
      if (p.age >= p.life) continue;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp; p.vy = p.vy * damp - p.g * dt; p.vz *= damp;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.age / p.life;
      this.pos[k * 3] = p.x; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z;
      this.col[k * 4] = p.r + (p.r1 - p.r) * t;
      this.col[k * 4 + 1] = p.gg + (p.g1 - p.gg) * t;
      this.col[k * 4 + 2] = p.b + (p.b1 - p.b) * t;
      this.col[k * 4 + 3] = p.a0 + (p.a1 - p.a0) * t;
      this.size[k] = p.s0 + (p.s1 - p.s0) * t;
      k++;
    }
    const was = this.geo.instanceCount;
    this.geo.instanceCount = k;
    if (k === 0 && was === 0) return;
    upload(this.geo.getAttribute('iPos') as THREE.BufferAttribute, k);
    upload(this.geo.getAttribute('iCol') as THREE.BufferAttribute, k);
    upload(this.geo.getAttribute('iSize') as THREE.BufferAttribute, k);
  }

  clear() {
    for (const p of this.pool) p.age = p.life;
    this.geo.instanceCount = 0;
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

interface Ribbon {
  a: THREE.Vector3;
  b: THREE.Vector3;
  w: number;
  c: THREE.Color;
  life: number;
  age: number;
  alpha: number;
  grow?: number; // tracer head travel speed (m/s); 0 = instant
}

const ribbonVS = /* glsl */ `
  attribute vec3 iA; attribute vec3 iB; attribute vec4 iCol; attribute float iW;
  varying vec4 vCol; varying float vV;
  void main(){
    vec3 p = mix(iA, iB, position.y);
    vec3 dir = normalize(iB - iA);
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = normalize(cross(dir, toCam));
    p += side * position.x * iW;
    vCol = iCol; vV = position.x;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const ribbonFS = /* glsl */ `
  ${DISPLAY_COLOR}
  varying vec4 vCol; varying float vV;
  void main(){
    float a = 1.0 - abs(vV) * 2.0;
    a = pow(max(a, 0.0), 1.5);
    gl_FragColor = displayColor(vec4(vCol.rgb * (1.0 + a), a * vCol.a));
  }`;

/** Camera-facing ribbons for tracers & beams (world-space endpoints). */
export class Ribbons {
  readonly mesh: THREE.Mesh;
  private rs: Ribbon[] = [];
  private A: Float32Array;
  private B: Float32Array;
  private C: Float32Array;
  private W: Float32Array;
  private geo: THREE.InstancedBufferGeometry;
  constructor(private max: number) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.A = new Float32Array(max * 3);
    this.B = new Float32Array(max * 3);
    this.C = new Float32Array(max * 4);
    this.W = new Float32Array(max);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(this.A, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(this.B, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iCol', new THREE.InstancedBufferAttribute(this.C, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iW', new THREE.InstancedBufferAttribute(this.W, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({ vertexShader: ribbonVS, fragmentShader: ribbonFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }

  add(a: THREE.Vector3, b: THREE.Vector3, color: number, width: number, life: number, alpha = 1, grow = 0) {
    if (this.rs.length >= this.max) this.rs.shift();
    this.rs.push({ a: a.clone(), b: b.clone(), w: width, c: new THREE.Color(color), life, age: 0, alpha, grow });
  }

  update(dt: number) {
    let k = 0;
    for (const r of this.rs) {
      r.age += dt;
      if (r.age >= r.life) continue;
      const t = r.age / r.life;
      rA.copy(r.a);
      rB.copy(r.b);
      if (r.grow) {
        // moving bullet streak: a short segment travelling from a to b
        const L = r.a.distanceTo(r.b);
        const head = Math.min(L, r.grow * r.age);
        const tail = Math.max(0, head - Math.min(12, L * 0.4));
        rDir.copy(r.b).sub(r.a).normalize();
        rB.copy(r.a).addScaledVector(rDir, head);
        rA.copy(r.a).addScaledVector(rDir, tail);
      }
      const A = this.A, B = this.B, C = this.C;
      A[k * 3] = rA.x; A[k * 3 + 1] = rA.y; A[k * 3 + 2] = rA.z;
      B[k * 3] = rB.x; B[k * 3 + 1] = rB.y; B[k * 3 + 2] = rB.z;
      C[k * 4] = r.c.r; C[k * 4 + 1] = r.c.g; C[k * 4 + 2] = r.c.b; C[k * 4 + 3] = r.alpha * (1 - t) * (1 - t);
      this.W[k] = r.w * (1 - t * 0.5);
      // keep the live ones, in order, at the front
      this.rs[k++] = r;
    }
    this.rs.length = k;
    const was = this.geo.instanceCount;
    this.geo.instanceCount = k;
    if (k === 0 && was === 0) return;
    for (const n of ['iA', 'iB', 'iCol', 'iW']) upload(this.geo.getAttribute(n) as THREE.BufferAttribute, k);
  }

  clear() {
    this.rs = [];
    this.geo.instanceCount = 0;
  }
}

const rA = new THREE.Vector3();
const rB = new THREE.Vector3();
const rDir = new THREE.Vector3();

/**
 * Handful of pooled point lights for muzzle flashes & explosions. They stay in the scene at all times (dark when idle):
 * showing or hiding a light changes the scene's light count, and every lit material then needs a different shader,
 * a big hitch right when the first shot or explosion happens.
 */
export class FlashLights {
  private lights: { l: THREE.PointLight; life: number; age: number; i0: number }[] = [];
  constructor(private scene: THREE.Scene, n = 3) {
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 20, 2);
      scene.add(l);
      this.lights.push({ l, life: 1, age: 1, i0: 0 });
    }
  }
  flash(pos: THREE.Vector3, color: number, intensity: number, range: number, life: number) {
    if (!this.lights.length) return;
    const slot = this.lights.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    slot.l.position.copy(pos);
    slot.l.color.setHex(color);
    slot.l.distance = range;
    slot.i0 = intensity;
    slot.life = life;
    slot.age = 0;
    slot.l.intensity = intensity;
  }
  update(dt: number) {
    for (const s of this.lights) {
      if (s.age >= s.life) {
        s.l.intensity = 0;
        continue;
      }
      s.age += dt;
      s.l.intensity = s.i0 * Math.max(0, 1 - s.age / s.life);
    }
  }

  dispose() {
    for (const s of this.lights) {
      this.scene.remove(s.l);
      s.l.dispose();
    }
    this.lights = [];
  }
}

const ringVS = /* glsl */ `
  attribute float iAlpha; attribute vec3 iColor;
  varying vec2 vUv; varying float vA; varying vec3 vC;
  void main(){
    vUv = uv;
    vA = iAlpha;
    vC = iColor;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
const ringFS = /* glsl */ `
  ${DISPLAY_COLOR}
  varying vec2 vUv; varying float vA; varying vec3 vC;
  void main(){
    float r = length(vUv * 2.0 - 1.0);
    // a thin bright band at the edge, with a faint wake inside
    float a = smoothstep(1.0, 0.94, r) * (smoothstep(0.66, 0.94, r) + 0.15 * smoothstep(0.2, 0.9, r));
    if (a * vA < 0.01) discard;
    gl_FragColor = displayColor(vec4(vC * (1.0 + a), a * vA));
  }`;

/** Flat, additive shockwave rings that race outwards from big explosions. */
export class Shockwaves {
  readonly mesh: THREE.InstancedMesh;
  private items: { pos: THREE.Vector3; r: number; life: number; age: number }[] = [];
  private alpha: Float32Array;
  private color: Float32Array;
  private next = 0;
  private m4 = new THREE.Matrix4();
  constructor(private max = 8) {
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    geo.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.color, 3));
    const mat = new THREE.ShaderMaterial({ vertexShader: ringVS, fragmentShader: ringFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
      this.items.push({ pos: new THREE.Vector3(), r: 0, life: 1, age: 1 });
    }
  }

  /** A ring at `pos` growing to radius `r` over `life` seconds. */
  add(pos: THREE.Vector3, r: number, color: number, life = 0.45) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.items[i] = { pos: pos.clone(), r, life, age: 0 };
    // exact palette colour (the shader writes it out untouched)
    const c = new THREE.Color().setHex(color, THREE.LinearSRGBColorSpace);
    this.color.set([c.r, c.g, c.b], i * 3);
    (this.mesh.geometry.getAttribute('iColor') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      const it = this.items[i]!;
      it.age += dt;
      const t = Math.min(1, it.age / it.life);
      const live = it.age < it.life;
      const s = live ? Math.max(0.01, it.r * (1 - Math.pow(1 - t, 3))) : 0;
      this.mesh.setMatrixAt(i, this.m4.makeScale(s, 1, s).setPosition(it.pos));
      this.alpha[i] = live ? 0.85 * (1 - t) * (1 - t) : 0;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.geometry.getAttribute('iAlpha') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}

const decalVS = /* glsl */ `
  attribute float aAlpha; attribute vec3 aColor;
  varying vec2 vUv; varying float vA; varying vec3 vC;
  void main(){
    vUv = uv;
    vA = aAlpha;
    vC = aColor;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }`;
const decalFS = /* glsl */ `
  ${DISPLAY_COLOR}
  varying vec2 vUv; varying float vA; varying vec3 vC;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float ang = atan(p.y, p.x);
    // blobby splat edge
    float edge = 0.78 + 0.12 * sin(ang * 5.0) + 0.06 * sin(ang * 11.0 + 1.3);
    float a = smoothstep(edge, edge - 0.12, r);
    if (a * vA < 0.01) discard;
    gl_FragColor = displayColor(vec4(vC * (0.9 + 0.1 * (1.0 - r)), a * vA));
  }`;

/** Grid cells per decal side: each splat is draped over the terrain, not a flat card that sinks into slopes. */
const DECAL_N = 6;
const DECAL_V = (DECAL_N + 1) * (DECAL_N + 1);

/** Splats on the ground (Gerry Sauce, scorch marks) that fade away, draped over the terrain — one draw call. */
export class Decals {
  readonly mesh: THREE.Mesh;
  private items: { age: number; life: number; a0: number }[] = [];
  private pos: Float32Array;
  private alpha: Float32Array;
  /** per-vertex visibility: 0 over a hole (a splat must not cover the mouth) */
  private mask: Float32Array;
  private color: Float32Array;
  private next = 0;
  constructor(
    private max: number,
    /** ground height (m) at (x, z) */
    private groundAt: (x: number, z: number) => number,
    /** places a splat must not cover (hole rims and mouths) */
    private blocked: (x: number, z: number) => boolean = () => false,
  ) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * DECAL_V * 3);
    this.alpha = new Float32Array(max * DECAL_V);
    this.mask = new Float32Array(max * DECAL_V);
    this.color = new Float32Array(max * DECAL_V * 3);
    const uv = new Float32Array(max * DECAL_V * 2);
    const index: number[] = [];
    for (let d = 0; d < max; d++) {
      const o = d * DECAL_V;
      for (let j = 0; j <= DECAL_N; j++)
        for (let i = 0; i <= DECAL_N; i++) {
          const k = o + j * (DECAL_N + 1) + i;
          uv[k * 2] = i / DECAL_N;
          uv[k * 2 + 1] = j / DECAL_N;
          if (i < DECAL_N && j < DECAL_N) {
            const a = k, b = k + 1, c = k + DECAL_N + 1, e = k + DECAL_N + 2;
            index.push(a, c, b, b, c, e);
          }
        }
      this.items.push({ age: 1, life: 1, a0: 0 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(index);
    const mat = new THREE.ShaderMaterial({ vertexShader: decalVS, fragmentShader: decalFS, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** A splat of radius `r` lying on the ground around (x, z). */
  add(x: number, z: number, r: number, color: number, life = 8, alpha = 0.95) {
    const d = this.next;
    this.next = (this.next + 1) % this.max;
    const rot = Math.random() * Math.PI * 2, cs = Math.cos(rot), sn = Math.sin(rot);
    // the shader writes the colour out untouched: keep it as the exact sRGB palette colour
    const c = new THREE.Color().setHex(color, THREE.LinearSRGBColorSpace);
    for (let j = 0; j <= DECAL_N; j++)
      for (let i = 0; i <= DECAL_N; i++) {
        const k = d * DECAL_V + j * (DECAL_N + 1) + i;
        const u = (i / DECAL_N) * 2 - 1, v = (j / DECAL_N) * 2 - 1;
        const px = x + (u * cs - v * sn) * r, pz = z + (u * sn + v * cs) * r;
        this.pos.set([px, this.groundAt(px, pz) + 0.05, pz], k * 3);
        this.color.set([c.r, c.g, c.b], k * 3);
        this.mask[k] = this.blocked(px, pz) ? 0 : 1;
      }
    this.items[d] = { age: 0, life, a0: alpha };
    const g = this.mesh.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('aColor').needsUpdate = true;
  }

  update(dt: number) {
    for (let d = 0; d < this.max; d++) {
      const it = this.items[d]!;
      it.age += dt;
      // fade over the last 2 seconds
      const a = it.age >= it.life ? 0 : it.a0 * Math.min(1, (it.life - it.age) / 2);
      for (let k = d * DECAL_V; k < (d + 1) * DECAL_V; k++) this.alpha[k] = a * this.mask[k]!;
    }
    this.mesh.geometry.getAttribute('aAlpha').needsUpdate = true;
  }
}
