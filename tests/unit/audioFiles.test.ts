import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/audio';
import { parseManifest, pickSfx, pickTake, sfxSlots, speakerKey } from '../../src/audio/manifest';

describe('manifest parsing', () => {
  it('reads the original format: plain file names', () => {
    const m = parseManifest({ version: 1, slots: { 'ann.double': { files: ['audio/announcer/double_kill.mp3'], gain: 0.9 } } });
    expect(m?.slots['ann.double']).toEqual({ takes: [{ file: 'audio/announcer/double_kill.mp3' }], gain: 0.9 });
  });

  it('reads recorded takes with who said them, and skips what it does not understand', () => {
    const m = parseManifest({
      version: 1,
      slots: {
        'pitre.prank': { files: [{ file: 'audio/voices/john/pitre.prank_1.mp3', by: 'John' }, 'audio/pitre/x.mp3', { by: 'nobody' }, 42, { file: 'y.mp3', by: ' ' }] },
        broken: { files: 'nope' },
        'sfx.sniper': { files: ['audio/sfx/sniper_1.mp3'], gain: 'loud' },
      },
    });
    expect(m?.slots['pitre.prank']).toEqual({
      takes: [{ file: 'audio/voices/john/pitre.prank_1.mp3', by: 'John' }, { file: 'audio/pitre/x.mp3' }, { file: 'y.mp3' }],
      gain: 1,
    });
    expect(m?.slots.broken).toBeUndefined();
    expect(m?.slots['sfx.sniper']?.gain).toBe(1);
  });

  it('rejects something that is not a manifest', () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest('hello')).toBeNull();
    expect(parseManifest({ version: 1 })).toBeNull();
  });
});

describe('voice takes', () => {
  const takes = [{}, { by: 'John' }, { by: 'john' }, { by: 'Mary' }];
  const seq = (...v: number[]) => () => v.shift() ?? 0;

  it('names match loosely', () => {
    expect(speakerKey(' John ')).toBe('john');
    expect(speakerKey('J.O.H.N.')).toBe('john');
    expect(speakerKey('Jérôme')).toBe('jerome');
    expect(speakerKey('xX_Sn1per_Xx')).toBe('xxsn1perxx');
    expect(speakerKey(undefined)).toBe('');
  });

  it("a player who recorded the line says it in their own voice", () => {
    for (const r of [0, 0.5, 0.999]) expect([1, 2]).toContain(pickTake(takes, 'JOHN', seq(r)));
    expect(pickTake(takes, 'mary!', seq(0.7))).toBe(3);
  });

  it('anyone else, and the announcer, gets a random take', () => {
    expect(pickTake(takes, 'Bob', seq(0))).toBe(0);
    expect(pickTake(takes, 'Bob', seq(0.999))).toBe(3);
    expect(pickTake(takes, undefined, seq(0.5))).toBe(2);
    expect(pickTake(takes, '???', seq(0.3))).toBe(1); // nothing left of the name: no match
    expect(pickTake([], 'John')).toBe(-1);
  });
});

