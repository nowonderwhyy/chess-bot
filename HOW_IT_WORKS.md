### Chess.com Assistant – How It Works (Layman’s Guide)

This Chrome extension overlays arrows on the Chess.com board showing Stockfish’s best move for the current position. You can choose the engine’s difficulty and timing strategy from the popup, and it can connect to a native Stockfish engine via a local WebSocket bridge for maximum strength.

This guide explains the moving parts in plain English: what runs where, how it reads the position, how it computes moves, and how the arrows are drawn.

---

### What you see as a user

- Open a game on Chess.com. After a short initialization, you’ll see colored arrows showing Stockfish’s recommended move(s). The overlay can show up to 5 candidate lines with distinct colors and small badges (eval, win%), with optional PV trail for the top line.
- Click the extension’s popup to set:
  - Engine level (0–20).
  - Think time per move (0.2–5.0s).
  - Number of lines to show (1–5).
  - Auto-move settings (experimental).

---

### Core idea in one sentence

The extension reads the current board position from the page, sends it to a Stockfish engine (by default a native engine over a local WebSocket bridge) to calculate the best move(s), then draws colored arrows over the Chess.com board.

---

### Where each piece runs

- Content script (`content.js`): Runs in the Chess.com tab. It injects a small helper script (`inject.js`), connects to Stockfish via WebSocket, listens for board updates, and draws arrows. It applies engine options (MultiPV, Hash, Threads, Elo limit, Ponder) and manages timing (fixed/adaptive).
- Injected page script (`inject.js`): Runs directly in the page context so it can access Chess.com’s web components to read the current position (FEN), which side you’re playing (white/black), clocks (when detectable), and the last move. It posts messages on game init and after every move.
- Background service worker (`background.js`): Forwards settings you pick in the popup (level, think time, MultiPV, Elo, Hash, Threads, Ponder, auto‑move, time mode, calibration, etc.) to the active Chess.com tab.
- Popup (`popup.html`, `popup.js`, `popup.css`): The UI where you set play strength (level or Elo), timing (fixed/adaptive), MultiPV, Hash, Threads, Ponder, minimal overlay, auto‑move confidence/delay, and can run a quick calibration.
- Manifest (`manifest.json`): Declares permissions, which files run where, and when.
  - Native bridge (`bridge/server.js`): A small Node.js WebSocket→UCI bridge that spawns the native Stockfish engine locally (not packaged in the extension). The extension connects to it at `ws://127.0.0.1:8181` by default.

---

### How the position is read from Chess.com

1. The content script injects `inject.js` into the page so it can interact with site internals that content scripts can’t access directly.
2. The injected script looks for Chess.com’s move list element (`wc-simple-move-list`). From there it can read:
   - FEN: a compact string that fully describes a chess position (piece placement, side to move, castling rights, etc.).
   - Your perspective: whether you’re playing as white or black (normalized to 1 or 2).
   - Clocks: remaining time and increments when detectable.
   - Last move: the latest UCI move if available.
3. On initial bind, `inject.js` posts an init message; after every move, it posts a move message, both via `window.postMessage`.

What this looks like in the code:

```235:241:inject.js
// Initial game info
gameInfo = getGameInfo(currentElement);
lastAnnouncedFen = gameInfo.fen;
window.postMessage({ type: 'GET_INIT_GAME_INFO', gameInfo: gameInfo }, '*');
```

---

### How Stockfish runs inside the extension

- This build is WebSocket-only; there is no Web Worker/WASM engine path.
- The content script connects to a native Stockfish process over a local WebSocket bridge (default `ws://127.0.0.1:8181`).
  - It initializes the engine (UCI), detects supported options (like `Threads`), and applies options such as `MultiPV`, `Hash`, `Skill Level` or `UCI_LimitStrength`/`UCI_Elo`, `Ponder`, and time‑management knobs.
- On each new FEN, it either uses fixed movetime or adaptive clocked time.
- It parses `info` lines for depth/NPS/MultiPV/WDL/TB and `bestmove`/`ponder` to render arrows and optionally auto‑move.

