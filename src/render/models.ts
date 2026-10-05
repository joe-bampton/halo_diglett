import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponId } from '../sim/weapons';
import { PAL, SAUCE } from './palette';
import { DISPLAY_COLOR } from './shaderUtil';

type Part = [THREE.BufferGeometry, number | THREE.Material];

/** Bake a solid colour into a geometry's vertex colours (non-indexed). */
function tint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** Merge coloured parts into a single vertex-coloured mesh; material parts stay separate. */
function assemble(parts: Part[], mat?: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const solid = parts.filter((p) => typeof p[1] === 'number').map(([geo, c]) => tint(geo, c as number));
  if (solid.length) {
    const mesh = new THREE.Mesh(mergeGeometries(solid)!, mat ?? new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true;
    g.add(mesh);
  }
  for (const [geo, m] of parts) {
    if (typeof m === 'number') continue;
    g.add(new THREE.Mesh(geo, m));
  }
  return g;
}

const glow = (hex: number) => new THREE.MeshBasicMaterial({ color: hex, toneMapped: false });

/**
 * High / Ultra: swap a freshly built model's Lambert / Phong materials for physically based ones that
 * pick up the sky's reflections (scene.environment). Only for materials the model owns.
 */
function pbrify(root: THREE.Object3D, o: { roughness: number; metalness: number }) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const conv = (m: THREE.Material): THREE.Material => {
      if (!(m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshPhongMaterial)) return m;
      const shiny = m instanceof THREE.MeshPhongMaterial ? m.shininess : 0;
      const std = new THREE.MeshStandardMaterial({
        color: m.color, map: m.map, vertexColors: m.vertexColors, emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity,
        transparent: m.transparent, opacity: m.opacity, side: m.side, flatShading: m.flatShading,
        roughness: shiny ? Math.min(0.8, Math.max(0.12, 1 - shiny / 140)) : o.roughness,
        metalness: o.metalness,
      });
      m.dispose();
      return std;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
  });
}

/**
 * Weapon models share one convention: barrel points toward -Z, origin at the grip,
 * muzzle position stored in userData.muzzle.
 */
