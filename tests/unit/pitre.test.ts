import { describe, expect, it } from 'vitest';
import { PitreHitTracker, PitreVoiceThrottle, pitreCues } from '../../src/audio/pitre';
import type { SimEvent } from '../../src/sim/types';

const on = { pitre: true, pitreVoices: true, pitreBrap: true };

describe('pitre cues', () => {
  it('is silent when Pitre Mode is off', () => {
    expect(pitreCues([{ k: 'fire', t: 1, p: 0, w: 'sniper', o: [0, 0, 0], e: [0, 0, 0], hit: 'none' }], { ...on, pitre: false })).toEqual([]);
  });
  it('leader kill → "prank em john" for the killer, pufferfish for the victim', () => {
    const ev: SimEvent[] = [
      { k: 'dmg', t: 1, a: 2, v: 5, amt: 115, head: true, sb: true, w: 'sniper' },
      { k: 'kill', t: 1, a: 2, v: 5, w: 'sniper', head: true, medals: [], lead: true },
    ];
    const cues = pitreCues(ev, on);
    expect(cues).toContainEqual(expect.objectContaining({ speaker: 5, line: 'pufferfish' }));
    expect(cues).toContainEqual(expect.objectContaining({ speaker: 2, line: 'prank' }));
    // no "mama" for a lethal hit
    expect(cues.some((c) => c.line === 'mama')).toBe(false);
  });
  it('normal kill → "bye byeeee"', () => {
    const cues = pitreCues([{ k: 'kill', t: 1, a: 1, v: 3, w: 'br', head: false, medals: [], lead: false }], on);
    expect(cues).toContainEqual(expect.objectContaining({ speaker: 1, line: 'byebye' }));
  });
  it('non-lethal hit → "mama" from the victim, then "oh look, a pussy" from the shooter', () => {
    const cues = pitreCues([{ k: 'dmg', t: 1, a: 0, v: 4, amt: 40, head: false, sb: false, w: 'br' }], on);
    const mama = cues.find((c) => c.line === 'mama')!;
    const pussy = cues.find((c) => c.line === 'pussy')!;
    expect(mama.speaker).toBe(4);
    expect(pussy.speaker).toBe(0);
    expect(pussy.delayMs).toBeGreaterThan(mama.delayMs);
  });
  it('gunfire → "brap" (only when brap is enabled)', () => {
    const fire: SimEvent = { k: 'fire', t: 1, p: 3, w: 'sniper', o: [0, 0, 0], e: [0, 0, 0], hit: 'none' };
    expect(pitreCues([fire], on)).toContainEqual(expect.objectContaining({ speaker: 3, line: 'brap' }));
    expect(pitreCues([fire], { ...on, pitreBrap: false })).toEqual([]);
  });
});

describe('Bitch please / How many bullets', () => {
  const dmg = (t: number, a: number, v: number, w: 'br' | 'sniper' | 'flamethrower' = 'br'): SimEvent => ({ k: 'dmg', t, a, v, amt: 30, head: false, sb: false, w });
  const kill = (t: number, a: number, v: number): SimEvent => ({ k: 'kill', t, a, v, w: 'br', head: false, medals: [], lead: false });
  const shooterLine = (cues: ReturnType<typeof pitreCues>, a: number) => cues.find((c) => c.speaker === a && (c.line === 'pussy' || c.line === 'bullets'))?.line;

  it('a bullet whizzing past → "Bitch, please!" from whoever it missed', () => {
    const cues = pitreCues([{ k: 'near', t: 5, a: 0, v: 3, w: 'sniper' }], on);
    expect(cues).toEqual([expect.objectContaining({ speaker: 3, line: 'please' })]);
    expect(pitreCues([{ k: 'near', t: 5, a: 0, v: 3, w: 'sniper' }], { ...on, pitreVoices: false })).toEqual([]);
  });

  it('the second hit without a kill → "How many bullets?!" (any victim; misses don’t reset it)', () => {
    const tr = new PitreHitTracker();
    expect(shooterLine(pitreCues([dmg(100, 0, 1)], on, tr), 0)).toBe('pussy');
    // a burst counts once
    expect(shooterLine(pitreCues([dmg(104, 0, 1)], on, tr), 0)).toBe('pussy');
    expect(shooterLine(pitreCues([dmg(108, 0, 1)], on, tr), 0)).toBe('pussy');
    // another victim, much later (misses in between don't matter)
    expect(shooterLine(pitreCues([dmg(400, 0, 2)], on, tr), 0)).toBe('bullets');
    expect(shooterLine(pitreCues([dmg(460, 0, 1)], on, tr), 0)).toBe('bullets');
    // other shooters keep their own count
    expect(shooterLine(pitreCues([dmg(470, 2, 1)], on, tr), 2)).toBe('pussy');
  });

  it('a kill or the shooter’s death resets the count; fire and beams don’t count', () => {
    const tr = new PitreHitTracker();
    pitreCues([dmg(100, 0, 1)], on, tr);
    pitreCues([dmg(200, 0, 1), kill(200, 0, 1)], on, tr);
    expect(shooterLine(pitreCues([dmg(300, 0, 2)], on, tr), 0)).toBe('pussy');
    pitreCues([kill(350, 2, 0)], on, tr);
    expect(shooterLine(pitreCues([dmg(400, 0, 2)], on, tr), 0)).toBe('pussy');
    // a burn isn't a bullet
    expect(shooterLine(pitreCues([dmg(500, 0, 1, 'flamethrower')], on, tr), 0)).toBe('pussy');
    expect(shooterLine(pitreCues([dmg(600, 0, 1, 'flamethrower')], on, tr), 0)).toBe('pussy');
    expect(shooterLine(pitreCues([dmg(700, 0, 1)], on, tr), 0)).toBe('bullets');
  });
});

describe('pitre throttle', () => {
  it('does not restart brap for automatic weapons mid-line', () => {
    const t = new PitreVoiceThrottle();
    const cue = { speaker: 1, line: 'brap' as const, delayMs: 0, priority: 1 };
    expect(t.admit(cue, 0, 1200, 'minigun')).toBe(true);
    let n = 0;
    for (let ms = 50; ms < 1200; ms += 50) if (t.admit(cue, ms, 1200, 'minigun')) n++;
    expect(n).toBe(0);
    expect(t.admit(cue, 1250, 1200, 'minigun')).toBe(true);
  });
  it('kill lines interrupt lower-priority lines; mama has a cooldown', () => {
    const t = new PitreVoiceThrottle();
    expect(t.admit({ speaker: 1, line: 'brap', delayMs: 0, priority: 1 }, 0, 1200, 'sniper')).toBe(true);
    expect(t.admit({ speaker: 1, line: 'byebye', delayMs: 0, priority: 5 }, 100, 900)).toBe(true);
    expect(t.admit({ speaker: 1, line: 'brap', delayMs: 0, priority: 1 }, 200, 1200, 'sniper')).toBe(false);
    expect(t.admit({ speaker: 2, line: 'mama', delayMs: 0, priority: 2 }, 0, 500)).toBe(true);
    expect(t.admit({ speaker: 2, line: 'mama', delayMs: 0, priority: 2 }, 300, 500)).toBe(false);
    expect(t.admit({ speaker: 2, line: 'mama', delayMs: 0, priority: 2 }, 700, 500)).toBe(true);
  });
});
