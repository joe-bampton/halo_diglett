import * as THREE from 'three';
import { WEAPON_IDS, type WeaponId } from '../sim/weapons';
import { buildWeaponModel, disposeTree } from './models';

/**
 * Kill-feed and weapon-picker icons: each gun's own model seen from the side, barrel to the right, as a flat white
 * silhouette (like Halo's). Drawn once per page, one per task so the page stays responsive.
 */
const W = 120;
const H = 48;

const ready = new Map<WeaponId, string>();
let started = false;

/** The icon if it's drawn (null: not yet, or no WebGL — show the weapon's short name instead). */
export function weaponIcon(id: WeaponId): string | null {
  return ready.get(id) ?? null;
}

/** Draw every weapon's icon (once; later calls do nothing). */
export function prepareWeaponIcons() {
  if (started) return;
  started = true;
  let studio: IconStudio;
  try {
    studio = new IconStudio();
  } catch (e) {
    console.warn('weapon icons unavailable', e);
    return;
  }
  const todo = [...WEAPON_IDS];
  const next = () => {
    const id = todo.shift();
    if (!id) return studio.dispose();
    try {
      const url = studio.draw(id);
      if (url) ready.set(id, url);
    } catch (e) {
      console.warn('weapon icon failed', id, e);
    }
    setTimeout(next, 0);
  };
  setTimeout(next, 0);
}

class IconStudio {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
  private white = new THREE.MeshBasicMaterial({ color: 0xffffff });

  constructor() {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.setClearColor(0x000000, 0);
    // from the right-hand side: the barrel (-Z) points right
    this.camera.position.set(10, 0, 0);
    this.camera.lookAt(0, 0, 0);
    // every part drawn flat white: a silhouette
    this.scene.overrideMaterial = this.white;
  }

  draw(id: WeaponId): string {
    const gun = buildWeaponModel(id);
    // fit the gun's side view (z across, y up) into the frame with a little margin
    const box = new THREE.Box3().setFromObject(gun);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const half = Math.max(size.z / 2 / (W / H), size.y / 2) * 1.08;
    const cam = this.camera;
    cam.left = -half * (W / H);
    cam.right = half * (W / H);
    cam.top = half;
    cam.bottom = -half;
    cam.position.set(c.x + 10, c.y, c.z);
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    this.scene.add(gun);
    this.renderer.render(this.scene, cam);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.scene.remove(gun);
    disposeTree(gun);
    return url;
  }

  dispose() {
    this.white.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
