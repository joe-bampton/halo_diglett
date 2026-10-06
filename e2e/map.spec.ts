import { expect, test } from '@playwright/test';

type HD = {
  state(): { state: string; phase: string };
  host: { lobby: { settings: Record<string, unknown> }; setSettings(s: Record<string, unknown>): void; startMatch(): void } | null;
  game: { arena: { holes: unknown[]; fenceRadius: number } } | null;
};

test('custom hole count and spacing: lobby map preview and the match field', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test=1&quality=low');
  await page.locator('[data-a=offline]').click();
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().state === 'lobby', null, { timeout: 30_000 });
  // classic field: 16 holes, the most central players + 3 in play (me + 3 bots)
  await expect(page.locator('.mappreview svg circle.on')).toHaveCount(7);
  await expect(page.locator('.mappreview .cap')).toContainText('16 holes');
  await page.evaluate(() => {
    const h = (window as unknown as { __hd: HD }).__hd.host!;
    h.setSettings({ ...h.lobby.settings, holeCount: 8, holeSpacing: 20 });
  });
  await expect(page.locator('.mappreview svg circle.on')).toHaveCount(8);
  await expect(page.locator('.mappreview .cap')).toContainText('at least 20 m apart');
  await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.host!.startMatch());
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().phase === 'live', null, { timeout: 60_000 });
  const a = await page.evaluate(() => {
    const g = (window as unknown as { __hd: HD }).__hd.game!;
    return { holes: g.arena.holes.length, fence: g.arena.fenceRadius };
  });
  expect(a.holes).toBe(8);
  expect(a.fence).toBeGreaterThan(52);
  expect(errors).toEqual([]);
});
