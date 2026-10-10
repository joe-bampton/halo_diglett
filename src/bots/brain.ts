import { Rng } from '../shared/rng';
import { angleDiff, clamp, dirFromYawPitch, dist, sub, yawPitchOf, type V3 } from '../shared/vec';
import type { Arena } from '../sim/arena';
import { DT, FIRE_EXPOSURE, LOWER_TIME, RISE_TIME, TICK_RATE, secToTicks } from '../sim/constants';
import { eyePos, isExposed, rayHitbox } from '../sim/hitbox';
import { invCount } from '../sim/inventory';
import { clipSize, isCamo, onField, playerHitbox, seatOf } from '../sim/match';
import { POWERUPS, type PowerUpId } from '../sim/powerups';
import { sauceAimScale } from '../sim/sauce';
import { inFlight, springLift } from '../sim/spring';
import { orbPos } from '../sim/orbs';
import type { BotDifficulty, MatchState, PlayerCommand, PlayerState, SimEvent } from '../sim/types';
import { WEAPONS, type WeaponDef } from '../sim/weapons';

export interface BotProfile {
  label: string;
  reaction: number;
  aimSigma0: number; // deg
  aimTau: number; // s
  aimSigmaMin: number; // deg
  turnRate: number; // deg/s
  headChance: number;
  fireTol: number;
  stand: [number, number];
  duck: [number, number];
  duckOnShieldBreak: number;
  leadSkill: number;
  orbInterest: number; // per second
  camoDetect: number; // per second
  fovDeg: number;
  /** highest aim pitch (rad) */
  pitchMax: number;
  /** jerry: never aims at anyone — pops up and hoses the sky yelling "suppressing fire!" */
  mode?: 'jerry';
  /** sees through walls, knows who is about to pop up and fires the first tick a head can be hit */
  wallhack?: boolean;
  /** when to use a held Spring Jump: right away, at a random moment, or when it gives an angle into a ducked enemy's hole */
  springUse: 'now' | 'random' | 'smart';
}

/** Record order is the order of the difficulty dropdowns. */
export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  jerry: { label: 'Jerry', reaction: 1, aimSigma0: 8, aimTau: 1, aimSigmaMin: 4, turnRate: 90, headChance: 0, fireTol: 2, stand: [1.5, 3], duck: [2, 5], duckOnShieldBreak: 0.2, leadSkill: 0, orbInterest: 0, camoDetect: 0, fovDeg: 90, pitchMax: 1.4, mode: 'jerry', springUse: 'now' },
  recruit: { label: 'Recruit', reaction: 0.85, aimSigma0: 5, aimTau: 0.6, aimSigmaMin: 1.4, turnRate: 120, headChance: 0.15, fireTol: 2.0, stand: [2.5, 4.5], duck: [1.5, 4], duckOnShieldBreak: 0.25, leadSkill: 0.4, orbInterest: 0.05, camoDetect: 0.2, fovDeg: 100, pitchMax: 1.2, springUse: 'random' },
  normal: { label: 'Normal', reaction: 0.55, aimSigma0: 3.5, aimTau: 0.4, aimSigmaMin: 0.7, turnRate: 200, headChance: 0.35, fireTol: 1.4, stand: [2, 3.5], duck: [1.2, 3], duckOnShieldBreak: 0.55, leadSkill: 0.7, orbInterest: 0.15, camoDetect: 0.35, fovDeg: 120, pitchMax: 1.2, springUse: 'random' },
  heroic: { label: 'Heroic', reaction: 0.38, aimSigma0: 2.5, aimTau: 0.28, aimSigmaMin: 0.35, turnRate: 300, headChance: 0.6, fireTol: 1.1, stand: [1.5, 3], duck: [0.8, 2.2], duckOnShieldBreak: 0.85, leadSkill: 0.9, orbInterest: 0.3, camoDetect: 0.5, fovDeg: 140, pitchMax: 1.2, springUse: 'smart' },
  legendary: { label: 'Legendary', reaction: 0.24, aimSigma0: 1.8, aimTau: 0.18, aimSigmaMin: 0.15, turnRate: 420, headChance: 0.85, fireTol: 0.9, stand: [1, 2.5], duck: [0.6, 1.6], duckOnShieldBreak: 1, leadSkill: 1, orbInterest: 0.5, camoDetect: 0.7, fovDeg: 160, pitchMax: 1.2, springUse: 'smart' },
  topover: { label: 'Top/Over', reaction: 0, aimSigma0: 0, aimTau: 0.01, aimSigmaMin: 0, turnRate: 1e5, headChance: 1, fireTol: 0.9, stand: [4, 8], duck: [0.3, 0.6], duckOnShieldBreak: 0, leadSkill: 1, orbInterest: 0, camoDetect: 99, fovDeg: 360, pitchMax: 1.45, wallhack: true, springUse: 'now' },
};

