export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export const QUALITY_LEVELS: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export interface QualityPreset {
  level: QualityLevel;
  dprCap: number;
  /** multiplier on the (capped) device pixel ratio */
  renderScale: number;
  dynamicRes: [number, number] | null;
  /** MSAA. Without post-processing it's the canvas's own, which can only change with a new match. */
  antialias: boolean;
  /** an extra SMAA pass on top of MSAA (post-processing only) */
  smaa: boolean;
  shadows: 'none' | 'static' | 'dynamic';
  shadowSize: number;
  grassClumps: number;
  grassRadius: number;
  trees: number;
  /** terrain detail (next match) */
  angularSegs: number;
  particles: number;
  /** richness of explosions and other effects (1 = Medium) */
  fxScale: number;
  /** dynamic lights for muzzle flashes and explosions (each one costs every lit pixel, so none on Low / phones) */
  flashLights: number;
  /** bloom + filmic tone mapping */
  post: boolean;
  /** physically based materials that reflect the sky */
  pbr: boolean;
  /** detailed (Blender-made) models where they exist */
  models: 'simple' | 'detailed';
  /** ground, stone and well textures with surface relief (instead of flat colours) */
  textures: boolean;
  /** ambient occlusion (soft contact shadows; post-processing only): 0 off, else its resolution scale */
  ao: number;
  far: number;
  fogNear: number;
  fogFar: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { level: 'low', dprCap: 1, renderScale: 1, dynamicRes: [0.6, 1], antialias: false, smaa: false, shadows: 'none', shadowSize: 0, grassClumps: 3500, grassRadius: 28, trees: 60, angularSegs: 180, particles: 180, fxScale: 0.6, flashLights: 0, post: false, pbr: false, models: 'simple', textures: false, ao: 0, far: 1400, fogNear: 120, fogFar: 1100 },
  medium: { level: 'medium', dprCap: 1.5, renderScale: 1, dynamicRes: [0.75, 1.5], antialias: true, smaa: false, shadows: 'static', shadowSize: 1024, grassClumps: 11000, grassRadius: 45, trees: 130, angularSegs: 300, particles: 420, fxScale: 1, flashLights: 2, post: false, pbr: false, models: 'simple', textures: false, ao: 0, far: 1600, fogNear: 180, fogFar: 1300 },
  high: { level: 'high', dprCap: 2, renderScale: 1, dynamicRes: null, antialias: true, smaa: false, shadows: 'dynamic', shadowSize: 2048, grassClumps: 22000, grassRadius: 60, trees: 200, angularSegs: 400, particles: 800, fxScale: 1.3, flashLights: 4, post: true, pbr: true, models: 'detailed', textures: true, ao: 0.5, far: 1600, fogNear: 200, fogFar: 1400 },
  ultra: { level: 'ultra', dprCap: 2.5, renderScale: 1, dynamicRes: null, antialias: true, smaa: true, shadows: 'dynamic', shadowSize: 4096, grassClumps: 40000, grassRadius: 75, trees: 300, angularSegs: 520, particles: 1600, fxScale: 1.6, flashLights: 6, post: true, pbr: true, models: 'detailed', textures: true, ao: 1, far: 1800, fogNear: 220, fogFar: 1600 },
};

/** Advanced graphics settings: anything left out follows the preset. */
export interface GfxOverrides {
  renderScale?: number;
  dynamicRes?: 'on' | 'off';
  shadows?: 'off' | 'low' | 'high';
  effects?: 'low' | 'medium' | 'high' | 'ultra';
  post?: 'on' | 'off';
  aa?: 'off' | 'msaa' | 'smaa';
  foliage?: 'low' | 'medium' | 'high' | 'ultra';
  models?: 'simple' | 'detailed';
  ao?: 'off' | 'on';
}

export interface GfxField {
  key: keyof GfxOverrides;
  label: string;
  options: [string | number, string][];
  help?: string;
  /** false: only takes effect from the next match */
  live: boolean;
}

export const GFX_FIELDS: GfxField[] = [
  { key: 'renderScale', label: 'Render scale', options: [[0.5, '50%'], [0.67, '67%'], [0.75, '75%'], [0.85, '85%'], [1, '100%'], [1.25, '125%'], [1.5, '150%']], live: true, help: 'Lower is faster but blurrier.' },
  { key: 'dynamicRes', label: 'Dynamic resolution', options: [['on', 'On'], ['off', 'Off']], live: true, help: 'Lowers the resolution while the frame rate dips.' },
  { key: 'shadows', label: 'Shadows', options: [['off', 'Off'], ['low', 'Low (still)'], ['high', 'High (moving)']], live: true },
  { key: 'effects', label: 'Effects', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], live: true, help: 'Explosions, particles and flashes.' },
  { key: 'post', label: 'Post-processing', options: [['on', 'On'], ['off', 'Off']], live: true, help: 'Bloom and filmic colour.' },
  { key: 'aa', label: 'Anti-aliasing', options: [['off', 'Off'], ['msaa', 'MSAA'], ['smaa', 'MSAA + SMAA']], live: false, help: 'Changes now with post-processing on, otherwise next match. SMAA needs post-processing.' },
  { key: 'foliage', label: 'Grass & trees', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], live: true },
  { key: 'models', label: 'Models & materials', options: [['simple', 'Simple'], ['detailed', 'Detailed']], live: true, help: 'Detailed: shiny, sky-reflecting materials, textured ground and stones, and the detailed models.' },
  { key: 'ao', label: 'Ambient occlusion', options: [['off', 'Off'], ['on', 'On']], live: true, help: 'Soft shadows in corners, under the rims and between stones. Needs post-processing.' },
];

