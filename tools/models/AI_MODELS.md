# Better models with AI 3D tools

The game's own models are simple shapes built in code. You can replace any of them with a model made by an AI
3D generator. The game does the fitting itself: it turns, scales and cuts each model so it stands in the hole,
aims and ducks, and holds its gun the right way.

These models show on **High** and **Ultra** graphics. Low and Medium keep the built-in ones, so phones stay
fast. Any model you don't make keeps its built-in version.

## 1. Make the model

Use any tool that exports **GLB** with textures, for example:
- [Meshy](https://www.meshy.ai)
- [Tripo](https://www.tripo3d.ai)
- [Hyper3D Rodin](https://hyper3d.ai)
- Hunyuan3D

Most have a free tier. Check its terms if the game will be public: some free plans want credit or don't allow
public use.

**Tips**
- **Image-to-3D beats text-to-3D for characters.** First make a picture of the character in the pose you want
  (ChatGPT, Midjourney or Higgsfield all work). Then give that picture to the 3D tool.
  - Higgsfield makes images and video, not 3D models, so it only helps with this first step.
- **Pose:** arms forward and bent, as if holding a rifle, **with empty hands**. The game puts the gun in.
  - A T-pose or A-pose works too, but the arms stick out sideways.
- **Characters:** plain **white or light grey armour**. The game paints those parts in each player's colour.
  Keep the visor and other details in a real colour (gold, black…) so they stay that colour.
- **Weapons:** side view, nothing in the background, no hands.
- **Size of the download:**
  - Ask for "low poly" or set a triangle limit if the tool has one: about 20,000 for characters, 5,000 for guns.
  - 1024 or 2048 textures.
  - The importer shrinks anything bigger, so don't worry too much.
- **No rig or animation needed.** The importer throws them away; the game moves the parts itself.
- **Brands:** for a public site, avoid real logos and names (an energy drink's wordmark, for example).

### Prompts

| Slot | What it is | Prompt to start from |
|---|---|---|
| `spartan` | every player | *Sci-fi armoured super-soldier, Halo-inspired, bulky plain white armour plates, gold reflective visor, black undersuit at the joints, standing, arms raised forward holding an invisible rifle, empty hands, game asset, PBR* |
| `cat` | Pitre Mode: the leader's costume | *Cartoon cat standing upright like a person, white face and belly, black fur, tall red-and-white striped top hat, big red bow tie, mischievous grin, arms forward as if holding a rifle, empty hands, stylised game character* |
| `can` | Pitre Mode: power-ups | *Tall black aluminium energy drink can, silver top and bottom, three glowing green claw-scratch marks on the side, no text, game prop* |
| `spring` | Spring Jump | *Big chunky metal coil spring with a round teal launch pad on top, cartoon game prop* |
| `sniper` | Sniper Rifle | *Long sci-fi sniper rifle, Halo-inspired, dark gunmetal, long thin barrel, big scope, bullpup stock, side view, game asset* |
| `br` | Battle Rifle | *Sci-fi battle rifle, olive green and black, short scope on top, compact bullpup, side view* |
| `crossbow` | Crossbow | *Futuristic crossbow, dark wood and black metal, glowing blue string* |
| `rpg` | Rocket Launcher | *Twin-tube sci-fi rocket launcher, olive drab, shoulder-fired* |
| `grenade` | Grenade Launcher | *Single-shot sci-fi grenade launcher, wide barrel, green glowing ring at the muzzle* |
| `railgun` | Railgun | *Sci-fi railgun, two parallel rails with glowing blue coils, dark grey* |
| `hyperbeam` | Hyperbeam | *Alien energy beam cannon, purple and black, glowing pink crystals* |
| `needler` | Needler | *Alien pistol with pink glowing crystal spikes sticking out of the top, purple shell* |
| `flamethrower` | Flamethrower | *Sci-fi flamethrower, fuel tank under the barrel, orange warning stripes* |
| `minigun` | Minigun | *Six-barrel rotary minigun, carry handle, black and steel* |
| `orbital` | Orbital Designator | *Handheld laser target designator, red lens, chunky grey* |
| `soaker` | Gerry Sauce Super Soaker | *Toy water blaster, bright orange body, green nozzle, clear tank full of white cream* |
| `frag` | Frag Grenade | *Military frag grenade, olive green, ribbed oval body, spoon and pin* |
| `plasma` | Plasma Grenade | *Alien plasma grenade, glowing blue sphere held in a dark metal cage* |

## 2. Upload it

1. Name the file after its slot, e.g. `sniper.glb` or `spartan.glb`.
2. On GitHub, open the **`models-src`** folder, then **Add file → Upload files**, and commit.
3. Add a line for it to `models-src/models.json` (copy one of the `_example` lines and drop the `_example_` from
   its name), or just ask Claude to do it.

## 3. Import it

Ask Claude ("import the new models"), or run it yourself:

```sh
npm run models:import              # every model in models.json
npm run models:import -- sniper    # just one
```

This writes small, compressed copies into `public/models/ai/`. For example, a 30 MB Meshy export becomes about
1 MB. It also writes `public/models/ai/manifest.json`, which the game reads.

## 4. Check the fit

Open the model viewer: `http://localhost:5173/?modelview=sniper` (or `spartan`, `cat`…, or `all`). It shows the
built-in model next to yours, turning.

- **Characters** stand on a grey ring, which is the hole's rim. Red wireframes show the hitboxes: what you see
  should be what can be hit. The viewer also aims the character up and down and ducks it, so you can check the
  cuts at the waist and neck.
- **Weapons:** the green dot is the grip, the red dot the muzzle.

If something's off, change that slot's line in `models-src/models.json` and run
`npm run models:import -- --manifest-only`, which takes a second. **Ask Claude to do this.** It can take
screenshots of the viewer and tune it for you.

| Setting | For | What it does |
|---|---|---|
| `rotate: [x, y, z]` | all | Turn the model first, in degrees. Characters must face away from the camera in the viewer's right-hand copy, like the built-in one. The default for characters is `[0, 180, 0]`. |
| `size` | all | Characters: feet to top of head, default 2.35. Weapons: length in metres. Props: height. |
| `flip: true` | weapons | It's backwards (the muzzle dot is on the stock). |
| `grip: [a, b, c]` | weapons | Where the hand holds it, as fractions of its box: left→right, bottom→top, muzzle→stock. Default `[0.5, 0.3, 0.62]`. |
| `muzzle: [a, b, c]` | weapons | Where shots come out, same fractions. Default `[0.5, 0.62, 0]`. |
| `waist`, `neck` | characters | Heights of the cuts between legs, upper body and head. Defaults 0.05 and 0.76 m, with 0 at the rim. |
| `hand: [x, y, z]` | characters | Where the gun sits, relative to the chest. Default `[0.05, -0.2, -0.3]`. |
| `tint: false` | spartan | Keep the texture's own colours instead of painting the light parts in each player's colour. |

## How it works

- **The importer** (`tools/models/import.mjs`, using gltf-transform, meshoptimizer and sharp):
  - removes animations and rigs, and merges the meshes
  - simplifies to 15,000 triangles for characters and 6,000 for weapons
  - shrinks textures to WebP (1024 px for characters, 512 px for everything else)
  - compresses the geometry with meshopt
- **The game** (`src/render/aiModels.ts`, `src/render/models.ts`):
  - **Characters** are scaled so the top of the head sits just above the head hitbox (0.95 m above the rim), feet
    down in the hole. They are cut by triangle into legs, upper body and head, which hang on the same pivots as the
    built-in Spartan: the upper body turns to aim up and down, and the head grows with Big Heads.
  - **Player colour:** light, unsaturated texels of the Spartan's texture take the player's colour.
  - **The cat** is worn instead of the Spartan by the leader in Pitre Mode.
  - **Weapons** are laid barrel-forward along their longest side and scaled to length, with the grip at the origin.
    The same model is used in first person (at 0.6×) and in other players' hands.
- **Fallback:** a slot whose file is missing, broken or not in the manifest keeps its built-in model.
