// content.js

// Inject the script to extract the FEN from the page
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
document.head.appendChild(script);

var rank = ["a", "b", "c", "d", "e", "f", "g", "h"];
var rankBlack = ["h", "g", "f", "e", "d", "c", "b", "a"];
var point = {};

let stockfish = null;
let selectedMode = "1"; // Legacy, kept for backward compat
let selectedLevel = "8";
let selectedThinkMs = 200; // default 200ms
let autoMoveEnabled = false;
let autoDelayBaseMs = 150;
let autoDelayJitterMs = 600;
let lastFen = null; // Remember last known position so we can re-evaluate on mode changes
let lastAutoMovedFen = null; // Avoid duplicate auto-moves on same position
let selectedMultiPV = 1; // number of candidate lines
let latestMultiPVLines = []; // cache of parsed multi PVs for current position
async function loadStockfish() {
    // Charger le fichier Stockfish.js en tant que texte
    const response = await fetch(chrome.runtime.getURL('lib/stockfish.js'));
    const stockfishScript = await response.text();

    // Créer un Blob avec le script
    const blob = new Blob([stockfishScript], { type: 'application/javascript' });
    const blobURL = URL.createObjectURL(blob);

    // Lancer le Web Worker avec le Blob URL
    stockfish = new Worker(blobURL);

    stockfish.postMessage('uci');
    // Load saved preferences before setting options
    const { engineLevel = "8", engineMode = "1", engineThinkMs = 200, engineMultiPV = 1, autoMove = false, autoMoveDelayBaseMs: storedBase = 150, autoMoveDelayJitterMs: storedJitter = 600 } = await new Promise((resolve) => {
        try {
            chrome.storage.sync.get({ engineLevel: "8", engineMode: "1", engineThinkMs: 200, engineMultiPV: 1, autoMove: false, autoMoveDelayBaseMs: 150, autoMoveDelayJitterMs: 600 }, (items) => resolve(items));
        } catch (e) {
            resolve({ engineLevel: "8", engineMode: "1", engineThinkMs: 200, engineMultiPV: 1, autoMove: false, autoMoveDelayBaseMs: 150, autoMoveDelayJitterMs: 600 });
        }
    });
    // Clamp possible stored values to 0..20 range
    selectedLevel = String(Math.max(0, Math.min(20, parseInt(engineLevel, 10) || 8)));
    selectedMode = String(engineMode);
    selectedThinkMs = Math.max(200, Math.min(5000, parseInt(engineThinkMs, 10) || 200));
    selectedMultiPV = Math.max(1, Math.min(5, parseInt(engineMultiPV, 10) || 1));
    autoMoveEnabled = Boolean(autoMove);
    autoDelayBaseMs = Math.max(0, Math.min(5000, parseInt(storedBase, 10) || 150));
    autoDelayJitterMs = Math.max(0, Math.min(20000, parseInt(storedJitter, 10) || 600));
    stockfish.postMessage(`setoption name Skill Level value ${selectedLevel}`);
    stockfish.postMessage(`setoption name MultiPV value ${selectedMultiPV}`);
    console.log('[ChessBot] init settings:', { selectedLevel, selectedThinkMs, selectedMultiPV, autoMoveEnabled, autoDelayBaseMs, autoDelayJitterMs });

    stockfish.onmessage = function (event) {
        const moveRaw = String(event.data || '');
        // Parse MultiPV info lines: e.g., "info depth 20 seldepth 30 multipv 2 score cp 35 pv e2e4 e7e5 ..."
        if (moveRaw.startsWith('info')) {
            try {
                const line = moveRaw;
                const tokens = line.trim().split(/\s+/);
                const idxMulti = tokens.indexOf('multipv');
                const idxPv = tokens.indexOf('pv');
                if (idxMulti > -1 && idxPv > -1 && idxPv + 1 < tokens.length) {
                    const pvIndex = parseInt(tokens[idxMulti + 1], 10) || 1;
                    const firstMove = tokens[idxPv + 1];
                    // Store by pv index (1-based)
                    if (firstMove && firstMove.length >= 4) {
                        latestMultiPVLines[pvIndex - 1] = firstMove;
                        drawMultiPVArrows();
                    }
                }
            } catch (e) {}
        }
        if (moveRaw.startsWith('bestmove')) {
            // Formats:
            // - "bestmove e2e4 ponder e7e5"
            // - "bestmove e2e4"
            // - "bestmove (none)"
            const tokens = moveRaw.trim().split(/\s+/);
            const idxBest = tokens.indexOf('bestmove');
            const bestToken = idxBest >= 0 ? tokens[idxBest + 1] : undefined;
            const idxPonder = tokens.indexOf('ponder');
            const ponderToken = idxPonder >= 0 ? tokens[idxPonder + 1] : undefined;

            if (bestToken && bestToken !== '(none)' && bestToken.length >= 4) {
                console.log('[ChessBot] bestmove:', bestToken);
                // On bestmove, ensure we have at least one arrow; fallback to best if MultiPV info didn't arrive
                if (!latestMultiPVLines[0]) {
                    latestMultiPVLines[0] = bestToken;
                }
                drawMultiPVArrows();
                if (autoMoveEnabled) {
                    tryAutoMove(bestToken);
                }
            } else {
                console.log('[ChessBot] bestmove not found in:', moveRaw);
            }
            if (ponderToken && ponderToken.length >= 4) {
                drawPonderMove(ponderToken);
            }
        }
    };

    return stockfish;
}