export const BOT_NAMES = [
  'Chief Diglett', 'Sgt. Johnson', 'Noble Mole', 'Arbiter Burrow', 'Grunt Gary', 'Cortana.exe',
  'Spartan Spud', 'Mole-y Cyrus', 'Hole-o 3', 'Dig Dug', 'ODST Otto', 'Elite Eddie', 'Wort Wort', 'Carrot Top',
];

const D2R = Math.PI / 180;

/** Solve launch pitch for a ballistic shot (low arc). Returns null if out of range. */
export function ballisticPitch(dx: number, dy: number, speed: number, g: number): number | null {
  if (g <= 0) return Math.atan2(dy, dx);
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  if (disc < 0) return null;
  return Math.atan2(v2 - Math.sqrt(disc), g * dx);
}

/** Lob it into their hole: bouncing grenades always, sticky ones when there's nobody up to stick to. */
function lobsIn(w: WeaponDef, exposure: number): boolean {
  const p = w.projectile;
  return !!p && (!!p.bounce || (!!p.sticky && !isExposed(exposure)));
}

export class BotBrain {
  readonly slot: number;
  readonly profile: BotProfile;
  private rng: Rng;
  private up = false;
  private phaseUntil = 0;
  private target = -1;
  private targetOrb = -1;
  private aimHead = true;
  private acquiredAt = 0;
  private reactUntil = 0;
  private errYaw = 0;
  private errPitch = 0;
  private errNext = 0;
  private yaw = 0;
  private pitch = 0;
  private presses = 0;
  private reloads = 0;
  private nextScan = 0;
  private lastPressAt = 0;
  private threat = -1;
  private threatAt = -9999;
  private reloadedThisDuck = false;
  private spawnTick = -1;
  private springs = 0;
  private uses = 0;
  /** when to use each kind of power-up in the inventory (set when it first shows up there) */
  private useAt = new Map<PowerUpId, number>();
  private springSeen = -1;
  /** Poké Ball: whose throw (captive slot) is planned, when it goes, and into which hole (-1: the sky) */
  private throwFor = -1;
  private throwAt = 0;
  private throwHole = -1;
  private springWait = 0;
  private lastTargetAt = 0;
  private skyYaw = 0;
  private skyPitch = 1.2;
  private lastYell = -9999;
  /** a voice line this bot wants to say (the host turns it into a 'callout' event) */
  callout: string | null = null;

  constructor(slot: number, difficulty: BotDifficulty, seed: number) {
    this.slot = slot;
    this.profile = BOT_PROFILES[difficulty];
    this.rng = new Rng(seed ^ (slot * 7919));
  }

  onEvents(events: SimEvent[]) {
    for (const e of events) {
      if (e.k === 'dmg' && e.v === this.slot) {
        if (e.a >= 0 && e.a !== this.slot) {
          this.threat = e.a;
          this.threatAt = e.t;
        }
        if (e.sb && this.up && this.rng.chance(this.profile.duckOnShieldBreak)) {
          this.up = false;
          this.phaseUntil = e.t + secToTicks(this.rng.range(this.profile.duck[0], this.profile.duck[1]));
        }
      } else if (e.k === 'fire' && e.p !== this.slot && this.target < 0 && this.rng.chance(0.25)) {
        // gunfire draws attention
        this.threat = e.p;
        this.threatAt = e.t;
      }
    }
  }

