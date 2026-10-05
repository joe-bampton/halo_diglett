import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/shared/rng';
import { secToTicks } from '../../src/sim/constants';
import { damagePlayer, grantPowerup, hasPowerup, isCamo } from '../../src/sim/match';
import { sauceAimScale, sauceLeft } from '../../src/sim/sauce';
import type { SimEvent } from '../../src/sim/types';
import { arena, cmd, liveAndStanding, makeMatch, run } from './helpers';
import { botMatch } from './botMatch';

const ctx = () => ({ arena, rng: new Rng(1), events: [] as SimEvent[] });

describe('Gerry Sauce (Super Soaker)', () => {
  it('one squirt drenches everyone else a second later', () => {
    const m = makeMatch(4);
    const cmds = liveAndStanding(m, [0, 1, 2, 3]);
    const me = m.players[0]!;
    grantPowerup(m, ctx(), me, 'sauce');
    expect(me.weapon).toBe('soaker');
    grantPowerup(m, ctx(), m.players[3]!, 'invincible');
    grantPowerup(m, ctx(), m.players[2]!, 'camo');
    run(m, 10, cmds);
    cmds[0] = { ...cmds[0]!, presses: cmds[0]!.presses + 1 };
    const fired = run(m, 1, cmds);
    const squirt = fired.find((e): e is Extract<SimEvent, { k: 'sauce' }> => e.k === 'sauce');
    expect(squirt?.p).toBe(0);
    // single use, and it doesn't count as a missed shot
    expect(me.shots).toBe(0);
    run(m, 2, cmds);
    expect(me.weapon).not.toBe('soaker');
    expect(hasPowerup(me, 'sauce', m.tick)).toBe(false);
    // everyone ducks: it still lands on them
    for (const i of [1, 2, 3]) cmds[i] = cmd({ stand: false });
    const ev = run(m, secToTicks(1), cmds);
    const hit = ev.filter((e): e is Extract<SimEvent, { k: 'sauced' }> => e.k === 'sauced').map((e) => e.v);
    expect(hit.sort()).toEqual([1, 2]);
    const v = m.players[1]!;
    expect(v.saucedUntil - v.saucedAt).toBe(secToTicks(5));
    expect(m.players[0]!.saucedAt).toBe(-1);
    expect(m.players[3]!.saucedAt).toBe(-1);
    // stuck standing and visible while sauced…
    run(m, secToTicks(2), cmds);
    expect(v.exposure).toBe(1);
    expect(isCamo(m, m.players[2]!)).toBe(false);
    // …free again once it has cleared
    run(m, secToTicks(3.5), cmds);
    expect(v.exposure).toBe(0);
    expect(isCamo(m, m.players[2]!)).toBe(true);
  });

  it('aim speed starts slow and recovers as the sauce clears', () => {
    expect(sauceAimScale(100, 400, 99)).toBe(1);
    expect(sauceAimScale(100, 400, 100)).toBeCloseTo(0.2);
    expect(sauceAimScale(100, 400, 250)).toBeCloseTo(0.4);
    expect(sauceAimScale(100, 400, 399)).toBeGreaterThan(0.98);
    expect(sauceAimScale(100, 400, 400)).toBe(1);
    expect(sauceAimScale(-1, 0, 50)).toBe(1);
    expect(sauceLeft(100, 400, 100)).toBe(1);
    expect(sauceLeft(100, 400, 250)).toBeCloseTo(0.5);
    expect(sauceLeft(100, 400, 400)).toBe(0);
  });

  it('dying washes it off', () => {
    const m = makeMatch(2, { respawnSec: 1 });
    const cmds = liveAndStanding(m);
    grantPowerup(m, ctx(), m.players[0]!, 'sauce');
    cmds[0] = { ...cmds[0]!, presses: cmds[0]!.presses + 1 };
    run(m, secToTicks(1.2), cmds);
    const v = m.players[1]!;
    expect(v.saucedUntil).toBeGreaterThan(m.tick);
    damagePlayer(m, ctx(), 0, v, 999, { head: false, weapon: 'sniper', kind: 'direct' });
    run(m, secToTicks(1.2), cmds);
    expect(v.alive).toBe(true);
    expect(v.saucedAt).toBe(-1);
    expect(v.saucedUntil).toBe(0);
  });

  it('bots fire it straight away', () => {
    const { events } = botMatch(['jerry', 'normal', 'legendary'], { orbRate: 'chaos', powerups: ['sauce'] }, 90, 13);
    const squirts = events.filter((e) => e.k === 'sauce').length;
    const sauced = events.filter((e) => e.k === 'sauced').length;
    console.log('squirts', squirts, 'sauced', sauced);
    expect(squirts).toBeGreaterThan(0);
    expect(sauced).toBeGreaterThan(0);
  });
});
