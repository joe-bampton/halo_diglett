import type { Settings } from '../sim/settings';
import type { BotDifficulty, MatchPhase, PlayerCommand, RosterEntry, SimEvent } from '../sim/types';
import type { WeaponId } from '../sim/weapons';

export const PROTOCOL_VERSION = 1;
export const BUILD_ID: string = (import.meta.env?.VITE_BUILD_ID as string | undefined) ?? 'dev';

export interface SlotInfo {
  slot: number;
  name: string;
  color: number;
  kind: 'human' | 'bot';
  bot?: BotDifficulty;
  connected: boolean;
  isHost?: boolean;
  pick?: WeaponId;
  ping?: number;
}

export interface LobbyState {
  code: string;
  phase: 'lobby' | 'match' | 'results';
  settings: Settings;
  slots: SlotInfo[];
  online: boolean;
}

/** Control channel messages (reliable, both directions). */
export type CtlMsg =
  | { t: 'host' }
  | { t: 'hello'; proto: number; build: string; token: string; name: string; color: number }
  | { t: 'welcome'; slot: number; lobby: LobbyState }
  | { t: 'reject'; reason: 'full' | 'version' | 'started' | 'kicked' }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'me'; name?: string; color?: number; pick?: WeaponId }
  | { t: 'start'; start: MatchStart }
  | { t: 'results'; results: MatchResults }
  | { t: 'toLobby' }
  | { t: 'bye' };

export interface MatchStart {
  settings: Settings;
  roster: RosterEntry[];
  seed: number;
  tick: number;
  liveAt: number;
  phase: MatchPhase;
  leader: number;
  orbs: { id: number; type: string; seed: number; spawn: number; expire: number }[];
}

export interface ResultRow {
  slot: number;
  name: string;
  color: number;
  kind: 'human' | 'bot';
  kills: number;
  deaths: number;
  score: number;
  headshots: number;
  accuracy: number;
  bestStreak: number;
  medals: Record<string, number>;
}

export interface MatchResults {
  winner: number;
  rows: ResultRow[];
  durationSec: number;
}

/** Client → host input (sent ~30Hz plus immediately on edges). */
export interface InputMsg {
  s: number; // sequence
  c: PlayerCommand;
}

/**
 * Packed remote player: [slot, exposure0-255, yaw*1000, pitch*1000, flags, weaponIdx, hole, beamLen*10, zoom]
 */
export type PackedPlayer = [number, number, number, number, number, number, number, number, number];

export const F_ALIVE = 1;
export const F_RELOAD = 2;
export const F_CAMO = 4;
export const F_OVERSHIELD = 8;
export const F_INVINCIBLE = 16;
export const F_CHARGING = 32;
export const F_BEAM = 64;
export const F_CONNECTED = 128;
export const F_DAMAGE = 256;
export const F_BIGHEAD = 512;
export const F_BURNING = 1024;

/** Private state for the receiving player only. */
export interface PrivateState {
  sh: number;
  shm: number;
  hp: number;
  hpm: number;
  os: number;
  clip: number;
  rl: number; // reload end tick (0 none)
  rs: number; // reload start tick
  w: number; // weapon index
  wu: number; // weapon override until
  pu: [string, number][]; // power-ups (id, until tick)
  fs: number; // forced stand until
  ra: number; // respawn at
  ud: number; // underdog until
  cs: number; // charge start
  bu: number; // beam until
  nf: number; // next fire tick
  gl: number; // gun level
  ds: number; // ducked since
  al: boolean;
  hole: number;
}

export interface SnapshotMsg {
  k: number; // host tick
  ph: MatchPhase;
  a: number; // last input seq applied
  p: PackedPlayer[];
  h?: [number, number, number, number][]; // homing projectile positions [id,x,y,z]
  e?: SimEvent[];
  me?: PrivateState;
  sb?: [number, number, number, number][]; // [slot, kills, deaths, gunLevel]
  ld: number; // leader
}

export const CH_CTL = 'ctl';
export const CH_IN = 'in';
export const CH_SNAP = 'snap';
export type Channel = typeof CH_CTL | typeof CH_IN | typeof CH_SNAP;
