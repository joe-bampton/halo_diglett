import { DEFAULT_GUNGAME, LOADOUT_WEAPONS, WEAPONS, type WeaponId } from './weapons';
import { POWERUP_IDS, POWERUPS, type PowerUpId } from './powerups';

export type WeaponMode = 'fixed' | 'choice' | 'randomLife' | 'gunGame';
export type SkullId = 'bighead' | 'gruntbday' | 'blackeye' | 'mythic' | 'fog';
export type OrbRate = 'off' | 'low' | 'normal' | 'high' | 'chaos';

export interface Settings {
  scoreLimit: number; // 0 = unlimited
  timeLimitMin: number; // 0 = unlimited
  holeCount: number; // 0 = Auto (classic 16-hole field)
  holeSpacing: number; // minimum metres between holes
  weaponMode: WeaponMode;
  weapon: WeaponId;
  allowedWeapons: WeaponId[];
  gunGameOrder: WeaponId[];
  damageMult: number;
  headshotsOnly: boolean;
  shields: 'off' | 'normal' | 'double';
  ammoMode: 'normal' | 'noReload';
  clipMult: number;
  reloadMult: number;
  respawnSec: number;
  respawnHole: 'same' | 'random';
  respawnMode: 'manual' | 'auto';
  antiTurtleSec: number; // 0 = off
  splashHitsDucked: boolean;
  underdogCamo: boolean;
  underdogKillGap: number;
  underdogDeathStreak: number;
  orbRate: OrbRate;
  powerups: PowerUpId[];
  powerupDurationMult: number;
  skulls: SkullId[];
  aimAssist: 'off' | 'low' | 'normal';
  maxRewindMs: number;
  pitre: boolean;
  pitreCatHat: boolean;
  pitreVoices: boolean;
  pitreBrap: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  scoreLimit: 25,
  timeLimitMin: 10,
  holeCount: 0,
  holeSpacing: 11.5,
  weaponMode: 'fixed',
  weapon: 'sniper',
  allowedWeapons: [...LOADOUT_WEAPONS],
  gunGameOrder: [...DEFAULT_GUNGAME],
  damageMult: 1,
  headshotsOnly: false,
  shields: 'normal',
  ammoMode: 'normal',
  clipMult: 1,
  reloadMult: 1,
  respawnSec: 3,
  respawnHole: 'random',
  respawnMode: 'manual',
  antiTurtleSec: 8,
  splashHitsDucked: false,
  underdogCamo: true,
  underdogKillGap: 5,
  underdogDeathStreak: 3,
  orbRate: 'normal',
  powerups: [...POWERUP_IDS],
  powerupDurationMult: 1,
  skulls: [],
  aimAssist: 'normal',
  maxRewindMs: 150,
  pitre: false,
  pitreCatHat: true,
  pitreVoices: true,
  pitreBrap: true,
};

export type FieldGroup = 'Match' | 'Map' | 'Weapons' | 'Damage' | 'Ammo' | 'Respawn' | 'Power-ups' | 'Pitre Mode' | 'Skulls' | 'Advanced';
type Opt = { value: string; label: string; icon?: string; color?: number };
export type Field =
  | ({ kind: 'number'; min: number; max: number; step: number; unit?: string; zeroLabel?: string } & FieldBase)
  | ({ kind: 'bool' } & FieldBase)
  | ({ kind: 'enum'; options: readonly Opt[] } & FieldBase)
  | ({ kind: 'multi'; options: readonly Opt[]; minCount?: number; ordered?: boolean; /** All / None buttons */ bulk?: boolean } & FieldBase);
interface FieldBase {
  key: keyof Settings;
  label: string;
  help?: string;
  group: FieldGroup;
  visibleIf?: (s: Settings) => boolean;
}

