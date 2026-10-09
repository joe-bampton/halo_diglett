import { POWERUPS, type PowerUpId } from '../sim/powerups';
import { WEAPONS, type WeaponId } from '../sim/weapons';
import { SAUCE } from '../render/palette';
import { esc, hex, setHtml, setStyle, setText } from './dom';

/** 3 decimals: enough for a bar on screen, and the same value isn't rewritten every frame */
const q3 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 1000;

export const MEDALS: Record<string, { name: string; icon: string; color: string; ann?: string }> = {
  headshot: { name: 'Headshot', icon: '⊕', color: '#e8a93a', ann: '' },
  double: { name: 'Double Kill', icon: 'II', color: '#e04848', ann: 'ann.double' },
  triple: { name: 'Triple Kill', icon: 'III', color: '#e04848', ann: 'ann.triple' },
  overkill: { name: 'Overkill', icon: 'IV', color: '#c52f2f', ann: 'ann.overkill' },
  killtacular: { name: 'Killtacular', icon: 'V', color: '#a51f5f', ann: 'ann.killtacular' },
  killtrocity: { name: 'Killtrocity', icon: 'VI', color: '#7d1fa5', ann: 'ann.killtrocity' },
  spree: { name: 'Killing Spree', icon: '5', color: '#3fb6ff', ann: 'ann.spree' },
  frenzy: { name: 'Killing Frenzy', icon: '10', color: '#2f8bd8', ann: 'ann.frenzy' },
  riot: { name: 'Running Riot', icon: '15', color: '#2a62c8', ann: 'ann.riot' },
  rampage: { name: 'Rampage', icon: '20', color: '#3a3ad8', ann: 'ann.rampage' },
  untouchable: { name: 'Untouchable', icon: '25', color: '#6a2ad8', ann: 'ann.untouchable' },
  killjoy: { name: 'Killjoy', icon: '☹', color: '#4ab86a', ann: 'ann.killjoy' },
  revenge: { name: 'Revenge', icon: '↺', color: '#d86a2a', ann: 'ann.revenge' },
  whack: { name: 'Whack-a-Mole', icon: '🔨', color: '#b87a3a' },
  longshot: { name: 'Longshot', icon: '⌖', color: '#38a8a8' },
  first: { name: 'First Strike', icon: '1', color: '#d8b82a' },
  supercombine: { name: 'Supercombine', icon: '✸', color: '#ff5fd2' },
  orb: { name: 'Orb Popper', icon: '◓', color: '#e0282e' },
  perfection: { name: 'Perfection', icon: '★', color: '#ffd35a', ann: 'ann.perfection' },
};

const RETICLES: Record<string, string> = {
  dot: `<circle cx="40" cy="40" r="2.2" fill="currentColor"/><circle cx="40" cy="40" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  br: `<circle cx="40" cy="40" r="12" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M40 22v8M40 50v8M22 40h8M50 40h8" stroke="currentColor" stroke-width="2"/>`,
  bracket: `<path d="M24 30v-6h6M50 24h6v6M56 50v6h-6M30 56h-6v-6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="40" cy="40" r="2" fill="currentColor"/>`,
  arc: `<path d="M26 34a16 16 0 0 1 28 0M26 46a16 16 0 0 0 28 0" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="40" cy="40" r="2" fill="currentColor"/>`,
  needle: `<path d="M40 26l4 8h-8zM40 54l4-8h-8zM26 40l8-4v8zM54 40l-8-4v8z" fill="currentColor"/>`,
  ring: `<circle cx="40" cy="40" r="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 4"/><circle cx="40" cy="40" r="2" fill="currentColor"/>`,
};
const WEAPON_RETICLE: Record<WeaponId, string> = {
  sniper: 'dot', br: 'br', crossbow: 'dot', rpg: 'bracket', grenade: 'arc', railgun: 'bracket', hyperbeam: 'ring', needler: 'needle', flamethrower: 'ring', minigun: 'br', orbital: 'bracket', soaker: 'ring',
};

export interface ScoreRow {
  slot: number;
  name: string;
  color: number;
  kills: number;
  deaths: number;
  score: number;
  ping?: number;
  me: boolean;
  bot: boolean;
  leader: boolean;
}

