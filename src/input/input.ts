import { clamp } from '../shared/vec';
import { isQualityLevel, sanitizeGfx, type GfxOverrides, type QualityLevel } from '../render/quality';

export interface InputState {
  yaw: number;
  pitch: number;
  stand: boolean;
  trigger: boolean;
  presses: number;
  reloads: number;
  /** cumulative respawn requests (Jump while dead) */
  respawns: number;
  /** cumulative Spring Jump launches (double-press Jump) */
  springs: number;
  /** cumulative "use power-up" presses (counted by the game, which knows what's picked: see InvOp) */
  uses: number;
  zoom: number;
}

/** Inventory actions, in the order they were pressed: pick the next/previous power-up, pick slot `i`, use the picked one. */
export type InvOp = { k: 'cycle'; d: 1 | -1 } | { k: 'pick'; i: number } | { k: 'use' };
/** Respawn weapon picker actions (while dead, Players choose): the next/previous gun, or gun `i`. */
export type WeaponOp = { k: 'cycle'; d: 1 | -1 } | { k: 'pick'; i: number };

/** Two presses within `windowMs` make a double-press (the next press starts over). */
export class DoubleTap {
  private last = -Infinity;
  constructor(private windowMs = 300) {}
  press(nowMs: number): boolean {
    if (nowMs - this.last <= this.windowMs) {
      this.last = -Infinity;
      return true;
    }
    this.last = nowMs;
    return false;
  }
  reset() {
    this.last = -Infinity;
  }
}

export interface Options {
  mouseSens: number;
  padSens: number;
  touchSens: number;
  invertY: boolean;
  standMode: 'hold' | 'toggle';
  fov: number;
  quality: 'auto' | QualityLevel;
  /** Options → Graphics → Advanced (anything left out follows the quality preset) */
  gfx: GfxOverrides;
  fpsCounter: boolean;
}

export const DEFAULT_OPTIONS: Options = { mouseSens: 1, padSens: 1, touchSens: 1, invertY: false, standMode: 'hold', fov: 78, quality: 'auto', gfx: {}, fpsCounter: false };

/** Saved options, with anything missing or invalid back at its default. */
export function sanitizeOptions(raw: unknown): Options {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const o: Options = { ...DEFAULT_OPTIONS, gfx: sanitizeGfx(src.gfx) };
  const num = (k: 'mouseSens' | 'padSens' | 'touchSens' | 'fov', lo: number, hi: number) => {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) o[k] = Math.min(hi, Math.max(lo, v));
  };
  num('mouseSens', 0.05, 10);
  num('padSens', 0.05, 10);
  num('touchSens', 0.05, 10);
  num('fov', 50, 120);
  if (typeof src.invertY === 'boolean') o.invertY = src.invertY;
  if (src.standMode === 'hold' || src.standMode === 'toggle') o.standMode = src.standMode;
  if (src.quality === 'auto' || isQualityLevel(src.quality)) o.quality = src.quality;
  if (typeof src.fpsCounter === 'boolean') o.fpsCounter = src.fpsCounter;
  return o;
}