describe('sound effect files', () => {
  it('only `sfx.<id>` slots of sounds the game has, with files, count', () => {
    const m = parseManifest({
      version: 1,
      slots: {
        'sfx.sniper': { files: ['a.mp3', 'b.mp3'], gain: 0.8 },
        'sfx.explosion': { files: [] },
        'sfx.laserSword': { files: ['c.mp3'] },
        'ann.double': { files: ['d.mp3'] },
      },
    });
    expect(sfxSlots(m)).toEqual({ sniper: { takes: [{ file: 'a.mp3' }, { file: 'b.mp3' }], gain: 0.8 } });
    expect(sfxSlots(null)).toEqual({});
  });

  it('real files win over the synthesized sound, several take turns, none falls back', () => {
    expect(pickSfx(['a', 'b'], 'synth', () => 0)).toBe('a');
    expect(pickSfx(['a', 'b'], 'synth', () => 0.99)).toBe('b');
    expect(pickSfx([], 'synth')).toBe('synth');
    expect(pickSfx(undefined, 'synth')).toBe('synth');
    expect(pickSfx(undefined, undefined)).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// The engine itself, on a fake Web Audio context and a fake network
// -------------------------------------------------------------------------------------------------

class Param {
  value = 0;
  setTargetAtTime() {}
}
class Node {
  out: unknown = null;
  connect<T>(n: T): T {
    this.out ??= n;
    return n;
  }
  disconnect() {}
}
class Gain extends Node {
  gain = new Param();
}
class Buf {
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
    public name = 'synth',
  ) {}
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData() {
    return new Float32Array(this.length);
  }
}
const played: { name: string; gain: number; panned: boolean }[] = [];
class Source extends Node {
  buffer: Buf | null = null;
  playbackRate = new Param();
  loop = false;
  onended: (() => void) | null = null;
  start() {
    const g = this.out as Gain;
    played.push({ name: this.buffer!.name, gain: g.gain.value, panned: g.out instanceof Panner });
  }
  stop() {}
}
class Panner extends Node {
  positionX = new Param();
  positionY = new Param();
  positionZ = new Param();
}
class FakeContext {
  sampleRate = 8000;
  currentTime = 0;
  state = 'running';
  destination = new Node();
  listener = {};
  createGain = () => new Gain();
  createDynamicsCompressor = () => Object.assign(new Node(), { threshold: new Param(), ratio: new Param() });
  createConvolver = () => Object.assign(new Node(), { buffer: null });
  createBuffer = (ch: number, n: number, sr: number) => new Buf(ch, n, sr);
  createBufferSource = () => new Source();
  createPanner = () => new Panner();
  resume() {}
  async decodeAudioData(ab: ArrayBuffer) {
    const name = new TextDecoder().decode(ab);
    if (name.includes('corrupt')) throw new Error('EncodingError');
    return new Buf(1, 800, 8000, name);
  }
}

const MANIFEST = {
  version: 1,
  slots: {
    'sfx.sniper': { files: ['audio/sfx/sniper_1.mp3', 'audio/sfx/sniper_2.mp3'], gain: 0.5 },
    'sfx.explosion': { files: ['audio/sfx/explosion_corrupt.mp3'], gain: 1 },
    'sfx.rifle': { files: ['audio/sfx/rifle_404.mp3'], gain: 1 },
    'pitre.prank': { files: [{ file: 'audio/voices/john/pitre.prank_1.mp3', by: 'John' }, 'audio/pitre/prank_em_john_1.mp3'], gain: 1 },
  },
};

function stubBrowser(manifest: unknown = MANIFEST) {
  vi.stubGlobal('window', { AudioContext: FakeContext });
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === 'audio/manifest.json') return { ok: true, json: async () => manifest };
    if (url.includes('404')) return { ok: false };
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer };
  });
}

describe('AudioEngine with sound files', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    played.length = 0;
  });

  it('plays the synthesized sound at once, then the decoded files (3D position kept)', async () => {
    stubBrowser();
    const a = new AudioEngine();
    a.unlock();
    a.play('sniper', { pos: { x: 1, y: 2, z: 3 } });
    expect(played.pop()).toEqual({ name: 'synth', gain: 1, panned: true });
    await a.loadSfxFiles();
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(0.99).mockReturnValueOnce(0.5);
    a.play('sniper', { pos: { x: 1, y: 2, z: 3 }, gain: 0.8 });
    a.play('sniper', { gain: 0.8 });
    expect(played).toEqual([
      { name: 'audio/sfx/sniper_1.mp3', gain: 0.4, panned: true },
      { name: 'audio/sfx/sniper_2.mp3', gain: 0.4, panned: false },
    ]);
  });

  it('keeps the synthesized sound when a file is missing or broken, or not listed', async () => {
    stubBrowser();
    const a = new AudioEngine();
    a.unlock();
    await a.loadSfxFiles();
    a.play('explosion');
    a.play('rifle');
    a.play('ding');
    expect(played.map((p) => p.name)).toEqual(['synth', 'synth', 'synth']);
  });

  it('works with no manifest at all', async () => {
    stubBrowser(null);
    const a = new AudioEngine();
    a.unlock();
    await a.loadSfxFiles();
    a.play('sniper');
    expect(played.map((p) => p.name)).toEqual(['synth']);
  });

  it("prefers the speaker's own recording of a voice line", async () => {
    stubBrowser();
    const a = new AudioEngine();
    a.unlock();
    expect(a.playVoice('pitre.prank', { speaker: 'John' })).toBeNull(); // not decoded yet
    await vi.waitFor(() => expect(a.playVoice('pitre.prank', { speaker: 'john ' })).not.toBeNull());
    played.length = 0;
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    a.playVoice('pitre.prank', { speaker: 'JOHN' });
    a.playVoice('pitre.prank', { speaker: 'Mary' });
    a.playVoice('pitre.prank');
    expect(played.map((p) => p.name)).toEqual(['audio/voices/john/pitre.prank_1.mp3', 'audio/pitre/prank_em_john_1.mp3', 'audio/pitre/prank_em_john_1.mp3']);
  });
});
