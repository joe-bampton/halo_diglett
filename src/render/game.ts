import * as THREE from 'three';
import { audio, type SoundHandle } from '../audio/audio';
import { PITRE_SLOT, PitreHitTracker, PitreVoiceThrottle, pitreCues, type PitreCue } from '../audio/pitre';
import type { SfxId } from '../audio/synth';
import { InputManager, zoomSensitivity, type AssistInfo } from '../input/input';
import type { ClientSession, ViewPlayer } from '../net/client';
import { COSMETIC_EVENTS, F_BEAM, F_BURNING, F_CAMO, F_CHARGING, F_DAMAGE, F_INVINCIBLE, F_OVERSHIELD, F_RELOAD, F_SAUCED } from '../net/protocol';
import { angleDiff, dirFromYawPitch, yawPitchOf } from '../shared/vec';
import { Arena, MOUTH_R, RIM_OUT, WELL_DEPTH } from '../sim/arena';
import { sauceAimScale, sauceLeft } from '../sim/sauce';
import { SPRING_TICKS, inFlight, springLift } from '../sim/spring';
import { FIRE_EXPOSURE, HEAD_R, RECHARGE_DELAY, SHIELD_MAX, SHIELD_RATE, TICK_RATE } from '../sim/constants';
import { raySphere } from '../sim/geom';
import { bigHeadShift, drop, eyePos, hitboxOf, rayHitbox } from '../sim/hitbox';
import { orbPos, orbRadius } from '../sim/orbs';
import { POWERUPS, type PowerUpId } from '../sim/powerups';
import type { Projectile, SimEvent, Vec3T } from '../sim/types';
import { WEAPONS, hostDrawn, weaponByIndex, type WeaponId } from '../sim/weapons';
import { setHtml, setStyle } from '../ui/dom';
import { Hud, MEDALS, scoreboardHtml, type ScoreRow } from '../ui/hud';
import { Decals, FlashLights, Particles, Ribbons, Shockwaves } from './fx';
import { loadDetailedModels } from './assets';
import { CAN_H, CAN_SCALE, GLB, SHARED, buildCan, buildOrb, buildSauceBlob, buildSpartan, buildSpring, buildWeaponModel, textSprite, type SpartanParts } from './models';
import { PAL, SAUCE } from './palette';
import type { PostFx } from './post';
import { DynRes } from './dynres';
import { MAX_CATCHUP, newTrack, stepTrack, trackPos, type ProjTrack, type TargetTest } from './projtrack';
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
  /** speech bubble for callouts ("SUPPRESSING FIRE!") */
  bubble: THREE.Sprite | null;
  bubbleUntil: number;
  /** dollops of Gerry Sauce stuck on them */
  sauce: THREE.Mesh[];
}

/** "Auto" graphics on High / Ultra: seconds of play to average, and the frame rate it must keep. */
const AUTO_CHECK = 12;
const AUTO_MIN_FPS = 45;

/** How long the first-person grenade throw takes (s). */
const THROW_ANIM = 0.75;

/** Sound-and-light events this late (a connection that stalled, then caught up) are skipped. */
const STALE_FX_TICKS = Math.round(0.5 * TICK_RATE);

/** On-screen text for voice callouts. */
const CALLOUT_TEXT: Record<string, string> = { 'jerry.suppress': 'SUPPRESSING FIRE!' };

interface ProjView {
  track: ProjTrack;
  obj: THREE.Object3D | null;
  weapon: WeaponId;
  /** my own shot, predicted here (the host's copy of it is never drawn) */
  local: boolean;
  trailAcc: number;
  /** a plasma grenade stuck to this player: drawn on them as they move */
  attach?: { slot: number; off: { x: number; y: number; z: number } } | null;
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
  sniper: 'sniper', br: 'rifle', crossbow: 'crossbow', rpg: 'rocket', grenade: 'bloop', railgun: 'rail', hyperbeam: 'charge', needler: 'needle', flamethrower: 'flameLoop', minigun: 'minigun', orbital: 'beep', soaker: 'squirt', frag: 'toss', plasma: 'toss',
};

/** Dispose geometries, materials and textures of a detached subtree. */
function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !SHARED.has(m.geometry)) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      if (SHARED.has(mat)) continue;
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map && !SHARED.has(map)) map.dispose();
      mat.dispose();
    }
  });
}

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
    const fragGeo = keep(new THREE.SphereGeometry(0.08, 10, 8).scale(1, 1.25, 1));
    const fragMat = keep(new THREE.MeshLambertMaterial({ color: 0x4a5a32 }));
    projCache.set('frag', () => new THREE.Mesh(fragGeo, fragMat));
    const plasmaCore = keep(new THREE.SphereGeometry(0.09, 12, 8));
    const plasmaMat = keep(new THREE.MeshBasicMaterial({ color: 0xbfe6ff }));
    const plasmaGlow = keep(new THREE.SphereGeometry(0.2, 12, 8));
    const plasmaGlowMat = keep(new THREE.MeshBasicMaterial({ color: 0x3a9cff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    projCache.set('plasma', () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(plasmaCore, plasmaMat));
      g.add(new THREE.Mesh(plasmaGlow, plasmaGlowMat));
      return g;
    });
  }
  return projCache.get(kind)?.() ?? null;
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpP = { x: 0, y: 0, z: 0 };
/** the "running slow?" hint shows once per visit */
let slowHintShown = false;

export interface GameHooks {
  onMenu(): void;
  isMenuOpen(): boolean;
  /** High or Ultra under "Auto" ran too slowly in the first seconds of play: the app may drop to Medium */
  onTooSlow?(): void;
}

