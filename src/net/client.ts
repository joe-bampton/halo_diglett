import { angleDiff, clamp } from '../shared/vec';
import { LOWER_TIME, RISE_TIME, TICK_RATE } from '../sim/constants';
import type { MatchPhase, PlayerCommand, RosterEntry, SimEvent } from '../sim/types';
import { weaponByIndex, type WeaponId } from '../sim/weapons';
import {
  BUILD_ID,
  CH_CTL,
  CH_IN,
  CH_SNAP,
  F_ALIVE,
  F_CONNECTED,
  PROTOCOL_VERSION,
  type Channel,
  type CtlMsg,
  type LobbyState,
  type MatchResults,
  type MatchStart,
  type PrivateState,
  type SnapshotMsg,
} from './protocol';
import type { ClientNet } from './transport';

export interface ViewPlayer {
  slot: number;
  name: string;
  color: number;
  kind: 'human' | 'bot';
  hole: number;
  alive: boolean;
  exposure: number;
  yaw: number;
  pitch: number;
  flags: number;
  weapon: WeaponId;
  beamLen: number;
  zoom: number;
  kills: number;
  deaths: number;
  gunLevel: number;
  connected: boolean;
}

export interface ViewOrb {
  id: number;
  type: string;
  seed: number;
  spawn: number;
  expire: number;
}

export interface LocalInput {
  yaw: number;
  pitch: number;
  stand: boolean;
  trigger: boolean;
  presses: number;
  reloads: number;
  respawns: number;
  zoom: number;
  pick?: WeaponId;
}

const TICK_MS = 1000 / TICK_RATE;

export class ClientSession {
  state: 'connecting' | 'lobby' | 'match' | 'results' | 'closed' = 'connecting';
  closeReason = '';
  slot = -1;
  lobby: LobbyState | null = null;
  start: MatchStart | null = null;
  results: MatchResults | null = null;
  roster: RosterEntry[] = [];

  players: (ViewPlayer | null)[] = [];
  me: PrivateState | null = null;
  phase: MatchPhase = 'intro';
  leader = -1;
  orbs = new Map<number, ViewOrb>();
  homing = new Map<number, { x: number; y: number; z: number }>();
  events: SimEvent[] = [];
  latestTick = 0;

  input: LocalInput = { yaw: 0, pitch: 0, stand: false, trigger: false, presses: 0, reloads: 0, respawns: 0, zoom: 0 };
  myExposure = 0;
  /** host tick currently displayed for remote players */
  renderTick = 0;
  /** best estimate of the host's current tick */
  hostTick = 0;
  interpDelay = 1;
  rttMs = 0;

  onLobby: (() => void) | null = null;
  onStart: (() => void) | null = null;
  onResults: (() => void) | null = null;
  onClosed: (() => void) | null = null;
  onToLobby: (() => void) | null = null;

  private snaps: SnapshotMsg[] = [];
  private offset = NaN;
  private jitter = 0;
  private seq = 0;
  private lastSend = 0;
  private lastKey = '';
  private lastUpdate = -1;
  private readonly local: boolean;
  /** injectable clock (tests) */
  clock: () => number = () => performance.now();

  constructor(
    private net: ClientNet,
    private hello: { name: string; color: number; token: string },
  ) {
    this.local = net.kind === 'loopback';
    net.onMessage = (ch, data) => this.onMessage(ch, data);
    net.onClose = (reason) => this.close(reason);
  }

