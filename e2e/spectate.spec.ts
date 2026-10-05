import { expect, test, type Page } from '@playwright/test';

type HD = {
  state(): {
    phase: string;
    slot: number;
    mode: string;
    me: { al: boolean } | null;
    spec: { active: boolean; target: number; view: string; dist: number } | undefined;
  };
  kill(slot?: number): void;
  game: { input: { s: { yaw: number; pitch: number; presses: number } } } | null;
};
const hd = (page: Page) => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.state());

test('dead players spectate (cycle, 1st/3rd person, zoom) until they press Jump', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test=1&autostart=offline&bots=2&quality=low');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.kill());
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().me?.al === false, null, { timeout: 10_000 });
  // after the short death cam the spectator camera takes over
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().spec?.active === true, null, { timeout: 6000 });
  const st = await hd(page);
  expect(st.mode).toBe('spectate');
  expect(st.spec!.target).not.toBe(st.slot);
  await expect(page.locator('.hud .spectate.on')).toBeVisible();
  await expect(page.locator('.hud .sub-msg')).toContainText('SPACE');
  const aim0 = await page.evaluate(() => ({ ...(window as unknown as { __hd: HD }).__hd.game!.input.s }));

  // E switches to the next player
  await page.keyboard.press('KeyE');
  await page.waitForFunction((t) => (window as unknown as { __hd: HD }).__hd.state().spec!.target !== t, st.spec!.target, { timeout: 3000 });
  // F toggles first / third person
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().spec!.view === 'first', null, { timeout: 3000 });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().spec!.view === 'third', null, { timeout: 3000 });
  // the mouse wheel zooms the orbit camera
  const d0 = (await hd(page)).spec!.dist;
  const box = (await page.locator('canvas.game').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  await page.waitForFunction((d) => (window as unknown as { __hd: HD }).__hd.state().spec!.dist > d + 1, d0, { timeout: 3000 });

  // spectating never moves the player's own aim or fires
  const aim1 = await page.evaluate(() => ({ ...(window as unknown as { __hd: HD }).__hd.game!.input.s }));
  expect(aim1.yaw).toBe(aim0.yaw);
  expect(aim1.pitch).toBe(aim0.pitch);
  expect(aim1.presses).toBe(aim0.presses);

  // still down long after the 3 s respawn timer: manual respawn
  await page.waitForTimeout(3500);
  expect((await hd(page)).me!.al).toBe(false);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().me?.al === true, null, { timeout: 5000 });
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().mode === 'play', null, { timeout: 3000 });
  await expect(page.locator('.hud .spectate.on')).toHaveCount(0);
  expect(errors).toEqual([]);
});
