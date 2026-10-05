import { describe, expect, it } from 'vitest';
import { POWERUP_IDS } from '../../src/sim/powerups';
import { DEFAULT_SETTINGS, migrateSavedSettings, sanitizeSettings, settingsForStorage } from '../../src/sim/settings';
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
});
