import type { ArenaLayout } from '../sim/arena';
import { SETTINGS_TABS, type Settings, type SettingsTab, type SettingsTabId } from '../sim/settings';
import { esc } from './dom';
import { mapPreviewHtml } from './mapPreview';
import { renderSettings } from './settingsForm';
import { resetTab, tabChanged } from './settingsSummary';

export interface SettingsModalOpts {
  settings: Settings;
  /** the host changes them; everyone else just looks */
  editable: boolean;
  tab?: SettingsTabId;
  map?: ArenaLayout;
  players: number;
  onChange(s: Settings): void;
  onClose(): void;
}

/** Opening it again goes back to the tab you were on. */
let lastTab: SettingsTabId = 'game';

/**
 * The match settings, one tab at a time, in a window over the lobby (outside the lobby screen, so the lobby can redraw
 * underneath while it's open). Esc, a click outside it or Done closes it.
 */
export class SettingsModal {
  readonly el: HTMLElement;
  private s: Settings;
  private tab: SettingsTab;
  private form: { update(s: Settings): void } | null = null;
  private map: ArenaLayout | undefined;
  private players: number;
  private opener: HTMLElement | null;
  private closed = false;
  private downOutside = false;

  constructor(parent: HTMLElement, private o: SettingsModalOpts) {
    this.s = o.settings;
    this.map = o.map;
    this.players = o.players;
    this.tab = SETTINGS_TABS.find((t) => t.id === (o.tab ?? lastTab)) ?? SETTINGS_TABS[0]!;
    this.opener = document.activeElement as HTMLElement | null;
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.innerHTML = `
      <div class="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="sm-title">
        <div class="modal-head">
          <div><h2 id="sm-title">Match settings</h2>${o.editable ? '' : '<div class="note">Only the host can change these</div>'}</div>
          <button class="btn small x" aria-label="Close">✕</button>
        </div>
        <div class="tabs" role="tablist">${SETTINGS_TABS.map(
          (t) => `<button class="tab" role="tab" id="st-${t.id}" data-tab="${t.id}" aria-controls="sm-body"><span class="ic" aria-hidden="true">${t.icon}</span><span class="lb">${esc(t.label)}</span><i class="dot" title="Changed from the default"></i></button>`,
        ).join('')}</div>
        <div class="modal-body" id="sm-body" role="tabpanel"><div class="tab-map mapprev-modal"></div><div class="form-root"></div></div>
        <div class="modal-foot">${o.editable ? '<button class="btn small reset">Reset this tab</button>' : ''}<span class="sp"></span><button class="btn primary small done">Done</button></div>
      </div>`;
    this.el = el;
    parent.appendChild(el);
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.tab as SettingsTabId)));
    el.querySelector('.tabs')!.addEventListener('keydown', (e) => this.tabKeys(e as KeyboardEvent));
    el.querySelector('.x')!.addEventListener('click', () => this.close());
    el.querySelector('.done')!.addEventListener('click', () => this.close());
    el.querySelector('.reset')?.addEventListener('click', () => {
      this.s = resetTab(this.s, this.tab);
      this.o.onChange(this.s);
      this.form?.update(this.s);
      this.refresh();
    });
    // a click outside the window closes it (only one that started outside: not a drag out of a slider)
    el.addEventListener('pointerdown', (e) => (this.downOutside = e.target === el));
    el.addEventListener('click', (e) => {
      if (e.target === el && this.downOutside) this.close();
    });
    window.addEventListener('keydown', this.onKey, true);
    this.showTab(this.tab.id);
    el.querySelector<HTMLElement>(`[data-tab="${this.tab.id}"]`)?.focus();
  }

  get open() {
    return !this.closed;
  }

  showTab(id: SettingsTabId) {
    this.tab = SETTINGS_TABS.find((t) => t.id === id) ?? SETTINGS_TABS[0]!;
    lastTab = this.tab.id;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      const on = b.dataset.tab === this.tab.id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    const body = this.el.querySelector<HTMLElement>('.modal-body')!;
    body.setAttribute('aria-labelledby', `st-${this.tab.id}`);
    this.form = renderSettings(
      body.querySelector('.form-root')!,
      this.s,
      this.o.editable,
      (ns) => {
        this.s = ns;
        this.o.onChange(ns);
        this.refresh();
      },
      { groups: this.tab.groups, presets: this.tab.presets },
    );
    body.scrollTop = 0;
    this.refresh();
  }

  /**
   * New lobby state. The form is redrawn only if the settings are different from what it shows (the host's own
   * changes come back too: redrawing then would interrupt a slider being dragged).
   */
  update(s: Settings, map: ArenaLayout | undefined, players: number) {
    this.map = map;
    this.players = players;
    if (JSON.stringify(s) !== JSON.stringify(this.s)) {
      this.s = s;
      this.form?.update(s);
    }
    this.refresh();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
    if (this.opener?.isConnected) this.opener.focus();
    this.o.onClose();
  }

  /** The dots on tabs with changes, and the Map tab's minimap. */
  private refresh() {
    for (const t of SETTINGS_TABS) this.el.querySelector(`[data-tab="${t.id}"]`)?.classList.toggle('changed', tabChanged(this.s, t));
    const mp = this.el.querySelector<HTMLElement>('.tab-map')!;
    const html = this.tab.id === 'map' ? mapPreviewHtml(this.map, this.players, 'mpModal') : '';
    if (mp.dataset.html !== html) {
      mp.dataset.html = html;
      mp.innerHTML = html;
    }
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === 'Tab') {
      // keep keyboard focus inside the window
      const items = [...this.el.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]')].filter((x) => x.tabIndex >= 0 && x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const a = document.activeElement;
      if (!this.el.contains(a)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && a === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && a === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  /** ← → Home End move between tabs. */
  private tabKeys(e: KeyboardEvent) {
    const i = SETTINGS_TABS.indexOf(this.tab);
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? SETTINGS_TABS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const t = SETTINGS_TABS[(to + SETTINGS_TABS.length) % SETTINGS_TABS.length]!;
    this.showTab(t.id);
    this.el.querySelector<HTMLElement>(`[data-tab="${t.id}"]`)?.focus();
  }
}
