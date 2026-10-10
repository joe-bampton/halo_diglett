import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/shared/rng';
import { sub, yawPitchOf } from '../../src/shared/vec';
import { secToTicks } from '../../src/sim/constants';
import { invCount } from '../../src/sim/inventory';
import { CAPTURE_SEC, collectPowerup, damagePlayer, grantPowerup, onField, playerEye, playerHitbox, removePlayer, seatOf, traceRay } from '../../src/sim/match';
import { SEAT_R } from '../../src/sim/seats';
import type { MatchState, PlayerCommand, Projectile, SimEvent } from '../../src/sim/types';
import { botMatch } from './botMatch';
import { arena, cmd, faceOff, liveAndStanding, makeMatch, run } from './helpers';

const ctx = () => ({ arena, rng: new Rng(1), events: [] as SimEvent[] });

/** A Poké Ball thrown by `owner` at a point with a velocity. */
function ball(m: MatchState, p: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, owner = 0): Projectile {
  const pr: Projectile = { id: m.nextId++, owner, weapon: 'pokeball', x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, born: m.tick - 30, bounces: 0, target: -1, fuseAt: m.tick + 120, y0: p.y };
  m.projectiles.push(pr);
  return pr;
}

/** Three players up in their holes; 0 and 1 can see each other. */
function setup(over = {}) {
  const m = makeMatch(3, { weapon: 'sniper', ...over });
  faceOff(m);
  if (m.players[2]!.hole === m.players[0]!.hole || m.players[2]!.hole === m.players[1]!.hole) m.players[2]!.hole = m.activeHoles.find((h) => h !== m.players[0]!.hole && h !== m.players[1]!.hole)!;
  const cmds = liveAndStanding(m, [0, 1, 2]);
  return { m, cmds };
}

/** Player 0 throws a ball that hits player 1 side-on. */
function catchOne(m: MatchState, cmds: PlayerCommand[]) {
  const hb = playerHitbox(m, arena, m.players[1]!);
  ball(m, { x: hb.head.x + 3, y: hb.torsoB.y, z: hb.head.z }, { x: -15, y: 0, z: 0 });
  return run(m, 15, cmds);
}

/** Player 0 throws on whoever they caught (a fresh click: it goes once the ball is ready). */
function throwOn(m: MatchState, cmds: PlayerCommand[]) {
  cmds[0] = { ...cmds[0]!, presses: cmds[0]!.presses + 1 };
  const ev: SimEvent[] = [];
  for (let i = 0; i < 12 && !m.projectiles.some((p) => p.cap !== undefined); i++) ev.push(...run(m, 1, cmds));
  const pr = m.projectiles.find((p) => p.cap !== undefined)!;
  expect(pr).toBeDefined();
  return { ev, pr };
}

/** …and the ball comes straight down into `hole`. */
function throwInto(m: MatchState, cmds: PlayerCommand[], hole: number) {
  const { ev, pr } = throwOn(m, cmds);
  const h = arena.holes[hole]!;
  Object.assign(pr, { x: h.x + 0.1, y: h.rim + 1.5, z: h.z, vx: 0, vy: -6, vz: 0 });
  return [...ev, ...run(m, 30, cmds)];
}

const freeHole = (m: MatchState) => m.activeHoles.find((h) => !m.players.some((p) => p?.hole === h))!;

