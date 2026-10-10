import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIM_Y, CHARACTER_HEIGHT, HEAD_PIVOT_Y, boundsOf, fitCharacter, fitProp, fitWeapon, sanitizeAiConfig, splitByHeight, tintMaskFromPixels } from '../../src/render/aiModels';
import { HEAD_Y } from '../../src/sim/constants';

const mat = new THREE.MeshStandardMaterial();

/** A stand-in for an AI export: a 1.8 tall figure facing +Z, standing somewhere off the origin, scaled by its node. */
function figure(): THREE.Object3D {
  const g = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 0.2).translate(0, 0.45, 0), mat);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3, 2, 4, 2).translate(0, 1.2, 0), mat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8).translate(0, 1.65, 0), mat);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.1).translate(0, 1.65, 0.18), mat);
  g.add(legs, torso, head, nose);
  g.position.set(4, -2, 7);
  g.scale.setScalar(3);
  return g;
}

/** A stand-in gun lying along +X: barrel at +X, stock at -X, scope on top. */
function gun(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 0.1), mat));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6).rotateZ(Math.PI / 2).translate(1.5, 0.05, 0), mat));
  return g;
}

describe('AI model fitting', () => {
  it('keeps only sensible config', () => {
    expect(sanitizeAiConfig({ file: 'sniper.glb', rotate: [0, 90, 0], size: 1.5, grip: [0.5, 2, 0.5], junk: 1 })).toEqual({ file: 'sniper.glb', rotate: [0, 90, 0], size: 1.5 });
    expect(sanitizeAiConfig({ file: '../../etc/passwd.glb' })).toBeNull();
    expect(sanitizeAiConfig({ file: 'x.png' })).toBeNull();
    expect(sanitizeAiConfig(null)).toBeNull();
  });

  it('cuts a geometry into bands by triangle height, keeping every triangle', () => {
    const g = new THREE.BoxGeometry(1, 3, 1, 1, 6, 1).translate(0, 1.5, 0);
    const bands = splitByHeight(g, [1, 2]);
    const counts = bands.map((b) => b.getAttribute('position').count);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(g.toNonIndexed().getAttribute('position').count);
    expect(counts.every((c) => c > 0)).toBe(true);
    bands[0]!.computeBoundingBox();
    expect(bands[0]!.boundingBox!.max.y).toBeLessThanOrEqual(1 + 1e-6);
    bands[2]!.computeBoundingBox();
    expect(bands[2]!.boundingBox!.min.y).toBeGreaterThanOrEqual(2 - 1e-6);
  });

  it('stands a character in the hole, head on the head hitbox, facing -Z, cut at waist and neck', () => {
    const m = fitCharacter(figure(), { file: 'x.glb' });
    // put the parts back where they hang in the game to measure the whole figure
    const whole = [...m.lower, ...m.upper.map((p) => ({ geo: p.geo.clone().translate(0, AIM_Y, 0), mat: p.mat })), ...m.head.map((p) => ({ geo: p.geo.clone().translate(0, HEAD_PIVOT_Y, 0), mat: p.mat }))];
    const box = boundsOf(whole);
    expect(box.max.y - box.min.y).toBeCloseTo(CHARACTER_HEIGHT, 5);
    expect(box.max.y).toBeCloseTo(HEAD_Y + 0.2, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
    // the nose (the front) now points to -Z
    const head = boundsOf(m.head);
    expect(head.min.z).toBeLessThan(-0.15);
    expect(head.max.z).toBeLessThan(0.3);
    expect(boundsOf(m.lower).max.y).toBeLessThan(0.3);
    expect(m.upper.length && m.head.length && m.lower.length).toBeTruthy();
  });

  it('lays a weapon along -Z with the grip at the origin and the muzzle in front', () => {
    const w = fitWeapon(gun(), { file: 'x.glb' }, 1.6);
    const box = boundsOf(w.pieces);
    expect(box.max.z - box.min.z).toBeCloseTo(1.6, 5);
    expect(box.min.z).toBeLessThan(0);
    expect(box.max.z).toBeGreaterThan(0);
    expect(w.muzzle.z).toBeCloseTo(box.min.z, 5);
    // the barrel (thin end) is at the front
    const frontOf = (pieces: typeof w.pieces) => pieces.map((p) => boundsOf([p])).find((b) => b.min.z <= boundsOf(pieces).min.z + 1e-6)!;
    const front = frontOf(w.pieces);
    expect(front.max.y - front.min.y).toBeLessThan(0.05);
    // flip: end for end
    const flipped = fitWeapon(gun(), { file: 'x.glb', flip: true }, 1.6);
    const f2 = frontOf(flipped.pieces);
    expect(f2.max.y - f2.min.y).toBeGreaterThan(0.05);
  });

  it('fits props to their height', () => {
    const p = fitProp(gun(), { file: 'x.glb', rotate: [0, 0, 90] }, 1.44, 'centre');
    const box = boundsOf(p.pieces);
    expect(box.max.y - box.min.y).toBeCloseTo(1.44, 5);
    expect(box.max.y).toBeCloseTo(0.72, 5);
    const s = fitProp(gun(), { file: 'x.glb', rotate: [0, 0, 90] }, 1, 'bottom');
    expect(boundsOf(s.pieces).min.y).toBeCloseTo(0, 5);
  });

  it('tints the light, unsaturated texels only', () => {
    const px = new Uint8Array([230, 230, 235, 255, 200, 150, 40, 255, 40, 40, 40, 255, 128, 128, 128, 255]);
    const [white, gold, black, grey] = tintMaskFromPixels(px);
    expect(white).toBe(255);
    expect(gold).toBe(0);
    expect(black).toBe(0);
    expect(grey).toBeGreaterThan(100);
  });
});

describe('the AI model files in the repo', () => {
  it('every slot in public/models/ai/manifest.json is a known model with a valid config and its file', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    const { AI_CHARACTERS, AI_PROPS } = await import('../../src/render/aiModels');
    const { WEAPON_IDS } = await import('../../src/sim/weapons');
    const m = JSON.parse(readFileSync('public/models/ai/manifest.json', 'utf8')) as { version: number; slots: Record<string, unknown> };
    expect(m.version).toBe(1);
    const known = [...AI_CHARACTERS, ...AI_PROPS, ...WEAPON_IDS] as string[];
    for (const [slot, raw] of Object.entries(m.slots)) {
      expect(known).toContain(slot);
      const cfg = sanitizeAiConfig(raw);
      expect(cfg).not.toBeNull();
      expect(existsSync(`public/models/ai/${cfg!.file}`)).toBe(true);
    }
  });
});