  think(m: MatchState, arena: Arena): PlayerCommand {
    const me = m.players[this.slot]!;
    const t = m.tick;
    const pr = this.profile;
    const cmd: PlayerCommand = { yaw: this.yaw, pitch: this.pitch, stand: false, trigger: false, presses: this.presses, reloads: this.reloads, respawns: 0, springs: this.springs, uses: this.uses, zoom: 0, vt: t };
    if (!me.alive) {
      this.up = false;
      this.target = -1;
      this.useAt.clear();
      return cmd;
    }
    // shut inside a Poké Ball: nothing to do but wait
    if (me.capturedBy >= 0) {
      this.up = false;
      this.target = -1;
      return cmd;
    }
    this.maybeSpring(m, arena, me);
    cmd.springs = this.springs;
    this.maybeUsePowerup(m, me, cmd);
    if (me.captive >= 0 && me.weapon === 'pokeball') return this.throwCaptive(m, arena, me, cmd);
    if (WEAPONS[me.weapon].fireKind === 'spray') return this.useSoaker(me, cmd);
    if (me.spawnTick !== this.spawnTick) {
      // fresh life: face the middle of the field, stay down for a moment
      this.spawnTick = me.spawnTick;
      const h = arena.holes[me.hole]!;
      this.yaw = Math.atan2(h.x, h.z) + this.rng.range(-0.4, 0.4);
      this.pitch = 0;
      this.up = false;
      this.phaseUntil = t + secToTicks(this.rng.range(0.4, 1.4));
      this.target = -1;
    }
    if (pr.mode === 'jerry') return this.thinkJerry(m, me, cmd);
    if (pr.wallhack) return this.thinkHacker(m, arena, me, cmd);
    const w = WEAPONS[me.weapon];
    const infinite = m.settings.ammoMode === 'noReload' || w.clip <= 0;
    const needReload = !infinite && me.clip < clipSize(m, w);
    const reloading = me.reloadUntil > t;

    // --- pop-up rhythm ---------------------------------------------------------------------
    if (t >= this.phaseUntil) {
      if (this.up) {
        this.up = false;
        this.reloadedThisDuck = false;
        this.phaseUntil = t + secToTicks(this.rng.range(pr.duck[0], pr.duck[1]));
      } else if (!reloading) {
        this.up = true;
        this.phaseUntil = t + secToTicks(this.rng.range(pr.stand[0], pr.stand[1]));
      }
    }
    if (!infinite && me.clip === 0) this.up = false;
    if (me.shield <= 0 && me.health < me.healthMax * 0.5 && this.rng.chance(pr.duckOnShieldBreak * DT * 2)) this.up = false;
    // don't let the anti-turtle timer catch us
    if (m.settings.antiTurtleSec > 0 && me.duckedSince >= 0 && t - me.duckedSince > secToTicks(m.settings.antiTurtleSec - 1)) {
      this.up = true;
      this.phaseUntil = Math.max(this.phaseUntil, t + secToTicks(1));
    }
    if (!this.up && needReload && !reloading && !this.reloadedThisDuck && me.exposure < 0.5) {
      this.reloads++;
      this.reloadedThisDuck = true;
    }

    // --- target selection ----------------------------------------------------------------
    // on a Spring Jump we can see (and shoot) down into ducked players' holes
    const flying = inFlight(me.springAt, t);
    const eye = eyePos(arena.holes[me.hole]!, Math.max(me.exposure, FIRE_EXPOSURE), springLift(me.springAt, t), seatOf(m, arena, me));
    if (t >= this.nextScan) {
      this.nextScan = t + 12 + this.rng.int(0, 6);
      this.pickTarget(m, arena, me, eye);
    }

    // --- aiming -----------------------------------------------------------------------------
    let aimPoint: V3 | null = null;
    let tolRad = 0;
    const tgt = this.target >= 0 ? m.players[this.target] : null;
    if (tgt && onField(tgt)) {
      this.lastTargetAt = t;
      const hb = playerHitbox(m, arena, tgt, flying ? tgt.exposure : Math.max(tgt.exposure, 0.3), me);
      if (w.splash) {
        // aim at the rim for splash weapons (or into the hole for lobbed grenades)
        aimPoint = lobsIn(w, tgt.exposure) ? { x: hb.head.x, y: hb.rim - 0.2, z: hb.head.z } : { x: hb.torsoA.x, y: Math.max(hb.rim + 0.1, hb.torsoA.y + 0.2), z: hb.torsoA.z };
        tolRad = (1.2 / Math.max(1, dist(eye, aimPoint))) * pr.fireTol;
      } else if (this.aimHead) {
        aimPoint = hb.head;
        tolRad = (hb.headR / Math.max(1, dist(eye, aimPoint))) * pr.fireTol;
      } else {
        aimPoint = { x: hb.torsoB.x, y: hb.torsoB.y - 0.1, z: hb.torsoB.z };
        tolRad = (hb.torsoR / Math.max(1, dist(eye, aimPoint))) * pr.fireTol;
      }
      if (!isExposed(tgt.exposure) && !lobsIn(w, tgt.exposure) && !flying) tolRad = 0; // wait for them to pop up
    } else if (this.targetOrb >= 0) {
      const orb = m.orbs.find((o) => o.id === this.targetOrb);
      if (orb) {
        aimPoint = orbPos(orb, t + 6, arena);
        tolRad = (0.7 / Math.max(1, dist(eye, aimPoint))) * pr.fireTol;
      } else this.targetOrb = -1;
    }

    let wantYaw = this.yaw;
    let wantPitch = this.pitch;
    if (aimPoint) {
      const dx = aimPoint.x - eye.x, dy = aimPoint.y - eye.y, dz = aimPoint.z - eye.z;
      const ang = yawPitchOf({ x: dx, y: dy, z: dz });
      wantYaw = ang.yaw;
      wantPitch = ang.pitch;
      const proj = w.projectile;
      if (proj && proj.gravity > 0 && this.rng.chance(0.98) && this.leads) {
        const hd = Math.hypot(dx, dz);
        const p = ballisticPitch(hd, dy, proj.speed, proj.gravity);
        if (p !== null) wantPitch = p - (proj.loftDeg ?? 0) * D2R;
      }
      // decaying aim error, resampled a few times per second
      if (t >= this.errNext) {
        this.errNext = t + 9;
        const since = (t - this.acquiredAt) / TICK_RATE;
        const sigma = (pr.aimSigmaMin + (pr.aimSigma0 - pr.aimSigmaMin) * Math.exp(-since / pr.aimTau)) * D2R;
        this.errYaw = this.rng.gauss() * sigma;
        this.errPitch = this.rng.gauss() * sigma * 0.7;
      }
      wantYaw += this.errYaw;
      wantPitch += this.errPitch;
    }
    // covered in Gerry Sauce: slow to turn
    const maxTurn = pr.turnRate * D2R * DT * sauceAimScale(me.saucedAt, me.saucedUntil, t);
    const dyaw = angleDiff(wantYaw, this.yaw);
    this.yaw += clamp(dyaw, -maxTurn, maxTurn);
    this.pitch += clamp(wantPitch - this.pitch, -maxTurn, maxTurn);
    this.pitch = clamp(this.pitch, -pr.pitchMax, pr.pitchMax);

    // --- firing -----------------------------------------------------------------------------
    let trigger = false;
    if (aimPoint && tolRad > 0 && t >= this.reactUntil && me.exposure >= FIRE_EXPOSURE && !reloading) {
      const offYaw = Math.abs(angleDiff(this.yaw, wantYaw - this.errYaw));
      const offPitch = Math.abs(this.pitch - (wantPitch - this.errPitch));
      const off = Math.hypot(offYaw, offPitch);
      const holdable = w.trigger === 'charge' || w.trigger === 'beam';
      const charging = holdable && (me.chargeStart >= 0 || me.beamUntil > t);
      if (off <= tolRad + 0.002 || (charging && off <= tolRad * 5 + 0.01)) {
        trigger = !(w.trigger === 'semi' && t < me.nextFireAt);
      }
    }
    // charge / beam / auto weapons need the trigger held
    if (trigger) {
      if (w.trigger === 'semi' || w.trigger === 'burst') {
        if (t - this.lastPressAt > secToTicks(Math.max(0.12, w.interval))) {
          this.presses++;
          this.lastPressAt = t;
        }
      }
    }
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;
    cmd.stand = this.up;
    cmd.trigger = trigger && (w.trigger === 'auto' || w.trigger === 'charge' || w.trigger === 'beam');
    cmd.presses = this.presses;
    cmd.reloads = this.reloads;
    cmd.zoom = w.zoom.length && this.target >= 0 && this.up ? 1 : 0;
    return cmd;
  }

