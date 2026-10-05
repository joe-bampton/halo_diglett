import * as THREE from 'three';

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
    gl_FragColor = vec4(c, a * vCol.a);
  }`;

/** CPU-simulated billboard particles, one draw call per system. */
export class Particles {
  readonly mesh: THREE.Mesh;
  private ps: Particle[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private geo: THREE.InstancedBufferGeometry;
  /** `solid`: opaque, glossy drops (Gerry Sauce) drawn in their exact palette colours. */
  constructor(private max: number, additive: boolean, private solid = false) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
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
    const n = o.count ?? 10;
    // the shader writes colours out untouched, so "exact" colours skip the sRGB → linear conversion
    const cs = this.solid ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
    const c0 = new THREE.Color().setHex(o.color ?? 0xffffff, cs);
    const c1 = new THREE.Color().setHex(o.color1 ?? o.color ?? 0xffffff, cs);
    for (let i = 0; i < n; i++) {
      if (this.ps.length >= this.max) this.ps.shift();
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
      const life = o.life ? o.life[0] + Math.random() * (o.life[1] - o.life[0]) : 0.6;
      this.ps.push({
        x: o.pos.x + (Math.random() - 0.5) * j, y: o.pos.y + (Math.random() - 0.5) * j, z: o.pos.z + (Math.random() - 0.5) * j,
        vx: dx * sp, vy: dy * sp, vz: dz * sp,
        g: o.gravity ?? 0, drag: o.drag ?? 0, life, age: 0,
        s0: o.size?.[0] ?? 0.3, s1: o.size?.[1] ?? 0.1,
        r: c0.r, gg: c0.g, b: c0.b, r1: c1.r, g1: c1.g, b1: c1.b,
        a0: o.alpha?.[0] ?? 1, a1: o.alpha?.[1] ?? 0,
      });
    }
  }

  update(dt: number) {
    let k = 0;
    const keep: Particle[] = [];
    for (const p of this.ps) {
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
      keep.push(p);
      k++;
    }
    this.ps = keep;
    this.geo.instanceCount = k;
    (this.geo.getAttribute('iPos') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('iCol') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('iSize') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  clear() {
    this.ps = [];
    this.geo.instanceCount = 0;
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
  varying vec4 vCol; varying float vV;
  void main(){
    float a = 1.0 - abs(vV) * 2.0;
    a = pow(max(a, 0.0), 1.5);
    gl_FragColor = vec4(vCol.rgb * (1.0 + a), a * vCol.a);
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
    const keep: Ribbon[] = [];
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    for (const r of this.rs) {
      r.age += dt;
      if (r.age >= r.life) continue;
      const t = r.age / r.life;
      tmpA.copy(r.a);
      tmpB.copy(r.b);
      if (r.grow) {
        // moving bullet streak: a short segment travelling from a to b
        const L = r.a.distanceTo(r.b);
        const head = Math.min(L, r.grow * r.age);
        const tail = Math.max(0, head - Math.min(12, L * 0.4));
        const dir = tmpB.clone().sub(r.a).normalize();
        tmpB.copy(r.a).addScaledVector(dir, head);
        tmpA.copy(r.a).addScaledVector(dir, tail);
      }
      this.A.set([tmpA.x, tmpA.y, tmpA.z], k * 3);
      this.B.set([tmpB.x, tmpB.y, tmpB.z], k * 3);
      this.C.set([r.c.r, r.c.g, r.c.b, r.alpha * (1 - t) * (1 - t)], k * 4);
      this.W[k] = r.w * (1 - t * 0.5);
      keep.push(r);
      k++;
    }
    this.rs = keep;
    this.geo.instanceCount = k;
    for (const n of ['iA', 'iB', 'iCol', 'iW']) (this.geo.getAttribute(n) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  clear() {
    this.rs = [];
    this.geo.instanceCount = 0;
  }
}

/** Handful of pooled point lights for muzzle flashes & explosions. */
export class FlashLights {
  private lights: { l: THREE.PointLight; life: number; age: number; i0: number }[] = [];
  constructor(scene: THREE.Scene, n = 3) {
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 20, 2);
      l.visible = false;
      scene.add(l);
      this.lights.push({ l, life: 1, age: 1, i0: 0 });
    }
  }
  flash(pos: THREE.Vector3, color: number, intensity: number, range: number, life: number) {
    const slot = this.lights.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    slot.l.position.copy(pos);
    slot.l.color.setHex(color);
    slot.l.distance = range;
    slot.i0 = intensity;
    slot.life = life;
    slot.age = 0;
    slot.l.visible = true;
  }
  update(dt: number) {
    for (const s of this.lights) {
      if (s.age >= s.life) {
        s.l.visible = false;
        continue;
      }
      s.age += dt;
      s.l.intensity = s.i0 * Math.max(0, 1 - s.age / s.life);
    }
  }
}

const decalVS = /* glsl */ `
  attribute float iAlpha;
  varying vec2 vUv; varying float vA; varying vec3 vC;
  void main(){
    vUv = uv;
    vA = iAlpha;
    #ifdef USE_INSTANCING_COLOR
    vC = instanceColor;
    #else
    vC = vec3(1.0);
    #endif
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
const decalFS = /* glsl */ `
  varying vec2 vUv; varying float vA; varying vec3 vC;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float ang = atan(p.y, p.x);
    // blobby splat edge
    float edge = 0.78 + 0.12 * sin(ang * 5.0) + 0.06 * sin(ang * 11.0 + 1.3);
    float a = smoothstep(edge, edge - 0.12, r);
    if (a * vA < 0.01) discard;
    gl_FragColor = vec4(vC * (0.9 + 0.1 * (1.0 - r)), a * vA);
  }`;

/** Flat splats on the ground (Gerry Sauce, scorch marks) that fade away — one instanced draw call. */
export class Decals {
  readonly mesh: THREE.InstancedMesh;
  private items: { age: number; life: number; a0: number }[] = [];
  private alpha: Float32Array;
  private next = 0;
  constructor(private max = 48) {
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.alpha = new Float32Array(max);
    geo.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({ vertexShader: decalVS, fragmentShader: decalFS, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      this.mesh.setColorAt(i, new THREE.Color(0xffffff));
      this.items.push({ age: 1, life: 1, a0: 0 });
    }
  }

  /** A splat of radius `r` lying on the ground at `pos`. */
  add(pos: THREE.Vector3, r: number, color: number, life = 8, alpha = 0.95) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const m4 = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28), new THREE.Vector3(r, 1, r));
    this.mesh.setMatrixAt(i, m4);
    // the shader writes the colour out untouched: keep it as the exact sRGB palette colour
    this.mesh.setColorAt(i, new THREE.Color().setHex(color, THREE.LinearSRGBColorSpace));
    this.items[i] = { age: 0, life, a0: alpha };
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      const it = this.items[i]!;
      it.age += dt;
      // fade over the last 2 seconds
      this.alpha[i] = it.age >= it.life ? 0 : it.a0 * Math.min(1, (it.life - it.age) / 2);
    }
    (this.mesh.geometry.getAttribute('iAlpha') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}
