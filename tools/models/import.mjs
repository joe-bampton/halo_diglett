#!/usr/bin/env node
/**
 * Optimise AI-made models (Meshy, Tripo, …) for the game.
 *
 * Reads models-src/models.json and the .glb/.gltf files it names, and writes public/models/ai/<slot>.glb plus
 * public/models/ai/manifest.json. Each model is stripped of animations and rigs, merged, simplified to a triangle
 * budget, its textures shrunk to WebP, and compressed (meshopt). How it's turned, scaled and held in the game comes
 * from models.json at runtime (src/render/aiModels.ts), so tuning those needs no re-import: run with --manifest-only.
 *
 *   node tools/models/import.mjs                 # every slot whose source file exists
 *   node tools/models/import.mjs sniper spartan  # just these
 *   node tools/models/import.mjs --manifest-only # only rewrite the manifest (after editing rotate/size/grip…)
 *   node tools/models/import.mjs --list          # what's in models.json, and what's been imported
 *
 * Options for testing: --src <dir> (default models-src), --out <dir> (default public/models/ai).
 * See models-src/README.md and tools/models/AI_MODELS.md.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join as pjoin, resolve } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const SRC = resolve(ROOT, opt('--src', 'models-src'));
const OUT = resolve(ROOT, opt('--out', 'public/models/ai'));
const manifestOnly = flag('--manifest-only');
const list = flag('--list');
const only = args;

const CHARACTERS = ['spartan', 'cat'];
const PROPS = ['can', 'spring'];
const WEAPONS = ['sniper', 'br', 'crossbow', 'rpg', 'grenade', 'railgun', 'hyperbeam', 'needler', 'flamethrower', 'minigun', 'orbital', 'soaker', 'frag', 'plasma'];
const SLOTS = [...CHARACTERS, ...PROPS, ...WEAPONS];
/** most triangles and biggest texture per kind of model (kept small: phones download these too) */
const BUDGET = { character: { tris: 15000, tex: 1024 }, prop: { tris: 4000, tex: 512 }, weapon: { tris: 6000, tex: 512 } };
const kind = (slot) => (CHARACTERS.includes(slot) ? 'character' : PROPS.includes(slot) ? 'prop' : 'weapon');
/** fields of models.json that go into the manifest unchanged (see AiConfig in src/render/aiModels.ts) */
const FIELDS = ['rotate', 'flip', 'size', 'grip', 'muzzle', 'waist', 'neck', 'hand', 'tint'];

const configPath = pjoin(SRC, 'models.json');
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : { slots: {} };
const slots = Object.fromEntries(Object.entries(config.slots ?? {}).filter(([k]) => !k.startsWith('_')));
for (const k of Object.keys(slots)) if (!SLOTS.includes(k)) {
  console.error(`models.json: "${k}" isn't a model the game knows. Use one of: ${SLOTS.join(', ')}`);
  process.exit(1);
}

const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      n += Math.floor((idx ? idx.getCount() : p.getAttribute('POSITION')?.getCount() ?? 0) / 3);
    }
  return n;
}

async function importSlot(slot, entry) {
  const src = pjoin(SRC, entry.file);
  if (!existsSync(src)) {
    console.log(`${slot.padEnd(12)} skipped: ${entry.file} isn't in ${SRC}`);
    return;
  }
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const doc = await io.read(src);
  const root = doc.getRoot();
  // a still model: no animations, rigs or cameras
  for (const a of root.listAnimations()) a.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const c of root.listCameras()) c.dispose();
  for (const mesh of root.listMeshes())
    for (const p of mesh.listPrimitives())
      for (const sem of p.listSemantics()) if (/^(JOINTS|WEIGHTS)_/.test(sem)) p.setAttribute(sem, null);
  const before = triangles(doc);
  const b = BUDGET[kind(slot)];
  await doc.transform(dedup(), flatten(), join(), weld(), prune());
  const welded = triangles(doc);
  if (welded > b.tris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: b.tris / welded, error: 0.01 }), prune());
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [b.tex, b.tex], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  mkdirSync(OUT, { recursive: true });
  const out = pjoin(OUT, `${slot}.glb`);
  await io.write(out, doc);
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(`${slot.padEnd(12)} ${entry.file}: ${before} → ${triangles(doc)} triangles, ${kb(statSync(src).size)} → ${kb(statSync(out).size)}`);
}

function writeManifest() {
  const out = { version: 1, slots: {} };
  for (const [slot, entry] of Object.entries(slots)) {
    const file = pjoin(OUT, `${slot}.glb`);
    if (!existsSync(file)) continue;
    const io2 = { file: `${slot}.glb` };
    for (const f of FIELDS) if (entry[f] !== undefined) io2[f] = entry[f];
    io2.bytes = statSync(file).size;
    out.slots[slot] = io2;
  }
  // models taken out of models.json: their old files go too
  if (existsSync(OUT)) for (const f of readdirSync(OUT)) if (f.endsWith('.glb') && !out.slots[f.slice(0, -4)]) rmSync(pjoin(OUT, f));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(pjoin(OUT, 'manifest.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`manifest: ${Object.keys(out.slots).length} model(s) → ${pjoin(OUT, 'manifest.json')}`);
}

if (list) {
  for (const s of SLOTS) {
    const e = slots[s];
    const done = existsSync(pjoin(OUT, `${s}.glb`));
    console.log(`${s.padEnd(12)} ${kind(s).padEnd(10)} ${e ? `${e.file}${existsSync(pjoin(SRC, e.file)) ? '' : ' (file missing)'}` : '-'}${done ? '  [imported]' : ''}`);
  }
  process.exit(0);
}
if (!manifestOnly) {
  for (const s of only) if (!slots[s]) {
    console.error(`"${s}" isn't in ${configPath}`);
    process.exit(1);
  }
  for (const [slot, entry] of Object.entries(slots)) if (!only.length || only.includes(slot)) await importSlot(slot, entry);
}
writeManifest();
