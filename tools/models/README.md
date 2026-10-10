# Detailed 3D models (Blender, from code)

> **Want better-looking models?** You can replace any of these, and every weapon, with a model made by an AI 3D tool: see **[AI_MODELS.md](AI_MODELS.md)**. AI-made models win over these where both exist.

On **High** and **Ultra** graphics (or Options → Graphics → Advanced → Models & materials: Detailed) the
game swaps its built-in, procedural models for these:

| File | What | Triangles |
| --- | --- | --- |
| `public/models/spartan.glb` | the Spartans (tinted per player at runtime) | ~6.2k |
| `public/models/can.glb` | Pitre Mode energy drink can (label drawn at runtime) | ~1.1k |
| `public/models/soaker.glb` | Gerry Sauce Super Soaker | ~1.6k |
| `public/models/spring.glb` | Spring Jump spring | ~2.7k |

They're made by `build_models.py`, a Blender script: primitives, bevels, ambient occlusion baked into the
vertex colours, exported as binary glTF. Nobody needs Blender to play: the `.glb` files are committed.
If a file is missing or doesn't match what the game expects, it logs a warning and keeps the procedural
models. Low and Medium never download them.

## Run it

Blender as a Python module (CPython **3.11**; the wheel is ~350 MB):

```sh
python3.11 -m venv tools/models/.venv
tools/models/.venv/bin/pip install -r tools/models/requirements.txt
tools/models/.venv/bin/python tools/models/build_models.py            # all four models
tools/models/.venv/bin/python tools/models/build_models.py spartan    # just one
```

Or with an installed Blender 4.5: `blender -b -P tools/models/build_models.py -- spartan`.

A run takes a couple of seconds, rewrites the `.glb` files and `public/models/manifest.json`
(triangles and size per model), and rebuilds byte for byte the same files from the same script.
To keep it that way, the script avoids Blender features that number vertices differently from run to run
(Subdivision Surface, `bmesh.ops.spin`, `create_uvsphere`, `remove_doubles`): round shapes are built from
its own lathe with enough segments instead.

## Conventions the game relies on

`src/render/assets.ts` checks these when it loads the files; `tests/unit/models.test.ts` checks the files
in the repo.

- **Units and axes.** Metres. In Blender the models face **+Y** with Z up; the glTF exporter turns that into
  three.js's −Z forward, Y up. The script's numbers are written in three.js terms (helper `T()` and
  `three_matrix()`), the same as `src/render/models.ts`, so values can be copied across.
- **Spartan node tree** (same pivots as the procedural Spartan in `buildSpartan()`):

  | Node | Parent | Position | Moves with |
  | --- | --- | --- | --- |
  | `root` | — | origin = rim level when fully up | the player's hole, standing/ducking |
  | `body` | `root` | 0 | turning (yaw) |
  | `aim` | `body` | (0, 0.58, 0) | aiming up/down (pitch) |
  | `head` | `aim` | (0, 0.37, 0) — the head hitbox centre | Big Head |
  | `weaponHolder` | `aim` | (0.05, −0.2, −0.3) | the weapon model is attached here |

  The head hitbox is a 0.25 m sphere at 0.95 m and the torso a capsule from 0.05 to 0.55 m (radius 0.34),
  so keep the silhouette close to that: what you see is what you can hit.
- **Materials are picked by name** and replaced at runtime (colours here are only previews):
  - Spartan: `armor` (player colour), `accent` (darker player colour), `undersuit`, `visor`, `trim`, `light`.
  - Can: `metal`, `label` (needs UVs: u once around, v bottom → top; the claw-scratch label is drawn on a
    canvas in the power-up's colour).
  - Soaker: `body`, `accent`, `trim`, `tank`, plus an empty named `muzzle` where the custard comes out.
  - Spring: `metal`, `pad`; 1 m tall from its base (the game stretches it in Y).
- **Ambient occlusion** goes in the active colour attribute (`AO`, exported as `COLOR_0`); the game
  multiplies it into the material colours.

## Changing a model

Edit the matching `build_*()` function, run the script, and look at it in the game on High (or
`?test&quality=high`). The overshield bubble and the Cat in the Hat costume are added by the game, so they
fit any Spartan with the same node tree.