export class Game {
  readonly arena: Arena;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private vmScene = new THREE.Scene();
  private vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  private vmHolder = new THREE.Group();
  private vmModel: THREE.Group | null = null;
  private vmWeapon: WeaponId | '' = '';
  private vmKick = 0;
  /** seconds since a grenade left the hand (the throw animation) */
  private vmThrow = 9;
  private sky: THREE.Mesh;
  private terrain: THREE.Mesh;
  /** terrain detail it was built with (it changes only with a new match) */
  private terrainSegs: number;
  private holes: THREE.Group;
  private grass: Grass;
  private trees: THREE.InstancedMesh;
  private sun: THREE.DirectionalLight;
  private fxAdd!: Particles;
  private fxNorm!: Particles;
  /** Gerry Sauce spray gets its own pool so it can't push combat effects out */
  private fxSauce!: Particles;
  private decals: Decals;
  private shockwaves = new Shockwaves(8);
  /** High / Ultra: bloom + tone mapping (null = draw straight to the canvas) */
  private post: PostFx | null = null;
  private postGen = 0;
  /** High / Ultra: the sky as an environment map, for reflections on PBR materials */
  private envRT: THREE.WebGLRenderTarget | null = null;
  private fpsEl: HTMLElement | null = null;
  /** frame-rate watch for the "running slow?" hint: 5 s windows, two slow ones in a row */
  private fpsWatch = { t: 0, n: 0, slow: 0 };
  /** frame-rate check of High / Ultra in the first seconds of play (see GameHooks.onTooSlow) */
  private autoWatch = { t: 0, n: 0, done: false };
  private fpsAvg = { t: 0, n: 0 };
  /** which load of the detailed models the Spartans etc. were built with */
  private glbSeen = 0;
  /** Super Soaker squirts in flight: one custard jet per target, launched so it lands exactly when the sauce does */
  private sauceViews = new Map<number, { owner: number; at: number; fired: number; jets: { from: THREE.Vector3; v: THREE.Vector3 }[] | null }>();
  private ribbons: Ribbons;
  private lights: FlashLights;
  private spartans = new Map<number, SpartanView>();
  /** scratch (per-frame code must not allocate: garbage collection pauses are hitches on phones) */
  private camPos = new THREE.Vector3();
  private tagHead = new THREE.Vector3();
  private seenSlots = new Set<number>();
  private orbs = new Map<number, OrbView>();
  private projs = new Map<string, ProjView>();
  private strikes = new Map<number, StrikeView>();
  readonly hud: Hud;
  readonly input: InputManager;
  private pitre = new PitreVoiceThrottle();
  /** hits in a row without a kill, per shooter ("How many bullets?!") */
  private pitreHits = new PitreHitTracker();
  private raf = 0;
  private last = 0;
  private time = 0;
  private shake = 0;
  private camKick = 0;
  /** dynamic resolution (Low / Medium, or switched on in Advanced) */
  private dynRes: DynRes | null = null;
  private grassAt = new THREE.Vector2(NaN, NaN);
  /** spectating while dead: who we watch and how (the orbit angles/zoom live in input.spec) */
  private spec = { active: false, target: -1, view: 'third' as 'first' | 'third', snap: true, pos: new THREE.Vector3(), yaw: 0, pitch: 0, reload: 0 };
  private vmColor = -1;
  private wasAlive = false;
  private killer = -1;
  private diedAt = 0;
  private diedAtMs = 0;
  private pred = { lastShot: -1e9, pending: false, pendingAt: -1e9, fresh: false, burst: 0, nextBurst: 0, localId: 0 };
  private chargeSound: SoundHandle | null = null;
  private lowShieldAt = 0;
  private prevShield = 70;
  private showScores = false;
  private boardShown = false;
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
    this.arena = session.start?.arena ? new Arena(session.start.arena) : new Arena();
    const canvas = document.createElement('canvas');
    canvas.className = 'game';
    container.appendChild(canvas);
    // with post-processing the MSAA happens in its buffer; the canvas's own can't change later
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias && !quality.post, powerPreference: 'high-performance', stencil: false });
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
    // the sun's shadow box covers the whole fenced field (bigger custom fields included)
    const ks = Math.max(1, this.arena.scale);
    this.sun.position.set(45 * ks, 60 * ks, -65 * ks);
    const c = this.sun.shadow.camera;
    const R = this.arena.fenceRadius + 10;
    c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 10; c.far = 220 * ks;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    if (quality.shadows !== 'none') {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    }
    this.scene.add(this.sun, this.sun.target);
    // world
    this.sky = buildSky();
    this.scene.add(this.sky);
    this.terrainSegs = quality.angularSegs;
    this.terrain = buildTerrain(this.arena, quality);
    this.holes = buildHoles(this.arena, quality.textures);
    this.scene.add(this.terrain, this.holes);
    this.scene.add(buildFence(this.arena));
    this.trees = buildTrees(this.arena, quality);
    this.scene.add(this.trees);
    this.scene.add(buildFlowers(this.arena));
    this.grass = new Grass(this.arena, quality);
    this.scene.add(this.grass.mesh);
    // fx
    this.buildParticles();
    this.decals = new Decals(
      64,
      (x, z) => this.arena.groundAt(x, z),
      (x, z) => {
        const h = this.arena.nearestHole(x, z);
        return !!h && Math.hypot(h.x - x, h.z - z) < RIM_OUT;
      },
    );
    this.scene.add(this.decals.mesh, this.shockwaves.mesh);
    this.ribbons = new Ribbons(160);
    this.lights = new FlashLights(this.scene, quality.flashLights);
    this.scene.add(this.ribbons.mesh);
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
      canSpring: () => this.canSpring(),
      aimScale: () => this.aimScale(),
      // the camera's own (smoothly zooming) field of view, so aim speed always matches what's on screen
      fovScale: () => zoomSensitivity(this.camera.fov, this.input.opts.fov),
    });
    this.input.mountTouch(this.touchEl);
    this.applyDevice();
    if (new URLSearchParams(location.search).has('perf')) {
      this.perfEl = document.createElement('div');
      this.perfEl.className = 'perf';
      container.appendChild(this.perfEl);
    }
    this.makeDynRes();
    this.onResize();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.renderer.setClearColor(PAL.horizon);
    this.setupPost();
    this.applyEnv();
    if (quality.models === 'detailed') void loadDetailedModels();
    if (quality.shadows === 'static') this.bakeStaticShadows();
    this.warmUpShaders();
    // every announcer line (medals, power-ups…): a line that isn't decoded yet when it's due is skipped
    audio.preloadPrefix('ann.');
    audio.preload(Object.keys(CALLOUT_TEXT));
    if (session.start?.settings.pitre) audio.preload(Object.values(PITRE_SLOT));
  }

  private applyDevice() {
    const touch = this.input.device === 'touch';
    this.touchEl.classList.toggle('on', touch);
    document.querySelector('.rotate')?.classList.toggle('ingame', touch);
  }

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dprCap) * this.q.renderScale * (this.dynRes?.scale ?? 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  };

  /** Back from another app or tab: the first frames are slow (everything wakes up) and say nothing about the GPU. */
  private onVisibility = () => {
    if (!document.hidden) this.dynRes?.pause();
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
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.unlock();
    this.input.destroy();
    for (const s of this.spartans.values()) {
      s.beamSound?.stop();
      s.voice?.stop();
    }
    this.chargeSound?.stop();
    this.beamSound?.stop();
    this.myVoice?.stop();
    for (const o of this.warmed) disposeTree(o);
    this.post?.dispose();
    this.envRT?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.container.innerHTML = '';
  }

  /**
   * New graphics settings, mid-match (Options from the pause menu). Only terrain detail and the canvas's own
   * MSAA (no post-processing) wait for the next match.
   */
  applyGraphics(next: QualityPreset) {
    const prev = this.q;
    this.q = next;
    this.makeDynRes();
    if (prev.shadows !== next.shadows || prev.shadowSize !== next.shadowSize) this.applyShadows(prev.shadows !== 'none');
    if (prev.particles !== next.particles) this.buildParticles();
    if (prev.flashLights !== next.flashLights) {
      this.lights.dispose();
      this.lights = new FlashLights(this.scene, next.flashLights);
    }
    if (prev.grassClumps !== next.grassClumps || prev.grassRadius !== next.grassRadius) {
      this.scene.remove(this.grass.mesh);
      disposeTree(this.grass.mesh);
      this.grass = new Grass(this.arena, next);
      this.scene.add(this.grass.mesh);
      this.grassAt.set(NaN, NaN);
    }
    if (prev.textures !== next.textures) {
      // textured ground and stones (or back to flat colours)
      for (const o of [this.terrain, this.holes]) {
        this.scene.remove(o);
        disposeTree(o);
      }
      this.terrain = buildTerrain(this.arena, { ...next, angularSegs: this.terrainSegs });
      this.holes = buildHoles(this.arena, next.textures);
      this.scene.add(this.terrain, this.holes);
      if (next.shadows === 'static') this.bakeStaticShadows();
    }
    if (prev.trees !== next.trees) {
      this.scene.remove(this.trees);
      disposeTree(this.trees);
      this.trees = buildTrees(this.arena, next);
      this.scene.add(this.trees);
      if (next.shadows === 'static') this.bakeStaticShadows();
    }
    if (prev.post !== next.post || prev.antialias !== next.antialias || prev.smaa !== next.smaa || prev.ao !== next.ao) this.setupPost();
    if (next.models === 'detailed') void loadDetailedModels();
    if (prev.pbr !== next.pbr || prev.models !== next.models) this.rebuildModels();
    this.onResize();
  }

  private get detailed() {
    return this.q.models === 'detailed';
  }

  private buildParticles() {
    for (const p of [this.fxAdd, this.fxNorm, this.fxSauce]) {
      if (!p) continue;
      this.scene.remove(p.mesh);
      p.dispose();
    }
    const n = this.q.particles;
    this.fxAdd = new Particles(n, true);
    this.fxNorm = new Particles(Math.round(n * 0.7), false);
    this.fxSauce = new Particles(Math.round(n * 1.5), false, true);
    this.scene.add(this.fxAdd.mesh, this.fxNorm.mesh, this.fxSauce.mesh);
  }

  private applyShadows(wasOn: boolean) {
    const q = this.q;
    const on = q.shadows !== 'none';
    const sm = this.renderer.shadowMap;
    sm.enabled = on;
    sm.autoUpdate = q.shadows === 'dynamic';
    this.sun.castShadow = on;
    if (on && this.sun.shadow.mapSize.x !== q.shadowSize) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    }
    // every lit material compiles with or without shadow code
    if (wasOn !== on)
      for (const sc of [this.scene, this.vmScene])
        sc.traverse((o) => {
          const m = (o as THREE.Mesh).material;
          if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
        });
    if (q.shadows === 'static') this.bakeStaticShadows();
  }

  /** "Low" shadows are drawn once, of the field without anyone on it (players' shadows would go stale). */
  private bakeStaticShadows() {
    const hidden: THREE.Object3D[] = [];
    for (const sv of this.spartans.values())
      if (sv.parts.root.visible) {
        sv.parts.root.visible = false;
        hidden.push(sv.parts.root);
      }
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    // the next frame draws over this one
    this.renderer.render(this.scene, this.camera);
    for (const o of hidden) o.visible = true;
  }

  /**
   * Compile the shaders of everything that first shows up mid-match (power-up orbs or cans, projectiles, the spring,
   * custard, name tags, Spartans and every gun) while the intro plays, instead of hitching the first time each appears.
   */
  private warmUpShaders() {
    const pbr = this.q.pbr, det = this.detailed;
    const world = new THREE.Group();
    const vm = new THREE.Group();
    world.visible = vm.visible = false;
    for (const k of ['rocket', 'bolt', 'grenade', 'frag', 'plasma', 'needle']) {
      const o = projMesh(k);
      if (o) world.add(o);
    }
    world.add(this.cans() ? buildCan(0xffffff, pbr, det) : buildOrb(0xffffff, pbr), buildSpring(det), buildSauceBlob(), textSprite('·'));
    world.add(buildSpartan(0xffffff, pbr, det).root);
    for (const w of Object.keys(WEAPONS) as WeaponId[]) {
      world.add(buildWeaponModel(w, pbr, det));
      vm.add(buildWeaponModel(w, pbr, det));
    }
    this.scene.add(world);
    this.vmScene.add(vm);
    // out of the scenes once compiled, but kept (and disposed with the game): disposing a material frees its shader
    // when nothing else uses it yet, which would undo the warm-up
    this.warmed = [world, vm];
    const done = () => {
      this.scene.remove(world);
      this.vmScene.remove(vm);
    };
    Promise.all([this.renderer.compileAsync(this.scene, this.camera), this.renderer.compileAsync(this.vmScene, this.vmCamera)]).then(done, done);
  }
  private warmed: THREE.Object3D[] = [];

  /** Post-processing code is only downloaded when it's switched on (it draws straight to the canvas until then). */
  private setupPost() {
    const gen = ++this.postGen;
    this.post?.dispose();
    this.post = null;
    if (!this.q.post) return;
    const q = this.q;
    void import('./post').then(({ PostFx }) => {
      if (gen !== this.postGen || this.destroyed) return;
      this.post = new PostFx(this.renderer, this.scene, this.camera, this.vmScene, this.vmCamera, { msaa: q.antialias, smaa: q.smaa, ao: q.ao });
      this.onResize();
    });
  }

  /** PBR materials reflect the sky: a pre-filtered environment map made from the sky dome and a green ground. */
  private applyEnv() {
    if (this.q.pbr && !this.envRT) {
      const pm = new THREE.PMREMGenerator(this.renderer);
      const env = new THREE.Scene();
      env.add(buildSky());
      const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4d6a2e }));
      ground.position.y = -20;
      env.add(ground);
      this.envRT = pm.fromScene(env, 0.02, 0.1, 1000);
      pm.dispose();
      disposeTree(env);
    }
    const tex = this.q.pbr ? this.envRT!.texture : null;
    for (const sc of [this.scene, this.vmScene]) {
      sc.environment = tex;
      sc.environmentIntensity = 0.85;
    }
  }

  /** Materials or models changed: rebuild Spartans, the viewmodel and power-ups (they come back next frame). */
  private rebuildModels() {
    for (const sv of this.spartans.values()) this.dropSpartan(sv);
    this.spartans.clear();
    for (const v of this.orbs.values()) {
      this.scene.remove(v.group);
      disposeTree(v.group);
    }
    this.orbs.clear();
    this.vmWeapon = '';
    this.applyEnv();
  }

  private dropSpartan(sv: SpartanView) {
    this.scene.remove(sv.parts.root);
    disposeTree(sv.parts.root);
    for (const sp of [sv.tag, sv.bubble]) {
      if (!sp) continue;
      this.scene.remove(sp);
      disposeTree(sp);
    }
    sv.beamSound?.stop();
  }

  /** The Options' FPS counter. */
  setFpsCounter(on: boolean) {
    if (on && !this.fpsEl) {
      this.fpsEl = document.createElement('div');
      this.fpsEl.className = 'fps';
      this.container.appendChild(this.fpsEl);
    } else if (!on && this.fpsEl) {
      this.fpsEl.remove();
      this.fpsEl = null;
    }
  }

  /** FPS counter, and a one-time hint when the game runs slowly for a while. */
  private watchFps(dt: number) {
    const a = this.fpsAvg;
    a.t += dt;
    a.n++;
    if (a.t >= 0.5) {
      if (this.fpsEl) this.fpsEl.textContent = `${Math.round(a.n / a.t)} fps`;
      a.t = 0;
      a.n = 0;
    }
    this.watchAuto(dt);
    const w = this.fpsWatch;
    if (slowHintShown || this.session.phase !== 'live' || this.time < 8) return;
    w.t += dt;
    w.n++;
    if (w.t < 5) return;
    const fps = w.n / w.t;
    w.t = 0;
    w.n = 0;
    w.slow = fps < 28 ? w.slow + 1 : 0;
    if (w.slow >= 2 && this.q.level !== 'low') {
      slowHintShown = true;
      this.hud.message('Running slow? Try Options → Graphics → Low', 6000, 'warn');
    }
  }

  /** High / Ultra picked by "Auto": average the frame rate over AUTO_CHECK s of play, and give up on it below AUTO_MIN_FPS. */
  private watchAuto(dt: number) {
    const w = this.autoWatch;
    if (w.done || !this.hooks.onTooSlow || this.session.phase !== 'live' || this.time < 4) return;
    if (this.q.level !== 'high' && this.q.level !== 'ultra') {
      w.done = true;
      return;
    }
    // a hidden tab or a paused game isn't slow
    if (dt > 0.25 || this.hooks.isMenuOpen()) return;
    w.t += dt;
    w.n++;
    if (w.t < AUTO_CHECK) return;
    w.done = true;
    if (w.n / w.t < AUTO_MIN_FPS) {
      this.hooks.onTooSlow();
      this.hud.message('Graphics lowered to Medium to keep it smooth (Options → Graphics to change)', 6000, 'warn');
    }
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

  /** Spring Jump height as drawn: mine on the host's clock, everyone else delayed like the rest of their state. */
  private liftOf(p: ViewPlayer | null | undefined): number {
    if (!p) return 0;
    return springLift(p.springAt, p.slot === this.session.slot ? this.session.hostTick : this.session.renderTick);
  }

  /** Covered in Gerry Sauce: aiming is slow, speeding back up as it clears. */
  private aimScale(): number {
    const me = this.session.me;
    return me?.al ? sauceAimScale(me.sa, me.su, this.session.hostTick) : 1;
  }

  private canSpring(): boolean {
    const me = this.me;
    return !!this.session.me?.al && this.hasPu('spring') && !!me && !inFlight(me.springAt, this.session.hostTick);
  }

  private headPos(p: ViewPlayer, out = new THREE.Vector3()): THREE.Vector3 {
    const hb = hitboxOf(this.holeOf(p), p.exposure, this.headScaleFor(p), this.liftOf(p));
    return out.set(hb.head.x, hb.head.y, hb.head.z);
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
    return this.eyeInto(new THREE.Vector3());
  }

  private eyeInto(out: THREE.Vector3): THREE.Vector3 {
    const me = this.me;
    if (!me) return out.set(0, 5, 0);
    const e = eyePos(this.myHole(), this.session.myExposure, this.liftOf(me));
    return out.set(e.x, e.y, e.z);
  }

  private muzzleOf(slot: number): THREE.Vector3 {
    if (slot === this.session.slot) return this.fpMuzzle(this.eye(), this.input.s.yaw, this.input.s.pitch);
    const p = this.session.players[slot];
    if (p && slot === this.viewSlot()) {
      const e = eyePos(this.holeOf(p), p.exposure, this.liftOf(p));
      return this.fpMuzzle(new THREE.Vector3(e.x, e.y, e.z), p.yaw, p.pitch);
    }
    const sv = this.spartans.get(slot);
    if (sv?.weaponModel && p) {
      sv.parts.root.updateMatrixWorld(true);
      return sv.weaponModel.localToWorld((sv.weaponModel.userData.muzzle as THREE.Vector3).clone());
    }
    if (p) return this.headPos(p);
    return new THREE.Vector3();
  }

  /** Where a first-person gun's muzzle sits relative to the eye. */
  private fpMuzzle(eye: THREE.Vector3, yaw: number, pitch: number): THREE.Vector3 {
    const d = dirFromYawPitch(yaw, pitch);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    return eye.add(new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(0.7)).addScaledVector(right, 0.22).add(new THREE.Vector3(0, -0.18, 0));
  }

  /** Zoom factor of a remote player's scope (only while they are up). */
  private zoomOf(p: ViewPlayer): number {
    return p.zoom > 0 && p.exposure >= FIRE_EXPOSURE ? WEAPONS[p.weapon].zoom[p.zoom - 1] ?? 1 : 1;
  }

  /** Whose eyes the camera looks through: me while alive, the spectated player in 1st person, else -1. */
  private viewSlot(): number {
    const s = this.session;
    if (s.me?.al) return s.slot;
    if (!this.spec.active || this.spec.view !== 'first') return -1;
    return s.players[this.spec.target]?.alive ? this.spec.target : -1;
  }

  /** Spectator state (tests / HUD). */
  specState() {
    return { active: this.spec.active, target: this.spec.target, view: this.spec.view, dist: this.input.spec.dist };
  }

  private posOf(slot: number): THREE.Vector3 | null {
    const p = this.session.players[slot];
    if (!p) return null;
    const h = this.holeOf(p);
    return new THREE.Vector3(h.x, h.rim + 0.6 + this.liftOf(p), h.z);
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

  /**
   * The enemy nearest the crosshair that's in sight (aim assist, red reticle). Asked several times a frame, so the
   * expensive part — line of sight through the terrain — is settled once a frame, nearest candidate first; the offset
   * is always measured from the current aim.
   */
  private assistInfo(): AssistInfo | null {
    const me = this.me;
    if (!me) return null;
    const eye = this.eyeInto(this.assistEye);
    const t = this.assistTarget;
    if (t.frame !== this.frames) {
      t.frame = this.frames;
      t.slot = -1;
      const cands: { d: number; slot: number; x: number; y: number; z: number }[] = [];
      for (const p of this.session.players) {
        if (!p || p.slot === me.slot || !p.alive || p.exposure < 0.2 || p.flags & F_CAMO) continue;
        const hb = hitboxOf(this.holeOf(p), p.exposure, this.headScaleFor(p), this.liftOf(p));
        const x = hb.head.x, y = (hb.head.y + hb.torsoB.y) / 2, z = hb.head.z;
        const a = yawPitchOf({ x: x - eye.x, y: y - eye.y, z: z - eye.z });
        const d = Math.hypot(angleDiff(a.yaw, this.input.s.yaw), a.pitch - this.input.s.pitch);
        if (d < 0.2) cands.push({ d, slot: p.slot, x, y, z });
      }
      cands.sort((a, b) => a.d - b.d);
      for (const c of cands) {
        if (!this.arena.lineClear(eye, c, 0.5)) continue;
        Object.assign(t, { slot: c.slot, x: c.x, y: c.y, z: c.z });
        break;
      }
    }
    if (t.slot < 0) return null;
    const dist = Math.hypot(t.x - eye.x, t.y - eye.y, t.z - eye.z);
    const a = yawPitchOf({ x: t.x - eye.x, y: t.y - eye.y, z: t.z - eye.z });
    return { dYaw: angleDiff(a.yaw, this.input.s.yaw), dPitch: a.pitch - this.input.s.pitch, radius: Math.max(0.006, 0.45 / dist) };
  }
  private assistTarget = { frame: -1, slot: -1, x: 0, y: 0, z: 0 };
  private assistEye = new THREE.Vector3();

  // -------------------------------------------------------------------------------------------
  // frame
  // -------------------------------------------------------------------------------------------

  private frame(now: number) {
    const rawDt = (now - this.last) / 1000;
    const dt = Math.min(0.1, rawDt);
    this.last = now;
    this.time += dt;
    this.frames++;
    const s = this.session;
    // input (while dead, Jump asks for a respawn instead of standing)
    this.input.mode = !s.me?.al && s.phase !== 'ended' && s.state === 'match' ? 'spectate' : 'play';
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
    const si = s.input;
    si.yaw = inp.yaw;
    si.pitch = inp.pitch;
    si.stand = inp.stand;
    si.trigger = inp.trigger;
    si.presses = inp.presses;
    si.reloads = inp.reloads;
    si.respawns = inp.respawns;
    si.springs = inp.springs;
    si.zoom = inp.zoom;
    if (this.pred.pending || inp.respawns !== this.lastRespawns || inp.springs !== this.lastSprings) {
      this.lastRespawns = inp.respawns;
      this.lastSprings = inp.springs;
      s.flushInput();
    }
    s.update(now);
    // events
    const events = s.drainEvents();
    if (events.length) this.handleEvents(events);
    this.localWeapon(now, dt);
    // the detailed models just arrived: swap them in
    if (GLB.version !== this.glbSeen) {
      this.glbSeen = GLB.version;
      if (this.detailed) this.rebuildModels();
    }
    this.updateSpartans(dt);
    this.updateOrbs(dt);
    this.updateProjectiles(dt);
    this.updateStrikes();
    this.updateSprings();
    this.updateSauces(dt);
    this.updateCamera(dt);
    this.updateViewmodel(dt);
    this.updateHud();
    this.fxAdd.update(dt);
    this.fxNorm.update(dt);
    this.fxSauce.update(dt);
    this.decals.update(dt);
    this.shockwaves.update(dt);
    this.ribbons.update(dt);
    this.lights.update(dt);
    this.grass.update(this.time);
    (this.sky.material as THREE.ShaderMaterial).uniforms.time!.value = this.time;
    if (this.q.shadows === 'dynamic') {
      this.renderer.shadowMap.needsUpdate = this.frames % 3 === 0;
      this.renderer.shadowMap.autoUpdate = false;
    }
    // audio listener follows the camera (death cam and spectating included)
    audio.setListener(this.camera.position, this.camera.getWorldDirection(tmpV2));
    // render
    this.renderer.info.reset();
    this.renderer.setClearColor(PAL.horizon);
    if (this.post) this.post.render(dt, this.vmHolder.visible);
    else {
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      if (this.vmHolder.visible) {
        this.renderer.clearDepth();
        this.renderer.render(this.vmScene, this.vmCamera);
      }
    }
    if (this.dynRes?.frame(rawDt)) this.onResize();
    this.watchFps(dt);
    setStyle(this.clickToPlay, 'display', this.input.device === 'kbm' && !this.input.locked && !this.hooks.isMenuOpen() && !this.input.suspended && s.state === 'match' ? '' : 'none');
    if (this.perfEl && this.frames % 15 === 0) {
      const info = this.renderer.info.render;
      this.perfEl.textContent = `${(1 / Math.max(1e-3, dt)).toFixed(0)}fps ${info.calls}dc ${(info.triangles / 1000).toFixed(0)}k tri x${(this.dynRes?.scale ?? 1).toFixed(2)} ${s.interpDelay.toFixed(1)}t ${s.stalledFrames}st`;
    }
  }

  /** The preset's dynamic-resolution floor is a pixel ratio: never render coarser than that. */
  private makeDynRes() {
    const range = this.q.dynamicRes;
    if (!range) {
      this.dynRes = null;
      return;
    }
    const eff = Math.min(window.devicePixelRatio || 1, this.q.dprCap) * this.q.renderScale;
    this.dynRes = new DynRes(Math.min(1, range[0] / eff));
  }

  renderInfo() {
    const i = this.renderer.info.render;
    return { calls: i.calls, triangles: i.triangles, dynScale: this.dynRes?.scale ?? 1, post: !!this.post, pbr: this.q.pbr, shadows: this.renderer.shadowMap.enabled, level: this.q.level, particles: this.q.particles, dpr: this.renderer.getPixelRatio(), models: this.detailed && this.glbSeen > 0 ? 'detailed' : 'simple' };
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
      if (!this.chargeSound) this.chargeSound = audio.play('charge', { gain: 0.6, bus: 'guns', keep: true });
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
    if (w.projectile?.loftDeg) this.vmThrow = 0;
    this.muzzleFlash(this.muzzleOf(s.slot), dir, w.id, true);
    this.playFireSound(s.slot, w.id, null);
    this.pitreLocalCue({ speaker: s.slot, line: 'brap', delayMs: 0, priority: 1 }, w.id);
    if (w.fireKind === 'hitscan') {
      // homing rounds bend the shot on the host: its own tracer is drawn instead (see 'fire')
      if (this.hasPu('homing')) return;
      // cosmetic trace: terrain + interpolated players
      let end = Math.min(w.range, this.arena.raycast(eye, d, w.range));
      for (const p of s.players) {
        if (!p || p.slot === s.slot || !p.alive) continue;
        const h = rayHitbox(eye, d, hitboxOf(this.holeOf(p), p.exposure, this.headScaleFor(p), this.liftOf(p)));
        if (h && h.t < end) end = h.t;
      }
      const endP = eye.clone().addScaledVector(dir, end);
      this.tracer(this.muzzleOf(s.slot), endP, w.id);
      if (end < w.range) this.impact(endP, w.id);
    } else if (w.projectile && !hostDrawn(w.projectile)) {
      // (homing needles pick their target on the host, and grenades bounce off or stick to players there: those are
      // drawn from the host's copy)
      const def = w.projectile;
      const id = `L${++this.pred.localId}`;
      const start = eye.clone().addScaledVector(dir, 0.6);
      const born = Math.floor(s.hostTick);
      const pr: Projectile = { id: -1, owner: s.slot, weapon: w.id, x: start.x, y: start.y - 0.1, z: start.z, vx: dir.x * def.speed, vy: dir.y * def.speed, vz: dir.z * def.speed, born, bounces: 0, target: -1, fuseAt: def.fuse ? born + Math.round(def.fuse * TICK_RATE) : 0, y0: start.y };
      this.addProjectile(id, pr, true);
    }
  }

  // -------------------------------------------------------------------------------------------
  // events
  // -------------------------------------------------------------------------------------------

  private handleEvents(all: SimEvent[]) {
    const s = this.session;
    const mySlot = s.slot;
    const settings = s.start?.settings;
    // after a stalled connection catches up, old gunfire, hits and blasts aren't replayed all at once
    const events: SimEvent[] = [];
    for (const e of all) {
      if (!s.isLocal && COSMETIC_EVENTS.has(e.k) && s.hostTick - e.t > STALE_FX_TICKS) {
        if (e.k === 'pend') this.removeProjectile(String(e.id));
        continue;
      }
      events.push(e);
    }
    for (const e of events) {
      this.eventCounts[e.k] = (this.eventCounts[e.k] ?? 0) + 1;
      switch (e.k) {
        case 'fire': {
          const w = WEAPONS[e.w];
          if (e.p === mySlot && this.ownShotPredicted(e.w)) {
            // already flashed, kicked and sounded here; with homing rounds only the host knows where it went
            if (w.fireKind === 'hitscan' && this.hasPu('homing')) {
              const to = new THREE.Vector3(...e.e);
              this.tracer(this.muzzleOf(e.p), to, e.w, e.v);
              if (e.hit === 'world') this.impact(to, e.w);
            }
            break;
          }
          const from = this.muzzleOf(e.p);
          const to = new THREE.Vector3(...e.e);
          const fp = e.p === this.viewSlot();
          if (w.trigger !== 'beam') {
            this.muzzleFlash(from, to.clone().sub(from).normalize(), e.w, fp);
            if (w.fireKind === 'hitscan') {
              this.tracer(from, to, e.w, e.v);
              if (e.hit === 'world') this.impact(to, e.w);
            }
          }
          if (fp) {
            if (w.projectile?.loftDeg) this.vmThrow = 0;
            this.vmKick = Math.min(1, this.vmKick + w.fx.recoil * 0.6);
            this.camKick += w.fx.recoil * 0.004;
          }
          this.playFireSound(e.p, e.w, e.p === mySlot ? null : this.posOf(e.p));
          break;
        }
        case 'proj': {
          if (e.p === mySlot && this.ownShotPredicted(e.w) && !hostDrawn(WEAPONS[e.w].projectile!)) break;
          const pr: Projectile = { id: e.id, owner: e.p, weapon: e.w, x: e.pos[0], y: e.pos[1], z: e.pos[2], vx: e.vel[0], vy: e.vel[1], vz: e.vel[2], born: e.t, bounces: 0, target: e.tgt, fuseAt: 0, y0: e.pos[1] };
          this.addProjectile(String(e.id), pr, false);
          break;
        }
        case 'pmove': {
          // a grenade glanced off someone, or stuck: pick its flight up from the host's copy
          const pv = this.projs.get(String(e.id));
          if (!pv) break;
          const tr = pv.track;
          Object.assign(tr.pr, { x: e.pos[0], y: e.pos[1], z: e.pos[2], vx: e.vel[0], vy: e.vel[1], vz: e.vel[2] });
          tr.tick = e.t;
          tr.px = e.pos[0];
          tr.py = e.pos[1];
          tr.pz = e.pos[2];
          tr.stopped = e.on !== undefined;
          pv.attach = e.on !== undefined && e.on >= 0 && e.off ? { slot: e.on, off: { x: e.off[0], y: e.off[1], z: e.off[2] } } : null;
          const pos = { x: e.pos[0], y: e.pos[1], z: e.pos[2] };
          if (pv.weapon === 'plasma' && e.on !== undefined) audio.play('plasmaStick', { pos, gain: 0.8, bus: 'guns' });
          else if (e.on === undefined) audio.play('clink', { pos, gain: 0.7, bus: 'guns' });
          break;
        }
        case 'pend': {
          const pv = this.projs.get(String(e.id));
          if (pv) {
            if (!WEAPONS[pv.weapon].splash && !e.gone) this.impact(new THREE.Vector3(...e.pos), pv.weapon);
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
            if (e.p >= 0 && this.cans()) {
              // Pitre: the can bursts open — black and silver shards, a fizzing fountain of energy drink
              this.fxAdd.emit({ pos: p, count: 18, speed: [1, 4], life: [0.3, 0.6], size: [0.45, 0.08], color: 0xffffff, color1: ov.color });
              this.fxNorm.emit({ pos: p, count: 14, speed: [2, 7], life: [0.8, 1.4], size: [0.2, 0.12], color: 0x15161a, color1: 0x2a2c31, gravity: 9.8, alpha: [1, 0.7] });
              this.fxNorm.emit({ pos: p, count: 8, speed: [2, 6], life: [0.8, 1.4], size: [0.16, 0.1], color: 0xd9dde2, gravity: 9.8, alpha: [1, 0.7] });
              this.fxNorm.emit({ pos: p, count: 36, speed: [3, 9], dir: new THREE.Vector3(0, 1, 0), spread: 0.55, life: [0.6, 1.2], size: [0.17, 0.06], color: ov.color, color1: 0xffffff, gravity: 9.8, alpha: [0.95, 0.2] });
              audio.play('canOpen', { pos: p, reverb: 0.2 });
              audio.play('fizz', { pos: p, gain: 0.8, delay: 0.06 });
            } else if (e.p >= 0) {
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
              const key = this.input.device === 'pad' ? 'Ⓐ' : this.input.device === 'touch' ? 'STAND' : 'SPACE';
              this.hud.message(def.id === 'spring' ? `${def.name} — double-tap ${key} to launch` : def.name, def.id === 'spring' ? 3500 : 2000);
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
        case 'callout':
          this.playCallout(e.p, e.key);
          break;
        case 'spring':
          this.springViews.set(e.p, { at: e.t, launched: false, mesh: null });
          break;
        case 'sauce': {
          // a Super Soaker squirt: the whole field gets drenched in a second
          this.sauceViews.set(e.id, { owner: e.p, at: e.at, fired: e.t, jets: null });
          const pos = e.p === mySlot ? null : this.posOf(e.p);
          audio.play('pump', { pos, gain: 0.9 });
          audio.play('squirt', { pos, gain: 1.1, delay: 0.2 });
          audio.announce(POWERUPS.sauce.announce);
          if (e.p === mySlot) this.hud.message('Everyone gets sauced!', 2200);
          else this.hud.message('Gerry Sauce incoming!', 1600, 'warn');
          break;
        }
        case 'near':
          // a shot whizzed past someone: only a Pitre voice line (below)
          break;
        case 'sauced':
          this.onSauced(e.v);
          break;
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
      for (const cue of pitreCues(events, settings, this.pitreHits)) {
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
    const speaker = this.session.players[cue.speaker]?.name; // friends' own recordings, if any
    const h = audio.playVoice(slot, { pos, delay: cue.delayMs / 1000, gain: mine ? 0.8 : 1.3, speaker });
    if (!h) return;
    prevVoice?.stop(0.03);
    if (mine) this.myVoice = h;
    else if (sv) sv.voice = h;
  }
  /** A player yells a line (not Pitre-gated): positional voice + a speech bubble over their head. */
  private playCallout(slot: number, key: string) {
    const now = performance.now();
    if (now - (this.calloutAt.get(slot) ?? -1e9) < 3000) return;
    this.calloutAt.set(slot, now);
    const mine = slot === this.session.slot;
    const sv = this.spartans.get(slot);
    const h = audio.playVoice(key, { pos: mine ? null : this.posOf(slot), gain: mine ? 0.9 : 1.3, speaker: this.session.players[slot]?.name });
    if (h) {
      (mine ? this.myVoice : sv?.voice)?.stop(0.03);
      if (mine) this.myVoice = h;
      else if (sv) sv.voice = h;
    }
    const text = CALLOUT_TEXT[key];
    if (sv && text && !mine) {
      if (sv.bubble) {
        this.scene.remove(sv.bubble);
        disposeTree(sv.bubble);
      }
      sv.bubble = textSprite(text, '#ffe36a', 44);
      sv.bubbleUntil = this.time + 1.8;
      this.scene.add(sv.bubble);
    }
  }
  private calloutAt = new Map<number, number>();
  private myVoice: SoundHandle | null = null;
  private lastStand = false;
  private lastRespawns = 0;
  private lastSprings = 0;
  /** Spring Jumps in progress (pop-out spring, sounds, landing) */
  private springViews = new Map<number, { at: number; launched: boolean; mesh: THREE.Group | null }>();

  /** Pitre Mode: power-ups come in energy drink cans instead of Poké Balls. */
  private cans(): boolean {
    const st = this.session.start?.settings;
    return !!st?.pitre && st.pitreCans;
  }

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
      this.diedAtMs = performance.now();
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
    if (w === 'flamethrower' || WEAPONS[w].projectile?.loftDeg) return; // (nothing flashes when a grenade is thrown)
    this.fxAdd.emit({ pos, count: mine ? 5 : 7, speed: [0.5, 3], dir, spread: 0.5, life: [0.04, 0.09], size: [mine ? 0.25 : 0.45, 0.05], color: 0xffffff, color1: c });
    if (!mine && this.q.flashLights > 1) this.lights.flash(pos, c, 3, 6, 0.08);
  }

  /** `via`: homing rounds that curved down into a hole bend over this point. */
  private tracer(from: THREE.Vector3, to: THREE.Vector3, w: WeaponId, via?: Vec3T) {
    if (via) {
      const v = new THREE.Vector3(...via);
      this.tracer(from, v, w);
      this.tracer(v, to, w);
      return;
    }
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
    const k = this.q.fxScale;
    const needle = w === 'needler';
    const col0 = needle ? 0xffd0ff : 0xfff0b0;
    const col1 = needle ? 0xff40c0 : 0xff5a10;
    this.fxAdd.emit({ pos: p, count: Math.round((big ? 45 : 28) * k), speed: [2, r * 2.2], life: [0.25, 0.6], size: [r * 0.55, r * 0.15], color: col0, color1: col1, drag: 3, jitter: 0.4 });
    this.fxAdd.emit({ pos: p, count: Math.round(18 * k), speed: [6, 16], life: [0.3, 0.8], size: [0.12, 0.03], color: 0xffe080, gravity: 12, drag: 0.5 });
    this.fxNorm.emit({ pos: p, count: Math.round((big ? 22 : 14) * k), speed: [0.8, 3], life: [1.2, 2.6], size: [r * 0.4, r * 0.9], color: 0x5a5550, color1: 0x9a9a9a, alpha: [0.75, 0], gravity: -1.2, drag: 1.2, jitter: r * 0.3 });
    this.fxNorm.emit({ pos: p, count: Math.round(12 * k), speed: [3, 8], dir: new THREE.Vector3(0, 1, 0), spread: 0.9, life: [0.8, 1.4], size: [0.1, 0.08], color: 0x5a4a30, gravity: 14, alpha: [1, 1] });
    if (k >= 1.3 && !needle) {
      // High / Ultra: a shockwave ring, white-hot sparks, clods of earth and a scorch mark
      this.shockwaves.add(p, r * 1.7, 0xffc078, big ? 0.5 : 0.4);
      this.fxAdd.emit({ pos: p, count: Math.round(22 * k), speed: [8, 24], life: [0.2, 0.45], size: [0.09, 0.02], color: 0xffffff, color1: 0xffa040, gravity: 6, drag: 0.8 });
      this.fxNorm.emit({ pos: p, count: Math.round(9 * k), speed: [4, 11], dir: new THREE.Vector3(0, 1, 0), spread: 0.75, life: [1, 1.7], size: [0.24, 0.16], color: 0x3a2e20, color1: 0x2a2218, gravity: 17, alpha: [1, 1] });
      const g = this.arena.groundAt(p.x, p.z);
      const hole = this.arena.nearestHole(p.x, p.z);
      const inMouth = hole && Math.hypot(hole.x - p.x, hole.z - p.z) < MOUTH_R + 0.4;
      if (p.y - g < 1.6 && !inMouth) this.decals.add(p.x, p.z, r * 0.5, 0x1d1915, 14, 0.85);
    }
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
      const parts = buildSpartan(p.color, this.q.pbr, this.detailed);
      this.scene.add(parts.root);
      sv = { slot: p.slot, parts, color: p.color, weapon: '', weaponModel: null, alive: p.alive, deathT: 0, deathDir: 1, flare: 0, flareColor: 0x6ad8ff, estShield: SHIELD_MAX, lastHitAt: -99, name: '', tag: null, tagFor: '', beamSound: null, voice: null, headScale: 1, bubble: null, bubbleUntil: 0, sauce: [] };
      this.spartans.set(p.slot, sv);
    }
    return sv;
  }

  private updateSpartans(dt: number) {
    const s = this.session;
    const settings = s.start?.settings;
    // name tags are aimed with the camera (last frame's is fine)
    const eye = this.camPos.copy(this.camera.position);
    const look = yawPitchOf(this.camera.getWorldDirection(tmpV));
    const hidden = this.viewSlot();
    const xray = this.hasPu('xray');
    const seen = this.seenSlots;
    seen.clear();
    for (const p of s.players) {
      if (!p) continue;
      seen.add(p.slot);
      const sv = this.ensureSpartan(p);
      const root = sv.parts.root;
      if (p.slot === s.slot || p.slot === hidden) {
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
        // shot down mid Spring Jump: the body keeps falling back into the hole
        root.position.set(hole.x, hole.rim + drop(0.6) - t * t * 1.4 + this.liftOf(p), hole.z);
        continue;
      }
      root.visible = true;
      root.rotation.set(0, 0, 0);
      root.position.set(hole.x, hole.rim + drop(p.exposure) + this.liftOf(p), hole.z);
      sv.parts.body.rotation.y = p.yaw;
      sv.parts.aim.rotation.x = p.pitch * 0.85;
      const hs = this.headScaleFor(p);
      if (hs !== sv.headScale) {
        sv.headScale = hs;
        sv.parts.head.scale.setScalar(hs);
      }
      // a big head sinks back under the rim when its owner ducks (same as the hitbox)
      sv.parts.head.position.y = 0.37 + bigHeadShift((hs - 1) * HEAD_R, p.exposure);
      // weapon
      if (sv.weapon !== p.weapon) {
        if (sv.weaponModel) {
          sv.parts.weaponHolder.remove(sv.weaponModel);
          disposeTree(sv.weaponModel);
        }
        sv.weaponModel = buildWeaponModel(p.weapon, this.q.pbr, this.detailed);
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
      // Gerry Sauce dollops on sauced players
      const sauced = (p.flags & F_SAUCED) !== 0;
      if (sauced && !sv.sauce.length) {
        const head = buildSauceBlob();
        head.scale.set(0.3, 0.26, 0.3);
        head.position.set(0.03, 0.12, -0.02);
        const chest = buildSauceBlob();
        chest.scale.set(0.24, 0.2, 0.18);
        chest.position.set(-0.08, 0.42, -0.2);
        sv.parts.head.add(head);
        sv.parts.body.add(chest);
        sv.sauce = [head, chest];
      }
      for (const b of sv.sauce) b.visible = sauced;
      if (sauced && Math.random() < dt * 6) this.fxSauce.emit({ pos: this.headPos(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, -0.2, (Math.random() - 0.5) * 0.4)), count: 1, speed: [0, 0.3], gravity: 6, life: [0.5, 0.9], size: [0.12, 0.08], color: SAUCE.base, color1: SAUCE.shade, alpha: [1, 0.8] });
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
      const head = this.headPos(p, this.tagHead);
      const a = yawPitchOf({ x: head.x - eye.x, y: head.y - eye.y, z: head.z - eye.z });
      const off = Math.hypot(angleDiff(a.yaw, look.yaw), a.pitch - look.pitch);
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
      if (sv.bubble) {
        if (this.time > sv.bubbleUntil) {
          this.scene.remove(sv.bubble);
          disposeTree(sv.bubble);
          sv.bubble = null;
        } else {
          const dist = head.distanceTo(eye);
          const k = (0.9 + dist * 0.05) * (this.camera.fov / this.input.opts.fov);
          const aspect = sv.bubble.userData.aspect ?? (sv.bubble.userData.aspect = sv.bubble.scale.x / sv.bubble.scale.y);
          sv.bubble.position.copy(head);
          sv.bubble.position.y += 0.75 + dist * 0.02;
          sv.bubble.scale.set(k * aspect * 0.5, k * 0.5, 1);
        }
      }
      if (sv.tag) {
        sv.tag.visible = showTag;
        if (showTag) {
          const dist = head.distanceTo(eye);
          sv.tag.position.copy(head);
          sv.tag.position.y += 0.45 + dist * 0.012;
          const k = (0.6 + dist * 0.035) * (this.camera.fov / this.input.opts.fov);
          const aspect = sv.tag.scale.x / sv.tag.scale.y;
          sv.tag.scale.set(k * aspect * 0.5, k * 0.5, 1);
        }
      }
    }
    for (const [slot, sv] of this.spartans) {
      if (!seen.has(slot)) {
        this.dropSpartan(sv);
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
        const group = this.cans() ? buildCan(color, this.q.pbr, this.detailed) : buildOrb(color, this.q.pbr);
        const label = textSprite(`${def?.icon ?? '?'} ${def?.name ?? ''}`, '#ffffff', 36);
        group.add(label);
        label.position.y = this.cans() ? (CAN_H / 2) * CAN_SCALE + 0.55 : 1.25;
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
    if (obj) {
      obj.visible = false; // placed on its first update
      this.scene.add(obj);
    }
    this.projs.set(id, { track: newTrack(pr, pr.born), obj, weapon: w, local, trailAcc: 0 });
    if (w === 'rpg') audio.play('rocket', { pos: local ? null : { x: pr.x, y: pr.y, z: pr.z }, gain: 0.5, rate: 1.3, bus: 'guns' });
  }

  private removeProjectile(id: string) {
    const pv = this.projs.get(id);
    if (!pv) return;
    if (pv.obj) this.scene.remove(pv.obj); // geometry/materials are shared (projMesh)
    this.projs.delete(id);
  }

  /**
   * Projectiles fly one host tick at a time on the host's clock with the host's physics (projtrack.ts), so they move
   * at the same speed on a 30, 60 or 144 Hz screen and bounce where the host's do. Other players' shots end when the
   * host says so ('pend'); my own predicted ones end as soon as they hit something.
   */
  private updateProjectiles(dt: number) {
    const s = this.session;
    const now = s.hostTick;
    for (const [id, pv] of this.projs) {
      const def = WEAPONS[pv.weapon].projectile!;
      const tr = pv.track;
      const hom = pv.local ? null : (s.homing.get(tr.pr.id) ?? null);
      let ended: 'hit' | 'end' | 'expire' | null = null;
      for (let n = 0; tr.tick + 1 <= now && n < MAX_CATCHUP; n++) {
        const r = stepTrack(tr, def, this.arena, hom, pv.local ? this.ownShotTargets : null);
        if (r !== 'fly' && pv.local) {
          ended = r;
          break;
        }
      }
      const ageTicks = tr.tick - tr.pr.born;
      if (ended) {
        // the host's end-of-flight event names its own copy of this shot, so the impact is drawn here (not for one
        // that just ran out in the air)
        if (ended !== 'expire' && !WEAPONS[pv.weapon].splash) this.impact(tmpV.set(tr.pr.x, tr.pr.y, tr.pr.z), pv.weapon);
        this.removeProjectile(id);
        continue;
      }
      // a safety net: the host's 'pend' normally ends other players' shots long before this
      if (!pv.local && ageTicks > (def.life + 1.5) * TICK_RATE) {
        this.removeProjectile(id);
        continue;
      }
      const pos = trackPos(tr, now, tmpP);
      const stuckTo = pv.attach ? s.players[pv.attach.slot] : null;
      if (stuckTo?.alive) {
        const a = hitboxOf(this.holeOf(stuckTo), stuckTo.exposure, this.headScaleFor(stuckTo), this.liftOf(stuckTo)).torsoB;
        pos.x = a.x + pv.attach!.off.x;
        pos.y = a.y + pv.attach!.off.y;
        pos.z = a.z + pv.attach!.off.z;
      }
      if (pv.obj) {
        pv.obj.visible = ageTicks >= 0;
        pv.obj.position.set(pos.x, pos.y, pos.z);
        const pr = tr.pr;
        tmpV.set(pr.vx, pr.vy, pr.vz);
        if (tmpV.lengthSq() > 0.01) pv.obj.lookAt(tmpV2.set(pos.x, pos.y, pos.z).sub(tmpV));
      }
      if (tr.stopped || ageTicks < 0) continue;
      // trails
      const age = ageTicks / TICK_RATE;
      pv.trailAcc += dt;
      const w = pv.weapon;
      if (w === 'flamethrower') {
        this.fxAdd.emit({ pos, count: 1, speed: [0, 0.6], life: [0.12, 0.25], size: [0.35 + age * 1.6, 0.9 + age * 2], color: 0xffe080, color1: 0xff3000, alpha: [0.9, 0] });
        if (Math.random() < 0.3) this.fxNorm.emit({ pos, count: 1, speed: [0.3, 1], life: [0.5, 0.9], size: [0.4, 1.2], color: 0x3a3030, alpha: [0.35, 0], gravity: -2 });
      } else if (pv.trailAcc > 0.02) {
        pv.trailAcc = 0;
        if (w === 'rpg') {
          this.fxAdd.emit({ pos, count: 1, speed: [0, 0.3], life: [0.1, 0.2], size: [0.4, 0.1], color: 0xffd080, color1: 0xff5000 });
          this.fxNorm.emit({ pos, count: 1, speed: [0.1, 0.4], life: [0.8, 1.4], size: [0.3, 1.1], color: 0xb0b0b0, alpha: [0.55, 0], gravity: -0.4 });
        } else if (w === 'crossbow') this.fxAdd.emit({ pos, count: 1, speed: [0, 0.1], life: [0.15, 0.25], size: [0.12, 0.02], color: 0x9fe8ff });
        else if (w === 'needler') this.fxAdd.emit({ pos, count: 1, speed: [0, 0.1], life: [0.1, 0.2], size: [0.14, 0.02], color: 0xff5fd2 });
        else if (w === 'grenade') this.fxAdd.emit({ pos, count: 1, speed: [0, 0.1], life: [0.15, 0.3], size: [0.18, 0.02], color: 0x7cff6b });
        else if (w === 'plasma') this.fxAdd.emit({ pos, count: 1, speed: [0, 0.2], life: [0.15, 0.3], size: [0.25, 0.03], color: 0x9fd4ff, color1: 0x2a7cff });
      }
    }
  }

  /** What my own predicted shots stop on: the other players as I see them, and power-up orbs. */
  private ownShotTargets: TargetTest = (o, d, L, tick, r, from) => {
    const s = this.session;
    const orbR = s.start ? orbRadius(s.start.settings) : 0.8;
    let best = Infinity;
    for (const p of s.players) {
      if (!p || p.slot === s.slot || !p.alive) continue;
      const h = rayHitbox(o, d, hitboxOf(this.holeOf(p), p.exposure, this.headScaleFor(p), this.liftOf(p)), r, from);
      if (h && h.t < L && h.t < best) best = h.t;
    }
    for (const orb of s.orbs.values()) {
      const to = raySphere(o, d, orbPos(orb, tick, this.arena), orbR + r);
      if (to >= 0 && to < L && to < best) best = to;
    }
    return best;
  };

  /** The sauce lands on someone: splat on them, splats around their hole; my own screen gets covered (HUD). */
  private onSauced(slot: number) {
    const s = this.session;
    const p = s.players[slot];
    if (!p) return;
    if (slot === s.slot) {
      audio.play('splat', { gain: 1.2 });
      audio.play('splat', { gain: 0.8, rate: 0.8, delay: 0.12 });
      this.hud.message('Sauced!', 1500, 'warn');
      this.shake = Math.min(1.2, this.shake + 0.6);
    } else {
      const head = this.headPos(p);
      audio.play('splat', { pos: head, gain: 1.1 });
      this.fxSauce.emit({ pos: head, count: 26, speed: [2, 7], dir: new THREE.Vector3(0, 1, 0), spread: 1, gravity: 9.8, life: [0.6, 1.2], size: [0.32, 0.14], color: SAUCE.gloss, color1: SAUCE.shade, alpha: [1, 0.9] });
    }
    const h = this.holeOf(p);
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 1.5;
      const x = h.x + Math.cos(a) * r, z = h.z + Math.sin(a) * r;
      this.decals.add(x, z, 0.6 + Math.random() * 0.8, SAUCE.base, 9);
    }
  }

  /** Super Soaker squirts in flight: a geyser at the shooter and a custard jet arcing into every other player's hole, then rain. */
  private updateSauces(dt: number) {
    const s = this.session;
    const g = 9.8;
    // the jets fly on a heavier, made-up gravity: a higher lob looks more like spraying the whole field
    const gj = 24;
    for (const [id, v] of this.sauceViews) {
      const mine = v.owner === s.slot;
      const now = mine ? s.hostTick : s.renderTick;
      const left = (v.at - now) / TICK_RATE;
      const owner = s.players[v.owner];
      if (now < v.fired) continue;
      if (!v.jets && owner) {
        // aim every jet once: it leaves the soaker now and lands on its target exactly when the sauce does
        const from = this.muzzleOf(v.owner);
        const T = (v.at - v.fired) / TICK_RATE;
        v.jets = s.players
          .filter((p): p is ViewPlayer => !!p && p.slot !== v.owner && p.alive)
          .map((p) => {
            const to = this.headPos(p);
            return { from: from.clone(), v: new THREE.Vector3((to.x - from.x) / T, (to.y - from.y) / T + 0.5 * gj * T, (to.z - from.z) / T) };
          });
      }
      if (left > 0 && owner && v.jets) {
        // a custard geyser out of their soaker (not when we're looking down its barrel: it would fill the screen)
        if (v.owner !== this.viewSlot()) {
          const from = this.muzzleOf(v.owner);
          this.fxSauce.emit({ pos: from, count: 3, speed: [7, 12], dir: new THREE.Vector3(0, 1, 0), spread: 0.25, gravity: g, life: [0.6, 1.2], size: [0.35, 0.2], color: SAUCE.gloss, color1: SAUCE.base, alpha: [1, 0.9] });
        }
        // each jet is a slug of custard drawn as a chain of drops from its tail to its head, redrawn every frame: the
        // drops live just past this frame's particle update (however slow the frame), so each chain is seen exactly once
        const tau = (now - v.fired) / TICK_RATE;
        const once = dt * 1.2 + 0.005;
        const tail = 0.22;
        // enough drops to look continuous, within a per-frame budget shared by all the jets
        const cap = Math.max(6, Math.floor((this.q.fxScale < 1 ? 120 : 320) / Math.max(1, v.jets.length)));
        for (const j of v.jets) {
          const s0 = Math.max(0, tau - tail);
          const n = Math.min(cap, Math.max(6, Math.ceil((j.v.length() * (tau - s0)) / 0.22)));
          for (let i = 0; i <= n; i++) {
            const t = s0 + ((tau - s0) * i) / n;
            const pos = { x: j.from.x + j.v.x * t, y: j.from.y + j.v.y * t - 0.5 * gj * t * t, z: j.from.z + j.v.z * t };
            const head = i / n;
            const size = 0.32 + head * 0.3;
            this.fxSauce.emit({ pos, count: 1, speed: [0, 0], life: [once, once], size: [size, size], color: head > 0.9 ? SAUCE.gloss : SAUCE.base, alpha: [1, 1] });
          }
          // droplets shed from the head of the jet
          if (Math.random() < 0.5) {
            const pos = { x: j.from.x + j.v.x * tau, y: j.from.y + j.v.y * tau - 0.5 * gj * tau * tau, z: j.from.z + j.v.z * tau };
            this.fxSauce.emit({ pos, count: 1, speed: [0.5, 2], gravity: g, life: [0.4, 0.8], size: [0.18, 0.1], color: SAUCE.base, color1: SAUCE.shade, alpha: [1, 0.8] });
          }
        }
      } else if (left > -1.5) {
        // after it lands: a short custard rain over the field
        const R = this.arena.fenceRadius;
        for (let i = 0; i < (this.q.fxScale < 1 ? 2 : 6); i++) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
          this.fxSauce.emit({ pos: { x: Math.cos(a) * r, y: 14 + Math.random() * 8, z: Math.sin(a) * r }, count: 1, speed: [0, 1], gravity: 12, life: [1.4, 1.9], size: [0.3, 0.22], color: SAUCE.base, color1: SAUCE.shade, alpha: [0.95, 0.9] });
        }
      } else this.sauceViews.delete(id);
    }
  }

  /** Spring Jumps: a spring pops out of the hole, boing + whoosh, then a thud on landing. Remote ones play on their delayed clock. */
  private updateSprings() {
    const s = this.session;
    for (const [slot, v] of this.springViews) {
      const p = s.players[slot];
      if (!p) {
        if (v.mesh) this.scene.remove(v.mesh);
        this.springViews.delete(slot);
        continue;
      }
      const mine = slot === s.slot;
      const now = mine ? s.hostTick : s.renderTick;
      const hole = this.holeOf(p);
      const at = new THREE.Vector3(hole.x, hole.rim, hole.z);
      const age = (now - v.at) / TICK_RATE;
      if (!v.launched && age >= 0) {
        v.launched = true;
        audio.play('boing', { pos: mine ? null : at, gain: 0.9, reverb: 0.2 });
        audio.play('whoosh', { pos: mine ? null : at, gain: mine ? 0.45 : 0.6 });
        this.fxNorm.emit({ pos: at, count: 18, speed: [1, 4], dir: new THREE.Vector3(0, 1, 0), spread: 1.2, life: [0.5, 1], size: [0.3, 0.9], color: 0x8a7a5a, alpha: [0.6, 0], gravity: 2 });
        v.mesh = buildSpring(this.detailed);
        this.scene.add(v.mesh);
      }
      if (v.mesh) {
        // pops up out of the well, then sinks back
        const k = age < 0.18 ? age / 0.18 : Math.max(0, 1 - (age - 0.18) / 0.5);
        v.mesh.position.set(hole.x, hole.ground - WELL_DEPTH + 0.1, hole.z);
        v.mesh.scale.set(1, 0.05 + k * (WELL_DEPTH + 1.6), 1);
        v.mesh.visible = k > 0.01;
        if (age > 0.8) {
          this.scene.remove(v.mesh);
          v.mesh = null;
        }
      }
      if (now >= v.at + SPRING_TICKS) {
        audio.play('thud', { pos: mine ? null : at, gain: 0.9 });
        this.fxNorm.emit({ pos: at, count: 14, speed: [1, 3], dir: new THREE.Vector3(0, 1, 0), spread: 1.4, life: [0.4, 0.9], size: [0.3, 0.8], color: 0x8a7a5a, alpha: [0.6, 0], gravity: 3 });
        if (mine) this.shake = Math.min(1, this.shake + 0.35);
        if (v.mesh) this.scene.remove(v.mesh);
        this.springViews.delete(slot);
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
        audio.play('whistle', { pos: st.pos, gain: 1, keep: true });
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
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.camKick = Math.max(0, this.camKick - dt * 0.12);
    const sx = (Math.random() - 0.5) * this.shake * 0.02;
    const sy = (Math.random() - 0.5) * this.shake * 0.02;
    let fov = settings.fov;
    if (alive) {
      this.spec.active = false;
      this.eyeInto(this.camera.position);
      this.camera.rotation.set(0, 0, 0, 'YXZ');
      this.camera.rotation.y = inp.yaw + sx;
      this.camera.rotation.x = inp.pitch + sy + this.camKick;
      this.wasAlive = true;
      const w = this.myWeaponDef();
      fov /= inp.zoom > 0 ? w.zoom[inp.zoom - 1] ?? 1 : 1;
    } else if (me && s.me && !this.spec.active && performance.now() - this.diedAtMs < 1200 && !this.input.specPending()) {
      // death cam: rise above the hole and look at the killer
      const h = this.myHole();
      const t = Math.min(1, (this.time - this.diedAt) / 1.2);
      const target = this.killer >= 0 && this.killer !== s.slot ? this.posOf(this.killer) : new THREE.Vector3(0, 2, 0);
      const base = new THREE.Vector3(h.x, h.rim + 0.9 + this.liftOf(me), h.z);
      const away = base.clone().sub(target ?? new THREE.Vector3()).setY(0).normalize();
      const camPos = base.clone().add(new THREE.Vector3(0, 1 + t * 3.5, 0)).addScaledVector(away, t * 4);
      this.camera.position.lerp(camPos, this.wasAlive ? 1 : 1 - Math.exp(-dt * 6));
      this.wasAlive = false;
      if (target) this.camera.lookAt(target);
    } else {
      fov = this.spectateCamera(dt);
      this.wasAlive = false;
    }
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 18);
      this.camera.updateProjectionMatrix();
    }
    // grass density follows the camera
    const cp = this.camera.position;
    if (!(Math.hypot(cp.x - this.grassAt.x, cp.z - this.grassAt.y) < 10)) {
      this.grassAt.set(cp.x, cp.z);
      this.grass.layout(cp.x, cp.z);
    }
  }

  /** Dead (or waiting for a hole): watch the other players. Returns the field of view to use. */
  private spectateCamera(dt: number): number {
    const s = this.session;
    const sp = this.spec;
    const fov = this.input.opts.fov;
    const others = s.players.filter((p): p is ViewPlayer => !!p && p.slot !== s.slot);
    const act = this.input.takeSpec();
    if (!sp.active) {
      // start on whoever killed me, else the leader, else anyone alive
      sp.active = true;
      const first = [this.killer, s.leader].find((x) => x >= 0 && x !== s.slot && s.players[x]?.alive);
      sp.target = first ?? others.find((p) => p.alive)?.slot ?? others[0]?.slot ?? -1;
      const t = s.players[sp.target];
      this.input.spec.yaw = t ? t.yaw : this.input.s.yaw;
      this.input.spec.pitch = -0.35;
      sp.snap = true;
    }
    if (others.length && (act.cycle !== 0 || !s.players[sp.target] || sp.target === s.slot)) {
      const n = others.length;
      const i = Math.max(0, others.findIndex((p) => p.slot === sp.target));
      const next = others[(((i + act.cycle) % n) + n) % n]!;
      if (next.slot !== sp.target) {
        sp.target = next.slot;
        this.input.spec.yaw = next.yaw;
        sp.snap = true;
      }
    }
    if (act.toggle) {
      sp.view = sp.view === 'first' ? 'third' : 'first';
      sp.snap = true;
    }
    const t = s.players[sp.target];
    if (!t) {
      // nobody to watch: look over the field
      this.camera.position.set(0, 18, 28);
      this.camera.lookAt(0, 2, 0);
      return fov;
    }
    const hole = this.holeOf(t);
    if (sp.view === 'first' && t.alive) {
      // through their eyes
      const e = eyePos(hole, t.exposure, this.liftOf(t));
      const k = sp.snap ? 1 : 1 - Math.exp(-dt * 25);
      sp.yaw += angleDiff(t.yaw, sp.yaw) * k;
      sp.pitch += (t.pitch - sp.pitch) * k;
      sp.snap = false;
      this.camera.position.set(e.x, e.y, e.z);
      this.camera.rotation.set(0, 0, 0, 'YXZ');
      this.camera.rotation.y = sp.yaw;
      this.camera.rotation.x = sp.pitch + this.camKick;
      return fov / this.zoomOf(t);
    }
    // third person: orbit around their head; the terrain pulls the camera in rather than block the view
    const pivot = t.alive ? this.headPos(t) : new THREE.Vector3(hole.x, hole.rim + 1 + this.liftOf(t), hole.z);
    const o = this.input.spec;
    const d = dirFromYawPitch(o.yaw, o.pitch);
    let dist = o.dist;
    const hit = this.arena.raycast(pivot, { x: -d.x, y: -d.y, z: -d.z }, dist);
    if (hit < dist) dist = Math.max(1.2, hit - 0.4);
    const want = pivot.clone().add(new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(-dist));
    want.y = Math.max(want.y, this.arena.groundAt(want.x, want.z) + 0.4);
    if (sp.snap || want.distanceTo(sp.pos) > 12) sp.pos.copy(want);
    else sp.pos.lerp(want, 1 - Math.exp(-dt * 12));
    sp.snap = false;
    this.camera.position.copy(sp.pos);
    this.camera.lookAt(pivot);
    return fov;
  }

  private updateViewmodel(dt: number) {
    const s = this.session;
    const me = s.me;
    const vs = this.viewSlot();
    // spectating someone in first person: show their gun
    const other = vs >= 0 && vs !== s.slot ? s.players[vs]! : null;
    const w = other ? other.weapon : this.myWeapon();
    const zoom = other ? (this.zoomOf(other) > 1 ? other.zoom : 0) : this.input.s.zoom;
    const scoped = zoom > 0 && (WEAPONS[w].zoom[zoom - 1] ?? 1) >= 2.4;
    this.vmHolder.visible = vs >= 0 && !scoped && s.phase !== 'ended';
    const color = other ? other.color : this.me?.color ?? 0x3d7bff;
    if (w !== this.vmWeapon || color !== this.vmColor) {
      if (this.vmModel) {
        this.vmHolder.remove(this.vmModel);
        disposeTree(this.vmModel);
      }
      this.vmModel = buildWeaponModel(w, this.q.pbr, this.detailed);
      // gloved hand
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.14), new THREE.MeshLambertMaterial({ color }));
      glove.position.set(0, -0.1, 0.02);
      this.vmModel.add(glove);
      this.vmHolder.add(this.vmModel);
      this.vmWeapon = w;
      this.vmColor = color;
    }
    this.vmKick = Math.max(0, this.vmKick - dt * 5);
    let reloadDip: number;
    if (other) {
      // remote players only tell us that they are reloading
      this.spec.reload += (((other.flags & F_RELOAD) !== 0 ? 0.8 : 0) - this.spec.reload) * Math.min(1, dt * 8);
      reloadDip = this.spec.reload;
    } else {
      const reloadF = me && me.rl > s.hostTick && me.rs > 0 ? 1 - (me.rl - s.hostTick) / Math.max(1, me.rl - me.rs) : 0;
      reloadDip = reloadF > 0 ? Math.sin(Math.min(1, reloadF) * Math.PI) : 0;
    }
    const exp = other ? other.exposure : s.myExposure;
    const bob = Math.sin(this.time * 2) * 0.004;
    // a throw: the hand swings forward, empty for a moment, then the next grenade comes up from below
    this.vmThrow += dt;
    let tY = 0, tZ = 0, tRot = 0, empty = false;
    if (WEAPONS[w].projectile?.loftDeg && this.vmThrow < THROW_ANIM) {
      const k = this.vmThrow / THROW_ANIM;
      if (k < 0.3) {
        const a = Math.sin((k / 0.3) * Math.PI);
        tY = a * 0.1;
        tZ = -a * 0.18;
        tRot = -a * 0.9;
      } else if (k < 0.6) empty = true;
      else tY = -(1 - (k - 0.6) / 0.4) * 0.3;
    }
    if (this.vmModel) this.vmModel.visible = !empty;
    this.vmHolder.scale.setScalar(0.6);
    this.vmHolder.position.set(0.3, -0.27 - (1 - exp) * 0.25 - reloadDip * 0.18 + bob + tY, -0.46 + this.vmKick * 0.06 + tZ);
    this.vmHolder.rotation.set(this.vmKick * 0.12 - reloadDip * 0.6 + tRot, 0.06, reloadDip * 0.35);
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
      hud.sauce(me.al ? sauceLeft(me.sa, me.su, s.hostTick) : 0);
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
      const vs = this.viewSlot();
      const other = vs >= 0 && vs !== s.slot ? s.players[vs]! : null;
      if (other) {
        // spectating in first person: their reticle and scope
        hud.ammo(other.weapon, 0, 0, true, false);
        const zf = this.zoomOf(other);
        hud.reticle(false, zf < 2.4);
        hud.scope(zf >= 2.4, zf >= 2.4 ? `${zf}×` : '');
        hud.charge(0);
      } else {
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
      }
      // power-ups
      const pus = me.pu
        .filter(([id, until]) => until > s.hostTick && POWERUPS[id as PowerUpId])
        .map(([id, until]) => {
          const def = POWERUPS[id as PowerUpId];
          // held power-ups (Spring Jump) don't run down
          return { id: def.id, frac: def.held ? 1 : (until - s.hostTick) / (def.duration * settings.powerupDurationMult * TICK_RATE) };
        });
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
    } else if (s.start && s.latestTick - s.start.tick > 30) {
      // joined a full custom field: watch until a hole frees up
      hud.sub('All holes are taken — you’ll join when one frees up');
    }
    this.updateSpectateHud();
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
    // scores change rarely: a few refreshes a second (and at once when the scoreboard opens or closes)
    const board = this.showScores || s.phase === 'ended';
    if (this.frames % 6 === 0 || board !== this.boardShown) {
      this.boardShown = board;
      const rows = this.scoreRows();
      hud.score(rows, settings.weaponMode === 'gunGame' ? settings.gunGameOrder.length : settings.scoreLimit);
      this.scoreboardEl.classList.toggle('on', board);
      if (board) setHtml(this.scoreboardEl, scoreboardHtml(rows, settings.weaponMode === 'gunGame'));
    }
    if (!this.introShown && s.phase === 'intro') {
      this.introShown = true;
      hud.message('Get ready', 2200, 'big');
    }
    if (!s.isLocal) hud.conn(`${s.lobby?.code ?? ''} · ${Math.round((s.interpDelay * 1000) / TICK_RATE)}ms buffer`);
    this.input.updateTouchLabels();
  }

  private updateSpectateHud() {
    const s = this.session;
    const hud = this.hud;
    const dead = !s.me?.al && s.state === 'match';
    hud.dead(dead);
    const t = this.spec.active && dead ? s.players[this.spec.target] : null;
    if (!t) return hud.spectate(null);
    const tags: string[] = [];
    if (s.leader === t.slot) tags.push('👑 Leader');
    if (!t.alive) tags.push('☠ Dead');
    if (t.flags & F_CAMO) tags.push('◌ Camo');
    if (t.flags & F_OVERSHIELD) tags.push('⛨ Overshield');
    if (t.flags & F_INVINCIBLE) tags.push('★ Invincible');
    if (t.flags & F_DAMAGE) tags.push('✖ Damage boost');
    const dev = this.input.device;
    const hint =
      dev === 'pad' ? 'RB / LB switch · Y 1st / 3rd person · triggers zoom' : dev === 'touch' ? '◀ ▶ switch · 👁 1st / 3rd person · drag to look · pinch to zoom' : 'E / Q or click: switch · F: 1st / 3rd person · mouse: look · wheel: zoom';
    hud.spectate({ name: t.name, color: t.color, weapon: WEAPONS[t.weapon].name, kills: t.kills, deaths: t.deaths, view: this.viewSlot() === t.slot ? 'first' : 'third', tags, hint });
  }

  private respawnKey() {
    return this.input.device === 'pad' ? 'Ⓐ' : this.input.device === 'touch' ? 'RESPAWN' : 'SPACE';
  }

  static qualityFor(level: keyof typeof QUALITY) {
    return QUALITY[level];
  }
}

