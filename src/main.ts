import './ui/styles.css';
import { App } from './app/app';
import type { BotDifficulty } from './sim/types';
import type { Settings } from './sim/settings';
import type { WeaponId } from './sim/weapons';

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
  if (auto === 'offline') {
    const bots = Number(params.get('bots') ?? 3);
    const diffs: BotDifficulty[] = Array.from({ length: Math.min(6, bots) }, (_, i) => (['normal', 'heroic', 'legendary', 'recruit'] as const)[i % 4]);
    const settings: Partial<Settings> = {};
    if (params.get('weapon')) settings.weapon = params.get('weapon') as WeaponId;
    if (params.get('orbs')) settings.orbRate = params.get('orbs') as Settings['orbRate'];
    if (params.get('pitre')) settings.pitre = true;
    if (params.get('mode')) settings.weaponMode = params.get('mode') as Settings['weaponMode'];
    app.startOffline({ bots: diffs, settings, autostart: true });
  } else if (auto === 'host') {
    void app.hostOnline(params.get('code') ?? undefined);
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
      stand(on = true) {
        if (app.game) app.game.input.testStand = on;
      },
      look(yaw: number, pitch = 0) {
        if (app.game) {
          app.game.input.s.yaw = yaw;
          app.game.input.s.pitch = pitch;
        }
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
          render: app.game?.renderInfo(),
          lobby: s?.lobby,
        };
      },
    };
  }
}

// PWA-ish: make sure iOS doesn't rubber-band or double-tap zoom
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
