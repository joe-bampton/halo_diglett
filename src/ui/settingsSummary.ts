import { POWERUP_IDS } from '../sim/powerups';
import { DEFAULT_SETTINGS, PRESETS, SETTINGS_SCHEMA, SKULLS, applyPreset, sanitizeSettings, type Field, type Settings, type SettingsTab } from '../sim/settings';
import { WEAPONS, type WeaponId } from '../sim/weapons';

const fieldOf = new Map(SETTINGS_SCHEMA.map((f) => [f.key, f]));

/** Same setting? Lists of picks compare as sets (the order chips were tapped in means nothing), the Gun Game order in order. */
export function sameValue(key: keyof Settings, a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    const f = fieldOf.get(key);
    if (f?.kind === 'multi' && !f.ordered) return a.length === b.length && a.every((x) => b.includes(x));
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

const DEFAULTS = sanitizeSettings(DEFAULT_SETTINGS);

/** The fields in these groups that are showing and not at their default. */
export function changedFields(s: Settings, groups?: readonly string[]): Field[] {
  return SETTINGS_SCHEMA.filter((f) => (!groups || groups.includes(f.group)) && (!f.visibleIf || f.visibleIf(s)) && !sameValue(f.key, s[f.key], DEFAULTS[f.key]));
}

/** Does this tab hold anything that isn't the default? (the dot on the tab) */
export function tabChanged(s: Settings, tab: SettingsTab): boolean {
  return changedFields(s, tab.groups).length > 0;
}

/** Everything on this tab back to the default (the rest left alone). */
export function resetTab(s: Settings, tab: SettingsTab): Settings {
  const out: Record<string, unknown> = { ...s };
  for (const f of SETTINGS_SCHEMA) if (tab.groups.includes(f.group)) out[f.key] = structuredClone(DEFAULTS[f.key]);
  return sanitizeSettings(out);
}

function same(a: Settings, b: Settings): boolean {
  return SETTINGS_SCHEMA.every((f) => sameValue(f.key, a[f.key], b[f.key]));
}

/** "Standard" (all defaults), the name of the preset it is exactly, or "Custom". */
export function gameTitle(s: Settings): string {
  if (same(s, DEFAULTS)) return 'Standard';
  for (const p of Object.keys(PRESETS)) if (same(s, applyPreset(DEFAULTS, p))) return PRESETS[p]!.label;
  return 'Custom';
}

const x = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, '')}×`;
const RATE: Record<Settings['orbRate'], string> = { off: 'Off', low: 'Rare', normal: 'Normal', high: 'Lots of', chaos: 'CHAOS' };

/** The lobby's Game card: what kind of game it is, in a few lines and chips. */
export function gameSummary(s: Settings): { title: string; lines: string[]; chips: string[] } {
  const lines: string[] = [];
  const allowed = s.allowedWeapons.length;
  switch (s.weaponMode) {
    case 'fixed':
      lines.push(`${WEAPONS[s.weapon].name} for everyone`);
      break;
    case 'choice':
      lines.push(allowed === 1 ? `${WEAPONS[s.allowedWeapons[0]!].name} for everyone` : `Players choose (${allowed} weapons)`);
      break;
    case 'randomLife':
      lines.push(`A random weapon every life (${allowed})`);
      break;
    case 'gunGame':
      lines.push(`Gun Game: ${s.gunGameOrder.length} levels, a kill each`);
      break;
  }
  const goal = s.weaponMode === 'gunGame' ? 'Win: get through every gun' : s.scoreLimit ? `First to ${s.scoreLimit} kills` : 'No score limit';
  lines.push(`${goal} · ${s.timeLimitMin ? `${s.timeLimitMin} min` : 'no time limit'}`);
  const n = s.powerups.length;
  lines.push(s.orbRate === 'off' || !n ? 'No power-ups' : `${RATE[s.orbRate]} power-ups${n < POWERUP_IDS.length ? ` (${n} of ${POWERUP_IDS.length})` : ''}`);

  const chips: string[] = [];
  const d = DEFAULTS;
  if (s.headshotsOnly) chips.push('Headshots only');
  if (s.damageMult !== d.damageMult) chips.push(`${x(s.damageMult)} damage`);
  if (s.shields !== d.shields) chips.push(s.shields === 'off' ? 'No shields' : 'Double shields');
  if (s.splashHitsDucked) chips.push('Blasts reach ducked players');
  if (s.ammoMode === 'noReload') chips.push('Bottomless clips');
  else {
    if (s.clipMult !== d.clipMult) chips.push(`${x(s.clipMult)} clips`);
    if (s.reloadMult !== d.reloadMult) chips.push(`${x(s.reloadMult)} reload time`);
  }
  if (s.respawnSec !== d.respawnSec) chips.push(s.respawnSec ? `${s.respawnSec} s respawn` : 'Instant respawn');
  if (s.respawnMode !== d.respawnMode) chips.push(s.respawnMode === 'auto' ? 'Auto respawn' : 'Respawn on Jump');
  if (s.respawnHole !== d.respawnHole) chips.push(s.respawnHole === 'same' ? 'Respawn in the same hole' : 'Respawn in a random hole');
  if (s.antiTurtleSec !== d.antiTurtleSec) chips.push(s.antiTurtleSec ? `Anti-turtle ${s.antiTurtleSec} s` : 'No anti-turtle');
  if (!s.underdogCamo) chips.push('No underdog camo');
  if (s.orbRate !== 'off' && n && s.powerupDurationMult !== d.powerupDurationMult) chips.push(`${x(s.powerupDurationMult)} power-up time`);
  for (const k of s.skulls) chips.push(`💀 ${SKULLS.find((y) => y.value === k)?.label ?? k}`);
  if (s.pitre) chips.push('🎩 Pitre Mode');
  return { title: gameTitle(s), lines, chips };
}

/**
 * The gun a Spartan is shown holding in the lobby: the one everyone gets, their pick, the first Gun Game gun, or (a
 * random gun every life) one of the allowed ones, the same each time for the same slot.
 */
export function lobbyWeapon(s: Settings, slot: number, pick?: WeaponId): WeaponId {
  const allowed = s.allowedWeapons.length ? s.allowedWeapons : [s.weapon];
  switch (s.weaponMode) {
    case 'fixed':
      return s.weapon;
    case 'choice':
      return pick && allowed.includes(pick) ? pick : allowed[0]!;
    case 'randomLife':
      return allowed[slot % allowed.length]!;
    case 'gunGame':
      return s.gunGameOrder[0] ?? s.weapon;
  }
}