  private close(reason: string) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.closeReason = reason;
    try {
      this.net.close();
    } catch {
      /* already closed */
    }
    this.onClosed?.();
  }

  leave() {
    try {
      this.net.send(CH_CTL, { t: 'bye' } satisfies CtlMsg);
    } catch {
      /* ignore */
    }
    this.close('left');
  }

  sendMe(msg: { name?: string; color?: number; pick?: WeaponId }) {
    this.net.send(CH_CTL, { t: 'me', ...msg } satisfies CtlMsg);
  }

  private onMessage(ch: Channel, data: unknown) {
    if (!data || typeof data !== 'object') return;
    if (ch === CH_CTL) this.onCtl(data as CtlMsg);
    else if (ch === CH_SNAP) this.onSnap(data as SnapshotMsg);
  }

  private onCtl(msg: CtlMsg) {
    switch (msg.t) {
      case 'host':
        this.net.send(CH_CTL, { t: 'hello', proto: PROTOCOL_VERSION, build: BUILD_ID, token: this.hello.token, name: this.hello.name, color: this.hello.color } satisfies CtlMsg);
        break;
      case 'welcome':
        this.slot = msg.slot;
        this.lobby = msg.lobby;
        if (this.state === 'connecting') this.state = msg.lobby.phase === 'results' ? 'results' : 'lobby';
        this.onLobby?.();
        break;
      case 'reject':
        this.close(msg.reason === 'full' ? 'That game is full (7 players max).' : msg.reason === 'version' ? 'Your game version is different from the host’s — refresh the page.' : msg.reason === 'kicked' ? 'The host removed you from the lobby.' : 'Could not join.');
        break;
      case 'lobby':
        this.lobby = msg.lobby;
        this.onLobby?.();
        break;
      case 'start':
        this.beginMatch(msg.start);
        break;
      case 'results':
        this.results = msg.results;
        this.state = 'results';
        this.onResults?.();
        break;
      case 'toLobby':
        this.state = 'lobby';
        this.results = null;
        this.start = null;
        this.onToLobby?.();
        break;
      case 'bye':
        this.close('The host ended the game.');
        break;
    }
  }

  private beginMatch(start: MatchStart) {
    this.start = start;
    this.roster = start.roster;
    this.phase = start.phase;
    this.leader = start.leader;
    this.results = null;
    this.snaps = [];
    this.events = [];
    this.offset = NaN;
    this.jitter = 0;
    this.me = null;
    this.myExposure = 0;
    this.orbs.clear();
    for (const o of start.orbs) this.orbs.set(o.id, o);
    this.homing.clear();
    this.players = [];
    for (const r of start.roster) this.players[r.slot] = this.blankPlayer(r);
    this.latestTick = start.tick;
    this.hostTick = start.tick;
    this.renderTick = start.tick;
    this.state = 'match';
    this.onStart?.();
  }

  private blankPlayer(r: RosterEntry): ViewPlayer {
    return { slot: r.slot, name: r.name, color: r.color, kind: r.kind, hole: 0, alive: false, exposure: 0, yaw: 0, pitch: 0, flags: 0, weapon: 'sniper', beamLen: 0, zoom: 0, kills: 0, deaths: 0, gunLevel: 0, connected: true };
  }

  private onSnap(s: SnapshotMsg) {
    if (this.state !== 'match' && this.state !== 'results') return;
    if (typeof s.k !== 'number') return;
    const now = this.clock();
    const sample = s.k - now / TICK_MS;
    if (Number.isNaN(this.offset)) this.offset = sample;
    else {
      const dev = sample - this.offset;
      this.jitter = this.jitter * 0.9 + Math.abs(dev) * 0.1;
      // follow faster when snapshots arrive "early" (lower latency)
      this.offset += dev * (dev > 0 ? 0.25 : 0.05);
    }
    this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.shift();
    this.latestTick = Math.max(this.latestTick, s.k);
    this.phase = s.ph;
    this.leader = s.ld;
    if (s.me) {
      const prevAlive = this.me?.al;
      this.me = s.me;
      if (!s.me.al || prevAlive === false) {
        if (!s.me.al) this.myExposure = 0;
      }
    }
    if (s.sb) {
      for (const [slot, k, d, g] of s.sb) {
        const p = this.players[slot];
        if (p) {
          p.kills = k;
          p.deaths = d;
          p.gunLevel = g;
        }
      }
    }
    if (s.h) {
      this.homing.clear();
      for (const [id, x, y, z] of s.h) this.homing.set(id, { x, y, z });
    } else this.homing.clear();
    if (s.e) {
      for (const e of s.e) {
        if (e.k === 'orb') this.orbs.set(e.id, { id: e.id, type: e.type, seed: e.seed, spawn: e.spawn, expire: e.expire });
        else if (e.k === 'orbPop') this.orbs.delete(e.id);
        else if (e.k === 'spawn' && e.p === this.slot) this.myExposure = 0;
        this.events.push(e);
      }
    }
    // players present in the snapshot but not in roster (late joiners)
    for (const pp of s.p) {
      if (!this.players[pp[0]]) {
        const r = this.lobby?.slots.find((x) => x.slot === pp[0]);
        this.players[pp[0]] = this.blankPlayer(r ? { slot: r.slot, name: r.name, color: r.color, kind: r.kind } : { slot: pp[0], name: `Spartan ${pp[0] + 1}`, color: 0x888888, kind: 'human' });
      }
    }
    // drop players no longer present
    const present = new Set(s.p.map((pp) => pp[0]));
    for (let i = 0; i < this.players.length; i++) if (this.players[i] && !present.has(i)) this.players[i] = null;
    if (this.lobby) {
      for (const sl of this.lobby.slots) {
        const p = this.players[sl.slot];
        if (p) {
          p.name = sl.name;
          p.color = sl.color;
        }
      }
    }
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Per-frame: advance clocks, interpolate, predict own stance, send input. */
  update(now: number) {
    const dt = this.lastUpdate < 0 ? 0 : Math.min(0.1, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;
    if (this.state !== 'match' && this.state !== 'results') return;
    if (!Number.isNaN(this.offset)) {
      this.hostTick = Math.min(now / TICK_MS + this.offset, this.latestTick + 6);
      this.interpDelay = this.local ? 1 : clamp(3 + 2.5 * this.jitter + 1, 4, 12);
      this.renderTick = Math.min(this.hostTick - this.interpDelay, this.latestTick);
      this.interpolate(this.renderTick);
    }
    // own stance prediction
    const me = this.me;
    if (me && me.al) {
      const forced = me.fs > this.hostTick;
      const want = (this.input.stand || forced) && this.phase !== 'ended';
      this.myExposure = want ? Math.min(1, this.myExposure + dt / RISE_TIME) : Math.max(0, this.myExposure - dt / LOWER_TIME);
    } else this.myExposure = 0;
    const mine = this.players[this.slot];
    if (mine) {
      mine.exposure = this.myExposure;
      mine.yaw = this.input.yaw;
      mine.pitch = this.input.pitch;
    }
    this.maybeSendInput(now);
  }

  private interpolate(rt: number) {
    const snaps = this.snaps;
    if (!snaps.length) return;
    let a = snaps[0]!;
    let b = snaps[snaps.length - 1]!;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i]!.k <= rt) {
        a = snaps[i]!;
        b = snaps[i + 1] ?? snaps[i]!;
        break;
      }
    }
    const span = b.k - a.k;
    const f = span > 0 ? clamp((rt - a.k) / span, 0, 1) : 0;
    const bmap = new Map(b.p.map((pp) => [pp[0], pp]));
    for (const pa of a.p) {
      const pb = bmap.get(pa[0]) ?? pa;
      const v = this.players[pa[0]];
      if (!v || pa[0] === this.slot) {
        if (v && pa[0] === this.slot) {
          v.hole = pb[6];
          v.flags = pb[4];
          v.alive = (pb[4] & F_ALIVE) !== 0;
          v.weapon = weaponByIndex(pb[5]);
          v.beamLen = pb[7] / 10;
        }
        continue;
      }
      // a hole change or respawn means no interpolation across it
      const jump = pa[6] !== pb[6] || (pa[4] & F_ALIVE) !== (pb[4] & F_ALIVE);
      const ff = jump ? 1 : f;
      v.exposure = (pa[1] + (pb[1] - pa[1]) * ff) / 255;
      const ya = pa[2] / 1000, yb = pb[2] / 1000;
      v.yaw = ya + angleDiff(yb, ya) * ff;
      v.pitch = (pa[3] + (pb[3] - pa[3]) * ff) / 1000;
      v.flags = pb[4];
      v.alive = (pb[4] & F_ALIVE) !== 0;
      v.connected = (pb[4] & F_CONNECTED) !== 0;
      v.weapon = weaponByIndex(pb[5]);
      v.hole = pb[6];
      v.beamLen = pb[7] / 10;
      v.zoom = pb[8];
    }
  }

  private maybeSendInput(now: number) {
    if (this.state !== 'match') return;
    const i = this.input;
    const key = `${i.stand}|${i.trigger}|${i.presses}|${i.reloads}|${i.respawns}|${i.zoom}|${i.pick ?? ''}`;
    const edge = key !== this.lastKey;
    const interval = this.local ? 0 : 1000 / 30;
    if (!edge && now - this.lastSend < interval) return;
    this.lastKey = key;
    this.lastSend = now;
    const c: PlayerCommand = {
      yaw: Math.round(i.yaw * 10000) / 10000,
      pitch: Math.round(i.pitch * 10000) / 10000,
      stand: i.stand,
      trigger: i.trigger,
      presses: i.presses,
      reloads: i.reloads,
      respawns: i.respawns,
      zoom: i.zoom,
      vt: Math.round(this.renderTick * 100) / 100,
      pick: i.pick,
    };
    this.net.send(CH_IN, { s: ++this.seq, c });
  }

  /** Force-send input now (called right after a trigger press so the shot is not delayed). */
  flushInput() {
    this.lastKey = '';
    this.maybeSendInput(this.clock());
  }

  get isLocal() {
    return this.local;
  }
}