// Exécuter la fonction immédiatement
loadStockfish().then((stockfish) => {
    console.log("Stockfish loaded!");
});

function initializeBlack(board) {
    if (!board) return;
    board.style.position = "relative";
    var itemWidth = board.offsetWidth / 8;
    var itemHeight = board.offsetHeight / 8;
    point = {};
    for (var x = 0; x < 8; x++) {
        var width = itemWidth * (x + 1);
        for (var y = 1; y < 9; y++) {
            var coord = rankBlack[x] + y;
            point[coord] = {
                width: width - itemWidth / 2,
                height: itemHeight * y - itemHeight / 2,
            };
        }
    }
}

function initializeWhite(board) {
    if (!board) return;
    board.style.position = "relative";
    var itemWidth = board.offsetWidth / 8;
    var itemHeight = board.offsetHeight / 8;
    point = {};
    for (var x = 0; x < 8; x++) {
        var width = itemWidth * (x + 1);
        for (var y = 8; y > 0; y--) {
            var coord = rank[x] + y;
            point[coord] = {
                width: width - itemWidth / 2,
                height: itemHeight * (9 - y) - itemHeight / 2,
            };
        }
    }
}

function getActiveColorFromFEN(FEN) {
    var activeColor = FEN.split(" ")[1];
    if (activeColor == "w") {
        return 1;//white
    } else {
        return 2;
    }
}

function drawBestMove(bestmove){
    var moveFrom = bestmove.substring(0, 2);
    var moveTo = bestmove.substring(2, 4);

    var pf = point[moveFrom];
    var pt = point[moveTo];

    if (!pf || !pt) {
        return;
    }

    $('#canvas').drawLine({
        strokeStyle: "rgba(24, 171, 219, 0.8)",//blue
        strokeWidth: 8,
        rounded: true,
        endArrow: true,
        startArrow: false,
        arrowRadius: 15,
        arrowAngle: 45,
        x1: pf.width, y1: pf.height,
        x2: pt.width, y2: pt.height
    });
}

function drawPonderMove(pondermove){
    var moveFrom = pondermove.substring(0, 2);
    var moveTo = pondermove.substring(2, 4);

    var pf = point[moveFrom];
    var pt = point[moveTo];

    if (!pf || !pt) {
        return;
    }

    $('#canvas').drawLine({
        strokeStyle: "rgba(191,63,63,0.8)",//red
        strokeWidth: 8,
        rounded: true,
        endArrow: true,
        startArrow: false,
        arrowRadius: 15,
        arrowAngle: 45,
        x1: pf.width, y1: pf.height,
        x2: pt.width, y2: pt.height
    });
}

function drawMultiPVArrows() {
    // Clear then draw arrows for up to selectedMultiPV lines using distinct colors
    try { $("#canvas").clearCanvas(); } catch (e) {}
    const colors = [
        "rgba(24, 171, 219, 0.9)",   // blue for PV1
        "rgba(46, 204, 113, 0.9)",  // green for PV2
        "rgba(241, 196, 15, 0.9)",  // yellow for PV3
        "rgba(155, 89, 182, 0.9)",  // purple for PV4
        "rgba(230, 126, 34, 0.9)",  // orange for PV5
    ];
    for (let i = 0; i < Math.min(selectedMultiPV, latestMultiPVLines.length); i++) {
        const move = latestMultiPVLines[i];
        if (!move || move.length < 4) continue;
        const moveFrom = move.substring(0, 2);
        const moveTo = move.substring(2, 4);
        const pf = point[moveFrom];
        const pt = point[moveTo];
        if (!pf || !pt) continue;
        $("#canvas").drawLine({
            strokeStyle: colors[i % colors.length],
            strokeWidth: i === 0 ? 8 : 6,
            rounded: true,
            endArrow: true,
            startArrow: false,
            arrowRadius: 15,
            arrowAngle: 45,
            x1: pf.width, y1: pf.height,
            x2: pt.width, y2: pt.height
        });
    }
}

