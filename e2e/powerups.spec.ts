import { expect, test, type Page } from '@playwright/test';

type HD = {
  state(): { phase: string; slot: number; me: { al: boolean; pu: [string, number][] } | null };
  grant(id: string, slot?: number): void;
  session: { slot: number; players: ({ springAt: number } | null)[] };
  game: { camera: { position: { y: number } } } | null;
};
const W = (page: Page) => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.state());

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('Spring Jump: double-tap Space launches you 20 m up', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1&autostart=offline&bots=2&botdiff=jerry&quality=low&respawn=auto');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.grant('spring'));
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.state().me?.pu ?? []).some(([id]) => id === 'spring'), null, { timeout: 5000 });
  await expect(page.locator('.hud .pu.held')).toHaveCount(1);
  // a quick double-tap of Space (dispatched together: two separate round trips can exceed the 300 ms window on a slow CI renderer)
  const springs = await page.evaluate(() => {
    for (let i = 0; i < 2; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' }));
    }
    return (window as unknown as { __hd: { game: { input: { s: { springs: number } } } } }).__hd.game.input.s.springs;
  });
  expect(springs).toBe(1);
  await page.waitForFunction(() => {
    const h = (window as unknown as { __hd: HD }).__hd;
    return (h.session.players[h.session.slot]?.springAt ?? -1) >= 0;
  }, null, { timeout: 5000 });
  // the camera rides the jump
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.game?.camera.position.y ?? 0) > 10, null, { timeout: 5000 });
  await expect(page.locator('.hud .pu.held')).toHaveCount(0);
  // ...and comes back down into the hole
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.game?.camera.position.y ?? 99) < 5, null, { timeout: 10_000 });
  expect((await W(page)).me?.al).toBe(true);
  expect(errors).toEqual([]);
});
