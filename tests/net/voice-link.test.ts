import { describe, expect, it } from 'vitest';
import { roomVoice } from '../../src/net/p2p';
import type { VoicePeerInfo } from '../../src/net/transport';

/** Just enough of a Trystero room to drive the voice link. */
function fakeRoom() {
  const sent: { data: unknown; target?: string }[] = [];
  const added: { stream: unknown; target?: string }[] = [];
  const removed: unknown[] = [];
  const action = {
    send: (data: unknown, o?: { target?: string }) => {
      sent.push({ data, target: o?.target });
      return Promise.resolve();
    },
    onMessage: null as ((d: unknown, ctx: { peerId: string }) => void) | null,
  };
  const room = {
    makeAction: () => action,
    addStream: (stream: unknown, o?: { target?: string }) => {
      added.push({ stream, target: o?.target });
      return [Promise.resolve()];
    },
    removeStream: (s: unknown) => void removed.push(s),
    onPeerStream: null as ((s: unknown, peer: string) => void) | null,
  };
  return { room, action, sent, added, removed };
}

describe('Trystero voice link', () => {
  it('streams the mic to current and late-joining peers and announces the slot', () => {
    const f = fakeRoom();
    const joins = new Set<(p: string) => void>();
    const leaves = new Set<(p: string) => void>();
    const v = roomVoice(f.room as never, joins, leaves);
    const mic = { id: 'mic' } as unknown as MediaStream;

    v.announce(2);
    expect(f.sent.at(-1)).toEqual({ data: { slot: 2, mic: false }, target: undefined });
    v.setStream(mic);
    expect(f.added).toEqual([{ stream: mic, target: undefined }]);
    expect(f.sent.at(-1)!.data).toEqual({ slot: 2, mic: true });

    joins.forEach((j) => j('late'));
    expect(f.added.at(-1)).toEqual({ stream: mic, target: 'late' });
    expect(f.sent.at(-1)).toEqual({ data: { slot: 2, mic: true }, target: 'late' });

    v.setStream(null);
    expect(f.removed).toEqual([mic]);
    expect(f.sent.at(-1)!.data).toEqual({ slot: 2, mic: false });
  });

  it('reports peer streams, slots and departures', () => {
    const f = fakeRoom();
    const leaves = new Set<(p: string) => void>();
    const v = roomVoice(f.room as never, new Set(), leaves);
    const got: unknown[] = [];
    v.onStream = (peer, s) => got.push(['stream', peer, s]);
    v.onPeerInfo = (peer, i: VoicePeerInfo) => got.push(['info', peer, i]);
    v.onPeerGone = (peer) => got.push(['gone', peer]);
    f.room.onPeerStream!('S', 'p1');
    f.action.onMessage!({ slot: 4, mic: true }, { peerId: 'p1' });
    f.action.onMessage!({ junk: true }, { peerId: 'p1' });
    leaves.forEach((l) => l('p1'));
    expect(got).toEqual([
      ['stream', 'p1', 'S'],
      ['info', 'p1', { slot: 4, mic: true }],
      ['gone', 'p1'],
    ]);
  });
});
