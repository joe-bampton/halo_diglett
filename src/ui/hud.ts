import { POWERUPS, type PowerUpId } from '../sim/powerups';
import { WEAPONS, type WeaponId } from '../sim/weapons';
import { esc, hex } from './dom';

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
  sniper: 'dot', br: 'br', crossbow: 'dot', rpg: 'bracket', grenade: 'arc', railgun: 'bracket', hyperbeam: 'ring', needler: 'needle', flamethrower: 'ring', minigun: 'br', orbital: 'bracket',
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
  constructor(parent: HTMLElement) {
    const r = document.createElement('div');
    r.className = 'hud';
    r.innerHTML = `
      <div class="vignette"></div><div class="flash"></div>
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
    for (const k of ['vignette', 'flash', 'scope', 'shield', 'cathat', 'timer', 'mode', 'conn', 'reticle', 'charge', 'hitmark', 'dmgdir', 'center-msg', 'sub-msg', 'killfeed', 'medals', 'powerups', 'spectate', 'score', 'ammo', 'wname', 'count', 'pips', 'vchat']) {
      this.el[k] = r.querySelector(`.${k}`) as HTMLElement;
    }
  }

  /** Voice chat widget: my mic state + who is talking right now. `mic: null` hides it (offline). */
  voice(mic: { state: string; label: string } | null, talkers: { name: string; color: number }[]) {
    const v = this.el.vchat!;
    v.style.display = mic ? '' : 'none';
    if (!mic) return;
    const btn = v.querySelector('.mic') as HTMLElement;
    btn.dataset.state = mic.state;
    btn.title = mic.label;
    const icon = mic.state === 'live' ? '🎙️' : mic.state === 'off' || mic.state === 'error' ? '🎤' : '🔇';
    if (btn.textContent !== icon) btn.textContent = icon;
    const html = talkers.map((t) => `<div style="color:${hex(t.color)}">🔊 ${esc(t.name)}</div>`).join('');
    const tk = v.querySelector('.talkers') as HTMLElement;
    if (tk.innerHTML !== html) tk.innerHTML = html;
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  shield(sh: number, shm: number, hp: number, hpm: number, os: number, alive = true) {
    const f = shm > 0 ? sh / shm : 0;
    (this.el.shield!.querySelector('.fill') as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`;
    (this.el.shield!.querySelector('.os') as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, os / 70))})`;
    (this.el.shield!.querySelector('.hp > div') as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, hp / hpm))})`;
    this.el.shield!.classList.toggle('low', f < 0.25);
    this.el.vignette!.style.opacity = String(alive && hp < hpm * 0.99 && sh <= 0 ? Math.min(0.8, 1 - hp / hpm + 0.2) : 0);
  }

  ammo(weapon: WeaponId, clip: number, clipMax: number, infinite: boolean, reloading: boolean) {
    const w = WEAPONS[weapon];
    if (this.lastWeapon !== weapon) {
      this.lastWeapon = weapon;
      this.el.wname!.textContent = w.name.toUpperCase();
      this.el.reticle!.querySelector('svg')!.innerHTML = RETICLES[WEAPON_RETICLE[weapon]]!;
    }
    const c = this.el.count!;
    c.textContent = reloading ? '···' : infinite ? '∞' : String(clip);
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
    this.el.reticle!.style.color = red ? '#ff5050' : '#9fe7ff';
    this.el.reticle!.style.display = visible ? '' : 'none';
  }

  charge(f: number) {
    const c = this.el.charge!.querySelector('circle')!;
    this.el.charge!.style.display = f > 0 ? '' : 'none';
    c.setAttribute('stroke-dashoffset', String(163.4 * (1 - Math.min(1, f))));
  }

  scope(on: boolean, label = '') {
    this.el.scope!.classList.toggle('on', on);
    (this.el.scope!.querySelector('.zl') as HTMLElement).textContent = label;
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
    m.textContent = text;
    m.className = `center-msg ${cls}`;
    clearTimeout(this.msgTimer);
    if (ms > 0) this.msgTimer = window.setTimeout(() => (m.textContent = ''), ms);
  }

  sub(text: string, ms = 0) {
    const m = this.el['sub-msg']!;
    m.textContent = text;
    clearTimeout(this.subTimer);
    if (ms > 0) this.subTimer = window.setTimeout(() => (m.textContent = ''), ms);
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

  powerups(list: { id: PowerUpId; frac: number }[]) {
    const html = list
      .map((p) => {
        const d = POWERUPS[p.id];
        return `<div class="pu${d.held ? ' held' : ''}" style="--pc:${hex(d.color)}"><div class="ic">${d.icon}</div><div class="t" style="transform:scaleX(${p.frac.toFixed(3)})"></div></div>`;
      })
      .join('');
    if (this.el.powerups!.innerHTML !== html) this.el.powerups!.innerHTML = html;
  }

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
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  timer(text: string, mode: string) {
    this.el.timer!.textContent = text;
    this.el.mode!.textContent = mode;
  }

  conn(text: string) {
    this.el.conn!.textContent = text;
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
    if (this.el.score!.innerHTML !== html) this.el.score!.innerHTML = html;
  }
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
