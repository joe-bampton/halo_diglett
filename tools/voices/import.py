#!/usr/bin/env python3
"""Turn friends' phone recordings into Halo Diglett voice lines.

Reads tools/voices/recordings/<friend>/<slot>_<n>.<ext> (m4a, mp3, wav, ogg, webm,
aac, flac: anything ffmpeg reads) and cleans each take up: 80 Hz high-pass,
spectral-gating noise reduction (noisereduce) learned from the quietest half
second of the recording, gentle compression. Then it is trimmed, matched to
-16 LUFS with peaks limited to -1 dBFS and encoded as a small mono MP3 exactly
like generate.py does, in public/audio/voices/<friend>/.

recordings.json lists the takes and public/audio/manifest.json is rebuilt: a line
that anyone recorded plays only the recordings (no more robot voice), and the
game prefers the takes of the player who is speaking.

    tools/voices/.venv/bin/python tools/voices/import.py             # every recording
    tools/voices/.venv/bin/python tools/voices/import.py --only john pitre.mama
    tools/voices/.venv/bin/python tools/voices/import.py --list      # who recorded what
    tools/voices/.venv/bin/python tools/voices/import.py --report    # measure the MP3s
    tools/voices/.venv/bin/python tools/voices/import.py --fx        # a little character per line

RECORDING.md (for the people recording) and README.md are next to this file.
"""
from __future__ import annotations

import argparse
import json
import re
import time
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np

import clips
import generate as G

warnings.filterwarnings("ignore", message="pkg_resources is deprecated")   # pyworld, harmless

HERE = Path(__file__).resolve().parent
SRC = HERE / "recordings"
OUT = G.AUDIO_DIR / "voices"
URL = "audio/voices/"          # how the manifest refers to OUT (relative to the site root)
SR = clips.SR

# =============================================================================
#  Clean-up settings
# =============================================================================
HP_HZ = 80                       # high-pass: rumble, handling noise, wind (twice: 24 dB/octave)
DENOISE = 0.85                   # share of the background noise to remove (0 = off, 1 = all)
COMP = (-16.0, 2.0, 5.0, 120.0)  # gentle: threshold (dB under the peak), ratio, attack ms, release ms
TAIL = 0.08                      # silence kept after the last word, seconds
TOO_LONG = 4.0                   # longer than this: probably several takes in one file

# What each line says, for --list (the table's text is IPA for some of them).
SAY = {
    "pitre.prank": "Prank 'em, John!", "pitre.mama": "Mama!",
    "pitre.pufferfish": "(pufferfish noise)", "ann.killtacular": "Killtacular!",
    "ann.killtrocity": "Killtrocity!", "ann.sauce": "Gerry Sauce!",
}


# =============================================================================
#  --fx: a light touch per line (off by default: friends sound like themselves)
# =============================================================================
def fx_announcer(x):
    """A touch of the announcer's EQ and stadium reverb."""
    o = G.FX_DEFAULTS["announcer"]
    x = G.eq(x, SR, o["eq"])
    x = x / max(np.abs(x).max(), 1e-9)
    return G.add_space(x, SR, **{**o["space"], "wet": 0.14, "slaps": [(0.105, 0.18), (0.215, 0.07)]})


def fx_shout(x):
    """Pitre lines: brighter, more forward, a bit of grit."""
    return G.saturate(G.eq(x, SR, G.FX_DEFAULTS["pitre"]["eq"]), 1.25)


def fx_baby(x):
    """"Mama!": a few semitones up and a smaller head (WORLD vocoder)."""
    return G.world_fx(x, SR, {"pitch": 4.0, "formant": 1.12, "f0_range": (70, 1000)}, "mama")


def fx_brap(x):
    """"Brap brap brappp": a low gunshot thump under each brap (like generate.py's brap chain)."""
    o = G.FX_DEFAULTS["brap"]
    x = G.trim(x, SR, pre=0.0, post=0.05, tail_db=40)
    rng = np.random.default_rng(7)
    lead, peak = int(0.01 * SR), np.abs(x).max()
    out = np.concatenate([np.zeros(lead), x, np.zeros(int(0.2 * SR))])
    for k in G.word_onsets(x, SR, 3):
        p = max(0, lead + k + int(o["thump_offset"] * SR))
        th = G.thump(SR, rng, o["crack"]) * o["thump"] * peak
        m = min(len(th), len(out) - p)
        out[p:p + m] += th[:m]
    return out


def fx_jerry(x):
    """"Suppressing fire!": panicky and nasal."""
    return G.saturate(G.eq(x, SR, [("hp", 180), ("peak", 1400, 1.0, 4.0), ("peak", 3200, 0.9, 3.0)]), 1.6)


