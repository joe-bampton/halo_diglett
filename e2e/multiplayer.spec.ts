import { expect, test, type Page } from '@playwright/test';

type HD = {
  state(): { state: string; phase: string; tick: number; frames: number; slot: number; players: { slot: number; kills: number; alive: boolean; exposure: number }[]; lobby: { slots: { slot: number; name: string; kind: string }[] } | null };
  host: { addBot(d: string): void; startMatch(): void; match: { players: ({ kills: number } | null)[] } | null } | null;
  stand(on?: boolean): void;
  aimAt(slot: number): boolean;
  fire(): void;
};
const W = 'window as unknown as { __hd: HD }';
void W;
const st = (page: Page) => page.evaluate(() => (window as unknown as { __hd: HD }).__hd.state());

test('host + friend over BroadcastChannel: join, kill, reload & rejoin', async ({ context }) => {
  test.setTimeout(180_000);
  const code = `E2E${Math.floor(Math.random() * 900 + 100)}`;
  const host = await context.newPage();
  const errors: string[] = [];
  for (const p of [host]) p.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`/?test=1&net=bc&quality=low&autostart=host&respawn=auto&code=${code}`);
  await host.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().state === 'lobby', null, { timeout: 30_000 });

  const friend = await context.newPage();
  friend.on('pageerror', (e) => errors.push(e.message));
  await friend.goto(`/?test=1&net=bc&quality=low#/join/${code}`);
  await friend.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().state === 'lobby', null, { timeout: 30_000 });
  await host.waitForFunction(() => ((window as unknown as { __hd: HD }).__hd.state().lobby?.slots.length ?? 0) === 2);

  await host.evaluate(() => {
    const h = (window as unknown as { __hd: HD }).__hd.host!;
    h.addBot('recruit');
    h.startMatch();
  });
  await friend.waitForFunction(() => (window as unknown as { __hd: HD }).__hd.state().phase === 'live', null, { timeout: 60_000 });
  const fs = await st(friend);
  const botSlot = fs.lobby!.slots.find((s) => s.kind === 'bot')!.slot;
  await friend.evaluate(() => (window as unknown as { __hd: HD }).__hd.stand(true));
  await friend.waitForFunction(
    (bot) => {
      const h = (window as unknown as { __hd: HD }).__hd;
      const s = h.state();
      if ((s.players.find((p) => p.slot === s.slot)?.kills ?? 0) > 0) return true;
      if (h.aimAt(bot)) h.fire();
      return false;
    },
    botSlot,
    { timeout: 90_000, polling: 250 },
  );
  const mySlot = fs.slot;
  const hostKills = await host.evaluate((slot) => (window as unknown as { __hd: HD }).__hd.host!.match!.players[slot]!.kills, mySlot);
  expect(hostKills).toBeGreaterThan(0);

  // friend reloads the tab: same slot, same score
  await friend.reload();
  await friend.waitForFunction(() => (window as unknown as { __hd: HD }).__hd?.state().state === 'match', null, { timeout: 30_000 });
  const after = await st(friend);
  expect(after.slot).toBe(mySlot);
  await friend.waitForFunction((slot) => ((window as unknown as { __hd: HD }).__hd.state().players.find((p) => p.slot === slot)?.kills ?? 0) > 0, mySlot, { timeout: 10_000 });
  expect(errors).toEqual([]);
});
