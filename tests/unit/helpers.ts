import { Arena } from '../../src/sim/arena';
import { createMatch, stepMatch } from '../../src/sim/match';
import { sanitizeSettings, type Settings } from '../../src/sim/settings';
import type { MatchState, PlayerCommand, RosterEntry, SimEvent } from '../../src/sim/types';
import { yawPitchOf } from '../../src/shared/vec';
import { eyePos } from '../../src/sim/hitbox';

export const arena = new Arena();

export function roster(n: number): RosterEntry[] {
  return Array.from({ length: n }, (_, i) => ({ slot: i, name: `P${i}`, color: 0xff0000, kind: 'human' as const }));
}

export function makeMatch(n = 2, s: Partial<Settings> = {}): MatchState {
  const m = createMatch(sanitizeSettings({ orbRate: 'off', antiTurtleSec: 0, ...s }), roster(n), 1234, arena);
  return m;
}

export function cmd(over: Partial<PlayerCommand> = {}): PlayerCommand {
  return { yaw: 0, pitch: 0, stand: false, trigger: false, presses: 0, reloads: 0, zoom: 0, vt: 0, ...over };
}

export function run(m: MatchState, ticks: number, cmds: (PlayerCommand | undefined)[] = []): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...stepMatch(m, cmds.map((c) => c && { ...c, vt: m.tick }), arena));
  return out;
}

/** Skip intro and stand both players up. Returns commands array. */
export function liveAndStanding(m: MatchState, slots = [0, 1]): PlayerCommand[] {
  const cmds: PlayerCommand[] = [];
  for (const s of slots) cmds[s] = cmd({ stand: true });
  run(m, m.liveAt + 30, cmds);
  return cmds;
}

/** Yaw/pitch for shooter `a` to aim at `b`'s head (or body). */
export function aimAt(m: MatchState, a: number, b: number, part: 'head' | 'body' = 'head') {
  const pa = m.players[a]!, pb = m.players[b]!;
  const ha = arena.holes[pa.hole]!, hb = arena.holes[pb.hole]!;
  const eye = eyePos(ha, pa.exposure);
  const ty = part === 'head' ? hb.rim + 0.95 - 1.35 * (1 - pb.exposure) : hb.rim + 0.35 - 1.35 * (1 - pb.exposure);
  return yawPitchOf({ x: hb.x - eye.x, y: ty - eye.y, z: hb.z - eye.z });
}

/** Put two players in holes that can see each other. */
export function faceOff(m: MatchState) {
  const [a, b] = [m.players[0]!, m.players[1]!];
  for (const h1 of m.activeHoles)
    for (const h2 of m.activeHoles) {
      if (h1 === h2) continue;
      const A = arena.holes[h1]!, B = arena.holes[h2]!;
      const d = Math.hypot(A.x - B.x, A.z - B.z);
      if (d < 20 || d > 45) continue;
      if (arena.lineClear({ x: A.x, y: A.rim + 0.88, z: A.z }, { x: B.x, y: B.rim + 0.95, z: B.z }, 0.5) &&
          arena.lineClear({ x: B.x, y: B.rim + 0.88, z: B.z }, { x: A.x, y: A.rim + 0.95, z: A.z }, 0.5) &&
          arena.lineClear({ x: A.x, y: A.rim + 0.88, z: A.z }, { x: B.x, y: B.rim + 0.3, z: B.z }, 0.5)) {
        a.hole = h1;
        b.hole = h2;
        return;
      }
    }
  throw new Error('no face-off holes');
}
