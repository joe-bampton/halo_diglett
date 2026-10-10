# Halo Diglett

**Pop up. Snipe. Duck. Repeat.** A browser remake of the Halo Infinite Forge "Diglett" custom mode.

Everyone sits in a stone foxhole on a grassy field. You can only:
- aim
- stand up
- duck
- shoot
- reload

Play with up to **7 friends online** (8 players), or on your own against up to **6 bots**. It runs on:
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
| Use a power-up (from your inventory) | **Q** or middle click | **RB** | **USE** |
| Pick another power-up | **← / →**, mouse wheel, or **1–9** | D-pad ← / → | tap its icon |
| Spring Jump (when you have one) | use it, or double-tap **Space** | use it, or double-tap **A** | use it, or double-tap **STAND** |
| Scoreboard / menu | Tab / Esc | View / Menu | ≡ / ☰ |
| Voice chat (online) | **M** mutes your mic, hold **V** for push-to-talk | — | 🎙️ button: tap = mute/unmute, hold = talk (push-to-talk) |

- **Dead?** You spectate until you press **Jump** (Space / Ⓐ / RESPAWN). The respawn timer is the minimum wait. While you watch:

  | | Mouse + keyboard | Controller | Touch |
  |---|---|---|---|
  | Next / previous player | **E** / **Q**, click / right-click, → / ← | RB / LB | ◀ ▶ |
  | 1st ↔ 3rd person | **F** | Y | 👁 |
  | Look around (3rd person orbit) | mouse | right stick | drag |
  | Zoom in / out | mouse wheel | RT / LT | pinch |

- **Ducking** makes you safe from bullets: once your head is under the rim, nobody on the ground can hit you, even if they aimed before you ducked. Only these get you in your hole: a shot fired down from a **Spring Jump**, **homing rounds** (they curve over the rim), a grenade that drops in, an orbital strike, a Poké Ball, or explosions if the host turns on *Explosions reach ducked players*.
- **Shooting from a duck:** staying down, you can still fire a single-shot or burst gun (sniper, Battle Rifle, crossbow, rockets) steeply up out of your hole. Those shots only pop power-up bubbles: they go straight past players, and a rocket fizzles out without a blast. Aim too flat and you hit the side of the hole.
- **Stay ducked too long** and the *anti-turtle* timer pops you up for 2 seconds.
- **Headshots** do the most damage. With the sniper and crossbow, any headshot kills.
- **Power-up bubbles** are capture-ball-style orbs that drift over the field. Shoot one and its power-up goes into your **inventory** at the bottom of the screen, to use when you choose:
  - You can hold **2 of each** power-up, of as many kinds as you like. A third one of a kind you already have two of is lost.
  - Pick one with **← / →**, the mouse wheel or **1–9** (D-pad on a controller, tap its icon on a phone) and **use** it with **Q** or middle click (**RB**, **USE**). Two of a kind go back to back: use the second while the first is still running and it lasts twice as long.
  - **Dying empties your inventory**, so hoarding doesn't pay. Ducked in your hole, you can shoot the bubbles drifting overhead and stock up.
- Inside the bubbles: flamethrower, minigun, overshield, invincibility, active camo, damage boost, homing rounds, X-ray vision, big heads, orbital strike, quick hands, and:
  - **Spring Jump ⇈**: use it (or double-tap Jump) and a giant spring catapults you **20 m** straight up. You get a great view down into everyone's holes (you can shoot down into them), but you can't duck or hide up there, and you land back in your hole.
  - **Gerry Sauce 💦**: a one-shot **Super Soaker**. One squirt lobs light-white custard over the whole field. A second later everyone else is covered for 5 seconds: stuck standing up, visible (camo off) and slow to aim, speeding back up as the custard slides off their screen. Easy kills for whoever squirted it.
  - **Poké Ball ◓**: thrown like a frag grenade. If it hits an opponent, or drops into the hole someone is hiding in, it catches them. Then you have **3 seconds** to throw them on: wherever the ball lands, they pop out of the nearest hole. That can be their own hole, an opponent's or yours. Too slow, and it's *"Opponent escaped!"*: they go back to their own hole. While caught you see the inside of the ball and can only look around.
  - Thrown into a hole that's taken, a captive squeezes in beside whoever is there. They're stuck standing for a moment, and the two of them can shoot each other, ducked or not.
- **Underdog camo** gives a struggling player active camo when they respawn: 5+ kills behind the leader, or 3 deaths in a row.

### Online play (peer-to-peer, no server)
1. Click **Host online game**. You get a room code and an invite link, e.g. `https://…/#/join/K7Q2M`.
2. Friends open the link, or click **Join game** and type the code.
3. Add bots if you like, change the rules under **⚙ Settings** and press **Start match**.