export function loadOptions(): Options {
  try {
    return sanitizeOptions(JSON.parse(localStorage.getItem('hd.options') ?? '{}'));
  } catch {
    return { ...DEFAULT_OPTIONS, gfx: {} };
  }
}
export function saveOptions(o: Options) {
  try {
    localStorage.setItem('hd.options', JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

/**
 * Aim speed while zoomed. Scaling by tan(fov/2) keeps a given mouse/stick/finger movement moving the view the same
 * distance *on screen* at every zoom level (and smoothly through the zoom-in), which is what a scope should feel like.
 */
export function zoomSensitivity(fovDeg: number, baseFovDeg: number): number {
  if (!(fovDeg > 0) || !(baseFovDeg > 0)) return 1;
  const k = Math.tan((fovDeg * Math.PI) / 360) / Math.tan((baseFovDeg * Math.PI) / 360);
  return Math.min(2, Math.max(0.01, k));
}

export interface AssistInfo {
  /** angular offset (rad) from crosshair to nearest target centre, and its angular radius */
  dYaw: number;
  dPitch: number;
  radius: number;
}

export interface InputHooks {
  zoomLevels(): number;
  onFirePress(): void;
  onMenu(): void;
  onScoreboard(show: boolean): void;
  onDevice(kind: 'kbm' | 'pad' | 'touch'): void;
  assist(): AssistInfo | null;
  assistStrength(): number;
  canLock(): boolean;
  /** holding a Spring Jump and on the ground */
  canSpring(): boolean;
  /** aim speed multiplier (Gerry Sauce slows you down) */
  aimScale(): number;
  /** aim speed for the current zoom: see zoomSensitivity (1 when not zoomed) */
  fovScale(): number;
}

/** Unified keyboard+mouse / gamepad / touch input. */
export class InputManager {
  readonly s: InputState = { yaw: 0, pitch: 0, stand: false, trigger: false, presses: 0, reloads: 0, respawns: 0, springs: 0, uses: 0, zoom: 0 };
  opts: Options = loadOptions();
  /** 'spectate' while dead: Jump asks for a respawn, aim drives the spectator camera */
  private _mode: 'play' | 'spectate' = 'play';
  /** spectator camera (orbit angles and distance) — never sent to the host */
  readonly spec = { yaw: 0, pitch: -0.35, dist: 7 };
  private specCycle = 0;
  private specToggles = 0;
  private invOps: InvOp[] = [];
  private weaponOps: WeaponOp[] = [];
  /** mouse wheel: scrolled distance not yet turned into a step, and when the last step was */
  private wheelAcc = 0;
  private wheelAt = 0;
  private useKey = '-';
  private pinchD = 0;
  private standTap = new DoubleTap(300);
  private touchSpringTap = false;
  device: 'kbm' | 'pad' | 'touch' = matchMedia('(pointer: coarse)').matches ? 'touch' : 'kbm';
  enabled = false;
  private _suspended = false;
  /** test hooks */
  testStand = false;
  testTrigger = false;
  private keysStand = false;
  private toggleStand = false;
  private mouseFire = false;
  private touchFire = false;
  private touchStandHold = false;
  private touchStandToggle = false;
  private padFire = false;
  private padStandHold = false;
  private padStandToggle = false;
  private prevPad: boolean[] = [];
  private aimTouches = new Map<number, { x: number; y: number }>();
  private touchRoot: HTMLElement | null = null;
  private unsub: (() => void)[] = [];

  constructor(
    private canvas: HTMLElement,
    private hooks: InputHooks,
  ) {
    this.bind();
  }

  private on<K extends keyof WindowEventMap | 'pointerlockchange' | 'visibilitychange'>(t: Window | Document | HTMLElement, type: K, fn: (e: K extends keyof WindowEventMap ? WindowEventMap[K] : Event) => void, opts?: AddEventListenerOptions) {
    t.addEventListener(type, fn as EventListener, opts);
    this.unsub.push(() => t.removeEventListener(type, fn as EventListener, opts));
  }

  get mode() {
    return this._mode;
  }

  /**
   * A menu or the Options screen is open over the match: nothing reaches your Spartan (you duck, stop firing), only
   * Esc / the controller's Menu button get through (to close it again).
   */
  get suspended() {
    return this._suspended;
  }

  set suspended(on: boolean) {
    if (on === this._suspended) return;
    this._suspended = on;
    this.releaseAll();
  }

  /** Let go of everything held or toggled (focus lost, app switched, a menu opened): you duck and stop firing. */
  releaseAll() {
    this.keysStand = this.toggleStand = false;
    this.mouseFire = this.touchFire = this.padFire = false;
    this.touchStandHold = this.touchStandToggle = false;
    this.padStandHold = this.padStandToggle = false;
    this.touchSpringTap = false;
    this.aimTouches.clear();
    this.pinchD = 0;
    this.touchRoot?.querySelectorAll('.tbtn.down').forEach((b) => b.classList.remove('down'));
    this.hooks.onScoreboard(false);
  }

  set mode(m: 'play' | 'spectate') {
    if (m === this._mode) return;
    this._mode = m;
    // nothing held while dead carries over
    this.mouseFire = this.touchFire = this.padFire = false;
    this.keysStand = this.touchStandHold = false;
    this.pinchD = 0;
    this.touchRoot?.classList.toggle('spec', m === 'spectate');
  }

  /** Spectator actions since the last call: player cycling (+next / -previous) and 1st/3rd person toggle. */
  takeSpec(): { cycle: number; toggle: boolean } {
    const r = { cycle: this.specCycle, toggle: this.specToggles % 2 === 1 };
    this.specCycle = 0;
    this.specToggles = 0;
    return r;
  }

  /** Inventory actions since the last call, in order (the game applies them to what's in the inventory). */
  takeInvOps(): InvOp[] {
    const r = this.invOps;
    this.invOps = [];
    return r;
  }

  /** Weapon picker actions since the last call, in order. */
  takeWeaponOps(): WeaponOp[] {
    const r = this.weaponOps;
    this.weaponOps = [];
    return r;
  }

  private weaponOp(op: WeaponOp) {
    if (this._mode === 'spectate' && !this._suspended) this.weaponOps.push(op);
  }

  invCycle(d: 1 | -1) {
    if (this._mode === 'play') this.invOps.push({ k: 'cycle', d });
  }

  invPick(i: number) {
    if (this._mode === 'play' && !this._suspended) this.invOps.push({ k: 'pick', i });
  }

  invUse() {
    if (this._mode === 'play') this.invOps.push({ k: 'use' });
  }

  /** A spectator action is waiting (lets the player skip the death cam). */
  specPending() {
    return this.specCycle !== 0 || this.specToggles !== 0;
  }

  private specZoom(f: number) {
    this.spec.dist = clamp(this.spec.dist * f, 2, 30);
  }

  private bind() {
    this.on(document, 'mousemove', (e) => {
      if (!this.enabled || this._suspended || document.pointerLockElement !== this.canvas) return;
      const dx = clamp(e.movementX, -300, 300), dy = clamp(e.movementY, -300, 300);
      const k = 0.0022 * this.opts.mouseSens * this.zoomScale();
      this.look(-dx * k, -dy * k * (this.opts.invertY ? -1 : 1));
    });
    this.on(this.canvas, 'mousedown', (e) => {
      if (!this.enabled || this._suspended) return;
      this.setDevice('kbm');
      if (document.pointerLockElement !== this.canvas) {
        this.lock();
        return; // the locking click never fires
      }
      if (this._mode === 'spectate') {
        if (e.button === 0) this.specCycle++;
        else if (e.button === 2) this.specCycle--;
        return;
      }
      if (e.button === 0) {
        this.mouseFire = true;
        this.press();
      } else if (e.button === 2) this.cycleZoom();
      else if (e.button === 1) {
        // middle click: use the picked power-up (and no autoscroll)
        e.preventDefault();
        this.invUse();
      }
    });
    this.on(
      this.canvas,
      'wheel',
      (e) => {
        if (!this.enabled || this._suspended) return;
        e.preventDefault();
        // lines or pages (Firefox) in pixels
        const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        if (this._mode === 'spectate') {
          this.specZoom(Math.exp(clamp(dy, -300, 300) * 0.0015));
          return;
        }
        // play: one notch steps through the inventory (a trackpad's stream of small deltas adds up, not too fast)
        if (Math.sign(dy) !== Math.sign(this.wheelAcc)) this.wheelAcc = 0;
        this.wheelAcc += dy;
        if (Math.abs(this.wheelAcc) >= 50 && e.timeStamp - this.wheelAt > 140) {
          this.invCycle(this.wheelAcc > 0 ? 1 : -1);
          this.wheelAcc = 0;
          this.wheelAt = e.timeStamp;
        }
      },
      { passive: false },
    );
    this.on(window, 'mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
    });
    this.on(this.canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(window, 'keydown', (e) => {
      if (!this.enabled) return;
      if (this._suspended) {
        if (e.code === 'Escape') this.hooks.onMenu();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      this.setDevice('kbm');
      if (/^Digit[0-9]$/.test(e.code)) {
        if (e.repeat) return;
        // (0 is the 10th weapon in the respawn picker)
        const n = Number(e.code.slice(5));
        if (this._mode === 'spectate') this.weaponOp({ k: 'pick', i: n === 0 ? 9 : n - 1 });
        else if (n > 0) this.invPick(n - 1);
        return;
      }
      switch (e.code) {
        case 'Space':
        case 'ShiftLeft':
        case 'KeyW':
          e.preventDefault();
          if (e.repeat) break;
          if (this._mode === 'spectate') this.s.respawns++;
          else {
            const launch = this.standPress(e.timeStamp);
            // in toggle mode the launching second press doesn't toggle you back down
            if (this.opts.standMode === 'toggle') {
              if (!launch) this.toggleStand = !this.toggleStand;
            } else this.keysStand = true;
          }
          break;
        case 'ControlLeft':
        case 'KeyC':
        case 'KeyS':
          this.toggleStand = false;
          this.keysStand = false;
          break;
        case 'KeyR':
          if (!e.repeat && this._mode === 'play') this.reload();
          break;
        case 'KeyE':
          if (e.repeat) break;
          if (this._mode === 'spectate') this.specCycle++;
          else this.cycleZoom();
          break;
        case 'ArrowUp':
        case 'ArrowDown':
          if (this._mode !== 'spectate') break;
          e.preventDefault();
          if (!e.repeat) this.weaponOp({ k: 'cycle', d: e.code === 'ArrowDown' ? 1 : -1 });
          break;
        case 'ArrowRight':
        case 'ArrowLeft':
          e.preventDefault();
          if (e.repeat) break;
          if (this._mode === 'spectate') this.specCycle += e.code === 'ArrowRight' ? 1 : -1;
          else this.invCycle(e.code === 'ArrowRight' ? 1 : -1);
          break;
        case 'KeyQ':
          if (e.repeat) break;
          if (this._mode === 'spectate') this.specCycle--;
          else this.invUse();
          break;
        case 'KeyF':
          if (!e.repeat && this._mode === 'spectate') this.specToggles++;
          break;
        case 'KeyZ':
          if (!e.repeat && this._mode === 'play') this.cycleZoom();
          break;
        case 'Tab':
          e.preventDefault();
          this.hooks.onScoreboard(true);
          break;
        case 'Escape':
          this.hooks.onMenu();
          break;
      }
    });
    this.on(window, 'keyup', (e) => {
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'KeyW') this.keysStand = false;
      if (e.code === 'Tab') this.hooks.onScoreboard(false);
    });
    // focus moved away (alt-tab, a notification, another app): nothing stays held down
    this.on(window, 'blur', () => this.releaseAll());
    this.on(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    this.on(window, 'gamepadconnected', () => this.setDevice('pad'));
    // touch aiming: any finger that isn't on a button
    this.on(this.canvas, 'pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !this.enabled || this._suspended) return;
      this.setDevice('touch');
      this.aimTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    this.on(window, 'pointermove', (e) => {
      const t = this.aimTouches.get(e.pointerId);
      if (!t || !this.enabled) return;
      if (this._mode === 'spectate' && this.aimTouches.size >= 2) {
        // two fingers: pinch to zoom the spectator camera
        t.x = e.clientX;
        t.y = e.clientY;
        const [a, b] = [...this.aimTouches.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (this.pinchD > 0 && d > 0) this.specZoom(this.pinchD / d);
        this.pinchD = d;
        return;
      }
      const k = 0.0055 * this.opts.touchSens * this.zoomScale();
      this.look(-(e.clientX - t.x) * k, -(e.clientY - t.y) * k * (this.opts.invertY ? -1 : 1));
      t.x = e.clientX;
      t.y = e.clientY;
    });
    const endTouch = (e: PointerEvent) => {
      this.aimTouches.delete(e.pointerId);
      this.pinchD = 0;
    };
    this.on(window, 'pointerup', endTouch);
    this.on(window, 'pointercancel', endTouch);
    this.on(document, 'pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas) {
        this.mouseFire = false;
        this.keysStand = false;
      }
    });
  }

  lock() {
    if (!this.hooks.canLock() || this.device === 'touch' || this._suspended) return;
    const c = this.canvas as HTMLElement & { requestPointerLock(o?: unknown): Promise<void> | void };
    try {
      const r = c.requestPointerLock({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => {
          try {
            const r2 = c.requestPointerLock();
            if (r2 && typeof (r2 as Promise<void>).catch === 'function') (r2 as Promise<void>).catch(() => {});
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      /* ignore */
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  private setDevice(d: 'kbm' | 'pad' | 'touch') {
    if (this.device !== d) {
      this.device = d;
      this.hooks.onDevice(d);
    }
  }

  /** Scoped aim speed. The spectator camera is never zoomed by the player, so it always turns at full speed. */
  private zoomScale() {
    return this._mode === 'play' ? this.hooks.fovScale() : 1;
  }

  private look(dYaw: number, dPitch: number) {
    if (this._mode === 'spectate') {
      this.spec.yaw += dYaw;
      this.spec.pitch = clamp(this.spec.pitch + dPitch, -1.4, 1.2);
      return;
    }
    const k = this.hooks.aimScale();
    this.s.yaw += dYaw * k;
    this.s.pitch = clamp(this.s.pitch + dPitch * k, -1.35, 1.35);
  }

  private press() {
    this.s.presses++;
    this.hooks.onFirePress();
  }

  /**
   * Every Jump/stand press: a quick double-press launches a held Spring Jump. Returns true if it did.
   * `at`: when the press happened (event timestamps survive a busy main thread).
   */
  private standPress(at = performance.now()): boolean {
    const launch = this.standTap.press(at) && this.hooks.canSpring();
    if (launch) this.s.springs++;
    return launch;
  }

  reload() {
    this.s.reloads++;
    this.s.zoom = 0;
  }

  cycleZoom() {
    const n = this.hooks.zoomLevels();
    if (n <= 0) {
      this.s.zoom = 0;
      return;
    }
    this.s.zoom = (this.s.zoom + 1) % (n + 1);
  }

  resetForSpawn(yaw: number) {
    this.s.yaw = yaw;
    this.s.pitch = 0;
    this.s.zoom = 0;
    this.toggleStand = false;
    this.touchStandToggle = false;
    this.padStandToggle = false;
    this.standTap.reset();
  }

  /** Called every frame. */
  update(dt: number) {
    this.pollPad(dt);
    if (this._suspended) {
      this.s.stand = false;
      this.s.trigger = false;
      this.s.zoom = 0;
      return;
    }
    if (this._mode === 'spectate') {
      this.s.stand = false;
      this.s.trigger = false;
      this.s.zoom = 0;
      return;
    }
    const standing = this.testStand || this.keysStand || this.toggleStand || this.touchStandHold || this.touchStandToggle || this.padStandHold || this.padStandToggle;
    this.s.stand = standing;
    this.s.trigger = this.testTrigger || this.mouseFire || this.touchFire || this.padFire;
    // zoom only makes sense while up
    if (!standing && this.s.zoom) this.s.zoom = 0;
    // aim assist (controller & touch only): friction is applied in look(), magnetism here
    if ((this.device === 'pad' || this.device === 'touch') && this.hooks.assistStrength() > 0 && this.s.stand) {
      const a = this.hooks.assist();
      if (a) {
        const st = this.hooks.assistStrength();
        const d = Math.hypot(a.dYaw, a.dPitch);
        if (d < a.radius * 4 && d > 1e-4) {
          const pull = Math.min(1, dt * 3.2 * st) * this.hooks.aimScale();
          this.s.yaw += a.dYaw * pull * 0.35;
          this.s.pitch += a.dPitch * pull * 0.35;
        }
      }
    }
  }

  private pollPad(dt: number) {
    const pads = navigator.getGamepads?.() ?? [];
    const gp = pads.find((p) => p && p.connected);
    if (!gp) return;
    const b = (i: number) => !!gp.buttons[i]?.pressed;
    const edge = (i: number) => b(i) && !this.prevPad[i];
    const any = gp.buttons.some((x) => x.pressed) || gp.axes.some((a) => Math.abs(a) > 0.3);
    if (any) this.setDevice('pad');
    if (this.device !== 'pad') {
      this.prevPad = gp.buttons.map((x) => x.pressed);
      return;
    }
    if (!this.enabled || this._suspended) {
      if (this.enabled && edge(9)) this.hooks.onMenu();
      this.prevPad = gp.buttons.map((x) => x.pressed);
      return;
    }
    // right stick aim with response curve
    const rx = gp.axes[2] ?? 0, ry = gp.axes[3] ?? 0;
    const dz = 0.12;
    const mag = Math.hypot(rx, ry);
    if (mag > dz) {
      const m = Math.min(1, (mag - dz) / (1 - dz));
      const curve = m * m * 0.7 + m * 0.3;
      let rate = 3.4 * this.opts.padSens * curve * this.zoomScale();
      // aim-assist friction when over a target
      const a = this._mode === 'play' && this.hooks.assistStrength() > 0 ? this.hooks.assist() : null;
      if (a && Math.hypot(a.dYaw, a.dPitch) < a.radius * 2.5) rate *= 1 - 0.45 * this.hooks.assistStrength();
      this.look((-rx / mag) * rate * dt, (-ry / mag) * rate * dt * (this.opts.invertY ? -1 : 1));
    }
    if (this._mode === 'spectate') {
      // A respawns, RB/LB cycle players, Y toggles 1st/3rd person, triggers zoom
      if (edge(0)) this.s.respawns++;
      if (edge(5)) this.specCycle++;
      if (edge(4)) this.specCycle--;
      if (edge(3)) this.specToggles++;
      // the D-pad picks the gun to respawn with
      if (edge(14)) this.weaponOp({ k: 'cycle', d: -1 });
      if (edge(15)) this.weaponOp({ k: 'cycle', d: 1 });
      const zoom = (gp.buttons[6]?.value ?? 0) - (gp.buttons[7]?.value ?? 0);
      if (Math.abs(zoom) > 0.1) this.specZoom(Math.exp(zoom * dt * 1.6));
      this.padFire = false;
      this.padStandHold = false;
    } else {
      this.padFire = (gp.buttons[7]?.value ?? 0) > 0.35;
      if ((gp.buttons[7]?.value ?? 0) > 0.35 && !this.prevPad[7]) this.press();
      if (edge(6)) this.cycleZoom();
      this.padStandHold = b(0);
      const toggle = edge(4) || edge(10);
      const launch = (edge(0) || toggle) && this.standPress();
      if (toggle && !launch) this.padStandToggle = !this.padStandToggle;
      if (edge(1)) this.padStandToggle = false;
      if (edge(2)) this.reload();
      // RB uses the picked power-up, the D-pad picks another
      if (edge(5)) this.invUse();
      if (edge(14)) this.invCycle(-1);
      if (edge(15)) this.invCycle(1);
    }
    if (edge(9)) this.hooks.onMenu();
    if (edge(8)) this.hooks.onScoreboard(true);
    if (!b(8) && this.prevPad[8]) this.hooks.onScoreboard(false);
    this.prevPad = gp.buttons.map((x, i) => (i === 7 ? (x.value ?? 0) > 0.35 : x.pressed));
  }

  // --- touch overlay -------------------------------------------------------------------------
  mountTouch(root: HTMLElement) {
    this.touchRoot = root;
    root.innerHTML = `
      <button class="tbtn tstand" data-act="stand">STAND</button>
      <button class="tbtn tfire" data-act="fire">FIRE</button>
      <button class="tbtn tzoom" data-act="zoom">ZOOM</button>
      <button class="tbtn treload" data-act="reload">RELOAD</button>
      <button class="tbtn tmenu" data-act="menu">☰</button>
      <button class="tbtn tscore" data-act="score">≡</button>
      <button class="tbtn tprev" data-act="prev" aria-label="Previous player">◀</button>
      <button class="tbtn tnext" data-act="next" aria-label="Next player">▶</button>
      <button class="tbtn tview" data-act="view" aria-label="First / third person">👁</button>
      <button class="tbtn tuse" data-act="use" aria-label="Use power-up"><span class="ic"></span><span class="n"></span></button>`;
    root.classList.toggle('spec', this._mode === 'spectate');
    const btns = root.querySelectorAll<HTMLButtonElement>('.tbtn');
    btns.forEach((btn) => {
      const act = btn.dataset.act!;
      let downAt = 0;
      let last: { x: number; y: number } | null = null;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this._suspended && act !== 'menu') return;
        btn.setPointerCapture(e.pointerId);
        this.setDevice('touch');
        btn.classList.add('down');
        downAt = performance.now();
        last = { x: e.clientX, y: e.clientY };
        switch (act) {
          case 'fire':
            this.touchFire = true;
            this.press();
            break;
          case 'stand':
            if (this._mode === 'spectate') this.s.respawns++;
            else {
              this.touchStandHold = true;
              this.touchSpringTap = this.standPress(e.timeStamp);
            }
            break;
          case 'use':
            this.invUse();
            break;
          case 'prev':
            this.specCycle--;
            break;
          case 'next':
            this.specCycle++;
            break;
          case 'view':
            this.specToggles++;
            break;
          case 'zoom':
            this.cycleZoom();
            break;
          case 'reload':
            this.reload();
            break;
          case 'menu':
            this.hooks.onMenu();
            break;
          case 'score':
            this.hooks.onScoreboard(true);
            break;
        }
      });
      btn.addEventListener('pointermove', (e) => {
        if (act !== 'fire' || !last) return;
        // dragging the fire button also aims
        const k = 0.0055 * this.opts.touchSens * this.zoomScale();
        this.look(-(e.clientX - last.x) * k, -(e.clientY - last.y) * k * (this.opts.invertY ? -1 : 1));
        last = { x: e.clientX, y: e.clientY };
      });
      const up = () => {
        btn.classList.remove('down');
        last = null;
        if (act === 'fire') this.touchFire = false;
        if (act === 'stand' && this.touchStandHold) {
          this.touchStandHold = false;
          // quick tap toggles, long hold is momentary (a launching double-tap leaves the toggle alone)
          if (performance.now() - downAt < 220 && !this.touchSpringTap) this.touchStandToggle = !this.touchStandToggle;
          this.touchSpringTap = false;
        }
        if (act === 'score') this.hooks.onScoreboard(false);
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    });
  }

  /** The touch USE button shows the picked power-up (and hides with nothing in the inventory). */
  setUseButton(info: { icon: string; color: string; n: number } | null) {
    const root = this.touchRoot;
    const key = info ? `${info.icon}|${info.color}|${info.n}` : '';
    if (!root || key === this.useKey) return;
    this.useKey = key;
    root.classList.toggle('hasinv', !!info);
    const b = root.querySelector<HTMLElement>('.tuse');
    if (!b || !info) return;
    b.style.setProperty('--pc', info.color);
    b.querySelector('.ic')!.textContent = info.icon;
    b.querySelector('.n')!.textContent = info.n > 1 ? `×${info.n}` : '';
  }

  updateTouchLabels() {
    const b = this.touchRoot?.querySelector<HTMLButtonElement>('.tstand');
    if (b) {
      const label = this._mode === 'spectate' ? 'RESPAWN' : this.s.stand ? 'DUCK' : 'STAND';
      if (b.textContent !== label) b.textContent = label;
      b.classList.toggle('on', this._mode === 'play' && this.touchStandToggle);
    }
  }

  destroy() {
    for (const u of this.unsub) u();
    this.unsub = [];
  }
}
