# Testing Halo Diglett on your own PC

## 1. One-time setup
1. Install **Node.js 22** (LTS) from <https://nodejs.org>. Node 20.19+ also works.
2. Get the code and install dependencies:
   ```bash
   git clone https://github.com/joe-bampton/halo_diglett.git
   cd halo_diglett
   git checkout ccr-acb8c0e5-bod47d   # the review fixes (or main, once they're merged)
   npm install
   ```

## 2. Run it
| What | Command | Open |
|---|---|---|
| Play on this PC | `npm run dev` | <http://localhost:5173> |
| Also test phones/tablets on your Wi-Fi | `npm run dev:lan` | `https://<your-PC-IP>:5173`, shown as "Network" in the terminal |
| Test the real production build | `npm run build` then `npm run preview` | <http://localhost:4173> |

- **Phones:** use `dev:lan`. Phones need HTTPS for online play, controllers and fullscreen. The certificate is self-signed, so tap *Advanced → Proceed* once.
- **Windows firewall:** if the phone can't reach your PC, allow Node.js on private networks when Windows asks.
- **Handy URL flags:** add them after the address, e.g. `http://localhost:5173/?autostart=offline&bots=5&pitre=1&orbs=chaos`.

| Flag | Effect |
|---|---|
| `autostart=offline&bots=N` | skip the menus |
| `weapon=rpg` / `sniper` / `br` / `crossbow` / `grenade` / `railgun` / `hyperbeam` / `needler` | starting weapon |
| `mode=gunGame` / `randomLife` / `choice` | weapon mode |
| `orbs=chaos` | lots of power-up bubbles |
| `pitre=1` | Pitre Mode on |
| `botdiff=jerry` / `topover` / `jerry,topover` | bot tiers (cycled through the bots) |
| `holes=8&spacing=20` | 8 holes at least 20 m apart |
| `respawn=auto` | respawn without pressing Jump |
| `quality=low` / `medium` / `high` / `ultra` | graphics preset |
| `perf` | FPS and draw-call counter in the bottom-left, plus the snapshot buffer and stalls (`st`) |
| `fastnet=0` | online: everything over the reliable channel (the low-latency channel off, to compare) |
| `test` | test hooks in the browser console: `__hd.grant('spring')`, `__hd.grant('sauce', 1)` (give bot 1 the Super Soaker), `__hd.kill()` |

The match flags (`weapon`, `orbs`, `pitre`, `botdiff`, `holes`…) work together with `autostart=offline`.

## 3. Multiplayer on one PC
**Quick (no internet needed):**
- Tab 1: `http://localhost:5173/?net=bc`, then **Host online game**. Note the code.
- Tab 2: `http://localhost:5173/?net=bc#/join/CODE`.

**Real peer-to-peer (what friends will use; needs internet):**
- Chrome: `http://localhost:5173`, then **Host online game**.
- A different browser, or an incognito window: `http://localhost:5173/#/join/CODE`.

**Phone + PC:** run `npm run dev:lan`. Host on the PC, join from the phone at `https://<PC-IP>:5173/#/join/CODE`.

## 4. Checklist

**Menus & lobby**
- [ ] Title screen shows the animated arena behind the menu
- [ ] Play vs bots → lobby: add/remove bots, change bot difficulty, change name and armour colour
- [ ] Each preset button changes the settings
- [ ] Settings persist after a page reload
- [ ] The lobby is readable on a phone (no sideways scrolling)

**Feel & smoothness** (fixed in the review — worth a look)
- [ ] On a 120 or 144 Hz screen (`weapon=rpg`): rockets fly at the same speed as on 60 Hz, and explode where they land
- [ ] Grenades (`weapon=grenade`) bounce and explode in the same spot you saw them land
- [ ] Sniper scope (both zoom levels) and Battle Rifle zoom: the view moves across the screen as far per mouse/stick movement as unzoomed
- [ ] Esc → Options mid-match: Space, W, R etc. don't move your Spartan; Esc closes Options and goes straight back to the game
- [ ] Phone: switch to another app and back mid-match — sound still plays, the screen doesn't go to sleep
- [ ] A long match on Medium after a stutter: the picture doesn't stay blurry (`perf` shows the scale `x1.00` again)
- [ ] The first explosion of a match doesn't hitch

