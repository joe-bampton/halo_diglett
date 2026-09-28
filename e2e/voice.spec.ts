import { expect, test, type Page } from '@playwright/test';

type Link = {
  setStream(s: MediaStream | null): void;
  announce(slot: number): void;
  onStream: ((peer: string, s: MediaStream) => void) | null;
  onPeerInfo: ((peer: string, i: { slot: number; mic: boolean }) => void) | null;
  onPeerGone: ((peer: string) => void) | null;
};
type HD = {
  state(): { state: string; slot: number; lobby: { slots: { slot: number; name: string; kind: string }[] } | null };
  app: { showLobby(force: boolean): void };
  session: unknown;
  voice: { attach(l: Link, s: unknown): void; micState: string; players(): { name: string; muted: boolean; mic: boolean; speaking: boolean }[] };
};

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('audio options: category sliders, reset to defaults, offline mic check', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1');
  await page.getByRole('button', { name: /Options/ }).click();
  for (const k of ['master', 'guns', 'sfx', 'voice', 'announcer', 'chat']) await expect(page.locator(`input[data-k="v.${k}"]`)).toHaveCount(1);

  await page.locator('input[data-k="v.guns"]').fill('0.2');
  await page.locator('input[data-k="v.chat"]').fill('0.4');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hd.volumes')!));
  expect(saved.guns).toBeCloseTo(0.2);
  expect(saved.chat).toBeCloseTo(0.4);

  await page.getByRole('button', { name: 'Reset audio to defaults' }).click();
  await expect(page.locator('input[data-k="v.guns"]')).toHaveValue('0.8');
  await expect(page.locator('input[data-k="v.chat"]')).toHaveValue('1');
  const reset = await page.evaluate(() => JSON.parse(localStorage.getItem('hd.volumes')!));
  expect(reset).toEqual({ master: 0.8, guns: 0.8, sfx: 0.8, voice: 0.9, announcer: 0.9, chat: 1 });

  // not in an online game: voice chat explains itself, but the mic can be checked
  await expect(page.locator('.vc-offline')).toBeVisible();
  await page.getByRole('button', { name: 'Enable microphone' }).click();
  await expect(page.getByRole('button', { name: 'Turn mic off' })).toBeVisible();
  await page.waitForFunction(() => {
    const m = document.querySelector<HTMLElement>('.micmeter > div');
    const v = Number(m?.style.transform.match(/scaleX\(([^)]+)\)/)?.[1] ?? 0);
    return v > 0.05;
  }, null, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  expect(await page.evaluate(() => (window as unknown as { __hd: HD }).__hd.voice.micState)).toBe('off');
  expect(errors).toEqual([]);
});

test('lobby voice chat: per-player mute, talking indicator, self-mute key', async ({ context }) => {
  const code = `VC${Math.floor(Math.random() * 900 + 100)}`;
  const host = await context.newPage();
  const errors = watchErrors(host);
  await host.goto(`/?test=1&net=bc&quality=low&autostart=host&code=${code}`);
  await host.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().state === 'lobby', null, { timeout: 30_000 });
  const friend = await context.newPage();
  await friend.goto(`/?test=1&net=bc&quality=low#/join/${code}`);
  await host.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.state().lobby?.slots.length ?? 0) === 2, null, { timeout: 30_000 });
  // BroadcastChannel games carry no audio, so no voice controls
  await expect(host.locator('.vbtn')).toHaveCount(0);

  // plug in a loopback voice link: my own (fake) mic comes back as the friend's voice
  await host.evaluate(() => {
    const h = (window as unknown as { __hd: HD }).__hd;
    const st = h.state();
    const friendSlot = st.lobby!.slots.find((s) => s.slot !== st.slot)!.slot;
    const link: Link = {
      setStream(s) {
        if (!s) return;
        link.onPeerInfo?.('friend', { slot: friendSlot, mic: true });
        link.onStream?.('friend', s.clone());
      },
      announce() {},
      onStream: null,
      onPeerInfo: null,
      onPeerGone: null,
    };
    h.voice.attach(link, h.session);
    h.app.showLobby(true);
  });
  const me = host.locator('[data-vme]');
  await expect(me).toHaveText(/Enable mic/);
  await me.click();
  await expect(me).toHaveText(/Mic on/);

  const friendBtn = host.locator('[data-vmute]');
  await expect(friendBtn).toHaveText('🔊');
  // the fake device beeps, so the friend's row lights up as talking
  await expect(host.locator('.slot.talking[data-vslot]:has([data-vmute])')).toHaveCount(1, { timeout: 15_000 });
  await friendBtn.click();
  await expect(friendBtn).toHaveText('🔇');
  const muted = await host.evaluate(() => (window as unknown as { __hd: HD }).__hd.voice.players()[0]!.muted);
  expect(muted).toBe(true);

  // M toggles my mic
  await host.locator('body').click({ position: { x: 5, y: 5 } });
  await host.keyboard.press('KeyM');
  await expect(me).toHaveText(/Muted/);
  await host.keyboard.press('KeyM');
  await expect(me).toHaveText(/Mic on/);

  // per-player slider in Options
  await host.evaluate(() => (window as unknown as { __hd: { app: { showOptions(b: () => void): void } } }).__hd.app.showOptions(() => {}));
  await expect(host.locator('.vplayer')).toHaveCount(1);
  await host.locator('.vplayer input[type=range]').fill('0.3');
  await expect(host.locator('.vplayer output')).toHaveText('30%');
  const prefs = await host.evaluate(() => JSON.parse(localStorage.getItem('hd.voice')!));
  const name = Object.keys(prefs.peers)[0]!;
  expect(prefs.peers[name]).toEqual({ vol: 0.3, muted: true });
  expect(errors).toEqual([]);
});
