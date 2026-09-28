import { audio } from '../audio/audio';
import { BOT_PROFILES } from '../bots/brain';
import { loadOptions, saveOptions, type Options } from '../input/input';
import { ClientSession } from '../net/client';
import { HostSession, PLAYER_COLORS, cleanName } from '../net/host';
import { bcClient, bcHost, cleanCode, makeRoomCode, trysteroClient, trysteroHost } from '../net/p2p';
import type { LobbyState } from '../net/protocol';
import { MuxHostNet, loopbackPair, type ClientNet, type HostNet } from '../net/transport';
import { Game } from '../render/game';
import { QUALITY, detectQuality, type QualityLevel } from '../render/quality';
import { MAX_BOTS, MAX_HUMANS } from '../sim/constants';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../sim/settings';
import type { BotDifficulty } from '../sim/types';
import { LOADOUT_WEAPONS, WEAPONS, type WeaponId } from '../sim/weapons';
import { esc, hex, toast } from '../ui/dom';
import { MEDALS } from '../ui/hud';
import { renderSettings } from '../ui/settingsForm';

interface Profile {
  name: string;
  color: number;
}

function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem('hd.profile') ?? 'null') as Profile | null;
    if (p && typeof p.name === 'string') return { name: cleanName(p.name) || 'Spartan', color: p.color ?? PLAYER_COLORS[0]! };
  } catch {
    /* ignore */
  }
  return { name: `Spartan-${Math.floor(100 + Math.random() * 900)}`, color: PLAYER_COLORS[0]! };
}

