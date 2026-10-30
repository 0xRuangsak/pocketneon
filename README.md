# Pocket Neon

Neon games to play with a friend, right in the browser. No app, no sign-up, no server: players connect peer-to-peer.

**Play:** https://0xruangsak.github.io/pocketneon/

**Games**

| Game | Players | Folder |
|---|---|---|
| [Texas Hold'em](https://0xruangsak.github.io/pocketneon/games/holdem/) | 1 v 1 online | [`games/holdem`](games/holdem) |

## Texas Hold'em

Heads-up no-limit tournament.

- 10,000 starting chips, blinds start at 100/200.
- Blinds go up every 8 hands: 100/200 → 150/300 → 200/400 → 300/600 → 400/800 → 500/1000 → 700/1400 → 1000/2000 → … → 5000/10000.
- Play until one player has all the chips, then rematch.

**How to play:** open the game, tap **Create table**, and share the invite link (or the 5-letter code). Your friend opens the link and you're in.

## How multiplayer works

Games use [PeerJS](https://peerjs.com) (WebRTC). The host's browser runs the game: it shuffles, deals and enforces the rules, then sends each player only what they're allowed to see. PeerJS's free public server is used only to introduce the two browsers; game data goes directly between them.

- The host must keep the page open; if they leave, the table closes.
- The host's browser holds the deck, so this is for playing with friends, not strangers.

## Run locally

Any static file server works:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. To test multiplayer on one computer without the internet, add `?local` to the game URL in two tabs (e.g. `http://localhost:8000/games/holdem/?local`). Tabs then connect through `BroadcastChannel` instead of PeerJS.

Run the rules tests (Node 20+):

```bash
npm test
```

## Deploy to GitHub Pages

Settings → Pages → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)`. The site appears at `https://<user>.github.io/pocketneon/`. There is no build step.

## Project layout

```
index.html              hub page listing the games
shared/theme.css        neon palette, fonts, buttons
shared/net.js           two-player rooms (PeerJS, or BroadcastChannel with ?local)
games/holdem/
  engine.js             game rules and state (no DOM, unit-tested)
  evaluator.js          poker hand ranking
  app.js                UI + networking glue
  index.html, style.css
tests/                  node --test unit tests
```

## Adding a game

1. Create `games/<name>/index.html` and link `../../shared/theme.css`.
2. For online play, use `openRoom()` from `shared/net.js`: the host runs the game logic and sends state, the guest sends moves.
3. Keep rules in a DOM-free module so they can be tested in `tests/`.
4. Add a card for it in the root `index.html` and a row in the table above.