  /** Press (semi/burst) or hold (auto/charge/beam) the trigger. */
  private pull(cmd: PlayerCommand, me: PlayerState, t: number) {
    const w = WEAPONS[me.weapon];
    if (w.trigger === 'semi' || w.trigger === 'burst') {
      if (t - this.lastPressAt > secToTicks(Math.max(0.12, w.interval))) {
        this.presses++;
        this.lastPressAt = t;
      }
    } else cmd.trigger = !(w.trigger === 'charge' && me.needRelease);
  }

  /**
   * Holding a Poké Ball with someone in it: pick a hole (our own, to finish them off point-blank, or another enemy's),
   * stand up and lob it in there before they break free.
   */
  private throwCaptive(m: MatchState, arena: Arena, me: PlayerState, cmd: PlayerCommand): PlayerCommand {
    const t = m.tick;
    const pr = this.profile;
    if (this.throwFor !== me.captive) {
      this.throwFor = me.captive;
      this.throwAt = t + secToTicks(this.rng.range(0.3, 1.2) * Math.max(0.4, pr.reaction * 2));
      this.throwHole = this.pickThrowHole(m, me);
    }
    this.up = true;
    let wantYaw = this.yaw;
    let wantPitch = 1.2;
    if (this.throwHole >= 0) {
      const h = arena.holes[this.throwHole]!;
      const eye = eyePos(arena.holes[me.hole]!, 1, 0, seatOf(m, arena, me));
      const to = { x: h.x - eye.x, y: h.rim - eye.y, z: h.z - eye.z };
      const proj = WEAPONS.pokeball.projectile!;
      wantYaw = yawPitchOf(to).yaw;
      const bp = ballisticPitch(Math.hypot(to.x, to.z), to.y, proj.speed, proj.gravity);
      // (out of range: as long a lob as it goes)
      wantPitch = bp !== null ? bp - (proj.loftDeg ?? 0) * D2R : 0.65;
    }
    const maxTurn = Math.max(200, pr.turnRate) * D2R * DT * sauceAimScale(me.saucedAt, me.saucedUntil, t);
    this.yaw += clamp(angleDiff(wantYaw, this.yaw), -maxTurn, maxTurn);
    this.pitch = clamp(this.pitch + clamp(wantPitch - this.pitch, -maxTurn, maxTurn), -pr.pitchMax, pr.pitchMax);
    const settled = Math.abs(angleDiff(wantYaw, this.yaw)) < 0.03 && Math.abs(wantPitch - this.pitch) < 0.03;
    if (t >= this.throwAt && settled && me.exposure >= FIRE_EXPOSURE) this.pull(cmd, me, t);
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;
    cmd.stand = true;
    cmd.presses = this.presses;
    cmd.reloads = this.reloads;
    return cmd;
  }

