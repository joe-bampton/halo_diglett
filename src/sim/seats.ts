import type { Hole } from './arena';

/** Two Spartans squeezed into one hole stand this far either side of its middle. */
export const SEAT_R = 0.42;
/** Three or more go round a ring this wide. */
const RING_R = 0.5;

export interface Seat {
  x: number;
  z: number;
}

const MIDDLE: Seat = Object.freeze({ x: 0, z: 0 });

/**
 * Where in its hole a Spartan stands, from the middle of the hole. Alone: the middle. Two in one hole (a captive
 * thrown in with a Poké Ball): side by side across it, square to the middle of the field. More: round a ring. `others`
 * are the slots of everyone in the hole, this one included; host and clients work it out the same way, in slot order.
 */
export function seatOffset(hole: Hole, slot: number, others: readonly number[]): Seat {
  if (others.length < 2) return MIDDLE;
  const order = [...others].sort((a, b) => a - b);
  const i = order.indexOf(slot);
  if (i < 0) return MIDDLE;
  if (order.length === 2) {
    // across the hole, perpendicular to the line to the field centre (both still face into the field)
    const L = Math.hypot(hole.x, hole.z) || 1;
    const s = i === 0 ? -SEAT_R : SEAT_R;
    return { x: (-hole.z / L) * s, z: (hole.x / L) * s };
  }
  const a = (i / order.length) * Math.PI * 2;
  return { x: Math.cos(a) * RING_R, z: Math.sin(a) * RING_R };
}
