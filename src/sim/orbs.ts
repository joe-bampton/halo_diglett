import { hash01 } from '../shared/rng';
import type { V3 } from '../shared/vec';
import type { Arena } from './arena';
import { TICK_RATE } from './constants';
import type { Orb } from './types';

export const ORB_R = 0.8;
/** Pitre Mode's energy drink cans are bigger than the capture balls, and so is their hit sphere. */
export const CAN_ORB_R = 1.05;

/** Hit radius of a power-up for these settings. */
export function orbRadius(s: { pitre: boolean; pitreCans: boolean }): number {
  return s.pitre && s.pitreCans ? CAN_ORB_R : ORB_R;
}

export const ORB_RATES = {
  off: { interval: 0, max: 0, first: 0 },
  low: { interval: 45, max: 1, first: 25 },
  normal: { interval: 25, max: 2, first: 18 },
  high: { interval: 12, max: 3, first: 10 },
  chaos: { interval: 5, max: 5, first: 4 },
} as const;

/** Deterministic drifting path (host & clients compute identical positions). */
export function orbPos(orb: Pick<Orb, 'seed' | 'spawn'>, tick: number, arena: Arena): V3 {
  const s = orb.seed;
  const t = (tick - orb.spawn) / TICK_RATE;
  // bigger fields (custom hole layouts) get wider drift
  const k = arena.scale;
  const cx = (hash01(s, 1) - 0.5) * 30 * k;
  const cz = (hash01(s, 2) - 0.5) * 30 * k;
  const ax = (10 + hash01(s, 3) * 12) * k;
  const az = (10 + hash01(s, 4) * 12) * k;
  const fx = 0.1 + hash01(s, 5) * 0.08;
  const fz = 0.08 + hash01(s, 6) * 0.08;
  const px = hash01(s, 7) * Math.PI * 2;
  const pz = hash01(s, 8) * Math.PI * 2;
  const x = cx + Math.sin(t * fx + px) * ax;
  const z = cz + Math.sin(t * fz + pz) * az;
  const baseH = 5 + hash01(s, 9) * 7;
  // rise out of the ground during the first second
  const rise = Math.min(1, t / 1.2);
  const y = arena.groundAt(x, z) + baseH * (0.3 + 0.7 * rise) + Math.sin(t * 1.7 + px) * 0.6;
  return { x, y, z };
}
