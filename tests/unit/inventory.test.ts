import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/shared/rng';
import { sub, yawPitchOf } from '../../src/shared/vec';
import { secToTicks } from '../../src/sim/constants';
import { INV_MAX, invCount } from '../../src/sim/inventory';
import { collectPowerup, damagePlayer, hasPowerup, playerEye } from '../../src/sim/match';
import { orbPos } from '../../src/sim/orbs';
import type { PowerUpId } from '../../src/sim/powerups';
import type { PlayerCommand, SimEvent } from '../../src/sim/types';
import { botMatch } from './botMatch';
import { arena, liveAndStanding, makeMatch, run } from './helpers';

const ctx = () => ({ arena, rng: new Rng(1), events: [] as SimEvent[] });

/** Press Use `n` times (one command) with `id` picked. */
function use(m: ReturnType<typeof makeMatch>, cmds: PlayerCommand[], slot: number, id: PowerUpId, n = 1) {
  cmds[slot] = { ...cmds[slot]!, uses: cmds[slot]!.uses + n, useId: id };
  return run(m, 1, cmds);
}

describe('power-up inventory', () => {
  it('holds up to two of each kind, and any number of kinds', () => {
    const m = makeMatch(2);
    liveAndStanding(m);
    const p = m.players[0]!;
    const c = ctx();
    for (let i = 0; i < 3; i++) collectPowerup(m, c, p, 'homing');
    for (const id of ['overshield', 'camo', 'damage', 'xray', 'bighead', 'spring'] as const) collectPowerup(m, c, p, id);
    expect(invCount(p, 'homing')).toBe(INV_MAX);
    expect(p.inv.map((x) => x.id)).toEqual(['homing', 'overshield', 'camo', 'damage', 'xray', 'bighead', 'spring']);
    const got = c.events.filter((e): e is Extract<SimEvent, { k: 'got' }> => e.k === 'got');
    expect(got[0]).toEqual({ k: 'got', t: m.tick, p: 0, id: 'homing', n: 1 });
    expect(got[2]).toEqual({ k: 'got', t: m.tick, p: 0, id: 'homing', n: 2, full: true });
    // nothing is running until it's used
    expect(p.powerups).toEqual([]);
  });

  it('popping a bubble puts its power-up in the inventory instead of switching it on', () => {
    const m = makeMatch(2, { weapon: 'sniper' });
    const cmds = liveAndStanding(m);
    const p = m.players[0]!;
    const eye = playerEye(m, arena, p);
    // a bubble the shooter can see
    let orb = { id: 900, type: 'damage' as PowerUpId, seed: 1, spawn: m.tick - 120, expire: m.tick + 2000 };
    for (let seed = 1; seed < 200; seed++) {
      orb = { ...orb, seed };
      if (arena.lineClear(eye, orbPos(orb, m.tick + 1, arena), 0.9)) break;
    }
    m.orbs.push(orb);
    const a = yawPitchOf(sub(orbPos(orb, m.tick + 1, arena), eye));
    cmds[0] = { ...cmds[0]!, yaw: a.yaw, pitch: a.pitch, presses: cmds[0]!.presses + 1 };
    const ev = run(m, 1, cmds);
    expect(ev.some((e) => e.k === 'orbPop' && e.p === 0)).toBe(true);
    expect(ev.some((e) => e.k === 'got' && e.id === 'damage')).toBe(true);
    expect(ev.some((e) => e.k === 'pu')).toBe(false);
    expect(invCount(p, 'damage')).toBe(1);
    expect(hasPowerup(p, 'damage', m.tick)).toBe(false);
  });

  it('using one switches it on; a second one while it runs makes it last twice as long', () => {
    const m = makeMatch(2);
    const cmds = liveAndStanding(m);
    const p = m.players[0]!;
    collectPowerup(m, ctx(), p, 'homing');
    collectPowerup(m, ctx(), p, 'homing');
    const ev = use(m, cmds, 0, 'homing');
    expect(ev.some((e) => e.k === 'pu' && e.id === 'homing' && e.p === 0)).toBe(true);
    const dur = secToTicks(15);
    expect(p.powerups).toEqual([{ id: 'homing', until: m.tick + dur }]);
    expect(invCount(p, 'homing')).toBe(1);
    run(m, 60, cmds);
    const until = p.powerups[0]!.until;
    use(m, cmds, 0, 'homing');
    expect(p.powerups).toEqual([{ id: 'homing', until: until + dur }]);
    expect(p.inv).toEqual([]);
  });

  it('two quick presses use two back to back', () => {
    const m = makeMatch(2);
    const cmds = liveAndStanding(m);
    const p = m.players[0]!;
    collectPowerup(m, ctx(), p, 'damage');
    collectPowerup(m, ctx(), p, 'damage');
    use(m, cmds, 0, 'damage', 2);
    expect(invCount(p, 'damage')).toBe(0);
    expect(p.powerups).toEqual([{ id: 'damage', until: m.tick + 2 * secToTicks(20) }]);
  });

  it('weapon power-ups: more of the same timed weapon lasts longer, a one-shot still in your hands is kept', () => {
    const m = makeMatch(2);
    const cmds = liveAndStanding(m);
    const p = m.players[0]!;
    collectPowerup(m, ctx(), p, 'minigun');
    collectPowerup(m, ctx(), p, 'minigun');
    use(m, cmds, 0, 'minigun');
    expect(p.weapon).toBe('minigun');
    const until = p.weaponUntil;
    use(m, cmds, 0, 'minigun');
    expect(p.weaponUntil).toBe(until + secToTicks(10));
    // a Super Soaker replaces it; a second one waits until the first has been squirted
    collectPowerup(m, ctx(), p, 'sauce');
    collectPowerup(m, ctx(), p, 'sauce');
    use(m, cmds, 0, 'sauce');
    expect(p.weapon).toBe('soaker');
    expect(hasPowerup(p, 'minigun', m.tick)).toBe(false);
    use(m, cmds, 0, 'sauce');
    expect(invCount(p, 'sauce')).toBe(1);
  });

  it('a press counts once, and one for something you don’t have does nothing', () => {
    const m = makeMatch(2);
    const cmds = liveAndStanding(m);
    const p = m.players[0]!;
    use(m, cmds, 0, 'camo');
    expect(hasPowerup(p, 'camo', m.tick)).toBe(false);
    // the old press isn't replayed when one arrives
    collectPowerup(m, ctx(), p, 'camo');
    run(m, 5, cmds);
    expect(hasPowerup(p, 'camo', m.tick)).toBe(false);
    use(m, cmds, 0, 'camo');
    expect(hasPowerup(p, 'camo', m.tick)).toBe(true);
  });

  it('dying loses the whole inventory', () => {
    const m = makeMatch(2, { respawnSec: 1 });
    const cmds = liveAndStanding(m);
    const p = m.players[0]!;
    for (const id of ['spring', 'homing', 'homing', 'overshield'] as const) collectPowerup(m, ctx(), p, id);
    damagePlayer(m, ctx(), 1, p, 999, { head: false, weapon: 'sniper', kind: 'direct' });
    expect(p.inv).toEqual([]);
    run(m, secToTicks(1.5), cmds);
    expect(p.alive).toBe(true);
    expect(p.inv).toEqual([]);
  });

  it('bots collect power-ups and use them', () => {
    const { events } = botMatch(['normal', 'heroic', 'legendary'], { orbRate: 'chaos', powerups: ['damage', 'overshield', 'camo', 'homing', 'minigun'] }, 120, 4);
    const got = events.filter((e) => e.k === 'got').length;
    const used = events.filter((e) => e.k === 'pu').length;
    console.log('bots: collected', got, 'used', used);
    expect(got).toBeGreaterThan(0);
    expect(used).toBeGreaterThan(0);
  });
});
