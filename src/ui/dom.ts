export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function hex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

export function toast(msg: string, ms = 2500) {
  const t = h('div', { class: 'toast' });
  t.textContent = msg;
  document.getElementById('app')!.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/*
 * Change-only DOM writes. The HUD is refreshed every frame, and a DOM write — even of the same text — costs a style
 * recalculation and a repaint over the 3D view (and comparing against `innerHTML` re-serializes the DOM every time).
 * Every write to an element must go through these so the remembered value stays true.
 */
const shownText = new WeakMap<Element, string>();
const shownHtml = new WeakMap<Element, string>();

export function setText(el: Element, text: string) {
  if (shownText.get(el) === text) return;
  shownText.set(el, text);
  el.textContent = text;
}

export function setHtml(el: Element, html: string) {
  if (shownHtml.get(el) === html) return;
  shownHtml.set(el, html);
  el.innerHTML = html;
}

/** One inline style property, written only when it changes. */
const shownStyle = new WeakMap<HTMLElement | SVGElement, Map<string, string>>();
export function setStyle(el: HTMLElement | SVGElement, prop: string, value: string) {
  let m = shownStyle.get(el);
  if (!m) shownStyle.set(el, (m = new Map()));
  if (m.get(prop) === value) return;
  m.set(prop, value);
  el.style.setProperty(prop, value);
}
