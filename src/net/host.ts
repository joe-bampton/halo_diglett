import { BotBrain, BOT_NAMES } from '../bots/brain';
import { Rng } from '../shared/rng';
import { Arena } from '../sim/arena';
import { MAX_BOTS, MAX_HUMANS, MAX_SLOTS, TICK_RATE, secToTicks } from '../sim/constants';
import { addPlayer, clipSize, createMatch, hasPowerup, isCamo, removePlayer, score, stepMatch, type StepContext } from '../sim/match';
import { sanitizeSettings, DEFAULT_SETTINGS, type Settings } from '../sim/settings';
import type { BotDifficulty, MatchState, PlayerCommand, PlayerState, RosterEntry, SimEvent } from '../sim/types';
import { WEAPONS, weaponIndex } from '../sim/weapons';
import {
  BUILD_ID,
  CH_CTL,
  CH_IN,
  CH_SNAP,
  F_ALIVE,
  F_BEAM,
  F_BURNING,
  F_CAMO,
  F_CHARGING,
  F_CONNECTED,
  F_DAMAGE,
  F_INVINCIBLE,
  F_OVERSHIELD,
  F_RELOAD,
  PROTOCOL_VERSION,
  type Channel,
  type CtlMsg,
  type InputMsg,
  type LobbyState,
  type MatchResults,
  type MatchStart,
  type PackedPlayer,
  type PrivateState,
  type SlotInfo,
  type SnapshotMsg,
} from './protocol';
import type { HostNet } from './transport';

export const PLAYER_COLORS = [0x3d7bff, 0xe23b3b, 0x2fbf4a, 0xf2c230, 0xa24dff, 0xff8a1f, 0x19c8d0, 0xff5fb0, 0x8a6a3a, 0xe6e6e6, 0x5a6b2a, 0x1b2a6b, 0x6b1b2a];

interface Conn {
  peer: string;
  slot: number;
  token: string;
  local: boolean;
  seq: number;
  cmd: PlayerCommand | undefined;
  pending: SimEvent[];
  sending: boolean;
  lastSnapTick: number;
  lastSb: number;
  lastInputAt: number;
}

interface HeldSlot {
  slot: number;
  token: string;
  until: number; // ms timestamp
}

const REJOIN_MS = 120_000;
const AFK_MS = 5000;

export class HostSession {
  readonly arena = new Arena();
  lobby: LobbyState;
  match: MatchState | null = null;
  results: MatchResults | null = null;
  onChange: (() => void) | null = null;
  private conns = new Map<string, Conn>();
  private tokens = new Map<string, number>(); // token → slot
  private held: HeldSlot[] = [];
  private bots = new Map<number, BotBrain>();
  private acc = 0;
  private last = -1;
  private resultsAt = 0;
  private lastPing = 0;
  private rng = new Rng((Math.random() * 2 ** 31) | 0);
  timescale = 1;
  paused = false;
  /** injectable clock (tests) */
  clock: () => number = () => performance.now();

  constructor(private net: HostNet, code: string, online: boolean, settings: Settings = DEFAULT_SETTINGS) {
    this.lobby = { code, phase: 'lobby', settings: sanitizeSettings(settings), slots: [], online };
    net.onJoin = (peer) => this.onJoin(peer);
    net.onLeave = (peer) => this.onLeave(peer);
    net.onMessage = (peer, ch, data) => this.onMessage(peer, ch, data);
  }

  // ------------------------------------------------------------------------------------------
  // Lobby management
  // ------------------------------------------------------------------------------------------

  private freeSlot(): number {
    for (let i = 0; i < MAX_SLOTS; i++) if (!this.lobby.slots.some((s) => s.slot === i) && !this.held.some((h) => h.slot === i)) return i;
    return -1;
  }

  private humans() {
    return this.lobby.slots.filter((s) => s.kind === 'human');
  }

