# Voice lines

The announcer calls and Pitre-mode shouts in `public/audio/` are pre-rendered
MP3s. Nothing is spoken with browser text-to-speech at runtime.

- Speech comes from [Kokoro-82M](https://github.com/hexgrad/kokoro) (Apache-2.0),
  run on the CPU through the `kokoro-onnx` package.
- Each take is then processed in Python: WORLD vocoder (`pyworld`) for pitch,
  formants and timing, plus EQ, compression, and a short stadium reverb for the
  announcer.
- Every file is trimmed, matched to the same loudness and encoded as a small
  mono MP3. `public/audio/manifest.json` is written from the same table.

No ffmpeg or sox is needed.

## Run it

```sh
python3 -m venv tools/voices/.venv
tools/voices/.venv/bin/pip install -r tools/voices/requirements.txt
tools/voices/.venv/bin/python tools/voices/generate.py
```

On its first run the script downloads the Kokoro model (`kokoro-v1.0.onnx`,
310 MB) and voices (`voices-v1.0.bin`, 27 MB) from the
[kokoro-onnx GitHub release](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0)
into `tools/voices/models/` and checks their SHA-256. If the download is
blocked, fetch the two files yourself and put them in that folder. A full render
takes about a minute on a laptop CPU. Kokoro is deterministic, so a re-run with
the pinned requirements rebuilds the same files.

| Command | What it does |
| --- | --- |
| `generate.py` | Render everything and rewrite `manifest.json`. |
| `generate.py --only pitre.mama ann.double` | Render only these slots. File names and prefixes also work, e.g. `--only pitre.` or `--only announcer/`. |
| `generate.py --wav` | Also save WAV copies of the final audio to `tools/voices/out/`. |
| `generate.py --list` | Print the line table. |
| `generate.py --phonemes` | Show how Kokoro will pronounce each line. |
| `generate.py --report` | Print the duration, loudness, peak and size of each MP3 on disk. |

`.venv/`, `models/` and `out/` are gitignored.

## Changing a line

All lines are defined in the `TAKES` table at the top of `generate.py`, one row
per take:

```python
T("pitre.byebye", "pitre/bye_bye_1.mp3", "am_puck", 1.00, "pitre", "Bye, bye!",
  melody=[4, (0, -1)], keep=0.25, stretch_last=2.6, vibrato=(5.5, 0.35, 0.55)),
```

The columns are: slot id, output file, Kokoro voice, speed, effect chain, text,
and optional settings. The comment above the table explains every option.

- **Several takes.** Rows that share a slot are alternative takes. The game
  picks one at random.
- **Voices.** A voice is a Kokoro voice id or a blend such as
  `"am_onyx*0.6+am_fenrir*0.4"`. The American voices start with `am_`/`af_` and
  the British ones with `bm_`/`bf_`. The male voices that sound best are
  `am_fenrir`, `am_michael`, `am_puck`, `bm_fable` and `bm_george`.
- **Pronunciation.** Text between slashes is sent to Kokoro as IPA without
  going through the phonemizer. It fixes words the phonemizer gets wrong, e.g.
  `"/pɹˈæŋk əm, dʒˈɑːn!/"` for "prank 'em, John" (plain text reads "'em" as the
  letter M). Run `--phonemes` to see what the phonemizer does with a line.
- **Effect chains:**

  | Chain | Use |
  | --- | --- |
  | `pitre` | Player shouts (the Pitre lines and the Jerry bots' "Suppressing fire!"). |
  | `baby` | A female voice made into a toddler: pitch +8 to +11 semitones and formants ×1.28, with a whiny rise and vibrato at the end. |
  | `brap` | Voice plus a low gunshot thump under each "brap". |
  | `announcer` | Deep stadium voice: `am_fenrir` −4.5 semitones, formants ×0.9, compression, slapback and a short bright reverb. |
  | `pufferfish` | Synthesized, no speech. |
  | `file` | A hand-made MP3 that is never regenerated. |

  The chains' defaults are in `FX_DEFAULTS`.
- **Balance.** `SLOT_GAIN` sets the per-slot `gain` in the manifest.

After an edit, run `generate.py --only <slot>`. The run prints a warning when a
melody's note count does not match the syllables it found, or when the limiter
had to work hard.

## Replacing a sound with your own file

1. Save your MP3 over the generated file, **keeping the same path and name**,
   e.g. `public/audio/pitre/pufferfish.mp3`. The game only reads the manifest,
   so nothing else needs to change. Short, mono, 44.1 kHz MP3s at roughly
   −16 LUFS will sit level with the other files. If your file is louder or
   quieter, change the slot's `gain` in `manifest.json`, and in `SLOT_GAIN` so
   the change survives the next run.
2. So the generator does not overwrite your file, change that row's `fx` to
   `"file"` in `TAKES`. The row stays in the manifest but is never
   regenerated. Alternatively, only ever run the generator with `--only` for
   other slots.
3. To add a take, add a row with the same slot (use `fx="file"` for a
   hand-made MP3) and re-run. Every run rewrites `manifest.json` from the
   table, so hand edits to it are lost.

### "Bitch, please!", "How many bullets?!" and "Suppressing fire!"

`pitre/bitch_please_*.mp3`, `pitre/how_many_bullets_*.mp3` and
`jerry/suppressing_fire_*.mp3` are original Kokoro takes, not clips from any
show. To use your own recording instead, save it over one of those files and
set its row's `fx` to `"file"` (or delete the other rows of that slot so only
your clip plays). You must have the right to use the clip.

### The pufferfish sound

`pitre/pufferfish.mp3` is an **original placeholder**, not the meme clip. It is
a cartoon inflating squeak, a pop and a deflating raspberry, synthesized in
`chain_pufferfish()`. To use the real clip, drop it in as
`public/audio/pitre/pufferfish.mp3` and set that row's `fx` to `"file"`. You
must have the right to use the clip.

## Output format

- **Format:** MP3, mono, 44.1 kHz, 96 kbps CBR. Each file carries a LAME "Info"
  header with the encoder delay and padding. Decoders that read it decode the
  exact samples, so there is no ~25 ms codec gap before a sound. FFmpeg (which
  Chrome uses), mpg123 and dr_mp3 were checked.
- **Trimming:** about 8 ms of silence is kept before the first sound (at most
  ~16 ms before it reaches −40 dB below the peak). Tails fade out.
- **Loudness:** every file measures −16 LUFS after MP3 decoding. The meter is
  gated like BS.1770, but it uses 200 ms blocks because the clips are so short.
  With standard 400 ms blocks the same files read about 0.3 LU lower.
- **Peaks:** a look-ahead limiter keeps peaks at or below −1 dBFS. Speech that
  is compressed this much peaks between about −1 and −5.5 dBFS at −16 LUFS.
- **Size:** the whole set is about 0.7 MB.

`manifest.json`:

```json
{ "version": 1,
  "slots": {
    "pitre.prank": { "files": ["audio/pitre/prank_em_john_1.mp3", "..."], "gain": 1.0 },
    "ann.double":  { "files": ["audio/announcer/double_kill.mp3"], "gain": 1.0 }
  } }
```

File paths are relative to the site root, because Vite serves `public/` at `/`.
The game picks a random entry from `files` and plays it at `gain`, which runs
from 0 to 1.5.

## Licences

- The Kokoro-82M weights and voices are Apache-2.0, and the audio made with
  them can be used freely.
- The phonemizer uses espeak-ng (GPL-3.0) through `espeakng-loader`. It runs
  only on the build machine and is not shipped with the game.
- The pufferfish placeholder is procedural.
