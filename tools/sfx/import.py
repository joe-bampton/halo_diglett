#!/usr/bin/env python3
"""Turn downloaded sound effects into Halo Diglett's game sounds.

tools/sfx/sfx.json says which files in tools/sfx/sources/ replace which of the
synthesized sounds (the ids in src/audio/synth.ts). Each file is decoded with
ffmpeg (wav, mp3, ogg, flac, m4a, ...), optionally cut, made mono 44.1 kHz,
trimmed to a few ms before the sound starts, faded out, matched to its
category's loudness (guns louder than menu blips), peak-limited to -1 dBFS and
encoded as a small MP3 in public/audio/sfx/<id>_<n>.mp3.

The `sfx.*` slots of public/audio/manifest.json are rewritten (the voice lines
are left alone) and CREDITS.md lists where every file came from. A sound with no
files keeps its synthesized version, and so does one whose files fail to load.

    tools/sfx/.venv/bin/python tools/sfx/import.py               # everything in sfx.json
    tools/sfx/.venv/bin/python tools/sfx/import.py --only sniper explosion
    tools/sfx/.venv/bin/python tools/sfx/import.py --list        # every sound and what replaces it
    tools/sfx/.venv/bin/python tools/sfx/import.py --report      # measure the MP3s

SOUND_LIST.md (what to download) and README.md are next to this file.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "tools" / "voices"))
import clips  # noqa: E402  (shared with the voice tools)
import generate as G  # noqa: E402

SR = clips.SR

# =============================================================================
#  Levels (edit here)
# =============================================================================
#  Loudness target per category, in LUFS measured like the voice lines (which sit
#  at -16), and the most the limiter may take off a file's peaks. A file that would
#  need more limiting than that (a sharp gunshot) stays quieter instead, so it
#  keeps its punch.
CATEGORIES = {
    #  category     LUFS   max limiting dB
    "explosion": (-15.0, 6.0),
    "gun":       (-17.0, 6.0),     # one shot of a weapon
    "weapon":    (-20.0, 3.0),     # charge-ups, beams, the orbital whistle
    "action":    (-19.0, 6.0),     # things happening in the world: impacts, springs, sauce, cans
    "ui":        (-22.0, 3.0),     # hit markers, beeps, medals, power-up jingles
    "foley":     (-25.0, 3.0),     # small handling noises: reload, rustle, dry fire
}

SOUNDS = {
    "sniper": "gun", "rifle": "gun", "crossbow": "gun", "rocket": "gun", "bloop": "gun",
    "rail": "gun", "needle": "gun", "minigun": "gun",
    "charge": "weapon", "beamLoop": "weapon", "flameLoop": "weapon", "whistle": "weapon",
    "explosion": "explosion",
    "shieldBreak": "action", "thud": "action", "partyHorn": "action", "orbPop": "action",
    "boing": "action", "whoosh": "action", "pump": "action", "squirt": "action", "splat": "action",
    "canOpen": "action", "fizz": "action",
    "hitTick": "ui", "ding": "ui", "recharge": "ui", "lowShield": "ui", "powerup": "ui",
    "medal": "ui", "beep": "ui", "spawn": "ui",
    "reload": "foley", "rustle": "foley", "empty": "foley",
}

# Played with `loop`: no trimming or fades; the end is crossfaded into the start instead.
LOOPS = {"beamLoop", "flameLoop"}
LOOP_XFADE = 0.06       # seconds

PREROLL = 0.004         # kept before the sound starts, seconds
FADE_OUT = 0.03         # at the end, seconds
TAIL_DB = 60            # a tail fading this far under the peak counts as over
LONG = {"gun": 2.5, "weapon": 3.0, "explosion": 4.0, "action": 2.5, "ui": 2.0, "foley": 1.0}
MP3_KBPS = 128          # a little more than the voice lines: noisy, bright sounds

# =============================================================================
#  Implementation
# =============================================================================
SRC = HERE / "sources"
CONFIG = HERE / "sfx.json"
CREDITS = HERE / "CREDITS.md"
OUT = G.AUDIO_DIR / "sfx"
URL = "audio/sfx/"      # how the manifest refers to OUT (relative to the site root)


def sound_ids() -> list[str]:
    """The sound ids the game has, in the order of the SFX table in synth.ts."""
    src = (ROOT / "src" / "audio" / "synth.ts").read_text(encoding="utf-8")
    body = re.search(r"export const SFX = \{(.*?)\}", src, re.S).group(1)
    return re.findall(r"^\s*(\w+),?\s*(?://.*)?$", body, re.M)


def read_config(path: Path, ids: list[str]) -> tuple[dict[str, list[dict]], list[str]]:
    """sfx.json -> {id: [entry, ...]} in the game's order. Keys starting with "_" are
    ignored (examples, notes). An entry may also be just a file name, and an id
    may map to a single entry instead of a list."""
    problems = []
    try:
        raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except json.JSONDecodeError as e:
        sys.exit(f"{path.name} is not valid JSON: {e}")
    if not isinstance(raw, dict):
        sys.exit(f"{path.name} must be one {{ ... }} with a sound name before each list of files")
    cfg: dict[str, list[dict]] = {}
    for key, v in raw.items():
        if key.startswith("_"):
            continue
        if key not in ids:
            problems.append(f"{key!r} is not a sound the game has (see --list)")
            continue
        entries = []
        for e in v if isinstance(v, list) else [v]:
            e = {"file": e} if isinstance(e, str) else e
            if not isinstance(e, dict) or not isinstance(e.get("file"), str):
                problems.append(f"{key}: every entry needs a \"file\"")
                continue
            if not e.get("license"):
                print(f"  note: {key}: {e['file']} has no \"license\"; check it before you ship it")
            elif re.search(r"\bNC\b|non.?commercial", str(e["license"]), re.I):
                print(f"  warning: {key}: {e['file']} is non-commercial ({e['license']}); better find a CC0 one")
            entries.append(e)
        if entries:
            cfg[key] = entries
    return {k: cfg[k] for k in ids if k in cfg}, problems


def loop_xfade(x: np.ndarray, sec: float = LOOP_XFADE) -> np.ndarray:
    """Make a seamless loop: the last `sec` fades into the first (equal power)."""
    n = min(int(sec * SR), len(x) // 3)
    if n < 2:
        return x
    t = np.linspace(0, np.pi / 2, n)
    y = x[:-n].copy()
    y[:n] = x[:n] * np.sin(t) + x[-n:] * np.cos(t)
    return y


def render(sid: str, e: dict, src_dir: Path) -> tuple[bytes, dict, list[str]]:
    cat = SOUNDS.get(sid, "action")
    target, max_gr = CATEGORIES[cat]
    gain = float(e.get("gain", 1.0))
    if gain <= 0:
        raise ValueError("\"gain\" must be more than 0 (1 = normal)")
    if not (src_dir / e["file"]).is_file():
        raise ValueError(f"not found in {src_dir.name}/ (check the name: capitals matter)")
    x = clips.ffmpeg_decode(src_dir / e["file"])
    full = len(x) / SR
    a = int(float(e.get("start", 0)) * SR)
    b = int(float(e["end"]) * SR) if e.get("end") is not None else len(x)
    x = x[a:b]
    if len(x) < SR * 0.01:
        raise ValueError(f"nothing left after cutting {e.get('start', 0)}-{e.get('end')} s (the file is {full:.2f} s)")
    x = G.biquad(x - x.mean(), SR, "hp", 25)          # sub-rumble only eats headroom
    if sid in LOOPS:
        x = loop_xfade(x)
    else:
        x = G.trim(x, SR, PREROLL, 0.05, tail_db=TAIL_DB, fout=FADE_OUT)
    notes = []
    if len(x) / SR > LONG[cat]:
        notes.append(f"{len(x) / SR:.1f}s is long for a {cat} sound: set \"end\" to cut it")
    data, info = clips.finish(x, target + 20 * np.log10(gain), max_gr, sid not in LOOPS, MP3_KBPS)
    if info["under"] > 0.5:
        notes.append(f"kept {info['under']:.1f} dB under its level so the limiter doesn't flatten it")
    return data, info, notes


def merge_manifest(path: Path, sfx_slots: dict[str, dict]) -> None:
    """Replace every `sfx.*` slot of the manifest and keep everything else as it is."""
    m = G.read_json(path, {"version": 1, "slots": {}})
    slots = {k: v for k, v in m.get("slots", {}).items() if not k.startswith(G.SFX_PREFIX)}
    G.save_manifest(path, {**m, "slots": {**slots, **sfx_slots}})


def write_credits(path: Path, cfg: dict[str, list[dict]], out: Path) -> None:
    rows = []
    for sid, entries in cfg.items():
        for n, e in enumerate(entries, 1):
            name = f"{sid}_{n}.mp3"
            if not (out / name).exists():
                continue
            cut = ""
            if e.get("start") is not None or e.get("end") is not None:
                cut = f"{float(e.get('start', 0)):.2f}-" + (f"{float(e['end']):.2f}" if e.get("end") is not None else "end") + " s"
            cell = lambda s: str(s or "?").replace("|", "\\|").replace("\n", " ")  # noqa: E731
            rows.append(f"| {sid} | `{URL}{name}` | `{cell(e['file'])}` | {cut} | {cell(e.get('source'))} | {cell(e.get('license'))} |")
    text = ["# Sound effect credits", "",
            "Written by `tools/sfx/import.py` from `tools/sfx/sfx.json`, so edit that instead.",
            "Source files are in `tools/sfx/sources/`. See `SOUND_LIST.md` for the licences.", ""]
    if rows:
        text += ["| Sound | In the game | Source file | Cut | From | Licence |", "|---|---|---|---|---|---|", *rows]
    else:
        text += ["No sound files are imported yet: every sound effect is synthesized in `src/audio/synth.ts`."]
    path.write_text("\n".join(text) + "\n", encoding="utf-8")


def list_sounds(ids: list[str], cfg: dict[str, list[dict]], out: Path) -> None:
    print(f"{'sound':12s} {'category':9s} {'level':>9s}  in the game")
    for sid in ids:
        cat = SOUNDS.get(sid, "action")
        files = [f"{sid}_{n}.mp3" for n in range(1, len(cfg.get(sid, [])) + 1)]
        have = [f for f in files if (out / f).exists()]
        status = ", ".join(have) if have else "synthesized"
        if len(have) < len(files):
            status += f"  ({len(files) - len(have)} in sfx.json not imported yet)"
        print(f"{sid:12s} {cat:9s} {CATEGORIES[cat][0]:5.0f} LUFS  {status}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="*", help="sound ids (or prefixes) to import, e.g. sniper explosion")
    ap.add_argument("--list", action="store_true", help="show every sound, its level and what replaces it, then exit")
    ap.add_argument("--report", action="store_true", help="measure the imported MP3s and exit")
    t = ap.add_argument_group("other files and folders (for testing)")
    t.add_argument("--src", type=Path, default=SRC, help="the sources folder")
    t.add_argument("--config", type=Path, default=CONFIG, help="sfx.json")
    t.add_argument("--out", type=Path, default=OUT, help="where the MP3s go")
    t.add_argument("--manifest", type=Path, default=G.MANIFEST, help="manifest.json to update")
    t.add_argument("--credits", type=Path, default=CREDITS, help="CREDITS.md to write")
    args = ap.parse_args()

    ids = sound_ids()
    for sid in ids:
        if sid not in SOUNDS:
            print(f"  note: {sid} has no category in SOUNDS; treating it as 'action'")
    cfg, problems = read_config(args.config, ids)
    if args.list:
        list_sounds(ids, cfg, args.out)
        return
    if args.report:
        rows = [(f"{sid}_{n}.mp3", args.out / f"{sid}_{n}.mp3", f"{SOUNDS.get(sid, 'action')} {CATEGORIES[SOUNDS.get(sid, 'action')][0]:.0f}")
                for sid, entries in cfg.items() for n in range(1, len(entries) + 1)]
        clips.report(rows, 24)
        return

    t0 = time.time()
    slots: dict[str, dict] = {}
    keep: set[Path] = set()
    for sid, entries in cfg.items():
        files = []
        for n, e in enumerate(entries, 1):
            name = f"{sid}_{n}.mp3"
            out = args.out / name
            if not clips.matches(args.only, sid):
                if out.exists():
                    files.append(URL + name)
                    keep.add(out)
                continue
            try:
                data, info, notes = render(sid, e, args.src)
            except (ValueError, OSError) as err:
                problems.append(f"{sid}: {e['file']}: {err}")
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            files.append(URL + name)
            keep.add(out)
            print(f"  {name:20s} <- {e['file']:40s} {info['dur']:5.2f}s  {info['lufs']:5.1f} LUFS  "
                  f"limiter {info['gr']:4.1f} dB" + "".join(f"\n      ! {n}" for n in notes), flush=True)
        if files:
            slots[G.SFX_PREFIX + sid] = {"files": files, "gain": 1.0}
    if not args.only:
        clips.remove_stale(args.out, keep, rf"({'|'.join(ids)})_\d+\.mp3")

    merge_manifest(args.manifest, slots)
    write_credits(args.credits, cfg, args.out)
    print(f"\n{len(slots)} of {len(ids)} sounds use files, the rest stay synthesized ({time.time() - t0:.0f}s)")
    for p in problems:
        print(f"  problem: {p}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
