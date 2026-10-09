/**
 * public/audio/manifest.json: the MP3s behind every voice line ("pitre.prank", "ann.double", …) and
 * the real recordings that replace a synthesized sound effect ("sfx.sniper"). Written by
 * tools/voices/generate.py, tools/voices/import.py and tools/sfx/import.py. Pure, so it's unit-tested.
 */
import { SFX, type SfxId } from './synth';

/** One entry of a slot's `files`: a path from the site root, or `{ file, by }` for a friend's recording. */
export type ManifestFile = string | { file: string; by?: string };

export interface Take {
  file: string;
  /** Who recorded it (their folder in tools/voices/recordings/), if a person did. */
  by?: string;
}

export interface Slot {
  takes: Take[];
  gain: number;
}

export interface Manifest {
  version: number;
  slots: Record<string, Slot>;
}

export const SFX_PREFIX = 'sfx.';

/** Read manifest.json. Entries it doesn't understand are skipped rather than failing the whole file. */
export function parseManifest(json: unknown): Manifest | null {
  const raw = json && typeof json === 'object' ? (json as { slots?: unknown }).slots : null;
  if (!raw || typeof raw !== 'object') return null;
  const slots: Record<string, Slot> = {};
  for (const [id, s] of Object.entries(raw as Record<string, { files?: unknown; gain?: unknown } | null>)) {
    if (!s || !Array.isArray(s.files)) continue;
    const takes: Take[] = [];
    for (const f of s.files as unknown[]) {
      if (typeof f === 'string') takes.push({ file: f });
      else if (f && typeof f === 'object' && typeof (f as Take).file === 'string') {
        const { file, by } = f as Take;
        takes.push(typeof by === 'string' && by.trim() ? { file, by } : { file });
      }
    }
    const gain = typeof s.gain === 'number' && Number.isFinite(s.gain) ? Math.max(0, s.gain) : 1;
    slots[id] = { takes, gain };
  }
  return { version: Number((json as { version?: unknown }).version) || 1, slots };
}

/** Names compare loosely: "John", " john " and "J.O.H.N." are the same person, "Jérôme" is "jerome". */
export function speakerKey(name: string | undefined): string {
  return (name ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

const pick = (n: number, rnd: () => number) => Math.min(n - 1, Math.floor(rnd() * n));

/**
 * Which take of a voice line to play (an index, -1 if there are none). A player who recorded the
 * line says it in their own voice; everyone else, and the announcer, gets a random take.
 */
export function pickTake(takes: readonly { by?: string }[], speaker?: string, rnd: () => number = Math.random): number {
  if (!takes.length) return -1;
  const who = speakerKey(speaker);
  const own = who ? takes.flatMap((t, i) => (speakerKey(t.by) === who ? [i] : [])) : [];
  if (own.length) return own[pick(own.length, rnd)]!;
  return pick(takes.length, rnd);
}

/** The `sfx.<id>` slots that name a sound the game has and list at least one file. */
export function sfxSlots(m: Manifest | null): Partial<Record<SfxId, Slot>> {
  const out: Partial<Record<SfxId, Slot>> = {};
  for (const [key, slot] of Object.entries(m?.slots ?? {})) {
    const id = key.slice(SFX_PREFIX.length);
    if (key.startsWith(SFX_PREFIX) && Object.hasOwn(SFX, id) && slot.takes.length) out[id as SfxId] = slot;
  }
  return out;
}

/** Real recordings win over the synthesized fallback; with several, a random one each time. */
export function pickSfx<B>(files: readonly B[] | undefined, synth: B | undefined, rnd: () => number = Math.random): B | undefined {
  return files?.length ? files[pick(files.length, rnd)] : synth;
}
