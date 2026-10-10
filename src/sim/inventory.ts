import type { PowerUpId } from './powerups';

/** The most of one kind of power-up you can carry (any number of different kinds). */
export const INV_MAX = 2;

/** One kind of power-up waiting to be used, and how many of it. */
export interface InvItem {
  id: PowerUpId;
  n: number;
}

/** How many of this power-up are waiting to be used. */
export function invCount(p: { inv: InvItem[] }, id: PowerUpId): number {
  return p.inv.find((x) => x.id === id)?.n ?? 0;
}

/** Put one in the inventory (new kinds go at the end). False if two of it are already there. */
export function invAdd(p: { inv: InvItem[] }, id: PowerUpId): boolean {
  const it = p.inv.find((x) => x.id === id);
  if (!it) {
    p.inv.push({ id, n: 1 });
    return true;
  }
  if (it.n >= INV_MAX) return false;
  it.n++;
  return true;
}

/** Take one out (the kind drops out of the list when the last one is used). False if there was none. */
export function invTake(p: { inv: InvItem[] }, id: PowerUpId): boolean {
  const i = p.inv.findIndex((x) => x.id === id);
  if (i < 0) return false;
  if (--p.inv[i]!.n <= 0) p.inv.splice(i, 1);
  return true;
}
