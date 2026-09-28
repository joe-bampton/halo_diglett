#!/usr/bin/env python3
"""Pre-render the Halo Diglett voice lines.

Speech comes from Kokoro-82M (Apache-2.0) through the `kokoro-onnx` package.
Each take is then shaped with WORLD (pyworld: pitch, formants, timing), EQ,
compression and, for the announcer, a short stadium reverb. Finally every file
is trimmed, loudness-matched to -16 LUFS with peaks limited to -1 dBFS, and
encoded as a small mono MP3 in public/audio/. public/audio/manifest.json is
rewritten from the table below.

    tools/voices/.venv/bin/python tools/voices/generate.py            # everything
    tools/voices/.venv/bin/python tools/voices/generate.py --only pitre.mama ann.double
    tools/voices/.venv/bin/python tools/voices/generate.py --list     # show the table
    tools/voices/.venv/bin/python tools/voices/generate.py --wav      # also keep WAVs in out/

See README.md next to this file.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Take:
    slot: str
    file: str
    voice: str
    speed: float
    fx: str
    text: str
    opts: dict = field(default_factory=dict)


def T(slot, file, voice, speed, fx, text, **opts):
    return Take(slot, file, voice, speed, fx, text, opts)


# =============================================================================
#  LINE TABLE  (edit here)
# =============================================================================
#
#  One row per take. Several rows with the same slot are alternative takes; the
#  game picks one at random.
#
#   slot   id the game asks the manifest for
#   file   output path, relative to public/audio/
#   voice  Kokoro voice id, or a blend such as "am_onyx*0.6+am_fenrir*0.4"
#   speed  Kokoro speaking rate, 0.5-2.0 (1.0 = normal)
#   fx     processing chain: pitre | baby | brap | announcer | pufferfish | file
#          ("file" = hand-made MP3, never generated or overwritten, only listed
#           in the manifest)
#   text   what to say. Text between /slashes/ is raw IPA fed straight to Kokoro;
#          use it when the phonemizer mispronounces something
#          (print the phonemes with --phonemes).
#   opts   per-take settings that override the chain defaults (FX_DEFAULTS):
#            pitch=+2          shift in semitones
#            formant=1.1       spectral-envelope warp (>1 smaller/younger, <1 bigger)
#            expr=1.4          exaggerate the spoken intonation (1 = as spoken)
#            melody=[...]      sing it: one note per syllable (voiced segment), in
#                              semitones from the take's median pitch; a tuple such as
#                              (from, to) or (a, b, c) glides through its points.
#                              keep=0.3 keeps some natural wobble. The script prints
#                              a note when the note count and syllable count differ.
#            contour=[(t, st)] pitch bend over the voiced part, t from 0 to 1
#            vibrato=(hz, st, start)   vibrato from `start` (0-1) to the end
#            stretch_last=2.5  hold the last vowel this many times longer
#            drive=1.5         saturation for a shouted edge (1 = clean)
#
#  In `brap` rows a low gunshot-like "thump" is layered under every syllable
#  that starts after a gap (thump=0 turns it off).

ANNOUNCER = "am_fenrir"   # clearest US male; FX_DEFAULTS["announcer"] makes it deep

TAKES = [
    # --- Pitre mode ----------------------------------------------------------
    # slot              file                               voice        speed fx       text                          opts
    T("pitre.prank",    "pitre/prank_em_john_1.mp3",       "am_michael",1.00, "pitre", "/pɹˈæŋk əm, dʒˈɑːn!/",
      melody=[4, 0, (7, 2)], keep=0.3, pitch=1),
    T("pitre.prank",    "pitre/prank_em_john_2.mp3",       "bm_fable",  1.10, "pitre", "/pɹˈæŋk əm, dʒˈɑːn!/",
      expr=1.5, pitch=1),
    T("pitre.prank",    "pitre/prank_em_john_3.mp3",       "am_fenrir", 1.05, "pitre", "/pɹˈæŋk əm, dʒˈɑːn!/",
      expr=1.35),

    T("pitre.byebye",   "pitre/bye_bye_1.mp3",             "am_puck",   1.00, "pitre", "Bye, bye!",
      melody=[4, (0, -1)], keep=0.25, stretch_last=2.6, vibrato=(5.5, 0.35, 0.55)),
    T("pitre.byebye",   "pitre/bye_bye_2.mp3",             "am_michael",1.00, "pitre", "Bye, bye!",
      melody=[5, (2, 0)], keep=0.25, stretch_last=2.3, vibrato=(5.0, 0.3, 0.6), pitch=1),
    T("pitre.byebye",   "pitre/bye_bye_3.mp3",             "bm_fable",  1.00, "pitre", "Bye, bye!",
      melody=[3, (0, 4), 4], keep=0.3, stretch_last=2.2),

    T("pitre.pussy",    "pitre/oh_look_a_pussy_1.mp3",     "am_fenrir", 1.05, "pitre", "Oh, look! A pussy!",
      expr=1.6),
    T("pitre.pussy",    "pitre/oh_look_a_pussy_2.mp3",     "am_michael",1.00, "pitre", "Ooh, look, a pussy!",
      expr=1.7, pitch=1),
    T("pitre.pussy",    "pitre/oh_look_a_pussy_3.mp3",     "am_echo",   1.10, "pitre", "Ooh, look, a pussy!",
      melody=[(3, 7), 4, 9, (7, 3)], keep=0.35),         # "nyah-nyah" playground taunt

    T("pitre.mama",     "pitre/mama_1.mp3",                "af_bella",  1.00, "baby",  "Mama!"),
    T("pitre.mama",     "pitre/mama_2.mp3",                "af_nicole", 1.05, "baby",  "Mama?",
      pitch=11, contour=[(0, 0), (0.4, -0.5), (0.7, 2.5), (1, 5)]),
    T("pitre.mama",     "pitre/mama_3.mp3",                "af_heart",  1.00, "baby",  "/mˈɑːmɑː!/",
      pitch=9.5, stretch_last=1.4, contour=[(0, 0.5), (0.35, 0), (0.6, 3), (0.85, 4), (1, 1)]),

    T("pitre.brap",     "pitre/brap_1.mp3",                "am_michael",1.10, "brap",  "Brap brap brappp!"),
    T("pitre.brap",     "pitre/brap_2.mp3",                "bm_fable",  1.30, "brap",  "Brap brap brappp!"),
    T("pitre.brap",     "pitre/brap_3.mp3",                "am_echo",   1.20, "brap",  "Brap! Brap! Brap!"),

    T("pitre.pufferfish", "pitre/pufferfish.mp3",          "-",         1.00, "pufferfish", "(procedural placeholder)"),

    # --- Announcer -----------------------------------------------------------
    T("ann.slay",       "announcer/slay_your_enemies.mp3", ANNOUNCER, 0.90, "announcer", "Slay your enemies!"),
    T("ann.double",     "announcer/double_kill.mp3",       ANNOUNCER, 0.90, "announcer", "Double kill!"),
    T("ann.triple",     "announcer/triple_kill.mp3",       ANNOUNCER, 0.90, "announcer", "Triple kill!"),
    T("ann.overkill",   "announcer/overkill.mp3",          ANNOUNCER, 0.90, "announcer", "Overkill!"),
    T("ann.killtacular","announcer/killtacular.mp3",       ANNOUNCER, 0.90, "announcer", "/kˌɪltˈækjʊlɚ!/"),
    T("ann.killtrocity","announcer/killtrocity.mp3",       ANNOUNCER, 0.90, "announcer", "/kˌɪltɹˈɑːsᵻɾi!/"),
    T("ann.spree",      "announcer/killing_spree.mp3",     ANNOUNCER, 0.90, "announcer", "Killing spree!"),
    T("ann.frenzy",     "announcer/killing_frenzy.mp3",    ANNOUNCER, 0.90, "announcer", "Killing frenzy!"),
    T("ann.riot",       "announcer/running_riot.mp3",      ANNOUNCER, 0.90, "announcer", "Running riot!"),
    T("ann.rampage",    "announcer/rampage.mp3",           ANNOUNCER, 0.90, "announcer", "Rampage!"),
    T("ann.untouchable","announcer/untouchable.mp3",       ANNOUNCER, 0.90, "announcer", "Untouchable!"),
    T("ann.headshot",   "announcer/headshot.mp3",          ANNOUNCER, 0.90, "announcer", "Headshot!"),
    T("ann.killjoy",    "announcer/killjoy.mp3",           ANNOUNCER, 0.90, "announcer", "Killjoy!"),
    T("ann.revenge",    "announcer/revenge.mp3",           ANNOUNCER, 0.90, "announcer", "Revenge!"),
    T("ann.perfection", "announcer/perfection.mp3",        ANNOUNCER, 0.90, "announcer", "Perfection!"),
    T("ann.lead_taken", "announcer/lead_taken.mp3",        ANNOUNCER, 0.95, "announcer", "You've taken the lead!"),
    T("ann.lead_lost",  "announcer/lead_lost.mp3",         ANNOUNCER, 0.95, "announcer", "You've lost the lead!"),
    T("ann.one_minute", "announcer/one_minute.mp3",        ANNOUNCER, 0.95, "announcer", "One minute remaining!"),
    T("ann.ten_kills",  "announcer/ten_kills.mp3",         ANNOUNCER, 0.95, "announcer", "Ten kills remaining!"),
    T("ann.five_kills", "announcer/five_kills.mp3",        ANNOUNCER, 0.95, "announcer", "Five kills remaining!"),
    T("ann.game_over",  "announcer/game_over.mp3",         ANNOUNCER, 0.90, "announcer", "Game over!"),
    T("ann.victory",    "announcer/victory.mp3",           ANNOUNCER, 0.90, "announcer", "Victory!"),
    T("ann.defeat",     "announcer/defeat.mp3",            ANNOUNCER, 0.90, "announcer", "Defeat!"),
    T("ann.overshield", "announcer/overshield.mp3",        ANNOUNCER, 0.90, "announcer", "Overshield!"),
    T("ann.camo",       "announcer/active_camo.mp3",       ANNOUNCER, 0.90, "announcer", "Active camo!"),
    T("ann.damage_boost","announcer/damage_boost.mp3",     ANNOUNCER, 0.90, "announcer", "Damage boost!"),
    T("ann.invincible", "announcer/invincibility.mp3",     ANNOUNCER, 0.95, "announcer", "Invincibility!"),
    T("ann.flamethrower","announcer/flamethrower.mp3",     ANNOUNCER, 0.90, "announcer", "Flamethrower!"),
    T("ann.minigun",    "announcer/minigun.mp3",           ANNOUNCER, 0.90, "announcer", "Minigun!"),
    T("ann.homing",     "announcer/homing_rounds.mp3",     ANNOUNCER, 0.90, "announcer", "Homing rounds!"),
    T("ann.xray",       "announcer/xray_vision.mp3",       ANNOUNCER, 0.90, "announcer", "X-ray vision!"),
    T("ann.bighead",    "announcer/big_heads.mp3",         ANNOUNCER, 0.90, "announcer", "Big heads!"),
    T("ann.orbital",    "announcer/orbital_strike.mp3",    ANNOUNCER, 0.90, "announcer", "Orbital strike!"),
    T("ann.quickhands", "announcer/quick_hands.mp3",       ANNOUNCER, 0.90, "announcer", "Quick hands!"),
    T("ann.gungame_level","announcer/weapon_upgraded.mp3", ANNOUNCER, 0.95, "announcer", "Weapon upgraded!"),
    T("ann.cat_hat",    "announcer/cat_in_the_hat.mp3",    ANNOUNCER, 0.95, "announcer", "Cat in the hat!",
      melody=[5, (1, 1, 8, 4)], keep=0.35),       # "CAT in the HAT": playful sing-song
]

# Per-slot playback gain written to the manifest (0-1.5). Every file is already
# loudness-matched, so these only nudge perceived balance. Unlisted slots: 1.0.
SLOT_GAIN = {
    "pitre.mama": 0.85,        # high, whiny voices read louder than they measure
    "pitre.brap": 1.0,
    "pitre.pufferfish": 0.9,
}

# =============================================================================
#  Output settings
# =============================================================================
SR_OUT = 44100          # MP3 sample rate (MPEG-1 Layer III, plays everywhere)
MP3_KBPS = 96
TARGET_LUFS = -16.0     # loudness target (gated, 200 ms blocks: suits short clips)
LUFS_BLOCK = 0.2
CEILING_DB = -1.0       # sample-peak ceiling of the limiter
PREROLL = 0.008         # silence kept before the first sound, seconds

# =============================================================================
#  Chain defaults (a take's opts override these)
# =============================================================================
FX_DEFAULTS = {
    # Player shouts: bright, forward, a bit of grit.
    "pitre": dict(
        pitch=0.0, formant=1.0, expr=1.0, keep=0.3,
        eq=[("hp", 90), ("peak", 250, 1.0, -2.0), ("peak", 3200, 0.9, 3.0), ("highshelf", 7500, 0.7, 2.0)],
        comp=(-18.0, 2.5, 3.0, 80.0), drive=1.25, hp=80, tail=0.05, tail_db=38,
    ),
    # Female voice -> small child: pitch up, formants up, whiny rise at the end.
    "baby": dict(
        pitch=8.0, formant=1.28, expr=0.5,        # flatten the adult intonation, then:
        contour=[(0.0, 0.0), (0.45, 0.5), (0.75, 4.5), (1.0, 3.0)],
        vibrato=(7.0, 0.6, 0.5), f0_range=(80, 900),
        eq=[("hp", 220), ("peak", 3500, 1.0, 2.0)],
        comp=(-18.0, 2.5, 3.0, 60.0), drive=1.1, hp=150, tail=0.04, tail_db=38, max_len=0.8,
    ),
    # "brap brap brappp": the voice plus a gun-like low thump under each syllable.
    "brap": dict(
        thump=0.6, crack=0.3, thump_offset=-0.010,
        eq=[("hp", 35), ("peak", 250, 1.0, -2.0), ("peak", 3000, 0.9, 3.0)],
        comp=(-18.0, 3.0, 1.0, 50.0), drive=1.5, hp=35, tail=0.06, tail_db=38, max_len=1.3,
    ),
    # Deep stadium announcer.
    "announcer": dict(
        pitch=-4.5, formant=0.9, expr=1.25, keep=0.35, f0_range=(40, 500),
        eq=[("hp", 70), ("lowshelf", 170, 0.7, 3.0), ("peak", 450, 1.0, -2.5),
            ("peak", 2800, 1.0, 3.5), ("highshelf", 7000, 0.7, 2.0)],
        comp=(-20.0, 3.0, 3.0, 90.0), drive=1.3,
        space=dict(rt60=0.8, predelay=0.018, wet=0.20, hp=350, lp=7000,
                   slaps=[(0.105, 0.28), (0.215, 0.12)]),
        hp=60, tail=0.08, tail_db=42, fout=0.08,
    ),
    "pufferfish": dict(hp=40, tail=0.03, seed=3),
    "file": dict(),
}

# =============================================================================
#  Implementation
# =============================================================================
import argparse
import hashlib
import json
import shutil
import sys
import time
import urllib.request
from functools import lru_cache
from math import gcd
from pathlib import Path

import numpy as np
from scipy.signal import lfilter, resample_poly, fftconvolve

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
AUDIO_DIR = ROOT / "public" / "audio"
MODEL_DIR = HERE / "models"
OUT_DIR = HERE / "out"

MODELS = {
    "kokoro-v1.0.onnx": (
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
        "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    ),
    "voices-v1.0.bin": (
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
        "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    ),
}


# ----------------------------------------------------------------- models / TTS
def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_models() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for name, (url, digest) in MODELS.items():
        path = MODEL_DIR / name
        if path.exists():
            continue
        print(f"downloading {name} ...", flush=True)
        tmp = path.with_suffix(path.suffix + ".part")
        with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f, 1 << 20)
        got = sha256(tmp)
        if got != digest:
            tmp.unlink()
            sys.exit(f"{name}: checksum mismatch ({got}); refusing to use it")
        tmp.rename(path)


@lru_cache(maxsize=1)
def kokoro():
    ensure_models()
    from kokoro_onnx import Kokoro

    return Kokoro(str(MODEL_DIR / "kokoro-v1.0.onnx"), str(MODEL_DIR / "voices-v1.0.bin"))


def voice_style(spec: str) -> np.ndarray:
    """'am_onyx' or a weighted blend 'am_onyx*0.6+am_fenrir*0.4'."""
    acc, total = 0.0, 0.0
    for part in spec.split("+"):
        name, _, w = part.strip().partition("*")
        w = float(w) if w else 1.0
        acc = acc + w * kokoro().get_voice_style(name.strip())
        total += w
    return (acc / total).astype(np.float32)


def split_ipa(text: str) -> tuple[str, bool]:
    t = text.strip()
    if len(t) > 2 and t.startswith("/") and t.endswith("/"):
        return t[1:-1], True
    return t, False


def phonemes(text: str) -> str:
    t, is_ipa = split_ipa(text)
    return t if is_ipa else kokoro().tokenizer.phonemize(t, "en-us")


def tts(text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
    t, is_ipa = split_ipa(text)
    audio, sr = kokoro().create(t, voice=voice_style(voice), speed=speed, lang="en-us",
                                is_phonemes=is_ipa)
    return np.asarray(audio, dtype=np.float64), sr


# ----------------------------------------------------------------- basic DSP
def db(x):
    return 20.0 * np.log10(np.maximum(np.abs(x), 1e-12))


def undb(d):
    return 10.0 ** (np.asarray(d) / 20.0)


def resample(x: np.ndarray, sr: int, sr_new: int) -> np.ndarray:
    if sr == sr_new:
        return x
    g = gcd(sr, sr_new)
    return resample_poly(x, sr_new // g, sr // g)


def biquad(x: np.ndarray, sr: int, kind: str, f: float, q: float = 0.707, gain_db: float = 0.0):
    """RBJ-cookbook biquad: hp, lp, bp, peak, lowshelf, highshelf."""
    if f >= 0.45 * sr:
        return x
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f / sr
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2 * q)
    if kind == "lp":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "hp":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "bp":
        b = [alpha, 0, -alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "peak":
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind in ("lowshelf", "highshelf"):
        s = 2 * np.sqrt(A) * alpha
        if kind == "lowshelf":
            b = [A * ((A + 1) - (A - 1) * cw + s), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - s)]
            a = [(A + 1) + (A - 1) * cw + s, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - s]
        else:
            b = [A * ((A + 1) + (A - 1) * cw + s), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - s)]
            a = [(A + 1) - (A - 1) * cw + s, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - s]
    else:
        raise ValueError(kind)
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


def eq(x: np.ndarray, sr: int, bands) -> np.ndarray:
    """bands: ("hp", f) | ("lp", f) | (kind, f, q, gain_db)."""
    for band in bands or []:
        kind, f, *rest = band
        q = rest[0] if len(rest) > 0 else 0.707
        g = rest[1] if len(rest) > 1 else 0.0
        x = biquad(x, sr, kind, f, q, g)
    return x


def compress(x, sr, thresh=-20.0, ratio=3.0, attack_ms=2.0, release_ms=80.0, knee=6.0):
    """Feed-forward peak compressor with soft knee, computed on 1 ms blocks."""
    blk = max(1, int(sr * 0.001))
    n = len(x)
    nb = -(-n // blk)
    peaks = np.pad(np.abs(x), (0, nb * blk - n)).reshape(nb, blk).max(1)
    peaks = peaks / max(peaks.max(), 1e-9)       # threshold is relative to the take's peak
    a_att = np.exp(-1.0 / max(attack_ms / 1000 * sr / blk, 1e-3))
    a_rel = np.exp(-1.0 / max(release_ms / 1000 * sr / blk, 1e-3))
    env = np.empty(nb)
    e = 0.0
    for i, p in enumerate(peaks):
        c = a_att if p > e else a_rel
        e = c * e + (1 - c) * p
        env[i] = e
    over = db(env) - thresh
    slope = 1.0 / ratio - 1.0
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, slope * over, slope * (over + knee / 2) ** 2 / (2 * knee)))
    g = np.interp(np.arange(n), (np.arange(nb) + 0.5) * blk, undb(gr))
    return x * g


def saturate(x, drive=1.5):
    if drive <= 1.0:
        return x
    peak = max(np.abs(x).max(), 1e-9)
    y = np.tanh(drive * x / peak) / np.tanh(drive)
    return y * peak


def limit(x, sr, ceiling_db=CEILING_DB, lookahead_ms=1.5, release_ms=60.0):
    """Look-ahead brickwall limiter. Returns (audio, max gain reduction in dB)."""
    from numpy.lib.stride_tricks import sliding_window_view

    c = undb(ceiling_db)
    L = max(1, int(sr * lookahead_ms / 1000))
    need = np.minimum(1.0, c / np.maximum(np.abs(x), 1e-12))
    gm = sliding_window_view(np.concatenate([need, np.ones(L)]), L + 1).min(axis=1)[: len(x)]
    a = np.exp(-1.0 / (release_ms / 1000 * sr))
    g = np.empty_like(gm)
    prev = 1.0
    for i, v in enumerate(gm):
        prev = v if v < prev else a * prev + (1 - a) * v
        g[i] = prev
    g = np.convolve(np.concatenate([np.ones(L), g]), np.ones(L + 1) / (L + 1), mode="valid")[: len(x)]
    y = np.clip(x * g, -c, c)
    return y, float(-db(g.min()))


def lufs(x, sr) -> float:
    import pyloudnorm as pyln

    need = int(sr * LUFS_BLOCK) + 1
    if len(x) < need:
        x = np.pad(x, (0, need - len(x)))
    return float(pyln.Meter(sr, block_size=LUFS_BLOCK).integrated_loudness(x))


def loudness_match(x, sr, target=TARGET_LUFS, ceiling=CEILING_DB):
    g = target - lufs(x, sr)
    y, gr = x, 0.0
    for _ in range(8):
        y, gr = limit(x * undb(g), sr, ceiling)
        err = target - lufs(y, sr)
        if abs(err) < 0.05:
            break
        g += err
    return y, gr


def fade(x, sr, fin=0.003, fout=0.03):
    x = x.copy()
    ni, no = min(len(x), int(sr * fin)), min(len(x), int(sr * fout))
    if ni:
        x[:ni] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, ni))
    if no:
        x[-no:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, no))
    return x


def trim(x, sr, pre=PREROLL, post=0.05, head_db=40.0, tail_db=45.0, fout=0.03):
    """Cut silence: keep `pre` s before the first sound, `post` s after the last."""
    win = max(1, int(sr * 0.006))
    rms = np.sqrt(np.convolve(x ** 2, np.ones(win) / win, mode="same") + 1e-20)
    lv = db(rms)
    top = lv.max()
    on = np.flatnonzero(lv > max(top - head_db, -65.0))
    if not len(on):
        return x
    active = lv > max(top - tail_db, -70.0)
    # the last sound is the last stretch of activity that is not just a short,
    # faint blip (breath, click) trailing after the line
    edges = np.flatnonzero(np.diff(np.concatenate([[0], active.astype(int), [0]])))
    islands = list(zip(edges[::2], edges[1::2]))
    while len(islands) > 1:
        i0, i1 = islands[-1]
        if (i1 - i0) < 0.04 * sr and lv[i0:i1].max() < top - 20:
            islands.pop()
        else:
            break
    a = max(0, on[0] - int(pre * sr))
    b = min(len(x), islands[-1][1] + int(post * sr))
    return fade(x[a:b], sr, 0.003, min(fout, (b - a) / sr / 4))


# ----------------------------------------------------------------- WORLD vocoder
FP = 5.0  # ms per WORLD frame


def world_analyze(x, sr, f0_range=(60, 800)):
    import pyworld as pw

    x = np.ascontiguousarray(x, dtype=np.float64)
    f0, t = pw.harvest(x, sr, f0_floor=f0_range[0], f0_ceil=f0_range[1], frame_period=FP)
    sp = pw.cheaptrick(x, f0, t, sr)
    ap = pw.d4c(x, f0, t, sr)
    return f0, sp, ap


def world_synth(f0, sp, ap, sr):
    import pyworld as pw

    c = np.ascontiguousarray
    return pw.synthesize(c(f0), c(sp), c(ap), sr, FP)


def segments(f0, sp, min_frames=8, dip_db=5.0, weak_db=15.0):
    """Syllable-like chunks: voiced runs, split where the energy dips (the
    closure of the /b/ in "bye bye", the /m/ in "mama")."""
    e = 10 * np.log10(np.maximum(sp.sum(1), 1e-20))
    e = np.convolve(e, np.ones(3) / 3, mode="same")
    v = f0 > 0
    runs, i, n = [], 0, len(f0)
    while i < n:
        if v[i]:
            j = i
            while j < n and v[j]:
                j += 1
            if j - i >= min_frames:
                runs.append((i, j))
            i = j
        else:
            i += 1
    out = []

    def split(a, b):
        if b - a < 2 * min_frames:
            out.append((a, b))
            return
        s = e[a:b]
        depth = np.minimum(np.maximum.accumulate(s) - s, np.maximum.accumulate(s[::-1])[::-1] - s)
        depth[:min_frames] = -1
        depth[-min_frames:] = -1
        m = int(np.argmax(depth))
        if depth[m] >= dip_db:
            split(a, a + m)
            split(a + m, b)
        else:
            out.append((a, b))

    for a, b in runs:
        split(a, b)
    if out:                                     # drop faint creaky tails and blips
        top = max(e[a:b].max() for a, b in out)
        out = [(a, b) for a, b in out if e[a:b].max() > top - weak_db]
    return sorted(out)


def resample_frames(f0, sp, ap, pos):
    n = len(f0)
    i0 = np.clip(np.floor(pos).astype(int), 0, n - 1)
    i1 = np.minimum(i0 + 1, n - 1)
    fr = (pos - np.floor(pos))[:, None]
    sp2 = np.exp(np.log(sp[i0]) * (1 - fr) + np.log(sp[i1]) * fr)
    ap2 = ap[i0] * (1 - fr) + ap[i1] * fr
    fr1 = fr[:, 0]
    both = (f0[i0] > 0) & (f0[i1] > 0)
    f02 = np.where(fr1 < 0.5, f0[i0], f0[i1])
    f02[both] = 2 ** (np.log2(f0[i0][both]) * (1 - fr1[both]) + np.log2(f0[i1][both]) * fr1[both])
    return f02, sp2, ap2


def warp_envelope(sp, ratio):
    """Move formants: new(f) = old(f / ratio)."""
    n = sp.shape[1]
    src = np.clip(np.arange(n) / ratio, 0, n - 1)
    i0 = np.floor(src).astype(int)
    i1 = np.minimum(i0 + 1, n - 1)
    fr = src - i0
    lsp = np.log(sp)
    return np.exp(lsp[:, i0] * (1 - fr) + lsp[:, i1] * fr)


WORLD_KEYS = ("pitch", "formant", "expr", "melody", "contour", "vibrato", "stretch_last")


def needs_world(o) -> bool:
    return bool(o.get("melody") or o.get("contour") or o.get("vibrato") or o.get("stretch_last")
                or o.get("pitch", 0) != 0 or o.get("formant", 1) != 1 or o.get("expr", 1) != 1)


def world_fx(x, sr, o, label=""):
    """Pitch / formant / timing surgery with the WORLD vocoder."""
    f0, sp, ap = world_analyze(x, sr, o.get("f0_range", (60, 800)))
    n = len(f0)

    if o.get("stretch_last"):
        segs = segments(f0, sp, weak_db=8.0)      # last clearly voiced syllable
        if segs:
            a, b = segs[-1]
            r0, r1 = a + 0.3 * (b - a), a + 0.92 * (b - a)
            k = float(o["stretch_last"])
            pos = np.concatenate([np.arange(0, int(r0)),
                                  r0 + np.arange(int((r1 - r0) * k)) / k,
                                  np.arange(int(np.ceil(r1)), n)])
            f0, sp, ap = resample_frames(f0, sp, ap, pos)
            n = len(f0)

    v = f0 > 0
    if v.any():
        lf = np.log2(f0[v])
        med = np.median(lf)
        idx = np.flatnonzero(v)
        span = max(idx[-1] - idx[0], 1)
        tpos = (np.arange(n) - idx[0]) / span                    # 0..1 over voiced part

        if o.get("melody"):
            segs = segments(f0, sp)
            notes = o["melody"]
            if len(segs) != len(notes):
                print(f"    [{label}] melody has {len(notes)} notes, audio has {len(segs)} segments", flush=True)
            target = np.full(n, np.nan)
            for i, (a, b) in enumerate(segs):
                note = notes[min(i, len(notes) - 1)]
                pts = [note] if np.isscalar(note) else list(note)
                target[a:b] = np.interp(np.linspace(0, 1, b - a), np.linspace(0, 1, len(pts)), pts)
            ok = ~np.isnan(target)
            target = np.interp(np.arange(n), np.flatnonzero(ok), target[ok])
            g = max(1, int(o.get("glide_ms", 35) / FP))
            target = np.convolve(np.pad(target, g, mode="edge"), np.ones(2 * g + 1) / (2 * g + 1), "valid")
            keep = o.get("keep", 0.3)
            # natural wobble, minus creaky drops at phrase ends
            lf = med + target[v] / 12 + keep * np.clip(lf - med, -5 / 12, 5 / 12)
        else:
            lf = med + o.get("expr", 1.0) * np.clip(lf - med, -8 / 12, 8 / 12)

        if o.get("contour"):
            ct, cs = zip(*o["contour"])
            lf = lf + np.interp(tpos[v], ct, cs) / 12
        if o.get("vibrato"):
            rate, depth, start = o["vibrato"]
            tt = np.arange(n) * FP / 1000
            ramp = np.clip((tpos - start) / 0.25, 0, 1)
            vib = depth * np.sin(2 * np.pi * rate * tt) * ramp
            lf = lf + vib[v] / 12
        lf = lf + o.get("pitch", 0.0) / 12
        f0 = f0.copy()
        f0[v] = 2 ** lf

    if o.get("formant", 1.0) != 1.0:
        sp = warp_envelope(sp, o["formant"])
    return world_synth(f0, sp, ap, sr)


# ----------------------------------------------------------------- space
@lru_cache(maxsize=4)
def room_ir(sr, rt60, predelay, wet, hp, lp, slaps, seed=11):
    n = int(sr * (predelay + rt60))
    t = np.arange(n) / sr
    rng = np.random.default_rng(seed)
    tail = rng.standard_normal(n) * 10 ** (-3 * t / rt60)
    pd = int(predelay * sr)
    tail[:pd] = 0
    build = np.clip((t - predelay) / 0.03, 0, 1)            # diffuse tail swells in over 30 ms
    tail *= build
    tail /= np.sqrt(np.sum(tail ** 2))
    ir = tail * wet
    for d, g in slaps:
        ir[int(d * sr)] += g
    ir = biquad(biquad(ir, sr, "hp", hp), sr, "lp", lp)
    return ir


def add_space(x, sr, rt60, predelay, wet, hp, lp, slaps):
    ir = room_ir(sr, rt60, predelay, wet, hp, lp, tuple(tuple(s) for s in slaps))
    y = np.concatenate([x, np.zeros(len(ir))])
    return y + fftconvolve(y, ir)[: len(y)]


# ----------------------------------------------------------------- chains
def chain_pitre(take, o):
    x, sr = tts(take.text, take.voice, take.speed)
    if needs_world(o):
        x = world_fx(x, sr, o, take.file)
    x = eq(x, sr, o["eq"])
    x = compress(x, sr, *o["comp"])
    return saturate(x, o["drive"]), sr


def chain_baby(take, o):
    return chain_pitre(take, o)


def thump(sr, rng, crack=0.25):
    """Gunshot-ish low punch: falling sine + low noise + a tiny bright crack."""
    n = int(sr * 0.16)
    t = np.arange(n) / sr
    f = 45 + 110 * np.exp(-t / 0.022)
    body = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-t / 0.055)
    rumble = biquad(rng.standard_normal(n), sr, "lp", 260) * np.exp(-t / 0.03)
    rumble /= max(np.abs(rumble).max(), 1e-9)
    snap = biquad(rng.standard_normal(n), sr, "hp", 2500) * np.exp(-t / 0.004)
    snap /= max(np.abs(snap).max(), 1e-9)
    y = body + 0.45 * rumble + crack * snap
    y *= np.clip(t / 0.0015, 0, 1)
    return y / np.abs(y).max()


def word_onsets(x, sr, n):
    """Sample positions where each of `n` words said in a row starts: the first
    sound, then the rise into the vowel after each of the n-1 deepest energy
    valleys (the closure before every /b/ of "brap brap brap"). Valleys followed
    only by a short burst (the final /p/ release) don't count."""
    hop = max(1, int(sr * 0.0025))
    win = max(1, int(sr * 0.012))
    env = db(np.sqrt(np.convolve(x ** 2, np.ones(win) / win, mode="same")))[::hop]
    top = env.max()
    first = int(np.argmax(env > top - 30))
    W = int(0.15 * sr / hop)
    cands = []
    for i in range(first + 1, len(env) - 1):
        if env[i] <= env[i - 1] and env[i] <= env[i + 1]:
            right = env[i:i + W].max()
            if right < top - 12:                  # no vowel follows: a release burst
                continue
            cands.append((min(env[max(first, i - W):i].max(), right) - env[i], i))
    picked = []
    for depth, i in sorted(cands, reverse=True):
        if len(picked) == n - 1 or depth < 4:
            break
        if all(abs(i - j) >= 0.12 * sr / hop for j in picked):
            picked.append(i)
    onsets = [first]
    for i in sorted(picked):
        seg = env[i:i + W]
        pk = int(np.argmax(seg))
        level = min(seg[pk] - 18, env[i] + 0.5 * (seg[pk] - env[i]))    # where the /b/ bursts
        below = np.flatnonzero(seg[:pk] < level)
        onsets.append(i + (int(below[-1]) + 1 if len(below) else 0))
    return [k * hop for k in onsets]