const EFFECTS: Record<NonNullable<GfxOverrides['effects']>, Pick<QualityPreset, 'particles' | 'fxScale' | 'flashLights'>> = {
  low: { particles: QUALITY.low.particles, fxScale: QUALITY.low.fxScale, flashLights: QUALITY.low.flashLights },
  medium: { particles: QUALITY.medium.particles, fxScale: QUALITY.medium.fxScale, flashLights: QUALITY.medium.flashLights },
  high: { particles: QUALITY.high.particles, fxScale: QUALITY.high.fxScale, flashLights: QUALITY.high.flashLights },
  ultra: { particles: QUALITY.ultra.particles, fxScale: QUALITY.ultra.fxScale, flashLights: QUALITY.ultra.flashLights },
};
const FOLIAGE: Record<NonNullable<GfxOverrides['foliage']>, Pick<QualityPreset, 'grassClumps' | 'grassRadius' | 'trees'>> = {
  low: { grassClumps: QUALITY.low.grassClumps, grassRadius: QUALITY.low.grassRadius, trees: QUALITY.low.trees },
  medium: { grassClumps: QUALITY.medium.grassClumps, grassRadius: QUALITY.medium.grassRadius, trees: QUALITY.medium.trees },
  high: { grassClumps: QUALITY.high.grassClumps, grassRadius: QUALITY.high.grassRadius, trees: QUALITY.high.trees },
  ultra: { grassClumps: QUALITY.ultra.grassClumps, grassRadius: QUALITY.ultra.grassRadius, trees: QUALITY.ultra.trees },
};

/** A preset with the player's advanced overrides applied. */
export function resolveQuality(level: QualityLevel, o: GfxOverrides = {}): QualityPreset {
  const q: QualityPreset = { ...QUALITY[level] };
  if (o.renderScale !== undefined) q.renderScale = o.renderScale;
  if (o.dynamicRes === 'off') q.dynamicRes = null;
  else if (o.dynamicRes === 'on' && !q.dynamicRes) q.dynamicRes = [0.75, q.dprCap];
  if (o.shadows) {
    q.shadows = o.shadows === 'off' ? 'none' : o.shadows === 'low' ? 'static' : 'dynamic';
    q.shadowSize = q.shadows === 'none' ? 0 : q.shadowSize || (q.shadows === 'dynamic' ? 2048 : 1024);
  }
  if (o.effects) Object.assign(q, EFFECTS[o.effects]);
  if (o.post) q.post = o.post === 'on';
  if (o.aa) {
    q.antialias = o.aa !== 'off';
    q.smaa = o.aa === 'smaa';
  }
  if (o.foliage) Object.assign(q, FOLIAGE[o.foliage]);
  if (o.models) {
    q.models = o.models;
    q.pbr = o.models === 'detailed';
    q.textures = o.models === 'detailed';
  }
  if (o.ao) q.ao = o.ao === 'off' ? 0 : q.ao || 0.5;
  return q;
}

export const QUALITY_LABEL: Record<'auto' | QualityLevel, string> = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };

/** What the plain preset amounts to for an Advanced setting (shown as "Preset (…)"). */
export function presetChoice(key: keyof GfxOverrides, level: QualityLevel): string {
  const q = QUALITY[level];
  const f = GFX_FIELDS.find((x) => x.key === key)!;
  const value: string | number =
    key === 'renderScale' ? q.renderScale
    : key === 'dynamicRes' ? (q.dynamicRes ? 'on' : 'off')
    : key === 'shadows' ? ({ none: 'off', static: 'low', dynamic: 'high' } as const)[q.shadows]
    : key === 'post' ? (q.post ? 'on' : 'off')
    : key === 'aa' ? (q.smaa ? 'smaa' : q.antialias ? 'msaa' : 'off')
    : key === 'models' ? q.models
    : key === 'ao' ? (q.ao ? 'on' : 'off')
    : level; // effects / foliage follow the preset's own level
  return f.options.find(([v]) => v === value)?.[1] ?? String(value);
}

/** Keep only valid overrides (they come from localStorage). */
export function sanitizeGfx(raw: unknown): GfxOverrides {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of GFX_FIELDS) {
    const v = src[f.key];
    if (f.options.some(([value]) => value === v)) out[f.key] = v;
  }
  return out as GfxOverrides;
}

export function isQualityLevel(v: unknown): v is QualityLevel {
  return typeof v === 'string' && (QUALITY_LEVELS as string[]).includes(v);
}

export function detectQuality(): QualityLevel {
  try {
    const url = new URL(location.href);
    const q = url.searchParams.get('quality');
    if (isQualityLevel(q)) return q;
    const saved = localStorage.getItem('hd.quality');
    if (isQualityLevel(saved)) return saved;
  } catch {
    /* ignore */
  }
  return autoQuality();
}

/** Set when High ran too slowly on this device under "Auto": Auto picks Medium from then on. */
const AUTO_LOWERED = 'hd.autoLowered';

/** What "Auto" picks: Low on phones and small-memory devices, High on computers (Medium if High was too slow here). */
export function autoQuality(): QualityLevel {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    if (coarse || mem <= 4) return 'low';
    if (mem < 8 || localStorage.getItem(AUTO_LOWERED)) return 'medium';
  } catch {
    /* ignore */
  }
  return 'high';
}

/** High was too slow under "Auto": remember to start on Medium here. */
export function lowerAutoQuality() {
  try {
    localStorage.setItem(AUTO_LOWERED, '1');
  } catch {
    /* ignore */
  }
}
