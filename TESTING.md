# Testing Halo Diglett on your own PC

## 1. One-time setup
1. Install **Node.js 22** (LTS) from <https://nodejs.org>. Node 20.19+ also works.
2. Get the code and install dependencies:
   ```bash
   git clone https://github.com/joe-bampton/halo_diglett.git
   cd halo_diglett
   git checkout dev/beautiful-pasteur-xe88ja
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
| `quality=low` / `medium` / `high` | graphics preset |
| `perf` | FPS and draw-call counter in the bottom-left |

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

**Core gameplay (mouse + keyboard)**
- [ ] Click the game to capture the mouse; the "Click to play" hint disappears
- [ ] Hold **Space** to stand; release to duck. Ducked = safe from bullets
- [ ] Left click shoots; right click zooms (sniper has 2 levels); **R** reloads
- [ ] Headshot with the sniper = instant kill; body shots take 2
- [ ] Shield bar drains, then recharges after about 4 s; low-shield beeps
- [ ] Staying ducked about 8 s forces you up ("Pop up in…" warning)
- [ ] Dying shows the death cam and "Respawn in N"; you respawn in a hole
- [ ] Kill feed, medals (Headshot, Double Kill…) and announcer voice work
- [ ] **Tab** shows the scoreboard; **Esc** pauses (offline really pauses)
- [ ] Match ends at the score limit → results screen → Play again / Back to lobby

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

**Pitre Mode** (`pitre=1`)
- [ ] The leader wears the Cat in the Hat costume (striped hat, bow tie, ears)
- [ ] When the leader gets a kill: "prank 'em john"
- [ ] Other kills: "bye byeeee"
- [ ] Hitting without killing: "oh look, a pussy"
- [ ] Taking damage: baby "mama"
- [ ] Dying: pufferfish sound (placeholder until you drop in the real clip)
- [ ] Gunfire becomes "brap brap brappp"
- [ ] Voices are quieter from far-away holes and louder from close ones
- [ ] The *Character voices* slider in Options changes their volume

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
npm test                          # unit tests: rules, bots, netcode, Pitre voice logic, volumes, voice chat
npm run build && npm run e2e      # browser tests (first run: npx playwright install chromium)
```

## Found a problem?
Note what you did, what you expected, and what happened. Include a screenshot and any red errors from the browser console (F12). Then tell me and I'll fix it.