def chain_brap(take, o):
    x, sr = tts(take.text, take.voice, take.speed)
    if needs_world(o):
        x = world_fx(x, sr, o, take.file)
    x = trim(x, sr, pre=0.0, post=0.05, tail_db=40)
    n = len(split_ipa(take.text)[0].split())
    onsets = word_onsets(x, sr, n)
    print(f"    {take.file}: thumps at {', '.join(f'{k / sr * 1000:.0f}' for k in onsets)} ms", flush=True)
    rng = np.random.default_rng(7)
    peak = np.abs(x).max()
    lead = int(0.01 * sr)
    out = np.concatenate([np.zeros(lead), x, np.zeros(int(0.2 * sr))])
    for k in onsets:
        p = max(0, lead + k + int(o["thump_offset"] * sr))
        th = thump(sr, rng, o["crack"]) * o["thump"] * peak
        m = min(len(th), len(out) - p)
        out[p:p + m] += th[:m]
    out = eq(out, sr, o["eq"])
    out = compress(out, sr, *o["comp"])
    return saturate(out, o["drive"]), sr


def chain_announcer(take, o):
    x, sr = tts(take.text, take.voice, take.speed)
    x = world_fx(x, sr, o, take.file)
    x = eq(x, sr, o["eq"])
    x = compress(x, sr, *o["comp"])
    x = saturate(x, o["drive"])
    x = x / max(np.abs(x).max(), 1e-9)
    return add_space(x, sr, **o["space"]), sr


