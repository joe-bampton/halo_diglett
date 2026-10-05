import { BotBrain } from '../../src/bots/brain';
import { createMatch, stepMatch } from '../../src/sim/match';
import { sanitizeSettings, type Settings } from '../../src/sim/settings';
import type { BotDifficulty, RosterEntry, SimEvent } from '../../src/sim/types';
import { arena } from './helpers';

/** A bots-only match run tick by tick, collecting events and voice callouts. */
export function botMatch(diffs: BotDifficulty[], s: Partial<Settings>, seconds: number, seed = 99) {
  const roster: RosterEntry[] = diffs.map((d, i) => ({ slot: i, name: d, color: 0, kind: 'bot', bot: d }));
  const m = createMatch(sanitizeSettings({ scoreLimit: 0, timeLimitMin: 0, ...s }), roster, seed, arena);
  const brains = diffs.map((d, i) => new BotBrain(i, d, seed));
  const events: SimEvent[] = [];
  const callouts: { p: number; key: string }[] = [];
  const t0 = performance.now();
  for (let i = 0; i < seconds * 60 && m.phase !== 'ended'; i++) {
    const cmds = brains.map((b) => b.think(m, arena));
    const ev = stepMatch(m, cmds, arena);
    for (const b of brains) {
      if (b.callout) callouts.push({ p: b.slot, key: b.callout });
      b.callout = null;
      b.onEvents(ev);
    }
    events.push(...ev);
  }
  const ms = (performance.now() - t0) / (seconds * 60);
  return { m, ms, events, callouts };
}
