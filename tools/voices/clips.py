"""Helpers shared by import.py (friends' recordings) and ../sfx/import.py
(downloaded sound effects): read any audio file through ffmpeg, finish a clip the
way generate.py does (loudness, limiter, MP3 with a gapless header) and measure
MP3s for --report. The DSP itself lives in generate.py and is imported from it.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

import generate as G

SR = G.SR_OUT

# What phones, recorders and sound libraries hand out. Anything ffmpeg reads works.
AUDIO_EXTS = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".webm",
              ".mp4", ".3gp", ".amr", ".caf", ".aif", ".aiff", ".wma"}


def ffmpeg_decode(path: Path, sr: int = SR) -> np.ndarray:
    """Any audio file -> mono float64 samples at `sr` (channels are averaged)."""
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg is not installed (macOS: brew install ffmpeg, Windows: winget install ffmpeg, "
                 "Linux: sudo apt install ffmpeg)")
    r = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-vn", "-map", "0:a:0",
                        "-ac", "1", "-ar", str(sr), "-c:a", "pcm_f32le", "-f", "f32le", "-"],
                       capture_output=True)
    if r.returncode != 0:
        msg = r.stderr.decode(errors="replace").strip().splitlines()
        raise ValueError(f"ffmpeg can't read it ({msg[-1] if msg else 'unknown error'})")
    x = np.frombuffer(r.stdout, dtype="<f4").astype(np.float64)
    if not len(x) or not np.abs(x).max() > 1e-5:
        raise ValueError("it's silent")
    return x


def finish(x: np.ndarray, target: float = G.TARGET_LUFS, max_gr: float | None = None,
           edges: bool = True, kbps: int = G.MP3_KBPS) -> tuple[bytes, dict]:
    """Match `target` LUFS with peaks limited to -1 dBFS, encode the MP3 and re-check
    its level after decoding. If the limiter would have to take off more than
    `max_gr` dB (a gunshot's punch), the clip stays that much quieter instead.
    `edges=False` leaves the ends alone (loops)."""
    goal = target
    for _ in range(4):
        y, gr = G.loudness_match(x, SR, goal)
        if max_gr is None or gr <= max_gr + 0.5:
            break
        goal -= gr - max_gr
    if edges:
        y = G.fade(y, SR, 0.002, 0.01)
    data, y, gr2 = G.encode_matched(y, gr, goal, kbps)
    return data, dict(dur=len(y) / SR, gr=max(gr, gr2), lufs=goal, under=target - goal)


def peak_db(x: np.ndarray) -> float:
    return float(G.db(np.abs(x).max()))


def clipped(x: np.ndarray) -> float:
    """Share of samples stuck at full scale: the recording was too loud."""
    return float(np.mean(np.abs(x) > 0.985))


def slug(name: str) -> str:
    """A folder or file name that is safe in a URL: 'John Smith' -> 'john_smith'."""
    return re.sub(r"[^a-z0-9_-]+", "_", name.strip().lower()).strip("_") or "x"


def matches(only: list[str] | None, *keys: str) -> bool:
    """--only: does one of `keys` start with or contain one of the patterns?"""
    if not only:
        return True
    keys = tuple(k.lower() for k in keys)
    return any(k.startswith(p.lower()) or p.lower() in k for p in only for k in keys)


def measure(path: Path) -> tuple[float, float, float, int]:
    """(seconds, LUFS, peak dBFS, bytes) of an MP3 on disk."""
    import soundfile as sf

    y, sr = sf.read(str(path), dtype="float64")
    return len(y) / sr, G.lufs(y, sr), peak_db(y), path.stat().st_size


def report(rows: list[tuple[str, Path, str]], width: int = 42) -> None:
    """Print duration, loudness, peak and size of each (label, path, note) row."""
    print(f"\n{'file':{width}s} {'sec':>5s} {'LUFS':>6s} {'peak':>6s} {'KB':>5s}")
    total = 0
    for label, path, note in rows:
        if not path.exists():
            print(f"{label:{width}s}  missing")
            continue
        dur, lu, pk, size = measure(path)
        total += size
        print(f"{label:{width}s} {dur:5.2f} {lu:6.1f} {pk:6.1f} {size / 1024:5.1f}  {note}".rstrip())
    print(f"{'total':{width}s} {'':5s} {'':6s} {'':6s} {total / 1024:5.1f}")


def remove_stale(out_dir: Path, keep: set[Path], name: str) -> None:
    """Delete MP3s under `out_dir` that are no longer produced (only names that
    fully match the regex `name`, so nothing else is ever touched), then empty folders."""
    if not out_dir.exists():
        return
    for p in sorted(out_dir.rglob("*.mp3")):
        if p not in keep and re.fullmatch(name, p.name):
            print(f"  removing {p.relative_to(out_dir)} (no longer in the sources)")
            p.unlink()
    for d in [*sorted((d for d in out_dir.rglob("*") if d.is_dir()), reverse=True), out_dir]:
        if not any(d.iterdir()):
            d.rmdir()
