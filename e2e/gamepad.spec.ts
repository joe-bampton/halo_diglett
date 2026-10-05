import { expect, test } from '@playwright/test';

type HD = { state(): { phase: string; frames: number }; game: { input: { s: { yaw: number; presses: number; stand: boolean }; device: string } } | null };

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
  await page.goto('/?test=1&autostart=offline&bots=1&quality=low&respawn=auto');
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
});
