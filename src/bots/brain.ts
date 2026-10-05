import { Rng } from '../shared/rng';
import { angleDiff, clamp, dist, yawPitchOf, type V3 } from '../shared/vec';
import type { Arena } from '../sim/arena';
import { DT, FIRE_EXPOSURE, TICK_RATE, secToTicks } from '../sim/constants';
import { eyePos, isExposed } from '../sim/hitbox';
import { clipSize, isCamo, playerHitbox } from '../sim/match';
import { orbPos } from '../sim/orbs';
import type { BotDifficulty, MatchState, PlayerCommand, PlayerState, SimEvent } from '../sim/types';
import { WEAPONS } from '../sim/weapons';

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
}

export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  recruit: { label: 'Recruit', reaction: 0.85, aimSigma0: 5, aimTau: 0.6, aimSigmaMin: 1.4, turnRate: 120, headChance: 0.15, fireTol: 2.0, stand: [2.5, 4.5], duck: [1.5, 4], duckOnShieldBreak: 0.25, leadSkill: 0.4, orbInterest: 0.05, camoDetect: 0.2, fovDeg: 100 },
  normal: { label: 'Normal', reaction: 0.55, aimSigma0: 3.5, aimTau: 0.4, aimSigmaMin: 0.7, turnRate: 200, headChance: 0.35, fireTol: 1.4, stand: [2, 3.5], duck: [1.2, 3], duckOnShieldBreak: 0.55, leadSkill: 0.7, orbInterest: 0.15, camoDetect: 0.35, fovDeg: 120 },
  heroic: { label: 'Heroic', reaction: 0.38, aimSigma0: 2.5, aimTau: 0.28, aimSigmaMin: 0.35, turnRate: 300, headChance: 0.6, fireTol: 1.1, stand: [1.5, 3], duck: [0.8, 2.2], duckOnShieldBreak: 0.85, leadSkill: 0.9, orbInterest: 0.3, camoDetect: 0.5, fovDeg: 140 },
  legendary: { label: 'Legendary', reaction: 0.24, aimSigma0: 1.8, aimTau: 0.18, aimSigmaMin: 0.15, turnRate: 420, headChance: 0.85, fireTol: 0.9, stand: [1, 2.5], duck: [0.6, 1.6], duckOnShieldBreak: 1, leadSkill: 1, orbInterest: 0.5, camoDetect: 0.7, fovDeg: 160 },
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
    const cmd: PlayerCommand = { yaw: this.yaw, pitch: this.pitch, stand: false, trigger: false, presses: this.presses, reloads: this.reloads, respawns: 0, zoom: 0, vt: t };
    if (!me.alive) {
      this.up = false;
      this.target = -1;
      return cmd;
    }
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
    const eye = eyePos(arena.holes[me.hole]!, Math.max(me.exposure, FIRE_EXPOSURE));
    if (t >= this.nextScan) {
      this.nextScan = t + 12 + this.rng.int(0, 6);
      this.pickTarget(m, arena, me, eye);
    }

    // --- aiming -----------------------------------------------------------------------------
    let aimPoint: V3 | null = null;
    let tolRad = 0;
    const tgt = this.target >= 0 ? m.players[this.target] : null;
    if (tgt && tgt.alive) {
      const hb = playerHitbox(m, arena, tgt, Math.max(tgt.exposure, 0.3), me);
      if (w.splash) {
        // aim at the rim for splash weapons (or into the hole for lobbed grenades)
        aimPoint = w.projectile?.bounce ? { x: hb.head.x, y: hb.rim - 0.2, z: hb.head.z } : { x: hb.torsoA.x, y: Math.max(hb.rim + 0.1, hb.torsoA.y + 0.2), z: hb.torsoA.z };
        tolRad = (1.2 / Math.max(1, dist(eye, aimPoint))) * pr.fireTol;
      } else if (this.aimHead) {
        aimPoint = hb.head;
        tolRad = (hb.headR / Math.max(1, dist(eye, aimPoint))) * pr.fireTol;
      } else {
        aimPoint = { x: hb.torsoB.x, y: hb.torsoB.y - 0.1, z: hb.torsoB.z };
        tolRad = (hb.torsoR / Math.max(1, dist(eye, aimPoint))) * pr.fireTol;
      }
      if (!isExposed(tgt.exposure) && !w.projectile?.bounce) tolRad = 0; // wait for them to pop up
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
        if (p !== null) wantPitch = p;
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
    const maxTurn = pr.turnRate * D2R * DT;
    const dyaw = angleDiff(wantYaw, this.yaw);
    this.yaw += clamp(dyaw, -maxTurn, maxTurn);
    this.pitch += clamp(wantPitch - this.pitch, -maxTurn, maxTurn);
    this.pitch = clamp(this.pitch, -1.2, 1.2);

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
    cmd.zoom = w.zoom.length && this.target >= 0 ? 1 : 0;
    return cmd;
  }

  private get leads(): boolean {
    return this.rng.next() < this.profile.leadSkill;
  }

  private pickTarget(m: MatchState, arena: Arena, me: PlayerState, eye: V3) {
    const pr = this.profile;
    const t = m.tick;
    const cur = this.target >= 0 ? m.players[this.target] : null;
    // keep a live target that is still visible
    if (cur && cur.alive && isExposed(cur.exposure) && arena.lineClear(eye, playerHitbox(m, arena, cur).head, 0.4)) return;
    let best = -1;
    let bestScore = Infinity;
    for (const q of m.players) {
      if (!q || q === me || !q.alive || !isExposed(q.exposure)) continue;
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