describe('Poké Ball', () => {
  it('a hit catches the opponent: off the field, and the ball is back in the thrower’s hand', () => {
    const { m, cmds } = setup();
    const ev = catchOne(m, cmds);
    const [a, v] = [m.players[0]!, m.players[1]!];
    expect(ev.some((e) => e.k === 'capture' && e.p === 0 && e.v === 1)).toBe(true);
    expect(ev.some((e) => e.k === 'medal' && e.p === 0 && e.id === 'gotcha')).toBe(true);
    expect(v.capturedBy).toBe(0);
    expect(onField(v)).toBe(false);
    expect(a.weapon).toBe('pokeball');
    expect(a.captive).toBe(1);
    expect(a.weaponUntil).toBe(v.captureUntil);
    // nothing reaches them in there
    damagePlayer(m, ctx(), 2, v, 999, { head: true, weapon: 'sniper', kind: 'direct' });
    expect(v.alive).toBe(true);
    const o = playerEye(m, arena, m.players[2]!);
    const head = playerHitbox(m, arena, v).head;
    expect(traceRay(m, arena, m.players[2]!, o, { ...sub(head, o) }, 400, m.tick).hits.some((h) => h.slot === 1)).toBe(false);
  });

  it('one dropped into a ducked player’s hole catches them', () => {
    const { m, cmds } = setup();
    cmds[1] = cmd({ stand: false });
    run(m, 30, cmds);
    const h = arena.holes[m.players[1]!.hole]!;
    ball(m, { x: h.x + 0.1, y: h.rim + 1.5, z: h.z }, { x: 0, y: -6, z: 0 });
    const ev = run(m, 20, cmds);
    expect(ev.some((e) => e.k === 'capture' && e.v === 1)).toBe(true);
  });

  it('bounces off the invincible, never catches its thrower, and pops open empty on a miss', () => {
    const { m, cmds } = setup();
    grantPowerup(m, ctx(), m.players[1]!, 'invincible');
    const ev = catchOne(m, cmds);
    expect(ev.some((e) => e.k === 'capture')).toBe(false);
    expect(ev.some((e) => e.k === 'pmove')).toBe(true);
    const own = playerHitbox(m, arena, m.players[0]!);
    ball(m, { x: own.head.x + 3, y: own.torsoB.y, z: own.head.z }, { x: -15, y: 0, z: 0 });
    expect(run(m, 15, cmds).some((e) => e.k === 'capture')).toBe(false);
    // on the grass, away from the holes: it opens on its fuse with nobody in it
    m.projectiles = [];
    const h = arena.holes[m.players[0]!.hole]!;
    const pr = ball(m, { x: h.x + 6, y: arena.solidAt(h.x + 6, h.z + 6) + 0.5, z: h.z + 6 }, { x: 0, y: -1, z: 0 });
    const later = run(m, 150, cmds);
    expect(later.some((e) => e.k === 'pend' && e.id === pr.id)).toBe(true);
    expect(later.some((e) => e.k === 'capture')).toBe(false);
  });

  it('thrown into an empty hole: out they pop, stuck standing for a moment', () => {
    const { m, cmds } = setup();
    catchOne(m, cmds);
    const dest = freeHole(m);
    const ev = throwInto(m, cmds, dest);
    const v = m.players[1]!;
    const thrown = ev.find((e): e is Extract<SimEvent, { k: 'proj' }> => e.k === 'proj');
    expect(thrown?.cap).toBe(1);
    expect(ev.some((e) => e.k === 'release' && e.p === 0 && e.v === 1 && e.hole === dest)).toBe(true);
    expect(v.hole).toBe(dest);
    expect(onField(v)).toBe(true);
    expect(v.exposure).toBe(1);
    expect(v.forcedStandUntil).toBeGreaterThan(m.tick);
    // the thrower has their gun back
    expect(m.players[0]!.weapon).toBe('sniper');
    expect(m.players[0]!.shots).toBe(0);
  });

  it('thrown into your own hole: side by side, and hole-mates can shoot each other even ducked', () => {
    const { m, cmds } = setup();
    catchOne(m, cmds);
    const mine = m.players[0]!.hole;
    throwInto(m, cmds, mine);
    const [a, v] = [m.players[0]!, m.players[1]!];
    expect(v.hole).toBe(mine);
    const sa = seatOf(m, arena, a), sv = seatOf(m, arena, v);
    expect(Math.hypot(sa.x - sv.x, sa.z - sv.z)).toBeCloseTo(2 * SEAT_R, 5);
    // both duck (the released one once their moment standing is up)
    cmds[0] = cmd({ stand: false, presses: cmds[0]!.presses });
    cmds[1] = cmd({ stand: false });
    run(m, secToTicks(2), cmds);
    expect(a.exposure).toBe(0);
    expect(v.exposure).toBe(0);
    const ang = yawPitchOf(sub(playerHitbox(m, arena, v, v.exposure, a).head, playerEye(m, arena, a)));
    cmds[0] = { ...cmds[0]!, yaw: ang.yaw, pitch: ang.pitch, presses: cmds[0]!.presses + 1 };
    const ev = run(m, 1, cmds);
    expect(ev.some((e) => e.k === 'dmg' && e.a === 0 && e.v === 1 && e.amt > 0)).toBe(true);
  });

  it('thrown back into their own hole: home again', () => {
    const { m, cmds } = setup();
    const home = m.players[1]!.hole;
    catchOne(m, cmds);
    throwInto(m, cmds, home);
    expect(m.players[1]!.hole).toBe(home);
    expect(onField(m.players[1]!)).toBe(true);
  });

  it('not thrown on in time: they break free, back home and ducked', () => {
    const { m, cmds } = setup();
    const home = m.players[1]!.hole;
    catchOne(m, cmds);
    const v = m.players[1]!;
    let ev: SimEvent[] = [];
    for (let i = 0; i < secToTicks(CAPTURE_SEC) + 2 && !ev.some((e) => e.k === 'escape'); i++) ev = run(m, 1, cmds);
    expect(ev.some((e) => e.k === 'escape' && e.p === 0 && e.v === 1 && e.hole === home)).toBe(true);
    expect(onField(v)).toBe(true);
    expect(v.hole).toBe(home);
    expect(v.exposure).toBe(0);
    expect(m.players[0]!.weapon).toBe('sniper');
    expect(m.players[0]!.captive).toBe(-1);
  });

  it('the thrower dying lets them go; a ball already thrown still lands', () => {
    const { m, cmds } = setup();
    catchOne(m, cmds);
    damagePlayer(m, ctx(), 2, m.players[0]!, 999, { head: false, weapon: 'sniper', kind: 'direct' });
    expect(run(m, 1, cmds).some((e) => e.k === 'escape' && e.v === 1)).toBe(true);

    const s2 = setup();
    catchOne(s2.m, s2.cmds);
    throwOn(s2.m, s2.cmds);
    damagePlayer(s2.m, ctx(), 2, s2.m.players[0]!, 999, { head: false, weapon: 'sniper', kind: 'direct' });
    const ev = run(s2.m, 60 * 7, s2.cmds);
    expect(ev.some((e) => e.k === 'release' && e.v === 1)).toBe(true);
    expect(ev.some((e) => e.k === 'escape')).toBe(false);
  });

  it('a full ball that lands far from any hole still finds the nearest one', () => {
    const { m, cmds } = setup();
    catchOne(m, cmds);
    const { pr } = throwOn(m, cmds);
    const far = { x: arena.playRadius * 0.98, z: 0 };
    Object.assign(pr, { x: far.x, y: arena.solidAt(far.x, far.z) + 1, z: far.z, vx: 0, vy: -5, vz: 0 });
    const ev = run(m, 30, cmds);
    const r = ev.find((e): e is Extract<SimEvent, { k: 'release' }> => e.k === 'release');
    expect(r?.hole).toBe(arena.closestHole(far.x, far.z).id);
  });

  it('a plasma grenade stuck to them falls off when they’re caught', () => {
    const { m, cmds } = setup();
    const hb = playerHitbox(m, arena, m.players[1]!);
    const plasma: Projectile = { id: m.nextId++, owner: 2, weapon: 'plasma', x: hb.torsoB.x, y: hb.torsoB.y, z: hb.torsoB.z, vx: 0, vy: 0, vz: 0, born: m.tick - 10, bounces: 0, target: -1, fuseAt: m.tick + 200, stuck: 1, off: { x: 0, y: 0, z: 0 } };
    m.projectiles.push(plasma);
    const ev = catchOne(m, cmds);
    expect(ev.some((e) => e.k === 'pmove' && e.id === plasma.id && e.on === -1)).toBe(true);
    expect(plasma.stuck).toBe(-1);
  });

  it('the end of the match lets everyone out; a player leaving drops the links', () => {
    const { m, cmds } = setup({ timeLimitMin: 1 });
    catchOne(m, cmds);
    m.liveAt = m.tick - secToTicks(60) + 2;
    const ev = run(m, 3, cmds);
    expect(m.phase).toBe('ended');
    expect(ev.some((e) => e.k === 'escape' && e.v === 1)).toBe(true);
    expect(m.players[1]!.capturedBy).toBe(-1);

    const s2 = setup();
    catchOne(s2.m, s2.cmds);
    removePlayer(s2.m, 1);
    expect(s2.m.players[0]!.captive).toBe(-1);
    expect(s2.m.players[0]!.weapon).toBe('sniper');
    const s3 = setup();
    catchOne(s3.m, s3.cmds);
    removePlayer(s3.m, 0);
    run(s3.m, 1, [undefined, s3.cmds[1], s3.cmds[2]]);
    expect(onField(s3.m.players[1]!)).toBe(true);
  });

  it('from the inventory: Use takes it out, a click throws it (no shot counted), the gun comes straight back', () => {
    const { m, cmds } = setup();
    const p = m.players[0]!;
    collectPowerup(m, ctx(), p, 'pokeball');
    cmds[0] = { ...cmds[0]!, uses: 1, useId: 'pokeball' };
    run(m, 10, cmds);
    expect(p.weapon).toBe('pokeball');
    cmds[0] = { ...cmds[0]!, presses: cmds[0]!.presses + 1 };
    const ev = run(m, 2, cmds);
    expect(ev.some((e) => e.k === 'proj' && e.w === 'pokeball')).toBe(true);
    expect(p.weapon).toBe('sniper');
    expect(p.shots).toBe(0);
    // with someone in your hand, nothing else can be used
    collectPowerup(m, ctx(), p, 'damage');
    catchOne(m, cmds);
    cmds[0] = { ...cmds[0]!, uses: 2, useId: 'damage' };
    run(m, 1, cmds);
    expect(invCount(p, 'damage')).toBe(1);
  });

  it('caught, you can only look around: presses do nothing then, or later', () => {
    const { m, cmds } = setup();
    catchOne(m, cmds);
    const v = m.players[1]!;
    collectPowerup(m, ctx(), v, 'camo');
    cmds[1] = { ...cmds[1]!, stand: true, presses: 5, reloads: 3, uses: 2, useId: 'camo', yaw: 1.2 };
    const ev = run(m, 5, cmds);
    expect(ev.some((e) => (e.k === 'fire' || e.k === 'pu') && e.p === 1)).toBe(false);
    expect(v.yaw).toBeCloseTo(1.2);
    // let go (back home): the presses made inside don't go off now
    run(m, secToTicks(CAPTURE_SEC), cmds);
    expect(onField(v)).toBe(true);
    expect(run(m, 20, cmds).some((e) => (e.k === 'fire' || e.k === 'pu') && e.p === 1)).toBe(false);
    expect(invCount(v, 'camo')).toBe(1);
  });

  it('bots catch each other and throw them on (or let them escape)', () => {
    const { events } = botMatch(['heroic', 'legendary', 'normal', 'heroic'], { orbRate: 'chaos', powerups: ['pokeball'] }, 150, 17);
    const caught = events.filter((e) => e.k === 'capture').length;
    const thrown = events.filter((e) => e.k === 'release').length;
    const escaped = events.filter((e) => e.k === 'escape').length;
    console.log('bots: caught', caught, 'thrown', thrown, 'escaped', escaped);
    expect(caught).toBeGreaterThan(0);
    expect(thrown + escaped).toBeGreaterThan(0);
  });
});
