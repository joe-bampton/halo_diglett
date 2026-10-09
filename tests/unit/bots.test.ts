import { describe, expect, it } from 'vitest';
import { BotBrain } from '../../src/bots/brain';
import { Rng } from '../../src/shared/rng';
import { createMatch, damagePlayer, stepMatch } from '../../src/sim/match';
import { sanitizeSettings } from '../../src/sim/settings';
import { HIDDEN_EXPOSURE, RISE_TIME, TICK_RATE } from '../../src/sim/constants';
import type { PlayerCommand, RosterEntry, SimEvent } from '../../src/sim/types';
import { botMatch } from './botMatch';
import { arena, cmd, faceOff } from './helpers';

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

  for (const weapon of ['br', 'crossbow', 'rpg', 'grenade', 'railgun', 'hyperbeam', 'needler', 'frag', 'plasma'] as const) {
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

  it('Jerry bots never hurt anyone: they stand up and spray the sky yelling', () => {
    const { m, events, callouts } = botMatch(['jerry', 'jerry', 'jerry'], {}, 90, 11);
    const ps = m.players.filter(Boolean).map((p) => p!);
    expect(ps.reduce((a, p) => a + p.kills, 0)).toBe(0);
    expect(events.some((e) => e.k === 'dmg' && e.amt > 0)).toBe(false);
    const fires = events.filter((e): e is Extract<SimEvent, { k: 'fire' }> => e.k === 'fire');
    expect(fires.length).toBeGreaterThan(10);
    for (const f of fires) {
      const [dx, dy, dz] = [f.e[0] - f.o[0], f.e[1] - f.o[1], f.e[2] - f.o[2]];
      expect(dy / Math.hypot(dx, dy, dz)).toBeGreaterThan(Math.sin(0.75));
    }
    expect(callouts.length).toBeGreaterThan(3);
    expect(callouts.every((c) => c.key === 'jerry.suppress')).toBe(true);
  });

  it('Top/Over hacks: beats Legendary bots with (almost) nothing but headshots', () => {
    const { m } = botMatch(['topover', 'legendary', 'legendary', 'legendary'], {}, 120, 5);
    const [top, ...rest] = m.players.filter(Boolean).map((p) => p!);
    console.log('top/over', `${top!.kills}/${top!.deaths} hs ${top!.headshots}`, rest.map((p) => `${p.kills}/${p.deaths}`).join(' '));
    expect(top!.kills).toBeGreaterThan(10);
    for (const p of rest) expect(top!.kills).toBeGreaterThan(p.kills * 2);
    expect(top!.headshots / top!.kills).toBeGreaterThan(0.9);
  });

  it('Top/Over shoots the first tick a popping-up head can be hit', () => {
    const roster: RosterEntry[] = [
      { slot: 0, name: 'Hacker', color: 0, kind: 'bot', bot: 'topover' },
      { slot: 1, name: 'Me', color: 1, kind: 'human' },
    ];
    const m = createMatch(sanitizeSettings({ orbRate: 'off', antiTurtleSec: 0, respawnMode: 'auto' }), roster, 3, arena);
    faceOff(m);
    const brain = new BotBrain(0, 'topover', 3);
    const cmds: (PlayerCommand | undefined)[] = [undefined, cmd()];
    const step = () => {
      cmds[0] = brain.think(m, arena);
      const ev = stepMatch(m, cmds.map((c) => c && { ...c, vt: m.tick }), arena);
      brain.onEvents(ev);
      return ev;
    };
    // let the hacker stand up and settle while the human stays ducked
    while (m.tick < m.liveAt + 90) step();
    expect(m.players[1]!.alive).toBe(true);
    cmds[1] = cmd({ stand: true });
    let firstHit = -1;
    let popped = -1;
    for (let i = 0; i < 60 && firstHit < 0; i++) {
      const ev = step();
      if (popped < 0 && m.players[1]!.exposure > 0) popped = m.tick;
      if (ev.some((e) => e.k === 'dmg' && e.v === 1)) firstHit = m.tick;
    }
    expect(firstHit).toBeGreaterThan(0);
    // the head clears the rim a few ticks after the player starts rising
    expect(firstHit - popped).toBeLessThanOrEqual(Math.ceil(HIDDEN_EXPOSURE * RISE_TIME * TICK_RATE) + 1);
    expect(m.players[1]!.alive).toBe(false);
  });

  it('a Top/Over head hit kills with any gun, unless overshielded', () => {
    const roster: RosterEntry[] = [
      { slot: 0, name: 'Hacker', color: 0, kind: 'bot', bot: 'topover' },
      { slot: 1, name: 'Me', color: 1, kind: 'human' },
      { slot: 2, name: 'Bot', color: 2, kind: 'bot', bot: 'normal' },
    ];
    const m = createMatch(sanitizeSettings({ orbRate: 'off', weapon: 'br' }), roster, 3, arena);
    while (m.tick < m.liveAt + 1) stepMatch(m, [], arena);
    const ctx = { arena, rng: new Rng(1), events: [] as SimEvent[] };
    damagePlayer(m, ctx, 0, m.players[1]!, 11, { head: true, weapon: 'br', kind: 'direct', headMult: 2.5 });
    expect(m.players[1]!.alive).toBe(false);
    // a normal bot's BR headshot only chips the shield
    damagePlayer(m, ctx, 2, m.players[0]!, 11, { head: true, weapon: 'br', kind: 'direct', headMult: 2.5 });
    expect(m.players[0]!.alive).toBe(true);
    // overshield stops the hack
    m.players[2]!.overshield = 70;
    damagePlayer(m, ctx, 0, m.players[2]!, 11, { head: true, weapon: 'br', kind: 'direct', headMult: 2.5 });
    expect(m.players[2]!.alive).toBe(true);
  });

  it('bots use Spring Jumps', () => {
    const { events } = botMatch(['jerry', 'topover', 'legendary', 'normal'], { orbRate: 'chaos', powerups: ['spring'] }, 90, 21);
    const springs = events.filter((e) => e.k === 'spring');
    console.log('spring launches', springs.length);
    expect(springs.length).toBeGreaterThan(2);
  });
});
