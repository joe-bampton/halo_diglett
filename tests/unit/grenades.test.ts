import { describe, expect, it } from 'vitest';
import { yawPitchOf } from '../../src/shared/vec';
import { launchDir, playerHitbox, stepMatch } from '../../src/sim/match';
import { migrateSavedSettings, sanitizeSettings } from '../../src/sim/settings';
import type { MatchState, PlayerCommand, Projectile, SimEvent } from '../../src/sim/types';
import { WEAPONS, type WeaponId } from '../../src/sim/weapons';
import { arena, cmd, faceOff, liveAndStanding, makeMatch, run } from './helpers';

/** Put a live grenade of `weapon` at a point with a velocity, thrown by slot 0. */
function drop(m: MatchState, weapon: WeaponId, p: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, fuse = 3): Projectile {
  const pr: Projectile = { id: m.nextId++, owner: 0, weapon, x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, born: m.tick - 30, bounces: 0, target: -1, fuseAt: m.tick + Math.round(fuse * 60), y0: p.y };
  m.projectiles.push(pr);
  return pr;
}

function standingPair(): { m: MatchState; cmds: PlayerCommand[] } {
  const m = makeMatch(2, { weapon: 'frag' });
  faceOff(m);
  return { m, cmds: liveAndStanding(m) };
}

describe('frag grenade', () => {
  it('is thrown above the aim', () => {
    const d = launchDir({ x: 0, y: 0, z: -1 }, WEAPONS.frag.projectile!);
    expect(yawPitchOf(d).pitch).toBeCloseTo((8 * Math.PI) / 180, 5);
  });

  it('glances off a player instead of going off on them, then explodes on its fuse', () => {
    const { m, cmds } = standingPair();
    const hb = playerHitbox(m, arena, m.players[1]!);
    const pr = drop(m, 'frag', { x: hb.head.x + 3, y: hb.torsoB.y, z: hb.head.z }, { x: -15, y: 0, z: 0 }, 1.5);
    const ev = run(m, 30, cmds);
    expect(ev.some((e) => e.k === 'pmove' && e.id === pr.id && e.on === undefined)).toBe(true);
    expect(ev.some((e) => e.k === 'dmg')).toBe(false);
    expect(ev.some((e) => e.k === 'pend' && e.id === pr.id)).toBe(false);
    const later = run(m, 90, cmds);
    expect(later.some((e) => e.k === 'boom' && e.w === 'frag')).toBe(true);
  });

  it('rolling into a ducked player’s hole gets them', () => {
    const { m, cmds } = standingPair();
    cmds[1] = cmd({ stand: false });
    run(m, 30, cmds);
    const h = arena.holes[m.players[1]!.hole]!;
    drop(m, 'frag', { x: h.x + 0.2, y: h.rim + 1.5, z: h.z }, { x: 0, y: -6, z: 0 });
    run(m, 30, cmds);
    expect(m.players[1]!.alive).toBe(false);
  });

  it('comes to rest on the ground and waits for its fuse', () => {
    const { m, cmds } = standingPair();
    const h = arena.holes[m.players[0]!.hole]!;
    const at = { x: h.x + 6, z: h.z + 6 };
    const pr = drop(m, 'frag', { x: at.x, y: arena.solidAt(at.x, at.z) + 0.6, z: at.z }, { x: 0, y: -1, z: 0 }, 2.5);
    run(m, 60, cmds);
    expect(m.projectiles.find((p) => p.id === pr.id)?.stuck).toBe(-1);
    const ev = run(m, 120, cmds);
    expect(ev.some((e) => e.k === 'boom' && e.w === 'frag')).toBe(true);
  });
});

describe('plasma grenade', () => {
  it('sticks to a player, rides along when they duck, and kills them anyway', () => {
    const { m, cmds } = standingPair();
    const victim = m.players[1]!;
    const hb = playerHitbox(m, arena, victim);
    const pr = drop(m, 'plasma', { x: hb.head.x + 3, y: hb.torsoB.y, z: hb.head.z }, { x: -15, y: 0, z: 0 });
    let ev: SimEvent[] = run(m, 15, cmds);
    expect(ev.some((e) => e.k === 'pmove' && e.id === pr.id && e.on === 1)).toBe(true);
    expect(ev.some((e) => e.k === 'medal' && e.id === 'stuck' && e.p === 0)).toBe(true);
    // the victim ducks: the grenade goes down with them
    cmds[1] = cmd({ stand: false });
    ev = run(m, 20, cmds);
    expect(victim.exposure).toBe(0);
    const stuck = m.projectiles.find((p) => p.id === pr.id)!;
    expect(stuck.y).toBeLessThan(arena.holes[victim.hole]!.rim);
    ev = run(m, 60, cmds);
    expect(ev.some((e) => e.k === 'boom' && e.w === 'plasma')).toBe(true);
    expect(victim.alive).toBe(false);
  });

  it('sticks to the ground where it lands', () => {
    const { m, cmds } = standingPair();
    const h = arena.holes[m.players[0]!.hole]!;
    const at = { x: h.x + 6, z: h.z + 6 };
    const pr = drop(m, 'plasma', { x: at.x, y: arena.solidAt(at.x, at.z) + 1, z: at.z }, { x: 3, y: -4, z: 0 });
    const ev = run(m, 30, cmds);
    expect(ev.some((e) => e.k === 'pmove' && e.id === pr.id && e.on === -1)).toBe(true);
    expect(run(m, 80, cmds).some((e) => e.k === 'boom' && e.w === 'plasma')).toBe(true);
  });

  it('a host-thrown plasma grenade is fired from the weapon', () => {
    const m = makeMatch(2, { weapon: 'plasma' });
    faceOff(m);
    const cmds = liveAndStanding(m);
    cmds[0] = { ...cmds[0]!, presses: cmds[0]!.presses + 1 };
    const ev = stepMatch(m, cmds.map((c) => c && { ...c, vt: m.tick }), arena);
    expect(ev.some((e) => e.k === 'proj' && e.w === 'plasma')).toBe(true);
  });
});

describe('saved settings', () => {
  it('an old saved lobby gets the new grenades', () => {
    const s = migrateSavedSettings({ allowedWeapons: ['sniper', 'rpg'], gunGameOrder: ['railgun', 'sniper', 'crossbow', 'br', 'needler', 'hyperbeam', 'rpg', 'grenade'] });
    expect(s.allowedWeapons).toEqual(['sniper', 'rpg', 'frag', 'plasma']);
    expect(s.gunGameOrder).toContain('plasma');
    // ...but one saved by this version keeps its choices
    const kept = migrateSavedSettings({ allowedWeapons: ['sniper'], knownWeapons: Object.keys(WEAPONS) });
    expect(kept.allowedWeapons).toEqual(['sniper']);
    expect(sanitizeSettings({ weapon: 'frag' }).weapon).toBe('frag');
  });
});
