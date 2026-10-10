import { expect, test, type Page } from '@playwright/test';

type HD = {
  state(): { state: string; phase: string };
  host: { lobby: { settings: Record<string, unknown> }; setSettings(s: Record<string, unknown>): void } | null;
};

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Every Spartan card shows its rendered portrait (not the stand-in helmet). */
const portraitsDrawn = (page: Page) =>
  page.waitForFunction(() => [...document.querySelectorAll('.pcard[data-vslot] img')].every((i) => i.getAttribute('src')?.startsWith('data:image/png')), null, { timeout: 30_000 });

test('bot lobby: Spartans with portraits, the map, and the match settings in tabs', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1');
  await page.getByRole('button', { name: /Play vs bots/ }).click();
  const cards = page.locator('.pcards .pcard[data-vslot]');
  await expect(cards).toHaveCount(4);
  await portraitsDrawn(page);
  await expect(page.locator('.gamecard .gtitle')).toHaveText('Standard');
  await expect(page.locator('.mappreview svg circle.on')).toHaveCount(7);
  // a new bot slides in (the others stay put)
  await page.waitForTimeout(1200);
  await page.locator('.addbot').click();
  await expect(cards).toHaveCount(5);
  await expect(page.locator('.pcard.new')).toHaveCount(1);
  await expect(cards.last()).toHaveClass(/\bnew\b/);
  await portraitsDrawn(page);

  // Settings: five tabs, starting on Game
  await page.locator('.open-settings').click();
  const modal = page.locator('.settings-modal');
  await expect(modal.getByRole('tab')).toHaveCount(5);
  await expect(modal.locator('[data-tab=game]')).toHaveAttribute('aria-selected', 'true');
  await expect(modal.locator('.tab.changed')).toHaveCount(0);
  // a preset: the Game card names it, the tabs it changed get a dot, the portraits get rocket launchers
  await modal.getByRole('button', { name: 'Rocket Whack' }).click();
  await expect(page.locator('.gamecard .gtitle')).toHaveText('Rocket Whack');
  await expect(page.locator('.gamecard .glines')).toContainText('Rocket Launcher for everyone');
  await expect(modal.locator('[data-tab=game]')).toHaveClass(/changed/);
  await expect(modal.locator('[data-tab=rules]')).toHaveClass(/changed/);
  await expect(page.locator('.pcard[data-vslot] img[data-want$="-rpg"]')).toHaveCount(5);
  // Power-ups: switch one off and the Game card counts them
  await modal.locator('[data-tab=powerups]').click();
  await modal.locator('.chip[data-v="pokeball"]').click();
  await expect(page.locator('.gamecard .glines')).toContainText('Rare power-ups (13 of 14)');
  await expect(page.locator('.gamecard .gtitle')).toHaveText('Custom');
  // Map: more holes, and both maps follow
  await modal.locator('[data-tab=map]').click();
  await modal.locator('input[data-key=holeCount]').fill('9');
  await expect(page.locator('.mappreview svg circle.on')).toHaveCount(9);
  await expect(modal.locator('.mapprev-modal svg circle.on')).toHaveCount(9);
  await modal.getByRole('button', { name: 'Reset this tab' }).click();
  await expect(page.locator('.mappreview svg circle.on')).toHaveCount(8);
  await expect(modal.locator('[data-tab=map]')).not.toHaveClass(/changed/);
  // Esc closes it; the Map card opens it on the Map tab; Done closes it
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await page.locator('.mapcard [data-open=map]').click();
  await expect(modal.locator('[data-tab=map]')).toHaveAttribute('aria-selected', 'true');
  await modal.locator('.done').click();
  await expect(modal).toHaveCount(0);

  // Options and back to the lobby
  await page.locator('.lobby-head .opts').click();
  await expect(page.locator('.lobby-screen')).toHaveCount(0);
  await page.locator('.back').click();
  await expect(cards).toHaveCount(5);
  await expect(page.locator('.gamecard .gtitle')).toHaveText('Custom');

  await page.locator('.lobby-bar .start').click();
  await page.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().state === 'match', null, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('online lobby: friends load in; they see the settings but only the host changes them', async ({ context }) => {
  const code = `LB${Math.floor(Math.random() * 900 + 100)}`;
  const host = await context.newPage();
  const errors = watchErrors(host);
  await host.goto(`/?test=1&net=bc&quality=low&autostart=host&code=${code}`);
  await host.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().state === 'lobby', null, { timeout: 30_000 });
  await expect(host.locator('.pcard.opencard')).toContainText('7 open slots');
  await expect(host.locator('.lobby-head .code')).toHaveText(code);
  const friend = await context.newPage();
  const friendErrors = watchErrors(friend);
  await friend.goto(`/?test=1&net=bc&quality=low#/join/${code}`);
  // the friend appears on the host's screen
  await expect(host.locator('.pcard[data-vslot]')).toHaveCount(2, { timeout: 30_000 });
  await expect(host.locator('.pcard.me')).not.toHaveClass(/\bnew\b/);
  await expect(host.locator('.pcard.opencard')).toContainText('6 open slots');
  await expect(friend.locator('.pcard[data-vslot]')).toHaveCount(2);
  await expect(friend.locator('.pcard.me .tag.you')).toHaveCount(1);
  await expect(friend.locator('.lobby-bar .start')).toHaveCount(0);
  await expect(friend.locator('.lobby-bar .waiting')).toBeVisible();
  await expect(friend.locator('.addbot, [data-rm]')).toHaveCount(0);

  await friend.locator('.open-settings').click();
  const fm = friend.locator('.settings-modal');
  await expect(fm).toContainText('Only the host can change these');
  await expect(fm.locator('.reset')).toHaveCount(0);
  await expect(fm.locator('[data-preset]')).toHaveCount(0);
  await expect(fm.locator('select[data-key=weaponMode]')).toBeDisabled();
  // the host changes the rules: the friend's window (still open) and lobby follow
  await host.evaluate(() => {
    const h = (window as unknown as { __hd: HD }).__hd.host!;
    h.setSettings({ ...h.lobby.settings, weaponMode: 'choice' });
  });
  await expect(fm.locator('select[data-key=weaponMode]')).toHaveValue('choice');
  await expect(friend.locator('.mecard .pick')).toBeVisible();
  await expect(fm).toBeVisible();
  await expect(fm.locator('[data-tab=game]')).toHaveClass(/changed/);
  expect(errors).toEqual([]);
  expect(friendErrors).toEqual([]);
});