export function buildWeaponModel(id: WeaponId, pbr = false): THREE.Group {
  const dark = 0x3a4148, mid = 0x5c6670, light = 0x8a949d;
  let g: THREE.Group;
  let muzzle = new THREE.Vector3(0, 0.05, -0.9);
  switch (id) {
    case 'sniper':
      g = assemble([
        [new THREE.BoxGeometry(0.09, 0.12, 0.7).translate(0, 0.02, -0.15), dark],
        [new THREE.CylinderGeometry(0.025, 0.03, 0.75, 8).rotateX(Math.PI / 2).translate(0, 0.05, -0.85), mid],
        [new THREE.CylinderGeometry(0.045, 0.05, 0.34, 10).rotateX(Math.PI / 2).translate(0, 0.14, -0.2), dark],
        [new THREE.CylinderGeometry(0.038, 0.038, 0.02, 10).rotateX(Math.PI / 2).translate(0, 0.14, -0.38), glow(0x6ad8ff)],
        [new THREE.BoxGeometry(0.07, 0.14, 0.26).translate(0, -0.01, 0.28), mid],
        [new THREE.BoxGeometry(0.05, 0.14, 0.07).translate(0, -0.1, 0.05), dark],
        [new THREE.BoxGeometry(0.06, 0.11, 0.08).translate(0, -0.08, -0.12), light],
      ]);
      muzzle = new THREE.Vector3(0, 0.05, -1.23);
      break;
    case 'br':
      g = assemble([
        [new THREE.BoxGeometry(0.1, 0.14, 0.62).translate(0, 0.02, -0.12), 0x4b5a3c],
        [new THREE.CylinderGeometry(0.025, 0.025, 0.25, 8).rotateX(Math.PI / 2).translate(0, 0.04, -0.52), dark],
        [new THREE.BoxGeometry(0.06, 0.07, 0.18).translate(0, 0.12, -0.12), dark],
        [new THREE.BoxGeometry(0.05, 0.14, 0.08).translate(0, -0.1, 0.04), dark],
        [new THREE.BoxGeometry(0.05, 0.12, 0.1).translate(0, -0.08, -0.12), mid],
      ]);
      muzzle = new THREE.Vector3(0, 0.04, -0.66);
      break;
    case 'crossbow':
      g = assemble([
        [new THREE.BoxGeometry(0.08, 0.1, 0.7).translate(0, 0.02, -0.15), 0x5a3f2a],
        [new THREE.BoxGeometry(0.7, 0.03, 0.05).translate(0, 0.05, -0.45), dark],
        [new THREE.BoxGeometry(0.03, 0.03, 0.55).translate(0.0, 0.07, -0.3), glow(0x9fe8ff)],
        [new THREE.BoxGeometry(0.05, 0.14, 0.07).translate(0, -0.09, 0.03), dark],
      ]);
      muzzle = new THREE.Vector3(0, 0.07, -0.6);
      break;
    case 'rpg':
      g = assemble([
        [new THREE.CylinderGeometry(0.1, 0.1, 1.1, 12).rotateX(Math.PI / 2).translate(0, 0.08, -0.3), 0x5f6b3a],
        [new THREE.CylinderGeometry(0.12, 0.1, 0.12, 12).rotateX(Math.PI / 2).translate(0, 0.08, -0.86), dark],
        [new THREE.BoxGeometry(0.08, 0.1, 0.18).translate(0, 0.2, -0.3), dark],
        [new THREE.BoxGeometry(0.05, 0.14, 0.07).translate(0, -0.06, 0.0), dark],
      ]);
      muzzle = new THREE.Vector3(0, 0.08, -0.95);
      break;
    case 'grenade':
      g = assemble([
        [new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10).rotateX(Math.PI / 2).translate(0, 0.05, -0.3), mid],
        [new THREE.CylinderGeometry(0.13, 0.13, 0.16, 12).rotateX(Math.PI / 2).translate(0, 0.0, -0.08), 0x3d5a2e],
        [new THREE.BoxGeometry(0.05, 0.14, 0.07).translate(0, -0.1, 0.05), dark],
        [new THREE.TorusGeometry(0.07, 0.012, 6, 12).translate(0, 0.05, -0.55), glow(0x7cff6b)],
      ]);
      muzzle = new THREE.Vector3(0, 0.05, -0.58);
      break;
    case 'railgun':
      g = assemble([
        [new THREE.BoxGeometry(0.12, 0.12, 0.8).translate(0, 0.03, -0.25), 0x2e3440],
        [new THREE.BoxGeometry(0.03, 0.14, 0.7).translate(0.07, 0.03, -0.3), glow(0x6ad8ff)],
        [new THREE.BoxGeometry(0.03, 0.14, 0.7).translate(-0.07, 0.03, -0.3), glow(0x6ad8ff)],
        [new THREE.BoxGeometry(0.05, 0.14, 0.07).translate(0, -0.1, 0.05), dark],
      ]);
      muzzle = new THREE.Vector3(0, 0.03, -0.68);
      break;
    case 'hyperbeam':
      g = assemble([
        [new THREE.CylinderGeometry(0.12, 0.16, 0.7, 10).rotateX(Math.PI / 2).translate(0, 0.05, -0.25), 0x5b2a6e],
        [new THREE.SphereGeometry(0.11, 12, 8).translate(0, 0.05, -0.64), glow(0xff4df0)],
        [new THREE.TorusGeometry(0.15, 0.025, 6, 16).translate(0, 0.05, -0.45), glow(0xffa0ff)],
        [new THREE.BoxGeometry(0.05, 0.14, 0.07).translate(0, -0.1, 0.05), dark],
      ]);
      muzzle = new THREE.Vector3(0, 0.05, -0.72);
      break;
    case 'needler': {
      const parts: Part[] = [
        [new THREE.BoxGeometry(0.12, 0.14, 0.45).translate(0, 0.02, -0.15), 0x5b2b6b],
        [new THREE.BoxGeometry(0.05, 0.14, 0.07).translate(0, -0.1, 0.05), dark],
      ];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 0.9 - 0.45 * Math.PI;
        parts.push([new THREE.ConeGeometry(0.018, 0.2, 4).translate(Math.sin(a) * 0.05, 0.14 + Math.cos(a) * 0.02, -0.12 - i * 0.04).rotateX(-0.4), glow(0xff5fd2)]);
      }
      g = assemble(parts);
      muzzle = new THREE.Vector3(0, 0.05, -0.4);
      break;
    }
    case 'flamethrower':
      g = assemble([
        [new THREE.CylinderGeometry(0.05, 0.05, 0.65, 8).rotateX(Math.PI / 2).translate(0, 0.05, -0.35), mid],
        [new THREE.CylinderGeometry(0.1, 0.1, 0.3, 10).translate(0, -0.05, -0.05), 0xc0392b],
        [new THREE.ConeGeometry(0.07, 0.12, 8).rotateX(-Math.PI / 2).translate(0, 0.05, -0.72), dark],
        [new THREE.SphereGeometry(0.03, 6, 4).translate(0, 0.05, -0.8), glow(0x6ab0ff)],
      ]);
      muzzle = new THREE.Vector3(0, 0.05, -0.8);
      break;
    case 'minigun': {
      const parts: Part[] = [
        [new THREE.BoxGeometry(0.22, 0.2, 0.3).translate(0, 0, 0.05), 0x5a5f55],
        [new THREE.BoxGeometry(0.05, 0.16, 0.08).translate(0, -0.15, 0.1), dark],
      ];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push([new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * 0.06, Math.sin(a) * 0.06, -0.45), dark]);
      }
      g = assemble(parts);
      muzzle = new THREE.Vector3(0, 0, -0.88);
      break;
    }
    case 'soaker': {
      // chunky toy water blaster with a see-through tank of Gerry Sauce
      const tank = new THREE.MeshPhongMaterial({ color: SAUCE.base, specular: SAUCE.gloss, shininess: 90, transparent: true, opacity: 0.85 });
      g = assemble([
        [new THREE.BoxGeometry(0.13, 0.16, 0.5).translate(0, 0.0, -0.12), 0xff7a1a],
        [new THREE.CylinderGeometry(0.035, 0.045, 0.3, 10).rotateX(Math.PI / 2).translate(0, 0.03, -0.5), 0x2fbf4a],
        [new THREE.CylinderGeometry(0.05, 0.05, 0.06, 10).rotateX(Math.PI / 2).translate(0, 0.03, -0.66), 0xf2c230],
        [new THREE.BoxGeometry(0.1, 0.07, 0.24).translate(0, -0.09, -0.3), 0x2fbf4a],
        [new THREE.BoxGeometry(0.06, 0.16, 0.08).translate(0, -0.13, 0.05), 0xff7a1a],
        [new THREE.CylinderGeometry(0.1, 0.1, 0.26, 14).rotateZ(Math.PI / 2).translate(0, 0.16, -0.1), tank],
        [new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8).translate(0, 0.28, -0.1), 0xf2c230],
      ]);
      muzzle = new THREE.Vector3(0, 0.03, -0.7);
      break;
    }
    case 'orbital':
      g = assemble([
        [new THREE.BoxGeometry(0.1, 0.12, 0.35).translate(0, 0.02, -0.1), 0x3a3f45],
        [new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8).rotateX(Math.PI / 2).translate(0, 0.05, -0.35), dark],
        [new THREE.SphereGeometry(0.03, 8, 6).translate(0, 0.05, -0.46), glow(0xff2020)],
        [new THREE.BoxGeometry(0.05, 0.14, 0.07).translate(0, -0.1, 0.05), dark],
      ]);
      muzzle = new THREE.Vector3(0, 0.05, -0.48);
      break;
  }
  g.userData.muzzle = muzzle;
  if (pbr) pbrify(g, { roughness: 0.42, metalness: 0.55 });
  return g;
}