  /** Where to throw a captive: our own hole (for the point-blank kill) or another enemy's (chaos); Jerry: the sky (-1). */
  private pickThrowHole(m: MatchState, me: PlayerState): number {
    if (this.profile.mode === 'jerry') return -1;
    const others = m.players.filter((q): q is PlayerState => !!q && q !== me && q.slot !== me.captive && onField(q));
    const ownHole = this.profile.springUse === 'smart' || !!this.profile.wallhack ? 0.6 : 0.4;
    return others.length && !this.rng.chance(ownHole) ? this.rng.pick(others).hole : me.hole;
  }

  /** Holding the Super Soaker: stand up and squirt (it drenches the whole field, no aiming needed). */
  private useSoaker(me: PlayerState, cmd: PlayerCommand): PlayerCommand {
    this.up = true;
    if (me.exposure >= FIRE_EXPOSURE) this.pull(cmd, me, cmd.vt);
    cmd.stand = true;
    cmd.presses = this.presses;
    cmd.reloads = this.reloads;
    return cmd;
  }

  /** Jerry: never acts against anyone — stands up and sprays the sky ("Suppressing fire!"). */
  private thinkJerry(m: MatchState, me: PlayerState, cmd: PlayerCommand): PlayerCommand {
    const t = m.tick;
    const pr = this.profile;
    const w = WEAPONS[me.weapon];
    const infinite = m.settings.ammoMode === 'noReload' || w.clip <= 0;
    const reloading = me.reloadUntil > t;
    if (t >= this.phaseUntil) {
      if (this.up) {
        this.up = false;
        this.reloadedThisDuck = false;
        this.phaseUntil = t + secToTicks(this.rng.range(pr.duck[0], pr.duck[1]));
      } else if (!reloading) {
        this.up = true;
        this.phaseUntil = t + secToTicks(this.rng.range(pr.stand[0], pr.stand[1]));
        this.skyYaw = this.yaw + this.rng.range(-1.2, 1.2);
        this.skyPitch = this.rng.range(1.0, 1.35);
        this.lastPressAt = t; // the first shot comes once the gun is up
      }
    }
    if (!infinite && me.clip === 0) this.up = false;
    if (m.settings.antiTurtleSec > 0 && me.duckedSince >= 0 && t - me.duckedSince > secToTicks(m.settings.antiTurtleSec - 1)) this.up = true;
    if (!this.up && !infinite && me.clip < clipSize(m, w) && !reloading && !this.reloadedThisDuck && me.exposure < 0.5) {
      this.reloads++;
      this.reloadedThisDuck = true;
    }
    // drift around a patch of sky
    const maxTurn = pr.turnRate * (Math.PI / 180) * DT * sauceAimScale(me.saucedAt, me.saucedUntil, t);
    const wantYaw = this.skyYaw + Math.sin(t * 0.05 + this.slot) * 0.25;
    const wantPitch = this.skyPitch + Math.sin(t * 0.083 + this.slot * 2) * 0.08;
    this.yaw += clamp(angleDiff(wantYaw, this.yaw), -maxTurn, maxTurn);
    this.pitch = clamp(this.pitch + clamp(wantPitch - this.pitch, -maxTurn, maxTurn), -pr.pitchMax, pr.pitchMax);
    if (this.up && me.exposure >= FIRE_EXPOSURE && this.pitch > 0.8 && !reloading && (infinite || me.clip > 0)) {
      if (t - this.lastYell >= secToTicks(5)) {
        this.callout = 'jerry.suppress';
        this.lastYell = t;
      }
      this.pull(cmd, me, t);
    }
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;
    cmd.stand = this.up;
    cmd.presses = this.presses;
    cmd.reloads = this.reloads;
    return cmd;
  }