What this looks like in the code:

```109:123:content.js
// Connect to native Stockfish
let targetUrl = 'ws://127.0.0.1:8181';
stockfish = createWebSocketEngine(targetUrl);
stockfish.postMessage('uci');
```

---

### How the arrows get drawn

1. The script creates a transparent `<canvas>` and lays it directly over the Chess.com board (`wc-chess-board`). A `ResizeObserver` keeps it aligned when the board size changes.
2. It calculates the pixel location of each square (a1–h8) based on board size and whether you’re viewing from white’s or black’s side.
3. Using jCanvas (a tiny drawing helper on top of jQuery), it draws thick, rounded arrows from the “from” square to the “to” square, with an outline for contrast and per‑PV colors; PV1 can show a faint trail of subsequent moves.

Key points:
- Different colors are used for multiple move candidates (MultiPV), up to 5 lines.
- The canvas is cleared and redrawn after each move, perspective change, or resize.

---

### How your popup settings affect the engine

- The popup sends messages when you apply or toggle controls (level, think time/mode, MultiPV, Elo, Hash, Threads, Ponder, minimal overlay, auto‑move confidence/delay, calibration).
  - The background script forwards those messages to the active Chess.com tab.
  - The content script updates Stockfish accordingly:
  - Level changes update `Skill Level` (0–20) unless Elo‑limit is enabled.
  - Fixed time updates `go movetime <ms>`; Adaptive uses the game clock `go wtime/btime`.
  - MultiPV changes update how many lines Stockfish considers (1–5) and what the overlay draws.
  - Hash and Threads change engine memory and parallelism; Ponder lets the engine think on the opponent’s turn.
  - Minimal overlay draws PV1 only; calibration runs a quick speed test.

What this looks like in the code:

```1:28:background.js
// Forwards popup messages (set-level, set-think-time, set-multipv, set-elo, set-hash, set-threads, set-time-mode, set-ponder, set-autoplay-confidence, set-minimal-overlay, run-calibrate, …)
chrome.runtime.onMessage.addListener(function (request) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs && tabs.length) chrome.tabs.sendMessage(tabs[0].id, request);
  });
});
```

```402:480:content.js
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'set-level') {
    stockfish.postMessage(`setoption name Skill Level value ${request.radioValue}`);
    if (lastFen) processFEN(lastFen);
  }
  if (request.type === 'set-think-time') {
    selectedThinkMs = Math.max(200, Math.min(5000, parseInt(request.radioValue, 10) || 200));
    if (lastFen) processFEN(lastFen);
  }
  if (request.type === 'set-multipv') {
    stockfish.postMessage(`setoption name MultiPV value ${request.value}`);
    if (lastFen) processFEN(lastFen);
  }
});
```

---

### Permissions and safety

- Permissions declared in `manifest.json`:
  - `activeTab`: interact with the current page.
  - `storage`: save your settings (level, time mode, MultiPV, etc.).
  - `host_permissions` for `https://www.chess.com/*`: run only on Chess.com.
- No external servers are contacted by the extension. Optionally, it connects to a local WebSocket bridge on `127.0.0.1` that spawns a native Stockfish process on your machine.
- The script reads the page’s game state to compute and draw arrows; it does not upload your data.

```1:16:manifest.json
"permissions": ["activeTab", "storage"],
"host_permissions": ["https://www.chess.com/*"],
"background": { "service_worker": "background.js" }
```

---

### How to use it (step‑by‑step)

1. Start the native engine bridge (recommended):
   - Double‑click `bridge/start_stockfish_bridge.cmd` (or `start_stockfish_bridge_hidden.vbs`) to launch a local WebSocket server that spawns the native Stockfish.
   - Or run via Node: `cd bridge && npm install && npm start`.
   - By default it listens on `ws://127.0.0.1:8181`. You can change the URL in extension storage (`engineWsUrl`).