// ------------------------------------------------------------------------------------------------
// Spartan
// ------------------------------------------------------------------------------------------------

const shellMaterial = (hex: number) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(hex) }, strength: { value: 0 }, time: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${DISPLAY_COLOR}
      uniform vec3 color; uniform float strength; uniform float time;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
        float bands = 0.75 + 0.25 * sin(vP.y * 40.0 - time * 6.0);
        gl_FragColor = displayColor(vec4(color * (f * 1.6 + 0.08) * bands * strength, 1.0));
      }`,
  });

export interface SpartanParts {
  root: THREE.Group;
  body: THREE.Group;
  aim: THREE.Group;
  head: THREE.Group;
  weaponHolder: THREE.Group;
  mat: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;
  visor: THREE.MeshPhongMaterial | THREE.MeshStandardMaterial;
  shell: THREE.Mesh;
  shellMat: THREE.ShaderMaterial;
  catHat: THREE.Group;
  materials: THREE.Material[];
}

export function buildSpartan(color: number, pbr = false): SpartanParts {
  const armorC = color;
  const accentC = new THREE.Color(color).multiplyScalar(0.62).getHex();
  const suitC = PAL.undersuit;
  // High / Ultra: satin armour and a mirrored gold visor that reflect the sky
  const mat = pbr ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.18 }) : new THREE.MeshLambertMaterial({ vertexColors: true });
  const visor = pbr
    ? new THREE.MeshStandardMaterial({ color: 0xc08a20, metalness: 0.9, roughness: 0.18, emissive: 0x2a1800 })
    : new THREE.MeshPhongMaterial({ color: 0x9a6410, specular: 0xffe8a8, shininess: 120, emissive: 0x3a2200 });
  const root = new THREE.Group();
  const mk = (parts: Part[]) => {
    const g = assemble(parts, mat);
    return g;
  };
  const T = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    return geo.applyMatrix4(m);
  };
  const body = mk([
    [T(new THREE.CylinderGeometry(0.26, 0.24, 1.3, 10), 0, -0.55, 0), suitC],
    [T(new THREE.CapsuleGeometry(0.3, 0.32, 4, 10).scale(1.05, 1, 0.72), 0, 0.32, 0), armorC],
    [T(new THREE.BoxGeometry(0.5, 0.32, 0.12), 0, 0.42, -0.2), accentC],
    [T(new THREE.BoxGeometry(0.2, 0.06, 0.05), 0, 0.5, -0.27), 0x8fe3ff],
    [T(new THREE.CylinderGeometry(0.28, 0.3, 0.14, 10), 0, 0.05, 0), suitC],
    [T(new THREE.CylinderGeometry(0.1, 0.12, 0.16, 8), 0, 0.7, 0), suitC],
  ]);
  root.add(body);
  const aimParts: Part[] = [];
  for (const sx of [-1, 1]) {
    aimParts.push([T(new THREE.SphereGeometry(0.17, 10, 8).scale(1.1, 0.85, 1.05), sx * 0.38, 0, 0, 0, 0, sx * 0.3), armorC]);
    aimParts.push([T(new THREE.BoxGeometry(0.2, 0.08, 0.28), sx * 0.4, 0.1, 0), accentC]);
  }
  aimParts.push([T(new THREE.CapsuleGeometry(0.075, 0.34, 3, 6), -0.3, -0.15, -0.18, 1.1, 0, 0.35), suitC]);
  aimParts.push([T(new THREE.CapsuleGeometry(0.075, 0.34, 3, 6), 0.32, -0.18, -0.08, 1.3, 0, -0.35), suitC]);
  aimParts.push([T(new THREE.SphereGeometry(0.075, 8, 6), -0.12, -0.2, -0.42), armorC]);
  aimParts.push([T(new THREE.SphereGeometry(0.075, 8, 6), 0.14, -0.22, -0.22), armorC]);
  const aim = mk(aimParts);
  aim.position.set(0, 0.58, 0);
  body.add(aim);
  const headParts: Part[] = [
    [new THREE.SphereGeometry(0.22, 16, 12).scale(0.95, 1.05, 1.08), armorC],
    [T(new THREE.BoxGeometry(0.1, 0.1, 0.28), 0, 0.17, 0.02), accentC],
  ];
  for (const sx of [-1, 1]) headParts.push([T(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8), sx * 0.2, -0.02, 0.02, 0, 0, Math.PI / 2), accentC]);
  const head = mk(headParts);
  head.position.set(0, 0.37, 0);
  aim.add(head);
  const vis = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.32, Math.PI * 0.3).scale(1.02, 1.05, 1.12), visor);
  vis.position.set(0, -0.01, -0.012);
  head.add(vis);
  const weaponHolder = new THREE.Group();
  weaponHolder.position.set(0.05, -0.2, -0.3);
  aim.add(weaponHolder);
  const shellMat = shellMaterial(0x40ff70);
  const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 0.72, 4, 12), shellMat);
  shell.position.set(0, 0.46, 0);
  shell.visible = false;
  body.add(shell);
  const catHat = buildCatHat();
  catHat.visible = false;
  head.add(catHat);
  return { root, body, aim, head, weaponHolder, mat, visor, shell, shellMat, catHat, materials: [mat, visor] };
}

/** Original Seuss-inspired costume: tall red/white striped hat, bow tie, cat ears & whiskers. */
export function buildCatHat(): THREE.Group {
  const RED = 0xd8202a, WHITE = 0xfafafa, BLACK = 0x151515, PINK = 0xff9ab8;
  const parts: Part[] = [];
  const hatM = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.19, 0.02), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.12)), new THREE.Vector3(1, 1, 1));
  const H = (g: THREE.BufferGeometry) => g.applyMatrix4(hatM);
  parts.push([H(new THREE.CylinderGeometry(0.28, 0.28, 0.035, 20)), RED]);
  for (let i = 0; i < 6; i++) {
    const h = 0.11;
    const r0 = 0.16 + i * 0.006, r1 = 0.16 + (i + 1) * 0.006;
    parts.push([H(new THREE.CylinderGeometry(r1, r0, h, 18).translate(0, 0.02 + h / 2 + i * h, 0)), i % 2 ? WHITE : RED]);
  }
  for (const sx of [-1, 1]) {
    parts.push([new THREE.ConeGeometry(0.08, 0.16, 4).rotateZ((sx * Math.PI) / 2).translate(sx * 0.075, -0.28, -0.16), RED]);
    parts.push([new THREE.ConeGeometry(0.075, 0.16, 4).rotateZ(-sx * 0.35).translate(sx * 0.15, 0.2, 0.02), BLACK]);
    parts.push([new THREE.ConeGeometry(0.04, 0.1, 4).rotateZ(-sx * 0.35).translate(sx * 0.15, 0.19, -0.02), PINK]);
    for (let w = 0; w < 3; w++) parts.push([new THREE.BoxGeometry(0.2, 0.008, 0.008).rotateZ(sx * (w - 1) * 0.18).translate(sx * 0.2, -0.07 + w * 0.03, -0.18), WHITE]);
  }
  parts.push([new THREE.SphereGeometry(0.035, 8, 6).translate(0, -0.28, -0.16), RED]);
  parts.push([new THREE.SphereGeometry(0.025, 8, 6).translate(0, -0.05, -0.23), PINK]);
  return assemble(parts);
}

// ------------------------------------------------------------------------------------------------
// Power-up orb (capture-ball style capsule)
// ------------------------------------------------------------------------------------------------

/** Geometry / materials used by many objects at once: never disposed with any one of them (see disposeTree). */
export const SHARED = new Set<unknown>();
const share = <T>(x: T): T => (SHARED.add(x), x);

/** Pitre Mode energy drink can: radius and height (m). It fits inside the power-up's hit sphere (ORB_R). */
export const CAN_R = 0.3;
export const CAN_H = 1.44;
let canParts: { metal: THREE.BufferGeometry; metalMat: THREE.Material; metalPbr: THREE.Material; body: THREE.BufferGeometry; aura: THREE.BufferGeometry } | null = null;
const canLabels = new Map<string, THREE.Material>();

/** Tiny seeded random, so a can's scratches look the same every time. */
function seeded(seed: number) {
  let x = seed >>> 0 || 1;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Three jagged claw scratches (an original design — no real logos), centred at x = cx. */
function drawClaws(ctx: CanvasRenderingContext2D, cx: number, top: number, bottom: number, rnd: () => number) {
  for (let i = -1; i <= 1; i++) {
    const x0 = cx + i * 40 + 26, x1 = cx + i * 40 - 26;
    const y0 = top + (i === 0 ? 0 : 14), y1 = bottom - (i === 0 ? 0 : 18);
    const n = 22;
    const left: [number, number][] = [], right: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const s = k / n;
      const x = x0 + (x1 - x0) * s + Math.sin(s * Math.PI * 2.2 + i) * 4;
      const y = y0 + (y1 - y0) * s;
      const w = 12 * Math.pow(Math.sin(Math.PI * s), 0.6) + 0.8;
      left.push([x - w - rnd() * 5, y]);
      right.push([x + w + rnd() * 5, y]);
    }
    ctx.beginPath();
    ctx.moveTo(left[0]![0], left[0]![1]);
    for (const [x, y] of left) ctx.lineTo(x, y);
    for (const [x, y] of right.reverse()) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  }
}

/** The can's wrap-around label (and a glow map so the scratches light up), in the power-up's colour. */
function canLabel(color: number, pbr: boolean): THREE.Material {
  const key = `${color}:${pbr}`;
  let mat = canLabels.get(key);
  if (mat) return mat;
  const W = 512, H = 328;
  const css = `#${color.toString(16).padStart(6, '0')}`;
  const make = (glow: boolean) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = glow ? '#000' : '#0b0c0e';
    ctx.fillRect(0, 0, W, H);
    const rnd = seeded(color);
    if (!glow) {
      // brushed metal under the black paint
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.015 + rnd() * 0.035})`;
        ctx.fillRect(rnd() * W, 0, 1, H);
      }
    }
    ctx.fillStyle = css;
    ctx.shadowColor = css;
    ctx.shadowBlur = glow ? 10 : 18;
    // one set of scratches on each side
    for (const cx of [W * 0.25, W * 0.75]) drawClaws(ctx, cx, 26, 252, seeded(color + cx));
    ctx.shadowBlur = 0;
    if (!glow) {
      ctx.font = '800 34px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f2f2f2';
      for (const cx of [W * 0.25, W * 0.75]) ctx.fillText('E N E R G Y', cx, 294);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  const map = make(false), emissiveMap = make(true);
  mat = share(
    pbr
      ? new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.32, metalness: 0.55 })
      : new THREE.MeshPhongMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.75, specular: 0x8a8f96, shininess: 70 }),
  );
  canLabels.set(key, mat);
  return mat;
}

/** Pitre Mode power-up: a tall energy drink can — black, silver ends, claw scratches in the power-up's colour. */
export function buildCan(color: number, pbr = false): THREE.Group {
  if (!canParts) {
    const r = CAN_R, h = CAN_H / 2;
    const v = (pts: number[][]) => pts.map(([x, y]) => new THREE.Vector2(x!, y!));
    // aluminium ends (lathe profiles, bottom to top): domed base on a standing ring; shoulder, rolled rim, recessed lid
    const base = new THREE.LatheGeometry(v([[0, -h + 0.05], [0.2, -h + 0.06], [0.24, -h], [0.27, -h + 0.004], [0.293, -h + 0.045], [r, -h + 0.1]]), 32);
    const lid = new THREE.LatheGeometry(v([[r, h - 0.13], [0.287, h - 0.075], [0.256, h - 0.035], [0.263, h - 0.01], [0.255, h], [0.236, h - 0.012], [0.226, h - 0.03], [0, h - 0.03]]), 32);
    // pull tab and rivet on the lid
    const tab = new THREE.TorusGeometry(0.06, 0.014, 6, 18).rotateX(Math.PI / 2).scale(1, 1, 1.35).translate(0, h - 0.02, 0.06);
    const rivet = new THREE.CylinderGeometry(0.024, 0.024, 0.02, 10).translate(0, h - 0.024, 0);
    const parts = [base, lid, tab, rivet].map((g) => (g.index ? g.toNonIndexed() : g));
    for (const g of parts) g.deleteAttribute('uv');
    canParts = {
      metal: share(mergeGeometries(parts)!),
      metalMat: share(new THREE.MeshPhongMaterial({ color: 0xc9cdd2, specular: 0xffffff, shininess: 110 })),
      metalPbr: share(new THREE.MeshStandardMaterial({ color: 0xd4d8dd, metalness: 1, roughness: 0.28 })),
      // the painted wall between the ends: label u runs once around, v bottom to top
      body: share(new THREE.CylinderGeometry(r, r, CAN_H - 0.23, 32, 1, true).translate(0, -0.015, 0)),
      aura: share(new THREE.SphereGeometry(1, 18, 12)),
    };
  }
  const g = new THREE.Group();
  const metal = new THREE.Mesh(canParts.metal, pbr ? canParts.metalPbr : canParts.metalMat);
  const body = new THREE.Mesh(canParts.body, canLabel(color, pbr));
  const aura = new THREE.Mesh(canParts.aura, shellMaterial(color));
  aura.scale.set(0.5, 0.98, 0.5);
  (aura.material as THREE.ShaderMaterial).uniforms.strength!.value = 0.9;
  g.add(metal, body, aura);
  g.userData.aura = aura;
  g.userData.kind = 'can';
  return g;
}

export function buildOrb(color: number, pbr = false): THREE.Group {
  const g = new THREE.Group();
  const R = 0.62;
  const top = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0xe0282e, shininess: 80, specular: 0xffffff }));
  const bottom = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0xf8f8f8, shininess: 80, specular: 0xffffff }));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.005, R * 1.005, 0.1, 24, 1, true), new THREE.MeshLambertMaterial({ color: 0x1a1a1a, side: THREE.DoubleSide }));
  const btnOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 18).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  btnOuter.position.z = -R + 0.02;
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 18).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color }));
  btn.position.z = -R;
  const aura = new THREE.Mesh(new THREE.SphereGeometry(R * 1.35, 18, 12), shellMaterial(color));
  (aura.material as THREE.ShaderMaterial).uniforms.strength!.value = 0.9;
  g.add(top, bottom, band, btnOuter, btn, aura);
  g.userData.aura = aura;
  g.userData.kind = 'ball';
  if (pbr) pbrify(g, { roughness: 0.6, metalness: 0 });
  return g;
}

let sauceParts: { geo: THREE.BufferGeometry; mat: THREE.Material } | null = null;

/** A lumpy dollop of Gerry Sauce (custard) to stick on a sauced player. Shared geometry — don't dispose. */
export function buildSauceBlob(): THREE.Mesh {
  if (!sauceParts) {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = 1 + 0.18 * Math.sin(x * 5.1 + y * 2.3) * Math.cos(z * 4.7 - y * 1.7) - (y < -0.2 ? 0.15 : 0);
      pos.setXYZ(i, x * k, y * k * 0.7, z * k);
    }
    geo.computeVertexNormals();
    sauceParts = { geo, mat: new THREE.MeshPhongMaterial({ color: SAUCE.base, specular: SAUCE.gloss, shininess: 90, emissive: 0x1c1a14 }) };
  }
  return new THREE.Mesh(sauceParts.geo, sauceParts.mat);
}

let springParts: { coil: THREE.BufferGeometry; plate: THREE.BufferGeometry; metal: THREE.Material; pad: THREE.Material } | null = null;

/** Giant coil spring that pops out of a hole for a Spring Jump: 1 m tall, scaled in Y at runtime. Shared geometry — don't dispose. */
export function buildSpring(): THREE.Group {
  if (!springParts) {
    const turns = 6, perTurn = 24;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= turns * perTurn; i++) {
      const a = (i / perTurn) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.42, i / (turns * perTurn), Math.sin(a) * 0.42));
    }
    springParts = {
      coil: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * perTurn, 0.05, 6, false),
      plate: new THREE.CylinderGeometry(0.55, 0.55, 0.07, 18).translate(0, 1, 0),
      metal: new THREE.MeshLambertMaterial({ color: 0xc9d2da }),
      pad: new THREE.MeshLambertMaterial({ color: 0x3cffd0, emissive: 0x0b4a3c }),
    };
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(springParts.coil, springParts.metal), new THREE.Mesh(springParts.plate, springParts.pad));
  return g;
}

/** Canvas sprite with text (names, orb icons). */
export function textSprite(text: string, color = '#ffffff', size = 48, bg = 'rgba(0,0,0,0)'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + size;
  canvas.width = w;
  canvas.height = Math.ceil(size * 1.5);
  ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = size / 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, w / 2, canvas.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set((w / canvas.height) * 0.4, 0.4, 1);
  s.renderOrder = 10;
  return s;
}