  /** Top/Over: wallhack + aimbot. Pre-aims where a head will appear and fires the first tick it can be hit. */
  private thinkHacker(m: MatchState, arena: Arena, me: PlayerState, cmd: PlayerCommand): PlayerCommand {
    const t = m.tick;
    const pr = this.profile;
    const w = WEAPONS[me.weapon];
    const infinite = m.settings.ammoMode === 'noReload' || w.clip <= 0;
    const reloading = me.reloadUntil > t;
    const loaded = infinite || me.clip > 0;
    // stay up unless reloading; reload the moment the clip runs dry
    this.up = !reloading && loaded;
    if (!loaded && !reloading) this.reloads++;
    const eye = eyePos(arena.holes[me.hole]!, 1, springLift(me.springAt, t), seatOf(m, arena, me));
    if (t >= this.nextScan) {
      this.nextScan = t + 6;
      this.target = this.pickWallhack(m, arena, me, eye);
    }
    const q = this.target >= 0 ? m.players[this.target] : null;
    if (q && onField(q)) {
      // stance updates before weapons fire, so aim at where they will be next tick
      const rising = q.wantStand || q.forcedStandUntil > t;
      const e1 = clamp(q.exposure + (rising ? DT / RISE_TIME : -DT / LOWER_TIME), 0, 1);
      const hb = playerHitbox(m, arena, q, e1, me);
      const aim: V3 = w.splash
        ? lobsIn(w, e1)
          ? { x: hb.head.x, y: hb.rim - 0.2, z: hb.head.z }
          : { x: hb.torsoA.x, y: Math.max(hb.rim + 0.1, hb.torsoA.y + 0.2), z: hb.torsoA.z }
        : { x: hb.head.x, y: Math.max(hb.head.y, hb.rim + 0.06), z: hb.head.z };
      const to = sub(aim, eye);
      const ang = yawPitchOf(to);
      let pitch = ang.pitch;
      const proj = w.projectile;
      if (proj && proj.gravity > 0) {
        const bp = ballisticPitch(Math.hypot(to.x, to.z), to.y, proj.speed, proj.gravity);
        if (bp !== null) pitch = bp - (proj.loftDeg ?? 0) * D2R;
      }
      const slow = sauceAimScale(me.saucedAt, me.saucedUntil, t);
      if (slow < 1) {
        // even the hacker can't snap through sauce
        const maxTurn = 300 * D2R * DT * slow;
        this.yaw += clamp(angleDiff(ang.yaw, this.yaw), -maxTurn, maxTurn);
        this.pitch = clamp(this.pitch + clamp(pitch - this.pitch, -maxTurn, maxTurn), -pr.pitchMax, pr.pitchMax);
      } else {
        this.yaw = ang.yaw;
        this.pitch = clamp(pitch, -pr.pitchMax, pr.pitchMax);
      }
      if (me.exposure >= FIRE_EXPOSURE && !reloading && loaded && t + 1 >= me.nextFireAt) {
        let shoot: boolean;
        if (w.fireKind === 'projectile') shoot = w.splash ? true : isExposed(e1);
        else {
          // only pull the trigger if this exact shot hits their head with nothing in the way
          const d = dirFromYawPitch(this.yaw, this.pitch);
          const h = rayHitbox(eye, d, hb);
          shoot = !!h?.head && arena.raycast(eye, d, h.t) === Infinity;
        }
        if (shoot) this.pull(cmd, me, t);
      }
    }
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;
    cmd.stand = this.up;
    cmd.presses = this.presses;
    cmd.reloads = this.reloads;
    cmd.zoom = w.zoom.length && q ? 1 : 0;
    return cmd;
  }

