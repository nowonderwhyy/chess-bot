### Chess.com Assistant – How It Works (Layman’s Guide)

This Chrome extension overlays arrows on the Chess.com board showing Stockfish’s best move for the current position. You can choose the engine’s difficulty and speed from the popup.

This guide explains the moving parts in plain English: what runs where, how it reads the position, how it computes moves, and how the arrows are drawn.

---

### What you see as a user

- Open a game on Chess.com. After a short initialization, you’ll see colored arrows showing Stockfish’s recommended move(s).
- Click the extension’s popup to set:
  - Engine level (0–20).
  - Think time per move (0.2–5.0s).
  - Number of lines to show (1–5).
  - Auto-move settings (experimental).

---

### Core idea in one sentence

The extension reads the current board position from the page, sends it to the built‑in Stockfish engine to calculate the best move, then draws colored arrows over the Chess.com board.

---

### Where each piece runs

- Content script (`content.js`): Runs in the Chess.com tab. It injects a small helper script (`inject.js`), launches Stockfish, listens for board updates, and draws arrows.
- Injected page script (`inject.js`): Runs directly in the page context so it can access Chess.com’s web components to read the current position (FEN) and which side you’re playing (white/black).
- Background service worker (`background.js`): Forwards settings you pick in the popup to the right tab.
- Popup (`popup.html`, `popup.js`, `popup.css`): The little UI where you set the engine level and mode.
- Manifest (`manifest.json`): Declares permissions, which files run where, and when.

---

### How the position is read from Chess.com

1. The content script injects `inject.js` into the page so it can interact with site internals that content scripts can’t access directly.
2. The injected script looks for Chess.com’s move list element (`wc-simple-move-list`). From there it can read:
   - FEN: a compact string that fully describes a chess position (piece placement, side to move, castling rights, etc.).
   - Your perspective: whether you’re playing as white or black.
3. On load and after every move, `inject.js` posts a simple window message back with the fresh game info.

What this looks like in the code:

```1:15:inject.js
const elements = document.querySelectorAll("wc-simple-move-list");
// ...
const fen = element.board.game.getFEN();
const playingAs = element.board.game.getPlayingAs();
window.postMessage({ type: 'move_made', gameInfo: { fen, playingAs } }, '*');
```

---

### How Stockfish runs inside the extension

- The content script loads `lib/stockfish.js` and starts it as a Web Worker (a background thread, no separate server required).
  - It initializes the engine (UCI protocol) and sets a default skill level.
- Every time a new FEN arrives, it tells Stockfish: “Here’s the position—think for a short time and give me your best move.”
- When Stockfish responds, the script parses `bestmove` and `ponder` from the engine’s text output.

What this looks like in the code:

```12:26:content.js
stockfish = new Worker(blobURL);
stockfish.postMessage('uci');
stockfish.postMessage('setoption name Skill Level value 8');
// ...
stockfish.onmessage = (event) => {
  if (event.data.includes('bestmove')) { /* parse and draw */ }
};
```

---

### How the arrows get drawn

1. The script creates a transparent `<canvas>` and lays it directly over the Chess.com board (`wc-chess-board`).
2. It calculates the pixel location of each square (a1–h8) based on board size and whether you’re viewing from white’s or black’s side.
3. Using jCanvas (a tiny drawing helper on top of jQuery), it draws thick, rounded arrows from the “from” square to the “to” square.

Key points:
- Different colors are used for multiple move candidates (MultiPV).
- The canvas is cleared and redrawn after each move or perspective change.

---

### How your popup settings affect the engine

- The popup sends messages when you click “Set” for level, think time, and MultiPV.
  - The background script forwards those messages to the active Chess.com tab.
  - The content script updates Stockfish accordingly:
  - Level changes update `Skill Level` (0–20).
  - Think-time changes update `go movetime <ms>`.
  - MultiPV changes update how many lines Stockfish considers.

What this looks like in the code:

```1:12:background.js
// Forwards popup messages (set-level, set-think-time, set-multipv, set-auto-move)
chrome.runtime.onMessage.addListener((request) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length) chrome.tabs.sendMessage(tabs[0].id, request);
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
  - `host_permissions` for `https://www.chess.com/*`: run only on Chess.com.
- No external servers are contacted. Stockfish runs locally in your browser.
- The script reads the page’s game state to compute and draw arrows; it does not upload your data.

```1:14:manifest.json
"permissions": ["activeTab"],
"host_permissions": ["https://www.chess.com/*"],
"background": { "service_worker": "background.js" }
```

---

### How to use it (step‑by‑step)

1. Load the unpacked extension in Chrome: open `chrome://extensions`, enable Developer mode, click “Load unpacked,” and select this folder.
2. Open a Chess.com game (live or daily). Wait 5–10 seconds for initialization.
3. If you want, open the popup to set a different engine level or mode. Arrows will update automatically.

Troubleshooting tips:
- If arrows don’t appear, make sure you’re on an actual game page and that a move has been made.
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
- `content.js`: Loads Stockfish, listens for game updates, computes moves, draws arrows.
- `inject.js`: Runs in page context; reads FEN and player color from Chess.com’s web components and reports changes.
- `lib/stockfish.js`: The chess engine, running locally as a Web Worker.
- `lib/jquery-3.6.0.min.js`, `lib/jcanvas.min.js`: Helpers for DOM and drawing.
- `popup.html`, `popup.js`, `popup.css`: The small UI to set level and mode.

---

### What’s inside `lib/` and how it works

- `lib/stockfish.js` (Stockfish engine)
  - What it is: A JavaScript build of the Stockfish chess engine that speaks UCI (Universal Chess Interface).
  - How it runs: Started as a Web Worker from the content script, so heavy computation doesn’t block the page UI.
  - Inputs it receives:
    - `uci`: initialize the engine
    - `setoption name Skill Level value N`: pick skill level (N from 0–20)
    - `position fen <FEN>`: set the current position
    - `go movetime 200` or `go depth N`: think for a fixed time or to a fixed depth
  - Outputs it sends back: text lines like `bestmove e2e4 ponder e7e5`. The content script parses these to draw arrows.
  - Notes: No network calls; runs fully in your browser. Performance depends on your CPU and mode (fast vs slow/deeper search).

- `lib/jcanvas.min.js` (jCanvas)
  - What it is: A small drawing helper that extends jQuery with canvas drawing APIs.
  - How it’s used here: To draw thick, rounded, arrow‑ended lines over the board. Example call used by the extension:
    - `$('#canvas').drawLine({ strokeStyle, strokeWidth, rounded, endArrow, x1, y1, x2, y2 })`
  - Why it helps: Simplifies translating “from square → to square” into a nice looking arrow without hand‑coding low‑level Canvas APIs.

- `lib/jquery-3.6.0.min.js` (jQuery)
  - What it is: The familiar DOM and event helper library.
  - How it’s used here:
    - In the content script: to target the overlay canvas and call jCanvas methods (`drawLine`, `clearCanvas`).
    - In the popup: to read radio button selections and send messages when you click “Set.”

Engine command quick reference used by the extension:

- Initialize: `uci`
- Set skill level: `setoption name Skill Level value <0..20>`
- Set position: `position fen <FEN>`
- Think (time control): `go movetime <ms>` (e.g. 200–5000 ms)

All messages are plain strings sent via `stockfish.postMessage(...)`, and replies are received on `stockfish.onmessage`.

---

### Glossary

- FEN: “Forsyth–Edwards Notation,” a single‑line description of a chess position.
- UCI: “Universal Chess Interface,” a simple text protocol to talk to chess engines like Stockfish.
- Content script: A script injected by a Chrome extension that runs in the context of a web page.
- Web Worker: A background thread in the browser for running heavy tasks without freezing the page.
- Web component: A reusable custom element (Chess.com uses these for its board and move list).

---

### Ethics and fair play

Using computer assistance during online games is generally against site rules and fair play policies. Treat this project as an educational tool to learn about browser extensions, web components, and chess engines—not for cheating in rated games.


