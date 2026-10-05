import { Rng } from '../shared/rng';
import { angleBetween, clamp, dirFromYawPitch, dist, norm, spreadDir, sub, type V3 } from '../shared/vec';
import type { Arena } from './arena';
import { MOUTH_R } from './arena';
import {
  DT,
  FIRE_EXPOSURE,
  HEALTH_MAX,
  HEALTH_RATE,
  HIDDEN_EXPOSURE,
  HISTORY,
  LOWER_TIME,
  MULTIKILL_WINDOW,
  RECHARGE_DELAY,
  RISE_TIME,
  SHIELD_MAX,
  SHIELD_RATE,
  TICK_RATE,
  secToTicks,
  MAX_SLOTS,
} from './constants';
import { pointSegmentDist, raySphere } from './geom';
import { eyePos, hitboxOf, isExposed, rayHitbox, type Hitbox } from './hitbox';
import { ORB_R, ORB_RATES, orbPos } from './orbs';
import { POWERUPS, type PowerUpId } from './powerups';
import type { Settings } from './settings';
import type {
  HitKind,
  MatchState,
  PlayerCommand,
  PlayerState,
  Projectile,
  RosterEntry,
  SimEvent,
  Vec3T,
} from './types';
import { WEAPONS, type WeaponDef, type WeaponId } from './weapons';

const INTRO_SEC = 3;
const V = (v: V3): Vec3T => [round2(v.x), round2(v.y), round2(v.z)];
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------

