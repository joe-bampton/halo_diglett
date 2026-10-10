import { expect, test, type Page } from '@playwright/test';

type HD = {
  state(): { phase: string; slot: number; me: { al: boolean; pu: [string, number][]; inv: [string, number][]; sa: number; su: number } | null; players: { slot: number }[] };
  grant(id: string, slot?: number): void;
  session: { slot: number; hostTick: number; players: ({ springAt: number } | null)[] };
  game: { camera: { position: { y: number } }; input: { s: { springs: number } }; orbs: Map<number, { group: { userData: { kind?: string } } }> } | null;
};
const W = (page: Page) => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.state());

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const inv = (page: Page) => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.state().me?.inv ?? []);

test('inventory: power-ups wait at the bottom of the screen; arrows pick one, Q uses it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1&autostart=offline&bots=1&botdiff=jerry&quality=low&respawn=auto');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
  await page.evaluate(() => {
    const h = (window as unknown as { __hd: HD }).__hd;
    h.grant('homing');
    h.grant('damage');
    h.grant('damage');
  });
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.state().me?.inv ?? []).length === 2, null, { timeout: 5000 });
  const items = page.locator('.hud .inv .it');
  await expect(items).toHaveCount(2);
  // the first one picked up is picked; the other shows it has two
  await expect(page.locator('.hud .inv .cap')).toHaveText('Homing Rounds');
  await expect(items.nth(1).locator('.n')).toHaveText('×2');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.hud .inv .cap')).toHaveText('Damage Boost');
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.state().me?.pu ?? []).some(([id]) => id === 'damage'), null, { timeout: 5000 });
  expect(await inv(page)).toEqual([['homing', 1], ['damage', 1]]);
  // the second one is ready straight away; when it's gone the pick moves on
  await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.state().me?.inv ?? []).length === 1, null, { timeout: 5000 });
  await expect(page.locator('.hud .inv .cap')).toHaveText('Homing Rounds');
  await expect(items).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Spring Jump: double-tap Space launches you 20 m up', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1&autostart=offline&bots=2&botdiff=jerry&quality=low&respawn=auto');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.grant('spring'));
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.state().me?.inv ?? []).some(([id]) => id === 'spring'), null, { timeout: 5000 });
  await expect(page.locator('.hud .inv .it')).toHaveCount(1);
  // a quick double-tap of Space (dispatched together: two separate round trips can exceed the 300 ms window on a slow CI renderer)
  const springs = await page.evaluate(() => {
    // the very first key press unlocks (and renders) the audio, which takes a moment — get that out of the way
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX', key: 'x' }));
    for (let i = 0; i < 2; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' }));
    }
    return (window as unknown as { __hd: HD }).__hd.game!.input.s.springs;
  });
  expect(springs).toBe(1);
  await page.waitForFunction(() => {
    const h = (window as unknown as { __hd: HD }).__hd;
    return (h.session.players[h.session.slot]?.springAt ?? -1) >= 0;
  }, null, { timeout: 5000 });
  // the camera rides the jump
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.game?.camera.position.y ?? 0) > 10, null, { timeout: 5000 });
  await expect(page.locator('.hud .inv .it')).toHaveCount(0);
  // ...and comes back down into the hole
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.game?.camera.position.y ?? 99) < 5, null, { timeout: 10_000 });
  expect((await W(page)).me?.al).toBe(true);
  expect(errors).toEqual([]);
});

test('Gerry Sauce: a bot squirts, my screen gets covered in custard, then clears', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1&autostart=offline&bots=1&botdiff=jerry&quality=low&respawn=auto');
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
  const st = await W(page);
  const bot = st.players.find((p) => p.slot !== st.slot)!.slot;
  // bots fire the Super Soaker as soon as they have it
  await page.evaluate((slot) => (window as unknown as { __hd: HD }).__hd.grant('sauce', slot), bot);
  await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.state().me?.sa ?? -1) >= 0, null, { timeout: 15_000 });
  await expect(page.locator('.hud .sauce.on')).toBeVisible();
  await expect(page.locator('.hud .sauce.on')).toHaveAttribute('data-blobs', '13');
  // five seconds (of game time: a slow software renderer can run the game slower than real time) later it's all cleaned up
  const until = (await W(page)).me!.su;
  await page.waitForFunction((su) => (window as unknown as { __hd: HD }).__hd.session.hostTick >= su + 6, until, { timeout: 90_000 });
  await expect(page.locator('.hud .sauce.on')).toHaveCount(0, { timeout: 5_000 });
  expect(errors).toEqual([]);
});

test('Pitre Mode: power-ups come in energy drink cans', async ({ page }) => {
  const errors = watchErrors(page);
  const kinds = (pitre: string) => async () => {
    await page.goto(`/?test=1&autostart=offline&bots=1&botdiff=jerry&quality=low&respawn=auto&orbs=chaos&pitre=${pitre}`);
    await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().phase === 'live', null, { timeout: 60_000 });
    await page.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.game?.orbs.size ?? 0) > 0, null, { timeout: 30_000 });
    return page.evaluate(() => [...(window as unknown as { __hd: HD }).__hd.game!.orbs.values()].map((v) => v.group.userData.kind));
  };
  expect(new Set(await kinds('1')())).toEqual(new Set(['can']));
  expect(new Set(await kinds('0')())).toEqual(new Set(['ball']));
  expect(errors).toEqual([]);
});
