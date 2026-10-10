# AI-made models go here

Put the `.glb` files from Meshy, Tripo or another AI 3D tool in this folder. On GitHub that's
**Add file → Upload files**. Name each file after the model it replaces:

`spartan` · `cat` · `can` · `spring` · `sniper` · `br` · `crossbow` · `rpg` · `grenade` · `railgun` · `hyperbeam` ·
`needler` · `flamethrower` · `minigun` · `orbital` · `soaker` · `frag` · `plasma`

Then list each one in `models.json` and import them with `npm run models:import`, or ask Claude to.

**[tools/models/AI_MODELS.md](../tools/models/AI_MODELS.md)** has prompts for every model, the export settings,
and how to check and tune the fit.

These are the original, full-size files. The game only downloads the small copies the importer writes to
`public/models/ai/`.