const weaponOpts = LOADOUT_WEAPONS.map((w) => ({ value: w, label: WEAPONS[w].name }));
const powerupOpts = POWERUP_IDS.map((p) => ({ value: p, label: POWERUPS[p].name, icon: POWERUPS[p].icon, color: POWERUPS[p].color }));
export const SKULLS: { value: SkullId; label: string; help: string }[] = [
  { value: 'bighead', label: 'Big Head', help: 'Everyone has huge heads (bigger headshot target).' },
  { value: 'gruntbday', label: 'Grunt Birthday Party', help: 'Headshot kills explode in confetti. Yay!' },
  { value: 'blackeye', label: 'Black Eye', help: 'Shields only recharge when you get a kill.' },
  { value: 'mythic', label: 'Mythic', help: 'Everyone has double health and shields.' },
  { value: 'fog', label: 'Fog', help: 'Thick fog rolls over the field.' },
];

export const SETTINGS_SCHEMA: Field[] = [
  { key: 'scoreLimit', label: 'Score limit (kills)', group: 'Match', kind: 'number', min: 0, max: 200, step: 5, zeroLabel: 'Unlimited', visibleIf: (s) => s.weaponMode !== 'gunGame' },
  { key: 'timeLimitMin', label: 'Time limit', group: 'Match', kind: 'number', min: 0, max: 30, step: 1, unit: 'min', zeroLabel: 'Off' },
  { key: 'holeCount', label: 'Holes', group: 'Map', kind: 'number', min: 0, max: 32, step: 1, zeroLabel: 'Auto (16)', help: 'Auto: the classic 16-hole field (a match uses the most central players + 3). Otherwise every hole is in play — never fewer than the number of players.' },
  { key: 'holeSpacing', label: 'Distance between holes', group: 'Map', kind: 'number', min: 6, max: 40, step: 0.5, unit: 'm', help: 'The closest two holes can be. The field grows to fit.' },
  {
    key: 'weaponMode', label: 'Weapon mode', group: 'Weapons', kind: 'enum',
    options: [
      { value: 'fixed', label: 'Everyone same weapon' },
      { value: 'choice', label: 'Players choose' },
      { value: 'randomLife', label: 'Random every life' },
      { value: 'gunGame', label: 'Gun Game (kill to upgrade)' },
    ],
  },
  { key: 'weapon', label: 'Weapon', group: 'Weapons', kind: 'enum', options: weaponOpts, visibleIf: (s) => s.weaponMode === 'fixed' },
  { key: 'allowedWeapons', label: 'Allowed weapons', group: 'Weapons', kind: 'multi', options: weaponOpts, minCount: 1, visibleIf: (s) => s.weaponMode === 'choice' || s.weaponMode === 'randomLife' },
  { key: 'gunGameOrder', label: 'Gun Game order (1 kill per level)', group: 'Weapons', kind: 'multi', options: weaponOpts, minCount: 2, ordered: true, visibleIf: (s) => s.weaponMode === 'gunGame' },
  { key: 'damageMult', label: 'Damage', group: 'Damage', kind: 'number', min: 0.25, max: 4, step: 0.25, unit: '×' },
  { key: 'headshotsOnly', label: 'Headshots only', group: 'Damage', kind: 'bool', help: 'Body shots do nothing.' },
  { key: 'shields', label: 'Shields', group: 'Damage', kind: 'enum', options: [{ value: 'off', label: 'Off' }, { value: 'normal', label: 'Normal' }, { value: 'double', label: 'Double' }] },
  { key: 'splashHitsDucked', label: 'Explosions reach ducked players', group: 'Damage', kind: 'bool', help: 'Off: ducking protects you unless a grenade lands in your hole.' },
  { key: 'ammoMode', label: 'Reloading', group: 'Ammo', kind: 'enum', options: [{ value: 'normal', label: 'Normal' }, { value: 'noReload', label: 'Off (bottomless clip)' }] },
  { key: 'clipMult', label: 'Clip size', group: 'Ammo', kind: 'number', min: 0.5, max: 5, step: 0.5, unit: '×', visibleIf: (s) => s.ammoMode === 'normal' },
  { key: 'reloadMult', label: 'Reload time', group: 'Ammo', kind: 'number', min: 0.25, max: 3, step: 0.25, unit: '×', visibleIf: (s) => s.ammoMode === 'normal' },
  { key: 'respawnSec', label: 'Respawn time', group: 'Respawn', kind: 'number', min: 0, max: 10, step: 1, unit: 's', zeroLabel: 'Instant' },
  {
    key: 'respawnMode', label: 'Respawn', group: 'Respawn', kind: 'enum',
    options: [{ value: 'manual', label: 'When you press Jump' }, { value: 'auto', label: 'Automatically' }],
    help: 'Press Jump: while dead you spectate the others until you press Jump (respawn time is the minimum wait). Bots always respawn automatically.',
  },
  { key: 'respawnHole', label: 'Respawn in', group: 'Respawn', kind: 'enum', options: [{ value: 'random', label: 'Random hole' }, { value: 'same', label: 'Same hole' }] },
  { key: 'antiTurtleSec', label: 'Anti-turtle (max time ducked)', group: 'Respawn', kind: 'number', min: 0, max: 20, step: 1, unit: 's', zeroLabel: 'Off', help: 'Stay ducked too long and you pop up for 2 seconds.' },
  { key: 'underdogCamo', label: 'Underdog camo', group: 'Respawn', kind: 'bool', help: 'Players who are doing badly respawn with active camo.' },
  { key: 'underdogKillGap', label: '…when this many kills behind the leader', group: 'Respawn', kind: 'number', min: 0, max: 50, step: 1, zeroLabel: 'Never', visibleIf: (s) => s.underdogCamo },
  { key: 'underdogDeathStreak', label: '…or after this many deaths in a row', group: 'Respawn', kind: 'number', min: 0, max: 10, step: 1, zeroLabel: 'Never', visibleIf: (s) => s.underdogCamo },
  {
    key: 'orbRate', label: 'Power-up bubbles', group: 'Power-ups', kind: 'enum',
    options: [{ value: 'off', label: 'Off' }, { value: 'low', label: 'Rare' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Lots' }, { value: 'chaos', label: 'CHAOS' }],
  },
  { key: 'powerups', label: 'Enabled power-ups', group: 'Power-ups', kind: 'multi', options: powerupOpts, minCount: 0, bulk: true, help: 'Tap to switch each one on or off. With none enabled, no bubbles appear.', visibleIf: (s) => s.orbRate !== 'off' },
  { key: 'powerupDurationMult', label: 'Power-up duration', group: 'Power-ups', kind: 'number', min: 0.25, max: 4, step: 0.25, unit: '×', visibleIf: (s) => s.orbRate !== 'off' },
  { key: 'pitre', label: 'Pitre Mode', group: 'Pitre Mode', kind: 'bool', help: 'The leader becomes the Cat in the Hat and everyone gets… voice lines.' },
  { key: 'pitreCatHat', label: 'Leader wears the Cat in the Hat costume', group: 'Pitre Mode', kind: 'bool', visibleIf: (s) => s.pitre },
  { key: 'pitreVoices', label: 'Voice lines (mama / bye byeee / prank ’em John…)', group: 'Pitre Mode', kind: 'bool', visibleIf: (s) => s.pitre },
  { key: 'pitreBrap', label: 'Gunshots go “brap brap brappp”', group: 'Pitre Mode', kind: 'bool', visibleIf: (s) => s.pitre },
  { key: 'skulls', label: 'Skulls', group: 'Skulls', kind: 'multi', options: SKULLS.map((s) => ({ value: s.value, label: s.label })) },
  { key: 'aimAssist', label: 'Aim assist (controller & touch)', group: 'Advanced', kind: 'enum', options: [{ value: 'off', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }] },
  { key: 'maxRewindMs', label: 'Lag compensation', group: 'Advanced', kind: 'number', min: 0, max: 250, step: 25, unit: 'ms', help: 'How far back the host rewinds to honour a laggy player’s shot.' },
];

export const PRESETS: Record<string, { label: string; settings: Partial<Settings> }> = {
  classic: { label: 'Classic Diglett', settings: { weaponMode: 'fixed', weapon: 'sniper', orbRate: 'off', scoreLimit: 25, pitre: false } },
  rockets: { label: 'Rocket Whack', settings: { weaponMode: 'fixed', weapon: 'rpg', splashHitsDucked: true, orbRate: 'low', scoreLimit: 25 } },
  needlers: { label: 'Needler Party', settings: { weaponMode: 'fixed', weapon: 'needler', ammoMode: 'noReload', orbRate: 'normal' } },
  gungame: { label: 'Gun Game', settings: { weaponMode: 'gunGame', orbRate: 'low' } },
  chaos: { label: 'Chaos Orbs', settings: { weaponMode: 'randomLife', orbRate: 'chaos', powerupDurationMult: 1.5, skulls: ['gruntbday'] } },
  pitre: { label: 'Pitre Party', settings: { pitre: true, pitreCatHat: true, pitreVoices: true, pitreBrap: true, orbRate: 'normal' } },
  hundred: { label: 'First to 100', settings: { scoreLimit: 100, timeLimitMin: 0, ammoMode: 'noReload', respawnSec: 1 } },
};

function num(v: unknown, f: Extract<Field, { kind: 'number' }>, dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  const c = Math.min(f.max, Math.max(f.min, n));
  const snapped = Math.round((c - f.min) / f.step) * f.step + f.min;
  return Math.round(Math.min(f.max, snapped) * 1000) / 1000;
}

/** Clamp/snap/fill defaults. Never throws; idempotent. Safe for untrusted network data. */
export function sanitizeSettings(raw: unknown): Settings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  for (const f of SETTINGS_SCHEMA) {
    const v = src[f.key];
    const d = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[f.key];
    switch (f.kind) {
      case 'number':
        out[f.key] = num(v, f, d as number);
        break;
      case 'bool':
        out[f.key] = typeof v === 'boolean' ? v : d;
        break;
      case 'enum':
        out[f.key] = f.options.some((o) => o.value === v) ? v : d;
        break;
      case 'multi': {
        const allowed = new Set(f.options.map((o) => o.value));
        let arr = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && allowed.has(x)) : (d as string[]);
        if (!f.ordered) arr = [...new Set(arr)];
        arr = arr.slice(0, 32);
        if (arr.length < (f.minCount ?? 0)) arr = [...(d as string[])];
        out[f.key] = arr;
        break;
      }
    }
  }
  // a custom field needs a few holes
  if ((out.holeCount as number) > 0 && (out.holeCount as number) < 4) out.holeCount = 4;
  return out as unknown as Settings;
}