**Core gameplay (mouse + keyboard)**
- [ ] Click the game to capture the mouse; the "Click to play" hint disappears
- [ ] Hold **Space** to stand; release to duck. Ducked = safe from bullets
- [ ] Left click shoots; right click zooms (sniper has 2 levels); **R** reloads
- [ ] Headshot with the sniper = instant kill; body shots take 2
- [ ] Shield bar drains, then recharges after about 4 s; low-shield beeps
- [ ] Staying ducked about 8 s forces you up ("Pop up in…" warning)
- [ ] Dying shows the death cam, then you spectate (see below); you respawn in a hole when you press Space
- [ ] Kill feed, medals (Headshot, Double Kill…) and announcer voice work
- [ ] **Tab** shows the scoreboard; **Esc** pauses (offline really pauses)
- [ ] Match ends at the score limit → results screen → Play again / Back to lobby

**Respawn & spectating** (`?autostart=offline&bots=3`)
- [ ] After dying: a short death cam, then a "SPECTATING" panel with a player's name, weapon and K/D
- [ ] **E** / **Q** (or click / right-click) switch player; **F** toggles 1st ↔ 3rd person
- [ ] 3rd person: the mouse orbits around them, the wheel zooms in and out, the camera never goes under the ground
- [ ] 1st person: you see their weapon and their scope when they zoom
- [ ] "Respawn in N · press SPACE when ready", then "Press SPACE to respawn": you stay dead until you press it
- [ ] Spectating never moves your own aim or fires
- [ ] Lobby → Respawn → *Automatically* brings back the old automatic respawn
- [ ] Controller: A respawns, RB/LB switch, Y toggles the view, triggers zoom. Phone: ◀ ▶ 👁 buttons, drag, pinch, RESPAWN

**Bot tiers**
- [ ] `botdiff=jerry`: Jerry bots pop up, spray the sky yelling "Suppressing fire!" (speech bubble too), and never hurt you
- [ ] `botdiff=topover`: Top/Over bots stay up, find you instantly and kill with any headshot; overshield or invincibility still stops the instant kill
- [ ] In the lobby, each bot's difficulty list goes Jerry → … → Top/Over

**Map** (lobby → Map)
- [ ] Number of holes *Auto* = the usual field; 8, 16, 32 holes all work, and the minimap in the lobby shows the layout
- [ ] Distance between holes changes how spread out they are (try 6 m and 40 m); big settings make the field bigger, up to 300 m across
- [ ] With more players than holes, extra joiners wait ("All holes are taken") and get in when one frees up

**Weapons** (`?autostart=offline&bots=3&weapon=…`)
- [ ] Battle Rifle bursts
- [ ] Crossbow bolts drop over distance
- [ ] RPG explodes
- [ ] A grenade dropped into a hole kills the ducked player
- [ ] Railgun charges, then pierces
- [ ] Hyperbeam charges into a 1.8 s beam
- [ ] Needler homes; 7 needles make a supercombine
- [ ] Gun Game: every kill upgrades your weapon

**Power-up bubbles** (`orbs=chaos`)
- [ ] Capture-ball orbs drift around with labels
- [ ] Shooting one pops it, gives the power-up, and the announcer names it
- [ ] Try: flamethrower, minigun, overshield (green glow), invincibility (gold), camo, damage boost, homing, X-ray, big heads, orbital strike (red laser, then boom), quick hands
- [ ] **Spring Jump** (`?test&autostart=offline&bots=3`, then `__hd.grant('spring')` in the console): the HUD shows it held; double-tap Space → a spring pops out and you fly ~20 m up, can look and shoot down into holes, can't duck, then land back in your hole
- [ ] **Gerry Sauce**: shoot the 💦 bubble (or `__hd.grant('sauce')`), you get the Super Soaker; one click squirts custard jets at everyone, then rain. Covered players can't duck and their camo stops working
- [ ] Getting sauced yourself (`__hd.grant('sauce', 1)` gives it to bot 1): your screen is covered in custard blobs that slide off over 5 s, aiming is slow at first and speeds back up
- [ ] Lobby → Power-ups: **None** stops all bubbles, **All** brings them back; the chips show each power-up's icon and colour

