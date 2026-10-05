// Usage: npx vite-node scripts/findSeed.ts  (or via vitest) — searches for an arena seed with good sight lines.
import { Arena, visibilityStats } from '../src/sim/arena';

export { visibilityStats };

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
