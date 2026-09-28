import { describe, expect, it } from 'vitest';
import { BotBrain } from '../../src/bots/brain';
import { createMatch, stepMatch } from '../../src/sim/match';
import { sanitizeSettings, type Settings } from '../../src/sim/settings';
import type { BotDifficulty, RosterEntry } from '../../src/sim/types';
import { arena } from './helpers';

export function botMatch(diffs: BotDifficulty[], s: Partial<Settings>, seconds: number, seed = 99) {
  const roster: RosterEntry[] = diffs.map((d, i) => ({ slot: i, name: d, color: 0, kind: 'bot', bot: d }));
  const m = createMatch(sanitizeSettings({ scoreLimit: 0, timeLimitMin: 0, ...s }), roster, seed, arena);
  const brains = diffs.map((d, i) => new BotBrain(i, d, seed));
  const t0 = performance.now();
  for (let i = 0; i < seconds * 60 && m.phase !== 'ended'; i++) {
    const cmds = brains.map((b) => b.think(m, arena));
    const ev = stepMatch(m, cmds, arena);
    for (const b of brains) b.onEvents(ev);
  }
  const ms = (performance.now() - t0) / (seconds * 60);
  return { m, ms };
}

describe('bots', () => {
  it('6 mixed bots play a sane sniper match', () => {
    const { m, ms } = botMatch(['recruit', 'recruit', 'normal', 'heroic', 'legendary', 'legendary'], {}, 180);
    const ps = m.players.filter(Boolean).map((p) => p!);
    for (const p of ps) {
      expect(Number.isFinite(p.yaw)).toBe(true);
      expect(Number.isFinite(p.shield)).toBe(true);
    }
    const kills = ps.map((p) => p.kills);
    console.log('kills', ps.map((p) => `${p.name}:${p.kills}/${p.deaths}`).join(' '), `tick ${ms.toFixed(3)}ms`);
    expect(kills.reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
    const leg = ps[4]!.kills + ps[5]!.kills;
    const rec = ps[0]!.kills + ps[1]!.kills;
    expect(leg).toBeGreaterThan(rec);
    expect(ms).toBeLessThan(1.5);
  });

  for (const weapon of ['br', 'crossbow', 'rpg', 'grenade', 'railgun', 'hyperbeam', 'needler'] as const) {
    it(`bots get kills with ${weapon}`, () => {
      const { m } = botMatch(['normal', 'heroic', 'legendary', 'heroic'], { weapon }, 120, 7);
      const total = m.players.filter(Boolean).reduce((a, p) => a + p!.kills, 0);
      console.log(weapon, m.players.filter(Boolean).map((p) => `${p!.kills}/${p!.deaths}`).join(' '));
      expect(total).toBeGreaterThan(3);
    });
  }

  it('orbs spawn and get claimed in chaos mode', () => {
    const { m } = botMatch(['legendary', 'legendary', 'heroic'], { orbRate: 'chaos' }, 120, 3);
    const claims = m.players.filter(Boolean).reduce((a, p) => a + (p!.medals.orb ?? 0), 0);
    console.log('orb claims', claims);
    expect(claims).toBeGreaterThan(0);
  });
});
