import { PRESETS, SETTINGS_SCHEMA, SKULLS, applyPreset, sanitizeSettings, type Field, type FieldGroup, type Settings } from '../sim/settings';
import { esc, hex } from './dom';

export interface SettingsFormOpts {
  /** only these groups (one tab of the settings window); all of them if left out */
  groups?: readonly FieldGroup[];
  /** the preset buttons, for the host (default: shown when editable and showing every group) */
  presets?: boolean;
}

/** Renders the host settings from the schema. Read-only for non-hosts. */
export function renderSettings(root: HTMLElement, settings: Settings, editable: boolean, onChange: (s: Settings) => void, opts: SettingsFormOpts = {}) {
  let s = sanitizeSettings(settings);
  let shown = '';
  const presets = editable && (opts.presets ?? !opts.groups);
  const draw = () => {
    const groups: string[] = [];
    let html = '';
    if (presets) {
      html += `${opts.groups ? '<div class="group">Game type</div>' : ''}<div class="presets">${Object.entries(PRESETS)
        .map(([k, p]) => `<button class="btn small" data-preset="${k}">${esc(p.label)}</button>`)
        .join('')}</div>`;
    }
    for (const f of SETTINGS_SCHEMA) {
      if (opts.groups && !opts.groups.includes(f.group)) continue;
      if (f.visibleIf && !f.visibleIf(s)) continue;
      if (!groups.includes(f.group)) {
        groups.push(f.group);
        html += `<div class="group">${esc(f.group)}</div>`;
      }
      html += fieldHtml(f, s, editable);
    }
    if (html === shown) return;
    shown = html;
    // a redraw replaces every control: keep keyboard focus on the one that was in use
    const a = document.activeElement as HTMLElement | null;
    const focus = a && root.contains(a) ? focusKey(a) : '';
    root.innerHTML = `<div class="settings">${html}</div>`;
    bind();
    if (focus) root.querySelector<HTMLElement>(focus)?.focus();
  };
  const set = (key: keyof Settings, value: unknown) => {
    s = sanitizeSettings({ ...s, [key]: value });
    onChange(s);
    draw();
  };
  const bind = () => {
    if (!editable) return;
    root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        s = applyPreset(s, b.dataset.preset!);
        onChange(s);
        draw();
      }),
    );
    root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      const f = SETTINGS_SCHEMA.find((x) => x.key === inp.dataset.key)! as Extract<Field, { kind: 'number' }>;
      const out = inp.parentElement!.querySelector('output')!;
      inp.addEventListener('input', () => (out.textContent = fmtNum(f, Number(inp.value))));
      inp.addEventListener('change', () => set(f.key, Number(inp.value)));
    });
    root.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((inp) => inp.addEventListener('change', () => set(inp.dataset.key as keyof Settings, inp.checked)));
    root.querySelectorAll<HTMLSelectElement>('select[data-key]').forEach((sel) => sel.addEventListener('change', () => set(sel.dataset.key as keyof Settings, sel.value)));
    root.querySelectorAll<HTMLButtonElement>('[data-bulk]').forEach((b) =>
      b.addEventListener('click', () => {
        const f = SETTINGS_SCHEMA.find((x) => x.key === b.dataset.bulk)!;
        if (f.kind === 'multi') set(f.key, b.dataset.all === '1' ? f.options.map((o) => o.value) : []);
      }),
    );
    root.querySelectorAll<HTMLButtonElement>('.chip[data-key]').forEach((chip) =>
      chip.addEventListener('click', () => {
        const key = chip.dataset.key as keyof Settings;
        const v = chip.dataset.v!;
        const cur = [...(s[key] as string[])];
        const i = cur.indexOf(v);
        if (i >= 0) cur.splice(i, 1);
        else cur.push(v);
        set(key, cur);
      }),
    );
  };
  draw();
  return {
    update(ns: Settings) {
      s = sanitizeSettings(ns);
      draw();
    },
  };
}

/** A selector that finds the same control again after a redraw. */
function focusKey(el: HTMLElement): string {
  const d = el.dataset;
  if (d.preset) return `[data-preset="${d.preset}"]`;
  if (d.bulk) return `[data-bulk="${d.bulk}"][data-all="${d.all}"]`;
  if (d.key && d.v) return `.chip[data-key="${d.key}"][data-v="${CSS.escape(d.v)}"]`;
  if (d.key) return `[data-key="${d.key}"]`;
  return '';
}

function fmtNum(f: Extract<Field, { kind: 'number' }>, v: number): string {
  if (v === 0 && f.zeroLabel) return f.zeroLabel;
  const n = Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return f.unit === '×' ? `${n}×` : f.unit ? `${n} ${f.unit}` : n;
}

function fieldHtml(f: Field, s: Settings, editable: boolean): string {
  const dis = editable ? '' : 'disabled';
  const help = f.help ? `<div class="help">${esc(f.help)}</div>` : '';
  const skullHelp = f.key === 'skulls' ? `<div class="help">${SKULLS.map((k) => `<b>${esc(k.label)}</b>: ${esc(k.help)}`).join('<br>')}</div>` : '';
  const v = s[f.key];
  switch (f.kind) {
    case 'number':
      return `<div class="field"><label>${esc(f.label)}</label><div class="val"><input type="range" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" aria-label="${esc(f.label)}" ${dis}><output>${esc(fmtNum(f, v as number))}</output></div>${help}</div>`;
    case 'bool':
      return `<div class="field"><label>${esc(f.label)}</label><div class="val"><input type="checkbox" data-key="${f.key}" ${v ? 'checked' : ''} aria-label="${esc(f.label)}" ${dis}></div>${help}</div>`;
    case 'enum':
      return `<div class="field"><label>${esc(f.label)}</label><select data-key="${f.key}" aria-label="${esc(f.label)}" ${dis}>${f.options
        .map((o) => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`)
        .join('')}</select>${help}</div>`;
    case 'multi': {
      const arr = v as string[];
      const chips = f.options
        .map((o) => {
          const i = arr.indexOf(o.value);
          const ord = f.ordered && i >= 0 ? `<span class="ord">${i + 1}</span>` : '';
          const style = o.color !== undefined ? ` style="--cc:${hex(o.color)}"` : '';
          const icon = o.icon ? `<span class="ic">${esc(o.icon)}</span>` : '';
          return `<button class="chip ${i >= 0 ? 'on' : ''}" data-key="${f.key}" data-v="${esc(o.value)}" aria-pressed="${i >= 0}"${style} ${dis}>${ord}${icon}${esc(o.label)}</button>`;
        })
        .join('');
      const bulk = f.bulk && editable ? `<div class="bulk"><button class="btn small" data-bulk="${f.key}" data-all="1">All</button><button class="btn small" data-bulk="${f.key}" data-all="0">None</button></div>` : '<div></div>';
      return `<div class="field"><label>${esc(f.label)}</label>${bulk}<div class="chips">${chips}</div>${help}${skullHelp}</div>`;
    }
  }
}
