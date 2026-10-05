import { PRESETS, SETTINGS_SCHEMA, SKULLS, applyPreset, sanitizeSettings, type Field, type Settings } from '../sim/settings';
import { esc } from './dom';

/** Renders the host settings from the schema. Read-only for non-hosts. */
export function renderSettings(root: HTMLElement, settings: Settings, editable: boolean, onChange: (s: Settings) => void) {
  let s = sanitizeSettings(settings);
  const draw = () => {
    const groups: string[] = [];
    let html = '';
    if (editable) {
      html += `<div class="presets">${Object.entries(PRESETS)
        .map(([k, p]) => `<button class="btn small" data-preset="${k}">${esc(p.label)}</button>`)
        .join('')}</div>`;
    }
    for (const f of SETTINGS_SCHEMA) {
      if (f.visibleIf && !f.visibleIf(s)) continue;
      if (!groups.includes(f.group)) {
        groups.push(f.group);
        html += `<div class="group">${esc(f.group)}</div>`;
      }
      html += fieldHtml(f, s, editable);
    }
    root.innerHTML = `<div class="settings">${html}</div>`;
    bind();
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
      return `<div class="field"><label>${esc(f.label)}</label><div class="val"><input type="range" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" ${dis}><output>${esc(fmtNum(f, v as number))}</output></div>${help}</div>`;
    case 'bool':
      return `<div class="field"><label>${esc(f.label)}</label><div class="val"><input type="checkbox" data-key="${f.key}" ${v ? 'checked' : ''} ${dis}></div>${help}</div>`;
    case 'enum':
      return `<div class="field"><label>${esc(f.label)}</label><select data-key="${f.key}" ${dis}>${f.options
        .map((o) => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`)
        .join('')}</select>${help}</div>`;
    case 'multi': {
      const arr = v as string[];
      const chips = f.options
        .map((o) => {
          const i = arr.indexOf(o.value);
          const ord = f.ordered && i >= 0 ? `<span class="ord">${i + 1}</span>` : '';
          return `<button class="chip ${i >= 0 ? 'on' : ''}" data-key="${f.key}" data-v="${esc(o.value)}" ${dis}>${ord}${esc(o.label)}</button>`;
        })
        .join('');
      return `<div class="field"><label>${esc(f.label)}</label><div></div><div class="chips">${chips}</div>${help}${skullHelp}</div>`;
    }
  }
}