  /**
   * Use what's in the inventory: the Super Soaker at once, buffs after a moment, power-up weapons once there's
   * someone to use them on (or after a while anyway). Spring Jumps are maybeSpring's. One per tick at most.
   */
  private maybeUsePowerup(m: MatchState, me: PlayerState, cmd: PlayerCommand) {
    const t = m.tick;
    const jerry = this.profile.mode === 'jerry';
    for (const id of this.useAt.keys()) if (!invCount(me, id)) this.useAt.delete(id);
    for (const it of me.inv) {
      const def = POWERUPS[it.id];
      if (def.held) continue;
      let at = this.useAt.get(it.id);
      if (at === undefined) {
        at = t + (jerry || it.id === 'sauce' ? 6 : secToTicks(this.rng.range(0.5, 3)));
        this.useAt.set(it.id, at);
      }
      if (t < at) continue;
      if (def.weapon) {
        // one power-up weapon at a time; the others wait for a target (or a few seconds)
        if (me.weaponUntil > t) continue;
        if (it.id !== 'sauce' && !jerry && this.target < 0 && t < at + secToTicks(8)) continue;
      }
      this.uses++;
      cmd.uses = this.uses;
      cmd.useId = it.id;
      // the next one of this kind (if any) after another pause
      this.useAt.set(it.id, t + secToTicks(jerry ? 0.2 : this.rng.range(1, 4)));
      return;
    }
  }

