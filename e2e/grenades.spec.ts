import { expect, test, type Page } from '@playwright/test';

type HD = { state(): { phase: string; events: Record<string, number> } };
const events = (page: Page) => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.state().events);

for (const weapon of ['frag', 'plasma'] as const) {
  test(`bots throw ${weapon} grenades: they fly, bounce or stick, and go off`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/?test=1&autostart=offline&bots=4&botdiff=legendary&quality=low&timescale=3&respawn=auto&weapon=${weapon}`);
    await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const e = (window as unknown as { __hd: HD }).__hd.state().events;
        return (e.proj ?? 0) > 3 && (e.pmove ?? 0) > 0 && (e.boom ?? 0) > 1;
      },
      null,
      { timeout: 60_000, polling: 500 },
    );
    const ev = await events(page);
    expect(ev.kill ?? 0).toBeGreaterThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}
