/**
 * Gerry Sauce: aim speed while you're covered in it — slow at first, back to normal as it clears.
 * `at`/`until`: when it hit you and when it's gone (ticks).
 */
export function sauceAimScale(at: number, until: number, tick: number): number {
  if (at < 0 || tick < at || tick >= until) return 1;
  const k = (tick - at) / Math.max(1, until - at);
  return 0.2 + 0.8 * k * k;
}

/** How much sauce is left (1 = just hit, 0 = clean). */
export function sauceLeft(at: number, until: number, tick: number): number {
  if (at < 0 || tick < at || tick >= until) return 0;
  return 1 - (tick - at) / Math.max(1, until - at);
}