export class Hud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private lastWeapon = '';
  private lastPips = '';
  private msgTimer = 0;
  private subTimer = 0;
  private shFill!: HTMLElement;
  private shOs!: HTMLElement;
  private shHp!: HTMLElement;
  private chargeArc!: SVGCircleElement;
  private chargeOffset = -1;
  private zoomLabel!: HTMLElement;
  private reticleSvg!: SVGElement;
  private puKey = '';
  constructor(parent: HTMLElement) {
    const r = document.createElement('div');
    r.className = 'hud';
    r.innerHTML = `
      <div class="vignette"></div><div class="flash"></div><canvas class="sauce"></canvas>
      <div class="scope"><div class="zl"></div></div>
      <div class="shield"><div class="bar"><div class="fill"></div><div class="os"></div></div><div class="hp"><div></div></div></div>
      <div class="cathat">🎩 YOU ARE THE CAT IN THE HAT</div>
      <div class="topleft"><div class="timer"></div><div class="mode"></div></div>
      <div class="conn"></div>
      <div class="vchat"><button class="mic" type="button" aria-label="Microphone"></button><div class="talkers"></div></div>
      <div class="reticle"><svg viewBox="0 0 80 80"></svg></div>
      <svg class="charge" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="rgba(159,231,255,0.9)" stroke-width="3" stroke-dasharray="163.4" stroke-dashoffset="163.4" transform="rotate(-90 32 32)"/></svg>
      <svg class="hitmark" viewBox="0 0 36 36"><path d="M6 6l8 8M30 6l-8 8M6 30l8-8M30 30l-8-8" stroke="white" stroke-width="3" stroke-linecap="round"/></svg>
      <div class="dmgdir"></div>
      <div class="center-msg"></div><div class="sub-msg"></div>
      <div class="killfeed"></div>
      <div class="medals"></div>
      <div class="powerups"></div>
      <div class="spectate"></div>
      <div class="score"></div>
      <div class="ammo"><div class="wname"></div><div class="count"></div><div class="pips"></div></div>`;
    parent.appendChild(r);
    this.root = r;
    for (const k of ['vignette', 'flash', 'sauce', 'scope', 'shield', 'cathat', 'timer', 'mode', 'conn', 'reticle', 'charge', 'hitmark', 'dmgdir', 'center-msg', 'sub-msg', 'killfeed', 'medals', 'powerups', 'spectate', 'score', 'ammo', 'wname', 'count', 'pips', 'vchat']) {
      this.el[k] = r.querySelector(`.${k}`) as HTMLElement;
    }
    // the bits that change every frame, looked up once
    this.shFill = r.querySelector('.shield .fill')!;
    this.shOs = r.querySelector('.shield .os')!;
    this.shHp = r.querySelector('.shield .hp > div')!;
    this.chargeArc = r.querySelector('.charge circle')!;
    this.zoomLabel = r.querySelector('.scope .zl')!;
    this.reticleSvg = r.querySelector('.reticle svg')!;
  }

  /** Voice chat widget: my mic state + who is talking right now. `mic: null` hides it (offline). */
  voice(mic: { state: string; label: string } | null, talkers: { name: string; color: number }[]) {
    const v = this.el.vchat!;
    setStyle(v, 'display', mic ? '' : 'none');
    if (!mic) return;
    const btn = v.querySelector('.mic') as HTMLElement;
    btn.dataset.state = mic.state;
    btn.title = mic.label;
    const icon = mic.state === 'live' ? '🎙️' : mic.state === 'off' || mic.state === 'error' ? '🎤' : '🔇';
    if (btn.textContent !== icon) btn.textContent = icon;
    const html = talkers.map((t) => `<div style="color:${hex(t.color)}">🔊 ${esc(t.name)}</div>`).join('');
    setHtml(v.querySelector('.talkers')!, html);
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  shield(sh: number, shm: number, hp: number, hpm: number, os: number, alive = true) {
    const f = shm > 0 ? sh / shm : 0;
    setStyle(this.shFill, 'transform', `scaleX(${q3(f)})`);
    setStyle(this.shOs, 'transform', `scaleX(${q3(os / 70)})`);
    setStyle(this.shHp, 'transform', `scaleX(${q3(hpm > 0 ? hp / hpm : 0)})`);
    this.el.shield!.classList.toggle('low', f < 0.25);
    setStyle(this.el.vignette!, 'opacity', String(alive && hp < hpm * 0.99 && sh <= 0 ? q3(Math.min(0.8, 1 - hp / hpm + 0.2)) : 0));
  }

  ammo(weapon: WeaponId, clip: number, clipMax: number, infinite: boolean, reloading: boolean) {
    const w = WEAPONS[weapon];
    if (this.lastWeapon !== weapon) {
      this.lastWeapon = weapon;
      setText(this.el.wname!, w.name.toUpperCase());
      setHtml(this.reticleSvg, RETICLES[WEAPON_RETICLE[weapon]]!);
    }
    const c = this.el.count!;
    setText(c, reloading ? '···' : infinite ? '∞' : String(clip));
    c.classList.toggle('empty', !infinite && clip === 0 && !reloading);
    const key = `${clip}/${clipMax}/${infinite}`;
    if (key !== this.lastPips) {
      this.lastPips = key;
      const n = infinite ? 0 : Math.min(clipMax, 40);
      this.el.pips!.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < clip ? '' : 'off'}"></i>`).join('');
    }
  }

  reticle(red: boolean, visible: boolean) {
    this.el.reticle!.classList.toggle('red', red);
    setStyle(this.el.reticle!, 'color', red ? '#ff5050' : '#9fe7ff');
    setStyle(this.el.reticle!, 'display', visible ? '' : 'none');
  }

  charge(f: number) {
    setStyle(this.el.charge!, 'display', f > 0 ? '' : 'none');
    if (f <= 0) return;
    const off = Math.round(163.4 * (1 - Math.min(1, f)) * 10) / 10;
    if (off !== this.chargeOffset) {
      this.chargeOffset = off;
      this.chargeArc.setAttribute('stroke-dashoffset', String(off));
    }
  }

  scope(on: boolean, label = '') {
    this.el.scope!.classList.toggle('on', on);
    setText(this.zoomLabel, label);
  }

  hitmarker(kill: boolean) {
    const h = this.el.hitmark!;
    h.classList.remove('show', 'kill');
    void h.getBoundingClientRect();
    h.classList.add('show');
    if (kill) h.classList.add('kill');
    (h.querySelector('path') as SVGPathElement).setAttribute('stroke', kill ? '#ff5050' : 'white');
  }

  damageFrom(angleRad: number) {
    const d = document.createElement('div');
    d.style.transform = `rotate(${angleRad}rad)`;
    this.el.dmgdir!.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }

  flash() {
    const f = this.el.flash!;
    f.classList.remove('go');
    void f.getBoundingClientRect();
    f.classList.add('go');
  }

  message(text: string, ms = 2000, cls = '') {
    const m = this.el['center-msg']!;
    setText(m, text);
    m.className = `center-msg ${cls}`;
    clearTimeout(this.msgTimer);
    if (ms > 0) this.msgTimer = window.setTimeout(() => setText(m, ''), ms);
  }

  /** The line under the centre: called every frame with whatever applies (or '' for nothing). */
  sub(text: string, ms = 0) {
    const m = this.el['sub-msg']!;
    setText(m, text);
    if (ms > 0 || this.subTimer) {
      clearTimeout(this.subTimer);
      this.subTimer = ms > 0 ? window.setTimeout(() => ((this.subTimer = 0), setText(m, '')), ms) : 0;
    }
  }

  killfeed(html: string) {
    const kf = this.el.killfeed!;
    const d = document.createElement('div');
    d.innerHTML = html;
    kf.prepend(d);
    while (kf.children.length > 6) kf.lastElementChild!.remove();
    setTimeout(() => d.remove(), 6000);
  }

  killLine(killer: { name: string; color: number } | null, victim: { name: string; color: number }, weapon: WeaponId, head: boolean) {
    const w = `<span class="w">[${esc(WEAPONS[weapon].short)}${head ? ' ⊕' : ''}]</span>`;
    if (!killer || killer.name === victim.name) this.killfeed(`<span style="color:${hex(victim.color)}">${esc(victim.name)}</span> <span class="w">committed suicide</span>`);
    else this.killfeed(`<span style="color:${hex(killer.color)}">${esc(killer.name)}</span>${w}<span style="color:${hex(victim.color)}">${esc(victim.name)}</span>`);
  }

  medal(id: string) {
    const m = MEDALS[id];
    if (!m) return;
    const d = document.createElement('div');
    d.className = 'medal';
    d.style.setProperty('--mc', m.color);
    d.innerHTML = `<div class="ico">${m.icon}</div><div class="lb">${esc(m.name)}</div>`;
    this.el.medals!.appendChild(d);
    while (this.el.medals!.children.length > 5) this.el.medals!.firstElementChild!.remove();
    setTimeout(() => d.remove(), 2700);
  }

  /** Power-up icons with their run-down bars: rebuilt only when the set changes, the bars just move. */
  powerups(list: { id: PowerUpId; frac: number }[]) {
    const root = this.el.powerups!;
    const key = list.map((p) => p.id).join(',');
    if (key !== this.puKey) {
      this.puKey = key;
      root.innerHTML = list
        .map((p) => {
          const d = POWERUPS[p.id];
          return `<div class="pu${d.held ? ' held' : ''}" style="--pc:${hex(d.color)}"><div class="ic">${d.icon}</div><div class="t"></div></div>`;
        })
        .join('');
    }
    const bars = root.children;
    for (let i = 0; i < list.length; i++) {
      const bar = bars[i]?.lastElementChild as HTMLElement | null;
      if (bar) setStyle(bar, 'transform', `scaleX(${q3(list[i]!.frac)})`);
    }
  }

  /**
   * Covered in Gerry Sauce: custard blobs over the screen that drip, slide down and fade as `left` (1 → 0) runs
   * out. Drawn into one half-resolution canvas 10 times a second: a single cheap layer even on weak phones.
   */
  sauce(left: number) {
    const el = this.el.sauce as HTMLCanvasElement;
    if (left <= 0) {
      if (this.sauceBlobs) {
        this.sauceBlobs = null;
        el.classList.remove('on');
        el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
      }
      return;
    }
    const now = performance.now();
    if (!this.sauceBlobs) {
      this.sauceBlobs = makeSauceBlobs();
      el.dataset.blobs = String(this.sauceBlobs.length);
      el.classList.add('on');
      this.sauceAt = -1e9;
    }
    if (now - this.sauceAt < 100) return;
    this.sauceAt = now;
    const w = Math.max(1, Math.round(this.root.clientWidth * 0.5)), h = Math.max(1, Math.round(this.root.clientHeight * 0.5));
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    const ctx = el.getContext('2d');
    if (ctx) drawSauce(ctx, w, h, this.sauceBlobs, left);
  }
  private sauceAt = 0;
  private sauceBlobs: SauceBlob[] | null = null;

  /** Dead: hide vitals and ammo. */
  dead(on: boolean) {
    this.root.classList.toggle('dead', on);
  }

  /** Spectator panel (who you are watching), or null to hide it. */
  spectate(info: { name: string; color: number; weapon: string; kills: number; deaths: number; view: 'first' | 'third'; tags: string[]; hint: string } | null) {
    const el = this.el.spectate!;
    this.root.classList.toggle('first', info?.view === 'first');
    el.classList.toggle('on', !!info);
    if (!info) return;
    const html = `<div class="lbl">Spectating · ${info.view === 'first' ? '1st' : '3rd'} person</div>
      <div class="who"><span class="arr">◀</span><span class="nm" style="color:${hex(info.color)}">${esc(info.name)}</span><span class="arr">▶</span></div>
      <div class="info">${esc(info.weapon)} · ${info.kills} K / ${info.deaths} D${info.tags.length ? ` · ${info.tags.map(esc).join(' · ')}` : ''}</div>
      <div class="hint">${esc(info.hint)}</div>`;
    setHtml(el, html);
  }

  timer(text: string, mode: string) {
    setText(this.el.timer!, text);
    setText(this.el.mode!, mode);
  }

  conn(text: string) {
    setText(this.el.conn!, text);
  }

  catHat(on: boolean) {
    this.el.cathat!.classList.toggle('on', on);
  }

  score(rows: ScoreRow[], limit: number) {
    const me = rows.find((r) => r.me);
    const sorted = [...rows].sort((a, b) => b.score - a.score);
    const top = sorted[0];
    const show: ScoreRow[] = [];
    if (me) show.push(me);
    const other = me && top && top.slot === me.slot ? sorted[1] : top;
    if (other) show.push(other);
    const max = limit > 0 ? limit : Math.max(10, ...(top ? [top.score] : []));
    const html = show
      .map(
        (r) => `<div class="srow"><div class="sb"><div style="background:${hex(r.color)};transform:scaleX(${Math.min(1, r.score / max)})"></div><span class="nm">${r.leader ? '👑 ' : ''}${esc(r.name)}</span></div><div class="n">${r.score}</div></div>`,
      )
      .join('');
    setHtml(this.el.score!, html);
  }
}

