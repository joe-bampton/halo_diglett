import * as THREE from 'three';
import { WEAPON_IDS, type WeaponId } from '../sim/weapons';
import { AI, AI_CHARACTERS, AI_PROPS, WEAPON_SIZE, fitCharacter, fitProp, fitWeapon, sanitizeAiConfig, tintMaskFromPixels, type AiSlot } from './aiModels';
import { CAN_H, GLB, SHARED, type GlbModel } from './models';

/**
 * The detailed models for High / Ultra: public/models/*.glb, made by tools/models/build_models.py.
 * They're fetched the first time "Models & materials: Detailed" is on; until they arrive, or if anything
 * about them is off, the built-in procedural models are used.
 */
const FILES: Record<GlbModel, string> = { spartan: 'models/spartan.glb', can: 'models/can.glb', soaker: 'models/soaker.glb', spring: 'models/spring.glb' };
/** Nodes and materials the game hooks into (see tools/models/README.md). */
const CONTRACT: Record<GlbModel, { nodes: string[]; materials: string[] }> = {
  spartan: { nodes: ['root', 'body', 'aim', 'head', 'weaponHolder'], materials: ['armor', 'accent', 'undersuit', 'visor'] },
  can: { nodes: ['can'], materials: ['metal', 'label'] },
  soaker: { nodes: ['soaker', 'muzzle'], materials: ['body', 'accent', 'tank'] },
  spring: { nodes: ['spring'], materials: ['metal', 'pad'] },
};

let loading: Promise<boolean> | null = null;

/** Fetch and check all the detailed models once (resolves true when they're ready to use). */
export function loadDetailedModels(): Promise<boolean> {
  void loadAiModels();
  loading ??= (async () => {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const scenes = await Promise.all((Object.keys(FILES) as GlbModel[]).map(async (k) => [k, (await loader.loadAsync(FILES[k])).scene] as const));
      for (const [k, scene] of scenes) check(k, scene);
      for (const [k, scene] of scenes) {
        // instances are clones that share these buffers: never dispose them with an instance
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) SHARED.add(m.geometry);
        });
        GLB[k] = scene;
      }
      GLB.version++;
      return true;
    } catch (e) {
      console.warn('Detailed models unavailable, using the built-in ones:', e);
      return false;
    }
  })();
  return loading;
}

function check(k: GlbModel, scene: THREE.Object3D) {
  for (const n of CONTRACT[k].nodes) if (!scene.getObjectByName(n)) throw new Error(`${FILES[k]}: no "${n}" node`);
  const mats = new Set<string>();
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) for (const x of Array.isArray(m) ? m : [m]) mats.add(x.name);
  });
  for (const n of CONTRACT[k].materials) if (!mats.has(n)) throw new Error(`${FILES[k]}: no "${n}" material`);
}

let aiLoading: Promise<void> | null = null;
const AI_DIR = 'models/ai/';

const isAiSlot = (s: string): s is AiSlot => (AI_CHARACTERS as readonly string[]).includes(s) || (AI_PROPS as readonly string[]).includes(s) || (WEAPON_IDS as string[]).includes(s);

/**
 * The AI-made models listed in public/models/ai/manifest.json (tools/models/import.mjs), fitted to the game
 * (aiModels.ts). There may be none, or only some: each one replaces its built-in model on High / Ultra.
 */
export function loadAiModels(): Promise<void> {
  aiLoading ??= (async () => {
    let slots: Record<string, unknown>;
    try {
      const res = await fetch(`${AI_DIR}manifest.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      slots = ((await res.json()) as { slots?: Record<string, unknown> }).slots ?? {};
    } catch {
      return; // none made yet
    }
    if (!Object.keys(slots).length) return;
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js')]);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    let n = 0;
    await Promise.all(
      Object.entries(slots).map(async ([slot, raw]) => {
        const cfg = sanitizeAiConfig(raw);
        if (!cfg || !isAiSlot(slot)) return;
        try {
          const scene = (await loader.loadAsync(AI_DIR + cfg.file)).scene;
          const model =
            slot === 'spartan' || slot === 'cat' ? fitCharacter(scene, { tint: slot === 'spartan', ...cfg })
            : slot === 'can' ? fitProp(scene, cfg, CAN_H, 'centre')
            : slot === 'spring' ? fitProp(scene, cfg, 1, 'bottom')
            : fitWeapon(scene, cfg, WEAPON_SIZE[slot as WeaponId]);
          const pieces = model.kind === 'character' ? [...model.lower, ...model.upper, ...model.head] : model.pieces;
          for (const p of pieces) {
            // shared by every copy in the match: never disposed with one
            SHARED.add(p.geo);
            SHARED.add(p.mat);
            const map = (p.mat as THREE.MeshStandardMaterial).map;
            if (map) SHARED.add(map);
            if (model.kind === 'character' && model.tint && map && !p.mat.userData.tintMask) p.mat.userData.tintMask = tintMask(map);
          }
          AI[slot] = model;
          n++;
        } catch (e) {
          console.warn(`AI model "${slot}" unavailable, using the built-in one:`, e);
        }
      }),
    );
    // the game rebuilds its models when this changes
    if (n) GLB.version++;
  })();
  return aiLoading;
}

/** Which texels of a character's colour map take the player's colour (see tintMaskFromPixels), at up to 256². */
function tintMask(map: THREE.Texture): THREE.Texture | null {
  const img = map.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img?.width) return null;
  const k = Math.min(1, 256 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const mask = tintMaskFromPixels(ctx.getImageData(0, 0, w, h).data);
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = rgba[i * 4 + 3] = mask[i]!;
  const t = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
  // same orientation and wrapping as the colour map it was read from
  t.flipY = map.flipY;
  t.wrapS = map.wrapS;
  t.wrapT = map.wrapT;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  SHARED.add(t);
  return t;
}