/** Power-ups that existed before saved settings remembered which ones they knew about. */
const LEGACY_POWERUPS: string[] = ['flamethrower', 'minigun', 'overshield', 'invincible', 'camo', 'damage', 'homing', 'xray', 'bighead', 'orbital', 'quickhands'];

/**
 * Load settings saved by an older version: power-ups added since then start enabled
 * (a saved list only says which of the power-ups known at the time were picked).
 */
export function migrateSavedSettings(raw: unknown): Settings {
  const src = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
  const known = Array.isArray(src.knownPowerups) ? src.knownPowerups.filter((x): x is string => typeof x === 'string') : LEGACY_POWERUPS;
  if (Array.isArray(src.powerups)) src.powerups = [...src.powerups, ...POWERUP_IDS.filter((id) => !known.includes(id) && !(src.powerups as unknown[]).includes(id))];
  return sanitizeSettings(src);
}

/** What to save: the settings plus the power-ups this version knows about. */
export function settingsForStorage(s: Settings): Settings & { knownPowerups: string[] } {
  return { ...s, knownPowerups: [...POWERUP_IDS] };
}

export function applyPreset(base: Settings, preset: string): Settings {
  const p = PRESETS[preset];
  if (!p) return base;
  return sanitizeSettings({ ...base, ...p.settings });
}
