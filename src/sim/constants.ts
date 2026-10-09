export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const secToTicks = (s: number) => Math.round(s * TICK_RATE);

/** Hitbox & stance (relative to the rim top of the player's hole). */
export const HEAD_Y = 0.95;
export const HEAD_R = 0.25;
export const TORSO_Y0 = 0.05;
export const TORSO_Y1 = 0.55;
export const TORSO_R = 0.34;
export const EYE_Y = 0.88;
export const DUCK_DROP = 1.35; // how far everything drops when fully ducked
export const RISE_TIME = 0.22;
export const LOWER_TIME = 0.16;
export const FIRE_EXPOSURE = 0.6; // must be this far up to fire
export const HIDDEN_EXPOSURE = 0.09; // below this the head is under the rim

export const SHIELD_MAX = 70;
export const HEALTH_MAX = 45;
export const RECHARGE_DELAY = 4.0;
export const SHIELD_RATE = 35;
export const HEALTH_RATE = 30;

export const MULTIKILL_WINDOW = 4.5;
export const HISTORY = 64; // ticks of exposure history kept for lag compensation

export const MAX_HUMANS = 8;
export const MAX_BOTS = 6;
export const MAX_SLOTS = MAX_HUMANS + MAX_BOTS;
