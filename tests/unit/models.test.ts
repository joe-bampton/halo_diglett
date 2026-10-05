import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The JSON part of a binary glTF. */
function gltf(name: string) {
  const b = readFileSync(join(__dirname, '../../public/models', `${name}.glb`));
  expect(b.toString('latin1', 0, 4)).toBe('glTF');
  expect(b.readUInt32LE(4)).toBe(2);
  const len = b.readUInt32LE(12);
  expect(b.toString('latin1', 16, 20)).toBe('JSON');
  return JSON.parse(b.toString('utf8', 20, 20 + len)) as {
    nodes: { name: string; children?: number[]; translation?: number[]; mesh?: number }[];
    materials: { name: string }[];
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
  };
}

function nodes(name: string) {
  const g = gltf(name);
  const parent = new Map<string, string>();
  for (const n of g.nodes) for (const c of n.children ?? []) parent.set(g.nodes[c]!.name, n.name);
  const at = (n: string) => (g.nodes.find((x) => x.name === n)?.translation ?? [0, 0, 0]).map((v) => Math.round(v * 1000) / 1000);
  return { g, parent, at, names: g.nodes.map((n) => n.name), materials: g.materials.map((m) => m.name) };
}

describe('detailed GLB models (tools/models/build_models.py)', () => {
  it('Spartan: the node tree and pivots of buildSpartan(), and the material names the game swaps', () => {
    const { parent, at, names, materials, g } = nodes('spartan');
    expect(names).toEqual(expect.arrayContaining(['root', 'body', 'aim', 'head', 'weaponHolder']));
    expect(parent.get('body')).toBe('root');
    expect(parent.get('aim')).toBe('body');
    expect(parent.get('head')).toBe('aim');
    expect(parent.get('weaponHolder')).toBe('aim');
    expect(at('aim')).toEqual([0, 0.58, 0]);
    expect(at('head')).toEqual([0, 0.37, 0]);
    expect(at('weaponHolder')).toEqual([0.05, -0.2, -0.3]);
    expect(materials).toEqual(expect.arrayContaining(['armor', 'accent', 'undersuit', 'visor']));
    // baked ambient occlusion rides in the vertex colours
    for (const m of g.meshes) for (const p of m.primitives) expect(p.attributes.COLOR_0).toBeDefined();
  });

  it('can, soaker and spring have their nodes and materials', () => {
    const can = nodes('can');
    expect(can.names).toContain('can');
    expect(can.materials).toEqual(expect.arrayContaining(['metal', 'label']));
    // the label wraps a canvas texture around it
    expect(can.g.meshes[0]!.primitives.some((p) => p.attributes.TEXCOORD_0 !== undefined)).toBe(true);
    const soaker = nodes('soaker');
    expect(soaker.parent.get('muzzle')).toBe('soaker');
    expect(soaker.at('muzzle')).toEqual([0, 0.03, -0.7]);
    expect(soaker.materials).toEqual(expect.arrayContaining(['body', 'accent', 'tank']));
    const spring = nodes('spring');
    expect(spring.names).toContain('spring');
    expect(spring.materials).toEqual(expect.arrayContaining(['metal', 'pad']));
  });

  it('stays light enough for the web', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../public/models/manifest.json'), 'utf8')) as { models: Record<string, { triangles: number; bytes: number }> };
    expect(Object.keys(manifest.models).sort()).toEqual(['can', 'soaker', 'spartan', 'spring']);
    expect(manifest.models.spartan!.triangles).toBeLessThan(12000);
    const total = Object.values(manifest.models).reduce((a, m) => a + m.bytes, 0);
    expect(total).toBeLessThan(600 * 1024);
  });
});
