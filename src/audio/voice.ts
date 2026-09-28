import type { SlotInfo } from '../net/protocol';
import type { VoiceLink, VoicePeerInfo } from '../net/transport';
import { audio } from './audio';
import { DEFAULT_PEER, chatElementVolume, type PeerPrefs, type Volumes } from './levels';

export type MicMode = 'open' | 'ptt';
/** off: no mic · live: sending · muted: self-muted · ptt: push-to-talk, key not held */
export type MicState = 'off' | 'starting' | 'live' | 'muted' | 'ptt' | 'error';

export interface VoicePrefs {
  micWanted: boolean;
  mode: MicMode;
  selfMuted: boolean;
  /** per-player settings, keyed by player name (peer ids and slots change every game) */
  peers: Record<string, PeerPrefs>;
}

export interface VoicePlayer {
  slot: number;
  name: string;
  color: number;
  /** that player currently has a microphone on */
  mic: boolean;
  speaking: boolean;
  vol: number;
  muted: boolean;
}

/** Where the voice chat gets roster info from (the ClientSession). */
export interface VoiceSession {
  slot: number;
  lobby: { slots: SlotInfo[] } | null;
}

/** Browser bits, injectable so the logic can be unit-tested in node. */
export interface VoiceDeps {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  getUserMedia: ((c: MediaStreamConstraints) => Promise<MediaStream>) | null;
  createAudio: () => HTMLAudioElement;
  audioCtx: () => AudioContext | null;
  volumes: () => Volumes;
}

interface Meter {
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  buf: Float32Array<ArrayBuffer>;
  level: number;
  loudAt: number;
}

interface Remote {
  peer: string;
  slot: number;
  mic: boolean;
  stream: MediaStream | null;
  el: HTMLAudioElement | null;
  meter: Meter | null;
}

const PREFS_KEY = 'hd.voice';
const SPEAK_LEVEL = 0.015;
const SPEAK_HOLD_MS = 350;

export function defaultVoicePrefs(): VoicePrefs {
  return { micWanted: false, mode: 'open', selfMuted: false, peers: {} };
}

export function sanitizeVoicePrefs(raw: unknown): VoicePrefs {
  const p = defaultVoicePrefs();
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Partial<VoicePrefs>;
  p.micWanted = r.micWanted === true;
  p.mode = r.mode === 'ptt' ? 'ptt' : 'open';
  p.selfMuted = r.selfMuted === true;
  if (r.peers && typeof r.peers === 'object') {
    for (const [name, v] of Object.entries(r.peers)) {
      if (!v || typeof v !== 'object') continue;
      const vol = typeof v.vol === 'number' && Number.isFinite(v.vol) ? Math.min(1, Math.max(0, v.vol)) : 1;
      p.peers[name] = { vol, muted: v.muted === true };
    }
  }
  return p;
}

function browserDeps(getVolumes: () => Volumes, getCtx: () => AudioContext | null): VoiceDeps {
  let storage: Storage | null = null;
  try {
    storage = localStorage;
  } catch {
    /* blocked */
  }
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  return {
    storage,
    getUserMedia: md?.getUserMedia ? (c) => md.getUserMedia(c) : null,
    createAudio: () => new Audio(),
    audioCtx: getCtx,
    volumes: getVolumes,
  };
}

/**
 * Party voice chat: the player's microphone goes to every other player over WebRTC, and every
 * other player's mic is played back flat (not positional) through a hidden <audio> element.
 * Media elements are used instead of WebAudio playback so the browser's echo cancellation keeps
 * working for people on speakers. The mic can be self-muted, or used push-to-talk.
 */
export class VoiceChat {
  prefs: VoicePrefs;
  micStream: MediaStream | null = null;
  micError = '';
  private starting = false;
  private pttDown = false;
  private link: VoiceLink | null = null;
  private session: VoiceSession | null = null;
  private announced = -1;
  private remotes = new Map<string, Remote>();
  private micMeter: Meter | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private speakKey = '';
  private readonly listeners = new Set<() => void>();
  readonly deps: VoiceDeps;

