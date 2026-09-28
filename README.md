# Halo Diglett

**Pop up. Snipe. Duck. Repeat.** A browser remake of the Halo Infinite Forge "Diglett" custom mode.

Everyone sits in a stone foxhole on a grassy field. You can only:
- aim
- stand up
- duck
- shoot
- reload

Play with up to **6 friends online** (7 players), or on your own against up to **6 bots**. It runs on:
- desktop (mouse + keyboard)
- controllers (Xbox / PlayStation, via the browser Gamepad API)
- phones and tablets (touch)

> Fan project with original, Halo-*inspired* art and sound. No Halo assets are used. Not affiliated with Microsoft/343.

## How to play

| | Mouse + keyboard | Controller | Touch |
|---|---|---|---|
| Aim | Mouse (click the game to lock the pointer) | Right stick | Drag on the screen, or drag the FIRE button |
| Stand up / duck | Hold **Space** (or toggle in Options), **C/Ctrl** to duck | Hold **A**, or **LB** to toggle | **STAND** button: tap toggles, hold = momentary |
| Shoot | Left click | RT | FIRE |
| Zoom (scope) | Right click (cycles zoom levels) | LT | ZOOM |
| Reload | R | X | RELOAD |
| Scoreboard / menu | Tab / Esc | View / Menu | ≡ / ☰ |

- **Ducking** makes you safe from bullets. Explosions only reach you if a grenade drops into your hole, or if the host turns on *Explosions reach ducked players*.
- **Stay ducked too long** and the *anti-turtle* timer pops you up for 2 seconds.
- **Headshots** do the most damage. With the sniper and crossbow, any headshot kills.
- **Power-up bubbles** are capture-ball-style orbs that drift over the field. Shoot one to claim what's inside: flamethrower, minigun, overshield, invincibility, active camo, damage boost, homing rounds, X-ray vision, big heads, orbital strike or quick hands.
- **Underdog camo** gives a struggling player active camo when they respawn: 5+ kills behind the leader, or 3 deaths in a row.

### Online play (peer-to-peer, no server)
1. Click **Host online game**. You get a room code and an invite link, e.g. `https://…/#/join/K7Q2M`.
2. Friends open the link, or click **Join game** and type the code.
3. Add bots if you like, tweak the settings and press **Start match**.

How it works:
- The host's browser runs the match and the bots. Friends connect directly over WebRTC ([Trystero](https://github.com/dmotz/trystero)).
- Players find each other through public Nostr relays, with BitTorrent trackers as a fallback. No accounts, no server and no cost.
- If a friend refreshes or drops, they can rejoin within 2 minutes and get their slot and score back.
- If the host closes the tab, the match ends. **Host from a desktop/laptop** where possible, and keep the tab open.

