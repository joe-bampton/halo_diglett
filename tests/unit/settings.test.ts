import { describe, expect, it } from 'vitest';
import { POWERUP_IDS } from '../../src/sim/powerups';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA, SETTINGS_TABS, applyPreset, migrateSavedSettings, sanitizeSettings, settingsForStorage } from '../../src/sim/settings';
import { gameSummary, gameTitle, lobbyWeapon, resetTab, sameValue, tabChanged } from '../../src/ui/settingsSummary';
import { cmd, makeMatch, run } from './helpers';

describe('power-up settings', () => {
  it('allows switching every power-up off: no bubbles appear', () => {
    expect(sanitizeSettings({ orbRate: 'chaos', powerups: [] }).powerups).toEqual([]);
    const m = makeMatch(2, { orbRate: 'chaos', powerups: [] });
    run(m, m.liveAt + 60 * 20, [cmd(), cmd()]);
    expect(m.orbs.length).toBe(0);
  });

  it('defaults to every power-up', () => {
    expect(sanitizeSettings({}).powerups).toEqual(POWERUP_IDS);
  });

  it('migrates saved settings: power-ups the save did not know about start enabled', () => {
    const s = migrateSavedSettings({ ...DEFAULT_SETTINGS, powerups: ['minigun'], knownPowerups: ['minigun', 'camo'] });
    expect(s.powerups).toContain('minigun');
    // known to the save and switched off: stays off
    expect(s.powerups).not.toContain('camo');
    // unknown to the save: on
    expect(s.powerups).toContain('overshield');
  });

  it('keeps an old save (no marker) as it was for the original power-ups', () => {
    const s = migrateSavedSettings({ powerups: ['minigun', 'camo'] });
    expect(s.powerups).toContain('minigun');
    expect(s.powerups).toContain('camo');
    expect(s.powerups).not.toContain('overshield');
  });

  it('round-trips through storage', () => {
    const s = sanitizeSettings({ powerups: ['xray'], orbRate: 'high' });
    expect(migrateSavedSettings(JSON.parse(JSON.stringify(settingsForStorage(s))))).toEqual(s);
    expect(migrateSavedSettings(null)).toEqual(sanitizeSettings(DEFAULT_SETTINGS));
  });

  it('moves an old save off the old 150 ms lag-compensation default, but keeps a deliberate choice', () => {
    expect(migrateSavedSettings({ maxRewindMs: 150 }).maxRewindMs).toBe(250);
    expect(migrateSavedSettings({ maxRewindMs: 100 }).maxRewindMs).toBe(100);
    // a save from this version means what it says
    expect(migrateSavedSettings(settingsForStorage(sanitizeSettings({ maxRewindMs: 150 }))).maxRewindMs).toBe(150);
    expect(sanitizeSettings({ maxRewindMs: 400 }).maxRewindMs).toBe(400);
  });
});

describe('settings window tabs', () => {
  it('puts every settings group on exactly one tab, five tabs in all', () => {
    expect(SETTINGS_TABS).toHaveLength(5);
    const groups = new Set(SETTINGS_SCHEMA.map((f) => f.group));
    for (const g of groups) expect(SETTINGS_TABS.filter((t) => t.groups.includes(g))).toHaveLength(1);
    for (const t of SETTINGS_TABS) for (const g of t.groups) expect(groups.has(g)).toBe(true);
  });

  it('marks the tabs that hold changes, and resets one tab without touching the others', () => {
    const tab = (id: string) => SETTINGS_TABS.find((t) => t.id === id)!;
    const d = sanitizeSettings({});
    expect(SETTINGS_TABS.filter((t) => tabChanged(d, t))).toEqual([]);
    const s = sanitizeSettings({ headshotsOnly: true, holeCount: 9, timeLimitMin: 5 });
    expect(SETTINGS_TABS.filter((t) => tabChanged(s, t)).map((t) => t.id)).toEqual(['game', 'rules', 'map']);
    const r = resetTab(s, tab('rules'));
    expect(r.headshotsOnly).toBe(false);
    expect(r.holeCount).toBe(9);
    expect(r.timeLimitMin).toBe(5);
    // a hidden field doesn't count: the Gun Game order only shows in Gun Game
    expect(tabChanged(sanitizeSettings({ gunGameOrder: ['sniper', 'br'] }), tab('game'))).toBe(false);
  });
});

describe('lobby summary', () => {
  it('names the game: Standard, a preset, or Custom', () => {
    expect(gameTitle(sanitizeSettings({}))).toBe('Standard');
    expect(gameTitle(applyPreset(sanitizeSettings({}), 'rockets'))).toBe('Rocket Whack');
    expect(gameTitle(sanitizeSettings({ ...applyPreset(sanitizeSettings({}), 'rockets'), timeLimitMin: 3 }))).toBe('Custom');
    // the order power-ups were switched back on in doesn't matter
    expect(gameTitle(sanitizeSettings({ powerups: [...POWERUP_IDS].reverse() }))).toBe('Standard');
    expect(sameValue('powerups', ['xray', 'camo'], ['camo', 'xray'])).toBe(true);
    // ...but the Gun Game order does
    expect(sameValue('gunGameOrder', ['sniper', 'br'], ['br', 'sniper'])).toBe(false);
  });

  it('sums up the game in a few lines and chips', () => {
    const d = gameSummary(sanitizeSettings({}));
    expect(d.lines).toEqual(['Sniper Rifle for everyone', 'First to 25 kills · 10 min', 'Normal power-ups']);
    expect(d.chips).toEqual([]);
    const s = gameSummary(sanitizeSettings({ weaponMode: 'gunGame', timeLimitMin: 0, orbRate: 'high', powerups: ['xray', 'camo'], headshotsOnly: true, ammoMode: 'noReload', skulls: ['fog'], pitre: true }));
    expect(s.lines[0]).toMatch(/^Gun Game: \d+ levels/);
    expect(s.lines[1]).toBe('Win: get through every gun · no time limit');
    expect(s.lines[2]).toBe(`Lots of power-ups (2 of ${POWERUP_IDS.length})`);
    expect(s.chips).toEqual(['Headshots only', 'Bottomless clips', '💀 Fog', '🎩 Pitre Mode']);
    expect(gameSummary(sanitizeSettings({ orbRate: 'off' })).lines[2]).toBe('No power-ups');
  });

  it('shows each Spartan in the lobby with the gun they’ll have', () => {
    expect(lobbyWeapon(sanitizeSettings({ weapon: 'rpg' }), 3)).toBe('rpg');
    const choice = sanitizeSettings({ weaponMode: 'choice', allowedWeapons: ['br', 'needler'] });
    expect(lobbyWeapon(choice, 0, 'needler')).toBe('needler');
    expect(lobbyWeapon(choice, 0, 'sniper')).toBe('br');
    expect(lobbyWeapon(choice, 0)).toBe('br');
    const gg = sanitizeSettings({ weaponMode: 'gunGame' });
    expect(lobbyWeapon(gg, 2)).toBe(gg.gunGameOrder[0]);
    const rnd = sanitizeSettings({ weaponMode: 'randomLife', allowedWeapons: ['br', 'needler', 'rpg'] });
    expect([0, 1, 2, 3].map((i) => lobbyWeapon(rnd, i))).toEqual(['br', 'needler', 'rpg', 'br']);
  });
});

it('a save from before the Poké Ball gets it switched on', () => {
  const before = POWERUP_IDS.filter((id) => id !== 'pokeball');
  expect(migrateSavedSettings({ powerups: ['minigun'], knownPowerups: before }).powerups).toEqual(['minigun', 'pokeball']);
});
