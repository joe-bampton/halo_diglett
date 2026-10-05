import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PITRE_SLOT } from '../../src/audio/pitre';
import { POWERUPS } from '../../src/sim/powerups';

const ROOT = join(__dirname, '../..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'public/audio/manifest.json'), 'utf8')) as { slots: Record<string, { files: string[]; gain: number }> };

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
    const files = Object.values(manifest.slots).flatMap((s) => s.files);
    expect(files.filter((f) => !existsSync(join(ROOT, 'public', f)))).toEqual([]);
  });
});