function saveProfile(p: Profile) {
  try {
    localStorage.setItem('hd.profile', JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function token(): string {
  try {
    let t = sessionStorage.getItem('hd.token');
    if (!t) {
      t = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      sessionStorage.setItem('hd.token', t);
    }
    return t;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

function loadSettings(): Settings {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem('hd.settings') ?? 'null') ?? DEFAULT_SETTINGS);
  } catch {
    return sanitizeSettings(DEFAULT_SETTINGS);
  }
}

const params = new URLSearchParams(location.search);

export class App {
  host: HostSession | null = null;
  session: ClientSession | null = null;
  game: Game | null = null;
  profile = loadProfile();
  quality: QualityLevel = detectQuality();
  private screen: HTMLElement | null = null;
  private gameLayer: HTMLElement;
  private menuEl: HTMLElement | null = null;
  private hostRaf = 0;
  private worker: Worker | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private settingsView: { update(s: Settings): void } | null = null;
  private lastLobbyKey = '';

  constructor(private root: HTMLElement) {
    this.gameLayer = document.createElement('div');
    this.gameLayer.style.cssText = 'position:absolute;inset:0';
    root.appendChild(this.gameLayer);
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    window.addEventListener('hashchange', () => this.route());
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  // ------------------------------------------------------------------------------------------
  // routing & screens
  // ------------------------------------------------------------------------------------------

  route() {
    const m = location.hash.match(/^#\/join\/([A-Za-z0-9]+)/);
    if (m && !this.session) {
      void this.join(cleanCode(m[1]!));
      return;
    }
    if (!this.session) this.showTitle();
  }

  private setScreen(html: string, cls = ''): HTMLElement {
    this.screen?.remove();
    const s = document.createElement('div');
    s.className = `screen ${cls}`;
    s.innerHTML = html;
    this.root.appendChild(s);
    this.screen = s;
    return s;
  }

  private clearScreen() {
    this.screen?.remove();
    this.screen = null;
  }

  showTitle(error = '') {
    this.cleanup();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    const s = this.setScreen(`
      <div class="title-logo"><div class="t1">HALO</div><div class="t2">DIGLETT</div><div class="t3">Pop up. Snipe. Duck. Repeat.</div></div>
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      <div class="menu">
        <button class="btn primary" data-a="offline">Play vs bots<small>Offline · up to 6 bots</small></button>
        <button class="btn" data-a="host">Host online game<small>Get a code, friends join from their browser</small></button>
        <button class="btn" data-a="join">Join game<small>Enter your friend’s room code</small></button>
        <button class="btn" data-a="options">Options<small>Controls, sensitivity, graphics, audio</small></button>
      </div>
      <p class="note" style="margin-top:26px;text-align:center;max-width:520px">Mouse: aim · Space (hold) stand · Click shoot · Right-click zoom · R reload · Tab scores.<br>Controller and touch screens work too.</p>`);
    s.querySelector('[data-a=offline]')!.addEventListener('click', () => this.startOffline());
    s.querySelector('[data-a=host]')!.addEventListener('click', () => void this.hostOnline());
    s.querySelector('[data-a=join]')!.addEventListener('click', () => this.showJoin());
    s.querySelector('[data-a=options]')!.addEventListener('click', () => this.showOptions(() => this.showTitle()));
  }

  private showJoin() {
    const s = this.setScreen(`
      <div class="title-logo"><div class="t1">JOIN</div></div>
      <div class="card" style="margin-top:28px;width:min(420px,100%)">
        <h3>Room code</h3>
        <input type="text" class="code-in" maxlength="8" placeholder="e.g. K7Q2M" style="width:100%;font-size:28px;letter-spacing:0.3em;text-transform:uppercase" autocomplete="off">
        <div class="row" style="margin-top:14px"><button class="btn primary small go">Join</button><button class="btn small back">Back</button></div>
      </div>`);
    const inp = s.querySelector<HTMLInputElement>('.code-in')!;
    inp.focus();
    const go = () => {
      const c = cleanCode(inp.value);
      if (c.length >= 4) void this.join(c);
    };
    s.querySelector('.go')!.addEventListener('click', go);
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    s.querySelector('.back')!.addEventListener('click', () => this.showTitle());
  }

  // ------------------------------------------------------------------------------------------
  // sessions
  // ------------------------------------------------------------------------------------------

  startOffline(opts: { bots?: BotDifficulty[]; settings?: Partial<Settings>; autostart?: boolean } = {}) {
    this.cleanup();
    const { host: hn, client: cn } = loopbackPair();
    this.host = new HostSession(hn, 'OFFLINE', false, { ...loadSettings(), ...(opts.settings ?? {}) });
    this.host.onChange = () => this.persistSettings();
    this.attachClient(cn);
    const bots = opts.bots ?? (['normal', 'normal', 'heroic'] as BotDifficulty[]);
    queueMicrotask(() => {
      for (const b of bots) this.host?.addBot(b);
      if (opts.autostart) this.host?.startMatch();
    });
    this.startHostLoop();
  }

  async hostOnline(forceCode?: string) {
    this.cleanup();
    const code = forceCode ?? makeRoomCode();
    this.setScreen(`<div class="title-logo" style="margin-top:30vh"><div class="t1">CREATING LOBBY…</div></div>`);
    const mux = new MuxHostNet();
    let net: HostNet;
    try {
      net = params.get('net') === 'bc' ? bcHost(code) : await trysteroHost(code, (m) => console.warn('join error', m));
    } catch (e) {
      this.showTitle(`Could not start online play: ${(e as Error).message}`);
      return;
    }
    const { host: hn, client: cn } = loopbackPair();
    mux.add(hn);
    mux.add(net);
    this.host = new HostSession(mux, code, true, loadSettings());
    this.host.onChange = () => this.persistSettings();
    this.attachClient(cn);
    history.replaceState(null, '', `${location.pathname}${location.search}#/host/${code}`);
    this.startHostLoop();
  }

  async join(code: string) {
    this.cleanup();
    this.setScreen(`<div class="title-logo" style="margin-top:28vh"><div class="t1">JOINING</div><div class="t2" style="font-size:64px">${esc(code)}</div><div class="t3">Looking for the host…</div></div>
      <div class="menu" style="width:min(300px,100%)"><button class="btn small back">Cancel</button></div>`).querySelector('.back')!.addEventListener('click', () => this.showTitle());
    let net: ClientNet;
    let joinErr = '';
    try {
      net = params.get('net') === 'bc' ? bcClient(code) : await trysteroClient(code, (m) => (joinErr = m));
    } catch (e) {
      this.showTitle(`Could not connect: ${(e as Error).message}`);
      return;
    }
    history.replaceState(null, '', `${location.pathname}${location.search}#/join/${code}`);
    this.attachClient(net);
    const s = this.session!;
    setTimeout(() => {
      if (this.session === s && s.state === 'connecting') {
        s.leave();
        this.showTitle(
          joinErr
            ? `Couldn’t connect to the host (${joinErr}). Some networks block direct connections — try another network or set a TURN server in Options → Network.`
            : `No game found with code ${code}. Check the code and make sure the host’s lobby is open.`,
        );
      }
    }, 20000);
  }

  private attachClient(net: ClientNet) {
    const s = new ClientSession(net, { name: this.profile.name, color: this.profile.color, token: token() });
    this.session = s;
    s.onLobby = () => {
      if (s.state === 'lobby') this.showLobby();
    };
    s.onStart = () => this.startGame();
    s.onResults = () => this.showResults();
    s.onToLobby = () => {
      this.stopGame();
      this.showLobby(true);
    };
    s.onClosed = () => {
      if (this.session !== s) return;
      const reason = s.closeReason === 'left' ? '' : s.closeReason;
      this.session = null;
      this.showTitle(reason);
    };
  }

  private startHostLoop() {
    clearInterval(this.hostRaf);
    // timer-driven so the simulation never depends on the render frame rate
    this.hostRaf = window.setInterval(() => this.host?.update(performance.now()), 8);
    if (!this.worker && this.host && this.host.lobby.online) {
      try {
        const src = 'setInterval(function(){postMessage(0)},16)';
        this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        this.worker.onmessage = () => {
          if (document.hidden) this.host?.update(performance.now());
        };
      } catch {
        /* workers unavailable */
      }
    }
  }

  private onVisibility() {
    if (document.hidden && this.host?.lobby.online && this.host.match) console.info('Host tab hidden — a background worker keeps the match running.');
  }

  private persistSettings() {
    if (!this.host) return;
    try {
      localStorage.setItem('hd.settings', JSON.stringify(this.host.lobby.settings));
    } catch {
      /* ignore */
    }
  }

  cleanup() {
    this.stopGame();
    this.closeMenu();
    if (this.session && this.session.state !== 'closed') {
      const s = this.session;
      this.session = null;
      s.leave();
    }
    this.session = null;
    if (this.host) {
      this.host.close();
      this.host = null;
    }
    clearInterval(this.hostRaf);
    this.worker?.terminate();
    this.worker = null;
    this.settingsView = null;
    this.lastLobbyKey = '';
  }

  // ------------------------------------------------------------------------------------------
  // lobby
  // ------------------------------------------------------------------------------------------

  private showLobby(force = false) {
    const s = this.session;
    const lobby = s?.lobby;
    if (!s || !lobby) return;
    if (s.state === 'match' && this.game) return;
    const isHost = !!this.host;
    const key = JSON.stringify({ slots: lobby.slots, phase: lobby.phase, me: s.slot, mode: lobby.settings.weaponMode });
    if (!force && this.screen?.classList.contains('lobby-screen') && key === this.lastLobbyKey) {
      // only settings changed → refresh the form in place
      if (!isHost) this.settingsView?.update(lobby.settings);
      return;
    }
    this.lastLobbyKey = key;
    const scrollTop = this.screen?.classList.contains('lobby-screen') ? this.screen.scrollTop : 0;
    const humans = lobby.slots.filter((x) => x.kind === 'human');
    const bots = lobby.slots.filter((x) => x.kind === 'bot');
    const me = lobby.slots.find((x) => x.slot === s.slot);
    const link = `${location.origin}${location.pathname}#/join/${lobby.code}`;
    const slotHtml = lobby.slots
      .map((x) => {
        const tags = [x.isHost ? '<span class="tag host">Host</span>' : '', x.slot === s.slot ? '<span class="tag">You</span>' : '', x.kind === 'bot' ? '<span class="tag">Bot</span>' : '', !x.connected ? '<span class="tag">Reconnecting…</span>' : '', x.ping ? `<span class="tag">${x.ping}ms</span>` : '']
          .filter(Boolean)
          .join('');
        const diff =
          x.kind === 'bot'
            ? isHost
              ? `<select data-diff="${x.slot}">${Object.entries(BOT_PROFILES)
                  .map(([k, p]) => `<option value="${k}" ${k === x.bot ? 'selected' : ''}>${p.label}</option>`)
                  .join('')}</select>`
              : `<span class="tag">${BOT_PROFILES[x.bot ?? 'normal'].label}</span>`
            : '';
        const rm = isHost && !x.isHost ? `<button class="btn small danger" data-rm="${x.slot}" title="Remove">✕</button>` : '';
        return `<div class="slot" style="--c:${hex(x.color)}"><span class="nm">${esc(x.name)}</span>${tags}${diff}${rm}</div>`;
      })
      .join('');
    const empty = lobby.online ? Math.max(0, MAX_HUMANS - humans.length) : 0;
    const choice = lobby.settings.weaponMode === 'choice';
    const html = `
      <div class="lobby-head">
        <div><h2>${lobby.online ? 'Online lobby' : 'Offline match'}</h2>${lobby.online ? `<div class="note">Share the code or link — up to ${MAX_HUMANS} players</div>` : ''}</div>
        ${lobby.online ? `<div class="row"><span class="code">${esc(lobby.code)}</span><button class="btn small copy">Copy invite link</button></div>` : ''}
      </div>
      <div class="lobby">
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card"><h3>Spartans (${lobby.slots.length})</h3><div class="slots">${slotHtml}${lobby.online && empty ? `<div class="slot empty"><span class="nm">${empty} open slot${empty > 1 ? 's' : ''} — waiting for friends…</span></div>` : ''}</div>
            ${isHost ? `<div class="row" style="margin-top:10px"><select class="newdiff">${Object.entries(BOT_PROFILES).map(([k, p]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${p.label}</option>`).join('')}</select><button class="btn small addbot" ${bots.length >= MAX_BOTS ? 'disabled' : ''}>+ Add bot</button><span class="note">${bots.length}/${MAX_BOTS} bots</span></div>` : ''}
          </div>
          <div class="card"><h3>Your Spartan</h3>
            <div class="field"><label>Name</label><input type="text" class="name" maxlength="16" value="${esc(me?.name ?? this.profile.name)}"></div>
            <div class="field"><label>Armor</label><div class="swatches">${PLAYER_COLORS.map((c) => `<span class="swatch ${c === (me?.color ?? this.profile.color) ? 'on' : ''}" data-c="${c}" style="background:${hex(c)}"></span>`).join('')}</div></div>
            ${choice ? `<div class="field"><label>Weapon</label><select class="pick">${lobby.settings.allowedWeapons.map((w) => `<option value="${w}" ${me?.pick === w ? 'selected' : ''}>${WEAPONS[w].name}</option>`).join('')}</select></div>` : ''}
          </div>
          <div class="row">
            ${isHost ? `<button class="btn primary start" style="flex:1">${lobby.phase === 'match' ? 'Match in progress' : 'Start match'}</button>` : `<div class="note" style="flex:1">Waiting for the host to start…</div>`}
            <button class="btn small leave">Leave</button>
          </div>
        </div>
        <div class="card"><h3>Match settings ${isHost ? '' : '<span class="note">(host decides)</span>'}</h3><div class="settings-root"></div></div>
      </div>`;
    const scr = this.setScreen(html, 'lobby-screen');
    scr.scrollTop = scrollTop;
    this.settingsView = renderSettings(scr.querySelector('.settings-root')!, lobby.settings, isHost, (ns) => this.host?.setSettings(ns));
    scr.querySelector('.copy')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(link).then(
        () => toast('Invite link copied!'),
        () => toast(link, 6000),
      );
    });
    scr.querySelector('.addbot')?.addEventListener('click', () => this.host?.addBot((scr.querySelector('.newdiff') as HTMLSelectElement).value as BotDifficulty));
    scr.querySelectorAll<HTMLSelectElement>('[data-diff]').forEach((sel) => sel.addEventListener('change', () => this.host?.setBotDifficulty(Number(sel.dataset.diff), sel.value as BotDifficulty)));
    scr.querySelectorAll<HTMLButtonElement>('[data-rm]').forEach((b) => b.addEventListener('click', () => this.host?.removeSlot(Number(b.dataset.rm))));
    const nameIn = scr.querySelector<HTMLInputElement>('.name')!;
    nameIn.addEventListener('change', () => {
      const n = cleanName(nameIn.value);
      if (!n) return;
      this.profile.name = n;
      saveProfile(this.profile);
      s.sendMe({ name: n });
    });
    scr.querySelectorAll<HTMLElement>('.swatch').forEach((sw) =>
      sw.addEventListener('click', () => {
        this.profile.color = Number(sw.dataset.c);
        saveProfile(this.profile);
        s.sendMe({ color: this.profile.color });
      }),
    );
    scr.querySelector<HTMLSelectElement>('.pick')?.addEventListener('change', (e) => {
      const w = (e.target as HTMLSelectElement).value as WeaponId;
      s.sendMe({ pick: w });
      s.input.pick = w;
    });
    scr.querySelector('.start')?.addEventListener('click', () => {
      if (!this.host || this.host.lobby.phase === 'match') return;
      this.tryFullscreen();
      this.host.startMatch();
    });
    scr.querySelector('.leave')!.addEventListener('click', () => this.showTitle());
  }

  // ------------------------------------------------------------------------------------------
  // match
  // ------------------------------------------------------------------------------------------

  private startGame() {
    const s = this.session;
    if (!s) return;
    this.stopGame();
    this.clearScreen();
    const q = QUALITY[this.quality];
    this.game = new Game(this.gameLayer, s, q, { onMenu: () => this.toggleMenu(), isMenuOpen: () => !!this.menuEl });
    this.game.input.opts = { ...this.game.input.opts };
    audio.hrtf = this.quality !== 'low';
    if (this.host && params.has('timescale')) this.host.timescale = Number(params.get('timescale')) || 1;
    this.game.start();
    this.game.input.lock();
    void this.requestWakeLock();
  }

  private stopGame() {
    if (this.game) {
      this.game.destroy();
      this.game = null;
    }
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    this.closeMenu();
  }

  private async requestWakeLock() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl) this.wakeLock = await wl.request('screen');
    } catch {
      /* ignore */
    }
  }

  private tryFullscreen() {
    if (!matchMedia('(pointer: coarse)').matches) return;
    try {
      void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => {
        const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        void so.lock?.('landscape').catch(() => {});
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  private toggleMenu() {
    if (this.menuEl) this.closeMenu();
    else this.openMenu();
  }

  private openMenu() {
    if (this.menuEl || !this.game) return;
    this.game.input.unlock();
    const isHost = !!this.host;
    const m = document.createElement('div');
    m.className = 'screen pause';
    m.innerHTML = `<div class="menu">
      <button class="btn primary" data-a="resume">Resume</button>
      <button class="btn" data-a="options">Options</button>
      ${matchMedia('(pointer: coarse)').matches ? '<button class="btn" data-a="fs">Fullscreen</button>' : ''}
      ${isHost ? '<button class="btn" data-a="end">End match → lobby</button>' : ''}
      <button class="btn danger" data-a="leave">${isHost && this.host?.lobby.online ? 'Close game for everyone' : 'Leave match'}</button>
    </div>`;
    this.root.appendChild(m);
    this.menuEl = m;
    m.querySelector('[data-a=resume]')!.addEventListener('click', () => {
      this.closeMenu();
      this.game?.input.lock();
    });
    m.querySelector('[data-a=options]')!.addEventListener('click', () => {
      this.closeMenu();
      this.showOptions(() => {
        this.clearScreen();
        this.game?.input.lock();
      });
    });
    m.querySelector('[data-a=fs]')?.addEventListener('click', () => this.tryFullscreen());
    m.querySelector('[data-a=end]')?.addEventListener('click', () => {
      this.closeMenu();
      this.host?.backToLobby();
    });
    m.querySelector('[data-a=leave]')!.addEventListener('click', () => this.showTitle());
  }

  private closeMenu() {
    this.menuEl?.remove();
    this.menuEl = null;
  }

  private showResults() {
    const s = this.session;
    const r = s?.results;
    if (!s || !r) return;
    this.stopGame();
    const isHost = !!this.host;
    const w = r.rows.find((x) => x.slot === r.winner);
    const medalHtml = (m: Record<string, number>) =>
      Object.entries(m)
        .filter(([k]) => MEDALS[k])
        .map(([k, n]) => `<span>${esc(MEDALS[k]!.name)}${n > 1 ? ` ×${n}` : ''}</span>`)
        .join('');
    const scr = this.setScreen(`
      <div class="winner" style="color:${w ? hex(w.color) : '#fff'}">${w ? (w.slot === s.slot ? 'Victory!' : `${esc(w.name)} wins`) : 'Draw'}</div>
      <div class="note">${Math.floor(r.durationSec / 60)}:${String(r.durationSec % 60).padStart(2, '0')} played</div>
      <div class="card results"><table><thead><tr><th>#</th><th>Spartan</th><th>Score</th><th>K</th><th>D</th><th>HS</th><th>Acc</th><th>Streak</th><th>Medals</th></tr></thead><tbody>
      ${r.rows.map((x, i) => `<tr class="${x.slot === s.slot ? 'me' : ''}"><td>${i + 1}</td><td><span class="pip" style="background:${hex(x.color)}"></span>${esc(x.name)}${x.kind === 'bot' ? ' <span class="note">BOT</span>' : ''}</td><td>${x.score}</td><td>${x.kills}</td><td>${x.deaths}</td><td>${x.headshots}</td><td>${x.accuracy}%</td><td>${x.bestStreak}</td><td><div class="medals-mini">${medalHtml(x.medals)}</div></td></tr>`).join('')}
      </tbody></table></div>
      <div class="menu" style="width:min(420px,100%)">
        ${isHost ? '<button class="btn primary again">Play again</button><button class="btn lobby">Back to lobby</button>' : '<div class="note" style="text-align:center">Waiting for the host…</div>'}
        <button class="btn small leave">Leave</button>
      </div>`);
    scr.querySelector('.again')?.addEventListener('click', () => {
      this.host?.backToLobby();
      this.host?.startMatch();
    });
    scr.querySelector('.lobby')?.addEventListener('click', () => this.host?.backToLobby());
    scr.querySelector('.leave')!.addEventListener('click', () => this.showTitle());
  }

  // ------------------------------------------------------------------------------------------
  // options
  // ------------------------------------------------------------------------------------------

  showOptions(back: () => void) {
    const opts: Options = { ...(this.game?.input.opts ?? loadOptions()) };
    const v = audio.volumes;
    let turn = '';
    try {
      turn = localStorage.getItem('hd.turn') ?? '';
    } catch {
      /* ignore */
    }
    const slider = (key: string, label: string, min: number, max: number, step: number, val: number) =>
      `<div class="field"><label>${label}</label><div class="val"><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${val}</output></div></div>`;
    const scr = this.setScreen(`
      <div class="lobby-head" style="width:min(720px,100%)"><h2>Options</h2><button class="btn small back">Done</button></div>
      <div class="card" style="width:min(720px,100%);margin-top:12px">
        <h3>Controls</h3>
        ${slider('mouseSens', 'Mouse sensitivity', 0.1, 4, 0.05, opts.mouseSens)}
        ${slider('padSens', 'Controller sensitivity', 0.2, 3, 0.05, opts.padSens)}
        ${slider('touchSens', 'Touch sensitivity', 0.2, 3, 0.05, opts.touchSens)}
        <div class="field"><label>Invert look</label><div class="val"><input type="checkbox" data-k="invertY" ${opts.invertY ? 'checked' : ''}></div></div>
        <div class="field"><label>Stand up (Space)</label><select data-k="standMode"><option value="hold" ${opts.standMode === 'hold' ? 'selected' : ''}>Hold</option><option value="toggle" ${opts.standMode === 'toggle' ? 'selected' : ''}>Toggle</option></select></div>
        <h3 style="margin-top:14px">Graphics</h3>
        <div class="field"><label>Quality</label><select data-k="quality">${['auto', 'low', 'medium', 'high'].map((q) => `<option value="${q}" ${opts.quality === q ? 'selected' : ''}>${q}</option>`).join('')}</select><div class="help">Takes effect next match. Auto picks Low on phones.</div></div>
        ${slider('fov', 'Field of view', 60, 100, 1, opts.fov)}
        <h3 style="margin-top:14px">Audio</h3>
        ${slider('v.master', 'Master', 0, 1, 0.05, v.master)}
        ${slider('v.sfx', 'Effects', 0, 1, 0.05, v.sfx)}
        ${slider('v.voice', 'Pitre voices', 0, 1.5, 0.05, v.voice)}
        ${slider('v.announcer', 'Announcer', 0, 1, 0.05, v.announcer)}
        <h3 style="margin-top:14px">Network (advanced)</h3>
        <div class="note">If a friend can’t connect, add a free TURN relay (e.g. Cloudflare or Open Relay). Paste JSON like <code>{"urls":"turn:host:3478","username":"u","credential":"p"}</code></div>
        <textarea class="turn" style="width:100%;min-height:70px;margin-top:6px;background:#0d1b2a;color:#eaf6ff;border:1px solid var(--line);border-radius:4px;font-family:monospace">${esc(turn)}</textarea>
      </div>`);
    const save = () => {
      saveOptions(opts);
      if (this.game) this.game.input.opts = { ...opts };
      if (opts.quality !== 'auto') this.quality = opts.quality;
      try {
        if (opts.quality === 'auto') localStorage.removeItem('hd.quality');
        else localStorage.setItem('hd.quality', opts.quality);
      } catch {
        /* ignore */
      }
    };
    scr.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      const out = inp.parentElement!.querySelector('output')!;
      inp.addEventListener('input', () => {
        out.textContent = inp.value;
        const k = inp.dataset.k!;
        if (k.startsWith('v.')) audio.setVolumes({ [k.slice(2)]: Number(inp.value) });
        else (opts as unknown as Record<string, number>)[k] = Number(inp.value);
        save();
      });
    });
    scr.querySelector<HTMLInputElement>('[data-k=invertY]')!.addEventListener('change', (e) => {
      opts.invertY = (e.target as HTMLInputElement).checked;
      save();
    });
    scr.querySelectorAll<HTMLSelectElement>('select[data-k]').forEach((sel) =>
      sel.addEventListener('change', () => {
        (opts as unknown as Record<string, string>)[sel.dataset.k!] = sel.value;
        save();
      }),
    );
    scr.querySelector<HTMLTextAreaElement>('.turn')!.addEventListener('change', (e) => {
      const val = (e.target as HTMLTextAreaElement).value.trim();
      try {
        if (!val) localStorage.removeItem('hd.turn');
        else {
          JSON.parse(val);
          localStorage.setItem('hd.turn', val);
          toast('TURN server saved');
        }
      } catch {
        toast('That is not valid JSON');
      }
    });
    scr.querySelector('.back')!.addEventListener('click', () => {
      save();
      back();
    });
  }

  // ------------------------------------------------------------------------------------------
  // test hooks
  // ------------------------------------------------------------------------------------------

  lobbyState(): LobbyState | null {
    return this.session?.lobby ?? null;
  }
}

export { LOADOUT_WEAPONS };
