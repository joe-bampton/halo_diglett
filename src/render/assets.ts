import * as THREE from 'three';
import { GLB, SHARED, type GlbModel } from './models';

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