  /** Use a Spring Jump from the inventory (the sim only needs the launch counter; humans press Use or double-press Jump). */
  private maybeSpring(m: MatchState, arena: Arena, me: PlayerState) {
    const t = m.tick;
    if (invCount(me, 'spring') <= 0 || inFlight(me.springAt, t)) {
      this.springSeen = -1;
      return;
    }
    if (this.springSeen < 0) {
      this.springSeen = t;
      this.springWait = secToTicks(this.rng.range(2, 8));
    }
    const held = t - this.springSeen;
    let go: boolean;
    if (this.profile.springUse === 'now') go = held > 6;
    else if (this.profile.springUse === 'random') go = held >= this.springWait;
    else {
      // nobody to shoot for a while, but someone is ducked within reach: go look down into their hole
      const mine = arena.holes[me.hole]!;
      const idle = t - this.lastTargetAt > secToTicks(1.5);
      const ducked = m.players.some((q) => {
        if (!q || q === me || !onField(q) || isExposed(q.exposure)) return false;
        const h = arena.holes[q.hole]!;
        const d = Math.hypot(h.x - mine.x, h.z - mine.z);
        return d > 8 && d < 35;
      });
      go = (idle && ducked) || held > secToTicks(12);
    }
    if (go) this.springs++;
  }

  /** Every enemy whose head would be visible once they stand: exposed first, then about to pop up, then nearest. */
  private pickWallhack(m: MatchState, arena: Arena, me: PlayerState, eye: V3): number {
    let best = -1;
    let bestScore = Infinity;
    for (const q of m.players) {
      if (!q || q === me || !onField(q)) continue;
      const head = playerHitbox(m, arena, q, 1, me).head;
      if (!arena.lineClear(eye, head, 0.4)) continue;
      const rising = q.wantStand || q.forcedStandUntil > m.tick;
      const sc = dist(eye, head) * 0.01 + (isExposed(q.exposure) ? 0 : rising ? 10 : 20) - (m.leader === q.slot ? 0.5 : 0);
      if (sc < bestScore) {
        bestScore = sc;
        best = q.slot;
      }
    }
    return best;
  }

  private get leads(): boolean {
    return this.rng.next() < this.profile.leadSkill;
  }

  private pickTarget(m: MatchState, arena: Arena, me: PlayerState, eye: V3) {
    const pr = this.profile;
    const t = m.tick;
    const cur = this.target >= 0 ? m.players[this.target] : null;
    // keep a live target that is still visible
    if (cur && onField(cur) && isExposed(cur.exposure) && arena.lineClear(eye, playerHitbox(m, arena, cur).head, 0.4)) return;
    let best = -1;
    let bestScore = Infinity;
    const flying = inFlight(me.springAt, t);
    for (const q of m.players) {
      if (!q || q === me || !onField(q) || (!isExposed(q.exposure) && !flying)) continue;
      const head = playerHitbox(m, arena, q).head;
      const d = dist(eye, head);
      const ang = yawPitchOf({ x: head.x - eye.x, y: head.y - eye.y, z: head.z - eye.z });
      const off = Math.abs(angleDiff(ang.yaw, this.yaw));
      const isThreat = q.slot === this.threat && t - this.threatAt < secToTicks(3);
      if (off > (pr.fovDeg / 2) * D2R && !isThreat) continue;
      if (isCamo(m, q) && !this.rng.chance(pr.camoDetect * 0.25)) continue;
      if (!arena.lineClear(eye, head, 0.4)) continue;
      const sc = d * 0.5 + off * 20 - (isThreat ? 25 : 0) - (m.leader === q.slot ? 5 : 0);
      if (sc < bestScore) {
        bestScore = sc;
        best = q.slot;
      }
    }
    if (best !== this.target) {
      this.target = best;
      this.targetOrb = -1;
      if (best >= 0) {
        this.acquiredAt = t;
        this.reactUntil = t + secToTicks(pr.reaction * this.rng.range(0.7, 1.3));
        this.aimHead = this.rng.chance(pr.headChance);
        this.errNext = t;
      }
    }
    if (this.target < 0 && m.orbs.length && this.rng.chance(pr.orbInterest * 0.25 * 4)) {
      const orb = this.rng.pick(m.orbs);
      if (arena.lineClear(eye, orbPos(orb, t, arena), 0.9)) {
        this.targetOrb = orb.id;
        this.acquiredAt = t;
        this.reactUntil = t + secToTicks(pr.reaction);
        this.errNext = t;
      }
    }
  }
}
