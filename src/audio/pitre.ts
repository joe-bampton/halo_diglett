import type { Settings } from '../sim/settings';
import type { SimEvent } from '../sim/types';
import { WEAPONS, type WeaponId } from '../sim/weapons';

export type PitreLine = 'prank' | 'byebye' | 'pussy' | 'mama' | 'pufferfish' | 'brap';

export interface PitreCue {
  speaker: number;
  line: PitreLine;
  delayMs: number;
  priority: number;
}

export const PITRE_PRIORITY: Record<PitreLine, number> = { prank: 6, byebye: 5, pufferfish: 4, pussy: 3, mama: 2, brap: 1 };
export const PITRE_SLOT: Record<PitreLine, string> = {
  prank: 'pitre.prank',
  byebye: 'pitre.byebye',
  pussy: 'pitre.pussy',
  mama: 'pitre.mama',
  pufferfish: 'pitre.pufferfish',
  brap: 'pitre.brap',
};

/**
 * Turn simulation events into Pitre Mode voice cues. Pure: throttling/channel logic lives in
 * PitreVoiceThrottle so it can be unit-tested.
 */
export function pitreCues(events: SimEvent[], s: Pick<Settings, 'pitre' | 'pitreVoices' | 'pitreBrap'>): PitreCue[] {
  if (!s.pitre) return [];
  const out: PitreCue[] = [];
  const killed = new Set<number>();
  for (const e of events) if (e.k === 'kill') killed.add(e.v);
  for (const e of events) {
    if (e.k === 'kill' && s.pitreVoices) {
      out.push({ speaker: e.v, line: 'pufferfish', delayMs: 0, priority: PITRE_PRIORITY.pufferfish });
      if (e.a >= 0 && e.a !== e.v) {
        const line: PitreLine = e.lead ? 'prank' : 'byebye';
        out.push({ speaker: e.a, line, delayMs: 300, priority: PITRE_PRIORITY[line] });
      }
    } else if (e.k === 'dmg' && s.pitreVoices && e.amt > 0 && !killed.has(e.v)) {
      out.push({ speaker: e.v, line: 'mama', delayMs: 0, priority: PITRE_PRIORITY.mama });
      if (e.a >= 0 && e.a !== e.v) out.push({ speaker: e.a, line: 'pussy', delayMs: 280, priority: PITRE_PRIORITY.pussy });
    } else if (e.k === 'fire' && s.pitreBrap) {
      out.push({ speaker: e.p, line: 'brap', delayMs: 0, priority: PITRE_PRIORITY.brap });
    }
  }
  return out;
}

interface Channel {
  line: PitreLine;
  priority: number;
  startedAt: number;
  endsAt: number;
}

/** Decides which cues actually play (per-speaker channel, cooldowns, global voice cap). */
export class PitreVoiceThrottle {
  private channels = new Map<number, Channel>();
  private lastLine = new Map<string, number>();
  private lastFireWeapon = new Map<number, WeaponId>();
  maxVoices = 4;
  cooldownMs: Partial<Record<PitreLine, number>> = { mama: 600, pussy: 1800, brap: 450 };

  /**
   * Returns true if the cue should start now. `durationMs` is the clip length (for channel
   * occupancy); `weapon` lets automatic weapons avoid restarting "brap" mid-line.
   */
  admit(cue: PitreCue, nowMs: number, durationMs: number, weapon?: WeaponId): boolean {
    const key = `${cue.speaker}:${cue.line}`;
    const cd = this.cooldownMs[cue.line] ?? 0;
    const last = this.lastLine.get(key) ?? -Infinity;
    if (nowMs - last < cd) return false;
    const ch = this.channels.get(cue.speaker);
    const busy = ch && ch.endsAt > nowMs;
    if (busy) {
      if (cue.line === 'brap') {
        const auto = weapon ? WEAPONS[weapon].trigger === 'auto' || WEAPONS[weapon].trigger === 'beam' : false;
        // automatic fire keeps the current brap going; semi-auto may restart it
        if (auto || ch.line !== 'brap' || nowMs - ch.startedAt < 500) return false;
      } else if (cue.priority < ch.priority) return false;
    }
    let active = 0;
    for (const c of this.channels.values()) if (c.endsAt > nowMs) active++;
    if (!busy && active >= this.maxVoices && cue.priority <= PITRE_PRIORITY.mama) return false;
    this.channels.set(cue.speaker, { line: cue.line, priority: cue.priority, startedAt: nowMs, endsAt: nowMs + durationMs });
    this.lastLine.set(key, nowMs);
    if (weapon) this.lastFireWeapon.set(cue.speaker, weapon);
    return true;
  }

  /** Has the speaker's current line been interrupted by a newer one? */
  current(speaker: number): Channel | undefined {
    return this.channels.get(speaker);
  }

  reset() {
    this.channels.clear();
    this.lastLine.clear();
  }
}