FX = [  # the first matching slot prefix wins; None = leave it natural
    ("ann.", fx_announcer),
    ("pitre.mama", fx_baby),
    ("pitre.brap", fx_brap),
    ("pitre.pufferfish", None),
    ("pitre.", fx_shout),
    ("jerry.", fx_jerry),
]

# =============================================================================
#  Implementation
# =============================================================================
SLOTS = list(dict.fromkeys(t.slot for t in G.TAKES))
QUIET_EXTS = {".md", ".txt", ".json", ".gitkeep"}       # notes next to the recordings: ignored
OUT_NAME = r"[a-z]+\.[a-z_]+_\d+\.mp3"                   # what this script writes (stale-file cleanup)


@dataclass(eq=False)
class Rec:
    src: Path
    by: str             # the friend's folder name, as written
    slot: str
    n: int
    name: str = ""      # output, relative to OUT: "john/pitre.prank_1.mp3"


def slot_of(stem: str) -> tuple[str, int] | None:
    """'pitre.prank_2' -> ('pitre.prank', 2). Forgiving: 'Pitre.Prank 2', 'prank-2',
    'prank' and 'pitre.prank_2 (1)' work too."""
    s = re.sub(r"\s*\(\d+\)$", "", stem.strip().lower())
    s = re.sub(r"[\s\-]+", "_", s)
    m = re.fullmatch(r"(.*?)_?(\d+)", s)
    base, n = (m.group(1), int(m.group(2))) if m else (s, 0)
    if base in SLOTS:
        return base, n
    short = [k for k in SLOTS if k.split(".", 1)[1] == base]
    return (short[0], n) if len(short) == 1 else None


def scan(src: Path) -> tuple[list[Rec], list[str]]:
    recs, problems = [], []
    for p in sorted(src.rglob("*")) if src.exists() else []:
        if not p.is_file() or p.name.startswith(".") or p.suffix.lower() in QUIET_EXTS:
            continue
        rel = p.relative_to(src)
        if len(rel.parts) < 2:
            problems.append(f"{rel}: put it in a folder named after you, e.g. recordings/john/{p.name}")
        elif p.suffix.lower() not in clips.AUDIO_EXTS:
            problems.append(f"{rel}: not a sound file ({p.suffix})")
        elif not (hit := slot_of(p.stem)):
            problems.append(f"{rel}: which line is this? Name it like pitre.prank_1{p.suffix} (see RECORDING.md)")
        else:
            recs.append(Rec(p, rel.parts[0], *hit))
    # each friend's takes of a line become 1, 2, 3 … in the order of their numbers
    groups: dict[tuple[str, str], list[Rec]] = {}
    for r in recs:
        groups.setdefault((clips.slug(r.by), r.slot), []).append(r)
    for (who, slot), rs in groups.items():
        rs.sort(key=lambda r: (r.n, r.src.name))
        for i, r in enumerate(rs, 1):
            r.name = f"{who}/{slot}_{i}.mp3"
    recs.sort(key=lambda r: (SLOTS.index(r.slot), r.name))
    return recs, problems


