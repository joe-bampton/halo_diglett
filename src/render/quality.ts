export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  level: QualityLevel;
  dprCap: number;
  dynamicRes: [number, number] | null;
  antialias: boolean;
  shadows: 'none' | 'static' | 'dynamic';
  shadowSize: number;
  grassClumps: number;
  grassRadius: number;
  trees: number;
  angularSegs: number;
  particles: number;
  far: number;
  fogNear: number;
  fogFar: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { level: 'low', dprCap: 1, dynamicRes: [0.6, 1], antialias: false, shadows: 'none', shadowSize: 0, grassClumps: 3500, grassRadius: 28, trees: 60, angularSegs: 180, particles: 180, far: 1400, fogNear: 120, fogFar: 1100 },
  medium: { level: 'medium', dprCap: 1.5, dynamicRes: [0.75, 1.5], antialias: true, shadows: 'static', shadowSize: 1024, grassClumps: 11000, grassRadius: 45, trees: 130, angularSegs: 300, particles: 420, far: 1600, fogNear: 180, fogFar: 1300 },
  high: { level: 'high', dprCap: 2, dynamicRes: null, antialias: true, shadows: 'dynamic', shadowSize: 2048, grassClumps: 22000, grassRadius: 60, trees: 200, angularSegs: 400, particles: 800, far: 1600, fogNear: 200, fogFar: 1400 },
};

export function detectQuality(): QualityLevel {
  try {
    const url = new URL(location.href);
    const q = url.searchParams.get('quality');
    if (q === 'low' || q === 'medium' || q === 'high') return q;
    const saved = localStorage.getItem('hd.quality');
    if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
  } catch {
    /* ignore */
  }
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (coarse || mem <= 4) return 'low';
  return 'medium';
}
