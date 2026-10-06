export type WeaponId =
  | 'sniper'
  | 'br'
  | 'crossbow'
  | 'rpg'
  | 'grenade'
  | 'railgun'
  | 'hyperbeam'
  | 'needler'
  | 'flamethrower'
  | 'minigun'
  | 'orbital'
  | 'soaker';

export type Trigger = 'semi' | 'auto' | 'burst' | 'charge' | 'beam';
export type FireKind = 'hitscan' | 'projectile' | 'beam' | 'spray';

export interface ProjectileDef {
  speed: number;
  gravity: number;
  radius: number;
  life: number;
  bounce?: { restitution: number; max: number };
  fuse?: number;
  homing?: { turnRate: number; coneDeg: number; range: number };
  stick?: { count: number; window: number; damage: number; radius: number };
  burn?: { dps: number; time: number };
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  short: string;
  powerupOnly?: boolean;
  trigger: Trigger;
  fireKind: FireKind;
  /** seconds between shots (or bursts) */
  interval: number;
  burst?: { count: number; gap: number };
  chargeTime?: number;
  beamTime?: number;
  spinUp?: number;
  spreadDeg: number;
  pellets?: number;
  range: number;
  pierce?: number;
  /** damage per hit (beam: damage per second) */
  damage: number;
  headMult: number;
  headshotKills?: boolean;
  splash?: { radius: number; inner: number; damage: number; selfMult: number; hitsDucked?: boolean };
  projectile?: ProjectileDef;
  clip: number;
  reload: number;
  zoom: number[];
  /** orbital designator: delayed strike at the hit point */
  strike?: { delay: number; radius: number; damage: number };
  /** Super Soaker: one squirt drenches every other player `delay` s later for `duration` s */
  sauce?: { delay: number; duration: number };
  bot: { preferHead: number; skill: number };
  fx: {
    tracer: 'bullet' | 'bolt' | 'rocket' | 'plasma' | 'rail' | 'flame' | 'grenade' | 'needle' | 'laser' | 'none';
    color: number;
    recoil: number;
  };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  sniper: {
    id: 'sniper', name: 'Sniper Rifle', short: 'SNIPER', trigger: 'semi', fireKind: 'hitscan',
    interval: 0.6, spreadDeg: 0, range: 400, damage: 95, headMult: 3, headshotKills: true,
    clip: 4, reload: 2.5, zoom: [3, 8],
    bot: { preferHead: 1, skill: 1 },
    fx: { tracer: 'bullet', color: 0xfff2c0, recoil: 1 },
  },
  br: {
    id: 'br', name: 'Battle Rifle', short: 'BR75', trigger: 'burst', fireKind: 'hitscan',
    interval: 0.4, burst: { count: 3, gap: 0.05 }, spreadDeg: 0.2, range: 300, damage: 11, headMult: 2.5,
    clip: 36, reload: 2.0, zoom: [1.8],
    bot: { preferHead: 0.8, skill: 0.8 },
    fx: { tracer: 'bullet', color: 0xffe28a, recoil: 0.35 },
  },
  crossbow: {
    id: 'crossbow', name: 'Crossbow', short: 'XBOW', trigger: 'semi', fireKind: 'projectile',
    interval: 0.9, spreadDeg: 0, range: 300, damage: 90, headMult: 3, headshotKills: true,
    projectile: { speed: 110, gravity: 9.8, radius: 0.06, life: 4 },
    clip: 1, reload: 1.3, zoom: [2.5],
    bot: { preferHead: 1, skill: 1.2 },
    fx: { tracer: 'bolt', color: 0x9fe8ff, recoil: 0.8 },
  },
  rpg: {
    id: 'rpg', name: 'Rocket Launcher', short: 'RPG', trigger: 'semi', fireKind: 'projectile',
    interval: 0.8, spreadDeg: 0, range: 300, damage: 200, headMult: 1,
    splash: { radius: 4.5, inner: 1.0, damage: 150, selfMult: 0.5 },
    projectile: { speed: 40, gravity: 0, radius: 0.15, life: 6 },
    clip: 2, reload: 3.2, zoom: [2],
    bot: { preferHead: 0, skill: 1.1 },
    fx: { tracer: 'rocket', color: 0xff9a3c, recoil: 1.2 },
  },
  grenade: {
    id: 'grenade', name: 'Grenade Launcher', short: 'NADE', trigger: 'semi', fireKind: 'projectile',
    interval: 0.7, spreadDeg: 0, range: 200, damage: 0, headMult: 1,
    splash: { radius: 3.5, inner: 0.8, damage: 140, selfMult: 0.5 },
    projectile: { speed: 30, gravity: 12, radius: 0.1, life: 6, bounce: { restitution: 0.45, max: 3 }, fuse: 1.8 },
    clip: 2, reload: 2.2, zoom: [],
    bot: { preferHead: 0, skill: 1.3 },
    fx: { tracer: 'grenade', color: 0x7cff6b, recoil: 0.9 },
  },
  railgun: {
    id: 'railgun', name: 'Railgun', short: 'RAIL', trigger: 'charge', fireKind: 'hitscan',
    interval: 0.5, chargeTime: 0.7, spreadDeg: 0, range: 400, pierce: 3, damage: 200, headMult: 1,
    clip: 1, reload: 2.0, zoom: [2],
    bot: { preferHead: 0.3, skill: 1.1 },
    fx: { tracer: 'rail', color: 0x6ad8ff, recoil: 1.4 },
  },
  hyperbeam: {
    id: 'hyperbeam', name: 'Hyperbeam', short: 'HYPER', trigger: 'beam', fireKind: 'beam',
    interval: 0.4, chargeTime: 0.6, beamTime: 1.8, spreadDeg: 0, range: 160, damage: 180, headMult: 1.5,
    clip: 3, reload: 3.0, zoom: [],
    bot: { preferHead: 0.6, skill: 1.1 },
    fx: { tracer: 'laser', color: 0xff4df0, recoil: 0.2 },
  },
  needler: {
    id: 'needler', name: 'Needler', short: 'NEEDLER', trigger: 'auto', fireKind: 'projectile',
    interval: 1 / 12, spreadDeg: 1.5, range: 100, damage: 7, headMult: 1,
    projectile: {
      speed: 45, gravity: 0, radius: 0.08, life: 2.5,
      homing: { turnRate: 4, coneDeg: 8, range: 60 },
      stick: { count: 7, window: 3, damage: 130, radius: 1.5 },
    },
    clip: 24, reload: 2.4, zoom: [],
    bot: { preferHead: 0, skill: 0.9 },
    fx: { tracer: 'needle', color: 0xff5fd2, recoil: 0.15 },
  },
  flamethrower: {
    id: 'flamethrower', name: 'Flamethrower', short: 'FLAME', powerupOnly: true, trigger: 'auto', fireKind: 'projectile',
    interval: 1 / 20, spreadDeg: 4, range: 30, damage: 5, headMult: 1,
    projectile: { speed: 26, gravity: 5, radius: 0.5, life: 1.1, burn: { dps: 15, time: 2 } },
    clip: 0, reload: 0, zoom: [],
    bot: { preferHead: 0, skill: 1 },
    fx: { tracer: 'flame', color: 0xff7a1a, recoil: 0.05 },
  },
  minigun: {
    id: 'minigun', name: 'Minigun', short: 'MINIGUN', powerupOnly: true, trigger: 'auto', fireKind: 'hitscan',
    interval: 1 / 20, spinUp: 0.4, spreadDeg: 1.2, range: 250, damage: 8, headMult: 1.5,
    clip: 0, reload: 0, zoom: [],
    bot: { preferHead: 0.5, skill: 0.9 },
    fx: { tracer: 'bullet', color: 0xffd060, recoil: 0.12 },
  },
  orbital: {
    id: 'orbital', name: 'Orbital Designator', short: 'ORBITAL', powerupOnly: true, trigger: 'semi', fireKind: 'hitscan',
    interval: 0.5, spreadDeg: 0, range: 400, damage: 0, headMult: 1,
    strike: { delay: 2.0, radius: 6, damage: 300 },
    clip: 0, reload: 0, zoom: [2],
    bot: { preferHead: 0, skill: 1 },
    fx: { tracer: 'laser', color: 0xff2020, recoil: 0.1 },
  },
  soaker: {
    id: 'soaker', name: 'Super Soaker', short: 'SOAKER', powerupOnly: true, trigger: 'semi', fireKind: 'spray',
    interval: 0.5, spreadDeg: 0, range: 400, damage: 0, headMult: 1,
    sauce: { delay: 1, duration: 5 },
    clip: 0, reload: 0, zoom: [],
    bot: { preferHead: 0, skill: 1 },
    fx: { tracer: 'none', color: 0xfff4d6, recoil: 0.7 },
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const LOADOUT_WEAPONS = WEAPON_IDS.filter((w) => !WEAPONS[w].powerupOnly);
export const DEFAULT_GUNGAME: WeaponId[] = ['railgun', 'sniper', 'crossbow', 'br', 'needler', 'hyperbeam', 'rpg', 'grenade'];
export const weaponIndex = (id: WeaponId) => WEAPON_IDS.indexOf(id);
export const weaponByIndex = (i: number): WeaponId => WEAPON_IDS[i] ?? 'sniper';
