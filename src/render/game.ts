import * as THREE from 'three';
import { audio, type SoundHandle } from '../audio/audio';
import { PITRE_SLOT, PitreVoiceThrottle, pitreCues, type PitreCue } from '../audio/pitre';
import type { SfxId } from '../audio/synth';
import { InputManager, type AssistInfo } from '../input/input';
import type { ClientSession, ViewPlayer } from '../net/client';
import { F_BEAM, F_BURNING, F_CAMO, F_CHARGING, F_DAMAGE, F_INVINCIBLE, F_OVERSHIELD } from '../net/protocol';
import { angleDiff, dirFromYawPitch, yawPitchOf } from '../shared/vec';
import { Arena } from '../sim/arena';
import { FIRE_EXPOSURE, RECHARGE_DELAY, SHIELD_MAX, SHIELD_RATE, TICK_RATE } from '../sim/constants';
import { drop, eyePos, hitboxOf, rayHitbox } from '../sim/hitbox';
import { integrateProjectile } from '../sim/match';
import { orbPos } from '../sim/orbs';
import { POWERUPS, type PowerUpId } from '../sim/powerups';
import type { Projectile, SimEvent } from '../sim/types';
import { WEAPONS, weaponByIndex, type WeaponId } from '../sim/weapons';
import { Hud, MEDALS, scoreboardHtml, type ScoreRow } from '../ui/hud';
import { FlashLights, Particles, Ribbons } from './fx';
import { buildOrb, buildSpartan, buildWeaponModel, textSprite, type SpartanParts } from './models';
import { PAL } from './palette';
import { QUALITY, type QualityPreset } from './quality';
import { Grass, buildFence, buildFlowers, buildHoles, buildSky, buildTerrain, buildTrees } from './world';

interface SpartanView {
  slot: number;
  parts: SpartanParts;
  color: number;
  weapon: WeaponId | '';
  weaponModel: THREE.Group | null;
  alive: boolean;
  deathT: number;
  deathDir: number;
  flare: number;
  flareColor: number;
  estShield: number;
  lastHitAt: number;
  name: string;
  tag: THREE.Sprite | null;
  tagFor: string;
  beamSound: SoundHandle | null;
  voice: SoundHandle | null;
  headScale: number;
}

interface ProjView {
  pr: Projectile;
  obj: THREE.Object3D | null;
  weapon: WeaponId;
  local: boolean;
  trailAcc: number;
}

interface OrbView {
  id: number;
  group: THREE.Group;
  color: number;
  label: THREE.Sprite;
}

interface StrikeView {
  pos: THREE.Vector3;
  at: number;
  whistled: boolean;
}

const WEAPON_SFX: Record<WeaponId, SfxId> = {
  sniper: 'sniper', br: 'rifle', crossbow: 'crossbow', rpg: 'rocket', grenade: 'bloop', railgun: 'rail', hyperbeam: 'charge', needler: 'needle', flamethrower: 'flameLoop', minigun: 'minigun', orbital: 'beep',
};

/** Dispose geometries, materials and textures of a detached subtree. */
function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !SHARED.has(m.geometry)) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      if (SHARED.has(mat)) continue;
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

const SHARED = new Set<unknown>();
const projCache = new Map<string, () => THREE.Object3D>();
/** Projectile visuals share geometry & materials (cheap to spawn dozens per second). */
function projMesh(kind: string): THREE.Object3D | null {
  if (!projCache.size) {
    const keep = <T>(x: T) => (SHARED.add(x), x);
    const rocketBody = keep(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8).rotateX(Math.PI / 2));
    const rocketMat = keep(new THREE.MeshLambertMaterial({ color: 0x5f6b3a }));
    const flameGeo = keep(new THREE.SphereGeometry(0.12, 8, 6));
    const flameMat = keep(new THREE.MeshBasicMaterial({ color: 0xffb040 }));
    projCache.set('rocket', () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(rocketBody, rocketMat));
      const f = new THREE.Mesh(flameGeo, flameMat);
      f.position.z = 0.3;
      g.add(f);
      return g;
    });
    const simple = (name: string, geo: THREE.BufferGeometry, color: number) => {
      const gg = keep(geo), mm = keep(new THREE.MeshBasicMaterial({ color }));
      projCache.set(name, () => new THREE.Mesh(gg, mm));
    };
    simple('bolt', new THREE.CylinderGeometry(0.02, 0.02, 0.8, 5).rotateX(Math.PI / 2), 0x9fe8ff);
    simple('grenade', new THREE.SphereGeometry(0.1, 8, 6), 0x7cff6b);
    simple('needle', new THREE.ConeGeometry(0.03, 0.3, 4).rotateX(-Math.PI / 2), 0xff5fd2);
  }
  return projCache.get(kind)?.() ?? null;
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export interface GameHooks {
  onMenu(): void;
  isMenuOpen(): boolean;
}

export class Game {
  readonly arena = new Arena();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private vmScene = new THREE.Scene();
  private vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  private vmHolder = new THREE.Group();
  private vmModel: THREE.Group | null = null;
  private vmWeapon: WeaponId | '' = '';
  private vmKick = 0;
  private sky: THREE.Mesh;
  private grass: Grass;
  private sun: THREE.DirectionalLight;
  private fxAdd: Particles;
  private fxNorm: Particles;
  private ribbons: Ribbons;
  private lights: FlashLights;
  private spartans = new Map<number, SpartanView>();
  private orbs = new Map<number, OrbView>();
  private projs = new Map<string, ProjView>();
  private strikes = new Map<number, StrikeView>();
  readonly hud: Hud;
  readonly input: InputManager;
  private pitre = new PitreVoiceThrottle();
  private raf = 0;
  private last = 0;
  private time = 0;
  private shake = 0;
  private camKick = 0;
  private dynScale = 1;
  private frameTimes: number[] = [];
  private lastHole = -1;
  private wasAlive = false;
  private killer = -1;
  private diedAt = 0;
  private pred = { lastShot: -1e9, pending: false, pendingAt: -1e9, fresh: false, burst: 0, nextBurst: 0, localId: 0 };
  private chargeSound: SoundHandle | null = null;
  private lowShieldAt = 0;
  private prevShield = 70;
  private showScores = false;
  private scoreboardEl: HTMLElement;
  private clickToPlay: HTMLElement;
  private touchEl: HTMLElement;
  private perfEl: HTMLElement | null = null;
  private destroyed = false;
  private introShown = false;
  private endShown = false;
  private lastSec = -1;
  frames = 0;
  eventCounts: Record<string, number> = {};
  q: QualityPreset;