export function createMatch(settings: Settings, roster: RosterEntry[], seed: number, arena: Arena): MatchState {
  const rng = new Rng(seed);
  const count = arena.activeHoleCount(roster.length);
  const activeHoles = arena.holes.slice(0, count).map((h) => h.id);
  const m: MatchState = {
    tick: 0,
    phase: 'intro',
    liveAt: secToTicks(INTRO_SEC),
    endAt: 0,
    seed,
    settings,
    activeHoles,
    players: new Array(MAX_SLOTS).fill(null),
    projectiles: [],
    nextId: 1,
    orbs: [],
    nextOrbAt: 0,
    strikes: [],
    history: new Uint8Array(MAX_SLOTS * HISTORY),
    leader: -1,
    winner: -1,
    rng: rng.state,
    announced: {},
  };
  const rate = ORB_RATES[settings.orbRate];
  m.nextOrbAt = rate.interval > 0 ? m.liveAt + secToTicks(rate.first) : Infinity;
  const holes = shuffle([...activeHoles], rng);
  roster.forEach((r, i) => {
    const p = newPlayer(m, r, holes[i % holes.length]!);
    m.players[r.slot] = p;
  });
  m.rng = rng.state;
  for (const p of m.players) if (p) spawnPlayer(m, p, p.hole, null);
  return m;
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function newPlayer(m: MatchState, r: RosterEntry, hole: number): PlayerState {
  return {
    slot: r.slot,
    name: r.name,
    color: r.color,
    kind: r.kind,
    bot: r.bot,
    connected: true,
    hole,
    alive: false,
    respawnAt: 0,
    spawnTick: 0,
    exposure: 0,
    wantStand: false,
    duckedSince: 0,
    exposedSince: -1,
    forcedStandUntil: 0,
    yaw: 0,
    pitch: 0,
    zoom: 0,
    shield: SHIELD_MAX,
    shieldMax: SHIELD_MAX,
    health: HEALTH_MAX,
    healthMax: HEALTH_MAX,
    overshield: 0,
    rechargeAt: 0,
    weapon: m.settings.weapon,
    baseWeapon: m.settings.weapon,
    baseClip: 0,
    weaponUntil: 0,
    clip: 0,
    reloadUntil: 0,
    nextFireAt: 0,
    chargeStart: -1,
    needRelease: false,
    beamUntil: 0,
    beamLen: 0,
    beamHit: false,
    burstLeft: 0,
    nextBurstAt: 0,
    spin: 0,
    trigger: false,
    presses: 0,
    reloads: 0,
    respawns: 0,
    respawnRequested: false,
    pressAt: -1,
    powerups: [],
    underdogUntil: 0,
    revealUntil: 0,
    needles: [],
    burn: null,
    kills: 0,
    deaths: 0,
    streak: 0,
    bestStreak: 0,
    deathStreak: 0,
    multi: 0,
    lastKillTick: -9999,
    gunLevel: 0,
    lastKiller: -1,
    pick: null,
    vt: 0,
    shots: 0,
    hits: 0,
    headshots: 0,
    medals: {},
    lastHitBy: -1,
  };
}

/** Add a late joiner (or re-add). */
export function addPlayer(m: MatchState, r: RosterEntry, arena: Arena): PlayerState {
  const rng = new Rng(m.rng);
  const hole = pickHole(m, arena, rng, -1);
  m.rng = rng.state;
  const p = newPlayer(m, r, hole);
  m.players[r.slot] = p;
  spawnPlayer(m, p, hole, null);
  return p;
}

export function removePlayer(m: MatchState, slot: number): void {
  m.players[slot] = null;
  m.projectiles = m.projectiles.filter((pr) => pr.owner !== slot);
  if (m.leader === slot) m.leader = -1;
  recomputeLeader(m, []);
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

export function score(m: MatchState, p: PlayerState): number {
  return m.settings.weaponMode === 'gunGame' ? p.gunLevel : p.kills;
}

export function hasPowerup(p: PlayerState, id: PowerUpId, tick: number): boolean {
  return p.powerups.some((x) => x.id === id && x.until > tick);
}

export function clipSize(m: MatchState, w: WeaponDef): number {
  if (w.clip <= 0) return 0;
  return Math.max(1, Math.round(w.clip * m.settings.clipMult));
}

function reloadTicks(m: MatchState, p: PlayerState, w: WeaponDef): number {
  const quick = hasPowerup(p, 'quickhands', m.tick) ? 1 / 3 : 1;
  return Math.max(1, secToTicks(w.reload * m.settings.reloadMult * quick));
}

function intervalTicks(m: MatchState, p: PlayerState, sec: number): number {
  const quick = hasPowerup(p, 'quickhands', m.tick) ? 1 / 1.5 : 1;
  return Math.max(1, Math.round(sec * TICK_RATE * quick));
}

export function exposureAt(m: MatchState, slot: number, tick: number): number {
  if (tick >= m.tick) return m.players[slot]?.exposure ?? 0;
  return m.history[slot * HISTORY + (((tick % HISTORY) + HISTORY) % HISTORY)]! / 255;
}

function headScaleFor(m: MatchState, shooter: PlayerState | null): number {
  let s = m.settings.skulls.includes('bighead') ? 2 : 1;
  if (shooter && hasPowerup(shooter, 'bighead', m.tick)) s *= 2.2;
  return s;
}

export function playerHitbox(m: MatchState, arena: Arena, p: PlayerState, exposure = p.exposure, shooter: PlayerState | null = null): Hitbox {
  return hitboxOf(arena.holes[p.hole]!, exposure, headScaleFor(m, shooter));
}

function pickHole(m: MatchState, arena: Arena, rng: Rng, prefer: number): number {
  const used = new Set<number>();
  for (const p of m.players) if (p && (p.alive || p.respawnAt > m.tick)) used.add(p.hole);
  if (prefer >= 0 && !used.has(prefer)) return prefer;
  const free = m.activeHoles.filter((h) => !used.has(h));
  if (free.length) return rng.pick(free);
  // arena full: grow into spare holes
  const spare = arena.holes.map((h) => h.id).filter((h) => !used.has(h));
  return spare.length ? spare[0]! : m.activeHoles[0]!;
}

function weaponForLife(m: MatchState, p: PlayerState, rng: Rng): WeaponId {
  const s = m.settings;
  switch (s.weaponMode) {
    case 'fixed':
      return s.weapon;
    case 'choice':
      return p.pick && s.allowedWeapons.includes(p.pick) ? p.pick : s.allowedWeapons[0] ?? s.weapon;
    case 'randomLife':
      return rng.pick(s.allowedWeapons.length ? s.allowedWeapons : [s.weapon]);
    case 'gunGame':
      return s.gunGameOrder[Math.min(p.gunLevel, s.gunGameOrder.length - 1)] ?? s.weapon;
  }
}

function equip(m: MatchState, p: PlayerState, w: WeaponId) {
  p.weapon = w;
  p.baseWeapon = w;
  p.weaponUntil = 0;
  p.clip = clipSize(m, WEAPONS[w]);
  p.reloadUntil = 0;
  p.chargeStart = -1;
  p.beamUntil = 0;
  p.burstLeft = 0;
  p.spin = 0;
}

function spawnPlayer(m: MatchState, p: PlayerState, hole: number, events: SimEvent[] | null) {
  const s = m.settings;
  const rng = new Rng(m.rng);
  p.hole = hole;
  p.alive = true;
  p.respawnRequested = false;
  p.spawnTick = m.tick;
  p.exposure = 0;
  p.wantStand = false;
  p.duckedSince = m.tick;
  p.exposedSince = -1;
  p.forcedStandUntil = 0;
  const mythic = s.skulls.includes('mythic') ? 2 : 1;
  p.shieldMax = (s.shields === 'off' ? 0 : s.shields === 'double' ? SHIELD_MAX * 2 : SHIELD_MAX) * mythic;
  p.healthMax = HEALTH_MAX * mythic;
  p.shield = p.shieldMax;
  p.health = p.healthMax;
  p.overshield = 0;
  p.rechargeAt = 0;
  p.powerups = [];
  p.needles = [];
  p.burn = null;
  p.revealUntil = 0;
  p.lastHitBy = -1;
  equip(m, p, weaponForLife(m, p, rng));
  // underdog camo for players who are struggling
  p.underdogUntil = 0;
  if (s.underdogCamo && m.tick > 0) {
    const leader = m.leader >= 0 ? m.players[m.leader] : null;
    const gap = leader && leader !== p ? score(m, leader) - score(m, p) : 0;
    const byGap = s.underdogKillGap > 0 && gap >= s.underdogKillGap;
    const byStreak = s.underdogDeathStreak > 0 && p.deathStreak >= s.underdogDeathStreak;
    if (byGap || byStreak) p.underdogUntil = m.tick + secToTicks(20);
  }
  m.rng = rng.state;
  events?.push({ k: 'spawn', t: m.tick, p: p.slot, hole });
}

export function isCamo(m: MatchState, p: PlayerState): boolean {
  if (p.revealUntil > m.tick) return false;
  return p.underdogUntil > m.tick || hasPowerup(p, 'camo', m.tick);
}

// ---------------------------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------------------------

export interface StepContext {
  arena: Arena;
  rng: Rng;
  events: SimEvent[];
}

/**
 * Advance the match one fixed tick. `cmds[slot]` is the latest command of each player (may be undefined).
 * Returns the events generated during the tick.
 */
export function stepMatch(m: MatchState, cmds: (PlayerCommand | undefined)[], arena: Arena): SimEvent[] {
  const events: SimEvent[] = [];
  const rng = new Rng(m.rng);
  const ctx: StepContext = { arena, rng, events };
  m.tick++;
  const t = m.tick;

  if (m.phase === 'intro' && t >= m.liveAt) {
    m.phase = 'live';
    events.push({ k: 'ann', t, key: 'ann.slay', p: -1 });
  }
  const frozen = m.phase === 'ended';

  // 1. commands + respawns + stance
  for (const p of m.players) {
    if (!p) continue;
    const c = cmds[p.slot];
    if (c) applyCommand(m, p, c);
    if (!p.alive) {
      if (!frozen && t >= p.respawnAt && p.connected && (p.kind === 'bot' || m.settings.respawnMode === 'auto' || p.respawnRequested)) {
        const hole = pickHole(m, arena, rng, m.settings.respawnHole === 'same' ? p.hole : -1);
        m.rng = rng.state;
        spawnPlayer(m, p, hole, events);
        rng.state = m.rng;
      }
    }
    if (p.alive) updateStance(m, p, events, frozen);
    m.history[p.slot * HISTORY + (t % HISTORY)] = p.alive ? Math.round(p.exposure * 255) : 0;
  }

  if (!frozen) {
    // 2. vitals & timers
    for (const p of m.players) if (p?.alive) updateVitals(m, p, ctx);
    // 3. weapons
    for (const p of m.players) if (p?.alive) updateWeapon(m, p, cmds[p.slot], ctx);
    // 4. projectiles, strikes, orbs
    stepProjectiles(m, ctx);
    stepStrikes(m, ctx);
    stepOrbs(m, ctx);
    // 5. end conditions & announcements
    checkEnd(m, ctx);
  }
  m.rng = rng.state;
  return events;
}

function applyCommand(m: MatchState, p: PlayerState, c: PlayerCommand) {
  if (Number.isFinite(c.yaw)) p.yaw = c.yaw;
  if (Number.isFinite(c.pitch)) p.pitch = clamp(c.pitch, -1.45, 1.45);
  p.wantStand = !!c.stand;
  p.zoom = clamp(c.zoom | 0, 0, 3);
  p.vt = Number.isFinite(c.vt) ? c.vt : m.tick;
  if (c.pick && WEAPONS[c.pick] && !WEAPONS[c.pick].powerupOnly) p.pick = c.pick;
  const newPresses = (c.presses | 0) - p.presses;
  if (newPresses > 0 && newPresses < 1000) p.pressAt = m.tick;
  p.presses = c.presses | 0;
  const newReloads = (c.reloads | 0) - p.reloads;
  p.reloads = c.reloads | 0;
  if (newReloads > 0 && newReloads < 1000 && p.alive) requestReload(m, p);
  const newRespawns = (c.respawns | 0) - p.respawns;
  p.respawns = c.respawns | 0;
  if (newRespawns > 0 && newRespawns < 1000 && !p.alive) p.respawnRequested = true;
  p.trigger = !!c.trigger;
}

function updateStance(m: MatchState, p: PlayerState, events: SimEvent[], frozen: boolean) {
  const t = m.tick;
  const s = m.settings;
  let want = p.wantStand;
  if (p.forcedStandUntil > t) want = true;
  if (frozen) want = false;
  const before = p.exposure;
  if (want) p.exposure = Math.min(1, p.exposure + DT / RISE_TIME);
  else p.exposure = Math.max(0, p.exposure - DT / LOWER_TIME);
  if (!isExposed(before) && isExposed(p.exposure)) p.exposedSince = t;
  if (!isExposed(p.exposure)) p.exposedSince = -1;
  // anti-turtle
  if (p.exposure <= HIDDEN_EXPOSURE) {
    if (p.duckedSince < 0 || m.phase !== 'live') p.duckedSince = t;
  } else p.duckedSince = -1;
  if (s.antiTurtleSec > 0 && m.phase === 'live' && p.duckedSince >= 0 && p.forcedStandUntil <= t) {
    if (t - p.duckedSince >= secToTicks(s.antiTurtleSec)) {
      p.forcedStandUntil = t + secToTicks(2);
      p.duckedSince = -1;
      events.push({ k: 'forced', t, p: p.slot });
    }
  }
}

function updateVitals(m: MatchState, p: PlayerState, ctx: StepContext) {
  const t = m.tick;
  // power-up expiry
  if (p.powerups.length) p.powerups = p.powerups.filter((x) => x.until > t);
  if (p.weaponUntil && t >= p.weaponUntil) restoreWeapon(m, p);
  if (p.overshield > 0 && !p.powerups.some((x) => x.id === 'overshield')) p.overshield = 0;
  if (p.underdogUntil && p.underdogUntil <= t) p.underdogUntil = 0;
  // regen
  const blackeye = m.settings.skulls.includes('blackeye');
  if (t >= p.rechargeAt) {
    if (p.shield < p.shieldMax && !blackeye) p.shield = Math.min(p.shieldMax, p.shield + SHIELD_RATE * DT);
    if ((p.shield >= p.shieldMax || blackeye) && p.health < p.healthMax) p.health = Math.min(p.healthMax, p.health + HEALTH_RATE * DT);
  }
  // burn damage (applied in chunks to keep events low)
  if (p.burn) {
    if (t >= p.burn.until) p.burn = null;
    else if (t >= p.burn.next) {
      p.burn.next = t + 15;
      damagePlayer(m, ctx, p.burn.by, p, p.burn.dps * 0.25, { head: false, weapon: 'flamethrower', kind: 'burn' });
    }
  }
  // needles expire
  if (p.needles.length) {
    const w = WEAPONS.needler.projectile!.stick!;
    p.needles = p.needles.filter((n) => t - n.tick < secToTicks(w.window));
  }
}

function restoreWeapon(m: MatchState, p: PlayerState) {
  const cur = p.weapon;
  p.powerups = p.powerups.filter((x) => POWERUPS[x.id].weapon !== cur);
  p.weapon = p.baseWeapon;
  p.clip = p.baseClip;
  p.weaponUntil = 0;
  p.reloadUntil = 0;
  p.chargeStart = -1;
  p.beamUntil = 0;
  p.burstLeft = 0;
  p.spin = 0;
  p.nextFireAt = Math.max(p.nextFireAt, m.tick + 10);
}

function requestReload(m: MatchState, p: PlayerState) {
  const w = WEAPONS[p.weapon];
  if (m.settings.ammoMode === 'noReload' || w.clip <= 0) return;
  if (p.reloadUntil > m.tick) return;
  if (p.clip >= clipSize(m, w)) return;
  p.reloadUntil = m.tick + reloadTicks(m, p, w);
  p.chargeStart = -1;
  p.beamUntil = 0;
  p.burstLeft = 0;
}

function updateWeapon(m: MatchState, p: PlayerState, c: PlayerCommand | undefined, ctx: StepContext) {
  const t = m.tick;
  const w = WEAPONS[p.weapon];
  const live = m.phase === 'live';
  // finish reload
  if (p.reloadUntil && t >= p.reloadUntil) {
    p.reloadUntil = 0;
    p.clip = clipSize(m, w);
    ctx.events.push({ k: 'reload', t, p: p.slot });
  }
  const reloading = p.reloadUntil > t;
  const infinite = m.settings.ammoMode === 'noReload' || w.clip <= 0;
  const hasAmmo = infinite || p.clip > 0;
  if (!hasAmmo && !reloading && p.beamUntil <= t) requestReload(m, p);
  const up = p.exposure >= FIRE_EXPOSURE;
  const canShoot = live && up && !reloading && hasAmmo;
  const trigger = !!c?.trigger || p.trigger;
  const pressed = p.pressAt >= 0 && t - p.pressAt <= 12;

  switch (w.trigger) {
    case 'semi':
      if (pressed && canShoot && t >= p.nextFireAt) {
        p.pressAt = -1;
        fire(m, p, w, ctx);
        p.nextFireAt = t + intervalTicks(m, p, w.interval);
      }
      break;
    case 'auto': {
      if (trigger && up && live) p.spin = Math.min((w.spinUp ?? 0) + 0.5, p.spin + DT);
      else p.spin = Math.max(0, p.spin - DT * 2);
      if (trigger && canShoot && t >= p.nextFireAt && p.spin >= (w.spinUp ?? 0)) {
        fire(m, p, w, ctx);
        p.nextFireAt = t + intervalTicks(m, p, w.interval);
      }
      break;
    }
    case 'burst': {
      const b = w.burst!;
      if (p.burstLeft > 0) {
        if (!canShoot) p.burstLeft = 0;
        else if (t >= p.nextBurstAt) {
          fire(m, p, w, ctx);
          p.burstLeft--;
          p.nextBurstAt = t + intervalTicks(m, p, b.gap);
        }
      } else if (pressed && canShoot && t >= p.nextFireAt) {
        p.pressAt = -1;
        fire(m, p, w, ctx);
        p.burstLeft = b.count - 1;
        p.nextBurstAt = t + intervalTicks(m, p, b.gap);
        p.nextFireAt = t + intervalTicks(m, p, w.interval);
      }
      break;
    }
    case 'charge': {
      if (!trigger) p.needRelease = false;
      if (trigger && canShoot && !p.needRelease && t >= p.nextFireAt) {
        if (p.chargeStart < 0) p.chargeStart = t;
        if (t - p.chargeStart >= secToTicks(w.chargeTime ?? 0)) {
          fire(m, p, w, ctx);
          p.chargeStart = -1;
          p.needRelease = true;
          p.nextFireAt = t + intervalTicks(m, p, w.interval);
        }
      } else p.chargeStart = -1;
      break;
    }
    case 'beam': {
      if (p.beamUntil > t) {
        if (!up || !live) {
          p.beamUntil = 0;
          p.beamLen = 0;
          p.nextFireAt = t + intervalTicks(m, p, w.interval);
        } else if ((t - p.beamUntil) % 6 === 0) {
          beamTick(m, p, w, ctx, 0.1);
        }
      } else {
        p.beamLen = 0;
        if (trigger && canShoot && t >= p.nextFireAt) {
          if (p.chargeStart < 0) p.chargeStart = t;
          if (t - p.chargeStart >= secToTicks(w.chargeTime ?? 0)) {
            p.chargeStart = -1;
            p.beamUntil = t + secToTicks(w.beamTime ?? 1);
            p.beamHit = false;
            consumeAmmo(m, p, w);
            p.shots++;
            p.revealUntil = t + TICK_RATE;
            ctx.events.push({ k: 'fire', t, p: p.slot, w: w.id, o: V(eyePos(ctx.arena.holes[p.hole]!, p.exposure)), e: [0, 0, 0], hit: 'none' });
            beamTick(m, p, w, ctx, 0.1);
          }
        } else p.chargeStart = -1;
      }
      break;
    }
  }
}

function consumeAmmo(m: MatchState, p: PlayerState, w: WeaponDef) {
  if (m.settings.ammoMode === 'noReload' || w.clip <= 0) return;
  p.clip = Math.max(0, p.clip - 1);
}

export function aimDir(p: PlayerState): V3 {
  return dirFromYawPitch(p.yaw, p.pitch);
}

/** Pick a homing target: exposed enemy head nearest to the aim direction within the cone. */
function findHomingTarget(m: MatchState, arena: Arena, p: PlayerState, origin: V3, dir: V3, coneRad: number, range: number): PlayerState | null {
  let best: PlayerState | null = null;
  let bestAng = coneRad;
  for (const q of m.players) {
    if (!q || q === p || !q.alive || !isExposed(q.exposure)) continue;
    const hb = playerHitbox(m, arena, q, q.exposure, p);
    const to = sub(hb.head, origin);
    const d = Math.hypot(to.x, to.y, to.z);
    if (d > range) continue;
    const ang = angleBetween(dir, norm(to));
    if (ang < bestAng && arena.lineClear(origin, hb.head, 0.4)) {
      bestAng = ang;
      best = q;
    }
  }
  return best;
}

function fire(m: MatchState, p: PlayerState, w: WeaponDef, ctx: StepContext) {
  const t = m.tick;
  const { arena, rng } = ctx;
  const hole = arena.holes[p.hole]!;
  const origin = eyePos(hole, p.exposure);
  let dir = aimDir(p);
  consumeAmmo(m, p, w);
  p.shots++;
  p.revealUntil = t + TICK_RATE;
  if (w.fireKind === 'hitscan') {
    if (hasPowerup(p, 'homing', t)) {
      const q = findHomingTarget(m, arena, p, origin, dir, (5 * Math.PI) / 180, w.range);
      if (q) dir = norm(sub(playerHitbox(m, arena, q, q.exposure, p).head, origin));
    }
    const pellets = w.pellets ?? 1;
    for (let i = 0; i < pellets; i++) {
      const d = spreadDir(dir, (w.spreadDeg * Math.PI) / 180, rng.next(), rng.next());
      hitscan(m, p, w, origin, d, ctx);
    }
  } else {
    const def = w.projectile!;
    const d = spreadDir(dir, (w.spreadDeg * Math.PI) / 180, rng.next(), rng.next());
    let target = -1;
    if (def.homing) {
      const q = findHomingTarget(m, arena, p, origin, d, (def.homing.coneDeg * Math.PI) / 180, def.homing.range);
      if (q) target = q.slot;
    }
    const pr: Projectile = {
      id: m.nextId++,
      owner: p.slot,
      weapon: w.id,
      x: origin.x + d.x * 0.6,
      y: origin.y + d.y * 0.6 - 0.1,
      z: origin.z + d.z * 0.6,
      vx: d.x * def.speed,
      vy: d.y * def.speed,
      vz: d.z * def.speed,
      born: t,
      bounces: 0,
      target,
      fuseAt: def.fuse ? t + secToTicks(def.fuse) : 0,
    };
    m.projectiles.push(pr);
    ctx.events.push({ k: 'proj', t, id: pr.id, p: p.slot, w: w.id, pos: [pr.x, pr.y, pr.z].map(round2) as Vec3T, vel: [pr.vx, pr.vy, pr.vz].map(round2) as Vec3T, tgt: target });
  }
}

interface TraceHit {
  t: number;
  kind: 'player' | 'orb';
  slot?: number;
  head?: boolean;
  orb?: number;
}

/** Trace a ray against players (rewound to the shooter's view tick), orbs and terrain. */
export function traceRay(m: MatchState, arena: Arena, shooter: PlayerState | null, o: V3, d: V3, range: number, rewindTick: number): { hits: TraceHit[]; world: number } {
  const world = Math.min(range, arena.raycast(o, d, range));
  const hits: TraceHit[] = [];
  for (const q of m.players) {
    if (!q || q === shooter || !q.alive) continue;
    const e = exposureAt(m, q.slot, rewindTick);
    if (e <= 0.001) continue;
    const hb = playerHitbox(m, arena, q, e, shooter);
    const h = rayHitbox(o, d, hb);
    if (h && h.t < world) hits.push({ t: h.t, kind: 'player', slot: q.slot, head: h.head });
  }
  for (const orb of m.orbs) {
    const c = orbPos(orb, m.tick, arena);
    const to = raySphere(o, d, c, ORB_R);
    if (to >= 0 && to < world) hits.push({ t: to, kind: 'orb', orb: orb.id });
  }
  hits.sort((a, b) => a.t - b.t);
  return { hits, world };
}

function rewindTickFor(m: MatchState, p: PlayerState): number {
  if (p.kind === 'bot') return m.tick;
  const maxBack = Math.round((m.settings.maxRewindMs / 1000) * TICK_RATE);
  return clamp(Math.round(p.vt), m.tick - Math.min(maxBack, HISTORY - 2), m.tick);
}

function hitscan(m: MatchState, p: PlayerState, w: WeaponDef, o: V3, d: V3, ctx: StepContext) {
  const t = m.tick;
  const { hits, world } = traceRay(m, ctx.arena, p, o, d, w.range, rewindTickFor(m, p));
  let pierceLeft = w.pierce ?? 1;
  let end = world;
  let hitKind: HitKind = world < w.range ? 'world' : 'none';
  let anyHit = false;
  for (const h of hits) {
    if (h.kind === 'orb') {
      claimOrb(m, ctx, h.orb!, p);
      end = h.t;
      hitKind = 'orb';
      if (!w.pierce) break;
      continue;
    }
    const q = m.players[h.slot!]!;
    if (!w.strike) {
      if (!anyHit) p.hits++;
      anyHit = true;
      damagePlayer(m, ctx, p.slot, q, w.damage, { head: !!h.head, weapon: w.id, kind: 'direct', headshotKills: w.headshotKills, headMult: w.headMult });
    }
    end = h.t;
    hitKind = h.head ? 'head' : 'body';
    if (--pierceLeft <= 0) break;
  }
  if (w.pierce && pierceLeft > 0) end = world;
  const endPt = { x: o.x + d.x * end, y: o.y + d.y * end, z: o.z + d.z * end };
  if (w.strike) {
    // orbital designator: strike the aimed point
    const st = { id: m.nextId++, owner: p.slot, x: endPt.x, y: endPt.y, z: endPt.z, at: t + secToTicks(w.strike.delay) };
    m.strikes.push(st);
    ctx.events.push({ k: 'strike', t, id: st.id, p: p.slot, pos: V(endPt), at: st.at });
    // one use
    p.weaponUntil = t + 1;
  }
  ctx.events.push({ k: 'fire', t, p: p.slot, w: w.id, o: V(o), e: V(endPt), hit: hitKind });
}

function beamTick(m: MatchState, p: PlayerState, w: WeaponDef, ctx: StepContext, sec: number) {
  const hole = ctx.arena.holes[p.hole]!;
  const o = eyePos(hole, p.exposure);
  const d = aimDir(p);
  const { hits, world } = traceRay(m, ctx.arena, p, o, d, w.range, rewindTickFor(m, p));
  const first = hits[0];
  p.beamLen = first ? first.t : world;
  if (!first) return;
  if (first.kind === 'orb') {
    claimOrb(m, ctx, first.orb!, p);
    return;
  }
  const q = m.players[first.slot!]!;
  if (!p.beamHit) p.hits++;
  p.beamHit = true;
  damagePlayer(m, ctx, p.slot, q, w.damage * sec, { head: !!first.head, weapon: w.id, kind: 'direct', headMult: w.headMult });
}

// ---------------------------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------------------------

/** Pure ballistic/homing integration shared by host & client visuals. */
export function integrateProjectile(pr: Projectile, def: NonNullable<WeaponDef['projectile']>, targetPos: V3 | null) {
  if (def.homing && targetPos) {
    const vx = pr.vx, vy = pr.vy, vz = pr.vz;
    const speed = Math.hypot(vx, vy, vz) || def.speed;
    const cur = { x: vx / speed, y: vy / speed, z: vz / speed };
    const want = norm({ x: targetPos.x - pr.x, y: targetPos.y - pr.y, z: targetPos.z - pr.z });
    const ang = angleBetween(cur, want);
    const maxTurn = def.homing.turnRate * DT;
    const k = ang > 1e-4 ? Math.min(1, maxTurn / ang) : 1;
    const nd = norm({ x: cur.x + (want.x - cur.x) * k, y: cur.y + (want.y - cur.y) * k, z: cur.z + (want.z - cur.z) * k });
    pr.vx = nd.x * speed;
    pr.vy = nd.y * speed;
    pr.vz = nd.z * speed;
  }
  pr.vy -= def.gravity * DT;
  pr.x += pr.vx * DT;
  pr.y += pr.vy * DT;
  pr.z += pr.vz * DT;
}

function terrainNormal(arena: Arena, x: number, z: number): V3 {
  const e = 0.25;
  const hx = arena.solidAt(x + e, z) - arena.solidAt(x - e, z);
  const hz = arena.solidAt(x, z + e) - arena.solidAt(x, z - e);
  return norm({ x: -hx / (2 * e), y: 1, z: -hz / (2 * e) });
}

function stepProjectiles(m: MatchState, ctx: StepContext) {
  const { arena } = ctx;
  const t = m.tick;
  const keep: Projectile[] = [];
  for (const pr of m.projectiles) {
    const w = WEAPONS[pr.weapon];
    const def = w.projectile!;
    const owner = m.players[pr.owner];
    const prev = { x: pr.x, y: pr.y, z: pr.z };
    let targetPos: V3 | null = null;
    if (pr.target >= 0) {
      const q = m.players[pr.target];
      if (q?.alive && isExposed(q.exposure)) targetPos = playerHitbox(m, arena, q).head;
    }
    integrateProjectile(pr, def, targetPos);
    const seg = { x: pr.x - prev.x, y: pr.y - prev.y, z: pr.z - prev.z };
    const L = Math.hypot(seg.x, seg.y, seg.z);
    const d = { x: seg.x / L, y: seg.y / L, z: seg.z / L };
    // nearest collision along the segment
    let bestT = L;
    let hitPlayer: { slot: number; head: boolean } | null = null;
    let hitOrb = -1;
    for (const q of m.players) {
      if (!q || !q.alive || q.exposure <= 0.001) continue;
      if (q.slot === pr.owner && t - pr.born < 20) continue;
      const hb = playerHitbox(m, arena, q, q.exposure, owner ?? null);
      const h = rayHitbox(prev, d, hb, def.radius);
      if (h && h.t < bestT) {
        bestT = h.t;
        hitPlayer = { slot: q.slot, head: h.head };
      }
    }
    for (const orb of m.orbs) {
      const to = raySphere(prev, d, orbPos(orb, t, arena), ORB_R + def.radius);
      if (to >= 0 && to < bestT) {
        bestT = to;
        hitPlayer = null;
        hitOrb = orb.id;
      }
    }
    const tw = arena.raycast(prev, d, bestT);
    const hitWorld = tw < bestT;
    if (hitWorld) {
      bestT = tw;
      hitPlayer = null;
      hitOrb = -1;
    }
    const at = { x: prev.x + d.x * bestT, y: prev.y + d.y * bestT, z: prev.z + d.z * bestT };
    // grenade dropping into a hole mouth
    const hole = arena.nearestHole(at.x, at.z);
    const inMouth = hole && Math.hypot(hole.x - at.x, hole.z - at.z) < MOUTH_R && at.y < hole.rim;
    if (hitOrb >= 0) {
      if (owner) claimOrb(m, ctx, hitOrb, owner);
      endProjectile(m, ctx, pr, at, w, -1);
      continue;
    }
    if (hitPlayer) {
      const q = m.players[hitPlayer.slot]!;
      if (w.damage > 0) {
        if (owner) owner.hits++;
        damagePlayer(m, ctx, pr.owner, q, w.damage, { head: hitPlayer.head, weapon: w.id, kind: 'direct', headshotKills: w.headshotKills, headMult: w.headMult });
      }
      if (def.stick && q.alive) {
        q.needles.push({ by: pr.owner, tick: t });
        const mine = q.needles.filter((n) => n.by === pr.owner).length;
        if (mine >= def.stick.count) {
          q.needles = [];
          const hb = playerHitbox(m, arena, q);
          ctx.events.push({ k: 'boom', t, p: pr.owner, w: w.id, pos: V(hb.head), r: def.stick.radius });
          if (owner) bumpMedal(m, ctx, owner, 'supercombine');
          damagePlayer(m, ctx, pr.owner, q, def.stick.damage, { head: false, weapon: w.id, kind: 'splash' });
        }
      }
      if (def.burn && q.alive) q.burn = { by: pr.owner, until: t + secToTicks(def.burn.time), dps: def.burn.dps, next: t + 15 };
      endProjectile(m, ctx, pr, at, w, -1, w.damage > 0);
      continue;
    }
    if (inMouth && def.bounce) {
      // it fell into someone's hole — detonate at the bottom
      const bottom = { x: hole!.x, y: hole!.ground - 1.2, z: hole!.z };
      endProjectile(m, ctx, pr, bottom, w, hole!.id);
      continue;
    }
    if (hitWorld) {
      if (def.bounce && pr.bounces < def.bounce.max && !(pr.fuseAt && t >= pr.fuseAt)) {
        const n = terrainNormal(arena, at.x, at.z);
        const vdn = pr.vx * n.x + pr.vy * n.y + pr.vz * n.z;
        const r = def.bounce.restitution;
        pr.vx = (pr.vx - 2 * vdn * n.x) * r;
        pr.vy = (pr.vy - 2 * vdn * n.y) * r;
        pr.vz = (pr.vz - 2 * vdn * n.z) * r;
        pr.x = at.x + n.x * 0.05;
        pr.y = at.y + n.y * 0.05;
        pr.z = at.z + n.z * 0.05;
        pr.bounces++;
        keep.push(pr);
        continue;
      }
      endProjectile(m, ctx, pr, at, w, -1);
      continue;
    }
    const expired = t - pr.born >= secToTicks(def.life) || (pr.fuseAt && t >= pr.fuseAt) || pr.y < -20;
    if (expired) {
      endProjectile(m, ctx, pr, { x: pr.x, y: pr.y, z: pr.z }, w, -1);
      continue;
    }
    keep.push(pr);
  }
  m.projectiles = keep;
}

function endProjectile(m: MatchState, ctx: StepContext, pr: Projectile, at: V3, w: WeaponDef, inHole: number, counted = false) {
  ctx.events.push({ k: 'pend', t: m.tick, id: pr.id, pos: V(at) });
  if (w.splash && explode(m, ctx, pr.owner, w.id, at, w.splash, inHole) && !counted) {
    const owner = m.players[pr.owner];
    if (owner) owner.hits++;
  }
}

// ---------------------------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------------------------

interface DamageOpts {
  head: boolean;
  weapon: WeaponId;
  kind: 'direct' | 'splash' | 'burn' | 'strike';
  headshotKills?: boolean;
  headMult?: number;
}

/** Returns true if the blast damaged anyone other than its owner. */
function explode(m: MatchState, ctx: StepContext, owner: number, weapon: WeaponId, pos: V3, sp: NonNullable<WeaponDef['splash']>, inHole: number, kind: DamageOpts['kind'] = 'splash'): boolean {
  const { arena } = ctx;
  let hitEnemy = false;
  ctx.events.push({ k: 'boom', t: m.tick, p: owner, w: weapon, pos: V(pos), r: sp.radius });
  for (const q of m.players) {
    if (!q || !q.alive) continue;
    const hb = playerHitbox(m, arena, q);
    const dHead = dist(pos, hb.head) - hb.headR;
    const dBody = pointSegmentDist(pos, hb.torsoA, hb.torsoB) - hb.torsoR;
    const d = Math.max(0, Math.min(dHead, dBody));
    if (d > sp.radius) continue;
    let factor = 1;
    const ducked = q.exposure < 0.35;
    if (ducked && inHole !== q.hole) {
      if (!sp.hitsDucked && !m.settings.splashHitsDucked) continue;
      if (!sp.hitsDucked) factor *= 0.5;
    }
    const fall = d <= sp.inner ? 1 : 1 - (d - sp.inner) / (sp.radius - sp.inner);
    if (q.slot === owner) factor *= sp.selfMult;
    const amt = sp.damage * fall * factor;
    if (amt > 0.5) {
      damagePlayer(m, ctx, owner, q, amt, { head: false, weapon, kind });
      if (q.slot !== owner) hitEnemy = true;
    }
  }
  const shooter = m.players[owner];
  for (const orb of [...m.orbs]) {
    if (shooter && dist(orbPos(orb, m.tick, arena), pos) < sp.radius + ORB_R) claimOrb(m, ctx, orb.id, shooter);
  }
  return hitEnemy;
}

export function damagePlayer(m: MatchState, ctx: StepContext, attacker: number, v: PlayerState, amount: number, o: DamageOpts) {
  if (!v.alive || m.phase !== 'live') return;
  const t = m.tick;
  const a = attacker >= 0 ? m.players[attacker] : null;
  if (hasPowerup(v, 'invincible', t)) {
    ctx.events.push({ k: 'dmg', t, a: attacker, v: v.slot, amt: 0, head: o.head, sb: false, w: o.weapon });
    return;
  }
  if (o.kind === 'direct' && m.settings.headshotsOnly && !o.head) return;
  let amt = amount * m.settings.damageMult;
  if (a && a !== v && hasPowerup(a, 'damage', t)) amt *= 2;
  let lethalHead = false;
  if (o.head && o.kind === 'direct') {
    if (o.headshotKills && v.overshield <= 0) lethalHead = true;
    else if (v.shield <= 0 && o.headMult) amt *= o.headMult;
  }
  if (lethalHead) amt = Math.max(amt, v.shield + v.health + 1);
  const hadShield = v.shield > 0;
  // overshield → shield → health
  const os = Math.min(v.overshield, amt);
  v.overshield -= os;
  amt -= os;
  const sh = Math.min(v.shield, amt);
  v.shield -= sh;
  amt -= sh;
  v.health -= amt;
  v.rechargeAt = t + secToTicks(RECHARGE_DELAY);
  if (attacker >= 0 && attacker !== v.slot) v.lastHitBy = attacker;
  const total = os + sh + Math.max(0, amt);
  const sb = hadShield && v.shield <= 0;
  ctx.events.push({ k: 'dmg', t, a: attacker, v: v.slot, amt: round2(total), head: o.head, sb, w: o.weapon });
  if (v.health <= 0) killPlayer(m, ctx, attacker, v, o.weapon, o.head && o.kind === 'direct');
}

function bumpMedal(m: MatchState, ctx: StepContext, p: PlayerState, id: string) {
  p.medals[id] = (p.medals[id] ?? 0) + 1;
  ctx.events.push({ k: 'medal', t: m.tick, p: p.slot, id });
}

const MULTI = ['', '', 'double', 'triple', 'overkill', 'killtacular', 'killtrocity'];
const SPREES: Record<number, string> = { 5: 'spree', 10: 'frenzy', 15: 'riot', 20: 'rampage', 25: 'untouchable' };

function killPlayer(m: MatchState, ctx: StepContext, attacker: number, v: PlayerState, weapon: WeaponId, head: boolean) {
  const t = m.tick;
  const s = m.settings;
  const a = attacker >= 0 ? m.players[attacker] : null;
  const wasLeader = a !== null && m.leader === a.slot;
  // an environment/self kill credited to the last attacker if recent
  v.alive = false;
  v.respawnRequested = false;
  v.health = 0;
  v.deaths++;
  const victimStreak = v.streak;
  v.streak = 0;
  v.deathStreak++;
  v.burn = null;
  v.needles = [];
  v.beamUntil = 0;
  v.chargeStart = -1;
  v.respawnAt = t + Math.max(secToTicks(0.4), secToTicks(s.respawnSec));
  const medals: string[] = [];
  if (a && a !== v) {
    v.lastKiller = a.slot;
    a.kills++;
    a.streak++;
    a.bestStreak = Math.max(a.bestStreak, a.streak);
    a.deathStreak = 0;
    a.underdogUntil = 0;
    a.multi = t - a.lastKillTick <= secToTicks(MULTIKILL_WINDOW) ? a.multi + 1 : 1;
    a.lastKillTick = t;
    if (head) {
      a.headshots++;
      medals.push('headshot');
    }
    const multi = MULTI[Math.min(a.multi, MULTI.length - 1)];
    if (multi) medals.push(multi);
    if (SPREES[a.streak]) medals.push(SPREES[a.streak]!);
    if (victimStreak >= 5) medals.push('killjoy');
    if (a.lastKiller === v.slot) {
      medals.push('revenge');
      a.lastKiller = -1;
    }
    if (v.exposedSince >= 0 && t - v.exposedSince <= secToTicks(0.5)) medals.push('whack');
    const ha = ctx.arena.holes[a.hole]!, hv = ctx.arena.holes[v.hole]!;
    if (Math.hypot(ha.x - hv.x, ha.z - hv.z) > 55) medals.push('longshot');
    if (!m.announced.first) {
      m.announced.first = true;
      medals.push('first');
    }
    if (s.skulls.includes('blackeye')) a.shield = a.shieldMax;
    for (const id of medals) a.medals[id] = (a.medals[id] ?? 0) + 1;
    if (s.weaponMode === 'gunGame') {
      a.gunLevel++;
      if (a.gunLevel < s.gunGameOrder.length && a.alive) {
        a.powerups = a.powerups.filter((x) => !POWERUPS[x.id].weapon);
        equip(m, a, s.gunGameOrder[a.gunLevel]!);
        ctx.events.push({ k: 'ann', t, key: 'ann.gungame_level', p: a.slot });
      }
    }
  } else {
    // suicide
    v.kills = Math.max(0, v.kills - 1);
  }
  ctx.events.push({ k: 'kill', t, a: attacker, v: v.slot, w: weapon, head, medals, lead: wasLeader && a !== v });
  recomputeLeader(m, ctx.events);
}

function recomputeLeader(m: MatchState, events: SimEvent[]) {
  const cur = m.leader >= 0 ? m.players[m.leader] : null;
  let best = cur && cur.connected ? cur : null;
  for (const p of m.players) {
    if (!p || !p.connected) continue;
    if (!best || score(m, p) > score(m, best)) best = p;
  }
  if (best && score(m, best) <= 0) best = null;
  const next = best ? best.slot : -1;
  if (next !== m.leader) {
    events.push({ k: 'lead', t: m.tick, p: next, prev: m.leader });
    m.leader = next;
  }
}

// ---------------------------------------------------------------------------------------------
// Strikes, orbs, power-ups
// ---------------------------------------------------------------------------------------------

function stepStrikes(m: MatchState, ctx: StepContext) {
  if (!m.strikes.length) return;
  const due = m.strikes.filter((s) => m.tick >= s.at);
  if (!due.length) return;
  m.strikes = m.strikes.filter((s) => m.tick < s.at);
  const def = WEAPONS.orbital.strike!;
  for (const s of due) {
    explode(m, ctx, s.owner, 'orbital', { x: s.x, y: s.y, z: s.z }, { radius: def.radius, inner: 1.5, damage: def.damage, selfMult: 1, hitsDucked: true }, -1, 'strike');
  }
}

function stepOrbs(m: MatchState, ctx: StepContext) {
  const t = m.tick;
  const s = m.settings;
  const expired = m.orbs.filter((o) => t >= o.expire);
  for (const o of expired) ctx.events.push({ k: 'orbPop', t, id: o.id, p: -1 });
  if (expired.length) m.orbs = m.orbs.filter((o) => t < o.expire);
  const rate = ORB_RATES[s.orbRate];
  if (rate.interval <= 0 || m.phase !== 'live' || t < m.nextOrbAt) return;
  m.nextOrbAt = t + secToTicks(rate.interval * ctx.rng.range(0.8, 1.2));
  if (m.orbs.length >= rate.max) return;
  const type = ctx.rng.weighted(s.powerups, (id) => POWERUPS[id].weight);
  if (!type) return;
  const orb = { id: m.nextId++, type, seed: ctx.rng.int(1, 2 ** 30), spawn: t, expire: t + secToTicks(30) };
  m.orbs.push(orb);
  ctx.events.push({ k: 'orb', t, id: orb.id, type, seed: orb.seed, spawn: orb.spawn, expire: orb.expire });
}

function claimOrb(m: MatchState, ctx: StepContext, id: number, p: PlayerState) {
  const orb = m.orbs.find((o) => o.id === id);
  if (!orb) return;
  m.orbs = m.orbs.filter((o) => o.id !== id);
  ctx.events.push({ k: 'orbPop', t: m.tick, id, p: p.slot });
  bumpMedal(m, ctx, p, 'orb');
  if (p.alive) grantPowerup(m, ctx, p, orb.type);
}

export function grantPowerup(m: MatchState, ctx: StepContext, p: PlayerState, id: PowerUpId) {
  const t = m.tick;
  const def = POWERUPS[id];
  const until = t + secToTicks(def.duration * m.settings.powerupDurationMult);
  if (def.weapon) {
    if (!p.weaponUntil) p.baseClip = p.clip;
    p.powerups = p.powerups.filter((x) => !POWERUPS[x.id].weapon);
    p.weapon = def.weapon;
    p.weaponUntil = until;
    p.clip = 0;
    p.reloadUntil = 0;
    p.chargeStart = -1;
    p.beamUntil = 0;
    p.burstLeft = 0;
    p.spin = 0;
    p.nextFireAt = t + 6;
  }
  if (id === 'overshield') p.overshield = 70;
  p.powerups = p.powerups.filter((x) => x.id !== id);
  p.powerups.push({ id, until });
  ctx.events.push({ k: 'pu', t, p: p.slot, id, until });
}

// ---------------------------------------------------------------------------------------------
// End conditions
// ---------------------------------------------------------------------------------------------

function checkEnd(m: MatchState, ctx: StepContext) {
  if (m.phase !== 'live') return;
  const t = m.tick;
  const s = m.settings;
  const players = m.players.filter((p): p is PlayerState => !!p);
  let winner: PlayerState | null = null;
  let ended = false;
  if (s.weaponMode === 'gunGame') {
    winner = players.find((p) => p.gunLevel >= s.gunGameOrder.length) ?? null;
    ended = !!winner;
  } else if (s.scoreLimit > 0) {
    winner = players.find((p) => p.kills >= s.scoreLimit) ?? null;
    ended = !!winner;
    const lead = m.leader >= 0 ? m.players[m.leader] : null;
    if (lead) {
      const left = s.scoreLimit - lead.kills;
      if (left === 10 && s.scoreLimit >= 20 && !m.announced.ten) {
        m.announced.ten = true;
        ctx.events.push({ k: 'ann', t, key: 'ann.ten_kills', p: -1 });
      }
      if (left === 5 && s.scoreLimit >= 10 && !m.announced.five) {
        m.announced.five = true;
        ctx.events.push({ k: 'ann', t, key: 'ann.five_kills', p: -1 });
      }
    }
  }
  if (!ended && s.timeLimitMin > 0) {
    const endTick = m.liveAt + secToTicks(s.timeLimitMin * 60);
    if (t >= endTick - secToTicks(60) && !m.announced.minute && s.timeLimitMin > 1) {
      m.announced.minute = true;
      ctx.events.push({ k: 'ann', t, key: 'ann.one_minute', p: -1 });
    }
    if (t >= endTick) {
      ended = true;
      const sorted = [...players].sort((a, b) => score(m, b) - score(m, a) || a.deaths - b.deaths);
      const [first, second] = sorted;
      if (first && (!second || score(m, first) > score(m, second) || first.deaths < second.deaths)) winner = first;
    }
  }
  if (ended) {
    m.phase = 'ended';
    m.endAt = t;
    m.winner = winner ? winner.slot : -1;
    m.projectiles = [];
    m.strikes = [];
    if (winner && winner.deaths === 0 && winner.kills >= 10) {
      winner.medals.perfection = 1;
      ctx.events.push({ k: 'medal', t, p: winner.slot, id: 'perfection' });
    }
    ctx.events.push({ k: 'end', t, winner: m.winner });
  }
}

export function timeLeftSec(m: MatchState): number {
  if (m.settings.timeLimitMin <= 0) return -1;
  const endTick = m.liveAt + secToTicks(m.settings.timeLimitMin * 60);
  return Math.max(0, (endTick - Math.max(m.tick, m.liveAt)) / TICK_RATE);
}
