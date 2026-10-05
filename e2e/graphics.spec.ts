import { expect, test, type Page } from '@playwright/test';

type Render = { post: boolean; pbr: boolean; shadows: boolean; level: string; particles: number };
type HD = { state(): { phase: string; render: Render } };
const render = (page: Page) => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.state().render);

test('graphics settings apply mid-match from the pause menu (Ultra preset, Advanced, FPS counter)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test=1&autostart=offline&bots=1&botdiff=jerry&quality=medium&respawn=auto');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
  expect(await render(page)).toMatchObject({ level: 'medium', post: false, pbr: false, shadows: true });

  // pause → Options
  await page.keyboard.press('Escape');
  await page.locator('.pause [data-a=options]').click();
  const quality = page.locator('select[data-k=quality]');
  await expect(quality.locator('option')).toHaveText([/^Auto/, 'Low', 'Medium', 'High', 'Ultra']);

  // a preset switch applies straight away: bloom + PBR on High
  await quality.selectOption('high');
  await page.waitForFunction(() => {
    const r = (window as unknown as { __hd: HD }).__hd.state().render;
    return r.level === 'high' && r.post && r.pbr;
  }, null, { timeout: 15_000 });

  // Advanced: shadows off (live), FPS counter
  await page.locator('details.gfx-adv summary').click();
  await expect(page.locator('select[data-gfx=shadows] option').first()).toHaveText('Preset (High (moving))');
  await page.locator('select[data-gfx=shadows]').selectOption('off');
  await page.waitForFunction(() => !(window as unknown as { __hd: HD }).__hd.state().render.shadows, null, { timeout: 10_000 });
  await page.locator('select[data-gfx=effects]').selectOption('low');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().render.particles === 180, null, { timeout: 10_000 });
  await page.locator('input[data-fps]').check();
  await page.locator('.back').click();
  await expect(page.locator('.fps')).toContainText('fps', { timeout: 10_000 });

  // the choices are remembered for the next match
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hd.options') ?? '{}'));
  expect(saved).toMatchObject({ quality: 'high', gfx: { shadows: 'off', effects: 'low' }, fpsCounter: true });
  expect(errors).toEqual([]);
});
