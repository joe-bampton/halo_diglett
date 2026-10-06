import { FENCE_RADIUS, PLAY_RADIUS, RIM_OUT, generateLayout, type ArenaLayout } from '../sim/arena';

let classic: ArenaLayout | null = null;

/** Top-down SVG of the field: fence, hills and holes (the ones in play highlighted). */
export function mapPreviewHtml(layout: ArenaLayout | undefined, players: number): string {
  const L = layout ?? (classic ??= generateLayout());
  const fence = L.radius + (FENCE_RADIUS - PLAY_RADIUS);
  const R = fence + 3;
  const inPlay = L.auto ? Math.max(6, Math.min(L.holes.length, players + 3)) : L.holes.length;
  const dot = Math.max(RIM_OUT, R * 0.035);
  const f = (n: number) => n.toFixed(1);
  const hills = L.hills
    .map((h) => `<circle cx="${f(h.x)}" cy="${f(h.z)}" r="${f(h.s * 1.7)}" fill="url(#mpHill)" opacity="${Math.min(0.9, h.h / 2.4).toFixed(2)}"/>`)
    .join('');
  const holes = L.holes.map(([x, z], i) => `<circle class="${i < inPlay ? 'on' : 'off'}" cx="${f(x)}" cy="${f(z)}" r="${f(dot)}"/>`).join('');
  const cap = `${L.holes.length} holes${L.auto && inPlay < L.holes.length ? ` (${inPlay} in play)` : ''} · at least ${L.spacing} m apart · field ${Math.round(fence * 2)} m across`;
  return `<svg viewBox="${-R} ${-R} ${2 * R} ${2 * R}" role="img" aria-label="Map preview: ${cap}">
    <defs><radialGradient id="mpHill"><stop offset="0" stop-color="#9fd25a" stop-opacity="0.55"/><stop offset="1" stop-color="#9fd25a" stop-opacity="0"/></radialGradient></defs>
    <circle cx="0" cy="0" r="${f(fence)}" fill="#2f5a22" stroke="#e8e8e8" stroke-width="${f(R * 0.012)}" stroke-dasharray="${f(R * 0.03)} ${f(R * 0.015)}"/>
    ${hills}${holes}
  </svg><div class="cap">${cap}</div>`;
}