The lobby shows everyone as a Spartan card in their armour colour, holding the gun they'll start with. Friends' cards slide in as they join. Next to them are the map and a summary of the game.

How it works:
- The host's browser runs the match and the bots. Friends connect directly over WebRTC ([Trystero](https://github.com/dmotz/trystero)).
- The positions of everyone on the field go over a low-latency channel: a lost packet on a phone's Wi-Fi or 4G is simply replaced by the next update, instead of freezing the field until it's resent. Kills, spawns and other events still arrive reliably.
- Players find each other through public Nostr relays, with BitTorrent trackers as a fallback. No accounts, no server and no cost.
- If a friend refreshes or drops, they can rejoin within 2 minutes and get their slot and score back.
- If the host closes the tab, the match ends. **Host from a desktop/laptop** where possible, and keep the tab open.

**If a friend can't connect:** some networks (strict corporate or mobile carrier NAT) block direct WebRTC. The fix is a free TURN relay (see [DEPLOY.md](DEPLOY.md#turn-relay-my-friend-cant-connect)).
1. Create a free TURN credential, e.g. [Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/) or [Open Relay](https://www.metered.ca/stun-turn).
2. Give it to the game in one of two ways:
   - Paste it into **Options → Network** as JSON: `{"urls":"turn:host:3478","username":"u","credential":"p"}`.
   - Or set the Vercel environment variables `VITE_TURN_URLS` (comma-separated), `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL`, then redeploy.

### Voice chat
Online games have party-style voice chat. Everyone in the room hears everyone at the same volume, in the lobby, in the match and on the results screen.

- **Turn your mic on** with the 🎤 button on your card in the lobby, or in **Options → Voice chat**. The browser asks for permission the first time. After that, the mic comes back on by itself in your next online game.
- **Mute yourself** with **M**, the button next to your name, or the 🎙️ icon on the in-match HUD.
- **Push-to-talk:** switch *Mic mode* in Options, then hold **V** (or hold the 🎙️ icon on touch screens) to talk.
- **Mute someone** with the 🔊 button on their card in the lobby, or in **Options → Voice chat → Players**. That list also has a volume slider for each player. Mutes and volumes are remembered by player name.
- A green glow round their card in the lobby, and the name list on the HUD, show who is talking.

How it works:
- Voice goes straight from each player to every other player over WebRTC. The host doesn't relay it, and there's no server.
- Echo cancellation, noise suppression and auto gain are on, but **headphones** still sound best.
- It needs a secure page. Vercel, `localhost` and `npm run dev:lan` all qualify.
- Two friends behind very strict networks may not hear each other even though both can reach the host. A TURN relay (see above) fixes that too.
- Offline games and the `?net=bc` test mode have no voice chat. You can still check your mic level in Options.

### Audio settings (Options → Audio)
| Slider | Controls |
|---|---|
| Master | everything |
| Guns & explosions | gunfire, charge-ups, beams, rockets, explosions |
| Other effects | hit markers, shields, medals, power-ups, beeps |
| Character voices | Pitre Mode voice lines |
| Announcer | "Double Kill!", "Killing Spree!"… |
| Voice chat (all players) | every player's mic; each player also has their own slider under *Voice chat → Players* |

**Reset audio to defaults** puts every slider back, including each player's voice volume. Mutes are kept.

## Host settings

In the lobby, **⚙ Settings** opens the match settings. They're on five tabs:
- Friends can look but not change anything.
- A dot marks a tab with something changed from the default.
- *Reset this tab* puts a tab back to the defaults.

### 🎯 Game
**Game type:** the presets are Classic Diglett, Rocket Whack, Needler Party, Gun Game, Chaos Orbs, Pitre Party and First to 100. The lobby's Game card shows which one you're playing (or *Standard*, or *Custom*).

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
| Frag Grenade | thrown, two at a time; bounces off the ground and off players, goes off after 2 s. Roll one into a hole to get the player hiding in it |
| Plasma Grenade | thrown, two at a time; sticks to the first player (or patch of ground) it touches and goes off a second later. Once you're stuck, ducking won't save you |

**Ammo**
- Reloading on/off (off = bottomless clip)
- Clip size
- Reload time

### ⚖️ Rules
**Damage**
- Damage multiplier
- Headshots only
- Shields off / normal / double
- Explosions reach ducked players

**Respawn**
- Respawn time
- Respawn: *When you press Jump* (default; spectate until then) or *Automatically*. Bots always respawn automatically.
- Same hole or random hole
- Anti-turtle timer
- Underdog camo, with its kills-behind and death-streak thresholds

### ✦ Power-ups
- Bubble rate: off, rare, normal, lots or CHAOS
- Which power-ups can appear (with **All / None** buttons; none = no bubbles). Power-ups added in an update start switched on, even in saved settings.
- Duration multiplier

### 🗺️ Map
- Number of holes: *Auto* (today's field) or 4–32
- Distance between holes (6–40 m, at least this far apart). The field grows to fit, up to 300 m across. The settings window and the lobby show a minimap of the result.

### 🎩 Extras
**Pitre Mode** (see below)

**Skulls**
- Big Head
- Grunt Birthday Party (confetti headshots)
- Black Eye (shields recharge only on kills)
- Mythic (double health and shields)
- Fog

**Advanced**
- Aim assist for controller/touch
- Lag compensation window (default 250 ms, up to 400 ms)

**Bots:** up to 6, added with the **+** card in the lobby, with the difficulty set on each bot's card:

| Tier | Plays like |
|---|---|
| **Jerry** | Never shoots anyone. Pops up, sprays the sky and yells *"Suppressing fire!"* |
| Recruit, Normal, Heroic, Legendary | from slow and wobbly to sharp |
| **Top/Over** | Hacks: knows where you are through walls, snaps on instantly, and any headshot it lands kills (overshield and invincibility still protect you). Covered in Gerry Sauce, even it slows down. |

## 🎩 Pitre Mode

Toggle it under **⚙ Settings → Extras** in the lobby. Each part can be switched on and off separately.
- **The leader becomes the Cat in the Hat:** tall red-and-white striped hat, bow tie, cat ears and whiskers. When the leader gets a kill, they say **"prank 'em john"**.
- **Voice lines:**

| When | Who says it | Line |
|---|---|---|
| You take damage | the victim | **"mama"** (high baby voice) |
| You hit someone but don't kill them | the shooter | **"oh look, a pussy"** |
| You kill someone | the killer | **"bye byeeee"** |
| Death | the victim | the **pufferfish** sound |
| Shooting | the shooter | **"brap brap brappp"** instead of gunfire |

| A bullet passes **very** close (or you duck under it just in time) | the one it missed | **"Bitch, please!"** |
| Your 2nd hit in a row without a kill | the shooter | **"How many bullets?!"** (instead of "oh look, a pussy") |

- **Power-ups come in energy drink cans** (black can, silver ends, glowing claw scratches in the power-up's colour) instead of capture balls. They burst into shards and fizz when shot.
- **Everyone hears everything,** positioned in 3D: loud next to the speaker's hole, quiet across the field. The *Character voices* slider in Options controls their volume. (Jerry bots' *"Suppressing fire!"* is on that slider too, in any mode.)

### Replacing sounds

All voice lines are MP3s listed in `public/audio/manifest.json`, and so are any real sound effects.

- **Your friends' voices:** send them [`tools/voices/RECORDING.md`](tools/voices/RECORDING.md). They record lines on their phones and upload them to `tools/voices/recordings/<their name>/`; `tools/voices/import.py` cleans them up (noise, volume) and puts them in the game. A recorded line replaces the robot voice, and when you're the one saying it, you hear your own take.
- **Real gunshots, explosions and beeps:** [`tools/sfx/SOUND_LIST.md`](tools/sfx/SOUND_LIST.md) lists every sound effect, what to look for and where (free CC0 packs), and how to add it with `tools/sfx/import.py`. Sounds you don't replace stay synthesized.
- To swap a single voice file by hand, replace it with your own MP3 **using the same filename** and redeploy.
- `public/audio/pitre/pufferfish.mp3` is an original synthesized placeholder. You can drop the real pufferfish meme clip in for private games, but it's copyrighted, so don't commit it to this public repo.
- The robot lines were generated with the open-source [Kokoro-82M](https://github.com/thewh1teagle/kokoro-onnx) voice model (Apache-2.0). See [`tools/voices/README.md`](tools/voices/README.md) to regenerate or tweak them.

## Graphics (title screen, or Options → Graphics)

Pick a preset from the **Graphics** menu on the title screen, or in Options. Changes apply right away, mid-match too (Esc → Options). **Auto** picks **High** on computers and **Low** on phones. If High can't hold 45 fps in the first seconds of play, Auto drops to Medium and remembers that for this device. If the game feels laggy, pick **Medium** or **Low**; it also suggests that by itself after a while under 28 fps. **Show FPS** puts a frame counter in the corner.

| Preset | What you get |
|---|---|
| Low | phones and old laptops: fewer grass clumps, no shadows, simpler effects |
| Medium | slower computers: still shadows, more grass, flat-coloured ground and stones |
| High | the default on computers: moving shadows, bloom and filmic colour, ambient occlusion (soft shadows in corners and under the rims), textured grass ground and rounded, weathered rim stones, shiny sky-reflecting (PBR) materials, the detailed models, richer explosions (shockwave, sparks, scorch marks) |
| Ultra | High plus full-resolution ambient occlusion, extra anti-aliasing (SMAA), sharper shadows, almost twice the grass reaching further, more trees and particles |

**Advanced graphics** lets you override single parts of the preset: render scale, dynamic resolution, shadows, effects, post-processing, anti-aliasing, grass & trees, models & materials, and ambient occlusion. Each one says what the preset would pick.

The ground and stone textures are painted in code when a match starts (no image files).

**Better models from AI tools.** Any character, weapon or prop can be swapped for a model made with an AI 3D generator such as Meshy or Tripo. That includes the Spartan (still painted in each player's colour), a proper Cat in the Hat for Pitre Mode's leader, the energy cans, and every gun.
- Drop the `.glb` into `models-src/` and run `npm run models:import`.
- The game fits each model to the holes, hitboxes and hands by itself.
- `?modelview=<slot>` shows how a model fits.
- **[tools/models/AI_MODELS.md](tools/models/AI_MODELS.md)** has ready-made prompts for every model.

The detailed Spartan, energy can, Super Soaker and spring are made **from code with Blender** ([`tools/models`](tools/models/README.md)): change the script, run it, and the game picks up the new `.glb` files.

## Tech stack

| Layer | Choice |
|---|---|
| Language / build | TypeScript + Vite |
| 3D | Three.js: procedural low-poly world, instanced grass/rocks/trees. Low/Medium use plain Lambert shading, so they stay fast on phones. High/Ultra add bloom + tone mapping, PBR materials with sky reflections, and Blender-made glTF models, all loaded on demand |
| Multiplayer | Trystero (WebRTC P2P). The host's browser runs the authoritative simulation; clients get 20 Hz snapshots over an unordered, never-resent data channel (events reliably beside it), with interpolation and lag compensation |
| Audio | Web Audio: 3D positional panners, procedural sound effects (real recordings swap in when imported), MP3 voice lines |
| UI | Plain DOM/CSS. The settings window is generated from a settings schema, a tab per group of settings; the lobby's Spartan portraits are rendered once per colour and gun |
| Tests | Vitest (simulation, bots, netcode, Pitre logic, graphics settings, model files) + Playwright (offline match, 2-tab multiplayer, lobby and settings, phone touch, spectating, power-ups, graphics options) |
| Hosting | Any static host; configured for **Vercel** (free Hobby plan) |

### Project layout
```
src/sim/      game rules — pure TypeScript, runs in Node (weapons, stance, hitboxes, scoring, orbs)
src/bots/     bot AI (6 difficulty profiles, from Jerry to Top/Over)
src/net/      host/client sessions, protocol, WebRTC + BroadcastChannel + loopback transports
src/render/   Three.js world, Spartans, effects, first-person weapons, the Game loop
src/input/    mouse/keyboard, gamepad and touch
src/audio/    audio engine, synthesized SFX, Pitre Mode voice logic
src/ui/       HUD, settings window and form, styles
src/app/      screens (title, lobby, results, options) and session wiring
public/audio/ voice lines, imported sound effects + manifest
public/models/ detailed glTF models (High / Ultra)
tools/voices/ voice-line generator and friends' recordings importer (Python, offline)
tools/sfx/    sound-effect importer: downloaded CC0 sounds → game MP3s (Python, offline)
tools/models/ model builder (Blender as a Python module, offline)
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
- `&botdiff=jerry` or `&botdiff=jerry,topover`: bot tiers (cycled through the bots)
- `&holes=8&spacing=20`: map size
- `&respawn=auto`: respawn without pressing Jump
- `&powerups=pokeball,spring`: only these power-ups come in bubbles
- `?quality=low|medium|high|ultra`: force a graphics preset
- `?perf`: FPS / draw-call overlay, plus the snapshot buffer and stalls (`st`: frames where other players briefly froze)
- `?net=bc`: multiplayer between tabs of one browser, no internet needed
- `?fastnet=0`: send everything over the reliable channel (switches the low-latency channel off, for comparing)

## Deploying (free)

It's a static site: build with `npm run build` and serve `dist/` from any static host. **[DEPLOY.md](DEPLOY.md)** compares the free options (Cloudflare Pages, GitHub Pages, Vercel, Netlify, a LAN party), shows how to set up a TURN relay for friends who can't connect, and has a game-night checklist.
