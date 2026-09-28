import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUMES } from '../../src/audio/levels';
import { VoiceChat, sanitizeVoicePrefs, type VoiceSession } from '../../src/audio/voice';
import type { SlotInfo } from '../../src/net/protocol';
import type { VoiceLink } from '../../src/net/transport';

class FakeTrack {
  enabled = true;
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  tracks = [new FakeTrack()];
  getAudioTracks() {
    return this.tracks;
  }
  getTracks() {
    return this.tracks;
  }
  addEventListener() {}
}

class FakeAudio {
  volume = 1;
  muted = false;
  paused = true;
  srcObject: unknown = null;
  autoplay = false;
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

function fakeLink() {
  const link: VoiceLink & { streams: (MediaStream | null)[]; slots: number[] } = {
    streams: [],
    slots: [],
    setStream(s) {
      this.streams.push(s);
    },
    announce(slot) {
      this.slots.push(slot);
    },
    onStream: null,
    onPeerInfo: null,
    onPeerGone: null,
  };
  return link;
}

const human = (slot: number, name: string): SlotInfo => ({ slot, name, color: 0xff0000, kind: 'human', connected: true });

function setup(stored: Record<string, string> = {}) {
  const store = new Map(Object.entries(stored));
  const audios: FakeAudio[] = [];
  const volumes = { ...DEFAULT_VOLUMES };
  const vc = new VoiceChat({
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    getUserMedia: async () => new FakeStream() as unknown as MediaStream,
    createAudio: () => {
      const a = new FakeAudio();
      audios.push(a);
      return a as unknown as HTMLAudioElement;
    },
    audioCtx: () => null,
    volumes: () => volumes,
  });
  const session: VoiceSession = { slot: 0, lobby: { slots: [human(0, 'Me'), human(1, 'Ann'), human(2, 'Bob'), { ...human(3, 'Bot'), kind: 'bot' }] } };
  const link = fakeLink();
  vc.attach(link, session);
  return { vc, link, store, audios, volumes, session };
}

describe('voice chat', () => {
  it('announces my slot and lists the other humans', () => {
    const { vc, link } = setup();
    expect(link.slots).toEqual([0]);
    expect(vc.players().map((p) => p.name)).toEqual(['Ann', 'Bob']);
    expect(vc.available).toBe(true);
  });

  it('maps peers to players and applies per-player volume and mute', () => {
    const { vc, link, audios, store } = setup();
    link.onPeerInfo!('peerA', { slot: 1, mic: true });
    link.onStream!('peerA', new FakeStream() as unknown as MediaStream);
    expect(audios).toHaveLength(1);
    expect(audios[0]!.volume).toBeCloseTo(DEFAULT_VOLUMES.master * DEFAULT_VOLUMES.chat);
    expect(vc.players().find((p) => p.name === 'Ann')!.mic).toBe(true);
    expect(vc.players().find((p) => p.name === 'Bob')!.mic).toBe(false);

    vc.setPeerVolume('Ann', 0.5);
    expect(audios[0]!.volume).toBeCloseTo(DEFAULT_VOLUMES.master * 0.5);
    vc.togglePeerMute('Ann');
    expect(audios[0]!.muted).toBe(true);
    expect(audios[0]!.volume).toBe(0);
    // remembered by name for next time
    expect(JSON.parse(store.get('hd.voice')!).peers.Ann).toEqual({ vol: 0.5, muted: true });

    link.onPeerGone!('peerA');
    expect(audios[0]!.srcObject).toBe(null);
    expect(vc.players().find((p) => p.name === 'Ann')!.mic).toBe(false);
  });

  it('follows the voice-chat and master levels', () => {
    const { vc, link, audios, volumes } = setup();
    link.onPeerInfo!('p', { slot: 2, mic: true });
    link.onStream!('p', new FakeStream() as unknown as MediaStream);
    volumes.chat = 0.5;
    volumes.master = 1;
    vc.applyVolumes();
    expect(audios[0]!.volume).toBeCloseTo(0.5);
  });

  it('reset puts every player back to 100% but keeps mutes', () => {
    const { vc } = setup();
    vc.setPeerVolume('Ann', 0.2);
    vc.setPeerVolume('Bob', 0.3);
    vc.setPeerMuted('Bob', true);
    vc.resetPeerVolumes();
    expect(vc.peerPrefs('Ann')).toEqual({ vol: 1, muted: false });
    expect(vc.peerPrefs('Bob')).toEqual({ vol: 1, muted: true });
  });

  it('publishes the mic and handles self-mute and push-to-talk', async () => {
    const { vc, link } = setup();
    expect(vc.micState).toBe('off');
    expect(await vc.enableMic()).toBe(true);
    const track = (vc.micStream as unknown as FakeStream).tracks[0]!;
    expect(link.streams.at(-1)).toBe(vc.micStream);
    expect(vc.micState).toBe('live');
    expect(track.enabled).toBe(true);

    vc.toggleSelfMute();
    expect(vc.micState).toBe('muted');
    expect(track.enabled).toBe(false);
    vc.toggleSelfMute();
    expect(track.enabled).toBe(true);

    vc.setMode('ptt');
    expect(vc.micState).toBe('ptt');
    expect(track.enabled).toBe(false);
    vc.setPtt(true);
    expect(vc.micState).toBe('live');
    expect(track.enabled).toBe(true);
    vc.setPtt(false);
    expect(track.enabled).toBe(false);

    vc.stopMic();
    expect(track.stopped).toBe(true);
    expect(link.streams.at(-1)).toBe(null);
    expect(vc.prefs.micWanted).toBe(false);
  });

  it('explains why the mic could not start', async () => {
    const { vc } = setup();
    (vc.deps as { getUserMedia: unknown }).getUserMedia = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    expect(await vc.enableMic()).toBe(false);
    expect(vc.micState).toBe('error');
    expect(vc.micError).toMatch(/permission/i);
  });

  it('stops the mic and all playback when leaving the game', async () => {
    const { vc, link, audios } = setup();
    await vc.enableMic();
    link.onPeerInfo!('p', { slot: 1, mic: true });
    link.onStream!('p', new FakeStream() as unknown as MediaStream);
    vc.detach();
    expect(vc.available).toBe(false);
    expect(vc.micStream).toBe(null);
    expect(audios[0]!.srcObject).toBe(null);
    expect(link.onStream).toBe(null);
    // it stays "wanted" so it comes back next game
    expect(vc.prefs.micWanted).toBe(true);
  });

  it('sanitizes saved prefs', () => {
    expect(sanitizeVoicePrefs({ mode: 'weird', peers: { A: { vol: 7, muted: 1 }, B: null } })).toEqual({ micWanted: false, mode: 'open', selfMuted: false, peers: { A: { vol: 1, muted: false } } });
  });
});
