// Usage: npx vite-node scripts/findSeed.ts  (or via vitest) — searches for an arena seed with good sight lines.
import { Arena } from '../src/sim/arena';
import { EYE_Y, HEAD_Y } from '../src/sim/constants';

export function visibilityStats(a: Arena) {
  const hs = a.holes;
  let worst = 1;
  let total = 0;
  let pairs = 0;
  for (const h of hs) {
    let seen = 0;
    for (const o of hs) {
      if (o === h) continue;
      const clear = a.lineClear({ x: h.x, y: h.rim + EYE_Y, z: h.z }, { x: o.x, y: o.rim + HEAD_Y, z: o.z }, 0.5);
      if (clear) seen++;
      pairs++;
      total += clear ? 1 : 0;
    }
    worst = Math.min(worst, seen / (hs.length - 1));
  }
  return { worst, avg: total / pairs, count: hs.length };
}

if (process.argv[1]?.includes('findSeed')) {
  const start = Number(process.argv[2] ?? 20260928);
  for (let s = start; s < start + 400; s++) {
    const a = new Arena(s);
    if (a.holes.length < 16) continue;
    const st = visibilityStats(a);
    const d = a.holes.map((h) => Math.hypot(h.x, h.z));
    if (st.worst >= 0.75) console.log(s, st, 'maxR', Math.max(...d).toFixed(1));
  }
}