**Pitre Mode** (`pitre=1`)
- [ ] The leader wears the Cat in the Hat costume (striped hat, bow tie, ears)
- [ ] When the leader gets a kill: "prank 'em john"
- [ ] Other kills: "bye byeeee"
- [ ] Hitting without killing: "oh look, a pussy"
- [ ] Taking damage: baby "mama"
- [ ] Dying: pufferfish sound (placeholder until you drop in the real clip)
- [ ] Gunfire becomes "brap brap brappp"
- [ ] A shot that just misses you (or that you duck under at the last moment): "Bitch, please!"
- [ ] Hitting someone a second time without a kill: "How many bullets?!"
- [ ] Power-up bubbles are energy drink cans (black, silver ends, glowing claw marks in the power-up colour) that burst and fizz when shot; *Power-ups come in energy drink cans* switches it off
- [ ] Voices are quieter from far-away holes and louder from close ones
- [ ] The *Character voices* slider in Options changes their volume

**Graphics** (Options → Graphics; also from Esc → Options mid-match)
- [ ] Switching Low ↔ Medium ↔ High ↔ Ultra changes the look straight away (no restart)
- [ ] High: glowing sun and muzzle flashes (bloom), shiny reflective armour and visors, the detailed Spartans, rocket explosions with a shockwave ring and scorch marks
- [ ] Ultra: denser grass further out, smoother edges
- [ ] *Advanced graphics*: each setting shows "Preset (…)"; turning Shadows off, Effects low or Render scale 50% applies at once; *Reset to the preset* undoes them
- [ ] *Show FPS* puts a counter in the top-right corner
- [ ] If it's laggy, Low makes it smooth again (and after ~10 s under 28 fps the game suggests it once)
- [ ] Settings are remembered after a reload

**Controller** (Xbox/PlayStation, plugged in or Bluetooth)
- [ ] Right stick aims, RT fires, LT zooms
- [ ] A (hold) stands, LB toggles standing, X reloads, Menu pauses
- [ ] Aim assist: the reticle gets "sticky" on enemies (lobby → Advanced)

**Phone / tablet** (`npm run dev:lan`)
- [ ] Landscape prompt appears in portrait
- [ ] Drag to aim; FIRE (you can drag it to aim too), STAND (tap = toggle), ZOOM, RELOAD
- [ ] Runs smoothly (Low quality is picked automatically)

**Online**
- [ ] A friend joins with the code/link and appears in the lobby; the host starts the match
- [ ] Up to 8 players fit in one lobby (a 9th is told it's full)
- [ ] With `?perf` on a friend's phone over Wi-Fi/4G: the stall count (`st`) stays low, other players move smoothly
- [ ] Shots and kills show up for both players
- [ ] A friend refreshes mid-match and comes back into the same slot with the same score
- [ ] Closing the host tab shows "The host left the game" to friends

**Voice chat** (real peer-to-peer only, not `?net=bc`; wear headphones or use two machines)
- [ ] Lobby → 🎤 *Enable mic* next to your name: the browser asks for permission, then the button reads *Mic on*
- [ ] Both players enable the mic and hear each other; the speaker's dot turns green
- [ ] **M** (or the button) mutes you: the other player stops hearing you
- [ ] 🔊 next to a friend's name mutes them (🔇); click again to unmute
- [ ] Options → Voice chat → Players: the per-player slider changes only that friend's volume
- [ ] Mic mode *Push-to-talk*: silent until you hold **V**
- [ ] In a match, the HUD shows your mic icon and the names of people talking; on a phone, tapping the icon mutes and holding it talks (push-to-talk)
- [ ] Leave the game: the browser's recording indicator goes away

**Audio levels** (Options → Audio)
- [ ] *Guns & explosions* only changes gunfire and explosions; *Other effects* only changes hit markers, medals and similar
- [ ] *Character voices*, *Announcer* and *Voice chat* each change only their own sounds
- [ ] **Reset audio to defaults** puts every slider back (Master 0.8, Guns 0.8, Effects 0.8, Voices 0.9, Announcer 0.9, Voice chat 1) and every player's volume back to 100%

## 5. Automated tests
```bash
npm test                          # unit tests: rules, bots, netcode, Pitre voice logic, volumes, voice chat, graphics settings, models
npm run build && npm run e2e      # browser tests (first run: npx playwright install chromium)
npm run check                     # everything: type-check, unit tests, build, browser tests
```

## Found a problem?
Note what you did, what you expected, and what happened. Include a screenshot and any red errors from the browser console (F12). Then tell me and I'll fix it.
