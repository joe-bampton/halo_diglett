import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, sanitizeOptions } from '../../src/input/input';
import { GFX_FIELDS, QUALITY, presetChoice, resolveQuality, sanitizeGfx } from '../../src/render/quality';

describe('graphics quality', () => {
  it('Low and Medium are what they were (no post-processing, no PBR)', () => {
    expect(QUALITY.low).toMatchObject({ dprCap: 1, dynamicRes: [0.6, 1], antialias: false, shadows: 'none', grassClumps: 3500, grassRadius: 28, trees: 60, angularSegs: 180, particles: 180, flashLights: 0, post: false, pbr: false, renderScale: 1 });
    expect(QUALITY.medium).toMatchObject({ dprCap: 1.5, dynamicRes: [0.75, 1.5], antialias: true, shadows: 'static', shadowSize: 1024, grassClumps: 11000, grassRadius: 45, trees: 130, particles: 420, flashLights: 2, fxScale: 1, post: false, pbr: false, renderScale: 1 });
    expect(QUALITY.high).toMatchObject({ shadows: 'dynamic', shadowSize: 2048, grassClumps: 22000, post: true, pbr: true, textures: true, ao: 0.5 });
    expect(QUALITY.medium).toMatchObject({ textures: false, ao: 0 });
    expect(QUALITY.ultra).toMatchObject({ shadowSize: 4096, grassClumps: 40000, grassRadius: 75, particles: 1600, smaa: true });
  });

  it('no overrides = the preset', () => {
    for (const level of ['low', 'medium', 'high', 'ultra'] as const) expect(resolveQuality(level, {})).toEqual(QUALITY[level]);
  });

  it('overrides win over the preset', () => {
    expect(resolveQuality('high', { shadows: 'off' })).toMatchObject({ shadows: 'none', shadowSize: 0 });
    expect(resolveQuality('low', { shadows: 'high' })).toMatchObject({ shadows: 'dynamic', shadowSize: 2048 });
    expect(resolveQuality('ultra', { shadows: 'low' })).toMatchObject({ shadows: 'static', shadowSize: 4096 });
    expect(resolveQuality('low', { effects: 'ultra' })).toMatchObject({ particles: 1600, fxScale: 1.6, flashLights: 6 });
    expect(resolveQuality('medium', { post: 'on', aa: 'smaa' })).toMatchObject({ post: true, antialias: true, smaa: true });
    expect(resolveQuality('ultra', { aa: 'off' })).toMatchObject({ antialias: false, smaa: false });
    expect(resolveQuality('ultra', { foliage: 'low' })).toMatchObject({ grassClumps: 3500, grassRadius: 28, trees: 60 });
    expect(resolveQuality('medium', { models: 'detailed' })).toMatchObject({ models: 'detailed', pbr: true });
    expect(resolveQuality('high', { models: 'simple' })).toMatchObject({ models: 'simple', pbr: false, textures: false });
    expect(resolveQuality('medium', { models: 'detailed' }).textures).toBe(true);
    expect(resolveQuality('high', { ao: 'off' }).ao).toBe(0);
    expect(resolveQuality('ultra', { ao: 'on' }).ao).toBe(1);
    expect(resolveQuality('medium', { ao: 'on' }).ao).toBe(0.5);
    expect(resolveQuality('high', { dynamicRes: 'on' }).dynamicRes).toEqual([0.75, 2]);
    expect(resolveQuality('low', { dynamicRes: 'off' }).dynamicRes).toBeNull();
    expect(resolveQuality('medium', { renderScale: 0.67 }).renderScale).toBe(0.67);
    // the rest of the preset is untouched
    expect(resolveQuality('high', { shadows: 'off' }).grassClumps).toBe(QUALITY.high.grassClumps);
  });

  it('saved overrides are sanitised', () => {
    expect(sanitizeGfx({ shadows: 'potato', renderScale: 3, post: 'on', foo: 1, models: 'detailed' })).toEqual({ post: 'on', models: 'detailed' });
    expect(sanitizeGfx(null)).toEqual({});
    expect(sanitizeGfx('ultra')).toEqual({});
  });

  it('every advanced setting can say what the preset picks', () => {
    for (const f of GFX_FIELDS) for (const level of ['low', 'medium', 'high', 'ultra'] as const) expect(f.options.map((o) => o[1])).toContain(presetChoice(f.key, level));
    expect(presetChoice('shadows', 'medium')).toBe('Low (still)');
    expect(presetChoice('aa', 'ultra')).toBe('MSAA + SMAA');
  });

  it('saved options are sanitised (old saves, junk)', () => {
    expect(sanitizeOptions({})).toEqual(DEFAULT_OPTIONS);
    const o = sanitizeOptions({ quality: 'ultra', gfx: { shadows: 'off', junk: 1 }, fpsCounter: true, mouseSens: 2, fov: 'wide', standMode: 'toggle' });
    expect(o).toMatchObject({ quality: 'ultra', gfx: { shadows: 'off' }, fpsCounter: true, mouseSens: 2, fov: DEFAULT_OPTIONS.fov, standMode: 'toggle' });
    expect(sanitizeOptions({ quality: 'potato' }).quality).toBe('auto');
  });
});
