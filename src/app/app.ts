import { audio } from '../audio/audio';
import { VOLUME_META } from '../audio/levels';
import { voice, type MicState } from '../audio/voice';
import { BOT_PROFILES } from '../bots/brain';
import { loadOptions, saveOptions, type Options } from '../input/input';
import { ClientSession } from '../net/client';
import { HostSession, PLAYER_COLORS, cleanName } from '../net/host';
import { bcClient, bcHost, cleanCode, makeRoomCode, trysteroClient, trysteroHosts } from '../net/p2p';
import type { LobbyState } from '../net/protocol';
import { MuxHostNet, loopbackPair, type ClientNet, type HostNet, type VoiceLink } from '../net/transport';
import { Backdrop } from '../render/backdrop';
import { Game } from '../render/game';
import { GFX_FIELDS, QUALITY, QUALITY_LABEL, QUALITY_LEVELS, autoQuality, detectQuality, presetChoice, resolveQuality, type GfxOverrides, type QualityLevel } from '../render/quality';
import { MAX_BOTS, MAX_HUMANS } from '../sim/constants';
import { DEFAULT_SETTINGS, migrateSavedSettings, sanitizeSettings, settingsForStorage, type Settings } from '../sim/settings';
import type { BotDifficulty } from '../sim/types';
import { WEAPONS, type WeaponId } from '../sim/weapons';
import { esc, hex, toast } from '../ui/dom';
import { MEDALS } from '../ui/hud';
import { mapPreviewHtml } from '../ui/mapPreview';
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
    return migrateSavedSettings(JSON.parse(localStorage.getItem('hd.settings') ?? 'null') ?? DEFAULT_SETTINGS);
  } catch {
    return sanitizeSettings(DEFAULT_SETTINGS);
  }
}

const params = new URLSearchParams(location.search);

/** Label for my microphone button. */
function micLabel(st: MicState): string {
  switch (st) {
    case 'off':
    case 'error':
      return '🎤 Enable mic';
    case 'starting':
      return '🎤 …';
    case 'live':
      return '🎙️ Mic on';
    case 'muted':
      return '🔇 Muted';
    case 'ptt':
      return '🎙️ Hold V';
  }
}