  constructor(deps: Partial<VoiceDeps> & Pick<VoiceDeps, 'volumes' | 'audioCtx'>) {
    this.deps = { ...browserDeps(deps.volumes, deps.audioCtx), ...deps };
    let raw: unknown = null;
    try {
      raw = JSON.parse(this.deps.storage?.getItem(PREFS_KEY) ?? 'null');
    } catch {
      /* ignore */
    }
    this.prefs = sanitizeVoicePrefs(raw);
  }

  // ------------------------------------------------------------------------------------------
  // change notifications
  // ------------------------------------------------------------------------------------------

  subscribe(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit() {
    for (const f of this.listeners) f();
  }

  private save() {
    try {
      this.deps.storage?.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------------------------------
  // session wiring
  // ------------------------------------------------------------------------------------------

  /** True while connected to an online game that can carry voice. */
  get available(): boolean {
    return !!this.link;
  }

  attach(link: VoiceLink, session: VoiceSession) {
    this.detach();
    this.link = link;
    this.session = session;
    link.onStream = (peer, stream) => this.onStream(peer, stream);
    link.onPeerInfo = (peer, info) => this.onPeerInfo(peer, info);
    link.onPeerGone = (peer) => this.dropPeer(peer);
    if (this.micStream) link.setStream(this.micStream);
    this.sync();
    if (this.prefs.micWanted && !this.micStream) void this.autoStartMic();
  }

  detach() {
    if (this.link) {
      this.link.setStream(null);
      this.link.onStream = this.link.onPeerInfo = this.link.onPeerGone = null;
    }
    this.link = null;
    this.session = null;
    this.announced = -1;
    for (const peer of [...this.remotes.keys()]) this.dropPeer(peer, false);
    this.stopMic(true);
    this.emit();
  }

  /** Call when the lobby/slot changes: re-announces our slot and refreshes the UI. */
  sync() {
    const slot = this.session?.slot ?? -1;
    if (this.link && slot >= 0 && slot !== this.announced) {
      this.announced = slot;
      this.link.announce(slot);
    }
    this.applyVolumes(); // names may have changed
    this.emit();
  }

  // ------------------------------------------------------------------------------------------
  // microphone
  // ------------------------------------------------------------------------------------------

  get micState(): MicState {
    if (this.starting) return 'starting';
    if (!this.micStream) return this.micError ? 'error' : 'off';
    if (this.prefs.selfMuted) return 'muted';
    if (this.prefs.mode === 'ptt' && !this.pttDown) return 'ptt';
    return 'live';
  }

  get transmitting(): boolean {
    return this.micState === 'live';
  }

  /** Must be called from a user gesture the first time (the browser asks for permission). */
  async enableMic(): Promise<boolean> {
    if (this.micStream) return true;
    if (this.starting) return false;
    this.micError = '';
    if (!this.deps.getUserMedia) {
      this.micError = 'Microphone access needs a secure (https) page and a browser that supports it.';
      this.emit();
      return false;
    }
    this.starting = true;
    this.emit();
    try {
      const stream = await this.deps.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.starting = false;
      this.micStream = stream;
      this.prefs.micWanted = true;
      this.save();
      this.applyTrack();
      this.link?.setStream(stream);
      this.micMeter = this.makeMeter(stream);
      this.ensureTimer();
      this.emit();
      return true;
    } catch (e) {
      this.starting = false;
      const name = (e as { name?: string })?.name;
      this.micError =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone permission was blocked. Allow it in the browser’s site settings and try again.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'No microphone found.'
            : `Could not start the microphone${e instanceof Error && e.message ? ` (${e.message})` : ''}.`;
      this.emit();
      return false;
    }
  }

  /** Re-open the mic at the start of a game if the player had it on and already granted access. */
  private async autoStartMic() {
    try {
      const perms = (typeof navigator !== 'undefined' ? navigator.permissions : undefined) as Permissions | undefined;
      const st = await perms?.query({ name: 'microphone' as PermissionName });
      if (st?.state !== 'granted' || !this.link) return;
    } catch {
      return;
    }
    await this.enableMic();
  }

  /** Turn the microphone off. `keepWanted` remembers it should come back next game. */
  stopMic(keepWanted = false) {
    if (!keepWanted && this.prefs.micWanted) {
      this.prefs.micWanted = false;
      this.save();
    }
    if (!this.micStream) return;
    this.link?.setStream(null);
    for (const t of this.micStream.getTracks()) t.stop();
    this.micStream = null;
    this.killMeter(this.micMeter);
    this.micMeter = null;
    this.emit();
  }

  toggleSelfMute() {
    this.setSelfMuted(!this.prefs.selfMuted);
  }

  setSelfMuted(m: boolean) {
    this.prefs.selfMuted = m;
    this.save();
    this.applyTrack();
    this.emit();
  }

  setMode(mode: MicMode) {
    this.prefs.mode = mode;
    this.save();
    this.applyTrack();
    this.emit();
  }

  /** Push-to-talk key/button state. */
  setPtt(down: boolean) {
    if (this.pttDown === down) return;
    this.pttDown = down;
    this.applyTrack();
    this.emit();
  }

  private applyTrack() {
    // a disabled track sends silence without renegotiating the connection
    const on = this.transmitting;
    for (const t of this.micStream?.getAudioTracks() ?? []) t.enabled = on;
  }

  /** Mic input level 0..1 (for the Options meter). */
  get micLevel(): number {
    return this.micMeter?.level ?? 0;
  }

  // ------------------------------------------------------------------------------------------
  // other players
  // ------------------------------------------------------------------------------------------

  peerPrefs(name: string): PeerPrefs {
    return this.prefs.peers[name] ?? { ...DEFAULT_PEER };
  }

  setPeerVolume(name: string, vol: number) {
    this.prefs.peers[name] = { ...this.peerPrefs(name), vol: Math.min(1, Math.max(0, vol)) };
    this.save();
    this.applyVolumes();
    this.emit();
  }

  togglePeerMute(name: string) {
    this.setPeerMuted(name, !this.peerPrefs(name).muted);
  }

  setPeerMuted(name: string, muted: boolean) {
    this.prefs.peers[name] = { ...this.peerPrefs(name), muted };
    this.save();
    this.applyVolumes();
    this.emit();
  }

  /** Back to 100% for everyone. Mutes are choices, not levels, so they are kept. */
  resetPeerVolumes() {
    for (const [name, p] of Object.entries(this.prefs.peers)) {
      if (p.muted) this.prefs.peers[name] = { vol: DEFAULT_PEER.vol, muted: true };
      else delete this.prefs.peers[name];
    }
    this.save();
    this.applyVolumes();
    this.emit();
  }

  /** Other humans in the lobby, whether or not they have a mic on. */
  players(): VoicePlayer[] {
    const s = this.session;
    if (!s?.lobby) return [];
    const now = performance.now();
    return s.lobby.slots
      .filter((x) => x.kind === 'human' && x.slot !== s.slot)
      .map((x) => {
        const r = this.remoteFor(x.slot);
        const p = this.peerPrefs(x.name);
        return {
          slot: x.slot,
          name: x.name,
          color: x.color,
          mic: !!r?.stream && r.mic,
          speaking: !!r?.meter && !p.muted && now - r.meter.loudAt < SPEAK_HOLD_MS,
          vol: p.vol,
          muted: p.muted,
        };
      });
  }

  /** Slots currently talking (including our own, while transmitting). */
  speakingSlots(): Set<number> {
    const out = new Set<number>();
    for (const p of this.players()) if (p.speaking) out.add(p.slot);
    const me = this.session?.slot ?? -1;
    if (me >= 0 && this.transmitting && this.micMeter && performance.now() - this.micMeter.loudAt < SPEAK_HOLD_MS) out.add(me);
    return out;
  }

  private remoteFor(slot: number): Remote | undefined {
    let best: Remote | undefined;
    for (const r of this.remotes.values()) if (r.slot === slot && (!best || (r.stream && !best.stream))) best = r;
    return best;
  }

  private remote(peer: string): Remote {
    let r = this.remotes.get(peer);
    if (!r) {
      r = { peer, slot: -1, mic: true, stream: null, el: null, meter: null };
      this.remotes.set(peer, r);
    }
    return r;
  }

  private onPeerInfo(peer: string, info: VoicePeerInfo) {
    const r = this.remote(peer);
    r.slot = info.slot;
    r.mic = info.mic;
    this.applyVolumes();
    this.emit();
  }

  private onStream(peer: string, stream: MediaStream) {
    const r = this.remote(peer);
    if (r.stream === stream) return;
    this.releaseMedia(r);
    r.stream = stream;
    r.mic = true;
    const el = this.deps.createAudio();
    el.autoplay = true;
    (el as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
    el.srcObject = stream;
    r.el = el;
    this.applyVolumes();
    el.play()?.catch(() => {
      /* autoplay blocked until the next tap/click — resume() retries */
    });
    // Chrome only feeds a remote WebRTC stream into WebAudio once it is attached to a media element
    r.meter = this.makeMeter(stream);
    stream.addEventListener?.('removetrack', () => {
      if (!stream.getAudioTracks().length && r.stream === stream) {
        this.releaseMedia(r);
        this.emit();
      }
    });
    this.ensureTimer();
    this.emit();
  }

  private dropPeer(peer: string, notify = true) {
    const r = this.remotes.get(peer);
    if (!r) return;
    this.releaseMedia(r);
    this.remotes.delete(peer);
    if (notify) this.emit();
  }

  private releaseMedia(r: Remote) {
    if (r.el) {
      r.el.pause();
      r.el.srcObject = null;
      r.el = null;
    }
    this.killMeter(r.meter);
    r.meter = null;
    r.stream = null;
  }

  /** Apply master × voice-chat × per-player levels to every playing element. */
  applyVolumes() {
    const v = this.deps.volumes();
    const names = new Map((this.session?.lobby?.slots ?? []).map((s) => [s.slot, s.name]));
    for (const r of this.remotes.values()) {
      if (!r.el) continue;
      const name = names.get(r.slot);
      const p = name !== undefined ? this.peerPrefs(name) : DEFAULT_PEER;
      r.el.volume = chatElementVolume(v.master, v.chat, p.vol, p.muted);
      r.el.muted = p.muted;
    }
  }

  /** Retry playback that the browser's autoplay policy blocked (call from a user gesture). */
  resume() {
    for (const r of this.remotes.values()) if (r.el?.paused) r.el.play()?.catch(() => {});
  }

  // ------------------------------------------------------------------------------------------
  // level meters (speaking indicators)
  // ------------------------------------------------------------------------------------------

  private makeMeter(stream: MediaStream): Meter | null {
    const ctx = this.deps.audioCtx();
    if (!ctx) return null;
    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser); // analysed only, never routed to the speakers
      return { source, analyser, buf: new Float32Array(analyser.fftSize), level: 0, loudAt: -1e9 };
    } catch {
      return null;
    }
  }

  private killMeter(m: Meter | null) {
    if (!m) return;
    try {
      m.source.disconnect();
    } catch {
      /* ignore */
    }
  }

  private ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 100);
  }

  private tick() {
    const meters = [...this.remotes.values()].map((r) => r.meter).filter((m): m is Meter => !!m);
    if (this.micMeter) meters.push(this.micMeter);
    if (!meters.length) {
      clearInterval(this.timer!);
      this.timer = null;
      return;
    }
    const now = performance.now();
    for (const m of meters) {
      m.analyser.getFloatTimeDomainData(m.buf);
      let sum = 0;
      for (const x of m.buf) sum += x * x;
      const rms = Math.sqrt(sum / m.buf.length);
      m.level = Math.max(rms, m.level * 0.7);
      if (rms > SPEAK_LEVEL) m.loudAt = now;
    }
    const key = [...this.speakingSlots()].join(',');
    if (key !== this.speakKey || this.micMeter) {
      this.speakKey = key;
      this.emit();
    }
  }
}

export const voice = new VoiceChat({ volumes: () => audio.volumes, audioCtx: () => audio.ctx });
audio.onVolumes.add(() => voice.applyVolumes());
