import { expect, test } from '@playwright/test';

type Res = { enabled: boolean; connected: boolean; reliable: boolean; ordered: boolean | null; maxRetransmits: number | null; hostGot: number; friendGot: number };
type HD = { netSelfTest(): Promise<Res> };

test('low-latency channel: opens beside the reliable one, unordered and never resent, and carries data both ways', async ({ page }) => {
  await page.goto('/?test=1');
  const r = await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.netSelfTest());
  expect(r.connected).toBe(true);
  expect(r).toMatchObject({ enabled: true, reliable: true, ordered: false, maxRetransmits: 0 });
  expect(r.hostGot).toBeGreaterThan(0);
  expect(r.friendGot).toBeGreaterThan(0);
});

test('?fastnet=0 switches it off (everything goes over the reliable channel)', async ({ page }) => {
  await page.goto('/?test=1&fastnet=0');
  const r = await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.netSelfTest());
  expect(r.enabled).toBe(false);
  expect(r.hostGot + r.friendGot).toBe(0);
});
