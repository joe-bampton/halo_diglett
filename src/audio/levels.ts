/** Volume model shared by the audio engine, voice chat and the Options screen (pure, no WebAudio). */

export type VolumeKey = 'master' | 'guns' | 'sfx' | 'voice' | 'announcer' | 'chat';
export type Volumes = Record<VolumeKey, number>;

export const DEFAULT_VOLUMES: Readonly<Volumes> = Object.freeze({ master: 0.8, guns: 0.8, sfx: 0.8, voice: 0.9, announcer: 0.9, chat: 1 });

/** Slider order, labels and ranges for the Options screen. */
export const VOLUME_META: { key: VolumeKey; label: string; max: number; help?: string }[] = [
  { key: 'master', label: 'Master', max: 1 },
  { key: 'guns', label: 'Guns & explosions', max: 1, help: 'Gunfire, beams, rockets and explosions' },
  { key: 'sfx', label: 'Other effects', max: 1, help: 'Hit markers, shields, medals, power-ups, UI beeps' },
  { key: 'voice', label: 'Character voices', max: 1.5, help: 'Pitre Mode voice lines' },
  { key: 'announcer', label: 'Announcer', max: 1 },
  { key: 'chat', label: 'Voice chat (all players)', max: 1 },
];

const MAX: Record<VolumeKey, number> = Object.fromEntries(VOLUME_META.map((m) => [m.key, m.max])) as Record<VolumeKey, number>;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Clamp every level into range and fill in missing ones. Older saves had no `guns`/`chat` levels. */
export function sanitizeVolumes(raw: unknown): Volumes {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_VOLUMES };
  for (const k of Object.keys(out) as VolumeKey[]) {
    let v = num(r[k]);
    // before guns had their own bus they played through "Effects"
    if (v === null && k === 'guns') v = num(r.sfx);
    if (v !== null) out[k] = Math.min(MAX[k], Math.max(0, v));
  }
  return out;
}

export interface PeerPrefs {
  vol: number;
  muted: boolean;
}

export const DEFAULT_PEER: Readonly<PeerPrefs> = Object.freeze({ vol: 1, muted: false });

/** Final <audio> element volume for one voice-chat peer (media elements cap at 1). */
export function chatElementVolume(master: number, chat: number, peerVol: number, muted: boolean): number {
  if (muted) return 0;
  return Math.min(1, Math.max(0, master * chat * peerVol));
}
