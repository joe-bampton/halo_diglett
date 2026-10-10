import { expect, test } from '@playwright/test';

type HD = {
  state(): { phase: string; frames: number; me: { pu: [string, number][]; inv: [string, number][] } | null };
  game: { input: { s: { yaw: number; presses: number; stand: boolean }; device: string } } | null;
  grant(id: string): void;
};

test('controller: right stick aims, A stands, RT fires', async ({ page }) => {
  await page.addInitScript(() => {
    const pad = {
      id: 'Fake Xbox Controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null] });
  });
  await page.goto('/?test=1&autostart=offline&bots=1&quality=low&respawn=auto&botdiff=jerry');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
  const read = () => page.evaluate(() => ({ ...(window as unknown as { __hd: HD }).__hd.game!.input.s, device: (window as unknown as { __hd: HD }).__hd.game!.input.device }));
  const before = await read();
  // push right stick + hold A
  await page.evaluate(() => {
    const p = (window as unknown as { __pad: { axes: number[]; buttons: { pressed: boolean; value: number }[] } }).__pad;
    p.axes[2] = 0.9;
    p.buttons[0]!.pressed = true;
    p.buttons[0]!.value = 1;
  });
  await page.waitForTimeout(1500);
  const mid = await read();
  expect(mid.device).toBe('pad');
  expect(mid.stand).toBe(true);
  expect(Math.abs(mid.yaw - before.yaw)).toBeGreaterThan(0.2);
  // pull the right trigger
  await page.evaluate(() => {
    const p = (window as unknown as { __pad: { axes: number[]; buttons: { pressed: boolean; value: number }[] } }).__pad;
    p.axes[2] = 0;
    p.buttons[7]!.pressed = true;
    p.buttons[7]!.value = 1;
  });
  await page.waitForTimeout(800);
  const after = await read();
  expect(after.presses).toBeGreaterThan(before.presses);
  // D-pad right picks the next power-up, RB uses it
  await page.evaluate(() => {
    const h = (window as unknown as { __hd: HD }).__hd;
    h.grant('xray');
    h.grant('quickhands');
  });
  await expect(page.locator('.hud .inv .it')).toHaveCount(2);
  await expect(page.locator('.hud .inv .cap')).toHaveText('X-Ray Vision');
  await expect(page.locator('.hud .inv kbd')).toHaveText('RB');
  // press and release a button, each held for a few frames (a software renderer can be slow)
  const frames = () => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.state().frames);
  const tap = async (i: number) => {
    for (const down of [true, false]) {
      await page.evaluate(([b, d]) => {
        const p = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } }).__pad;
        p.buttons[b as number]!.pressed = d as boolean;
        p.buttons[b as number]!.value = d ? 1 : 0;
      }, [i, down]);
      const f0 = await frames();
      await page.waitForFunction((f) => (window as unknown as { __hd: HD }).__hd.state().frames >= f + 3, f0, { timeout: 10_000 });
    }
  };
  await tap(15);
  await expect(page.locator('.hud .inv .cap')).toHaveText('Quick Hands');
  await tap(5);
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.state().me?.pu ?? []).some(([id]) => id === 'quickhands'), null, { timeout: 5000 });
});
