import { expect, test, type Page } from '@playwright/test';

type HD = {
  state(): { phase: string; slot: number; mode: string; me: { al: boolean } | null; players: { slot: number; alive: boolean }[] };
  kill(slot?: number, by?: number, weapon?: string): void;
};
const hd = (page: Page) => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.state());
/** each step takes a frame or two, and the software-rendered test browser can drop to ~1 fps */
const WAIT = 10_000;

test('Players choose: dead players pick the gun to respawn with, starting on the last one', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test=1&autostart=offline&bots=2&mode=choice&quality=low');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
  // nobody picked in the lobby: the first allowed gun
  await expect(page.locator('.hud .ammo .wname')).toHaveText('SNIPER RIFLE');
  await expect(page.locator('.hud .wpick.on')).toHaveCount(0);

  await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.kill());
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().me?.al === false, null, { timeout: WAIT });
  const picker = page.locator('.hud .wpick.on');
  await expect(picker).toBeVisible({ timeout: WAIT });
  // every allowed gun, the one we just used picked
  await expect(picker.locator('.wc')).toHaveCount(10);
  await expect(picker.locator('.wc.sel')).toHaveAttribute('data-w', 'sniper');

  // 2 picks the second gun, ↓ the next one along
  await page.keyboard.press('Digit2');
  await expect(picker.locator('.wc.sel')).toHaveAttribute('data-w', 'br', { timeout: WAIT });
  await page.keyboard.press('ArrowDown');
  await expect(picker.locator('.wc.sel')).toHaveAttribute('data-w', 'crossbow', { timeout: WAIT });
  await page.keyboard.press('ArrowUp');
  await expect(picker.locator('.wc.sel')).toHaveAttribute('data-w', 'br', { timeout: WAIT });

  await page.waitForTimeout(3200);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().me?.al === true, null, { timeout: WAIT });
  await expect(page.locator('.hud .ammo .wname')).toHaveText('BATTLE RIFLE', { timeout: WAIT });
  await expect(page.locator('.hud .wpick.on')).toHaveCount(0);

  // next death: the picker starts on the Battle Rifle
  await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.kill());
  await expect(picker.locator('.wc.sel')).toHaveAttribute('data-w', 'br', { timeout: WAIT });
  expect(errors).toEqual([]);
});

test('the kill feed shows who killed whom with the weapon’s icon', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test=1&autostart=offline&bots=2&quality=low');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
  const st = await hd(page);
  const bot = st.players.find((p) => p.slot !== st.slot)!.slot;
  await page.evaluate(([v, a]) => (window as unknown as { __hd: HD }).__hd.kill(v, a, 'rpg'), [bot, st.slot]);
  const line = page.locator('.hud .killfeed div').first();
  await expect(line).toBeVisible({ timeout: WAIT });
  // the rocket launcher's silhouette (its short name where WebGL can't draw it)
  const icon = line.locator('img.wi');
  if (await icon.count()) await expect(icon).toHaveAttribute('alt', 'RPG');
  else await expect(line).toContainText('[RPG]');
  expect(errors).toEqual([]);
});
