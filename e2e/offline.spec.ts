import { expect, test, type Page } from '@playwright/test';

type HD = {
  state(): { state: string; phase: string; tick: number; frames: number; slot: number; events: Record<string, number>; players: { slot: number; kills: number; deaths: number; alive: boolean; exposure: number }[]; render: { calls: number; triangles: number } };
  stand(on?: boolean): void;
  aimAt(slot: number): boolean;
  fire(): void;
};
const hd = (page: Page) => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.state());

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('ERR_CERT') && !m.text().includes('fonts.g')) errors.push(m.text());
  });
  return errors;
}

test('offline bot match renders and plays', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1&autostart=offline&bots=5&quality=low&timescale=3');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().frames > 3, null, { timeout: 30_000 });
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().tick > 700, null, { timeout: 60_000 });
  const st = await hd(page);
  expect(st.state).toBe('match');
  expect(st.phase).toBe('live');
  expect(st.players.length).toBe(6);
  expect(st.events.fire ?? 0).toBeGreaterThan(0);
  expect(st.render.calls).toBeGreaterThan(5);
  expect(st.render.calls).toBeLessThan(90);
  // the canvas is not a flat colour
  const shot = await page.locator('canvas.game').screenshot();
  expect(shot.byteLength).toBeGreaterThan(20_000);
  expect(errors).toEqual([]);
});

test('player can stand, aim and kill a bot', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1&autostart=offline&bots=1&quality=low&timescale=1');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.stand(true));
  const killed = await page.waitForFunction(
    () => {
      const h = (window as unknown as { __hd: HD }).__hd;
      const st = h.state();
      const bot = st.players.find((p) => p.slot !== st.slot)!;
      if ((st.players.find((p) => p.slot === st.slot)?.kills ?? 0) > 0) return true;
      if (h.aimAt(bot.slot)) h.fire();
      return false;
    },
    null,
    { timeout: 60_000, polling: 250 },
  );
  expect(await killed.jsonValue()).toBe(true);
  expect(errors).toEqual([]);
});
