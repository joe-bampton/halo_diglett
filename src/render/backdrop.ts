import * as THREE from 'three';
import { Arena } from '../sim/arena';
import { drop } from '../sim/hitbox';
import { PLAYER_COLORS } from '../net/host';
import { buildOrb, buildSpartan, buildWeaponModel, type SpartanParts } from './models';
import { PAL } from './palette';
import type { QualityPreset } from './quality';
import { Grass, buildFence, buildFlowers, buildHoles, buildSky, buildTerrain, buildTrees } from './world';

/** Slowly orbiting view of the arena with idle Spartans popping up — sits behind the menus. */
export class Backdrop {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1600);
  private arena = new Arena();
  private dudes: { parts: SpartanParts; hole: number; phase: number; speed: number; yaw: number }[] = [];
  private orb: THREE.Group;
  private sky: THREE.Mesh;
  private grass: Grass;
  private raf = 0;
  private t0 = performance.now();
  private canvas: HTMLCanvasElement;

  constructor(private container: HTMLElement, q: QualityPreset) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game backdrop';
    container.prepend(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: q.antialias, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Math.min(1.25, q.dprCap)));
    this.scene.fog = new THREE.Fog(PAL.fog, q.fogNear, q.fogFar);
    this.scene.add(new THREE.HemisphereLight(0xd8ecff, 0x5d7a3a, 1.35));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
    sun.position.set(45, 60, -65);
    this.scene.add(sun);
    this.sky = buildSky();
    this.scene.add(this.sky, buildTerrain(this.arena, q), buildHoles(this.arena), buildFence(this.arena), buildTrees(this.arena, q), buildFlowers(this.arena));
    this.grass = new Grass(this.arena, { ...q, grassClumps: Math.round(q.grassClumps * 0.6) });
    this.scene.add(this.grass.mesh);
    const holes = this.arena.holes.slice(0, 9);
    holes.forEach((h, i) => {
      if (i % 4 === 3) return;
      const parts = buildSpartan(PLAYER_COLORS[i % PLAYER_COLORS.length]!);
      parts.weaponHolder.add(buildWeaponModel(i % 3 === 0 ? 'rpg' : i % 3 === 1 ? 'sniper' : 'br'));
      if (i === 0) parts.catHat.visible = true;
      this.scene.add(parts.root);
      this.dudes.push({ parts, hole: h.id, phase: Math.random() * 10, speed: 0.6 + Math.random() * 0.7, yaw: Math.atan2(h.x, h.z) + Math.PI + (Math.random() - 0.5) });
    });
    this.orb = buildOrb(0x40ff70);
    this.scene.add(this.orb);
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  private onResize = () => {
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  start() {
    // behind menus 30 fps is plenty: phones skip every other frame (battery, heat)
    const half = matchMedia('(pointer: coarse)').matches;
    let skip = false;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (half && (skip = !skip)) return;
      const t = (performance.now() - this.t0) / 1000;
      const a = t * 0.035;
      this.camera.position.set(Math.cos(a) * 34, 9 + Math.sin(t * 0.1) * 1.5, Math.sin(a) * 34);
      this.camera.lookAt(0, 3.5, 0);
      for (const d of this.dudes) {
        const h = this.arena.holes[d.hole]!;
        const e = Math.max(0, Math.min(1, Math.sin(t * d.speed + d.phase) * 2.2 + 0.4));
        d.parts.root.position.set(h.x, h.rim + drop(e), h.z);
        d.parts.body.rotation.y = d.yaw + Math.sin(t * 0.4 + d.phase) * 0.5;
        d.parts.aim.rotation.x = Math.sin(t * 0.3 + d.phase) * 0.1;
      }
      this.orb.position.set(Math.sin(t * 0.13) * 14, 8 + Math.sin(t * 0.9), Math.cos(t * 0.11) * 12);
      this.orb.rotation.y = t;
      ((this.orb.userData.aura as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.time!.value = t;
      (this.sky.material as THREE.ShaderMaterial).uniforms.time!.value = t;
      this.grass.update(t);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
