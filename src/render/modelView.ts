import * as THREE from 'three';
import { HEAD_R, HEAD_Y, TORSO_R, TORSO_Y0, TORSO_Y1 } from '../sim/constants';
import { drop } from '../sim/hitbox';
import { WEAPON_IDS, type WeaponId } from '../sim/weapons';
import { AI, AI_CHARACTERS, AI_PROPS, type AiSlot } from './aiModels';
import { loadAiModels, loadDetailedModels } from './assets';
import { buildCan, buildSpartan, buildSpring, buildWeaponModel, setCatCostume, textSprite } from './models';
import { buildSky } from './world';

/**
 * `?modelview=<slot>`: the built-in model (left) next to the AI-made one (right), turning, so an AI model's fit can be
 * checked and tuned (models-src/models.json). Characters stand on a rim ring with their hitboxes drawn in, aim up and
 * down and duck; weapons show their grip (green) and muzzle (red). `?modelview=all` lines up every AI model there is.
 * Add `&still` to stop the turning (for screenshots).
 */
export async function showModelView(root: HTMLElement, slot: string) {
  await Promise.all([loadDetailedModels(), loadAiModels()]);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping;
  root.innerHTML = '';
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b2a38);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.add(buildSky());
  scene.environment = pm.fromScene(env, 0.02, 0.1, 1000).texture;
  scene.environmentIntensity = 0.85;
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a5a3a, 1.3));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.3);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100);
  const still = new URLSearchParams(location.search).has('still');

  const isChar = (s: string) => (AI_CHARACTERS as readonly string[]).includes(s);
  const isWeapon = (s: string): s is WeaponId => (WEAPON_IDS as string[]).includes(s);
  const turners: THREE.Object3D[] = [];
  const animated: { root: THREE.Object3D; aim: THREE.Object3D; hit: THREE.Object3D }[] = [];

  const label = (text: string, x: number, y: number) => {
    const sp = textSprite(text, '#ffffff', 30);
    sp.position.set(x, y, 0);
    scene.add(sp);
  };
  /** one model, built the game's way (`ai`: with the AI-made models, or the built-in ones) */
  const build = (s: string, ai: boolean): THREE.Object3D | null => {
    const saved = AI[s as AiSlot];
    if (!ai) delete AI[s as AiSlot];
    try {
      if (s === 'spartan' || s === 'cat') {
        const p = buildSpartan(0x3d7bff, true, true);
        if (s === 'cat') setCatCostume(p, true);
        p.weaponHolder.add(buildWeaponModel('sniper', true, true));
        p.root.userData.aim = p.aim;
        return p.root;
      }
      if (s === 'can') return buildCan(0x40ff70, true, true);
      if (s === 'spring') return buildSpring(true);
      if (isWeapon(s)) return buildWeaponModel(s, true, true);
      return null;
    } finally {
      if (saved) AI[s as AiSlot] = saved;
    }
  };
  /** a model with its guides, at x */
  const place = (s: string, ai: boolean, x: number) => {
    const g = new THREE.Group();
    g.position.x = x;
    scene.add(g);
    const obj = build(s, ai);
    if (!obj) return;
    if (isChar(s)) {
      // the rim, and the hitboxes the game uses (what you see should be what you can hit)
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.9, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7d8186, roughness: 1, side: THREE.DoubleSide }));
      g.add(rim);
      const wire = new THREE.MeshBasicMaterial({ color: 0xff4040, wireframe: true, transparent: true, opacity: 0.35 });
      const headBox = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 12, 8), wire);
      const torsoBox = new THREE.Mesh(new THREE.CapsuleGeometry(TORSO_R, TORSO_Y1 - TORSO_Y0, 4, 10), wire);
      const hit = new THREE.Group();
      headBox.position.y = HEAD_Y;
      torsoBox.position.y = (TORSO_Y0 + TORSO_Y1) / 2;
      hit.add(headBox, torsoBox);
      g.add(hit, obj);
      animated.push({ root: obj, aim: obj.userData.aim as THREE.Object3D, hit });
    } else {
      g.add(obj);
      if (isWeapon(s)) {
        const dot = (c: number, p: THREE.Vector3) => {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshBasicMaterial({ color: c, depthTest: false }));
          m.position.copy(p);
          m.renderOrder = 10;
          obj.add(m);
        };
        dot(0x30ff60, new THREE.Vector3());
        dot(0xff3030, obj.userData.muzzle as THREE.Vector3);
      }
    }
    turners.push(obj);
  };

  const slots = slot === 'all' || !slot ? ([...AI_CHARACTERS, ...AI_PROPS, ...WEAPON_IDS] as string[]).filter((s) => AI[s as AiSlot]) : [slot];
  let span = 1;
  if (slots.length === 1) {
    const s = slots[0]!;
    span = isChar(s) ? 2.4 : isWeapon(s) ? Math.max(0.5, 1.2) : 1.6;
    place(s, false, -span / 2);
    place(s, true, span / 2);
    const top = isChar(s) ? 1.55 : isWeapon(s) ? 0.45 : 1.2;
    label('built-in', -span / 2, top);
    label(AI[s as AiSlot] ? `AI: ${s}` : `no AI model for "${s}"`, span / 2, top);
  } else {
    slots.forEach((s, i) => {
      const x = (i - (slots.length - 1) / 2) * 2.2;
      place(s, true, x);
      label(s, x, 1.55);
    });
    span = Math.max(2, slots.length * 2.2);
  }
  const char = slots.some(isChar);
  camera.position.set(0, char ? 0.6 : 0.35, span * 1.25 + (char ? 2.6 : 1.2));
  camera.lookAt(0, char ? 0.1 : 0, 0);

  const t0 = performance.now();
  const frame = () => {
    const t = (performance.now() - t0) / 1000;
    for (const o of turners) o.rotation.y = still ? -0.6 : t * 0.6;
    // characters aim up and down, and duck now and then (the cuts at waist and neck must hold up)
    for (const a of animated) {
      const e = still ? 1 : Math.min(1, Math.max(0, 0.5 + Math.sin(t * 0.7) * 1.2));
      a.root.position.y = a.hit.position.y = drop(e);
      a.aim.rotation.x = still ? 0.25 : Math.sin(t * 1.3) * 0.5;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  frame();
  (window as unknown as { __modelview: unknown }).__modelview = { ready: true, slots, ai: Object.keys(AI) };
}
