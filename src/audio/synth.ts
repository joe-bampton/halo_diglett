/**
 * Procedural sound effects rendered to raw samples at startup (no downloads, no licensing issues).
 * Each generator returns mono Float32 samples at the given sample rate.
 */
type Gen = (sr: number) => Float32Array;

const TAU = Math.PI * 2;
let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const noise = () => rnd() * 2 - 1;

function buf(sr: number, dur: number, fn: (t: number, i: number) => number): Float32Array {
  const n = Math.max(1, Math.floor(sr * dur));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / sr, i);
  return out;
}

/** One-pole low-pass. */
function lp(cut: number, sr: number) {
  let y = 0;
  const a = Math.exp((-TAU * cut) / sr);
  return (x: number, c?: number) => {
    const aa = c !== undefined ? Math.exp((-TAU * c) / sr) : a;
    y = x + aa * (y - x);
    return y;
  };
}
function hp(cut: number, sr: number) {
  const l = lp(cut, sr);
  return (x: number) => x - l(x);
}

const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));

function normalize(b: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (const v of b) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < b.length; i++) b[i] = (b[i]! / m) * peak;
  return b;
}

const sniper: Gen = (sr) => {
  const l1 = lp(3000, sr), l2 = lp(400, sr), h1 = hp(80, sr);
  let ph = 0;
  return normalize(
    buf(sr, 1.1, (t) => {
      const crack = noise() * env(t, 0.001, 0.018);
      const body = l1(noise()) * env(t, 0.002, 0.07) * 0.8;
      ph += (TAU * (70 - t * 40)) / sr;
      const boom = Math.sin(ph) * env(t, 0.003, 0.12) * 0.9;
      const tail = l2(noise()) * env(t, 0.05, 0.35) * 0.35;
      return h1(crack + body + boom + tail);
    }),
  );
};

const rifle: Gen = (sr) => {
  const l1 = lp(2500, sr);
  let ph = 0;
  return normalize(
    buf(sr, 0.35, (t) => {
      ph += (TAU * (110 - t * 120)) / sr;
      return l1(noise()) * env(t, 0.001, 0.035) + Math.sin(ph) * env(t, 0.002, 0.05) * 0.7 + noise() * env(t, 0.0005, 0.006) * 0.5;
    }),
    0.8,
  );
};

const crossbow: Gen = (sr) => {
  let ph = 0;
  const l1 = lp(1800, sr);
  return normalize(
    buf(sr, 0.5, (t) => {
      const f = 380 * Math.exp(-t * 7) + 90;
      ph += (TAU * f) / sr;
      const saw = ((ph / TAU) % 1) * 2 - 1;
      return l1(saw) * env(t, 0.001, 0.12) + noise() * env(t, 0.001, 0.02) * 0.5;
    }),
  );
};

const rocket: Gen = (sr) => {
  const l1 = lp(600, sr);
  let ph = 0;
  return normalize(
    buf(sr, 0.9, (t) => {
      ph += (TAU * (60 + t * 30)) / sr;
      const whoosh = l1(noise(), 300 + t * 2500) * Math.min(1, t * 20) * Math.exp(-t * 2.5);
      return whoosh + Math.sin(ph) * env(t, 0.005, 0.1) * 0.8;
    }),
  );
};

const bloop: Gen = (sr) => {
  let ph = 0;
  return normalize(
    buf(sr, 0.3, (t) => {
      ph += (TAU * (420 * Math.exp(-t * 9) + 120)) / sr;
      return Math.sin(ph) * env(t, 0.002, 0.08) + noise() * env(t, 0.001, 0.01) * 0.3;
    }),
    0.8,
  );
};

const rail: Gen = (sr) => {
  let ph = 0;
  const l1 = lp(5000, sr);
  return normalize(
    buf(sr, 0.9, (t) => {
      ph += (TAU * (1600 * Math.exp(-t * 6) + 60)) / sr;
      const sq = Math.sign(Math.sin(ph)) * 0.5;
      return l1(sq + noise() * 0.6) * env(t, 0.001, 0.18) + Math.sin(ph * 0.25) * env(t, 0.002, 0.3) * 0.6;
    }),
  );
};

const charge: Gen = (sr) => {
  let ph = 0;
  return normalize(
    buf(sr, 0.9, (t) => {
      ph += (TAU * (200 + t * t * 1400)) / sr;
      return Math.sin(ph) * Math.min(1, t * 4) * (0.6 + 0.4 * Math.sin(t * 60)) * (t > 0.85 ? (0.9 - t) * 20 : 1);
    }),
    0.5,
  );
};

