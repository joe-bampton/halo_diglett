import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PITRE_SLOT } from '../../src/audio/pitre';
import { SFX } from '../../src/audio/synth';
import { POWERUPS } from '../../src/sim/powerups';

const ROOT = join(__dirname, '../..');
type File = string | { file: string; by?: string };
const manifest = JSON.parse(readFileSync(join(ROOT, 'public/audio/manifest.json'), 'utf8')) as { slots: Record<string, { files: File[]; gain: number }> };
const path = (f: File) => (typeof f === 'string' ? f : f.file);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('voice line manifest', () => {
  it('has a clip for every voice slot the game asks for', () => {
    const wanted = new Set<string>([...Object.values(PITRE_SLOT), ...Object.values(POWERUPS).map((p) => p.announce)]);
    // plus every slot id written out in the source ('ann.double', 'jerry.suppress', …)
    for (const f of sources(join(ROOT, 'src')))
      for (const m of readFileSync(f, 'utf8').matchAll(/'((?:ann|pitre|jerry)\.[a-z_]+)'/g)) wanted.add(m[1]!);
    const missing = [...wanted].filter((s) => !manifest.slots[s]?.files.length);
    expect(missing).toEqual([]);
  });

  it('lists only files that exist', () => {
    const files = Object.values(manifest.slots).flatMap((s) => s.files.map(path));
    expect(files.filter((f) => !existsSync(join(ROOT, 'public', f)))).toEqual([]);
  });

  it('only has sound-effect slots for sounds the game has', () => {
    const sfx = Object.keys(manifest.slots).filter((k) => k.startsWith('sfx.'));
    expect(sfx.filter((k) => !Object.hasOwn(SFX, k.slice(4)))).toEqual([]);
  });
});

describe('sound tool inputs', () => {
  it('tools/sfx/sfx.json only names sounds the game has', () => {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'tools/sfx/sfx.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(cfg).filter((k) => !k.startsWith('_') && !Object.hasOwn(SFX, k))).toEqual([]);
  });

  it("friends' recordings are all in the manifest", () => {
    const p = join(ROOT, 'tools/voices/recordings.json');
    const recs = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as { file: string }[]) : [];
    const listed = new Set(Object.values(manifest.slots).flatMap((s) => s.files.map(path)));
    expect(recs.filter((r) => !listed.has(r.file))).toEqual([]);
  });
});
