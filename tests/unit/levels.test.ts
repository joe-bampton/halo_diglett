import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUMES, VOLUME_META, chatElementVolume, sanitizeVolumes } from '../../src/audio/levels';

describe('volume levels', () => {
  it('fills in defaults', () => {
    expect(sanitizeVolumes(null)).toEqual(DEFAULT_VOLUMES);
    expect(sanitizeVolumes('junk')).toEqual(DEFAULT_VOLUMES);
  });

  it('has a slider for every level', () => {
    expect(VOLUME_META.map((m) => m.key).sort()).toEqual(Object.keys(DEFAULT_VOLUMES).sort());
  });

  it('clamps to each slider range', () => {
    const v = sanitizeVolumes({ master: 3, guns: -1, voice: 9, chat: Number.NaN, sfx: '0.5' });
    expect(v.master).toBe(1);
    expect(v.guns).toBe(0);
    expect(v.voice).toBe(1.5);
    expect(v.chat).toBe(DEFAULT_VOLUMES.chat);
    expect(v.sfx).toBe(DEFAULT_VOLUMES.sfx);
  });

  it('migrates saves from before guns and voice chat had their own levels', () => {
    const v = sanitizeVolumes({ master: 0.5, sfx: 0.3, voice: 1.2, announcer: 0.4 });
    expect(v).toEqual({ master: 0.5, guns: 0.3, sfx: 0.3, voice: 1.2, announcer: 0.4, chat: DEFAULT_VOLUMES.chat });
  });

  it('computes voice-chat element volume', () => {
    expect(chatElementVolume(0.8, 1, 1, false)).toBeCloseTo(0.8);
    expect(chatElementVolume(0.8, 0.5, 0.5, false)).toBeCloseTo(0.2);
    expect(chatElementVolume(1, 1, 1, true)).toBe(0);
    expect(chatElementVolume(2, 2, 2, false)).toBe(1);
  });
});
