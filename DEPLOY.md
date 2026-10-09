# Deploying and playing together

**Short version:**
- Put the game on **Cloudflare Pages** (free). GitHub Pages or Vercel work just as well.
- Add a free **TURN relay** before your first big session.
- Have the host play on a PC or laptop.

Nothing else is needed: the game has no server of its own.

## How it works (and why any static host will do)

- **The game itself** is a static website (HTML, JavaScript, sounds, models): about 2.4 MB, cached after the first visit.
- **Multiplayer** is peer-to-peer. The host's browser runs the match. Every friend's browser connects straight to it over WebRTC.
- **Finding the host:** to find each other, browsers briefly use free public "matchmaking" servers (Nostr relays, with BitTorrent trackers as a fallback). The game traffic itself never goes through them.
- **TURN relay:** some networks (strict mobile carriers, offices, some university Wi-Fi) block direct connections. A **TURN relay** passes the traffic along for those players. Everyone else still connects directly.

So "deploying" just means putting the built `dist/` folder on any static web host.

## Hosting options

| Option | Free allowance | Good for | Notes |
|---|---|---|---|
| **Cloudflare Pages** (recommended) | Static bandwidth effectively unlimited, 500 builds/month | Everything | Can later hand out Cloudflare TURN credentials from a tiny Pages Function on the same site |
| GitHub Pages | Free for public repos (this one is), 100 GB/month soft limit | The simplest setup | No server functions, so TURN must use a static credential (e.g. Metered) |
| Vercel Hobby | 100 GB/month, non-commercial use only | Already configured (`vercel.json`) | Preview URLs sit behind a Vercel login; share the production URL |
| Netlify | Free plan is credit-based (roughly 15 GB/month of traffic) | Fine | The least generous of these now |
| LAN party | Free | Everyone in one house | `npm run dev:lan` on one PC; phones need to accept its self-signed certificate once |
| itch.io | Free | — | Not recommended: the game runs inside an iframe, which gets in the way of invite links, the microphone and mouse capture |

Traffic is tiny: 8 players loading the game a few times a month is a few hundred MB at most, far under every free limit.

### Cloudflare Pages (recommended)
1. Sign in at <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**, and pick this repository.
2. Framework preset: **None** (or Vite).
   - Build command: `npm run build`
   - Output directory: `dist`
   - Add the environment variable `NODE_VERSION` = `22`.
3. Deploy. Share `https://<project>.pages.dev` with your friends.
4. Optional: add the TURN variables (below) under **Settings → Environment variables**, then redeploy.

### GitHub Pages
1. Repository **Settings → Pages → Source: GitHub Actions**.
2. Add a workflow that runs `npm ci && npm run build` and uploads `dist/` (GitHub's "Static HTML" starter, with those two commands added).
3. The game uses relative paths and `#/join/CODE` links, so it works from `https://<you>.github.io/halo_diglett/` with no extra setup.

### Vercel
It's already configured: import the repo in Vercel and deploy. (Nothing was deployed during this review.)

### LAN (no internet hosting at all)
- `npm run dev:lan` on one PC. Friends on the same Wi-Fi open the `https://<PC-IP>:5173` address it prints.
- Phones need HTTPS for online play, so they must tap through the self-signed certificate warning once.
- For the production build instead: `npm run build`, then `npx vite preview --host`. That's plain HTTP, so it suits PCs better than phones.

## TURN relay ("my friend can't connect")
If someone sits on "Looking for the host…" or gets "Couldn't connect to the host", their network needs a relay.

- **Metered Open Relay** (free, about 20 GB/month)
  1. Create an account at <https://www.metered.ca/stun-turn>. It gives you a TURN URL, a username and a password.
  2. Then either:
     - set `VITE_TURN_URLS` (comma-separated), `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL` on your host and redeploy; or
     - paste `{"urls":"turn:…:3478","username":"…","credential":"…"}` into **Options → Network** on the devices that can't connect.
- **Cloudflare TURN** (free up to 1,000 GB/month)
  - Its credentials are short-lived and created through Cloudflare's API.
  - The clean way to use it is a small Pages Function that hands each browser a fresh credential. That's a good follow-up once the game lives on Cloudflare Pages.

Only the players who need it use the relay. With voice chat on, a relayed player uses very roughly 0.5 GB per two-hour session, so 20 GB lasts a long time.

## Game night checklist
- **The host:** a PC or laptop, ideally on Ethernet or 5 GHz Wi-Fi.
  - The host's browser runs the match for everyone.
  - It uploads about 1 Mbit/s for 7 friends (measured: ~0.8 KB state updates 20 times a second, plus events).
  - If the host closes the tab, the match ends. The match keeps running if the tab is in the background.
- **Everyone on the same version:** after a redeploy, everyone refreshes. A mismatched version is refused with a message.
- **Up to 8 players** (plus up to 6 bots). Phones get the Low graphics preset automatically.
- **Voice chat:** headphones stop echo. Everyone's mic goes straight to everyone else: about 0.25 Mbit/s each way per player while talking.
- **Lag compensation:** the default is now 250 ms (lobby → Advanced). Lower it if shots feel like they land "behind cover"; raise it if friends on 4G keep missing.
- **Checking the connection:**
  - Add `?perf` to the address to see the frame rate, the snapshot buffer and stalls (`st`, frames where other players briefly froze).
  - `?fastnet=0` turns off the low-latency channel (everything then goes over the reliable one), which is useful for comparing.

## When to consider a dedicated server
Peer-to-peer is free and fast, and right for a group of friends. A small server running the same simulation (it already runs in Node for the tests) becomes worth it only if:
- the matchmaking relays keep failing for your group, or
- you often want a phone to be the host.

Free options either sleep when idle (Render) or take some setup (Cloudflare Durable Objects, an Oracle Cloud free VM).
