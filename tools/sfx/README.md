# Sound effects from files

The game synthesizes all its sound effects in `src/audio/synth.ts`. `import.py` replaces
any of them with real recordings (CC0 packs and the like). **[SOUND_LIST.md](SOUND_LIST.md)
says what each sound is, where to find replacements and how to add them, step by step.**

- `sources/`: the files you downloaded. These are your files and they are committed (not
  gitignored), so you can upload them on GitHub. Mind the licences: see SOUND_LIST.md.
- `sfx.json`: which source file becomes which sound. Keys starting with `_` are ignored.
- `CREDITS.md`: written by the import: where every file came from.

## Run it

You need Python 3 and [ffmpeg](https://ffmpeg.org/download.html) (macOS: `brew install ffmpeg`,
Windows: `winget install ffmpeg`, Linux: `sudo apt install ffmpeg`).

```sh
python3 -m venv tools/sfx/.venv
tools/sfx/.venv/bin/pip install -r tools/sfx/requirements.txt
tools/sfx/.venv/bin/python tools/sfx/import.py
```

| Command | What it does |
|---|---|
| `import.py` | Import everything in `sfx.json`, update the manifest and `CREDITS.md`, delete MP3s that are no longer listed. |
| `import.py --only sniper explosion` | Import only these sounds (prefixes work too). |
| `import.py --list` | Every sound, its category and level, and whether it uses files or is synthesized. |
| `import.py --report` | Duration, loudness, peak and size of each imported MP3. |

`--src`, `--config`, `--out`, `--manifest` and `--credits` point it at other files, for testing.
It exits with an error code if any entry had a problem (missing file, unknown sound); the
other sounds are still imported.

## What it does to each file

1. Decodes it with ffmpeg (wav, mp3, ogg, flac, m4a, …), mixes it to mono at 44.1 kHz and
   cuts out `start`–`end`.
2. Removes DC and sub-25 Hz rumble.
3. Trims the silence: keeps 4 ms before the sound starts and the tail until it fades
   60 dB under the peak, then fades out over 30 ms. Loops (`beamLoop`, `flameLoop`) aren't
   trimmed; their last 60 ms is crossfaded into the start so they loop without a click.
4. Matches the loudness to the sound's category, times the entry's `gain`, with a look-ahead
   limiter keeping peaks at or under −1 dBFS. If a sharp sound would need more limiting
   than its category allows, it stays a bit quieter instead and keeps its punch.
5. Encodes a mono 128 kbps MP3 with the same gapless header as the voice lines (sample-exact
   start, so loops and gunshots have no codec gap): `public/audio/sfx/<id>_<n>.mp3`.

| Category | Level (LUFS) | Max limiting | Sounds |
|---|---|---|---|
| explosion | −15 | 6 dB | explosion |
| gun | −17 | 6 dB | sniper, rifle, crossbow, rocket, bloop, rail, needle, minigun |
| weapon | −20 | 3 dB | charge, beamLoop, flameLoop, whistle |
| action | −19 | 6 dB | shieldBreak, thud, orbPop, partyHorn, boing, whoosh, pump, squirt, splat, canOpen, fizz |
| ui | −22 | 3 dB | hitTick, ding, recharge, lowShield, powerup, medal, beep, spawn |
| foley | −25 | 3 dB | reload, rustle, empty |

Loudness is measured like the voice lines (−16 LUFS, gated, 200 ms blocks). The table is
`CATEGORIES` and `SOUNDS` at the top of `import.py`. A sound added to `synth.ts` later
shows up automatically; give it a category there.

## In the game

The import writes one `sfx.<id>` slot per sound into `public/audio/manifest.json` and leaves
the voice lines alone (`tools/voices/generate.py` and `import.py` keep the `sfx.*` slots too):

```json
"sfx.sniper": { "files": ["audio/sfx/sniper_1.mp3", "audio/sfx/sniper_2.mp3"], "gain": 1.0 }
```

The game starts with the synthesized sounds and swaps each one for its files once they
are decoded, so nothing waits for downloads. Each shot picks one of the files at random.
A file that fails to load is skipped, and a sound whose files all fail stays synthesized.
Positional 3D sound, the slight random pitch and all the per-sound volume and speed
settings work as before. `gain` in the manifest scales the whole sound (1 = as imported).
