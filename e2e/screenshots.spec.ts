import { test, type Page } from '@playwright/test';

/**
 * Review screenshots of the new features, written to screenshots/. Off by default (slow); run with
 *   SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
 */
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to take review screenshots');
test.setTimeout(240_000);

type HD = {
  state(): { phase: string; slot: number; spec?: { active: boolean; target: number }; render: { models: string; post: boolean }; players: { slot: number }[] };
  session: { slot: number; hostTick: number; players: ({ exposure: number; yaw: number; springAt: number } | null)[] };
  game: {
    input: { s: { yaw: number; pitch: number; zoom: number }; spec: { yaw: number; pitch: number; dist: number } };
    camera: { position: { x: number; y: number; z: number } };
    orbs: Map<number, { group: { position: { x: number; y: number; z: number } } }>;
  };
  stand(on?: boolean): void;
  kill(slot?: number): void;
  grant(id: string, slot?: number): void;
  aimAt(slot: number): boolean;
};
const hd = (page: Page) => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.state());
const dir = 'screenshots';

async function start(page: Page, query: string) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?test=1&autostart=offline&${query}`);
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 90_000 });
}

/** Die, then orbit (3rd person) whoever we spectate once they're standing. */
async function orbitBot(page: Page, dist: number) {
  await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.kill());
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().spec?.active === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => {
    const h = (window as unknown as { __hd: HD }).__hd;
    return (h.session.players[h.state().spec!.target]?.exposure ?? 0) > 0.95;
  }, null, { timeout: 60_000 });
  await page.evaluate((d) => {
    const h = (window as unknown as { __hd: HD }).__hd;
    const t = h.session.players[h.state().spec!.target]!;
    Object.assign(h.game.input.spec, { dist: d, pitch: -0.08, yaw: t.yaw + Math.PI * 0.85 });
  }, dist);
  await page.waitForTimeout(2000);
}

test('detailed Spartan, High (spectating, 3rd person)', async ({ page }) => {
  await start(page, 'bots=1&botdiff=topover&quality=high&weapon=br');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().render.models === 'detailed', null, { timeout: 60_000 });
  // the spectated player's name banner would cover the model
  await page.addStyleTag({ content: '.hud .center-msg, .hud .sub-msg { display: none }' });
  await orbitBot(page, 2.4);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${dir}/spartan-high.png` });
});

for (const q of ['low', 'ultra'] as const)
  test(`same view on ${q}`, async ({ page }) => {
    await start(page, `bots=3&botdiff=jerry&quality=${q}&respawn=auto`);
    await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.stand(true));
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${dir}/quality-${q}.png` });
  });

test('Spring Jump: the view from the top', async ({ page }) => {
  await start(page, 'bots=3&botdiff=jerry&quality=medium&respawn=auto');
  await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.grant('spring'));
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX', key: 'x' }));
    for (let i = 0; i < 2; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' }));
    }
    const h = (window as unknown as { __hd: HD }).__hd;
    h.game.input.s.pitch = -0.75;
  });
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.game.camera.position.y ?? 0) > 16, null, { timeout: 30_000 });
  await page.screenshot({ path: `${dir}/spring-apex.png` });
});

test('Gerry Sauce: covered in custard', async ({ page }) => {
  await start(page, 'bots=1&botdiff=jerry&quality=medium&respawn=auto');
  const st = await hd(page);
  const bot = st.players.find((p) => p.slot !== st.slot)!.slot;
  await page.evaluate((b) => (window as unknown as { __hd: HD }).__hd.grant('sauce', b), bot);
  await page.waitForSelector('.hud .sauce.on', { timeout: 60_000 });
  // it also pulls you up out of your hole
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/sauce-overlay.png` });
});

test('Pitre Mode energy drink cans', async ({ page }) => {
  await start(page, 'bots=1&botdiff=jerry&quality=high&respawn=auto&pitre=1&orbs=chaos');
  await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.stand(true));
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.game.orbs.size ?? 0) > 0, null, { timeout: 90_000 });
  // keep the scope on the nearest can
  await page.evaluate(() => {
    const g = (window as unknown as { __hd: HD }).__hd.game;
    const aim = () => {
      let best: { x: number; y: number; z: number } | null = null;
      let bd = Infinity;
      const c = g.camera.position;
      for (const v of g.orbs.values()) {
        const p = v.group.position;
        const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        const dx = best.x - c.x, dy = best.y - c.y, dz = best.z - c.z;
        g.input.s.yaw = Math.atan2(-dx, -dz);
        g.input.s.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      }
      requestAnimationFrame(aim);
    };
    aim();
    g.input.s.zoom = 1;
  });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${dir}/pitre-can.png` });
});