  constructor(
    private container: HTMLElement,
    readonly session: ClientSession,
    quality: QualityPreset,
    private hooks: GameHooks,
  ) {
    this.q = quality;
    const canvas = document.createElement('canvas');
    canvas.className = 'game';
    container.appendChild(canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = quality.shadows !== 'none';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = quality.shadows === 'dynamic';
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, quality.far);
    this.scene.fog = new THREE.Fog(PAL.fog, quality.fogNear, quality.fogFar);
    this.scene.background = new THREE.Color(PAL.horizon);
    // lighting
    const hemi = new THREE.HemisphereLight(0xd8ecff, 0x5d7a3a, 1.35);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
    this.sun.position.set(45, 60, -65);
    if (quality.shadows !== 'none') {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
      const c = this.sun.shadow.camera;
      c.left = -62; c.right = 62; c.top = 62; c.bottom = -62; c.near = 10; c.far = 220;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.03;
    }
    this.scene.add(this.sun, this.sun.target);
    // world
    this.sky = buildSky();
    this.scene.add(this.sky);
    this.scene.add(buildTerrain(this.arena, quality));
    this.scene.add(buildHoles(this.arena));
    this.scene.add(buildFence(this.arena));
    this.scene.add(buildTrees(this.arena, quality));
    this.scene.add(buildFlowers(this.arena));
    this.grass = new Grass(this.arena, quality);
    this.scene.add(this.grass.mesh);
    // fx
    this.fxAdd = new Particles(quality.particles, true);
    this.fxNorm = new Particles(Math.round(quality.particles * 0.7), false);
    this.ribbons = new Ribbons(160);
    this.lights = new FlashLights(this.scene, quality.level === 'low' ? 1 : 3);
    this.scene.add(this.fxAdd.mesh, this.fxNorm.mesh, this.ribbons.mesh);
    // viewmodel scene
    this.vmScene.add(new THREE.HemisphereLight(0xe0f0ff, 0x506040, 1.6));
    const vmSun = new THREE.DirectionalLight(0xfff1d6, 1.8);
    vmSun.position.set(1, 2, 1);
    this.vmScene.add(vmSun, this.vmHolder);
    this.vmScene.add(this.vmCamera);
    // DOM
    this.hud = new Hud(container);
    this.scoreboardEl = document.createElement('div');
    this.scoreboardEl.className = 'scoreboard';
    container.appendChild(this.scoreboardEl);
    this.clickToPlay = document.createElement('div');
    this.clickToPlay.className = 'clicktoplay';
    this.clickToPlay.innerHTML = '<div>Click to play</div>';
    container.appendChild(this.clickToPlay);
    this.touchEl = document.createElement('div');
    this.touchEl.className = 'touch';
    container.appendChild(this.touchEl);
    this.input = new InputManager(canvas, {
      zoomLevels: () => this.myWeaponDef()?.zoom.length ?? 0,
      onFirePress: () => {
        this.pred.pending = true;
        this.pred.fresh = true;
        this.pred.pendingAt = performance.now();
      },
      onMenu: () => this.hooks.onMenu(),
      onScoreboard: (show) => (this.showScores = show),
      onDevice: () => this.applyDevice(),
      assist: () => this.assistInfo(),
      assistStrength: () => {
        const a = this.session.start?.settings.aimAssist ?? 'normal';
        return a === 'off' ? 0 : a === 'low' ? 0.5 : 1;
      },
      canLock: () => !this.hooks.isMenuOpen(),
    });
    this.input.mountTouch(this.touchEl);
    this.applyDevice();
    if (new URLSearchParams(location.search).has('perf')) {
      this.perfEl = document.createElement('div');
      this.perfEl.className = 'perf';
      container.appendChild(this.perfEl);
    }
    this.onResize();
    window.addEventListener('resize', this.onResize);
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    if (quality.shadows === 'static') {
      // bake the static shadow map once, before any Spartans exist (their shadows would go stale)
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(this.scene, this.camera);
    }
    const slots = Object.values(PITRE_SLOT);
    audio.preload(['ann.slay', 'ann.double', 'ann.triple', 'ann.headshot', 'ann.spree', 'ann.lead_taken', 'ann.lead_lost', 'ann.game_over', 'ann.victory', 'ann.defeat']);
    if (session.start?.settings.pitre) audio.preload(slots);
  }