  private bumpLobby() {
    this.lobby.slots.sort((a, b) => a.slot - b.slot);
    for (const c of this.conns.values()) this.send(c.peer, CH_CTL, { t: 'lobby', lobby: this.lobby });
    this.onChange?.();
  }

  setSettings(s: Settings) {
    this.lobby.settings = sanitizeSettings(s);
    this.bumpLobby();
  }

  addBot(difficulty: BotDifficulty = 'normal') {
    if (this.lobby.slots.filter((s) => s.kind === 'bot').length >= MAX_BOTS) return;
    const slot = this.freeSlot();
    if (slot < 0) return;
    const used = new Set(this.lobby.slots.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${slot}`;
    const info: SlotInfo = { slot, name, color: this.pickColor(), kind: 'bot', bot: difficulty, connected: true };
    this.lobby.slots.push(info);
    if (this.match) {
      addPlayer(this.match, this.rosterEntry(info), this.arena);
      this.bots.set(slot, new BotBrain(slot, difficulty, this.match.seed));
    }
    this.bumpLobby();
  }

  setBotDifficulty(slot: number, d: BotDifficulty) {
    const s = this.lobby.slots.find((x) => x.slot === slot && x.kind === 'bot');
    if (!s) return;
    s.bot = d;
    if (this.match) this.bots.set(slot, new BotBrain(slot, d, this.match.seed + slot));
    this.bumpLobby();
  }

  removeSlot(slot: number) {
    const s = this.lobby.slots.find((x) => x.slot === slot);
    if (!s || s.isHost) return;
    if (s.kind === 'human') {
      const c = [...this.conns.values()].find((x) => x.slot === slot);
      if (c) {
        this.send(c.peer, CH_CTL, { t: 'reject', reason: 'kicked' });
        this.conns.delete(c.peer);
        this.tokens.delete(c.token);
      }
    }
    this.lobby.slots = this.lobby.slots.filter((x) => x.slot !== slot);
    this.held = this.held.filter((h) => h.slot !== slot);
    for (const [tok, sl] of this.tokens) if (sl === slot) this.tokens.delete(tok);
    this.bots.delete(slot);
    if (this.match) removePlayer(this.match, slot);
    this.bumpLobby();
  }

  private pickColor(): number {
    const used = new Set(this.lobby.slots.map((s) => s.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[this.lobby.slots.length % PLAYER_COLORS.length]!;
  }

  private rosterEntry(s: SlotInfo): RosterEntry {
    return { slot: s.slot, name: s.name, color: s.color, kind: s.kind, bot: s.bot };
  }

  // ------------------------------------------------------------------------------------------
  // Networking
  // ------------------------------------------------------------------------------------------

  private send(peer: string, ch: Channel, data: unknown) {
    try {
      return this.net.send(peer, ch, data);
    } catch (e) {
      console.warn('send failed', e);
    }
  }

  private onJoin(peer: string) {
    // tell the newcomer who the host is; they reply with hello
    this.send(peer, CH_CTL, { t: 'host' } satisfies CtlMsg);
  }

  private onLeave(peer: string) {
    const c = this.conns.get(peer);
    if (!c) return;
    this.conns.delete(peer);
    // a stale leave for a connection the player already replaced (rejoin, network switch)
    if ([...this.conns.values()].some((o) => o.slot === c.slot)) return;
    const info = this.lobby.slots.find((s) => s.slot === c.slot);
    if (!info) return;
    if (this.lobby.phase === 'lobby') {
      this.lobby.slots = this.lobby.slots.filter((s) => s.slot !== c.slot);
      this.tokens.delete(c.token);
    } else {
      info.connected = false;
      this.held.push({ slot: c.slot, token: c.token, until: this.clock() + REJOIN_MS });
      const p = this.match?.players[c.slot];
      if (p) p.connected = false;
    }
    this.bumpLobby();
  }

  private onMessage(peer: string, ch: Channel, data: unknown) {
    if (!data || typeof data !== 'object') return;
    if (ch === CH_CTL) this.onCtl(peer, data as CtlMsg);
    else if (ch === CH_IN) this.onInput(peer, data as InputMsg);
  }

  private onCtl(peer: string, msg: CtlMsg) {
    switch (msg.t) {
      case 'hello':
        return this.onHello(peer, msg);
      case 'me': {
        const c = this.conns.get(peer);
        const s = c && this.lobby.slots.find((x) => x.slot === c.slot);
        if (!s) return;
        if (typeof msg.name === 'string') s.name = cleanName(msg.name) || s.name;
        if (typeof msg.color === 'number' && Number.isFinite(msg.color)) s.color = msg.color & 0xffffff;
        if (msg.pick && WEAPONS[msg.pick] && !WEAPONS[msg.pick].powerupOnly) s.pick = msg.pick;
        const p = this.match?.players[s.slot];
        if (p) {
          p.name = s.name;
          p.color = s.color;
          if (s.pick) p.pick = s.pick;
        }
        this.bumpLobby();
        return;
      }
      case 'bye':
        return this.onLeave(peer);
    }
  }

  private onHello(peer: string, msg: Extract<CtlMsg, { t: 'hello' }>) {
    if (msg.proto !== PROTOCOL_VERSION || (msg.build !== BUILD_ID && BUILD_ID !== 'dev' && msg.build !== 'dev')) {
      this.send(peer, CH_CTL, { t: 'reject', reason: 'version' });
      return;
    }
    if (this.conns.has(peer)) return;
    const token = String(msg.token).slice(0, 64);
    const local = peer === 'local';
    let slot = -1;
    // rejoin?
    const held = this.held.find((h) => h.token === token);
    if (held) {
      slot = held.slot;
      this.held = this.held.filter((h) => h !== held);
    } else if (this.tokens.has(token) && this.lobby.slots.some((s) => s.slot === this.tokens.get(token))) {
      slot = this.tokens.get(token)!;
    }
    let info = slot >= 0 ? this.lobby.slots.find((s) => s.slot === slot) : undefined;
    if (!info) {
      if (this.humans().length >= MAX_HUMANS) {
        // replace a bot if the lobby is full of them? keep it simple: refuse
        this.send(peer, CH_CTL, { t: 'reject', reason: 'full' });
        return;
      }
      slot = this.freeSlot();
      if (slot < 0) {
        // kick the last bot to make room
        const bot = [...this.lobby.slots].reverse().find((s) => s.kind === 'bot');
        if (!bot) {
          this.send(peer, CH_CTL, { t: 'reject', reason: 'full' });
          return;
        }
        this.removeSlot(bot.slot);
        slot = this.freeSlot();
      }
      info = { slot, name: cleanName(msg.name) || `Spartan ${slot + 1}`, color: typeof msg.color === 'number' ? msg.color & 0xffffff : this.pickColor(), kind: 'human', connected: true, isHost: local };
      if (this.lobby.slots.some((s) => s.color === info!.color)) info.color = this.pickColor();
      this.lobby.slots.push(info);
    }
    info.connected = true;
    this.tokens.set(token, slot);
    // replace any older connection that still claims this slot (same token rejoining)
    for (const [p, o] of this.conns) if (o.slot === slot) this.conns.delete(p);
    const conn: Conn = { peer, slot, token, local, seq: 0, cmd: undefined, pending: [], sending: false, lastSnapTick: -1, lastSb: -9999, lastInputAt: this.clock() };
    this.conns.set(peer, conn);
    this.send(peer, CH_CTL, { t: 'welcome', slot, lobby: this.lobby });
    if (this.match && this.lobby.phase === 'match') {
      let p = this.match.players[slot];
      if (!p) p = addPlayer(this.match, this.rosterEntry(info), this.arena);
      p.connected = true;
      this.send(peer, CH_CTL, { t: 'start', start: this.matchStart() });
    } else if (this.lobby.phase === 'results' && this.results) {
      this.send(peer, CH_CTL, { t: 'results', results: this.results });
    }
    this.bumpLobby();
  }

  private onInput(peer: string, msg: InputMsg) {
    const c = this.conns.get(peer);
    if (!c || typeof msg.s !== 'number' || msg.s <= c.seq) return;
    const k = msg.c;
    if (!k || typeof k !== 'object') return;
    c.seq = msg.s;
    c.lastInputAt = this.clock();
    c.cmd = {
      yaw: num(k.yaw),
      pitch: num(k.pitch),
      stand: !!k.stand,
      trigger: !!k.trigger,
      presses: num(k.presses) | 0,
      reloads: num(k.reloads) | 0,
      respawns: num(k.respawns) | 0,
      zoom: num(k.zoom) | 0,
      vt: num(k.vt),
      pick: typeof k.pick === 'string' && k.pick in WEAPONS ? k.pick : undefined,
    };
  }

  // ------------------------------------------------------------------------------------------
  // Match
  // ------------------------------------------------------------------------------------------

  startMatch(seed = this.rng.int(1, 2 ** 30)) {
    const roster = this.lobby.slots.filter((s) => s.connected).map((s) => this.rosterEntry(s));
    this.match = createMatch(this.lobby.settings, roster, seed, this.arena);
    for (const s of this.lobby.slots) {
      const p = this.match.players[s.slot];
      if (p && s.pick) p.pick = s.pick;
    }
    this.bots.clear();
    for (const s of this.lobby.slots) if (s.kind === 'bot') this.bots.set(s.slot, new BotBrain(s.slot, s.bot ?? 'normal', seed + s.slot));
    for (const c of this.conns.values()) {
      c.pending = [];
      c.lastSnapTick = -1;
      c.lastSb = -9999;
      c.cmd = undefined;
    }
    this.results = null;
    this.resultsAt = 0;
    this.lobby.phase = 'match';
    this.acc = 0;
    this.last = -1;
    const start = this.matchStart();
    for (const c of this.conns.values()) this.send(c.peer, CH_CTL, { t: 'start', start });
    this.bumpLobby();
  }

  private matchStart(): MatchStart {
    const m = this.match!;
    return {
      settings: m.settings,
      roster: m.players.filter((p): p is PlayerState => !!p).map((p) => ({ slot: p.slot, name: p.name, color: p.color, kind: p.kind, bot: p.bot })),
      seed: m.seed,
      tick: m.tick,
      liveAt: m.liveAt,
      phase: m.phase,
      leader: m.leader,
      orbs: m.orbs.map((o) => ({ ...o })),
    };
  }

  backToLobby() {
    this.match = null;
    this.results = null;
    this.lobby.phase = 'lobby';
    // drop players who never came back (and forget their rejoin tokens)
    const gone = new Set(this.lobby.slots.filter((s) => !s.connected).map((s) => s.slot));
    this.lobby.slots = this.lobby.slots.filter((s) => s.connected);
    for (const [tok, slot] of this.tokens) if (gone.has(slot)) this.tokens.delete(tok);
    this.held = [];
    for (const c of this.conns.values()) this.send(c.peer, CH_CTL, { t: 'toLobby' });
    this.bumpLobby();
  }

  /** Advance the simulation by real time. Call every animation frame (or from a worker metronome). */
  update(nowMs: number) {
    if (this.last < 0) this.last = nowMs;
    let dt = (nowMs - this.last) / 1000;
    this.last = nowMs;
    if (dt > 0.25) dt = 0.25;
    if (this.paused) return;
    this.expireHeld(nowMs);
    if (!this.match) return;
    this.acc += dt * this.timescale;
    let steps = 0;
    const maxSteps = Math.max(10, Math.ceil(this.timescale * 4));
    while (this.acc >= 1 / TICK_RATE && steps < maxSteps) {
      this.acc -= 1 / TICK_RATE;
      this.tickOnce(nowMs);
      steps++;
    }
    if (steps >= maxSteps) this.acc = 0;
    if (nowMs - this.lastPing > 2000) {
      this.lastPing = nowMs;
      this.pingAll();
    }
  }

  private tickOnce(nowMs: number) {
    const m = this.match!;
    const cmds: (PlayerCommand | undefined)[] = new Array(MAX_SLOTS);
    for (const c of this.conns.values()) {
      if (!c.cmd) continue;
      // AFK safety: a silent remote player ducks (keeps their aim)
      const afk = !c.local && nowMs - c.lastInputAt > AFK_MS;
      cmds[c.slot] = afk ? { ...c.cmd, stand: false, trigger: false } : c.cmd;
    }
    for (const s of this.lobby.slots) {
      const p = m.players[s.slot];
      if (s.kind === 'human' && !s.connected && p) cmds[s.slot] = { yaw: p.yaw, pitch: p.pitch, stand: false, trigger: false, presses: p.presses, reloads: p.reloads, respawns: p.respawns, zoom: 0, vt: m.tick };
    }
    for (const [slot, b] of this.bots) if (m.players[slot]) cmds[slot] = b.think(m, this.arena);
    const events = stepMatch(m, cmds, this.arena);
    if (events.length) {
      for (const b of this.bots.values()) b.onEvents(events);
      for (const c of this.conns.values()) c.pending.push(...events);
      if (events.some((e) => e.k === 'end')) this.resultsAt = nowMs + 3500;
    }
    for (const c of this.conns.values()) {
      const every = c.local ? 1 : 3;
      if (m.tick - c.lastSnapTick >= every) this.sendSnapshot(c);
    }
    if (this.resultsAt && nowMs >= this.resultsAt && this.lobby.phase === 'match') {
      this.resultsAt = 0;
      this.results = this.buildResults();
      this.lobby.phase = 'results';
      for (const c of this.conns.values()) {
        this.flushSnapshot(c);
        this.send(c.peer, CH_CTL, { t: 'results', results: this.results });
      }
      this.bumpLobby();
    }
  }

  /** Test hook: change the running match between ticks and send out the events it produced. */
  debugApply(fn: (m: MatchState, ctx: StepContext) => void) {
    const m = this.match;
    if (!m) return;
    const rng = new Rng(m.rng);
    const events: SimEvent[] = [];
    fn(m, { arena: this.arena, rng, events });
    m.rng = rng.state;
    if (!events.length) return;
    for (const b of this.bots.values()) b.onEvents(events);
    for (const c of this.conns.values()) c.pending.push(...events);
  }

  private flushSnapshot(c: Conn) {
    c.sending = false;
    this.sendSnapshot(c);
  }

  private sendSnapshot(c: Conn) {
    const m = this.match!;
    if (c.sending) return; // backpressure: previous send still in flight, events carry over
    c.lastSnapTick = m.tick;
    const snap = this.buildSnapshot(c);
    c.pending = [];
    const r = this.send(c.peer, CH_SNAP, snap);
    if (r && typeof (r as Promise<void>).then === 'function') {
      c.sending = true;
      (r as Promise<void>).then(
        () => (c.sending = false),
        () => (c.sending = false),
      );
    }
  }

  private buildSnapshot(c: Conn): SnapshotMsg {
    const m = this.match!;
    const t = m.tick;
    const p: PackedPlayer[] = [];
    for (const q of m.players) {
      if (!q) continue;
      let f = 0;
      if (q.alive) f |= F_ALIVE;
      if (q.reloadUntil > t) f |= F_RELOAD;
      if (isCamo(m, q)) f |= F_CAMO;
      if (q.overshield > 0) f |= F_OVERSHIELD;
      if (hasPowerup(q, 'invincible', t)) f |= F_INVINCIBLE;
      if (q.chargeStart >= 0) f |= F_CHARGING;
      if (q.beamUntil > t) f |= F_BEAM;
      if (q.connected) f |= F_CONNECTED;
      if (hasPowerup(q, 'damage', t)) f |= F_DAMAGE;
      if (q.burn) f |= F_BURNING;
      p.push([q.slot, Math.round(q.exposure * 255), Math.round(q.yaw * 1000), Math.round(q.pitch * 1000), f, weaponIndex(q.weapon), q.hole, Math.round(q.beamLen * 10), q.zoom]);
    }
    const snap: SnapshotMsg = { k: t, ph: m.phase, a: c.seq, p, ld: m.leader };
    const homing = m.projectiles.filter((pr) => pr.target >= 0);
    if (homing.length) snap.h = homing.map((pr) => [pr.id, round2(pr.x), round2(pr.y), round2(pr.z)]);
    if (c.pending.length) snap.e = c.pending;
    const me = m.players[c.slot];
    if (me) snap.me = privateState(m, me);
    if (t - c.lastSb >= 30 || c.pending.some((e) => e.k === 'kill' || e.k === 'end')) {
      c.lastSb = t;
      snap.sb = m.players.filter((q): q is PlayerState => !!q).map((q) => [q.slot, q.kills, q.deaths, q.gunLevel]);
    }
    return snap;
  }

  private buildResults(): MatchResults {
    const m = this.match!;
    const rows = m.players
      .filter((p): p is PlayerState => !!p)
      .map((p) => ({
        slot: p.slot,
        name: p.name,
        color: p.color,
        kind: p.kind,
        kills: p.kills,
        deaths: p.deaths,
        score: score(m, p),
        headshots: p.headshots,
        accuracy: p.shots ? Math.round((p.hits / p.shots) * 100) : 0,
        bestStreak: p.bestStreak,
        medals: p.medals,
      }))
      .sort((a, b) => b.score - a.score || a.deaths - b.deaths);
    return { winner: m.winner, rows, durationSec: Math.round((m.tick - m.liveAt) / TICK_RATE) };
  }

  private expireHeld(now: number) {
    if (!this.held.length) return;
    const gone = this.held.filter((h) => now > h.until);
    if (!gone.length) return;
    this.held = this.held.filter((h) => now <= h.until);
    for (const h of gone) {
      this.lobby.slots = this.lobby.slots.filter((s) => s.slot !== h.slot);
      this.tokens.delete(h.token);
      if (this.match) removePlayer(this.match, h.slot);
    }
    this.bumpLobby();
  }

  private pingAll() {
    if (!this.net.ping) return;
    for (const c of this.conns.values()) {
      if (c.local) continue;
      this.net.ping(c.peer).then(
        (ms) => {
          const s = this.lobby.slots.find((x) => x.slot === c.slot);
          if (s) s.ping = Math.round(ms);
        },
        () => {},
      );
    }
  }

  close() {
    for (const c of this.conns.values()) this.send(c.peer, CH_CTL, { t: 'bye' });
    this.net.close();
  }

  get humanCount() {
    return this.humans().length;
  }
}

export function privateState(m: MatchState, me: PlayerState): PrivateState {
  return {
    sh: round2(me.shield),
    shm: me.shieldMax,
    hp: round2(me.health),
    hpm: me.healthMax,
    os: round2(me.overshield),
    clip: me.clip,
    rl: me.reloadUntil > m.tick ? me.reloadUntil : 0,
    rs: me.reloadUntil > m.tick ? me.reloadUntil - Math.max(1, secToTicks(WEAPONS[me.weapon].reload * m.settings.reloadMult * (hasPowerup(me, 'quickhands', m.tick) ? 1 / 3 : 1))) : 0,
    w: weaponIndex(me.weapon),
    wu: me.weaponUntil,
    pu: me.powerups.map((x) => [x.id, x.until]),
    fs: me.forcedStandUntil,
    ra: me.alive ? 0 : me.respawnAt,
    ud: me.underdogUntil,
    cs: me.chargeStart,
    bu: me.beamUntil,
    nf: me.nextFireAt,
    gl: me.gunLevel,
    ds: me.duckedSince,
    al: me.alive,
    hole: me.hole,
    rq: me.respawnRequested,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function cleanName(s: unknown): string {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) : '';
}

export { clipSize };