function uciToSquares(uciMove) {
    // basic form: e2e4, with optional promotion e7e8q
    const move = String(uciMove || '').toLowerCase().trim();
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const promo = move.length >= 5 ? move[4] : undefined;
    return { from, to, promo };
}

function getBoardElement() {
    return document.querySelector('wc-chess-board');
}

function getSquareElement(boardEl, algebraic) {
    if (!boardEl || !algebraic) return null;
    // Chess.com internal squares are shadow DOM inside wc-chess-board. Try to locate via data-square coords on piece/square layers.
    // Fallback to hit-testing using our computed points on the overlay canvas.
    try {
        // Attempt: query pieces that have square attribute
        const pieceLayer = boardEl.shadowRoot ? boardEl.shadowRoot.querySelector('div[data-board-layer="piece"]') : null;
        if (pieceLayer) {
            const target = pieceLayer.querySelector(`[data-square='${algebraic}']`);
            if (target) return target;
        }
    } catch (e) {}
    return null;
}

function getCanvasCenterForSquare(algebraic) {
    const p = point[algebraic];
    if (!p) return null;
    // Return coordinates relative to the board, which matches the overlay canvas
    return { x: p.width, y: p.height };
}

function dispatchMouse(boardContainer, type, x, y) {
    const evt = new MouseEvent(type, {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: Math.round(x),
        clientY: Math.round(y),
    });
    boardContainer.dispatchEvent(evt);
}

function simulateClickMove(fromSquare, toSquare) {
    // Strategy: send mousedown/mouseup at source then at target relative to the board container
    const board = document.querySelector('wc-chess-board');
    if (!board) return false;
    const boardRect = board.getBoundingClientRect();
    const fromPos = getCanvasCenterForSquare(fromSquare);
    const toPos = getCanvasCenterForSquare(toSquare);
    if (!fromPos || !toPos) return false;
    const fromX = boardRect.left + fromPos.x;
    const fromY = boardRect.top + fromPos.y;
    const toX = boardRect.left + toPos.x;
    const toY = boardRect.top + toPos.y;

    try {
        const fromEl = document.elementFromPoint(fromX, fromY) || board;
        const toEl = document.elementFromPoint(toX, toY) || board;
        dispatchMouse(fromEl, 'mousedown', fromX, fromY);
        dispatchMouse(fromEl, 'mouseup', fromX, fromY);
        dispatchMouse(fromEl, 'click', fromX, fromY);
        dispatchMouse(toEl, 'mousedown', toX, toY);
        dispatchMouse(toEl, 'mouseup', toX, toY);
        dispatchMouse(toEl, 'click', toX, toY);
        return true;
    } catch (e) {
        return false;
    }
}

function isPromotionMove(uciMove) {
    return String(uciMove || '').length >= 5; // e.g. e7e8q
}

function tryAutoMove(uciMove) {
    // Safety: do not attempt promotions or if it's not our turn
    if (isPromotionMove(uciMove)) return;
    if (!lastFen) return;
    if (lastAutoMovedFen === lastFen) return; // avoid double fire on same position

    const { from, to } = uciToSquares(uciMove);
    if (!from || !to) return;

    const board = document.querySelector('wc-chess-board');
    if (!board) return;

    // Extra safety: ensure it's our move according to FEN vs UI color
    const active = getActiveColorFromFEN(lastFen);
    if (active !== lastPlayingAs) return;

    const base = Math.max(0, Number(autoDelayBaseMs) || 0);
    const margin = Math.max(0, Number(autoDelayJitterMs) || 0);
    const delay = base + Math.floor(Math.random() * (margin + 1));
    // Prefer page-context executor via window message
    try {
        window.postMessage({ type: 'AUTO_MOVE', move: { from, to }, delayMs: delay }, '*');
        console.log('[ChessBot] requested AUTO_MOVE', { from, to, delay, base, margin });
        lastAutoMovedFen = lastFen;
        return;
    } catch (e) {
        console.warn('[ChessBot] AUTO_MOVE postMessage failed, falling back', e);
    }
    // Fallback: simulate clicks from content context
    window.setTimeout(() => {
        const ok = simulateClickMove(from, to);
        if (ok) {
            lastAutoMovedFen = lastFen;
        } else {
            console.warn('[ChessBot] simulateClickMove failed', { from, to });
        }
    }, delay);
}

