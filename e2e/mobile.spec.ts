import { expect, test } from '@playwright/test';

type HD = {
  state(): { phase: string; frames: number; me: { al: boolean; pu: [string, number][]; inv: [string, number][] } | null };
  game: { input: { s: { yaw: number; stand: boolean }; device: string } } | null;
  grant(id: string): void;
};

test('touch controls: stand toggle and drag-to-aim', async ({ page }) => {
  await page.goto('/?test=1&autostart=offline&bots=2&quality=low&respawn=auto&botdiff=jerry');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().frames > 2, null, { timeout: 40_000 });
  await expect(page.locator('.touch.on')).toBeVisible();
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().phase === 'live', null, { timeout: 60_000 });
  // quick tap toggles standing
  await page.locator('.tstand').tap();
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.game?.input.s.stand === true, null, { timeout: 5000 });
  // drag on the right half of the screen turns the view
  const yaw0 = await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.game!.input.s.yaw);
  const box = (await page.locator('canvas.game').boundingBox())!;
  const x = box.x + box.width * 0.6, y = box.y + box.height * 0.4;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * 15, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const yaw1 = await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.game!.input.s.yaw);
  expect(Math.abs(yaw1 - yaw0)).toBeGreaterThan(0.1);
  // the USE button appears with something in the inventory, shows it, and uses it
  await expect(page.locator('.tuse')).toBeHidden();
  await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.grant('camo'));
  await expect(page.locator('.tuse')).toBeVisible();
  await expect(page.locator('.tuse .ic')).toHaveText('◌');
  await page.locator('.tuse').tap();
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.state().me?.pu ?? []).some(([id]) => id === 'camo'), null, { timeout: 5000 });
  await expect(page.locator('.tuse')).toBeHidden();
});