  private applyDevice() {
    const touch = this.input.device === 'touch';
    this.touchEl.classList.toggle('on', touch);
    document.querySelector('.rotate')?.classList.toggle('ingame', touch);
  }

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dprCap) * this.dynScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  };

  start() {
    this.input.enabled = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.input.unlock();
    this.input.destroy();
    for (const s of this.spartans.values()) {
      s.beamSound?.stop();
      s.voice?.stop();
    }
    this.chargeSound?.stop();
    this.beamSound?.stop();
    this.myVoice?.stop();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.container.innerHTML = '';
  }

  setQuality(q: QualityPreset) {
    this.q = q;
    this.dynScale = 1;
    this.onResize();
  }

  // -------------------------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------------------------

  private get me(): ViewPlayer | null {
    return this.session.players[this.session.slot] ?? null;
  }

  private myWeapon(): WeaponId {
    const m = this.session.me;
    return m ? weaponByIndex(m.w) : 'sniper';
  }

  private myWeaponDef() {
    return WEAPONS[this.myWeapon()];
  }

  private holeOf(p: ViewPlayer) {
    return this.arena.holes[p.hole] ?? this.arena.holes[0]!;
  }

  private headPos(p: ViewPlayer): THREE.Vector3 {
    const hb = hitboxOf(this.holeOf(p), p.exposure, this.headScaleFor(p));
    return new THREE.Vector3(hb.head.x, hb.head.y, hb.head.z);
  }

  private headScaleFor(_p: ViewPlayer): number {
    let s = this.session.start?.settings.skulls.includes('bighead') ? 2 : 1;
    if (this.hasPu('bighead')) s *= 2.2;
    return s;
  }

  private hasPu(id: PowerUpId): boolean {
    const me = this.session.me;
    return !!me && me.pu.some(([pid, until]) => pid === id && until > this.session.hostTick);
  }

  /** Own hole: private state is authoritative and arrives before interpolation catches up. */
  private myHole() {
    const id = this.session.me?.hole ?? this.me?.hole ?? 0;
    return this.arena.holes[id] ?? this.arena.holes[0]!;
  }

  private eye(): THREE.Vector3 {
    const me = this.me;
    if (!me) return new THREE.Vector3(0, 5, 0);
    const e = eyePos(this.myHole(), this.session.myExposure);
    return new THREE.Vector3(e.x, e.y, e.z);
  }

  private muzzleOf(slot: number): THREE.Vector3 {
    if (slot === this.session.slot) {
      const e = this.eye();
      const d = dirFromYawPitch(this.input.s.yaw, this.input.s.pitch);
      const right = new THREE.Vector3(Math.cos(this.input.s.yaw), 0, -Math.sin(this.input.s.yaw));
      return e.add(new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(0.7)).addScaledVector(right, 0.22).add(new THREE.Vector3(0, -0.18, 0));
    }
    const sv = this.spartans.get(slot);
    const p = this.session.players[slot];
    if (sv?.weaponModel && p) {
      sv.parts.root.updateMatrixWorld(true);
      return sv.weaponModel.localToWorld((sv.weaponModel.userData.muzzle as THREE.Vector3).clone());
    }
    if (p) return this.headPos(p);
    return new THREE.Vector3();
  }

  private posOf(slot: number): THREE.Vector3 | null {
    const p = this.session.players[slot];
    if (!p) return null;
    const h = this.holeOf(p);
    return new THREE.Vector3(h.x, h.rim + 0.6, h.z);
  }

  private predicted(w: WeaponId): boolean {
    if (this.session.isLocal) return false;
    const t = WEAPONS[w].trigger;
    return t === 'semi' || t === 'burst' || t === 'auto';
  }

  /** Was this own shot already drawn locally? (If prediction missed it, draw the host's event.) */
  private ownShotPredicted(w: WeaponId): boolean {
    return this.predicted(w) && performance.now() - this.pred.lastShot < 350;
  }

  private assistInfo(): AssistInfo | null {
    const me = this.me;
    if (!me) return null;
    const eye = this.eye();
    let best: AssistInfo | null = null;
    let bd = Infinity;
    for (const p of this.session.players) {
      if (!p || p.slot === me.slot || !p.alive || p.exposure < 0.2 || p.flags & F_CAMO) continue;
      const hb = hitboxOf(this.holeOf(p), p.exposure, this.headScaleFor(p));
      const target = { x: hb.head.x, y: (hb.head.y + hb.torsoB.y) / 2, z: hb.head.z };
      const dist = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
      const a = yawPitchOf({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
      const dYaw = angleDiff(a.yaw, this.input.s.yaw);
      const dPitch = a.pitch - this.input.s.pitch;
      const d = Math.hypot(dYaw, dPitch);
      if (d < bd && d < 0.2 && this.arena.lineClear(eye, target, 0.5)) {
        bd = d;
        best = { dYaw, dPitch, radius: Math.max(0.006, 0.45 / dist) };
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // frame
  // -------------------------------------------------------------------------------------------

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.frames++;
    const s = this.session;
    // input (while dead, Jump asks for a respawn instead of standing)
    this.input.mode = s.me && !s.me.al && s.phase !== 'ended' ? 'spectate' : 'play';
    this.input.update(dt);
    const inp = this.input.s;
    if (!s.me?.al || s.phase === 'ended') {
      inp.stand = false;
      inp.trigger = false;
    }
    if (inp.stand !== this.lastStand) {
      this.lastStand = inp.stand;
      if (s.me?.al) audio.play('rustle', { gain: 0.35, rate: inp.stand ? 1.2 : 0.9 });
    }
    Object.assign(s.input, { yaw: inp.yaw, pitch: inp.pitch, stand: inp.stand, trigger: inp.trigger, presses: inp.presses, reloads: inp.reloads, respawns: inp.respawns, zoom: inp.zoom });
    if (this.pred.pending || inp.respawns !== this.lastRespawns) {
      this.lastRespawns = inp.respawns;
      s.flushInput();
    }
    s.update(now);
    // events
    const events = s.drainEvents();
    if (events.length) this.handleEvents(events);
    this.localWeapon(now, dt);
    this.updateSpartans(dt);
    this.updateOrbs(dt);
    this.updateProjectiles(dt);
    this.updateStrikes();
    this.updateCamera(dt);
    this.updateViewmodel(dt);
    this.updateHud();
    this.fxAdd.update(dt);
    this.fxNorm.update(dt);
    this.ribbons.update(dt);
    this.lights.update(dt);
    this.grass.update(this.time);
    (this.sky.material as THREE.ShaderMaterial).uniforms.time!.value = this.time;
    if (this.q.shadows === 'dynamic') {
      this.renderer.shadowMap.needsUpdate = this.frames % 3 === 0;
      this.renderer.shadowMap.autoUpdate = false;
    }
    // audio listener
    const fwd = dirFromYawPitch(inp.yaw, inp.pitch);
    audio.setListener(this.camera.position, fwd);
    // render
    this.renderer.info.reset();
    this.renderer.setClearColor(PAL.horizon);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.vmHolder.visible) {
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
    this.dynamicResolution(dt);
    this.clickToPlay.style.display = this.input.device === 'kbm' && !this.input.locked && !this.hooks.isMenuOpen() && s.state === 'match' ? '' : 'none';
    if (this.perfEl && this.frames % 15 === 0) {
      const info = this.renderer.info.render;
      this.perfEl.textContent = `${(1 / Math.max(1e-3, dt)).toFixed(0)}fps ${info.calls}dc ${(info.triangles / 1000).toFixed(0)}k tri x${this.dynScale.toFixed(2)} ${s.interpDelay.toFixed(1)}t`;
    }
  }

  private dynamicResolution(dt: number) {
    const range = this.q.dynamicRes;
    if (!range) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    const lo = range[0] / Math.min(window.devicePixelRatio || 1, this.q.dprCap);
    if (avg > 1 / 50 && this.dynScale > lo) {
      this.dynScale = Math.max(lo, this.dynScale - 0.1);
      this.onResize();
    } else if (avg < 1 / 75 && this.dynScale < 1) {
      this.dynScale = Math.min(1, this.dynScale + 0.1);
      this.onResize();
    }
  }

  renderInfo() {
    const i = this.renderer.info.render;
    return { calls: i.calls, triangles: i.triangles, dynScale: this.dynScale };
  }

  // -------------------------------------------------------------------------------------------
  // local weapon prediction (cosmetic only; the host decides hits)
  // -------------------------------------------------------------------------------------------

  private localWeapon(now: number, dt: number) {
    const s = this.session;
    const me = s.me;
    const w = this.myWeaponDef();
    // the host buffers a press for ~12 ticks, so the prediction keeps it for 200ms too
    const pressed = now - this.pred.pendingAt <= 200;
    const fresh = this.pred.fresh;
    this.pred.pending = false;
    this.pred.fresh = false;
    if (!me || !me.al) return;
    const infinite = s.start?.settings.ammoMode === 'noReload' || w.clip <= 0;
    const ready = s.phase === 'live' && s.myExposure >= FIRE_EXPOSURE && me.rl === 0 && (infinite || me.clip > 0);
    if (fresh && !infinite && me.clip === 0 && me.rl === 0) audio.play('empty');
    // charge ring & sound (railgun/hyperbeam)
    if ((w.trigger === 'charge' || w.trigger === 'beam') && this.input.s.trigger && ready && me.bu <= s.hostTick) {
      if (!this.chargeSound) this.chargeSound = audio.play('charge', { gain: 0.6, bus: 'guns' });
    } else if (this.chargeSound) {
      this.chargeSound.stop();
      this.chargeSound = null;
    }
    if (!this.predicted(w.id)) return;
    const intervalMs = w.interval * 1000 * (this.hasPu('quickhands') ? 1 / 1.5 : 1);
    const cooled = now - this.pred.lastShot >= intervalMs * 0.92;
    if (w.trigger === 'semi' && pressed && ready && cooled) {
      this.pred.pendingAt = -1e9;
      this.localShot(now);
    } else if (w.trigger === 'burst') {
      if (pressed && ready && cooled) {
        this.pred.pendingAt = -1e9;
        this.localShot(now);
        this.pred.burst = (w.burst?.count ?? 3) - 1;
        this.pred.nextBurst = now + (w.burst?.gap ?? 0.05) * 1000;
      } else if (this.pred.burst > 0 && now >= this.pred.nextBurst && ready) {
        this.localShot(now, true);
        this.pred.burst--;
        this.pred.nextBurst = now + (w.burst?.gap ?? 0.05) * 1000;
      }
    } else if (w.trigger === 'auto' && this.input.s.trigger && ready && cooled) this.localShot(now);
    void dt;
  }

  private localShot(now: number, inBurst = false) {
    const s = this.session;
    const w = this.myWeaponDef();
    if (!inBurst) this.pred.lastShot = now;
    const eye = this.eye();
    const d = dirFromYawPitch(this.input.s.yaw, this.input.s.pitch);
    const dir = new THREE.Vector3(d.x, d.y, d.z);
    this.vmKick = Math.min(1, this.vmKick + w.fx.recoil * 0.6);
    this.camKick += w.fx.recoil * 0.004;
    this.muzzleFlash(this.muzzleOf(s.slot), dir, w.id, true);
    this.playFireSound(s.slot, w.id, null);
    this.pitreLocalCue({ speaker: s.slot, line: 'brap', delayMs: 0, priority: 1 }, w.id);
    if (w.fireKind === 'hitscan') {
      // cosmetic trace: terrain + interpolated players
      let end = Math.min(w.range, this.arena.raycast(eye, d, w.range));
      for (const p of s.players) {
        if (!p || p.slot === s.slot || !p.alive || p.exposure < 0.01) continue;
        const h = rayHitbox(eye, d, hitboxOf(this.holeOf(p), p.exposure, this.headScaleFor(p)));
        if (h && h.t < end) end = h.t;
      }
      const endP = eye.clone().addScaledVector(dir, end);
      this.tracer(this.muzzleOf(s.slot), endP, w.id);
      if (end < w.range) this.impact(endP, w.id);
    } else if (w.projectile) {
      const def = w.projectile;
      const id = `L${++this.pred.localId}`;
      const start = eye.clone().addScaledVector(dir, 0.6);
      const pr: Projectile = { id: -1, owner: s.slot, weapon: w.id, x: start.x, y: start.y - 0.1, z: start.z, vx: dir.x * def.speed, vy: dir.y * def.speed, vz: dir.z * def.speed, born: s.hostTick, bounces: 0, target: -1, fuseAt: def.fuse ? s.hostTick + def.fuse * TICK_RATE : 0 };
      this.addProjectile(id, pr, true);
    }
  }

  // -------------------------------------------------------------------------------------------
  // events
  // -------------------------------------------------------------------------------------------

  private handleEvents(events: SimEvent[]) {
    const s = this.session;
    const mySlot = s.slot;
    const settings = s.start?.settings;
    for (const e of events) {
      this.eventCounts[e.k] = (this.eventCounts[e.k] ?? 0) + 1;
      switch (e.k) {
        case 'fire': {
          if (e.p === mySlot && this.ownShotPredicted(e.w)) break;
          const w = WEAPONS[e.w];
          const from = this.muzzleOf(e.p);
          const to = new THREE.Vector3(...e.e);
          if (w.trigger !== 'beam') {
            this.muzzleFlash(from, to.clone().sub(from).normalize(), e.w, e.p === mySlot);
            if (w.fireKind === 'hitscan') {
              this.tracer(from, to, e.w);
              if (e.hit === 'world') this.impact(to, e.w);
            }
          }
          if (e.p === mySlot) {
            this.vmKick = Math.min(1, this.vmKick + w.fx.recoil * 0.6);
            this.camKick += w.fx.recoil * 0.004;
          }
          this.playFireSound(e.p, e.w, e.p === mySlot ? null : this.posOf(e.p));
          break;
        }
        case 'proj': {
          if (e.p === mySlot && this.ownShotPredicted(e.w)) break;
          const pr: Projectile = { id: e.id, owner: e.p, weapon: e.w, x: e.pos[0], y: e.pos[1], z: e.pos[2], vx: e.vel[0], vy: e.vel[1], vz: e.vel[2], born: e.t, bounces: 0, target: e.tgt, fuseAt: 0 };
          this.addProjectile(String(e.id), pr, false);
          break;
        }
        case 'pend': {
          const pv = this.projs.get(String(e.id));
          if (pv) {
            if (!WEAPONS[pv.weapon].splash) this.impact(new THREE.Vector3(...e.pos), pv.weapon);
            this.removeProjectile(String(e.id));
          }
          break;
        }
        case 'boom':
          this.explosion(new THREE.Vector3(...e.pos), e.r, e.w);
          break;
        case 'dmg':
          this.onDamage(e);
          break;
        case 'kill':
          this.onKill(e);
          break;
        case 'spawn': {
          const sv = this.spartans.get(e.p);
          if (sv) {
            sv.alive = true;
            sv.deathT = 0;
            sv.estShield = SHIELD_MAX;
          }
          if (e.p === mySlot) {
            const h = this.arena.holes[e.hole]!;
            this.input.resetForSpawn(Math.atan2(h.x, h.z));
            this.killer = -1;
            audio.play('spawn', { gain: 0.5 });
          } else {
            const h = this.arena.holes[e.hole]!;
            this.fxAdd.emit({ pos: { x: h.x, y: h.rim + 0.3, z: h.z }, count: 12, speed: [0.5, 2], life: [0.4, 0.8], size: [0.35, 0.05], color: 0x9fe7ff, jitter: 0.8 });
          }
          break;
        }
        case 'reload':
          if (e.p === mySlot) audio.play('reload', { gain: 0.6, rate: 1.2 });
          break;
        case 'orb': {
          const pos = orbPos(e, e.t, this.arena);
          audio.play('powerup', { pos, gain: 0.5, rate: 1.5 });
          break;
        }
        case 'orbPop': {
          const ov = this.orbs.get(e.id);
          if (ov) {
            const p = ov.group.position.clone();
            if (e.p >= 0) {
              this.fxAdd.emit({ pos: p, count: 40, speed: [2, 9], life: [0.4, 1], size: [0.4, 0.05], color: 0xffffff, color1: ov.color });
              this.fxNorm.emit({ pos: p, count: 20, speed: [1, 5], life: [0.8, 1.4], size: [0.25, 0.1], color: 0xe0282e, gravity: 6, alpha: [1, 0.2] });
              audio.play('orbPop', { pos: p, reverb: 0.2 });
            } else this.fxAdd.emit({ pos: p, count: 14, speed: [0.5, 2], life: [0.4, 0.8], size: [0.5, 0.1], color: ov.color });
          }
          break;
        }
        case 'pu':
          if (e.p === mySlot) {
            const def = POWERUPS[e.id as PowerUpId];
            if (def) {
              audio.announce(def.announce);
              audio.play('powerup');
              this.hud.message(def.name, 2000);
            }
          }
          break;
        case 'strike': {
          const pos = new THREE.Vector3(...e.pos);
          this.strikes.set(e.id, { pos, at: e.at, whistled: false });
          break;
        }
        case 'lead':
          if (e.p === mySlot) {
            if (settings?.pitre && settings.pitreCatHat) {
              audio.announce('ann.cat_hat');
              this.hud.catHat(true);
              setTimeout(() => this.hud.catHat(false), 3800);
            } else audio.announce('ann.lead_taken');
          } else if (e.prev === mySlot) audio.announce('ann.lead_lost');
          break;
        case 'ann':
          if (e.p === -1 || e.p === mySlot) {
            audio.announce(e.key);
            if (e.key === 'ann.slay') this.hud.message('Slay your enemies', 2600, 'big');
            if (e.key === 'ann.one_minute') this.hud.message('One minute remaining', 2500);
            if (e.key === 'ann.ten_kills') this.hud.message('10 kills remaining', 2500);
            if (e.key === 'ann.five_kills') this.hud.message('5 kills remaining', 2500);
            if (e.key === 'ann.gungame_level') this.hud.message('Weapon upgraded', 1500);
          }
          break;
        case 'medal':
          if (e.p === mySlot) {
            this.hud.medal(e.id);
            audio.play('medal', { gain: 0.6 });
            const ann = MEDALS[e.id]?.ann;
            if (ann) audio.announce(ann);
          }
          break;
        case 'end': {
          this.endShown = true;
          const win = e.winner === mySlot;
          audio.announce('ann.game_over');
          audio.announce(win ? 'ann.victory' : 'ann.defeat');
          const w = e.winner >= 0 ? s.players[e.winner] : null;
          this.hud.message(win ? 'Victory' : w ? `${w.name} wins` : 'Draw', 0, 'big');
          this.hud.sub('Game over');
          this.input.unlock();
          break;
        }
        case 'forced':
          if (e.p === mySlot) {
            this.hud.message('Get up!', 1500, 'warn');
            audio.play('lowShield', { gain: 0.5 });
          }
          break;
      }
    }
    // Pitre Mode voice lines
    if (settings?.pitre) {
      for (const cue of pitreCues(events, settings)) {
        // own predicted shots already triggered their brap
        if (cue.line === 'brap' && cue.speaker === mySlot) {
          const fe = events.find((x) => x.k === 'fire' && x.p === mySlot);
          if (fe && fe.k === 'fire' && this.ownShotPredicted(fe.w)) continue;
        }
        const fw = events.find((x) => x.k === 'fire' && x.p === cue.speaker);
        this.pitreLocalCue(cue, fw && fw.k === 'fire' ? fw.w : undefined);
      }
    }
  }

  private pitreLocalCue(cue: PitreCue, weapon?: WeaponId) {
    const st = this.session.start?.settings;
    if (!st?.pitre) return;
    if (cue.line === 'brap' && !st.pitreBrap) return;
    if (cue.line !== 'brap' && !st.pitreVoices) return;
    const slot = PITRE_SLOT[cue.line];
    const dur = audio.voiceDuration(slot) * 1000;
    if (!this.pitre.admit(cue, performance.now(), dur, weapon)) return;
    const mine = cue.speaker === this.session.slot;
    const pos = mine ? null : this.posOf(cue.speaker);
    // stop whatever this speaker was saying (channel interrupt)
    const sv = this.spartans.get(cue.speaker);
    const prevVoice = mine ? this.myVoice : sv?.voice;
    const h = audio.playVoice(slot, { pos, delay: cue.delayMs / 1000, gain: mine ? 0.8 : 1.3 });
    if (!h) return;
    prevVoice?.stop(0.03);
    if (mine) this.myVoice = h;
    else if (sv) sv.voice = h;
  }
  private myVoice: SoundHandle | null = null;
  private lastStand = false;
  private lastRespawns = 0;

  private brapMode(): boolean {
    const st = this.session.start?.settings;
    return !!st?.pitre && st.pitreBrap;
  }

  private playFireSound(slot: number, w: WeaponId, pos: THREE.Vector3 | null) {
    const st = this.session.start?.settings;
    if (st?.pitre && st.pitreBrap) return; // "brap brap brappp" replaces gunfire
    const id = WEAPON_SFX[w];
    const def = WEAPONS[w];
    if (def.trigger === 'beam') {
      // the continuous hum is driven by the beam flag in updateSpartans
      audio.play('rail', { pos, gain: 0.6, rate: 0.6, bus: 'guns' });
      return;
    }
    if (w === 'flamethrower') {
      audio.play('rustle', { pos, gain: 0.4, rate: 0.5, bus: 'guns' });
      return;
    }
    audio.play(id, { pos, gain: slot === this.session.slot ? 0.8 : 1, reverb: w === 'sniper' || w === 'railgun' || w === 'rpg' ? 0.5 : 0.25, bus: 'guns' });
  }
  private beamSound: SoundHandle | null = null;

  private onDamage(e: Extract<SimEvent, { k: 'dmg' }>) {
    const s = this.session;
    const mySlot = s.slot;
    const sv = this.spartans.get(e.v);
    if (sv && e.v !== mySlot) {
      const hadShield = sv.estShield > 0;
      sv.estShield = e.sb ? 0 : Math.max(0, sv.estShield - e.amt);
      sv.lastHitAt = this.time;
      const p = s.players[e.v];
      if (p) {
        const head = this.headPos(p);
        const at = e.head ? head : head.clone().add(new THREE.Vector3(0, -0.4, 0));
        if (e.amt === 0) {
          sv.flare = 1;
          sv.flareColor = 0xffe640;
        } else if (hadShield) {
          sv.flare = 1;
          sv.flareColor = e.sb ? 0xffffff : 0x6ad8ff;
          this.fxAdd.emit({ pos: at, count: e.sb ? 30 : 8, speed: [1, e.sb ? 6 : 3], life: [0.2, 0.5], size: [0.2, 0.02], color: 0xbfefff, color1: 0x3fb6ff });
          if (e.sb) audio.play('shieldBreak', { pos: at, gain: 0.8 });
        } else {
          this.fxAdd.emit({ pos: at, count: 10, speed: [1, 4], life: [0.2, 0.45], size: [0.16, 0.02], color: 0xffb040, color1: 0xff4000 });
        }
      }
    }
    if (e.a === mySlot && e.v !== mySlot) {
      this.hud.hitmarker(false);
      audio.play(e.head ? 'ding' : 'hitTick', { gain: e.head ? 0.5 : 0.35 });
    }
    if (e.v === mySlot && e.amt > 0) {
      const src = e.a >= 0 && e.a !== mySlot ? this.posOf(e.a) : null;
      if (src) {
        const eye = this.eye();
        const a = yawPitchOf({ x: src.x - eye.x, y: 0, z: src.z - eye.z }).yaw;
        this.hud.damageFrom(-angleDiff(a, this.input.s.yaw));
      }
      this.shake = Math.min(1, this.shake + 0.25);
      if (e.sb) audio.play('shieldBreak', { gain: 0.9 });
    }
  }

  private onKill(e: Extract<SimEvent, { k: 'kill' }>) {
    const s = this.session;
    const mySlot = s.slot;
    const killer = e.a >= 0 ? s.players[e.a] : null;
    const victim = s.players[e.v];
    if (victim) this.hud.killLine(killer && e.a !== e.v ? killer : null, victim, e.w, e.head);
    const sv = this.spartans.get(e.v);
    if (sv) {
      sv.alive = false;
      sv.deathT = 0.0001;
      sv.deathDir = Math.random() > 0.5 ? 1 : -1;
      sv.beamSound?.stop();
      sv.beamSound = null;
    }
    if (victim) {
      const head = this.headPos(victim);
      const gruntBday = e.head && s.start?.settings.skulls.includes('gruntbday');
      if (gruntBday) {
        for (const c of [0xff4a4a, 0x4aff6a, 0x4a8aff, 0xffe04a, 0xff4af0, 0xffffff])
          this.fxNorm.emit({ pos: head, count: 14, speed: [3, 9], dir: new THREE.Vector3(0, 1, 0), spread: 0.9, gravity: 7, drag: 1.5, life: [1.2, 2.2], size: [0.12, 0.1], color: c, alpha: [1, 0.8] });
        audio.play('partyHorn', { pos: e.v === mySlot ? null : head, gain: 0.9 });
      } else {
        this.fxNorm.emit({ pos: head, count: 10, speed: [0.5, 2], life: [0.6, 1.2], size: [0.5, 1.2], color: 0xcfd6dc, alpha: [0.6, 0], gravity: -1 });
      }
      if (e.v !== mySlot) audio.play('thud', { pos: head, gain: 0.6 });
    }
    if (e.a === mySlot && e.v !== mySlot) {
      this.hud.hitmarker(true);
      for (const m of e.medals) {
        this.hud.medal(m);
        const ann = MEDALS[m]?.ann;
        if (ann) audio.announce(ann);
      }
      if (e.medals.length) audio.play('medal', { gain: 0.5 });
      if (e.head && !e.medals.some((m) => MEDALS[m]?.ann)) audio.announce('ann.headshot', 0.8);
    }
    if (e.v === mySlot) {
      this.killer = e.a;
      this.diedAt = this.time;
      this.hud.message(killer && e.a !== e.v ? `Killed by ${killer.name}` : 'You died', 2500, 'warn');
      this.beamSound?.stop();
      this.beamSound = null;
    }
  }

  // -------------------------------------------------------------------------------------------
  // FX helpers
  // -------------------------------------------------------------------------------------------

  private muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, w: WeaponId, mine: boolean) {
    const c = WEAPONS[w].fx.color;
    if (w === 'flamethrower') return;
    this.fxAdd.emit({ pos, count: mine ? 5 : 7, speed: [0.5, 3], dir, spread: 0.5, life: [0.04, 0.09], size: [mine ? 0.25 : 0.45, 0.05], color: 0xffffff, color1: c });
    if (!mine && this.q.level !== 'low') this.lights.flash(pos, c, 3, 6, 0.08);
  }

  private tracer(from: THREE.Vector3, to: THREE.Vector3, w: WeaponId) {
    const def = WEAPONS[w];
    switch (def.fx.tracer) {
      case 'rail':
        this.ribbons.add(from, to, 0x6ad8ff, 0.18, 0.6, 1);
        this.ribbons.add(from, to, 0xffffff, 0.05, 0.4, 1);
        break;
      case 'laser':
        this.ribbons.add(from, to, def.fx.color, 0.05, 0.25, 1);
        break;
      default:
        this.ribbons.add(from, to, def.fx.color, w === 'sniper' ? 0.06 : 0.04, w === 'sniper' ? 0.35 : 0.15, 0.9, w === 'sniper' ? 900 : 700);
        if (w === 'sniper') this.ribbons.add(from, to, 0xffffff, 0.02, 0.5, 0.35);
    }
  }

  private impact(p: THREE.Vector3, w: WeaponId) {
    const c = WEAPONS[w].fx.color;
    this.fxAdd.emit({ pos: p, count: 6, speed: [1, 4], life: [0.1, 0.3], size: [0.15, 0.02], color: 0xffffff, color1: c, gravity: 5 });
    this.fxNorm.emit({ pos: p, count: 5, speed: [0.3, 1.5], life: [0.5, 1], size: [0.3, 0.8], color: 0x8a7a5a, alpha: [0.6, 0], gravity: -0.5 });
  }

  private explosion(p: THREE.Vector3, r: number, w: WeaponId) {
    const big = r >= 5;
    const k = this.q.level === 'low' ? 0.6 : 1;
    const needle = w === 'needler';
    const col0 = needle ? 0xffd0ff : 0xfff0b0;
    const col1 = needle ? 0xff40c0 : 0xff5a10;
    this.fxAdd.emit({ pos: p, count: Math.round((big ? 45 : 28) * k), speed: [2, r * 2.2], life: [0.25, 0.6], size: [r * 0.55, r * 0.15], color: col0, color1: col1, drag: 3, jitter: 0.4 });
    this.fxAdd.emit({ pos: p, count: Math.round(18 * k), speed: [6, 16], life: [0.3, 0.8], size: [0.12, 0.03], color: 0xffe080, gravity: 12, drag: 0.5 });
    this.fxNorm.emit({ pos: p, count: Math.round((big ? 22 : 14) * k), speed: [0.8, 3], life: [1.2, 2.6], size: [r * 0.4, r * 0.9], color: 0x5a5550, color1: 0x9a9a9a, alpha: [0.75, 0], gravity: -1.2, drag: 1.2, jitter: r * 0.3 });
    this.fxNorm.emit({ pos: p, count: Math.round(12 * k), speed: [3, 8], dir: new THREE.Vector3(0, 1, 0), spread: 0.9, life: [0.8, 1.4], size: [0.1, 0.08], color: 0x5a4a30, gravity: 14, alpha: [1, 1] });
    this.lights.flash(p.clone().add(new THREE.Vector3(0, 1, 0)), needle ? 0xff60d0 : 0xffa040, big ? 60 : 30, r * 5, 0.35);
    const d = p.distanceTo(this.camera.position);
    this.shake = Math.min(1.2, this.shake + Math.max(0, 1 - d / (r * 6)) * (big ? 1.2 : 0.7));
    audio.play('explosion', { pos: p, gain: big ? 1.4 : needle ? 0.7 : 1, reverb: 0.6, rate: big ? 0.8 : needle ? 1.4 : 1, bus: 'guns' });
  }

  // -------------------------------------------------------------------------------------------
  // actors
  // -------------------------------------------------------------------------------------------

  private ensureSpartan(p: ViewPlayer): SpartanView {
    let sv = this.spartans.get(p.slot);
    if (sv && sv.color !== p.color) {
      this.scene.remove(sv.parts.root);
      disposeTree(sv.parts.root);
      sv.beamSound?.stop();
      this.spartans.delete(p.slot);
      sv = undefined;
    }
    if (!sv) {
      const parts = buildSpartan(p.color);
      this.scene.add(parts.root);
      sv = { slot: p.slot, parts, color: p.color, weapon: '', weaponModel: null, alive: p.alive, deathT: 0, deathDir: 1, flare: 0, flareColor: 0x6ad8ff, estShield: SHIELD_MAX, lastHitAt: -99, name: '', tag: null, tagFor: '', beamSound: null, voice: null, headScale: 1 };
      this.spartans.set(p.slot, sv);
    }
    return sv;
  }

  private updateSpartans(dt: number) {
    const s = this.session;
    const settings = s.start?.settings;
    const eye = this.eye();
    const xray = this.hasPu('xray');
    const seen = new Set<number>();
    for (const p of s.players) {
      if (!p) continue;
      seen.add(p.slot);
      const sv = this.ensureSpartan(p);
      const root = sv.parts.root;
      if (p.slot === s.slot) {
        root.visible = false;
        continue;
      }
      const hole = this.holeOf(p);
      // estimated shield regen for flare colours
      if (this.time - sv.lastHitAt > RECHARGE_DELAY) sv.estShield = Math.min(SHIELD_MAX, sv.estShield + SHIELD_RATE * dt);
      if (!p.alive && sv.alive) {
        sv.alive = false;
        sv.deathT = 0.0001;
      }
      if (p.alive && !sv.alive) {
        sv.alive = true;
        sv.deathT = 0;
      }
      if (!sv.alive) {
        sv.deathT += dt;
        root.visible = sv.deathT < 1.1;
        const t = Math.min(1, sv.deathT / 0.6);
        root.rotation.x = -t * 1.2 * sv.deathDir;
        root.position.set(hole.x, hole.rim + drop(0.6) - t * t * 1.4, hole.z);
        continue;
      }
      root.visible = true;
      root.rotation.set(0, 0, 0);
      root.position.set(hole.x, hole.rim + drop(p.exposure), hole.z);
      sv.parts.body.rotation.y = p.yaw;
      sv.parts.aim.rotation.x = p.pitch * 0.85;
      const hs = this.headScaleFor(p);
      if (hs !== sv.headScale) {
        sv.headScale = hs;
        sv.parts.head.scale.setScalar(hs);
        sv.parts.head.position.y = 0.37 + (hs - 1) * 0.2;
      }
      // weapon
      if (sv.weapon !== p.weapon) {
        if (sv.weaponModel) {
          sv.parts.weaponHolder.remove(sv.weaponModel);
          disposeTree(sv.weaponModel);
        }
        sv.weaponModel = buildWeaponModel(p.weapon);
        sv.parts.weaponHolder.add(sv.weaponModel);
        sv.weapon = p.weapon;
      }
      // camo & effects
      const camo = (p.flags & F_CAMO) !== 0;
      const alpha = camo ? 0.07 + 0.05 * Math.sin(this.time * 9 + p.slot) : 1;
      for (const m of sv.parts.materials) {
        const want = camo;
        if (m.transparent !== want) {
          m.transparent = want;
          m.needsUpdate = true;
        }
        m.opacity = alpha;
        m.depthTest = !xray;
      }
      sv.parts.root.renderOrder = xray ? 20 : 0;
      if (sv.weaponModel) sv.weaponModel.visible = !camo;
      let shellColor = 0;
      let shellStrength = 0;
      if (p.flags & F_INVINCIBLE) {
        shellColor = 0xffe640;
        shellStrength = 0.8 + 0.2 * Math.sin(this.time * 8);
      } else if (p.flags & F_OVERSHIELD) {
        shellColor = 0x40ff70;
        shellStrength = 0.7;
      } else if (p.flags & F_DAMAGE) {
        shellColor = 0xff3030;
        shellStrength = 0.5;
      }
      if (sv.flare > 0) {
        sv.flare = Math.max(0, sv.flare - dt * 4);
        if (sv.flare > shellStrength) {
          shellColor = sv.flareColor;
          shellStrength = sv.flare * 1.3;
        }
      }
      if (p.flags & F_BURNING && Math.random() < dt * 20) this.fxAdd.emit({ pos: this.headPos(p).add(new THREE.Vector3(0, -0.4, 0)), count: 1, speed: [0.5, 1.5], dir: new THREE.Vector3(0, 1, 0), spread: 0.4, life: [0.3, 0.6], size: [0.5, 0.1], color: 0xffc040, color1: 0xff3000, jitter: 0.5 });
      sv.parts.shell.visible = shellStrength > 0.01 && !camo;
      if (sv.parts.shell.visible) {
        sv.parts.shellMat.uniforms.color!.value.setHex(shellColor);
        sv.parts.shellMat.uniforms.strength!.value = shellStrength;
        sv.parts.shellMat.uniforms.time!.value = this.time;
      }
      // Pitre: the leader is the Cat in the Hat
      sv.parts.catHat.visible = !!settings?.pitre && settings.pitreCatHat && s.leader === p.slot && !camo;
      // charging & beams
      if (p.flags & F_CHARGING && sv.weaponModel && Math.random() < dt * 30) {
        const mz = this.muzzleOf(p.slot);
        this.fxAdd.emit({ pos: mz, count: 1, speed: [0.2, 1], life: [0.1, 0.25], size: [0.3, 0.05], color: 0xffffff, color1: WEAPONS[p.weapon].fx.color, jitter: 0.3 });
      }
      if (p.flags & F_BEAM && p.beamLen > 0) {
        if (!sv.beamSound && !this.brapMode()) sv.beamSound = audio.play('beamLoop', { pos: this.muzzleOf(p.slot), loop: true, gain: 0.8, bus: 'guns' });
        this.drawBeam(this.muzzleOf(p.slot), p.yaw, p.pitch, p.beamLen, sv.beamSound, p.slot);
      } else if (sv.beamSound) {
        sv.beamSound.stop();
        sv.beamSound = null;
      }
      // name tag when aimed at
      const head = this.headPos(p);
      const a = yawPitchOf({ x: head.x - eye.x, y: head.y - eye.y, z: head.z - eye.z });
      const off = Math.hypot(angleDiff(a.yaw, this.input.s.yaw), a.pitch - this.input.s.pitch);
      const showTag = off < 0.05 && !camo && p.exposure > 0.3;
      const tagText = `${s.leader === p.slot ? '👑 ' : ''}${p.name}`;
      if (showTag && sv.tagFor !== tagText) {
        if (sv.tag) {
          this.scene.remove(sv.tag);
          disposeTree(sv.tag);
        }
        sv.tag = textSprite(tagText, s.leader === p.slot ? '#ffd35a' : '#ffffff', 40);
        sv.tagFor = tagText;
        this.scene.add(sv.tag);
      }
      if (sv.tag) {
        sv.tag.visible = showTag;
        if (showTag) {
          const dist = head.distanceTo(eye);
          sv.tag.position.copy(head).add(new THREE.Vector3(0, 0.45 + dist * 0.012, 0));
          const k = (0.6 + dist * 0.035) * (this.camera.fov / this.input.opts.fov);
          const aspect = sv.tag.scale.x / sv.tag.scale.y;
          sv.tag.scale.set(k * aspect * 0.5, k * 0.5, 1);
        }
      }
    }
    for (const [slot, sv] of this.spartans) {
      if (!seen.has(slot)) {
        this.scene.remove(sv.parts.root);
        disposeTree(sv.parts.root);
        if (sv.tag) {
          this.scene.remove(sv.tag);
          disposeTree(sv.tag);
        }
        sv.beamSound?.stop();
        this.spartans.delete(slot);
      }
    }
    // own beam
    const me = s.me;
    if (me && me.bu > s.hostTick && me.al) {
      if (!this.beamSound && !this.brapMode()) this.beamSound = audio.play('beamLoop', { loop: true, gain: 0.7, bus: 'guns' });
      const mine = this.me;
      if (mine && mine.beamLen > 0) this.drawBeam(this.muzzleOf(s.slot), this.input.s.yaw, this.input.s.pitch, mine.beamLen, null, s.slot);
    } else if (this.beamSound) {
      this.beamSound.stop();
      this.beamSound = null;
    }
  }

  private drawBeam(from: THREE.Vector3, yaw: number, pitch: number, len: number, sound: SoundHandle | null, slot: number) {
    const d = dirFromYawPitch(yaw, pitch);
    const to = from.clone().add(new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(len));
    this.ribbons.add(from, to, 0xff4df0, 0.45, 0.05, 0.9);
    this.ribbons.add(from, to, 0xffffff, 0.12, 0.05, 1);
    if (Math.random() < 0.6) this.fxAdd.emit({ pos: to, count: 2, speed: [1, 4], life: [0.1, 0.3], size: [0.4, 0.05], color: 0xffffff, color1: 0xff4df0 });
    sound?.setPos(from);
    void slot;
  }

  private updateOrbs(dt: number) {
    const s = this.session;
    const t = s.renderTick;
    for (const [id, o] of s.orbs) {
      let v = this.orbs.get(id);
      if (!v) {
        const def = POWERUPS[o.type as PowerUpId];
        const color = def?.color ?? 0xffffff;
        const group = buildOrb(color);
        const label = textSprite(`${def?.icon ?? '?'} ${def?.name ?? ''}`, '#ffffff', 36);
        group.add(label);
        label.position.y = 1.25;
        this.scene.add(group);
        v = { id, group, color, label };
        this.orbs.set(id, v);
      }
      const p = orbPos(o, t, this.arena);
      v.group.position.set(p.x, p.y, p.z);
      v.group.rotation.y += dt * 1.5;
      v.group.rotation.z = Math.sin(this.time * 2 + id) * 0.25;
      const aura = v.group.userData.aura as THREE.Mesh;
      (aura.material as THREE.ShaderMaterial).uniforms.time!.value = this.time;
      const dist = p.y - this.camera.position.y;
      v.label.visible = Math.hypot(p.x - this.camera.position.x, p.z - this.camera.position.z, dist) < 60;
    }
    for (const [id, v] of this.orbs) {
      if (!s.orbs.has(id)) {
        this.scene.remove(v.group);
        disposeTree(v.group);
        this.orbs.delete(id);
      }
    }
  }

  private addProjectile(id: string, pr: Projectile, local: boolean) {
    const w = pr.weapon;
    const obj = projMesh(WEAPONS[w].fx.tracer);
    if (obj) this.scene.add(obj);
    this.projs.set(id, { pr, obj, weapon: w, local, trailAcc: 0 });
    if (w === 'rpg') audio.play('rocket', { pos: local ? null : { x: pr.x, y: pr.y, z: pr.z }, gain: 0.5, rate: 1.3, bus: 'guns' });
  }

  private removeProjectile(id: string) {
    const pv = this.projs.get(id);
    if (!pv) return;
    if (pv.obj) this.scene.remove(pv.obj); // geometry/materials are shared (projMesh)
    this.projs.delete(id);
  }

  private updateProjectiles(dt: number) {
    const s = this.session;
    const steps = Math.max(1, Math.round(dt * TICK_RATE));
    for (const [id, pv] of this.projs) {
      const def = WEAPONS[pv.weapon].projectile!;
      const pr = pv.pr;
      const hom = s.homing.get(pr.id);
      let dead = false;
      for (let i = 0; i < steps && !dead; i++) {
        const prev = { x: pr.x, y: pr.y, z: pr.z };
        if (hom) {
          pr.x += (hom.x - pr.x) * 0.35;
          pr.y += (hom.y - pr.y) * 0.35;
          pr.z += (hom.z - pr.z) * 0.35;
        } else integrateProjectile(pr, def, null);
        const seg = { x: pr.x - prev.x, y: pr.y - prev.y, z: pr.z - prev.z };
        const L = Math.hypot(seg.x, seg.y, seg.z);
        if (L > 0 && !hom) {
          const d = { x: seg.x / L, y: seg.y / L, z: seg.z / L };
          const hit = this.arena.raycast(prev, d, L);
          if (hit < L && !def.bounce) {
            if (pv.local) dead = true;
            pr.x = prev.x + d.x * hit;
            pr.y = prev.y + d.y * hit;
            pr.z = prev.z + d.z * hit;
            pr.vx = pr.vy = pr.vz = 0;
          } else if (hit < L && def.bounce) {
            pr.bounces++;
            if (pv.local && pr.bounces > def.bounce.max) dead = true;
            pr.vx *= 0.5;
            pr.vy = Math.abs(pr.vy) * def.bounce.restitution;
            pr.vz *= 0.5;
            pr.x = prev.x;
            pr.y = prev.y + 0.05;
            pr.z = prev.z;
          }
          if (pv.local) {
            for (const p of s.players) {
              if (!p || p.slot === s.slot || !p.alive) continue;
              const h = rayHitbox(prev, d, hitboxOf(this.holeOf(p), p.exposure, this.headScaleFor(p)), def.radius);
              if (h && h.t < L) dead = true;
            }
          }
        }
      }
      const age = (s.hostTick - pr.born) / TICK_RATE;
      if (pv.local && age > def.life + 0.2) dead = true;
      if (pv.local && pr.fuseAt && s.hostTick >= pr.fuseAt) dead = true;
      if (!pv.local && age > def.life + 1.5) dead = true;
      if (dead) {
        this.removeProjectile(id);
        continue;
      }
      if (pv.obj) {
        pv.obj.position.set(pr.x, pr.y, pr.z);
        tmpV.set(pr.vx, pr.vy, pr.vz);
        if (tmpV.lengthSq() > 0.01) pv.obj.lookAt(tmpV2.set(pr.x, pr.y, pr.z).sub(tmpV));
      }
      // trails
      pv.trailAcc += dt;
      const w = pv.weapon;
      if (w === 'flamethrower') {
        this.fxAdd.emit({ pos: pr, count: 1, speed: [0, 0.6], life: [0.12, 0.25], size: [0.35 + age * 1.6, 0.9 + age * 2], color: 0xffe080, color1: 0xff3000, alpha: [0.9, 0] });
        if (Math.random() < 0.3) this.fxNorm.emit({ pos: pr, count: 1, speed: [0.3, 1], life: [0.5, 0.9], size: [0.4, 1.2], color: 0x3a3030, alpha: [0.35, 0], gravity: -2 });
      } else if (pv.trailAcc > 0.02) {
        pv.trailAcc = 0;
        if (w === 'rpg') {
          this.fxAdd.emit({ pos: pr, count: 1, speed: [0, 0.3], life: [0.1, 0.2], size: [0.4, 0.1], color: 0xffd080, color1: 0xff5000 });
          this.fxNorm.emit({ pos: pr, count: 1, speed: [0.1, 0.4], life: [0.8, 1.4], size: [0.3, 1.1], color: 0xb0b0b0, alpha: [0.55, 0], gravity: -0.4 });
        } else if (w === 'crossbow') this.fxAdd.emit({ pos: pr, count: 1, speed: [0, 0.1], life: [0.15, 0.25], size: [0.12, 0.02], color: 0x9fe8ff });
        else if (w === 'needler') this.fxAdd.emit({ pos: pr, count: 1, speed: [0, 0.1], life: [0.1, 0.2], size: [0.14, 0.02], color: 0xff5fd2 });
        else if (w === 'grenade') this.fxAdd.emit({ pos: pr, count: 1, speed: [0, 0.1], life: [0.15, 0.3], size: [0.18, 0.02], color: 0x7cff6b });
      }
    }
  }

  private updateStrikes() {
    const s = this.session;
    for (const [id, st] of this.strikes) {
      const left = (st.at - s.hostTick) / TICK_RATE;
      if (left < -0.2) {
        this.strikes.delete(id);
        continue;
      }
      const top = st.pos.clone().add(new THREE.Vector3(0, 160, 0));
      this.ribbons.add(top, st.pos, 0xff2020, 0.08 + (1 - Math.max(0, left) / 2) * 0.5, 0.05, 0.8);
      if (!st.whistled && left < 1.6) {
        st.whistled = true;
        audio.play('whistle', { pos: st.pos, gain: 1 });
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // camera & viewmodel
  // -------------------------------------------------------------------------------------------

  private updateCamera(dt: number) {
    const s = this.session;
    const me = this.me;
    const inp = this.input.s;
    const settings = this.input.opts;
    const alive = !!s.me?.al;
    const holeNow = this.myHole();
    if (me && holeNow.id !== this.lastHole) {
      this.lastHole = holeNow.id;
      this.grass.layout(holeNow.x, holeNow.z);
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.camKick = Math.max(0, this.camKick - dt * 0.12);
    const sx = (Math.random() - 0.5) * this.shake * 0.02;
    const sy = (Math.random() - 0.5) * this.shake * 0.02;
    if (alive || !me) {
      const e = this.eye();
      this.camera.position.copy(e);
      this.camera.rotation.set(0, 0, 0, 'YXZ');
      this.camera.rotation.y = inp.yaw + sx;
      this.camera.rotation.x = inp.pitch + sy + this.camKick;
      this.wasAlive = true;
    } else {
      // death cam: rise above the hole and look at the killer
      const h = this.myHole();
      const t = Math.min(1, (this.time - this.diedAt) / 1.2);
      const target = this.killer >= 0 && this.killer !== s.slot ? this.posOf(this.killer) : new THREE.Vector3(0, 2, 0);
      const base = new THREE.Vector3(h.x, h.rim + 0.9, h.z);
      const away = base.clone().sub(target ?? new THREE.Vector3()).setY(0).normalize();
      const camPos = base.clone().add(new THREE.Vector3(0, 1 + t * 3.5, 0)).addScaledVector(away, t * 4);
      this.camera.position.lerp(camPos, this.wasAlive ? 1 : 0.1);
      this.wasAlive = false;
      if (target) this.camera.lookAt(target);
    }
    // zoom
    const w = this.myWeaponDef();
    const zoomF = inp.zoom > 0 && alive ? w.zoom[inp.zoom - 1] ?? 1 : 1;
    const fov = settings.fov / zoomF;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 18);
      this.camera.updateProjectionMatrix();
    }
  }

  private updateViewmodel(dt: number) {
    const s = this.session;
    const me = s.me;
    const alive = !!me?.al;
    const w = this.myWeapon();
    const scoped = this.input.s.zoom > 0 && (WEAPONS[w].zoom[this.input.s.zoom - 1] ?? 1) >= 2.4;
    this.vmHolder.visible = alive && !scoped && s.phase !== 'ended';
    if (w !== this.vmWeapon) {
      if (this.vmModel) {
        this.vmHolder.remove(this.vmModel);
        disposeTree(this.vmModel);
      }
      this.vmModel = buildWeaponModel(w);
      // gloved hand
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.14), new THREE.MeshLambertMaterial({ color: this.me?.color ?? 0x3d7bff }));
      glove.position.set(0, -0.1, 0.02);
      this.vmModel.add(glove);
      this.vmHolder.add(this.vmModel);
      this.vmWeapon = w;
    }
    this.vmKick = Math.max(0, this.vmKick - dt * 5);
    const reloadF = me && me.rl > s.hostTick && me.rs > 0 ? 1 - (me.rl - s.hostTick) / Math.max(1, me.rl - me.rs) : 0;
    const reloadDip = reloadF > 0 ? Math.sin(Math.min(1, reloadF) * Math.PI) : 0;
    const exp = s.myExposure;
    const bob = Math.sin(this.time * 2) * 0.004;
    this.vmHolder.scale.setScalar(0.6);
    this.vmHolder.position.set(0.3, -0.27 - (1 - exp) * 0.25 - reloadDip * 0.18 + bob, -0.46 + this.vmKick * 0.06);
    this.vmHolder.rotation.set(this.vmKick * 0.12 - reloadDip * 0.6, 0.06, reloadDip * 0.35);
  }

  // -------------------------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------------------------

  private scoreRows(): ScoreRow[] {
    const s = this.session;
    const gg = s.start?.settings.weaponMode === 'gunGame';
    return s.players
      .filter((p): p is ViewPlayer => !!p)
      .map((p) => {
        const slotInfo = s.lobby?.slots.find((x) => x.slot === p.slot);
        return { slot: p.slot, name: p.name, color: p.color, kills: p.kills, deaths: p.deaths, score: gg ? p.gunLevel : p.kills, ping: slotInfo?.ping, me: p.slot === s.slot, bot: p.kind === 'bot', leader: s.leader === p.slot };
      });
  }

  private updateHud() {
    const s = this.session;
    const me = s.me;
    const settings = s.start?.settings;
    if (!settings) return;
    const hud = this.hud;
    if (me) {
      hud.shield(me.sh, me.shm, me.hp, me.hpm, me.os, me.al);
      if (me.al && me.sh < me.shm * 0.25 && me.shm > 0 && this.time - this.lowShieldAt > 1.2) {
        this.lowShieldAt = this.time;
        audio.play('lowShield', { gain: 0.25 });
      }
      if (me.sh > this.prevShield + 5 && this.prevShield < 5) audio.play('recharge', { gain: 0.5 });
      this.prevShield = me.sh;
      const w = weaponByIndex(me.w);
      const def = WEAPONS[w];
      const clipMax = def.clip > 0 ? Math.max(1, Math.round(def.clip * settings.clipMult)) : 0;
      const infinite = settings.ammoMode === 'noReload' || def.clip <= 0;
      hud.ammo(w, me.clip, clipMax, infinite, me.rl > s.hostTick);
      // reticle turns red over an enemy
      const a = this.assistInfo();
      const red = !!a && Math.hypot(a.dYaw, a.dPitch) < a.radius * 1.2;
      const scoped = this.input.s.zoom > 0 && (def.zoom[this.input.s.zoom - 1] ?? 1) >= 2.4;
      hud.reticle(red, me.al && !scoped);
      hud.scope(me.al && scoped, scoped ? `${def.zoom[this.input.s.zoom - 1]}×` : '');
      // charge ring
      let charge = 0;
      if (me.cs >= 0 && def.chargeTime) charge = (s.hostTick - me.cs) / (def.chargeTime * TICK_RATE);
      if (me.bu > s.hostTick && def.beamTime) charge = (me.bu - s.hostTick) / (def.beamTime * TICK_RATE);
      hud.charge(me.al ? charge : 0);
      // power-ups
      const pus = me.pu
        .filter(([, until]) => until > s.hostTick)
        .map(([id, until]) => ({ id: id as PowerUpId, frac: (until - s.hostTick) / (POWERUPS[id as PowerUpId].duration * settings.powerupDurationMult * TICK_RATE) }));
      if (me.ud > s.hostTick) pus.push({ id: 'camo', frac: (me.ud - s.hostTick) / (20 * TICK_RATE) });
      hud.powerups(pus);
      // respawn / warnings
      if (!me.al && s.phase !== 'ended') {
        const left = me.ra > 0 ? Math.max(0, Math.ceil((me.ra - s.hostTick) / TICK_RATE)) : 0;
        const key = this.respawnKey();
        if (settings.respawnMode !== 'manual') hud.sub(left > 0 ? `Respawn in ${left}` : 'Respawning…');
        else if (me.rq) hud.sub(left > 0 ? `Respawning in ${left}…` : 'Respawning…');
        else hud.sub(left > 0 ? `Respawn in ${left} · press ${key} when ready` : `Press ${key} to respawn`);
      } else if (me.al && settings.antiTurtleSec > 0 && me.ds >= 0 && s.phase === 'live') {
        const left = settings.antiTurtleSec - (s.hostTick - me.ds) / TICK_RATE;
        hud.sub(left < 3 ? `Pop up in ${Math.max(0, left).toFixed(1)}s` : '');
      } else if (!this.endShown) hud.sub(me.al && me.rl > s.hostTick ? 'Reloading' : '');
    }
    // timer
    let timer = '';
    if (settings.timeLimitMin > 0 && s.start) {
      const end = s.start.liveAt + settings.timeLimitMin * 60 * TICK_RATE;
      const left = Math.max(0, (end - Math.max(s.hostTick, s.start.liveAt)) / TICK_RATE);
      const sec = Math.ceil(left);
      timer = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      if (sec <= 10 && sec !== this.lastSec && sec > 0 && s.phase === 'live') audio.play('beep', { gain: 0.4 });
      this.lastSec = sec;
    }
    const mode = settings.weaponMode === 'gunGame' ? `GUN GAME · ${settings.gunGameOrder.length} LEVELS` : settings.scoreLimit > 0 ? `SLAYER · FIRST TO ${settings.scoreLimit}` : 'SLAYER';
    hud.timer(timer, `${settings.pitre ? '🎩 PITRE · ' : ''}${mode}`);
    const rows = this.scoreRows();
    hud.score(rows, settings.weaponMode === 'gunGame' ? settings.gunGameOrder.length : settings.scoreLimit);
    if (!this.introShown && s.phase === 'intro') {
      this.introShown = true;
      hud.message('Get ready', 2200, 'big');
    }
    if (!s.isLocal) hud.conn(`${s.lobby?.code ?? ''} · ${Math.round(s.interpDelay * 16.7)}ms buffer`);
    this.scoreboardEl.classList.toggle('on', this.showScores || s.phase === 'ended');
    if (this.showScores || s.phase === 'ended') {
      const html = scoreboardHtml(rows, settings.weaponMode === 'gunGame');
      if (this.scoreboardEl.innerHTML !== html) this.scoreboardEl.innerHTML = html;
    }
    this.input.updateTouchLabels();
  }

  private respawnKey() {
    return this.input.device === 'pad' ? 'Ⓐ' : this.input.device === 'touch' ? 'RESPAWN' : 'SPACE';
  }

  static qualityFor(level: keyof typeof QUALITY) {
    return QUALITY[level];
  }
}

