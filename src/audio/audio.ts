import { DEFAULT_VOLUMES, sanitizeVolumes, type Volumes } from './levels';
import { parseManifest, pickSfx, pickTake, sfxSlots, type Manifest, type Slot } from './manifest';
import { SFX, type SfxId } from './synth';

export type { Volumes } from './levels';
type Bus = 'guns' | 'sfx' | 'voice' | 'announcer';

export interface Vec {
  x: number;
  y: number;
  z: number;
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

export interface VoiceOpts extends PlayOpts {
  /** Name of the player saying the line: their own recorded takes are preferred. */
  speaker?: string;
}

export interface SoundHandle {
  stop(fade?: number): void;
  setPos(p: Vec): void;
  duration: number;
  ended: boolean;
}

const NOOP: SoundHandle = { stop() {}, setPos() {}, duration: 0, ended: true };

interface VoiceTake {
  buf: AudioBuffer;
  by?: string;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private reverb!: ConvolverNode;
  private reverbIn!: GainNode;
  private buffers = new Map<SfxId, AudioBuffer>();
  /** Real recordings (manifest `sfx.<id>` slots) that replace the synthesized buffers once decoded. */
  private sfxFiles = new Map<SfxId, { bufs: AudioBuffer[]; gain: number }>();
  private sfxLoading: Promise<void> | null = null;
  private manifest: Manifest | null = null;
  private manifestLoading: Promise<void> | null = null;
  private voiceBufs = new Map<string, VoiceTake[]>();
  private voicePending = new Map<string, Promise<VoiceTake[]>>();
  private annQueue: { slot: string; gain: number }[] = [];
  private wanted = new Set<string>();
  private wantedPrefixes = new Set<string>();
  private annBusyUntil = 0;
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
      if (this.ctx.state === 'suspended') void this.ctx.resume();
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
    void this.loadSfxFiles();
    for (const slot of this.wanted) void this.voice(slot);
    if (this.wantedPrefixes.size) void this.voicesByPrefix();
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

  private panner(pos: Vec): PannerNode {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 8;
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
      pan = this.panner(o.pos);
      g.connect(pan);
      tail = pan;
    }
    tail.connect(this.buses[o.bus ?? 'sfx']);
    if (o.reverb) {
      const send = ctx.createGain();
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
      src.disconnect();
    };
    return h;
  }

  play(id: SfxId, o: PlayOpts = {}): SoundHandle {
    const files = this.sfxFiles.get(id);
    const b = pickSfx(files?.bufs, this.buffers.get(id));
    if (!b) return NOOP;
    const gain = (o.gain ?? 1) * (files?.gain ?? 1);
    return this.playBuffer(b, { ...o, gain, rate: (o.rate ?? 1) * (0.96 + Math.random() * 0.08) });
  }

  /**
   * Decode the real sound files listed as `sfx.<id>` slots in the manifest (tools/sfx/import.py).
   * Each one replaces its synthesized sound once it's ready; a sound whose files all fail keeps
   * the synthesized version. Started by unlock(), never awaited there.
   */
  loadSfxFiles(): Promise<void> {
    if (!this.ctx) return Promise.resolve();
    this.sfxLoading ??= (async () => {
      await this.loadManifest();
      const slots = Object.entries(sfxSlots(this.manifest)) as [SfxId, Slot][];
      await Promise.all(
        slots.map(async ([id, slot]) => {
          const bufs = (await Promise.all(slot.takes.map((t) => this.decode(t.file)))).filter((b): b is AudioBuffer => !!b);
          if (bufs.length) this.sfxFiles.set(id, { bufs, gain: slot.gain });
        }),
      );
    })();
    return this.sfxLoading;
  }

  private async decode(file: string): Promise<AudioBuffer | null> {
    try {
      const r = await fetch(file);
      if (!r.ok || !this.ctx) return null;
      return await this.ctx.decodeAudioData(await r.arrayBuffer());
    } catch {
      return null; // missing or undecodable: skip it
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Voice lines (manifest-driven MP3s)
  // ---------------------------------------------------------------------------------------------

  loadManifest(): Promise<void> {
    this.manifestLoading ??= (async () => {
      try {
        const res = await fetch('audio/manifest.json', { cache: 'no-cache' });
        if (res.ok) this.manifest = parseManifest(await res.json());
      } catch {
        /* offline or missing — voices simply won't play, sounds stay synthesized */
      }
      if (!this.manifest) this.manifestLoading = null; // try again next time
    })();
    return this.manifestLoading;
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

  private voice(slot: string): Promise<VoiceTake[]> {
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
      const bufs = await Promise.all(entry.takes.map((t) => this.decode(t.file)));
      const out = entry.takes.flatMap((t, i) => (bufs[i] ? [{ buf: bufs[i], by: t.by }] : []));
      this.voiceBufs.set(slot, out);
      return out;
    })();
    this.voicePending.set(slot, p);
    return p;
  }

  /**
   * Synchronous: plays a take if decoded (the speaker's own recording if they made one, otherwise a
   * random one), otherwise schedules decoding and returns null.
   */
  playVoice(slot: string, o: VoiceOpts = {}): SoundHandle | null {
    const takes = this.voiceBufs.get(slot);
    if (!takes) {
      void this.voice(slot);
      return null;
    }
    if (!takes.length) return null;
    const gain = (this.manifest?.slots[slot]?.gain ?? 1) * (o.gain ?? 1);
    const b = takes[pickTake(takes, o.speaker)]!.buf;
    return this.playBuffer(b, { ...o, gain, bus: o.bus ?? 'voice' });
  }

  voiceDuration(slot: string): number {
    const takes = this.voiceBufs.get(slot);
    if (!takes?.length) return 1;
    return Math.max(...takes.map((t) => t.buf.duration));
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