/** A fresh, random set of custard blobs (with drips) covering the screen. */
interface SauceBlob {
  /** centre (fraction of the screen), radius (fraction of the short side) */
  x: number;
  y: number;
  r: number;
  /** clean-up order: higher fades first */
  f: number;
  /** how far it slides down while clearing (fraction of the height) */
  drip: number;
  /** wobble of the outline */
  p1: number;
  p2: number;
  drips: { at: number; w: number; len: number }[];
}

function makeSauceBlobs(): SauceBlob[] {
  const r = (a: number, b: number) => a + Math.random() * (b - a);
  return Array.from({ length: 13 }, (_, i) => ({
    // bigger blobs near the middle
    x: i < 4 ? r(0.3, 0.7) : r(-0.05, 1.05),
    y: i < 4 ? r(0.25, 0.65) : r(-0.05, 0.95),
    r: i < 4 ? r(0.11, 0.17) : r(0.045, 0.12),
    f: r(0, 0.85),
    drip: r(0.04, 0.18),
    p1: r(0, 6.28),
    p2: r(0, 6.28),
    drips: Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({ at: r(-0.55, 0.45), w: r(0.12, 0.26), len: r(0.5, 1.4) })),
  }));
}

const css = (hexv: number, a = 1) => `rgba(${(hexv >> 16) & 255},${(hexv >> 8) & 255},${hexv & 255},${a})`;

