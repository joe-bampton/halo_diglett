import type { WeaponId } from './weapons';

export type PowerUpId =
  | 'flamethrower'
  | 'minigun'
  | 'overshield'
  | 'invincible'
  | 'camo'
  | 'damage'
  | 'homing'
  | 'xray'
  | 'bighead'
  | 'orbital'
  | 'quickhands'
  | 'spring'
  | 'sauce';

export interface PowerUpDef {
  id: PowerUpId;
  name: string;
  color: number;
  duration: number;
  /** kept until used (or until you die) instead of timing out */
  held?: boolean;
  weapon?: WeaponId;
  weight: number;
  announce: string;
  icon: string;
}

export const POWERUPS: Record<PowerUpId, PowerUpDef> = {
  flamethrower: { id: 'flamethrower', name: 'Flamethrower', color: 0xff7a1a, duration: 12, weapon: 'flamethrower', weight: 1, announce: 'ann.flamethrower', icon: '🔥' },
  minigun: { id: 'minigun', name: 'Minigun', color: 0xffc83a, duration: 10, weapon: 'minigun', weight: 1, announce: 'ann.minigun', icon: '⚙' },
  overshield: { id: 'overshield', name: 'Overshield', color: 0x40ff70, duration: 30, weight: 1.2, announce: 'ann.overshield', icon: '⛨' },
  invincible: { id: 'invincible', name: 'Invincibility', color: 0xffe640, duration: 8, weight: 0.6, announce: 'ann.invincible', icon: '★' },
  camo: { id: 'camo', name: 'Active Camo', color: 0x7fb8ff, duration: 20, weight: 1, announce: 'ann.camo', icon: '◌' },
  damage: { id: 'damage', name: 'Damage Boost', color: 0xff3a3a, duration: 20, weight: 1, announce: 'ann.damage_boost', icon: '✖' },
  homing: { id: 'homing', name: 'Homing Rounds', color: 0xd070ff, duration: 15, weight: 0.8, announce: 'ann.homing', icon: '◎' },
  xray: { id: 'xray', name: 'X-Ray Vision', color: 0x60fff0, duration: 20, weight: 0.9, announce: 'ann.xray', icon: '👁' },
  bighead: { id: 'bighead', name: 'Big Heads', color: 0xffa0d0, duration: 20, weight: 0.9, announce: 'ann.bighead', icon: '☻' },
  orbital: { id: 'orbital', name: 'Orbital Strike', color: 0xff2020, duration: 15, weapon: 'orbital', weight: 0.5, announce: 'ann.orbital', icon: '☄' },
  quickhands: { id: 'quickhands', name: 'Quick Hands', color: 0x9dff4a, duration: 20, weight: 1, announce: 'ann.quickhands', icon: '⚡' },
  spring: { id: 'spring', name: 'Spring Jump', color: 0x3cffd0, duration: 0, held: true, weight: 0.8, announce: 'ann.spring', icon: '⇈' },
  sauce: { id: 'sauce', name: 'Gerry Sauce', color: 0xfff4d6, duration: 15, weapon: 'soaker', weight: 0.5, announce: 'ann.sauce', icon: '💦' },
};

export const POWERUP_IDS = Object.keys(POWERUPS) as PowerUpId[];
export const powerupBit = (id: PowerUpId) => 1 << POWERUP_IDS.indexOf(id);
