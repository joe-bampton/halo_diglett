import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/shared/rng';
import { secToTicks } from '../../src/sim/constants';
import { createMatch, damagePlayer } from '../../src/sim/match';
import { sanitizeSettings } from '../../src/sim/settings';
import type { MatchState } from '../../src/sim/types';
import { arena, cmd, makeMatch, run } from './helpers';

function kill(m: MatchState, a: number, v: number) {
  damagePlayer(m, { arena, rng: new Rng(1), events: [] }, a, m.players[v]!, 9999, { head: false, weapon: 'sniper', kind: 'direct' });
}

describe('manual respawn (press Jump)', () => {
  it('keeps a dead human down until they press Jump', () => {
    const m = makeMatch(2, { respawnMode: 'manual', respawnSec: 2 });
    const cmds = [cmd(), cmd()];
    run(m, m.liveAt + 5, cmds);
    kill(m, 0, 1);
    const p = m.players[1]!;
    expect(p.alive).toBe(false);
    run(m, secToTicks(6), cmds);
    expect(p.alive).toBe(false);
    cmds[1] = cmd({ respawns: 1 });
    run(m, 1, cmds);
    expect(p.alive).toBe(true);
    expect(p.respawnRequested).toBe(false);
  });

  it('a press during the countdown respawns exactly when the timer ends', () => {
    const m = makeMatch(2, { respawnMode: 'manual', respawnSec: 2 });
    const cmds = [cmd(), cmd()];
    run(m, m.liveAt + 5, cmds);
    kill(m, 0, 1);
    const p = m.players[1]!;
    run(m, 10, cmds);
    cmds[1] = cmd({ respawns: 1 });
    run(m, 1, cmds);
    expect(p.respawnRequested).toBe(true);
    run(m, p.respawnAt - m.tick - 1, cmds);
    expect(p.alive).toBe(false);
    run(m, 1, cmds);
    expect(p.alive).toBe(true);
    expect(p.spawnTick).toBe(p.respawnAt);
  });

  it('ignores presses while alive and forgets a request on death', () => {
    const m = makeMatch(2, { respawnMode: 'manual', respawnSec: 1 });
    const cmds = [cmd(), cmd({ respawns: 3 })];
    run(m, m.liveAt + 5, cmds);
    expect(m.players[1]!.respawnRequested).toBe(false);
    kill(m, 0, 1);
    run(m, secToTicks(3), cmds);
    expect(m.players[1]!.alive).toBe(false);
  });

  it('bots always respawn on their own', () => {
    const roster = [
      { slot: 0, name: 'Me', color: 1, kind: 'human' as const },
      { slot: 1, name: 'Bot', color: 2, kind: 'bot' as const, bot: 'normal' as const },
    ];
    const m = createMatch(sanitizeSettings({ orbRate: 'off', antiTurtleSec: 0, respawnMode: 'manual', respawnSec: 1 }), roster, 99, arena);
    const cmds = [cmd(), cmd()];
    run(m, m.liveAt + 5, cmds);
    kill(m, 0, 1);
    expect(m.players[1]!.alive).toBe(false);
    run(m, secToTicks(1.1), cmds);
    expect(m.players[1]!.alive).toBe(true);
  });

  it("'auto' keeps the old timer-only behaviour", () => {
    const m = makeMatch(2, { respawnMode: 'auto', respawnSec: 1 });
    const cmds = [cmd(), cmd()];
    run(m, m.liveAt + 5, cmds);
    kill(m, 0, 1);
    run(m, secToTicks(1.1), cmds);
    expect(m.players[1]!.alive).toBe(true);
  });

  it('defaults to manual', () => {
    expect(sanitizeSettings({}).respawnMode).toBe('manual');
    expect(sanitizeSettings({ respawnMode: 'bogus' }).respawnMode).toBe('manual');
  });
});
