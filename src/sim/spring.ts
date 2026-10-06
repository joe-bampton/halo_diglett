import { TICK_RATE } from './constants';

/** Spring Jump: catapulted straight up out of your hole, then back down into it. */
export const SPRING_H = 20; // apex height above the hole (m)
export const SPRING_G = 14; // m/s² — a little floatier than real gravity for more hang time at the top
export const SPRING_V0 = Math.sqrt(2 * SPRING_G * SPRING_H);
/** Ticks from launch to landing (~3.4 s). */
export const SPRING_TICKS = Math.round(((2 * SPRING_V0) / SPRING_G) * TICK_RATE);
/** Pause after landing before another launch — longer than the lag-compensation window, so one launch tick covers any rewind. */
export const SPRING_COOLDOWN = 30;
/** `until` of a held power-up: never runs out on its own (a JSON-safe stand-in for Infinity). */
export const HELD_UNTIL = 2 ** 30;

/** Height above the hole `tick` ticks into a launch that started at `at` (fractional ticks are fine; -1 = none). */
export function springLift(at: number, tick: number): number {
  if (at < 0 || tick <= at || tick - at >= SPRING_TICKS) return 0;
  const t = (tick - at) / TICK_RATE;
  return Math.max(0, SPRING_V0 * t - 0.5 * SPRING_G * t * t);
}

/** Airborne (can't duck, can't hide) between launch and landing. */
export function inFlight(at: number, tick: number): boolean {
  return at >= 0 && tick >= at && tick < at + SPRING_TICKS;
}