function drawSauce(ctx: CanvasRenderingContext2D, w: number, h: number, blobs: SauceBlob[], k: number) {
  ctx.clearRect(0, 0, w, h);
  // a thin custard film, thickest at the edges
  const film = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.hypot(w, h) * 0.55);
  film.addColorStop(0, css(SAUCE.base, 0));
  film.addColorStop(1, css(SAUCE.base, 0.6 * k));
  ctx.fillStyle = film;
  ctx.fillRect(0, 0, w, h);
  const s = Math.min(w, h);
  for (const b of blobs) {
    const a = Math.min(1, Math.max(0, k * 1.9 - b.f));
    if (a <= 0) continue;
    const R = b.r * s;
    const cx = b.x * w, cy = b.y * h + (1 - k) * b.drip * h;
    ctx.globalAlpha = a;
    // drips hang from the bottom and stretch as it clears
    for (const d of b.drips) {
      const dw = d.w * R, dl = d.len * R * (0.5 + (1 - k) * 1.3), dx = cx + d.at * R;
      const g = ctx.createLinearGradient(dx - dw / 2, 0, dx + dw / 2, 0);
      g.addColorStop(0, css(SAUCE.shade));
      g.addColorStop(0.4, css(SAUCE.base));
      g.addColorStop(1, css(SAUCE.shade));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(dx - dw / 2, cy);
      ctx.lineTo(dx - dw / 2, cy + R * 0.5 + dl - dw / 2);
      ctx.arc(dx, cy + R * 0.5 + dl - dw / 2, dw / 2, Math.PI, 0, true);
      ctx.lineTo(dx + dw / 2, cy);
      ctx.fill();
    }
    // the dollop: a wobbly ellipse, glossy top-left, darker rim
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) {
      const t = (i / 28) * Math.PI * 2;
      const rr = R * (1 + 0.12 * Math.sin(3 * t + b.p1) + 0.07 * Math.sin(5 * t + b.p2));
      ctx.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr * 0.82);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(cx - R * 0.36, cy - R * 0.36, 0, cx, cy, R * 1.12);
    g.addColorStop(0, css(SAUCE.gloss));
    g.addColorStop(0.08, css(SAUCE.gloss));
    g.addColorStop(0.24, css(SAUCE.base));
    g.addColorStop(0.62, css(SAUCE.base));
    g.addColorStop(0.95, css(SAUCE.shade));
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function scoreboardHtml(rows: ScoreRow[], gunGame: boolean): string {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.deaths - b.deaths);
  return `<table><thead><tr><th>Spartan</th><th>${gunGame ? 'Level' : 'Kills'}</th><th>Deaths</th><th>K/D</th><th>Ping</th></tr></thead><tbody>${sorted
    .map(
      (r) =>
        `<tr class="${r.me ? 'me' : ''}"><td><span class="pip" style="background:${hex(r.color)}"></span>${r.leader ? '👑 ' : ''}${esc(r.name)}${r.bot ? ' <span class="note">BOT</span>' : ''}</td><td>${r.score}</td><td>${r.deaths}</td><td>${(r.kills / Math.max(1, r.deaths)).toFixed(2)}</td><td>${r.bot ? '—' : r.ping ?? '—'}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}