async function micToggle() {
  if (!voice.micStream) {
    if (!(await voice.enableMic())) toast(voice.micError, 5000);
  } else voice.toggleSelfMute();
}

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
  private backdrop: Backdrop | null = null;
  private attempt = 0;
  /** voice-chat listeners for the current screen and for the in-match HUD */
  private screenVoiceUnsub: (() => void) | null = null;
  private hudVoiceUnsub: (() => void) | null = null;
  /** the Options screen is open over a running match: closing it (Done, or Esc) goes back to the game */
  private optionsDone: (() => void) | null = null;

  constructor(private root: HTMLElement) {
    this.gameLayer = document.createElement('div');
    this.gameLayer.style.cssText = 'position:absolute;inset:0';
    root.appendChild(this.gameLayer);
    const unlock = () => {
      audio.unlock();
      voice.resume();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    window.addEventListener('keydown', (e) => this.voiceKey(e, true));
    window.addEventListener('keyup', (e) => this.voiceKey(e, false));
    window.addEventListener('blur', () => voice.setPtt(false));
    window.addEventListener('hashchange', () => this.route());
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  /** M toggles self-mute, V is push-to-talk — in the lobby and in matches. */
  private voiceKey(e: KeyboardEvent, down: boolean) {
    if (e.code === 'KeyV' && !down) return voice.setPtt(false);
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'KeyV' && voice.prefs.mode === 'ptt') voice.setPtt(true);
    else if (e.code === 'KeyM' && down && !e.repeat && voice.micStream) {
      voice.toggleSelfMute();
      toast(voice.prefs.selfMuted ? 'Microphone muted' : 'Microphone on', 1200);
    }
  }

  private watchVoice(f: (() => void) | null) {
    this.screenVoiceUnsub?.();
    this.screenVoiceUnsub = f ? voice.subscribe(f) : null;
    f?.();
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

  private ensureBackdrop() {
    if (this.game || this.backdrop) return;
    if (params.has('test') ? !params.has('backdrop') : params.has('nobackdrop')) return;
    try {
      this.backdrop = new Backdrop(this.gameLayer, QUALITY[this.quality === 'high' || this.quality === 'ultra' ? 'medium' : this.quality]);
      this.backdrop.start();
    } catch (e) {
      console.warn('backdrop unavailable', e);
    }
  }

  private killBackdrop() {
    this.backdrop?.destroy();
    this.backdrop = null;
  }

  private setScreen(html: string, cls = ''): HTMLElement {
    this.watchVoice(null);
    this.optionsDone = null;
    this.ensureBackdrop();
    this.screen?.remove();
    const s = document.createElement('div');
    s.className = `screen ${cls}`;
    s.innerHTML = html;
    this.root.appendChild(s);
    this.screen = s;
    return s;
  }

  private clearScreen() {
    this.watchVoice(null);
    this.optionsDone = null;
    this.screen?.remove();
    this.screen = null;
  }

  showTitle(error = '') {
    this.cleanup();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    const s = this.setScreen(
      `
      <div class="title-logo"><div class="t1">HALO</div><div class="t2">DIGLETT</div><div class="t3">Pop up. Snipe. Duck. Repeat.</div></div>
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      <div class="menu">
        <button class="btn primary" data-a="offline">Play vs bots<small>Offline · up to 6 bots</small></button>
        <button class="btn" data-a="host">Host online game<small>Get a code, friends join from their browser</small></button>
        <button class="btn" data-a="join">Join game<small>Enter your friend’s room code</small></button>
        <button class="btn" data-a="options">Options<small>Controls, sensitivity, graphics, audio</small></button>
      </div>
      <p class="note" style="margin-top:26px;text-align:center;max-width:520px">Mouse: aim · Space (hold) stand · Click shoot · Right-click zoom · R reload · Tab scores.<br>Controller and touch screens work too.</p>`,
      'title',
    );
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

  async hostOnline(forceCode?: string, settings: Partial<Settings> = {}) {
    this.cleanup();
    const code = forceCode ?? makeRoomCode();
    this.setScreen(`<div class="title-logo" style="margin-top:30vh"><div class="t1">CREATING LOBBY…</div></div>`);
    const mux = new MuxHostNet();
    let nets: HostNet[];
    const attempt = this.attempt;
    try {
      nets = params.get('net') === 'bc' ? [bcHost(code)] : await trysteroHosts(code, (m) => console.warn('join error', m));
    } catch (e) {
      if (attempt === this.attempt) this.showTitle(`Could not start online play: ${(e as Error).message}`);
      return;
    }
    if (attempt !== this.attempt) {
      for (const n of nets) n.close();
      return;
    }
    const { host: hn, client: cn } = loopbackPair();
    mux.add(hn);
    for (const n of nets) mux.add(n);
    this.host = new HostSession(mux, code, true, { ...loadSettings(), ...settings });
    this.host.onChange = () => this.persistSettings();
    this.attachClient(cn, mux.voice);
    history.replaceState(null, '', `${location.pathname}${location.search}#/host/${code}`);
    this.startHostLoop();
  }

  async join(code: string) {
    this.cleanup();
    this.setScreen(`<div class="title-logo" style="margin-top:28vh"><div class="t1">JOINING</div><div class="t2" style="font-size:64px">${esc(code)}</div><div class="t3">Looking for the host…</div></div>
      <div class="menu" style="width:min(300px,100%)"><button class="btn small back">Cancel</button></div>`).querySelector('.back')!.addEventListener('click', () => this.showTitle());
    let net: ClientNet;
    let joinErr = '';
    const attempt = this.attempt;
    try {
      net = params.get('net') === 'bc' ? bcClient(code) : await trysteroClient(code, (m) => (joinErr = m));
    } catch (e) {
      if (attempt === this.attempt) this.showTitle(`Could not connect: ${(e as Error).message}`);
      return;
    }
    if (attempt !== this.attempt) {
      // the player cancelled while we were connecting
      net.close();
      return;
    }
    history.replaceState(null, '', `${location.pathname}${location.search}#/join/${code}`);
    this.attachClient(net, net.voice);
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

  private attachClient(net: ClientNet, voiceLink?: VoiceLink) {
    const s = new ClientSession(net, { name: this.profile.name, color: this.profile.color, token: token() });
    this.session = s;
    if (voiceLink) voice.attach(voiceLink, s);
    s.onLobby = () => {
      voice.sync();
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
    if (document.hidden) {
      if (this.host?.lobby.online && this.host.match) console.info('Host tab hidden — a background worker keeps the match running.');
      return;
    }
    // back from another app or tab: the browser dropped the screen wake lock, and iOS may have interrupted the audio
    if (this.game) void this.requestWakeLock();
    audio.resume();
  }

  private persistSettings() {
    if (!this.host) return;
    try {
      localStorage.setItem('hd.settings', JSON.stringify(settingsForStorage(this.host.lobby.settings)));
    } catch {
      /* ignore */
    }
  }

  cleanup() {
    this.attempt++;
    this.stopGame();
    this.closeMenu();
    voice.detach();
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
      this.renderMapPreview(lobby);
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
        const vc =
          voice.available && x.kind === 'human'
            ? `<span class="vdot"></span>${x.slot === s.slot ? '<button class="btn small vbtn" data-vme></button>' : `<button class="btn small vbtn" data-vmute="${x.slot}"></button>`}`
            : '';
        return `<div class="slot" data-vslot="${x.slot}" style="--c:${hex(x.color)}">${vc}<span class="nm">${esc(x.name)}</span>${tags}${diff}${rm}</div>`;
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
            ${voice.available ? `<div class="note" style="margin-top:8px">🎙️ Voice chat: <b>M</b> mutes your mic${voice.prefs.mode === 'ptt' ? ', hold <b>V</b> to talk' : ''} · volumes in Options</div>` : ''}
            ${isHost ? `<div class="row" style="margin-top:10px"><select class="newdiff">${Object.entries(BOT_PROFILES).map(([k, p]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${p.label}</option>`).join('')}</select><button class="btn small addbot" ${bots.length >= MAX_BOTS ? 'disabled' : ''}>+ Add bot</button><span class="note">${bots.length}/${MAX_BOTS} bots</span></div>` : ''}
          </div>
          <div class="card"><h3>Your Spartan</h3>
            <div class="field"><label>Name</label><input type="text" class="name" maxlength="16" value="${esc(me?.name ?? this.profile.name)}"></div>
            <div class="field"><label>Armor</label><div class="swatches">${PLAYER_COLORS.map((c) => `<span class="swatch ${c === (me?.color ?? this.profile.color) ? 'on' : ''}" data-c="${c}" style="background:${hex(c)}"></span>`).join('')}</div></div>
            ${choice ? `<div class="field"><label>Weapon</label><select class="pick">${lobby.settings.allowedWeapons.map((w) => `<option value="${w}" ${me?.pick === w ? 'selected' : ''}>${WEAPONS[w].name}</option>`).join('')}</select></div>` : ''}
          </div>
          <div class="card"><h3>Map</h3><div class="mappreview"></div></div>
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
    this.renderMapPreview(lobby);
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
    scr.querySelector('[data-vme]')?.addEventListener('click', () => void micToggle());
    scr.querySelectorAll<HTMLButtonElement>('[data-vmute]').forEach((b) =>
      b.addEventListener('click', () => {
        const name = s.lobby?.slots.find((x) => x.slot === Number(b.dataset.vmute))?.name;
        if (name) voice.togglePeerMute(name);
      }),
    );
    if (voice.available) this.watchVoice(() => this.refreshLobbyVoice(scr));
  }

  private renderMapPreview(lobby: LobbyState) {
    const el = this.screen?.querySelector<HTMLElement>('.mappreview');
    if (!el) return;
    const html = mapPreviewHtml(lobby.map, lobby.slots.length);
    if (el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
    }
  }

  /** Update mute buttons and talking indicators in place (no re-render). */
  private refreshLobbyVoice(scr: HTMLElement) {
    const players = new Map(voice.players().map((p) => [p.slot, p]));
    const talking = voice.speakingSlots();
    scr.querySelectorAll<HTMLElement>('[data-vslot]').forEach((el) => el.classList.toggle('talking', talking.has(Number(el.dataset.vslot))));
    scr.querySelectorAll<HTMLButtonElement>('[data-vmute]').forEach((b) => {
      const p = players.get(Number(b.dataset.vmute));
      const muted = !!p?.muted;
      const txt = muted ? '🔇' : p?.mic ? '🔊' : '🔈';
      if (b.textContent !== txt) b.textContent = txt;
      b.classList.toggle('off', muted);
      b.title = `${muted ? 'Unmute' : 'Mute'} ${p?.name ?? ''}${p && !p.mic ? ' (mic off)' : ''}`;
    });
    const me = scr.querySelector<HTMLButtonElement>('[data-vme]');
    if (me) {
      const st = voice.micState;
      const txt = micLabel(st);
      if (me.textContent !== txt) me.textContent = txt;
      me.classList.toggle('off', st === 'muted');
      me.title = st === 'off' || st === 'error' ? 'Turn on your microphone' : 'Mute / unmute your microphone (M)';
    }
  }

  // ------------------------------------------------------------------------------------------
  // match
  // ------------------------------------------------------------------------------------------

  private startGame() {
    const s = this.session;
    if (!s) return;
    this.stopGame();
    this.clearScreen();
    this.killBackdrop();
    const opts = loadOptions();
    this.game = new Game(this.gameLayer, s, resolveQuality(this.quality, opts.gfx), { onMenu: () => this.toggleMenu(), isMenuOpen: () => !!this.menuEl });
    this.game.input.opts = { ...this.game.input.opts };
    this.game.setFpsCounter(opts.fpsCounter);
    audio.hrtf = this.quality !== 'low';
    if (this.host && params.has('timescale')) this.host.timescale = Number(params.get('timescale')) || 1;
    this.game.start();
    this.game.input.lock();
    this.watchHudVoice(this.game);
    void this.requestWakeLock();
  }

  private watchHudVoice(game: Game) {
    const hud = game.hud;
    const upd = () => {
      if (!voice.available) return hud.voice(null, []);
      const slots = this.session?.lobby?.slots ?? [];
      const talkers = [...voice.speakingSlots()].flatMap((sl) => slots.filter((x) => x.slot === sl));
      hud.voice({ state: voice.micState, label: micLabel(voice.micState) }, talkers);
    };
    this.hudVoiceUnsub?.();
    this.hudVoiceUnsub = voice.subscribe(upd);
    upd();
    // tap the mic icon: turn on / (un)mute; in push-to-talk mode hold it to talk
    const btn = hud.root.querySelector<HTMLElement>('.vchat .mic')!;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (voice.micStream && voice.prefs.mode === 'ptt' && !voice.prefs.selfMuted) voice.setPtt(true);
      else void micToggle();
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, () => voice.setPtt(false));
  }

  private stopGame() {
    this.hudVoiceUnsub?.();
    this.hudVoiceUnsub = null;
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
      if (!wl) return;
      const lock = await wl.request('screen');
      void this.wakeLock?.release().catch(() => {});
      // the match may have ended while we waited
      if (this.game) this.wakeLock = lock;
      else void lock.release().catch(() => {});
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
    if (this.optionsDone) this.optionsDone();
    else if (this.menuEl) this.closeMenu();
    else this.openMenu();
  }

  private openMenu() {
    if (this.menuEl || !this.game) return;
    this.game.input.unlock();
    this.game.input.suspended = true;
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
    // single player: freeze the world while the menu is open
    if (this.host && !this.host.lobby.online) this.host.paused = true;
    m.querySelector('[data-a=resume]')!.addEventListener('click', () => {
      this.closeMenu();
      this.game?.input.lock();
    });
    m.querySelector('[data-a=options]')!.addEventListener('click', () => {
      this.closeMenu(true);
      this.showOptions(() => {
        this.clearScreen();
        if (this.host) this.host.paused = false;
        if (this.game) this.game.input.suspended = false;
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

  /** `keepPaused`: going on to the Options screen (the game stays paused, and your Spartan stays put). */
  private closeMenu(keepPaused = false) {
    this.menuEl?.remove();
    this.menuEl = null;
    if (keepPaused) return;
    if (this.host) this.host.paused = false;
    if (this.game) this.game.input.suspended = false;
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
    const slider = (key: string, label: string, min: number, max: number, step: number, val: number, help = '') =>
      `<div class="field"><label>${label}</label><div class="val"><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${val}</output></div>${help ? `<div class="help">${help}</div>` : ''}</div>`;
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
        <div class="field"><label>Quality</label><select data-k="quality">${(['auto', ...QUALITY_LEVELS] as const).map((q) => `<option value="${q}" ${opts.quality === q ? 'selected' : ''}>${QUALITY_LABEL[q]}${q === 'auto' ? ` (${QUALITY_LABEL[autoQuality()]})` : ''}</option>`).join('')}</select><div class="help">Changes right away, even mid-match. Laggy? Try Low. Auto picks Low on phones.</div></div>
        <div class="field"><label>Show FPS</label><div class="val"><input type="checkbox" data-fps ${opts.fpsCounter ? 'checked' : ''}></div></div>
        <details class="gfx-adv" ${Object.keys(opts.gfx).length ? 'open' : ''}><summary>Advanced graphics</summary>
          ${GFX_FIELDS.map((f) => `<div class="field"><label>${f.label}</label><select data-gfx="${f.key}"><option value="">Preset (${presetChoice(f.key, this.quality)})</option>${f.options.map(([v, l]) => `<option value="${v}" ${opts.gfx[f.key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${f.help ? `<div class="help">${f.help}</div>` : ''}</div>`).join('')}
          <div class="row" style="margin-top:6px"><button class="btn small reset-gfx">Reset to the preset</button></div>
        </details>
        ${slider('fov', 'Field of view', 60, 100, 1, opts.fov)}
        <h3 style="margin-top:14px">Audio</h3>
        ${VOLUME_META.map((m) => slider(`v.${m.key}`, m.label, 0, m.max, 0.05, v[m.key], m.help)).join('')}
        <div class="row" style="margin-top:8px"><button class="btn small reset-audio">Reset audio to defaults</button></div>
        <h3 style="margin-top:14px">Voice chat</h3>
        <div class="voice-root"></div>
        <h3 style="margin-top:14px">Network (advanced)</h3>
        <div class="note">If a friend can’t connect, add a free TURN relay (e.g. Cloudflare or Open Relay). Paste JSON like <code>{"urls":"turn:host:3478","username":"u","credential":"p"}</code></div>
        <textarea class="turn" style="width:100%;min-height:70px;margin-top:6px;background:#0d1b2a;color:#eaf6ff;border:1px solid var(--line);border-radius:4px;font-family:monospace">${esc(turn)}</textarea>
      </div>`);
    const save = () => {
      saveOptions(opts);
      if (this.game) this.game.input.opts = { ...opts };
      try {
        if (opts.quality === 'auto') localStorage.removeItem('hd.quality');
        else localStorage.setItem('hd.quality', opts.quality);
      } catch {
        /* ignore */
      }
      // "Auto" goes back to what this device gets by default
      this.quality = opts.quality === 'auto' ? detectQuality() : opts.quality;
      audio.hrtf = this.quality !== 'low';
      // applied live, mid-match too
      this.game?.applyGraphics(resolveQuality(this.quality, opts.gfx));
      this.game?.setFpsCounter(opts.fpsCounter);
    };
    const redraw = () => {
      const top = this.screen?.scrollTop ?? 0;
      this.showOptions(back);
      if (this.screen) this.screen.scrollTop = top;
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
        // the Advanced "Preset (…)" labels follow the new preset
        if (sel.dataset.k === 'quality') redraw();
      }),
    );
    scr.querySelectorAll<HTMLSelectElement>('select[data-gfx]').forEach((sel) =>
      sel.addEventListener('change', () => {
        const key = sel.dataset.gfx as keyof GfxOverrides;
        const choice = GFX_FIELDS.find((f) => f.key === key)!.options.find(([v]) => String(v) === sel.value);
        const gfx: Record<string, unknown> = { ...opts.gfx };
        if (choice) gfx[key] = choice[0];
        else delete gfx[key];
        opts.gfx = gfx as GfxOverrides;
        save();
      }),
    );
    scr.querySelector<HTMLInputElement>('[data-fps]')!.addEventListener('change', (e) => {
      opts.fpsCounter = (e.target as HTMLInputElement).checked;
      save();
    });
    scr.querySelector('.reset-gfx')!.addEventListener('click', () => {
      opts.gfx = {};
      save();
      redraw();
    });
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
    scr.querySelector('.reset-audio')!.addEventListener('click', () => {
      audio.resetVolumes();
      voice.resetPeerVolumes();
      const top = scr.scrollTop;
      this.showOptions(back);
      if (this.screen) this.screen.scrollTop = top;
      toast('Audio levels reset to defaults');
    });
    this.renderVoiceOptions(scr.querySelector<HTMLElement>('.voice-root')!);
    const done = () => {
      this.optionsDone = null;
      save();
      // a mic check outside an online game shouldn't keep recording
      if (!voice.available) voice.stopMic(true);
      back();
    };
    scr.querySelector('.back')!.addEventListener('click', done);
    // over a running match, Esc (or the controller's Menu button) is Done too
    if (this.game) this.optionsDone = done;
  }

  /** Options → Voice chat: my mic, mic mode, and per-player volume/mute. */
  private renderVoiceOptions(root: HTMLElement) {
    let key = '';
    const build = (players: ReturnType<typeof voice.players>) => {
      const st = voice.micState;
      const on = !!voice.micStream;
      const rows = players
        .map(
          (p, i) => `<div class="vplayer ${p.muted ? 'muted' : ''}" data-vslot="${p.slot}" style="--c:${hex(p.color)}">
            <span class="vdot"></span><span class="nm">${esc(p.name)}${p.mic ? '' : ' <span class="note">(mic off)</span>'}</span>
            <input type="range" min="0" max="1" step="0.05" value="${p.vol}" data-vi="${i}" aria-label="${esc(p.name)} volume"><output>${Math.round(p.vol * 100)}%</output>
            <button class="btn small vbtn ${p.muted ? 'off' : ''}" data-mi="${i}" title="${p.muted ? 'Unmute' : 'Mute'} ${esc(p.name)}">${p.muted ? '🔇' : '🔊'}</button></div>`,
        )
        .join('');
      root.innerHTML = `
        <div class="field"><label>Microphone</label><div class="val"><button class="btn small mic-on">${on ? 'Turn mic off' : st === 'starting' ? 'Starting…' : 'Enable microphone'}</button><div class="micmeter" title="Mic level"><div></div></div></div>
          ${voice.micError && !on ? `<div class="help err">${esc(voice.micError)}</div>` : ''}
          <div class="help">Talk to the other players in online games. Your voice goes straight to them (peer-to-peer). Headphones stop echo.</div></div>
        <div class="field"><label>Mic mode</label><select class="vmode"><option value="open" ${voice.prefs.mode === 'open' ? 'selected' : ''}>Open mic (M to mute)</option><option value="ptt" ${voice.prefs.mode === 'ptt' ? 'selected' : ''}>Push-to-talk (hold V)</option></select></div>
        <div class="field"><label>Mute myself</label><div class="val"><input type="checkbox" class="vself" ${voice.prefs.selfMuted ? 'checked' : ''}></div></div>
        <div class="field"><label>Players</label></div>
        ${voice.available ? (rows ? `<div class="vplayers">${rows}</div>` : '<div class="note">No other players in the lobby yet.</div>') : '<div class="note vc-offline">Voice chat works in online games. Host or join one to hear other players (you can check your mic here).</div>'}`;
      root.querySelector('.mic-on')!.addEventListener('click', () => {
        if (voice.micStream) voice.stopMic();
        else void voice.enableMic();
      });
      root.querySelector<HTMLSelectElement>('.vmode')!.addEventListener('change', (e) => voice.setMode((e.target as HTMLSelectElement).value === 'ptt' ? 'ptt' : 'open'));
      root.querySelector<HTMLInputElement>('.vself')!.addEventListener('change', (e) => voice.setSelfMuted((e.target as HTMLInputElement).checked));
      root.querySelectorAll<HTMLInputElement>('[data-vi]').forEach((inp) =>
        inp.addEventListener('input', () => {
          inp.nextElementSibling!.textContent = `${Math.round(Number(inp.value) * 100)}%`;
          voice.setPeerVolume(players[Number(inp.dataset.vi)]!.name, Number(inp.value));
        }),
      );
      root.querySelectorAll<HTMLButtonElement>('[data-mi]').forEach((b) => b.addEventListener('click', () => voice.togglePeerMute(players[Number(b.dataset.mi)]!.name)));
    };
    this.watchVoice(() => {
      const players = voice.players();
      // rebuild only when the structure changes, so dragging a slider is never interrupted
      const k = JSON.stringify([voice.micState, voice.micError, voice.prefs.mode, voice.prefs.selfMuted, voice.available, players.map((p) => [p.slot, p.name, p.color, p.mic, p.muted])]);
      if (k !== key) {
        key = k;
        build(players);
      }
      const talking = voice.speakingSlots();
      root.querySelectorAll<HTMLElement>('[data-vslot]').forEach((el) => el.classList.toggle('talking', talking.has(Number(el.dataset.vslot))));
      const meter = root.querySelector<HTMLElement>('.micmeter > div');
      if (meter) meter.style.transform = `scaleX(${voice.transmitting ? Math.min(1, voice.micLevel * 5) : 0})`;
    });
  }

  // ------------------------------------------------------------------------------------------
  // test hooks
  // ------------------------------------------------------------------------------------------

  lobbyState(): LobbyState | null {
    return this.session?.lobby ?? null;
  }
}