test('lobby and settings window fit a phone screen', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?test=1');
  await page.getByRole('button', { name: /Play vs bots/ }).click();
  await expect(page.locator('.pcards .pcard[data-vslot]')).toHaveCount(4);
  // nothing sticks out sideways (the screen hides sideways overflow, so look at every element)
  const sticksOut = (sel: string) =>
    page.evaluate((s) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(s)) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && el.offsetParent !== null && (r.left < -1 || r.right > innerWidth + 1)) out.push(`${el.tagName}.${el.className}`);
      }
      return out;
    }, sel);
  expect(await sticksOut('.lobby-screen *')).toEqual([]);
  const bar = await page.locator('.lobby-bar').boundingBox();
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(844 + 1);
  await page.locator('.open-settings').click();
  for (const t of ['game', 'rules', 'powerups', 'map', 'extras']) {
    await page.locator(`.settings-modal [data-tab=${t}]`).click();
    expect(await sticksOut('.settings-modal *')).toEqual([]);
  }
  // full screen on a phone
  const m = await page.locator('.settings-modal').boundingBox();
  expect(m!.width).toBeGreaterThan(385);
  expect(errors).toEqual([]);
});

test('Players choose: the host allows or bans each weapon (All / None, never fewer than one)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1');
  await page.getByRole('button', { name: /Play vs bots/ }).click();
  await page.locator('.open-settings').click();
  const modal = page.locator('.settings-modal');
  await modal.locator('select[data-key=weaponMode]').selectOption('choice');
  const chips = modal.locator('.chip[data-key=allowedWeapons]');
  await expect(chips).toHaveCount(10);
  await expect(modal.locator('.chip[data-key=allowedWeapons].on')).toHaveCount(10);
  // None keeps just the first one; it can't be switched off
  await modal.locator('[data-bulk=allowedWeapons][data-all="0"]').click();
  await expect(modal.locator('.chip[data-key=allowedWeapons].on')).toHaveCount(1);
  await modal.locator('.chip[data-key=allowedWeapons][data-v=sniper]').click();
  await expect(modal.locator('.chip[data-key=allowedWeapons].on')).toHaveCount(1);
  // tap to add some back
  await modal.locator('.chip[data-key=allowedWeapons][data-v=rpg]').click();
  await modal.locator('.chip[data-key=allowedWeapons][data-v=needler]').click();
  await expect(modal.locator('.chip[data-key=allowedWeapons].on')).toHaveCount(3);
  expect(await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.host!.lobby.settings.allowedWeapons)).toEqual(['sniper', 'rpg', 'needler']);
  // the lobby's weapon list follows
  await modal.locator('.done').click();
  await expect(page.locator('.mecard select.pick option')).toHaveCount(3);
  await page.locator('.open-settings').click();
  await modal.locator('[data-bulk=allowedWeapons][data-all="1"]').click();
  await expect(modal.locator('.chip[data-key=allowedWeapons].on')).toHaveCount(10);
  expect(errors).toEqual([]);
});
