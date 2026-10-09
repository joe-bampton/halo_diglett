import { expect, test, type Page } from '@playwright/test';

type HD = { state(): { phase: string; frames: number }; game: { input: { s: { stand: boolean }; suspended: boolean } } | null };
const standing = (page: Page) => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.game!.input.s.stand);
const suspended = (page: Page) => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.game!.input.suspended);

/** Let a few frames render (the input is sampled once a frame). */
async function frames(page: Page, n = 4) {
  const f0 = await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.state().frames);
  await page.waitForFunction((f) => (window as unknown as { __hd: HD }).__hd.state().frames >= f, f0 + n, { timeout: 20_000 });
}

/** Hold Space for a few frames and report whether that stood the Spartan up. */
async function spaceStands(page: Page) {
  await page.keyboard.down('Space');
  await frames(page);
  const up = await standing(page);
  await page.keyboard.up('Space');
  await frames(page);
  return up;
}

test('menus over a match: game keys do nothing behind them, Esc in Options goes straight back to the game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test=1&autostart=offline&bots=1&botdiff=jerry&quality=low&respawn=auto');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
  // the very first key press switches the audio on (a moment's work): get that out of the way
  await page.keyboard.press('KeyX');
  await frames(page);
  // the Spartan answers to Space while playing
  expect(await spaceStands(page)).toBe(true);

  // pause menu: Space doesn't reach the Spartan
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause')).toBeVisible();
  expect(await suspended(page)).toBe(true);
  expect(await spaceStands(page)).toBe(false);

  // Options from the pause menu: still nothing, and Esc means Done
  await page.locator('.pause [data-a=options]').click();
  await expect(page.locator('select[data-k=quality]')).toBeVisible();
  expect(await spaceStands(page)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('select[data-k=quality]')).toHaveCount(0);
  await expect(page.locator('.pause')).toHaveCount(0);
  expect(await suspended(page)).toBe(false);
  expect(await spaceStands(page)).toBe(true);
  expect(errors).toEqual([]);
});
