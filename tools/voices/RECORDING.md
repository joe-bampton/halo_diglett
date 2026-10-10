# Record your voice for Halo Diglett

Right now the shouts in the game come from a robot voice. You can replace them with
yours! All you need is a phone and five quiet minutes.

## Before you start

- **You agree to share it.** Your recordings go into the game and into the project's
  **public** GitHub repo, so anyone on the internet can download them. Changed your
  mind later? Say so, and your folder gets deleted.
- **Only your own voice.** No clips from TV, YouTube or memes: they're copyrighted.
  Laughing at them in a private game is one thing, but they can't go in the public repo.

## 1. Pick your lines

The full list is at the [bottom of this page](#all-the-lines). Do as many as you like.
Even one line is great.

## 2. Record

- Use your phone's recorder app: **Voice Memos** on iPhone, **Recorder** or
  **Voice Recorder** on Android. Any format the app saves is fine.
- Find a **quiet room with soft things in it** (bedroom, living room). Avoid bathrooms and
  kitchens because they echo. Switch off fans, the TV and music.
- Hold the phone about a **hand-span (15 cm) from your mouth**, slightly to the side so
  "p" and "b" don't pop. Not closer than that.
- **Stay silent for one second before you speak**, and for a second after. The clean-up
  uses that silence to learn what your room sounds like and remove it.
- **Give it energy!** It's a party game: shout, ham it up, overact. If you're really
  yelling, hold the phone a bit further away.
- Record **each line 3 times**, a bit differently each time. Make **one recording per
  take**: stop and start again between them.
- Listen back. If it crackles or sounds crunchy, it was too loud. Step back and try again.

## 3. Optional: studio polish

[Adobe Podcast Enhance](https://podcast.adobe.com/enhance) is a free web tool (it needs a
free Adobe account) that makes phone recordings sound like a studio. Upload your file,
download the result, and send that one. It isn't needed, because our clean-up removes
background noise anyway. If the result sounds robotic or strange (it can happen with
shouting), use your original instead.

## 4. Name your files

Name each file after the line and the take number: `<line>_<take>`, keeping the ending
your app gave it. Then put all your files in a **folder named after you**. Use the name
**you play with**, because when you are the one shouting a line in the game, the game
picks your own take.

```
john/
  pitre.prank_1.m4a
  pitre.prank_2.m4a
  pitre.prank_3.m4a
  pitre.mama_1.m4a
  ann.double_1.m4a
```

Capitals and spaces don't matter, and the short name works too (`prank_1.m4a`). Any of
these formats works: m4a, mp3, wav, ogg, webm, aac, flac.

## 5. Send them

- **On GitHub:** open the repo's `tools/voices/recordings` folder, click
  **Add file → Upload files**, drag your whole folder (`john`) onto the page and click
  **Commit changes**. GitHub keeps the folder.
- **No GitHub account?** Just send the files to whoever runs the game (WhatsApp, email,
  Google Drive…) and tell them your in-game name. They'll upload them.

## What happens next

The person who runs the game converts the recordings with `tools/voices/import.py`.
It removes background noise and rumble, evens out the volume so every line is equally
loud, and makes small MP3 files. A line that anyone recorded no longer uses the robot
voice. If several friends recorded the same line, everyone hears a random one, except
when you are the one saying it: then it's your own take.

## All the lines

### Pitre Mode: players shouting

These play from the speaking player's foxhole, so everyone around hears them.

| File name | Say | When it plays | How |
|---|---|---|---|
| `pitre.prank` | "Prank 'em, John!" | The leader (the Cat in the Hat) gets a kill | smug, delighted |
| `pitre.byebye` | "Bye, bye!" | You kill someone | sing-song, drag out the last "byeeee" |
| `pitre.pussy` | "Oh, look! A pussy!" | You hit someone but don't kill them | taunting |
| `pitre.bullets` | "How many bullets?!" | Your 2nd hit in a row without a kill | outraged, rising at the end |
| `pitre.please` | "Bitch, please!" | A bullet just misses you | sassy, stretch out "pleeease" |
| `pitre.mama` | "Mama!" | You get hit | high, whiny baby voice |
| `pitre.brap` | "Brap brap brappp!" | Every shot you fire (when "brap" is on) | quick and punchy, three braps |
| `pitre.pufferfish` | a pufferfish noise: puff up, then pop or deflate | You die | silly; your own noise, not the meme clip |

### Jerry bots

| File name | Say | When it plays | How |
|---|---|---|---|
| `jerry.suppress` | "Suppressing fire!" | Jerry bots yell it while spraying the sky | panicky, a bit nasal |

### The announcer

The big voice that calls out what happens. Go deep and dramatic, like a stadium
announcer: slow, every word clear, with a punch at the end.

| File name | Say | When it plays |
|---|---|---|
| `ann.slay` | "Slay your enemies!" | The match starts |
| `ann.double` | "Double kill!" | 2 kills in quick succession |
| `ann.triple` | "Triple kill!" | 3 in quick succession |
| `ann.overkill` | "Overkill!" | 4 in quick succession |
| `ann.killtacular` | "Killtacular!" | 5 in quick succession |
| `ann.killtrocity` | "Killtrocity!" | 6 in quick succession |
| `ann.spree` | "Killing spree!" | 5 kills without dying |
| `ann.frenzy` | "Killing frenzy!" | 10 without dying |
| `ann.riot` | "Running riot!" | 15 without dying |
| `ann.rampage` | "Rampage!" | 20 without dying |
| `ann.untouchable` | "Untouchable!" | 25 without dying |
| `ann.headshot` | "Headshot!" | A headshot kill |
| `ann.killjoy` | "Killjoy!" | You end someone's killing spree |
| `ann.revenge` | "Revenge!" | You kill the player who last killed you |
| `ann.perfection` | "Perfection!" | You win without dying |
| `ann.lead_taken` | "You've taken the lead!" | You go into first place |
| `ann.lead_lost` | "You've lost the lead!" | Someone takes first place from you |
| `ann.cat_hat` | "Cat in the hat!" | You take the lead in Pitre Mode (sing-song: "CAT in the HAT!") |
| `ann.one_minute` | "One minute remaining!" | One minute left |
| `ann.ten_kills` | "Ten kills remaining!" | The leader needs 10 more kills |
| `ann.five_kills` | "Five kills remaining!" | The leader needs 5 more kills |
| `ann.game_over` | "Game over!" | The match ends |
| `ann.victory` | "Victory!" | You win |
| `ann.defeat` | "Defeat!" | You lose |
| `ann.gungame_level` | "Weapon upgraded!" | Gun Game: you move up to the next weapon |
| `ann.overshield` | "Overshield!" | You pick up this power-up |
| `ann.camo` | "Active camo!" | power-up |
| `ann.damage_boost` | "Damage boost!" | power-up |
| `ann.invincible` | "Invincibility!" | power-up |
| `ann.flamethrower` | "Flamethrower!" | power-up |
| `ann.minigun` | "Minigun!" | power-up |
| `ann.homing` | "Homing rounds!" | power-up |
| `ann.xray` | "X-ray vision!" | power-up |
| `ann.bighead` | "Big heads!" | power-up |
| `ann.orbital` | "Orbital strike!" | power-up |
| `ann.quickhands` | "Quick hands!" | power-up |
| `ann.spring` | "Spring jump!" | power-up |
| `ann.sauce` | "Gerry Sauce!" | power-up (the Super Soaker) |