def chain_pufferfish(take, o):
    """Original cartoon placeholder: inflate squeak -> pop -> deflating raspberry."""
    sr = SR_OUT
    rng = np.random.default_rng(o.get("seed", 3))

    def tl(sec):
        return np.arange(int(sec * sr)) / sr

    # 1) inflating: rising slide-whistle / rubber squeak, tension builds
    T1 = 0.62
    t = tl(T1)
    u = t / T1
    f = 320 * 4.4 ** (u ** 1.25)
    vib_rate = 5 + 13 * u
    vib = 1 + (0.008 + 0.03 * u) * np.sin(2 * np.pi * np.cumsum(vib_rate) / sr)
    jit = biquad(rng.standard_normal(len(t)), sr, "lp", 45)
    jit = jit / np.abs(jit).max() * 0.018 * u
    ph = 2 * np.pi * np.cumsum(f * (vib + jit)) / sr
    tone = np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    amp = (0.25 + 0.75 * u ** 0.7) * np.clip(t / 0.02, 0, 1)
    air = biquad(biquad(rng.standard_normal(len(t)), sr, "hp", 1200), sr, "lp", 6000)
    air = air / np.abs(air).max() * 0.08
    inflate = (tone / 1.4 + air) * amp

    # 2) strained hold: fast trembling at the top
    T2 = 0.09
    t2 = tl(T2)
    f2 = f[-1] * (1 + 0.035 * np.sin(2 * np.pi * 22 * t2))
    ph2 = ph[-1] + 2 * np.pi * np.cumsum(f2) / sr
    hold = (np.sin(ph2) + 0.3 * np.sin(2 * ph2) + 0.12 * np.sin(3 * ph2)) / 1.4
    hold *= 1.0 - 0.2 * t2 / T2

    # 3) pop: cork click + dropping "plop" + low thump
    t3 = tl(0.12)
    click = biquad(rng.standard_normal(len(t3)), sr, "bp", 3000, 0.7) * np.exp(-t3 / 0.004)
    click /= np.abs(click).max()
    fp = 300 + 900 * np.exp(-t3 / 0.012)
    plop = np.sin(2 * np.pi * np.cumsum(fp) / sr) * np.exp(-t3 / 0.03)
    ft = 40 + 70 * np.exp(-t3 / 0.02)
    boom = np.sin(2 * np.pi * np.cumsum(ft) / sr) * np.exp(-t3 / 0.05)
    pop = 1.0 * click + 0.8 * plop + 0.9 * boom

    # 4) deflating raspberry: buzzy lip trill, pitch sagging, sputtering out
    T4 = 0.52
    t4 = tl(T4)
    u4 = t4 / T4
    fr = 125 - 55 * u4
    saw = 2 * ((np.cumsum(fr) / sr) % 1.0) - 1
    flap_rate = 30 - 8 * u4 + 3 * biquad(rng.standard_normal(len(t4)), sr, "lp", 8) * 20
    flap = 0.5 + 0.5 * np.tanh(4 * np.sin(2 * np.pi * np.cumsum(flap_rate) / sr))
    rasp = saw * flap
    rasp = biquad(rasp, sr, "lp", 2800)
    rasp = biquad(rasp, sr, "peak", 800, 1.2, 7.0)
    rasp = biquad(rasp, sr, "peak", 1900, 1.5, 5.0)
    rasp = rasp / np.abs(rasp).max()
    spit = biquad(rng.standard_normal(len(t4)), sr, "bp", 2200, 0.7)
    rasp = rasp + 0.35 * spit / np.abs(spit).max() * flap
    rasp = np.tanh(3.0 * rasp / np.abs(rasp).max())               # dense, buzzy
    env = np.clip(t4 / 0.012, 0, 1) * (1 - u4 ** 2.2)
    sputter = np.where((u4 > 0.6) & (np.sin(2 * np.pi * 9 * t4) > 0.5), 0.3, 1.0)
    rasp = rasp * env * sputter
    rms = lambda v: np.sqrt(np.mean(v ** 2))                       # noqa: E731
    rasp *= 0.9 * rms(inflate[len(inflate) // 2:]) / rms(rasp[: len(rasp) // 2])

    out = np.zeros(len(t) + len(t2) + len(t4) + int(0.2 * sr))
    i = 0
    out[i:i + len(inflate)] += inflate
    i += len(inflate)
    out[i:i + len(hold)] += hold * amp[-1]
    i += len(hold)
    out[i:i + len(pop)] += pop / np.abs(pop).max() * 1.2
    i += int(0.035 * sr)
    out[i:i + len(rasp)] += rasp
    out = compress(out, sr, -18, 3.0, 1.0, 60.0)
    return out[: i + len(rasp)], sr


CHAINS = {
    "pitre": chain_pitre,
    "baby": chain_baby,
    "brap": chain_brap,
    "announcer": chain_announcer,
    "pufferfish": chain_pufferfish,
}


# ----------------------------------------------------------------- MP3 writing
def _crc16(data: bytes, crc: int = 0) -> int:
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def _frames(mp3: bytes):
    """Yield (offset, length) of each MPEG-1 Layer III frame."""
    rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    srs = [44100, 48000, 32000]
    i = 0
    while i + 4 <= len(mp3):
        h = mp3[i:i + 4]
        if h[0] != 0xFF or (h[1] & 0xFE) != 0xFA:
            raise ValueError(f"unexpected MP3 frame header at {i}: {h.hex()}")
        br = rates[h[2] >> 4] * 1000
        sr = srs[(h[2] >> 2) & 3]
        n = 144 * br // sr + ((h[2] >> 1) & 1)
        yield i, n
        i += n


def encode_mp3(x: np.ndarray, sr: int, kbps: int = MP3_KBPS) -> bytes:
    """CBR mono MP3 with a LAME "Info" header, so decoders skip the encoder
    delay and padding (sample-accurate start: no extra latency, no gap)."""
    import lameenc

    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(sr)
    enc.set_channels(1)
    enc.set_quality(2)
    audio = bytes(enc.encode(pcm.tobytes()) + enc.flush())

    frames = list(_frames(audio))
    hdr = bytearray(audio[:4])
    hdr[2] &= ~0x02                                      # the Info frame is unpadded
    info_len = 144 * (kbps * 1000) // sr
    info = bytearray(info_len)
    info[:4] = hdr
    p = 4 + 17                                           # MPEG-1 mono side info = 17 bytes
    total = info_len + len(audio)
    delay = 576                                          # LAME encoder delay
    padding = len(frames) * 1152 - delay - len(pcm)
    info[p:p + 4] = b"Info"
    info[p + 4:p + 8] = (0x0F).to_bytes(4, "big")        # frames | bytes | TOC | quality
    info[p + 8:p + 12] = len(frames).to_bytes(4, "big")
    info[p + 12:p + 16] = total.to_bytes(4, "big")
    info[p + 16:p + 116] = bytes(int(i * 256 / 100) for i in range(100))
    info[p + 116:p + 120] = (0).to_bytes(4, "big")
    q = p + 120                                          # LAME extension
    info[q:q + 9] = b"LAME3.100"
    info[q + 9] = 0x01                                   # tag rev 0, CBR
    info[q + 10] = 0
    info[q + 20] = min(kbps, 255)
    info[q + 21:q + 24] = ((delay << 12) | max(0, padding)).to_bytes(3, "big")
    info[q + 24] = 0x40 if sr == 44100 else (0x80 if sr == 48000 else 0)
    info[q + 28:q + 32] = total.to_bytes(4, "big")
    info[q + 32:q + 34] = _crc16(audio).to_bytes(2, "big")
    info[q + 34:q + 36] = _crc16(bytes(info[:q + 34])).to_bytes(2, "big")
    return bytes(info) + audio


def decode_mp3(data: bytes) -> np.ndarray:
    import io

    import soundfile as sf

    y, _ = sf.read(io.BytesIO(data), dtype="float64")
    return y


# ----------------------------------------------------------------- driver
def render(take: Take) -> tuple[np.ndarray, dict]:
    o = {**FX_DEFAULTS[take.fx], **take.opts}
    x, sr = CHAINS[take.fx](take, o)
    x = np.asarray(x, dtype=np.float64)
    x = x - x.mean()
    x = resample(x, sr, SR_OUT)
    sr = SR_OUT
    x = biquad(x, sr, "hp", o.get("hp", 60))
    x = trim(x, sr, PREROLL, o.get("tail", 0.05), tail_db=o.get("tail_db", 45),
             fout=o.get("fout", 0.03))
    if o.get("max_len") and len(x) > o["max_len"] * sr:
        print(f"    note: {take.file} is {len(x) / sr:.2f}s, cutting to {o['max_len']}s")
        x = fade(x[: int(o["max_len"] * sr)], sr, 0.0, 0.06)
    y, gr = loudness_match(x, sr)
    y = fade(y, sr, 0.002, 0.01)
    return y, dict(dur=len(y) / sr, gr=gr)


def write_manifest() -> None:
    slots: dict[str, dict] = {}
    for t in TAKES:
        s = slots.setdefault(t.slot, {"files": [], "gain": SLOT_GAIN.get(t.slot, 1.0)})
        s["files"].append(f"audio/{t.file}")
        if not (AUDIO_DIR / t.file).exists():
            print(f"  warning: {t.file} is in the table but missing on disk")
    manifest = {"version": 1, "slots": slots}
    (AUDIO_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


def report() -> None:
    import soundfile as sf

    print(f"\n{'file':42s} {'sec':>5s} {'LUFS':>6s} {'peak':>6s} {'KB':>5s}")
    total = 0
    for t in TAKES:
        p = AUDIO_DIR / t.file
        if not p.exists():
            print(f"{t.file:42s}  missing")
            continue
        y, sr = sf.read(str(p), dtype="float64")
        size = p.stat().st_size
        total += size
        print(f"{t.file:42s} {len(y) / sr:5.2f} {lufs(y, sr):6.1f} {db(np.abs(y).max()):6.1f} {size / 1024:5.1f}")
    print(f"{'total':42s} {'':5s} {'':6s} {'':6s} {total / 1024:5.1f}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="*", help="slot ids / file names (or prefixes) to render")
    ap.add_argument("--wav", action="store_true", help="also write WAV copies to tools/voices/out/")
    ap.add_argument("--list", action="store_true", help="print the line table and exit")
    ap.add_argument("--phonemes", action="store_true", help="print Kokoro phonemes for each line and exit")
    ap.add_argument("--report", action="store_true", help="measure the MP3s on disk and exit")
    args = ap.parse_args()

    if args.list:
        for t in TAKES:
            print(f"{t.slot:18s} {t.file:40s} {t.voice:28s} {t.speed:4.2f} {t.fx:10s} {t.text}")
        return
    if args.report:
        report()
        return

    todo = [t for t in TAKES if t.fx != "file"]
    if args.only:
        todo = [t for t in todo if any(t.slot.startswith(k) or t.file.startswith(k) or k in t.file
                                       for k in args.only)]
    if args.phonemes:
        for t in todo:
            if t.fx in ("pufferfish",):
                continue
            print(f"{t.file:40s} {' | '.join(phonemes(w) for w in t.text.split('|'))}")
        return

    for sub in {Path(t.file).parent for t in TAKES}:
        (AUDIO_DIR / sub).mkdir(parents=True, exist_ok=True)
    if args.wav:
        OUT_DIR.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    for i, t in enumerate(todo, 1):
        y, info = render(t)
        data = encode_mp3(y, SR_OUT)
        for _ in range(3):                  # the codec shifts loudness a little: re-check
            err = TARGET_LUFS - lufs(decode_mp3(data), SR_OUT)
            if abs(err) <= 0.1:
                break
            y, info["gr"] = limit(y * undb(err), SR_OUT)
            data = encode_mp3(y, SR_OUT)
        (AUDIO_DIR / t.file).write_bytes(data)
        if args.wav:
            import soundfile as sf

            sf.write(str(OUT_DIR / (t.file.replace("/", "__")[:-4] + ".wav")), y, SR_OUT)
        warn = "  <- heavy limiting" if info["gr"] > 8 else ""
        print(f"[{i:2d}/{len(todo)}] {t.file:40s} {info['dur']:4.2f}s  {len(data) / 1024:5.1f} KB"
              f"  limiter {info['gr']:4.1f} dB{warn}", flush=True)

    write_manifest()
    report()
    print(f"\ndone in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
