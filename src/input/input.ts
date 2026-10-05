import { clamp } from '../shared/vec';

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
  zoom: number;
}

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
  quality: 'auto' | 'low' | 'medium' | 'high';
}

export const DEFAULT_OPTIONS: Options = { mouseSens: 1, padSens: 1, touchSens: 1, invertY: false, standMode: 'hold', fov: 78, quality: 'auto' };

export function loadOptions(): Options {
  try {
    return { ...DEFAULT_OPTIONS, ...JSON.parse(localStorage.getItem('hd.options') ?? '{}') };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}
export function saveOptions(o: Options) {
  try {
    localStorage.setItem('hd.options', JSON.stringify(o));
  } catch {
    /* ignore */
  }
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
}

/** Unified keyboard+mouse / gamepad / touch input. */
export class InputManager {
  readonly s: InputState = { yaw: 0, pitch: 0, stand: false, trigger: false, presses: 0, reloads: 0, respawns: 0, springs: 0, zoom: 0 };
  opts: Options = loadOptions();
  /** 'spectate' while dead: Jump asks for a respawn, aim drives the spectator camera */
  private _mode: 'play' | 'spectate' = 'play';
  /** spectator camera (orbit angles and distance) — never sent to the host */
  readonly spec = { yaw: 0, pitch: -0.35, dist: 7 };
  private specCycle = 0;
  private specToggles = 0;
  private pinchD = 0;
  private standTap = new DoubleTap(300);
  private touchSpringTap = false;
  device: 'kbm' | 'pad' | 'touch' = matchMedia('(pointer: coarse)').matches ? 'touch' : 'kbm';
  enabled = false;
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

  private on<K extends keyof WindowEventMap | 'pointerlockchange'>(t: Window | Document | HTMLElement, type: K, fn: (e: K extends keyof WindowEventMap ? WindowEventMap[K] : Event) => void, opts?: AddEventListenerOptions) {
    t.addEventListener(type, fn as EventListener, opts);
    this.unsub.push(() => t.removeEventListener(type, fn as EventListener, opts));
  }

  get mode() {
    return this._mode;
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

  /** A spectator action is waiting (lets the player skip the death cam). */
  specPending() {
    return this.specCycle !== 0 || this.specToggles !== 0;
  }

  private specZoom(f: number) {
    this.spec.dist = clamp(this.spec.dist * f, 2, 30);
  }

  private bind() {
    this.on(document, 'mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.canvas) return;
      const dx = clamp(e.movementX, -300, 300), dy = clamp(e.movementY, -300, 300);
      const k = 0.0022 * this.opts.mouseSens / this.zoomFactor();
      this.look(-dx * k, -dy * k * (this.opts.invertY ? -1 : 1));
    });
    this.on(this.canvas, 'mousedown', (e) => {
      if (!this.enabled) return;
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
    });
    this.on(
      this.canvas,
      'wheel',
      (e) => {
        if (!this.enabled || this._mode !== 'spectate') return;
        e.preventDefault();
        this.specZoom(Math.exp(clamp(e.deltaY, -300, 300) * 0.0015));
      },
      { passive: false },
    );
    this.on(window, 'mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
    });
    this.on(this.canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(window, 'keydown', (e) => {
      if (!this.enabled) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.setDevice('kbm');
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
        case 'ArrowRight':
          if (e.repeat) break;
          if (this._mode === 'spectate') this.specCycle++;
          else if (e.code === 'KeyE') this.cycleZoom();
          break;
        case 'KeyQ':
        case 'ArrowLeft':
          if (!e.repeat && this._mode === 'spectate') this.specCycle--;
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
    this.on(window, 'blur', () => {
      this.keysStand = false;
      this.mouseFire = false;
      this.hooks.onScoreboard(false);
    });
    this.on(window, 'gamepadconnected', () => this.setDevice('pad'));
    // touch aiming: any finger that isn't on a button
    this.on(this.canvas, 'pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !this.enabled) return;
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
      const k = 0.0055 * this.opts.touchSens / this.zoomFactor();
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
    if (!this.hooks.canLock() || this.device === 'touch') return;
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

  private zoomFactor() {
    return this.s.zoom > 0 && this._mode === 'play' ? [1, 2.5, 6][this.s.zoom] ?? 1 : 1;
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
    if (!this.enabled) {
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
      let rate = 3.4 * this.opts.padSens * curve / this.zoomFactor();
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
      <button class="tbtn tspring" data-act="spring" aria-label="Spring Jump">⇈</button>`;
    root.classList.toggle('spec', this._mode === 'spectate');
    const btns = root.querySelectorAll<HTMLButtonElement>('.tbtn');
    btns.forEach((btn) => {
      const act = btn.dataset.act!;
      let downAt = 0;
      let last: { x: number; y: number } | null = null;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
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
          case 'spring':
            if (this.hooks.canSpring()) this.s.springs++;
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
        const k = 0.0055 * this.opts.touchSens / this.zoomFactor();
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

  updateTouchLabels() {
    this.touchRoot?.classList.toggle('canspring', this._mode === 'play' && this.hooks.canSpring());
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
