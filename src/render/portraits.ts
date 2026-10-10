import * as THREE from 'three';
import type { WeaponId } from '../sim/weapons';
import { buildSpartan, buildWeaponModel, disposeTree } from './models';
import { PAL } from './palette';

/** Lobby cards: a Spartan in their armour, popping out of a hole with the gun they'll have. Drawn once per look. */
const W = 220;
const H = 260;

const ready = new Map<string, string>();
const waiting = new Map<string, ((url: string) => void)[]>();
const queue: { key: string; color: number; weapon: WeaponId }[] = [];
let busy = false;
/** no WebGL for them (helmets from then on) */
let noGl = false;

export const portraitKey = (color: number, weapon: WeaponId) => `${color.toString(16)}-${weapon}`;

/** The portrait if it's drawn already, else a flat helmet in their colour to show meanwhile. */
export function portraitNow(color: number, weapon: WeaponId): { url: string; done: boolean } {
  const url = ready.get(portraitKey(color, weapon));
  return url ? { url, done: true } : { url: helmet(color), done: false };
}

/** Draw it (portraits asked for together share one renderer, one per task so the page stays responsive). */
export function portrait(color: number, weapon: WeaponId): Promise<string> {
  const key = portraitKey(color, weapon);
  const have = ready.get(key);
  if (have) return Promise.resolve(have);
  return new Promise((resolve) => {
    const w = waiting.get(key);
    if (w) return void w.push(resolve);
    waiting.set(key, [resolve]);
    queue.push({ key, color, weapon });
    if (!busy) {
      busy = true;
      setTimeout(drawQueue, 30);
    }
  });
}

/** Leaving the lobby: drop the ones still waiting to be drawn (asking again later starts over). */
export function cancelPortraits() {
  for (const j of queue) waiting.delete(j.key);
  queue.length = 0;
}

function finish(key: string, url: string) {
  ready.set(key, url);
  for (const r of waiting.get(key) ?? []) r(url);
  waiting.delete(key);
}

function drawQueue() {
  if (!queue.length) {
    busy = false;
    return;
  }
  let studio: Studio | null = null;
  try {
    if (!noGl) studio = new Studio();
  } catch (e) {
    noGl = true;
    console.warn('portraits unavailable', e);
  }
  const next = () => {
    const job = queue.shift();
    if (!job) {
      studio?.dispose();
      busy = false;
      return;
    }
    let url = '';
    try {
      url = studio?.draw(job.color, job.weapon) ?? '';
    } catch (e) {
      console.warn('portrait failed', e);
    }
    finish(job.key, url || helmet(job.color));
    setTimeout(next, 0);
  };
  next();
}

class Studio {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, W / H, 0.1, 30);
  private props: THREE.Object3D[] = [];

  constructor() {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.setClearColor(0x000000, 0);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(-2, 3.5, -3);
    const rim = new THREE.DirectionalLight(0x9fe7ff, 1.6);
    rim.position.set(2.5, 2, 2.5);
    this.scene.add(new THREE.HemisphereLight(0xd8ecff, 0x5d7a3a, 1.3), sun, rim);
    // the hole they pop out of: a ring of stone round a dark well
    const stone = new THREE.MeshLambertMaterial({ color: PAL.stone, flatShading: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.17, 6, 20), stone);
    ring.rotation.x = Math.PI / 2;
    ring.scale.z = 0.75;
    const well = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.4, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x06090b, side: THREE.BackSide }));
    well.position.y = -1.2;
    this.props.push(ring, well);
    this.scene.add(ring, well);
    const target = new THREE.Vector3(0, 0.64, 0);
    this.camera.position.copy(target).add(new THREE.Vector3(-0.3, 0.22, -1).normalize().multiplyScalar(3.8));
    this.camera.lookAt(target);
  }

  draw(color: number, weapon: WeaponId): string {
    const parts = buildSpartan(color, false, false);
    const gun = buildWeaponModel(weapon);
    parts.weaponHolder.add(gun);
    // up out of the hole, turned a little towards the light, gun ready
    parts.root.position.y = 0.06;
    parts.body.rotation.y = 0.55;
    parts.aim.rotation.x = -0.08;
    this.scene.add(parts.root);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.scene.remove(parts.root);
    disposeTree(parts.root);
    return url;
  }

  dispose() {
    for (const p of this.props) disposeTree(p);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/** Without WebGL: a helmet in their colour. */
function helmet(color: number): string {
  const c = `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 130"><ellipse cx="55" cy="118" rx="44" ry="10" fill="#06090b" stroke="#8b9095" stroke-width="5"/><path d="M55 20c-23 0-37 17-37 40v22c0 11 6 19 15 23l5 13h34l5-13c9-4 15-12 15-23V60c0-23-14-40-37-40z" fill="${c}"/><path d="M28 60c0-7 5-11 12-11h30c7 0 12 4 12 11v7c0 7-5 11-12 11H40c-7 0-12-4-12-11z" fill="#c08a20"/><path d="M34 58h22v6H34z" fill="#ffe8a8" opacity=".55"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
