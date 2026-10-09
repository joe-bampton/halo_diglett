import { DEFAULT_VOLUMES, sanitizeVolumes, type Volumes } from './levels';
import { SFX, type SfxId } from './synth';

export type { Volumes } from './levels';
type Bus = 'guns' | 'sfx' | 'voice' | 'announcer';

export interface Vec {
  x: number;
  y: number;
  z: number;
}

interface Manifest {
  version: number;
  slots: Record<string, { files: string[]; gain?: number }>;
}

export interface PlayOpts {
  pos?: Vec | null;
  gain?: number;
  rate?: number;
  reverb?: number;
  delay?: number;
  loop?: boolean;
  bus?: Bus;
}

export interface SoundHandle {
  stop(fade?: number): void;
  setPos(p: Vec): void;
  duration: number;
  ended: boolean;
}

const NOOP: SoundHandle = { stop() {}, setPos() {}, duration: 0, ended: true };

/** Most gun / effect one-shots playing at once: past this the oldest gives way (a minigun duel mustn't choke a phone). */
const MAX_VOICES = 40;
/** A positional sound this quiet at the listener isn't worth starting. */
const MIN_AUDIBLE = 0.02;
/** Proper 3D (HRTF) panning is costly: only for sounds this close; further away plain stereo panning sounds the same. */
const HRTF_RANGE = 30;
/** Panner refDistance: full level up to here, then 1/distance. */
const REF_DISTANCE = 8;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private reverb!: ConvolverNode;
  private reverbIn!: GainNode;
  private buffers = new Map<SfxId, AudioBuffer>();
  private manifest: Manifest | null = null;
  private voiceBufs = new Map<string, AudioBuffer[]>();
  private voicePending = new Map<string, Promise<AudioBuffer[]>>();
  private annQueue: { slot: string; gain: number }[] = [];
  private wanted = new Set<string>();
  private wantedPrefixes = new Set<string>();
  private annBusyUntil = 0;
  /** gun / effect one-shots still playing, oldest first */
  private active: SoundHandle[] = [];
  private listenerPos: Vec = { x: 0, y: 0, z: 0 };
  hrtf = true;
  volumes: Volumes = { ...DEFAULT_VOLUMES };
  /** Listeners notified after any level changes (voice chat re-applies its element volumes). */
  readonly onVolumes = new Set<(v: Volumes) => void>();

  constructor() {
    try {
      this.volumes = sanitizeVolumes(JSON.parse(localStorage.getItem('hd.volumes') ?? 'null'));
    } catch {
      /* ignore */
    }
  }

  /** Must be called from a user gesture (click/tap/key). Safe to call repeatedly. */
  unlock() {
    if (this.ctx) {
      this.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    try {
      (navigator as Navigator & { audioSession?: { type: string } }).audioSession!.type = 'playback';
    } catch {
      /* not supported */
    }
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.buses = { guns: ctx.createGain(), sfx: ctx.createGain(), voice: ctx.createGain(), announcer: ctx.createGain() };
    for (const b of Object.values(this.buses)) b.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.6);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.35;
    this.reverbIn.connect(this.reverb).connect(this.master);
    this.applyVolumes();
    for (const id of Object.keys(SFX) as SfxId[]) {
      const data = SFX[id](ctx.sampleRate);
      const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.getChannelData(0).set(data);
      this.buffers.set(id, b);
    }
    void this.loadManifest();
    for (const slot of this.wanted) void this.voice(slot);
    if (this.wantedPrefixes.size) void this.voicesByPrefix();
  }

  /**
   * Get sound going again. Besides "suspended", iOS leaves the context "interrupted" after a phone call, Siri or a
   * switch to another app, and only resumes it when asked (from a tap, or when the page is visible again).
   */
  resume() {
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
  }

  setVolumes(v: Partial<Volumes>) {
    this.volumes = sanitizeVolumes({ ...this.volumes, ...v });
    try {
      localStorage.setItem('hd.volumes', JSON.stringify(this.volumes));
    } catch {
      /* ignore */
    }
    this.applyVolumes();
    for (const f of this.onVolumes) f(this.volumes);
  }

  resetVolumes() {
    this.setVolumes(DEFAULT_VOLUMES);
  }

  private applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    for (const b of Object.keys(this.buses) as Bus[]) this.buses[b].gain.value = this.volumes[b];
  }

  private impulse(sec: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // early slap-back from the hills + diffuse tail
        const slap = i > ctx.sampleRate * 0.18 && i < ctx.sampleRate * 0.2 ? 0.5 : 0;
        d[i] = (Math.random() * 2 - 1) * (Math.pow(1 - t, 3) * 0.5 + slap * (1 - t));
      }
    }
    return b;
  }

  setListener(pos: Vec, fwd: Vec, up: Vec = { x: 0, y: 1, z: 0 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.listenerPos.x = pos.x;
    this.listenerPos.y = pos.y;
    this.listenerPos.z = pos.z;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.01);
      l.positionY.setTargetAtTime(pos.y, t, 0.01);
      l.positionZ.setTargetAtTime(pos.z, t, 0.01);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.01);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.01);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.01);
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  private panner(pos: Vec, dist: number): PannerNode {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = this.hrtf && dist < HRTF_RANGE ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = REF_DISTANCE;
    p.rolloffFactor = 1;
    p.maxDistance = 400;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  playBuffer(buf: AudioBuffer, o: PlayOpts = {}): SoundHandle {
    const ctx = this.ctx;
    if (!ctx) return NOOP;
    let dist = 0;
    if (o.pos) {
      const L = this.listenerPos;
      dist = Math.hypot(o.pos.x - L.x, o.pos.y - L.y, o.pos.z - L.z);
      if (!o.loop && (o.gain ?? 1) * Math.min(1, REF_DISTANCE / Math.max(REF_DISTANCE, dist)) < MIN_AUDIBLE) return NOOP;
    }
    // voice lines and the announcer are throttled where they're triggered; guns and effects are capped here
    const capped = !o.loop && (o.bus ?? 'sfx') !== 'voice' && o.bus !== 'announcer';
    if (capped) {
      if (this.active.length >= MAX_VOICES) this.active = this.active.filter((h) => !h.ended);
      if (this.active.length >= MAX_VOICES) this.active.shift()!.stop(0.02);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    src.loop = !!o.loop;
    const g = ctx.createGain();
    g.gain.value = o.gain ?? 1;
    let tail: AudioNode = g;
    src.connect(g);
    let pan: PannerNode | null = null;
    if (o.pos) {
      pan = this.panner(o.pos, dist);
      g.connect(pan);
      tail = pan;
    }
    tail.connect(this.buses[o.bus ?? 'sfx']);
    let send: GainNode | null = null;
    if (o.reverb) {
      send = ctx.createGain();
      send.gain.value = o.reverb;
      tail.connect(send).connect(this.reverbIn);
    }
    const when = ctx.currentTime + (o.delay ?? 0);
    src.start(when);
    const h: SoundHandle = {
      duration: buf.duration / (o.rate ?? 1),
      ended: false,
      stop(fade = 0.05) {
        try {
          g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
          src.stop(ctx.currentTime + fade);
        } catch {
          /* already stopped */
        }
      },
      setPos(p: Vec) {
        if (!pan) return;
        if (pan.positionX) {
          pan.positionX.value = p.x;
          pan.positionY.value = p.y;
          pan.positionZ.value = p.z;
        } else pan.setPosition(p.x, p.y, p.z);
      },
    };
    src.onended = () => {
      h.ended = true;
      // the whole chain, so nothing lingers on the buses
      src.disconnect();
      g.disconnect();
      pan?.disconnect();
      send?.disconnect();
    };
    if (capped) this.active.push(h);
    return h;
  }

  play(id: SfxId, o: PlayOpts = {}): SoundHandle {
    const b = this.buffers.get(id);
    if (!b) return NOOP;
    return this.playBuffer(b, { ...o, rate: (o.rate ?? 1) * (0.96 + Math.random() * 0.08) });
  }

  // ---------------------------------------------------------------------------------------------
  // Voice lines (manifest-driven MP3s)
  // ---------------------------------------------------------------------------------------------

  async loadManifest() {
    if (this.manifest) return;
    try {
      const res = await fetch('audio/manifest.json', { cache: 'no-cache' });
      if (res.ok) this.manifest = (await res.json()) as Manifest;
    } catch {
      /* offline or missing — voices simply won't play */
    }
  }

  /** Decode all takes of the given slots ahead of time. */
  preload(slots: string[]) {
    for (const s of slots) {
      this.wanted.add(s);
      if (this.ctx) void this.voice(s);
    }
  }

  /** Decode every slot whose id starts with `prefix` (e.g. "ann." for all the announcer lines). */
  preloadPrefix(prefix: string) {
    this.wantedPrefixes.add(prefix);
    if (this.ctx) void this.voicesByPrefix();
  }

  private async voicesByPrefix() {
    await this.loadManifest();
    for (const slot of Object.keys(this.manifest?.slots ?? {}))
      for (const p of this.wantedPrefixes) if (slot.startsWith(p)) void this.voice(slot);
  }

  private voice(slot: string): Promise<AudioBuffer[]> {
    if (!this.ctx) return Promise.resolve([]);
    const ready = this.voiceBufs.get(slot);
    if (ready) return Promise.resolve(ready);
    const pending = this.voicePending.get(slot);
    if (pending) return pending;
    const p = (async () => {
      await this.loadManifest();
      const entry = this.manifest?.slots[slot];
      if (!entry || !this.ctx) {
        this.voicePending.delete(slot);
        return [];
      }
      const out: AudioBuffer[] = [];
      for (const f of entry.files) {
        try {
          const r = await fetch(f);
          if (!r.ok) continue;
          const ab = await r.arrayBuffer();
          out.push(await this.ctx.decodeAudioData(ab));
        } catch {
          /* skip bad file */
        }
      }
      this.voiceBufs.set(slot, out);
      return out;
    })();
    this.voicePending.set(slot, p);
    return p;
  }

  /** Synchronous: plays a random take if decoded, otherwise schedules decoding and returns null. */
  playVoice(slot: string, o: PlayOpts = {}): SoundHandle | null {
    const bufs = this.voiceBufs.get(slot);
    if (!bufs) {
      void this.voice(slot);
      return null;
    }
    if (!bufs.length) return null;
    const gain = (this.manifest?.slots[slot]?.gain ?? 1) * (o.gain ?? 1);
    const b = bufs[Math.floor(Math.random() * bufs.length)]!;
    return this.playBuffer(b, { ...o, gain, bus: o.bus ?? 'voice' });
  }

  voiceDuration(slot: string): number {
    const bufs = this.voiceBufs.get(slot);
    if (!bufs?.length) return 1;
    return Math.max(...bufs.map((b) => b.duration));
  }

  /** Announcer lines are queued so they never talk over each other. */
  announce(slot: string, gain = 1) {
    if (!this.ctx) return;
    if (this.annQueue.length > 2) this.annQueue.shift();
    this.annQueue.push({ slot, gain });
    this.pumpAnnouncer();
  }

  private pumpAnnouncer() {
    if (!this.ctx || !this.annQueue.length) return;
    const now = this.ctx.currentTime;
    if (now < this.annBusyUntil) {
      setTimeout(() => this.pumpAnnouncer(), (this.annBusyUntil - now) * 1000 + 30);
      return;
    }
    const next = this.annQueue.shift()!;
    const h = this.playVoice(next.slot, { gain: next.gain, bus: 'announcer', reverb: 0.25 });
    this.annBusyUntil = now + (h ? h.duration + 0.12 : 0);
    if (this.annQueue.length) setTimeout(() => this.pumpAnnouncer(), (h ? h.duration + 0.15 : 0.1) * 1000);
  }

  get ready() {
    return !!this.ctx;
  }
}

export const audio = new AudioEngine();
