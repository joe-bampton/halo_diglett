import type { PowerUpId } from './powerups';
import type { Settings } from './settings';
import type { WeaponId } from './weapons';

export type BotDifficulty = 'recruit' | 'normal' | 'heroic' | 'legendary';

export interface RosterEntry {
  slot: number;
  name: string;
  color: number;
  kind: 'human' | 'bot';
  bot?: BotDifficulty;
}

/** What a player (human or bot) wants this tick. */
export interface PlayerCommand {
  yaw: number;
  pitch: number;
  stand: boolean;
  trigger: boolean;
  /** cumulative trigger presses (edge detection that survives packet batching) */
  presses: number;
  /** cumulative reload presses */
  reloads: number;
  /** cumulative respawn requests (Jump while dead) */
  respawns: number;
  zoom: number;
  /** host tick the client was rendering when it sampled this (lag compensation) */
  vt: number;
  pick?: WeaponId;
}

export interface ActivePowerup {
  id: PowerUpId;
  until: number;
}

export interface PlayerState {
  slot: number;
  name: string;
  color: number;
  kind: 'human' | 'bot';
  bot?: BotDifficulty;
  connected: boolean;
  hole: number;
  alive: boolean;
  respawnAt: number;
  spawnTick: number;
  exposure: number;
  wantStand: boolean;
  duckedSince: number;
  exposedSince: number;
  forcedStandUntil: number;
  yaw: number;
  pitch: number;
  zoom: number;
  shield: number;
  shieldMax: number;
  health: number;
  healthMax: number;
  overshield: number;
  rechargeAt: number;
  weapon: WeaponId;
  baseWeapon: WeaponId;
  baseClip: number;
  weaponUntil: number;
  clip: number;
  reloadUntil: number;
  nextFireAt: number;
  chargeStart: number;
  needRelease: boolean;
  beamUntil: number;
  beamLen: number;
  beamHit: boolean;
  burstLeft: number;
  nextBurstAt: number;
  spin: number;
  trigger: boolean;
  presses: number;
  reloads: number;
  respawns: number;
  /** pressed Jump while dead (manual respawn) */
  respawnRequested: boolean;
  pressAt: number;
  powerups: ActivePowerup[];
  underdogUntil: number;
  revealUntil: number;
  needles: { by: number; tick: number }[];
  burn: { by: number; until: number; dps: number; next: number } | null;
  kills: number;
  deaths: number;
  streak: number;
  bestStreak: number;
  deathStreak: number;
  multi: number;
  lastKillTick: number;
  gunLevel: number;
  lastKiller: number;
  pick: WeaponId | null;
  vt: number;
  shots: number;
  hits: number;
  headshots: number;
  medals: Record<string, number>;
  lastHitBy: number;
}

export interface Projectile {
  id: number;
  owner: number;
  weapon: WeaponId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  born: number;
  bounces: number;
  target: number;
  fuseAt: number;
}

export interface Orb {
  id: number;
  type: PowerUpId;
  seed: number;
  spawn: number;
  expire: number;
}

export interface Strike {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  at: number;
}

export type MatchPhase = 'intro' | 'live' | 'ended';

export interface MatchState {
  tick: number;
  phase: MatchPhase;
  liveAt: number;
  endAt: number;
  seed: number;
  settings: Settings;
  activeHoles: number[];
  players: (PlayerState | null)[];
  projectiles: Projectile[];
  nextId: number;
  orbs: Orb[];
  nextOrbAt: number;
  strikes: Strike[];
  history: Uint8Array;
  leader: number;
  winner: number;
  rng: number;
  announced: Record<string, boolean>;
}

export type Vec3T = [number, number, number];
export type HitKind = 'head' | 'body' | 'orb' | 'world' | 'none';

export type SimEvent =
  | { k: 'fire'; t: number; p: number; w: WeaponId; o: Vec3T; e: Vec3T; hit: HitKind }
  | { k: 'proj'; t: number; id: number; p: number; w: WeaponId; pos: Vec3T; vel: Vec3T; tgt: number }
  | { k: 'pend'; t: number; id: number; pos: Vec3T }
  | { k: 'boom'; t: number; p: number; w: WeaponId; pos: Vec3T; r: number }
  | { k: 'dmg'; t: number; a: number; v: number; amt: number; head: boolean; sb: boolean; w: WeaponId }
  | { k: 'kill'; t: number; a: number; v: number; w: WeaponId; head: boolean; medals: string[]; lead: boolean }
  | { k: 'spawn'; t: number; p: number; hole: number }
  | { k: 'reload'; t: number; p: number }
  | { k: 'orb'; t: number; id: number; type: string; seed: number; spawn: number; expire: number }
  | { k: 'orbPop'; t: number; id: number; p: number }
  | { k: 'pu'; t: number; p: number; id: string; until: number }
  | { k: 'strike'; t: number; id: number; p: number; pos: Vec3T; at: number }
  | { k: 'lead'; t: number; p: number; prev: number }
  | { k: 'ann'; t: number; key: string; p: number }
  | { k: 'medal'; t: number; p: number; id: string }
  | { k: 'end'; t: number; winner: number }
  | { k: 'forced'; t: number; p: number };
