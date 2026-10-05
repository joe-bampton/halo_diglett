import './ui/styles.css';
import { App } from './app/app';
import { audio } from './audio/audio';
import { voice } from './audio/voice';
import { BOT_PROFILES } from './bots/brain';
import type { BotDifficulty } from './sim/types';
import type { Settings } from './sim/settings';
import type { WeaponId } from './sim/weapons';
import { eyePos, hitboxOf } from './sim/hitbox';
import { damagePlayer } from './sim/match';
import { yawPitchOf } from './shared/vec';

const root = document.getElementById('app')!;

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!webglOk()) {
  root.innerHTML = '<div class="screen"><div class="title-logo"><div class="t2">DIGLETT</div></div><p class="err">Your browser does not support WebGL, which the game needs.</p></div>';
} else {
  const app = new App(root);
  const params = new URLSearchParams(location.search);
  const auto = params.get('autostart');
  // match settings from the URL (quick testing): weapon, orbs, pitre, mode, respawn
  const settings: Partial<Settings> = {};
  if (params.get('weapon')) settings.weapon = params.get('weapon') as WeaponId;
  if (params.get('orbs')) settings.orbRate = params.get('orbs') as Settings['orbRate'];
  if (params.get('pitre')) settings.pitre = params.get('pitre') !== '0';
  if (params.get('mode')) settings.weaponMode = params.get('mode') as Settings['weaponMode'];
  if (params.get('respawn')) settings.respawnMode = params.get('respawn') === 'auto' ? 'auto' : 'manual';
  if (params.get('holes')) settings.holeCount = Number(params.get('holes'));
  if (params.get('spacing')) settings.holeSpacing = Number(params.get('spacing'));
  if (auto === 'offline') {
    const bots = Number(params.get('bots') ?? 3);
    // botdiff=jerry or botdiff=jerry,topover (cycled); default mixes normal → recruit
    const picked = (params.get('botdiff') ?? '').split(',').filter((d): d is BotDifficulty => d in BOT_PROFILES);
    const cycle: BotDifficulty[] = picked.length ? picked : ['normal', 'heroic', 'legendary', 'recruit'];
    const diffs = Array.from({ length: Math.min(6, bots) }, (_, i) => cycle[i % cycle.length]!);
    app.startOffline({ bots: diffs, settings, autostart: true });
  } else if (auto === 'host') {
    void app.hostOnline(params.get('code') ?? undefined, settings);
  } else app.route();

  if (params.has('test')) {
    (window as unknown as { __hd: unknown }).__hd = {
      app,
      get host() {
        return app.host;
      },
      get session() {
        return app.session;
      },
      get game() {
        return app.game;
      },
      audio,
      voice,
      stand(on = true) {
        if (app.game) app.game.input.testStand = on;
      },
      look(yaw: number, pitch = 0) {
        if (app.game) {
          app.game.input.s.yaw = yaw;
          app.game.input.s.pitch = pitch;
        }
      },
      /** aim the local player at another player's head (uses the interpolated view) */
      aimAt(slot: number) {
        const g = app.game, s = app.session;
        const me = s?.players[s.slot], t = s?.players[slot];
        if (!g || !s || !me || !t) return false;
        const ar = g.arena;
        const eye = eyePos(ar.holes[me.hole]!, s.myExposure);
        const hb = hitboxOf(ar.holes[t.hole]!, t.exposure);
        const a = yawPitchOf({ x: hb.head.x - eye.x, y: hb.head.y - eye.y, z: hb.head.z - eye.z });
        g.input.s.yaw = a.yaw;
        g.input.s.pitch = a.pitch;
        return t.exposure > 0.9 && s.myExposure > 0.95;
      },
      /** kill a player (default: me) on the host — offline / host only */
      kill(slot?: number) {
        const target = slot ?? app.session?.slot ?? -1;
        app.host?.debugApply((m, ctx) => {
          const p = m.players[target];
          if (p?.alive) damagePlayer(m, ctx, -1, p, 9999, { head: false, weapon: 'sniper', kind: 'direct' });
        });
      },
      /** press Jump while dead (manual respawn) */
      respawn() {
        if (app.game) app.game.input.s.respawns++;
      },
      fire() {
        const g = app.game;
        if (!g) return;
        g.input.s.presses++;
        (g as unknown as { pred: { pending: boolean } }).pred.pending = true;
      },
      state() {
        const s = app.session;
        return {
          state: s?.state,
          slot: s?.slot,
          phase: s?.phase,
          tick: s?.latestTick ?? 0,
          players: s?.players.filter(Boolean).map((p) => ({ slot: p!.slot, name: p!.name, kills: p!.kills, deaths: p!.deaths, alive: p!.alive, exposure: p!.exposure })),
          me: s?.me,
          frames: app.game?.frames ?? 0,
          events: app.game?.eventCounts ?? {},
          render: app.game?.renderInfo(),
          spec: app.game?.specState(),
          mode: app.game?.input.mode,
          lobby: s?.lobby,
        };
      },
    };
  }
}

// PWA-ish: make sure iOS doesn't rubber-band or double-tap zoom
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