**If a friend can't connect:** some networks (strict corporate or mobile carrier NAT) block direct WebRTC. The fix is a free TURN relay.
1. Create a free TURN credential, e.g. [Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/) or [Open Relay](https://www.metered.ca/stun-turn).
2. Give it to the game in one of two ways:
   - Paste it into **Options → Network** as JSON: `{"urls":"turn:host:3478","username":"u","credential":"p"}`.
   - Or set the Vercel environment variables `VITE_TURN_URLS` (comma-separated), `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL`, then redeploy.

## Host settings

Every setting is in the lobby. The **presets** are Classic Diglett, Rocket Whack, Needler Party, Gun Game, Chaos Orbs, Pitre Party and First to 100.

**Match**
- Score limit (0 = unlimited, up to 200)
- Time limit

**Weapons**
- Weapon mode: everyone gets the same weapon, players choose, random every life, or **Gun Game** (each kill upgrades your weapon)
- Available weapons:

| Weapon | What it does |
|---|---|
| Sniper Rifle | |
| Battle Rifle | 3-round burst |
| Crossbow | bolts drop over distance |
| Rocket Launcher | splash damage |
| Grenade Launcher | lob it into someone's hole |
| Railgun | charge up; pierces several players |
| Hyperbeam | charge up, then a sweeping beam |
| Needler | homing; 7 needles = supercombine |

**Damage**
- Damage multiplier
- Headshots only
- Shields off / normal / double
- Explosions reach ducked players

**Ammo**
- Reloading on/off (off = bottomless clip)
- Clip size
- Reload time

**Respawn**
- Respawn time
- Same hole or random hole
- Anti-turtle timer
- Underdog camo, with its kills-behind and death-streak thresholds

**Power-ups**
- Bubble rate: off, rare, normal, lots or CHAOS
- Which power-ups can appear
- Duration multiplier

**Pitre Mode** (see below)

**Skulls**
- Big Head
- Grunt Birthday Party (confetti headshots)
- Black Eye (shields recharge only on kills)
- Mythic (double health and shields)
- Fog

**Advanced**
- Aim assist for controller/touch
- Lag compensation window

**Bots:** up to 6, with difficulty set per bot: Recruit, Normal, Heroic or Legendary.

## 🎩 Pitre Mode

Toggle it in the lobby. Each part can be switched on and off separately.
- **The leader becomes the Cat in the Hat:** tall red-and-white striped hat, bow tie, cat ears and whiskers. When the leader gets a kill, they say **"prank 'em john"**.
- **Voice lines:**

| When | Who says it | Line |
|---|---|---|
| You take damage | the victim | **"mama"** (high baby voice) |
| You hit someone but don't kill them | the shooter | **"oh look, a pussy"** |
| You kill someone | the killer | **"bye byeeee"** |
| Death | the victim | the **pufferfish** sound |
| Shooting | the shooter | **"brap brap brappp"** instead of gunfire |

- **Everyone hears everything,** positioned in 3D: loud next to the speaker's hole, quiet across the field. There's a separate *Pitre voices* volume slider in Options.

### Replacing sounds

All voice lines are MP3s listed in `public/audio/manifest.json`. To swap one, replace the file with your own MP3 **using the same filename** and redeploy. No code changes needed.

- `public/audio/pitre/pufferfish.mp3` is currently an original synthesized placeholder. **Drop the real pufferfish meme clip in here.**
- Each line has several takes (`mama_1.mp3`, `mama_2.mp3`, …) and the game picks one at random. You can delete takes or add more; just update the `files` list in the manifest.
- The spoken lines were generated with the open-source [Kokoro-82M](https://github.com/thewh1teagle/kokoro-onnx) voice model (Apache-2.0). See [`tools/voices/README.md`](tools/voices/README.md) to regenerate or tweak them.

## Tech stack

| Layer | Choice |
|---|---|
| Language / build | TypeScript + Vite |
| 3D | Three.js: procedural low-poly world, instanced grass/rocks/trees, Lambert shading, no post-processing, so it stays fast on phones |
| Multiplayer | Trystero (WebRTC P2P). The host's browser runs the authoritative simulation; clients get 20 Hz snapshots with interpolation and lag compensation |
| Audio | Web Audio: 3D positional panners, procedural sound effects, MP3 voice lines |
| UI | Plain DOM/CSS. The lobby settings form is generated from a settings schema |
| Tests | Vitest (simulation, bots, netcode, Pitre logic) + Playwright (offline match, 2-tab multiplayer, phone touch) |
| Hosting | Any static host; configured for **Vercel** (free Hobby plan) |

### Project layout
```
src/sim/      game rules — pure TypeScript, runs in Node (weapons, stance, hitboxes, scoring, orbs)
src/bots/     bot AI (4 difficulty profiles)
src/net/      host/client sessions, protocol, WebRTC + BroadcastChannel + loopback transports
src/render/   Three.js world, Spartans, effects, first-person weapons, the Game loop
src/input/    mouse/keyboard, gamepad and touch
src/audio/    audio engine, synthesized SFX, Pitre Mode voice logic
src/ui/       HUD, settings form, styles
src/app/      screens (title, lobby, results, options) and session wiring
public/audio/ voice lines + manifest
tools/voices/ voice-line generator (Python, offline)
```

## Development

See **[TESTING.md](TESTING.md)** for a step-by-step local test guide and checklist.

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev:lan      # HTTPS on your network, for testing phones/tablets
npm test             # unit tests (Vitest)
npm run build        # type-check + production build into dist/
npm run e2e          # Playwright browser tests (builds must exist: run `npm run build` first)
```

Useful URL flags:
- `?autostart=offline&bots=5&weapon=rpg&orbs=chaos&pitre=1`: jump straight into a match
- `?quality=low|medium|high`: force a graphics preset
- `?perf`: FPS / draw-call overlay
- `?net=bc`: multiplayer between tabs of one browser, no internet needed

## Deploying to Vercel (free)

1. Import this GitHub repo in Vercel (**Add New → Project**). `vercel.json` already sets the framework, build command and output directory.
2. Deploy. Share the **production** URL (`https://<project>.vercel.app`) with friends. Preview URLs are behind Vercel login by default.

Any static host works too (Netlify, Cloudflare Pages, GitHub Pages): build with `npm run build` and serve `dist/`.