def quietest(x: np.ndarray) -> slice | None:
    """The quietest half second (the second of silence RECORDING.md asks for), if
    it is clearly quieter than the voice."""
    win = int(0.05 * SR)
    nf = len(x) // win
    if nf < 6:
        return None
    e = (x[: nf * win].reshape(nf, win) ** 2).mean(1)
    k = min(10, nf // 3)
    run = np.convolve(e, np.ones(k) / k, mode="valid")
    i = int(np.argmin(run))
    if 10 * np.log10((e.max() + 1e-20) / (run[i] + 1e-20)) < 15:
        return None
    return slice(i * win, (i + k) * win)


def denoise(x: np.ndarray, amount: float, quiet: slice) -> np.ndarray:
    """Spectral gating (noisereduce), with the noise learned from the quiet part."""
    import noisereduce as nr

    y = nr.reduce_noise(y=x, sr=SR, y_noise=x[quiet], stationary=True, prop_decrease=amount)
    return np.asarray(y, dtype=np.float64)[: len(x)]


def trim_voice(x: np.ndarray, quiet: slice | None) -> np.ndarray:
    """generate.py's trim, with its thresholds kept above the background noise
    left in the quiet part, so none of that noise counts as the line."""
    win = max(1, int(SR * 0.006))
    lv = G.db(np.sqrt(np.convolve(x ** 2, np.ones(win) / win, mode="same") + 1e-20))
    under = 40.0
    if quiet is not None:
        under = float(np.clip(lv.max() - np.percentile(lv[quiet], 99) - 6, 20, 40))
    return G.trim(x, SR, G.PREROLL, TAIL, head_db=under, tail_db=under, fout=0.05)


def clean(x: np.ndarray, slot: str, amount: float, fx: bool) -> tuple[np.ndarray, list[str]]:
    notes = []
    if clips.clipped(x) > 0.001:
        notes.append("distorted: too loud or too close to the phone")
    elif clips.peak_db(x) < -35:
        notes.append("very quiet: hold the phone a bit closer")
    x = G.eq(x - x.mean(), SR, [("hp", HP_HZ), ("hp", HP_HZ)])
    quiet = quietest(x)
    if quiet is not None and amount > 0:
        x = denoise(x, amount, quiet)
    elif amount > 0:
        notes.append("no silence before or after the line: background noise not removed")
    x = trim_voice(G.compress(x, SR, *COMP), quiet)
    f = next((f for prefix, f in FX if slot.startswith(prefix)), None) if fx else None
    if f:
        x = G.trim(f(x), SR, G.PREROLL, TAIL, tail_db=42, fout=0.08)
    if len(x) / SR > TOO_LONG:
        notes.append(f"{len(x) / SR:.1f}s long: one take per file, please")
    return x, notes


def say(slot: str) -> str:
    return SAY.get(slot) or next(t.text for t in G.TAKES if t.slot == slot)


def list_lines(recs: list[Rec]) -> None:
    have: dict[str, dict[str, int]] = {}
    for r in recs:
        have.setdefault(r.slot, {})
        have[r.slot][r.by] = have[r.slot].get(r.by, 0) + 1
    print(f"{'slot':20s} {'line':28s} recorded by")
    for slot in SLOTS:
        who = ", ".join(f"{b} x{n}" for b, n in sorted(have.get(slot, {}).items())) or "-"
        print(f"{slot:20s} {say(slot):28s} {who}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="*", help="friends, slot ids or file names (or prefixes) to convert")
    ap.add_argument("--list", action="store_true", help="show every line and who has recorded it, then exit")
    ap.add_argument("--report", action="store_true", help="measure the converted MP3s and exit")
    ap.add_argument("--fx", action="store_true", help="light effect per line: announcer reverb, baby pitch for mama, ...")
    ap.add_argument("--denoise", type=float, default=DENOISE, metavar="0-1",
                    help=f"noise reduction strength (default {DENOISE}, 0 = off)")
    t = ap.add_argument_group("other folders (for testing)")
    t.add_argument("--src", type=Path, default=SRC, help="the recordings folder")
    t.add_argument("--out", type=Path, default=OUT, help="where the MP3s go")
    t.add_argument("--index", type=Path, default=G.RECORDINGS, help="recordings.json to write")
    t.add_argument("--manifest", type=Path, default=G.MANIFEST, help="manifest.json to rebuild")
    args = ap.parse_args()

    recs, problems = scan(args.src)
    for p in problems:
        print(f"  skipped {p}")
    if args.list:
        list_lines(recs)
        return
    if args.report:
        clips.report([(r.name, args.out / r.name, "") for r in recs])
        return

    t0 = time.time()
    todo = [r for r in recs if clips.matches(args.only, r.slot, r.by, r.name, r.src.name)]
    done: list[Rec] = []
    for r in recs:
        out = args.out / r.name
        src = r.src.relative_to(args.src)
        if r not in todo:
            if out.exists():
                done.append(r)
            else:
                print(f"  {src} isn't converted yet: run without --only")
            continue
        try:
            x = clips.ffmpeg_decode(r.src)
        except ValueError as e:
            print(f"  skipped {src}: {e}")
            continue
        x, notes = clean(x, r.slot, args.denoise, args.fx)
        data, info = clips.finish(x)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        done.append(r)
        print(f"[{len(done):2d}] {str(src):36s} -> {r.name:36s} {info['dur']:4.2f}s  limiter {info['gr']:4.1f} dB"
              + "".join(f"\n       ! {n}" for n in notes), flush=True)
    if not args.only:
        clips.remove_stale(args.out, {args.out / r.name for r in done}, OUT_NAME)

    index = [{"slot": r.slot, "file": URL + r.name, "by": r.by} for r in done]
    args.index.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    G.write_manifest(args.manifest, args.index)
    clips.report([(r.name, args.out / r.name, "") for r in done])
    print(f"\n{len(done)} recording(s) in the game, done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