2. Load the unpacked extension in Chrome: open `chrome://extensions`, enable Developer mode, click “Load unpacked,” and select this folder.
3. Open a Chess.com game (live or daily). Wait a few seconds for initialization.
4. Open the popup to set level/Elo, MultiPV, time mode (Fixed vs Adaptive), Threads/Hash, Ponder, and overlay options. Arrows update automatically.

Troubleshooting tips:
- If arrows don’t appear, make sure the bridge is running (if using native engine) and that you’re on an actual game page and that a move has been made.
- If you switch sides (white/black) or the board orientation changes, the overlay re‑initializes automatically.
- Reload the tab if Chess.com updates its page structure and the script can’t find elements.

---

### Limitations and caveats

- This is tailored to Chess.com’s current page structure; major site updates can break it.
- Skill levels are approximate; engine strength depends on time/depth as well.
- Drawing depends on board size and overlay; unusual layouts may need a refresh.
- Using assistance like this can violate Chess.com’s Terms of Service and lead to account bans. Use strictly for learning and on accounts or contexts where it’s permitted.

---

### File map (what does what)

- `manifest.json`: Declares permissions and wires up scripts.
- `background.js`: Relays popup choices to the active tab.
- `content.js`: Connects to Stockfish (via local WebSocket), listens for game updates, computes moves, draws arrows.
- `inject.js`: Runs in page context; reads FEN, player color, clocks, and last move from Chess.com’s web components and reports changes.
- `lib/jquery-3.6.0.min.js`, `lib/jcanvas.min.js`: Helpers for DOM and drawing.
- `popup.html`, `popup.js`, `popup.css`: The small UI to set level and mode.
- `bridge/server.js`: Node.js WebSocket→UCI bridge that spawns native Stockfish (run separately from the extension).

---

### What’s inside `lib/` and how it works

- Stockfish engine is not bundled in `lib/`. Instead, the extension talks UCI strings to a local WebSocket bridge which spawns a native `stockfish-windows-x86-64-*.exe` on your machine. This yields maximum strength and performance.

- `lib/jcanvas.min.js` (jCanvas)
  - What it is: A small drawing helper that extends jQuery with canvas drawing APIs.
  - How it’s used here: To draw thick, rounded, arrow‑ended lines over the board. Example call used by the extension:
    - `$('#canvas').drawLine({ strokeStyle, strokeWidth, rounded, endArrow, x1, y1, x2, y2 })`
  - Why it helps: Simplifies translating “from square → to square” into a nice looking arrow without hand‑coding low‑level Canvas APIs.

- `lib/jquery-3.6.0.min.js` (jQuery)
  - What it is: The familiar DOM and event helper library.
  - How it’s used here:
    - In the content script: to target the overlay canvas and call jCanvas methods (`drawLine`, `clearCanvas`).
    - In the popup: to read slider/toggle selections and send messages when you click “Apply.”

Engine command quick reference used by the extension:

- Initialize: `uci`
- Set skill level: `setoption name Skill Level value <0..20>`
 - Limit by Elo: `setoption name UCI_LimitStrength value true` and `setoption name UCI_Elo value <1320..3190>`
- Set position: `position fen <FEN>`
- Think (fixed): `go movetime <ms>` (e.g. 200–5000 ms)
- Think (adaptive/clocked): `go wtime <ms> btime <ms> winc <ms> binc <ms>`

All messages are plain strings sent via `stockfish.postMessage(...)`, and replies are received on `stockfish.onmessage`.

---

### Glossary

- FEN: “Forsyth–Edwards Notation,” a single‑line description of a chess position.
- UCI: “Universal Chess Interface,” a simple text protocol to talk to chess engines like Stockfish.
- Content script: A script injected by a Chrome extension that runs in the context of a web page.
- Web component: A reusable custom element (Chess.com uses these for its board and move list).

---

### Ethics and fair play

Using computer assistance during online games is generally against site rules and fair play policies. Treat this project as an educational tool to learn about browser extensions, web components, and chess engines—not for cheating in rated games.


