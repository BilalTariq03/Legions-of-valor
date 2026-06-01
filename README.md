# Legions of Valor — Browser Game Prototype

This is a playable online 1v1 browser prototype of **Legions of Valor** using:

- HTML
- CSS
- Vanilla JavaScript
- Firebase Realtime Database
- Firebase Anonymous Auth

It is designed to run in Microsoft Edge and other modern browsers.

---

## 1. How to run locally

### Windows / Microsoft Edge

Double-click:

```bat
run_game.bat
```

It starts a local server at:

```text
http://localhost:5173
```

Then it opens Microsoft Edge.

### Manual method

Open a terminal inside the project folder and run:

```bash
python -m http.server 5173
```

Then open:

```text
http://localhost:5173
```

Do **not** open `index.html` by double-clicking it. Browser modules need a local web server.

---

## 2. Important: online multiplayer setup

The game needs Firebase to work online. Without Firebase config, the UI can open, but invite-code online play will not work.

### Step A — Create Firebase project

1. Go to Firebase Console.
2. Create a new project.
3. Add a Web App.
4. Copy the Firebase config.

### Step B — Paste config

Open:

```text
/src/config/firebase-config.js
```

Replace the placeholder values with your Firebase config.

### Step C — Enable Anonymous Auth

Firebase Console:

```text
Build > Authentication > Sign-in method > Anonymous > Enable
```

### Step D — Enable Realtime Database

Firebase Console:

```text
Build > Realtime Database > Create Database
```

Start in test mode while developing, or use the included `database.rules.json` as a basic authenticated-room rule.

---

## 3. Testing online rooms

After Firebase is configured:

1. Run the local server.
2. Open the game in Edge.
3. Create a room.
4. Copy invite link.
5. Open the invite link in another browser profile, another device, or send it to another player.
6. Both players choose factions and press Ready.

For true worldwide play, deploy the folder to Firebase Hosting, Netlify, Vercel, or GitHub Pages.

---

## 4. Where to add card images

Card image folders are already structured:

```text
/assets/cards/elves/
/assets/cards/humans/
/assets/cards/orcs/
/assets/cards/dwarves/
/assets/cards/events/
/assets/cards/equipment/
/assets/cards/card-backs/
```

Every card in `/src/data/cards.js` has an `image` field. Add artwork using those exact file names.

Example:

```js
image: "assets/cards/humans/grand_marshal_leonard.png"
```

So place the image here:

```text
/assets/cards/humans/grand_marshal_leonard.png
```

If the image is missing, the card still works with a CSS placeholder.

---

## 5. File guide

```text
index.html                         Main browser page
styles.css                         Medieval fantasy interface styling
run_game.bat                       Windows local runner for Edge
run_game.sh                        macOS/Linux local runner
firebase-config.example.js         Backup example config shape
database.rules.json                Basic Firebase Realtime Database rules

src/main.js                        App startup and mouse click handling
src/firebase.js                    Firebase initialization
src/multiplayer.js                 Create/join room, invite code, realtime sync
src/config/firebase-config.js      Paste Firebase config here

src/data/cards.js                  Auto-generated card database
src/data/battleplans.js            Battleplan database
src/data/abilities.js              Ability text database

src/core/config.js                 Rule constants
src/core/game-state.js             Game state creation, decks, draw logic
src/core/rules.js                  Rule helpers and ability/event effects
src/core/reducer.js                Main game action reducer

src/ui/ui.js                       All interface rendering

assets/cards/...                   Card image folders
assets/icons/abilities/            Future ability icon folder
assets/backgrounds/                Future background art folder
docs/IMPLEMENTATION_NOTES.md       Notes on simplifications
```

---

## 6. Current implemented gameplay

- Room creation
- Invite-code joining
- Player seats
- Faction selection
- Ready-up start
- Preset faction decks
- 3-lane battlefield
- Back Row Ruse/Trap system
- Battleplan Strategy Phase
- Deployment Phase
- Conflict Phase
- Commit and Cautious Strike
- Parry Chain modal
- Aurion scoring
- Side-lane scoring
- Battleplan objective rewards
- Momentum at 10 and 20 Aurion
- Game over at 25 Aurion

---

## 7. Known prototype limitations

This is a playable MVP, not a final commercial build.

- The opponent’s hand is hidden visually, but Firebase stores the full state. This is normal for a hobby prototype but not secure against cheating through DevTools.
- Some advanced card abilities are simplified or logged as “not fully implemented yet.”
- Some effects that should ask players to choose cards are automated for now.
- There is no matchmaking, accounts, ranking, or deck builder yet.
- There is no AI opponent yet.

For a serious release, the next step would be server-authoritative rules using Firebase Cloud Functions or a custom Node server.

---

## 8. Beginner editing tips

Change rule values in:

```text
/src/core/config.js
```

Change visual style in:

```text
/styles.css
```

Add or edit cards in:

```text
/src/data/cards.js
```

Add deeper ability logic in:

```text
/src/core/rules.js
```

Most mouse actions are handled in:

```text
/src/main.js
```

## No-Python Local Runner

If `run_game.bat` or `CLICK_ME_RUN_GAME_VISIBLE.bat` says Python is not installed, use:

```text
CLICK_ME_RUN_GAME_NO_PYTHON.bat
```

This starts a small PowerShell local server. Keep the PowerShell window open while playing. The game will open in Microsoft Edge at `http://localhost:5173/` or the next available port.