const beamLoop: Gen = (sr) => {
  let p1 = 0, p2 = 0, p3 = 0;
  const l1 = lp(2200, sr);
  const dur = 1;
  return normalize(
    buf(sr, dur, (t) => {
      p1 += (TAU * 110) / sr;
      p2 += (TAU * 111.5) / sr;
      p3 += (TAU * 220) / sr;
      const saw = ((p1 / TAU) % 1) * 2 - 1 + (((p2 / TAU) % 1) * 2 - 1);
      return l1(saw * 0.5 + Math.sin(p3) * 0.4 + noise() * 0.15) * (0.8 + 0.2 * Math.sin(TAU * 12 * t));
    }),
    0.55,
  );
};

const needle: Gen = (sr) => {
  let ph = 0;
  return normalize(
    buf(sr, 0.14, (t) => {
      ph += (TAU * (2200 * Math.exp(-t * 18) + 600)) / sr;
      return Math.sin(ph) * env(t, 0.001, 0.04);
    }),
    0.45,
  );
};

const flameLoop: Gen = (sr) => {
  const l1 = lp(900, sr), l2 = lp(160, sr);
  return normalize(
    buf(sr, 1, (t) => (l1(noise()) * 0.7 + l2(noise()) * 1.5) * (0.85 + 0.15 * Math.sin(TAU * 7 * t))),
    0.6,
  );
};

const minigun: Gen = (sr) => {
  const l1 = lp(3200, sr);
  return normalize(buf(sr, 0.09, (t) => l1(noise()) * env(t, 0.0005, 0.018) + Math.sin(TAU * 130 * t) * env(t, 0.001, 0.02) * 0.6), 0.6);
};

const explosion: Gen = (sr) => {
  const l1 = lp(900, sr), l2 = lp(120, sr);
  let ph = 0;
  return normalize(
    buf(sr, 1.8, (t) => {
      ph += (TAU * (55 - t * 20)) / sr;
      const crack = noise() * env(t, 0.001, 0.02);
      const roar = l1(noise(), 2400 * Math.exp(-t * 3) + 150) * env(t, 0.004, 0.35);
      const rumble = l2(noise()) * env(t, 0.02, 0.6) * 2.5;
      return crack * 0.6 + roar + rumble + Math.sin(ph) * env(t, 0.005, 0.25);
    }),
  );
};

const hitTick: Gen = (sr) => normalize(buf(sr, 0.05, (t) => Math.sin(TAU * 2100 * t) * env(t, 0.0005, 0.012)), 0.5);

const ding: Gen = (sr) =>
  normalize(
    buf(sr, 0.5, (t) => (Math.sin(TAU * 1560 * t) + 0.6 * Math.sin(TAU * 2340 * t) + 0.3 * Math.sin(TAU * 3900 * t)) * env(t, 0.001, 0.12)),
    0.5,
  );

const shieldBreak: Gen = (sr) => {
  const h1 = hp(1500, sr);
  let ph = 0;
  return normalize(
    buf(sr, 0.45, (t) => {
      ph += (TAU * (900 * Math.exp(-t * 8) + 200)) / sr;
      return h1(noise()) * env(t, 0.001, 0.05) + Math.sin(ph) * env(t, 0.002, 0.12) * 0.6;
    }),
    0.7,
  );
};

const recharge: Gen = (sr) => {
  let ph = 0;
  return normalize(
    buf(sr, 0.9, (t) => {
      ph += (TAU * (260 + t * 700)) / sr;
      return Math.sin(ph) * (0.5 + 0.5 * Math.sin(TAU * 18 * t)) * Math.min(1, t * 8) * Math.exp(-t * 1.5);
    }),
    0.35,
  );
};

const lowShield: Gen = (sr) => normalize(buf(sr, 0.35, (t) => Math.sin(TAU * 880 * t) * (t < 0.12 || (t > 0.2 && t < 0.32) ? 1 : 0) * 0.5), 0.3);

const reload: Gen = (sr) => {
  const l1 = lp(3000, sr);
  return normalize(
    buf(sr, 0.5, (t) => {
      const c1 = t < 0.03 ? noise() * env(t, 0.0005, 0.008) : 0;
      const c2 = t > 0.28 && t < 0.33 ? noise() * env(t - 0.28, 0.0005, 0.01) : 0;
      return l1(c1 + c2) + Math.sin(TAU * 400 * t) * (t > 0.28 && t < 0.3 ? 0.3 : 0);
    }),
    0.5,
  );
};

const rustle: Gen = (sr) => {
  const l1 = lp(700, sr);
  return normalize(buf(sr, 0.16, (t) => l1(noise()) * Math.sin((Math.PI * t) / 0.16)), 0.35);
};

