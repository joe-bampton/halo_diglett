# Sound shopping list

Every sound effect in the game (gunshots, explosions, beeps…) is currently made by code
in `src/audio/synth.ts`. You can swap any of them for a real recording. A sound you don't
replace keeps working as it is, so go one sound at a time, starting with the ★ ones:
those are heard all the time.

One file per sound is enough. Give a sound two or three files and the game picks one at
random each time it plays, which is great for gunshots.

## Where to find sounds

| Where | What's there | Licence |
|---|---|---|
| [Kenney](https://kenney.nl/assets/category:Audio) | Small, tidy packs: *Sci-fi Sounds*, *Impact Sounds*, *Interface Sounds*, *UI Audio*, *Digital Audio*, *RPG Audio*, *Casino Audio*. Great for menus, hit markers, sci-fi weapons and thuds. Hardly any realistic guns. | CC0 |
| [Sonniss GameAudioGDC](https://sonniss.com/gameaudiogdc) | Huge free bundles (tens of GB) of professional sounds, a new one every year. The best place for real guns, explosions, reloads and impacts. | Royalty-free (their own licence) |
| [Freesound](https://freesound.org) | Everything, of mixed quality. After searching, set the **Licence** filter to **Creative Commons 0**. Downloading needs a free account. | Pick CC0 |

### Licences in one minute

- **CC0:** do anything you like, no credit needed. The best choice.
- **Sonniss GDC:** free to use in your game, no credit needed. Its licence doesn't let you
  share the original files on their own, though, and a public GitHub repo counts as
  sharing. Read the licence that comes with the bundle. To be safe, upload Sonniss
  originals only if the repo is private. Otherwise run the import on your own computer
  and commit only the MP3s it makes, not the files in `sources/`.
- **CC-BY:** fine, but the author must be credited. Fill in `source` and `license` and
  `CREDITS.md` does the crediting.
- **Anything "NC" (non-commercial), or no licence at all, or ripped from a game or
  YouTube:** skip it. The import script warns about NC licences.

## The sounds

**Level** is how loud the import makes the sound (see the README). **Length** is a guide:
longer files work, but a gunshot with a 3-second tail smears when someone fires fast.

### Guns ("gun" level: loudest after explosions)

| Sound | In the game | Look for | Length | Search for |
|---|---|---|---|---|
| ★ `sniper` | Sniper Rifle shot. The classic weapon, heard the most. | A big, sharp crack with a boom and an outdoor echo | 0.8–1.5 s | sniper rifle shot, rifle gunshot outdoor, 50 cal |
| ★ `rifle` | Battle Rifle: plays for each bullet of its 3-round burst (50 ms apart) | A short, punchy rifle shot with a tight tail | 0.2–0.4 s | assault rifle single shot, rifle shot short |
| `crossbow` | Crossbow shot | String twang and a "thwip" | 0.3–0.6 s | crossbow shot, bow release, arrow whoosh |
| ★ `rocket` | Rocket Launcher: the rocket leaving (played a little fast) | An ignition thump into a whoosh | 0.6–1.2 s | rocket launch, RPG fire, missile launch |
| `bloop` | Grenade Launcher shot | A hollow "thoonk" | 0.2–0.4 s | grenade launcher, M79, tube launcher, mortar launch |
| `rail` | Railgun shot. Also the Hyperbeam firing, played slowed down to 0.6×. | A sci-fi electric zap with weight | 0.6–1.0 s | railgun, sci-fi heavy gun, laser cannon, plasma shot |
| `needle` | Needler: 12 shots a second, each plays it | A tiny glassy "pew" | 0.08–0.2 s | sci-fi small shot, laser blip, crystal tick |
| `minigun` | Minigun power-up: 20 shots a second, each plays it | **One** very short, dry shot. A recording of continuous fire won't work. | under 0.12 s | machine gun single shot, gatling shot |

### Weapon sounds ("weapon" level)

| Sound | In the game | Look for | Length | Search for |
|---|---|---|---|---|
| `charge` | Railgun and Hyperbeam charging while you hold the trigger (stops when you let go) | A rising electric whine | 0.7–1.0 s | charge up, sci-fi charge, power up whine |
| `beamLoop` | Hyperbeam: the beam hum while it fires. **Loops.** | A steady energy hum. The import makes the ends join smoothly; pick a steady part with `start`/`end`. | 1–2 s | laser beam loop, energy beam hum, force field loop |
| `flameLoop` | Not heard at the moment (the Flamethrower uses `rustle`). Skip it. | | | |
| `whistle` | Orbital strike incoming: starts 1.6 s before it hits | A falling bomb whistle, pitch dropping | 1.5–2 s | bomb whistle, falling bomb, incoming shell |

### Explosions ("explosion" level: the loudest)

| Sound | In the game | Look for | Length | Search for |
|---|---|---|---|---|
| ★ `explosion` | Rockets, grenades and orbital strikes (played slower and deeper for the big ones), Needler supercombine (played faster) | A big outdoor explosion with debris and a long rumble | 1.5–3 s | explosion, grenade explosion, rocket impact, distant explosion |

### Things happening ("action" level)

| Sound | In the game | Look for | Length | Search for |
|---|---|---|---|---|
| `shieldBreak` | Someone's shield pops (yours, or another player's nearby) | A glassy energy shatter | 0.3–0.6 s | shield break, energy shatter, force field down |
| ★ `thud` | A player slumps dead, and a Spring Jump landing | A dull, heavy body fall | 0.2–0.5 s | body fall, thud, heavy impact dirt |
| `orbPop` | A power-up ball gets shot open | A sparkly pop and a short chime | 0.4–0.8 s | magic pop, bubble pop chime, item pickup sparkle |
| `partyHorn` | Grunt Birthday Party skull: a headshot kill | A party horn toot | 0.5–1 s | party horn, party blower, noisemaker |
| `boing` | Spring Jump launch | A cartoon spring "boing" | 0.5–0.9 s | boing, spring, cartoon jump |
| `whoosh` | Spring Jump flight | Rushing air that swells and fades | 1–1.5 s | whoosh, air rush, swoosh |
| `pump` | Gerry Sauce: pumping the Super Soaker | Two quick air-pump wheezes | 0.4–0.6 s | air pump, bike pump, water gun pump |
| `squirt` | Gerry Sauce squirt, and every Super Soaker shot | A pressurised water jet | 0.8–1.2 s | water squirt, water gun, spray burst |
| `splat` | Sauce lands on someone | A gooey wet splat | 0.3–0.6 s | splat, slime, goo, wet impact |
| `canOpen` | Pitre Mode: a power-up can gets shot open | A soda can tab crack and "pssht" | 0.4–0.7 s | soda can open, can crack open |
| `fizz` | Pitre Mode: the can fizzing over, right after `canOpen` | Fizzing bubbles | 1–1.5 s | soda fizz, carbonation, fizzy drink |

### Feedback and menus ("ui" level)

| Sound | In the game | Look for | Length | Search for |
|---|---|---|---|---|
| ★ `hitTick` | Hit marker: your shot hit someone | A tiny crisp tick | 0.03–0.1 s | hit marker, tick, UI click |
| ★ `ding` | Headshot hit marker | A bright metallic "ding" | 0.3–0.6 s | ding, metal ping, bell hit |
| `recharge` | Your shield starts recharging | A rising energy whir | 0.6–1.2 s | shield recharge, energy charge, power up |
| `lowShield` | Low shield alarm (repeats while your shield is low), and the "Get up!" warning | Two short warning beeps | 0.3–0.5 s | warning beep, alarm beep, low health |
| `powerup` | A power-up ball appears (played high), and you get a power-up | A rising jingle | 0.5–1 s | power up, level up, pickup jingle |
| `medal` | You earn a medal (double kill, killing spree…) | A short reward chime | 0.3–0.7 s | achievement, reward chime, UI success |
| `beep` | The last 10 seconds of a match, once a second. Also the Orbital Designator firing. | A short clean beep | 0.1–0.2 s | countdown beep, timer beep, UI beep |
| `spawn` | You spawn | A soft sci-fi shimmer | 0.4–0.8 s | spawn, teleport, materialize |

### Small handling noises ("foley" level: the quietest)

| Sound | In the game | Look for | Length | Search for |
|---|---|---|---|---|
| ★ `reload` | You reload | Two mechanical clicks: magazine out, magazine in | 0.4–0.8 s | gun reload, magazine insert, rifle reload |
| `rustle` | You duck or stand up in your foxhole. Also the Flamethrower, played at half speed. | A short cloth and gear rustle | 0.15–0.3 s | cloth rustle, gear movement, clothing foley |
| `empty` | Pulling the trigger with an empty gun | A dry trigger click | 0.05–0.15 s | dry fire, empty gun click, trigger click |

## Step by step

1. **Download and listen.** Pick the best one to three files for a sound. You don't need
   to edit them: `start` and `end` (below) cut a part out.
2. **Rename them simply** (optional), e.g. `sniper-1.wav`. Keep the ending (`.wav`,
   `.ogg`, `.mp3`, `.flac` or `.m4a` all work).
3. **Upload them to `tools/sfx/sources/`.** On GitHub, open that folder, click
   **Add file → Upload files**, drop them in and click **Commit changes**. Upload only the
   files you picked, never whole packs: they're huge, and GitHub takes at most 25 MB per
   file this way. Subfolders are fine. Mind the Sonniss note above.
4. **Say which file is which sound in `tools/sfx/sfx.json`.** On GitHub, open the file and
   click the pencil icon. The example below shows the format; the `_example` part that's
   in the file now is ignored.
5. **Run the import** on a computer with Python and ffmpeg (or ask Claude Code to do it):

   ```sh
   python3 -m venv tools/sfx/.venv
   tools/sfx/.venv/bin/pip install -r tools/sfx/requirements.txt
   tools/sfx/.venv/bin/python tools/sfx/import.py
   ```

   It prints a line per file, and warnings if something is off.
6. **Listen in the game** (`npm run dev`). If something is too loud or too quiet, give that
   file a `gain` (0.8 = a bit quieter, 1.3 = louder) and run the import again. Then
   commit `public/audio/sfx/`, `public/audio/manifest.json` and `tools/sfx/CREDITS.md`.

To go back to the synthesized sound, delete the sound's entry from `sfx.json` and run the
import again. It deletes the old MP3s.

### `sfx.json` example

```json
{
  "sniper": [
    { "file": "sniper-1.wav", "end": 1.4, "source": "Sonniss GameAudioGDC 2024, <pack name>", "license": "Sonniss GDC licence" },
    { "file": "sniper-2.flac", "start": 0.12, "source": "https://freesound.org/s/<number>/ by <user>", "license": "CC0" }
  ],
  "explosion": [
    { "file": "kenney/<the file you picked>.ogg", "source": "Kenney Sci-fi Sounds", "license": "CC0" }
  ],
  "reload": [
    { "file": "reload.wav", "gain": 0.8, "source": "https://freesound.org/s/<number>/ by <user>", "license": "CC0" }
  ]
}
```

| Field | |
|---|---|
| `file` | The file's name inside `tools/sfx/sources/`, with subfolders (`kenney/…`). Capitals matter. **Required.** |
| `start`, `end` | Optional: use only this part of the file, in seconds. |
| `gain` | Optional: 1 = normal, 0.8 = a bit quieter, 1.3 = louder. |
| `source` | Where it's from: pack name or web page. |
| `license` | CC0, Sonniss GDC licence, CC-BY 4.0… |

JSON is picky: names in "double quotes", a comma between entries but none after the last
one. If the import says the file isn't valid JSON, look for a missing or extra comma.