function processFEN(fen) {
    // Cancel any ongoing search before starting a new one
    try { stockfish.postMessage('stop'); } catch (e) {}

    stockfish.postMessage('position fen ' + fen);
    // Use selected think time for search
    // Reset cached PVs for this position
    latestMultiPVLines = new Array(Math.max(1, selectedMultiPV));
    stockfish.postMessage(`setoption name MultiPV value ${selectedMultiPV}`);
    stockfish.postMessage(`go movetime ${selectedThinkMs}`);
}

/**
 * Creates and appends the canvas element to the chessboard.
 */
function createCanvas(chessBoard) {
    if (!chessBoard) return;

    var canvas = document.createElement("canvas");
    canvas.id = "canvas";
    canvas.width = chessBoard.offsetWidth;
    canvas.height = chessBoard.offsetHeight;
    canvas.style.position = "absolute";
    canvas.style.left = 0;
    canvas.style.top = 0;
    canvas.style.pointerEvents = "none";

    chessBoard.appendChild(canvas);
}

function reinitializeBoard(gameInfo) {
    var chessBoard = document.querySelector('wc-chess-board');

    // **Reinitialize board if color changed or if canvas is missing**
    if (lastPlayingAs !== gameInfo.playingAs || !document.getElementById("canvas")) {
        lastPlayingAs = gameInfo.playingAs;

        // **Clear old board state**
        if (document.getElementById("canvas")) {
            document.getElementById("canvas").remove();
        }

        // **Reinitialize the board based on color**
        if (gameInfo.playingAs === 1) {
            initializeWhite(chessBoard);
        } else {
            initializeBlack(chessBoard);
        }

        createCanvas(chessBoard);
    }
}

let lastPlayingAs = null; // Track previous player color

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GET_INIT_GAME_INFO') {
        const gameInfo = {
            fen: event.data.gameInfo.fen,
            playingAs: event.data.gameInfo.playingAs,
        };

        lastFen = gameInfo.fen;
        reinitializeBoard(gameInfo);

        processFEN(gameInfo.fen);
    }

    if (event.data && event.data.type === 'move_made') {
        const gameInfo = {
            fen: event.data.gameInfo.fen,
            playingAs: event.data.gameInfo.playingAs,
        };

        $("#canvas").clearCanvas();

        lastFen = gameInfo.fen;
        reinitializeBoard(gameInfo);

        const active = getActiveColorFromFEN(gameInfo.fen);
        if (active == gameInfo.playingAs) {
            processFEN(gameInfo.fen);
        } else {
            // Opponent's turn: allow auto-move again on next our-turn position
            lastAutoMovedFen = null;
        }
    }
});


// Listen to background.js
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type === 'set-level') {
        selectedLevel = String(Math.max(0, Math.min(20, parseInt(request.radioValue, 10) || 8)));
        console.log("Updating Stockfish level to:", selectedLevel);
        stockfish.postMessage(`setoption name Skill Level value ${selectedLevel}`);
    }
    if (request.type === 'set-mode') {
        // Legacy support: map Fast/Slow to 200ms/2000ms
        selectedMode = String(request.radioValue);
        selectedThinkMs = selectedMode === '2' ? 2000 : 200;
        console.log("Updating Stockfish think time (legacy mode) to:", selectedThinkMs, "ms");
        if (lastFen) { processFEN(lastFen); }
    }
    if (request.type === 'set-think-time') {
        selectedThinkMs = Math.max(200, Math.min(5000, parseInt(request.radioValue, 10) || 200));
        console.log("Updating Stockfish think time to:", selectedThinkMs, "ms");
        if (lastFen) { processFEN(lastFen); }
    }
    if (request.type === 'set-auto-move') {
        autoMoveEnabled = Boolean(request.enabled);
        // Refresh base/jitter from storage on changes
        chrome.storage.sync.get({ autoMoveDelayBaseMs: 150, autoMoveDelayJitterMs: 600 }, (items) => {
            autoDelayBaseMs = Math.max(0, Math.min(5000, parseInt(items.autoMoveDelayBaseMs, 10) || 150));
            autoDelayJitterMs = Math.max(0, Math.min(20000, parseInt(items.autoMoveDelayJitterMs, 10) || 600));
            console.log("Auto-move:", autoMoveEnabled, "Base:", autoDelayBaseMs, "Jitter:", autoDelayJitterMs);
        });
    }
    if (request.type === 'set-multipv') {
        const mpv = Math.max(1, Math.min(5, parseInt(request.value, 10) || 1));
        selectedMultiPV = mpv;
        console.log("Updating Stockfish MultiPV to:", selectedMultiPV);
        stockfish.postMessage(`setoption name MultiPV value ${selectedMultiPV}`);
        if (lastFen) { processFEN(lastFen); }
    }
});