const orbPop: Gen = (sr) => {
  let ph = 0;
  return normalize(
    buf(sr, 0.7, (t) => {
      const step = Math.floor(t / 0.07);
      const f = [880, 1175, 1320, 1760, 2093, 2637, 3136, 3520, 4186, 4186][Math.min(9, step)]!;
      ph += (TAU * f) / sr;
      return Math.sin(ph) * env(t % 0.07, 0.002, 0.05) * Math.exp(-t * 2) + noise() * env(t, 0.001, 0.015) * 0.8;
    }),
    0.6,
  );
};

const powerup: Gen = (sr) => {
  let ph = 0;
  return normalize(
    buf(sr, 0.8, (t) => {
      const f = 440 * Math.pow(2, Math.floor(t / 0.1) * (4 / 12));
      ph += (TAU * f) / sr;
      return (Math.sin(ph) + 0.4 * Math.sin(ph * 2)) * Math.exp(-t * 2.2);
    }),
    0.5,
  );
};

const medal: Gen = (sr) =>
  normalize(
    buf(sr, 0.6, (t) => (Math.sin(TAU * 988 * t) * (t < 0.12 ? 1 : 0) + Math.sin(TAU * 1319 * t) * (t >= 0.1 ? 1 : 0)) * Math.exp(-t * 4)),
    0.4,
  );

const partyHorn: Gen = (sr) => {
  let ph = 0;
  return normalize(
    buf(sr, 0.8, (t) => {
      ph += (TAU * (520 + Math.sin(t * 30) * 25 + t * 80)) / sr;
      const saw = ((ph / TAU) % 1) * 2 - 1;
      return saw * Math.min(1, t * 30) * (t > 0.7 ? (0.8 - t) * 10 : 1) * 0.6;
    }),
    0.6,
  );
};

const thud: Gen = (sr) => {
  let ph = 0;
  const l1 = lp(400, sr);
  return normalize(
    buf(sr, 0.4, (t) => {
      ph += (TAU * (90 - t * 80)) / sr;
      return Math.sin(ph) * env(t, 0.002, 0.08) + l1(noise()) * env(t, 0.001, 0.05);
    }),
    0.7,
  );
};

const beep: Gen = (sr) => normalize(buf(sr, 0.15, (t) => Math.sin(TAU * 1046 * t) * env(t, 0.002, 0.08)), 0.4);

const whistle: Gen = (sr) => {
  let ph = 0;
  return normalize(
    buf(sr, 2.0, (t) => {
      ph += (TAU * (1800 - t * 700)) / sr;
      return Math.sin(ph) * Math.min(1, t * 3) * 0.5;
    }),
    0.4,
  );
};

const empty: Gen = (sr) => normalize(buf(sr, 0.06, (t) => noise() * env(t, 0.0005, 0.006) + Math.sin(TAU * 1200 * t) * env(t, 0.001, 0.01)), 0.3);

const spawn: Gen = (sr) => {
  let ph = 0;
  return normalize(
    buf(sr, 0.6, (t) => {
      ph += (TAU * (300 + t * 500)) / sr;
      return Math.sin(ph) * Math.sin((Math.PI * t) / 0.6) * 0.6;
    }),
    0.3,
  );
};

/** Spring Jump launch: a springy "boing". */
const boing: Gen = (sr) => {
  let ph = 0;
  return normalize(
    buf(sr, 0.75, (t) => {
      const f = 110 + 340 * Math.exp(-t * 4.5) * (1 + 0.45 * Math.sin(TAU * 15 * t));
      ph += (TAU * f) / sr;
      return (Math.sin(ph) + 0.3 * Math.sin(ph * 2.01)) * env(t, 0.003, 0.24);
    }),
    0.6,
  );
};

/** Rushing air (Spring Jump flight). */
const whoosh: Gen = (sr) => {
  const l1 = lp(900, sr), h1 = hp(160, sr);
  const dur = 1.2;
  return normalize(
    buf(sr, dur, (t) => {
      const k = Math.sin(Math.PI * Math.min(1, t / dur));
      return h1(l1(noise(), 350 + 2400 * k)) * k * k;
    }),
    0.45,
  );
};

export const SFX = {
  sniper,
  rifle,
  crossbow,
  rocket,
  bloop,
  rail,
  charge,
  beamLoop,
  needle,
  flameLoop,
  minigun,
  explosion,
  hitTick,
  ding,
  shieldBreak,
  recharge,
  lowShield,
  reload,
  rustle,
  orbPop,
  powerup,
  medal,
  partyHorn,
  thud,
  beep,
  whistle,
  empty,
  spawn,
  // new sounds go last: they share one noise sequence with the ones above
  boing,
  whoosh,
} satisfies Record<string, Gen>;

export type SfxId = keyof typeof SFX;
