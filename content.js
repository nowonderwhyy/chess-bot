// content.js

// Inject the script to extract the FEN from the page
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
document.head.appendChild(script);

var rank = ["a", "b", "c", "d", "e", "f", "g", "h"];
var rankBlack = ["h", "g", "f", "e", "d", "c", "b", "a"];
var point = {};

let stockfish = null; // can be a Web Worker (wasm) or a WebSocket wrapper
let selectedLevel = "8";
let selectedThinkMs = 200; // default 200ms
let autoMoveEnabled = false;
let autoDelayBaseMs = 150;
let autoDelayJitterMs = 600;
let lastFen = null; // Remember last known position so we can re-evaluate on mode changes
let lastAutoMovedFen = null; // Avoid duplicate auto-moves on same position
let selectedMultiPV = 1; // number of candidate lines
// cache of parsed multi PVs for current position
// Each entry: { idx: number, move: string, moves: string[], score: { type: 'cp'|'mate', value: number }, wdl?: { w:number, d:number, l:number, winPct:number } }
let latestMultiPVLines = [];
let lastDrawAt = 0; // throttle PV arrow draws
let currentSearchToken = 0; // watchdog token for engine searches
let bestmoveTimerId = null; // watchdog timer id
let boardResizeObserver = null; // keep canvas aligned with board
// Manage engine readiness using UCI isready/readyok
let pendingReadyCallbacks = [];
let minimalOverlay = false; // when true, show only PV1 in overlay
function runWhenEngineReady(callback) {
    try {
        if (typeof callback === 'function') {
            pendingReadyCallbacks.push(callback);
        }
        if (stockfish) {
            stockfish.postMessage('isready');
        }
    } catch (_) {}
}
function createWebSocketEngine(url) {
    const ws = new WebSocket(url);
    const listeners = { message: [], error: [] };
    const sendQueue = [];
    let isOpen = false;
    let onmessage = null;
    let onerror = null;
    let onmessageerror = null;

    function flushQueue() {
        try {
            while (sendQueue.length > 0 && isOpen) {
                const msg = sendQueue.shift();
                ws.send(msg);
            }
        } catch (_) {}
    }

    ws.addEventListener('open', () => {
        isOpen = true;
        flushQueue();
    });
    ws.addEventListener('message', (ev) => {
        try {
            const data = typeof ev.data === 'string' ? ev.data : '';
            if (typeof onmessage === 'function') onmessage({ data });
            for (const fn of listeners.message) { try { fn({ data }); } catch (_) {} }
        } catch (_) {}
    });
    ws.addEventListener('error', (err) => {
        try {
            if (typeof onerror === 'function') onerror(err);
            for (const fn of listeners.error) { try { fn(err); } catch (_) {} }
        } catch (_) {}
    });
    ws.addEventListener('close', () => {
        isOpen = false;
    });

    return {
        postMessage(cmd) {
            try {
                const s = String(cmd);
                if (isOpen) ws.send(s); else sendQueue.push(s);
            } catch (_) {}
        },
        terminate() {
            try { ws.close(); } catch (_) {}
        },
        addEventListener(type, fn) {
            if (type === 'message') listeners.message.push(fn);
            if (type === 'error') listeners.error.push(fn);
        },
        set onmessage(fn) { onmessage = fn; },
        get onmessage() { return onmessage; },
        set onerror(fn) { onerror = fn; },
        get onerror() { return onerror; },
        set onmessageerror(fn) { onmessageerror = fn; },
        get onmessageerror() { return onmessageerror; },
    };
}

async function loadStockfish() {
    // Connect to native Stockfish via local WebSocket bridge
    // Default URL can be overridden by storage key 'engineWsUrl'
    let targetUrl = 'ws://127.0.0.1:8181';
    try {
        const obj = await new Promise((resolve) => {
            try { chrome.storage.sync.get({ engineWsUrl: targetUrl }, (items) => resolve(items)); }
            catch (_) { resolve({ engineWsUrl: targetUrl }); }
        });
        if (obj && typeof obj.engineWsUrl === 'string') targetUrl = obj.engineWsUrl;
    } catch (_) {}

    stockfish = createWebSocketEngine(targetUrl);

    stockfish.postMessage('uci');
    // Detect options reported by the engine
    let hasThreadsOption = false;
    let seenUciOk = false;
    // Load saved preferences before setting options
    const { engineLevel = "8", engineThinkMs = 200, engineMultiPV = 1, autoMove = false, autoMoveDelayBaseMs: storedBase = 150, autoMoveDelayJitterMs: storedJitter = 600, eloEnabled: storedEloEnabled = false, eloValue: storedElo = 1600, hashMb: storedHash = 64, ponderEnabled: storedPonder = false, autoMoveConfidencePct: storedConf = 0 } = await new Promise((resolve) => {
        try {
            chrome.storage.sync.get({ engineLevel: "8", engineThinkMs: 200, engineMultiPV: 1, autoMove: false, autoMoveDelayBaseMs: 150, autoMoveDelayJitterMs: 600, eloEnabled: false, eloValue: 1600, hashMb: 64, ponderEnabled: false, autoMoveConfidencePct: 0 }, (items) => resolve(items));
        } catch (e) {
            resolve({ engineLevel: "8", engineThinkMs: 200, engineMultiPV: 1, autoMove: false, autoMoveDelayBaseMs: 150, autoMoveDelayJitterMs: 600, eloEnabled: false, eloValue: 1600, hashMb: 64, ponderEnabled: false, autoMoveConfidencePct: 0 });
        }
    });
    // Clamp possible stored values to 0..20 range
    selectedLevel = String(Math.max(0, Math.min(20, parseInt(engineLevel, 10) || 8)));
    selectedThinkMs = Math.max(200, Math.min(5000, parseInt(engineThinkMs, 10) || 200));
    selectedMultiPV = Math.max(1, Math.min(5, parseInt(engineMultiPV, 10) || 1));
    autoMoveEnabled = Boolean(autoMove);
    autoDelayBaseMs = Math.max(0, Math.min(5000, parseInt(storedBase, 10) || 150));
    autoDelayJitterMs = Math.max(0, Math.min(20000, parseInt(storedJitter, 10) || 600));
    let eloEnabled = Boolean(storedEloEnabled);
    let eloValue = Math.max(800, Math.min(2800, parseInt(storedElo, 10) || 1600));
    let hashMb = Math.max(16, Math.min(256, parseInt(storedHash, 10) || 64));
    let ponderEnabled = Boolean(storedPonder);
    let autoMoveConfidencePct = Math.max(0, Math.min(20, parseInt(storedConf, 10) || 0));

    // Use all logical cores by default on native engine; only apply if supported by engine
    const threadsDefault = Math.max(1, Math.min(32, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 1));
    let selectedThreads = threadsDefault;

    const applyAllEngineOptions = () => {
        try {
            stockfish.postMessage(`setoption name MultiPV value ${selectedMultiPV}`);
            stockfish.postMessage('setoption name UCI_ShowWDL value true');
            if (eloEnabled) {
                stockfish.postMessage('setoption name UCI_LimitStrength value true');
                stockfish.postMessage(`setoption name UCI_Elo value ${eloValue}`);
            } else {
                stockfish.postMessage('setoption name UCI_LimitStrength value false');
                stockfish.postMessage(`setoption name Skill Level value ${selectedLevel}`);
            }
            stockfish.postMessage(`setoption name Hash value ${hashMb}`);
            if (hasThreadsOption) {
                stockfish.postMessage(`setoption name Threads value ${selectedThreads}`);
            }
            stockfish.postMessage(`setoption name Ponder value ${ponderEnabled ? 'true' : 'false'}`);
        } catch (_) {}
    };
    applyAllEngineOptions();
    console.log('[ChessBot] init settings:', { selectedLevel, selectedThinkMs, selectedMultiPV, autoMoveEnabled, autoDelayBaseMs, autoDelayJitterMs });

    stockfish.onmessage = function (event) {
        const moveRaw = String(event.data || '');
        if (moveRaw === 'readyok') {
            try {
                const cbs = pendingReadyCallbacks.splice(0, pendingReadyCallbacks.length);
                for (const cb of cbs) { try { cb(); } catch (_) {} }
            } catch (_) {}
            return;
        }
        // Detect engine UCI options on boot
        if (moveRaw.startsWith('option')) {
            if (/\bname\s+Threads\b/i.test(moveRaw)) {
                hasThreadsOption = true;
            }
        }
        if (moveRaw.trim() === 'uciok') {
            seenUciOk = true;
            applyAllEngineOptions();
            return;
        }
        // Parse MultiPV info lines: e.g., "info depth 20 seldepth 30 multipv 2 score cp 35 wdl 550 300 150 pv e2e4 e7e5 ..."
        if (moveRaw.startsWith('info')) {
            try {
                const line = moveRaw;
                const tokens = line.trim().split(/\s+/);
                const idxMulti = tokens.indexOf('multipv');
                const idxPv = tokens.indexOf('pv');
                const idxScore = tokens.indexOf('score');
                const idxWdl = tokens.indexOf('wdl');
                if (idxMulti > -1 && idxPv > -1 && idxPv + 1 < tokens.length) {
                    const pvIndex = parseInt(tokens[idxMulti + 1], 10) || 1;
                    const pvMoves = tokens.slice(idxPv + 1).filter(t => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t));
                    const firstMove = pvMoves && pvMoves.length > 0 ? pvMoves[0] : undefined;
                    let scoreObj = null;
                    if (idxScore > -1) {
                        const t = tokens[idxScore + 1];
                        const v = parseInt(tokens[idxScore + 2], 10);
                        if (t === 'cp' && !Number.isNaN(v)) scoreObj = { type: 'cp', value: v };
                        if (t === 'mate' && !Number.isNaN(v)) scoreObj = { type: 'mate', value: v };
                    }
                    let wdlObj = null;
                    if (idxWdl > -1 && idxWdl + 3 < tokens.length) {
                        const w = parseInt(tokens[idxWdl + 1], 10);
                        const d = parseInt(tokens[idxWdl + 2], 10);
                        const l = parseInt(tokens[idxWdl + 3], 10);
                        const sum = (w || 0) + (d || 0) + (l || 0);
                        const winPct = sum > 0 ? Math.round(((w || 0) / sum) * 100) : null;
                        if (!Number.isNaN(w) && !Number.isNaN(d) && !Number.isNaN(l)) {
                            wdlObj = { w, d, l, winPct };
                        }
                    }
                    if (firstMove && firstMove.length >= 4) {
                        latestMultiPVLines[pvIndex - 1] = { idx: pvIndex, move: firstMove, moves: pvMoves, score: scoreObj, wdl: wdlObj };
                        drawMultiPVArrows();
                    }
                }
            } catch (e) { console.warn('[ChessBot] Error parsing info line:', e); }
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

            // Always clear the watchdog on any bestmove (including "(none)")
            try {
                if (bestmoveTimerId) { clearTimeout(bestmoveTimerId); bestmoveTimerId = null; }
            } catch (_) {}

            if (bestToken && bestToken !== '(none)' && bestToken.length >= 4) {
                console.log('[ChessBot] bestmove:', bestToken);
                // On bestmove, ensure we have at least one arrow; fallback to best if MultiPV info didn't arrive
                if (!latestMultiPVLines[0]) {
                    latestMultiPVLines[0] = { idx: 1, move: bestToken, moves: [bestToken], score: null };
                }
                drawMultiPVArrows();
                // Remember predicted reply for pondering
                lastPredictedPonderMove = ponderToken && ponderToken.length >= 4 ? ponderToken : null;
                if (autoMoveEnabled) {
                    tryAutoMove(bestToken);
                }
            } else {
                console.log('[ChessBot] bestmove not found in:', moveRaw);
                // No legal move (e.g. mate/stalemate). Clear overlay and any ponder state.
                try { $("#canvas").clearCanvas(); } catch (e) {}
                latestMultiPVLines = [];
                lastPredictedPonderMove = null;
                isPondering = false;
            }
            if (ponderToken && ponderToken.length >= 4) {
                drawPonderMove(ponderToken);
            }
        }
    };

    // Auto-restart the engine on errors/message errors
    const nowMs = () => Date.now();
    let lastRestartAt = 0;
    function restartEngineSafely() {
        const since = nowMs() - lastRestartAt;
        if (since < 1000) return; // throttle restarts
        lastRestartAt = nowMs();
        try { stockfish.terminate(); } catch (e) {}
        stockfish = null;
        loadStockfish().then(() => {
            try {
                // restore options
                stockfish.postMessage(`setoption name Skill Level value ${selectedLevel}`);
                stockfish.postMessage(`setoption name MultiPV value ${selectedMultiPV}`);
                if (lastFen) {
                    const active = getActiveColorFromFEN(lastFen);
                    if (active == lastPlayingAs) {
                        processFEN(lastFen);
                    }
                }
            } catch (_) {}
        });
    }
    try {
        stockfish.addEventListener && stockfish.addEventListener('error', restartEngineSafely);
        stockfish.addEventListener && stockfish.addEventListener('messageerror', restartEngineSafely);
        stockfish.onerror = restartEngineSafely;
        stockfish.onmessageerror = restartEngineSafely;
    } catch (_) {}

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
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - lastDrawAt < 40) { return; }
    lastDrawAt = now;
    try { $("#canvas").clearCanvas(); } catch (e) {}
    const colors = [
        "rgba(24, 171, 219, 0.9)",   // blue for PV1
        "rgba(46, 204, 113, 0.9)",  // green for PV2
        "rgba(241, 196, 15, 0.9)",  // yellow for PV3
        "rgba(155, 89, 182, 0.9)",  // purple for PV4
        "rgba(230, 126, 34, 0.9)",  // orange for PV5
    ];
    const withAlpha = (c, a) => {
        if (typeof c !== 'string') return c;
        if (c.startsWith('rgba')) {
            return c.replace(/rgba\((\s*\d+\s*,\s*\d+\s*,\s*\d+\s*),\s*[\d.]+\s*\)/, `rgba($1, ${a})`);
        }
        if (c.startsWith('rgb(')) {
            return c.replace(/rgb\(([^)]+)\)/, `rgba($1, ${a})`);
        }
        return c;
    };
    const widthFor = (i) => [10, 8, 7, 6, 5][Math.min(i, 4)];
    const alphaFor = (i) => [0.95, 0.65, 0.5, 0.4, 0.3][Math.min(i, 4)];
    const shadowFor = (i) => [12, 6, 0, 0, 0][Math.min(i, 4)];
    const maxLines = minimalOverlay ? 1 : Math.min(selectedMultiPV, latestMultiPVLines.length);
    for (let i = 0; i < maxLines; i++) {
        const entry = latestMultiPVLines[i];
        const moveStr = typeof entry === 'string' ? entry : (entry && entry.move);
        if (!moveStr || moveStr.length < 4) continue;
        const moveFrom = moveStr.substring(0, 2);
        const moveTo = moveStr.substring(2, 4);
        const pf = point[moveFrom];
        const pt = point[moveTo];
        if (!pf || !pt) continue;
        const color = colors[i % colors.length];
        const alpha = alphaFor(i);
        const mainColor = withAlpha(color, alpha);
        const outlineColor = 'rgba(0,0,0,' + Math.max(0.12, alpha * 0.18).toFixed(2) + ')';
        const strokeWidth = widthFor(i);
        const shadowBlur = shadowFor(i);
        // Outline underlay for contrast
        $("#canvas").drawLine({
            strokeStyle: outlineColor,
            strokeWidth: strokeWidth + 2,
            rounded: true,
            endArrow: true,
            startArrow: false,
            arrowRadius: 15,
            arrowAngle: 45,
            x1: pf.width, y1: pf.height,
            x2: pt.width, y2: pt.height
        });
        // Main colored line
        $("#canvas").drawLine({
            strokeStyle: mainColor,
            strokeWidth: strokeWidth,
            rounded: true,
            endArrow: true,
            startArrow: false,
            arrowRadius: i === 0 ? 18 : 15,
            arrowAngle: 45,
            shadowColor: withAlpha(color, Math.min(1, alpha + 0.05)),
            shadowBlur: shadowBlur,
            x1: pf.width, y1: pf.height,
            x2: pt.width, y2: pt.height
        });
        // Ghost breadcrumbs for subsequent PV moves (PV1 only)
        try {
            const trailMoves = (i === 0 && entry && entry.moves) ? entry.moves.slice(1, 4) : [];
            const ghostColor = withAlpha(color, Math.max(0.15, alpha * 0.35));
            for (const mv of trailMoves) {
                if (typeof mv !== 'string' || mv.length < 4) continue;
                const f = point[mv.substring(0, 2)];
                const t = point[mv.substring(2, 4)];
                if (!f || !t) continue;
                $("#canvas").drawLine({
                    strokeStyle: ghostColor,
                    strokeWidth: Math.max(2, Math.round(strokeWidth * 0.4)),
                    rounded: true,
                    endArrow: false,
                    startArrow: false,
                    arrowRadius: 10,
                    arrowAngle: 45,
                    x1: f.width, y1: f.height,
                    x2: t.width, y2: t.height
                });
            }
        } catch (_) {}
        // Draw a small badge with eval and/or WDL if available
        try {
            if (entry && typeof entry === 'object') {
                const badgeX = pt.width - 12;
                const badgeY = pt.height - 12 - (i * 14);
                let label = '';
                if (entry.score) {
                    if (entry.score.type === 'cp') {
                        const v = (entry.score.value || 0) / 100;
                        label += (v >= 0 ? '+' : '') + v.toFixed(2);
                    } else if (entry.score.type === 'mate') {
                        label += '#'+ entry.score.value;
                    }
                }
                if (entry.wdl && typeof entry.wdl.winPct === 'number') {
                    if (label) label += ' · ';
                    label += String(entry.wdl.winPct) + '%';
                }
                if (label && (i === 0 || !minimalOverlay)) {
                    $("#canvas").drawText({
                        fillStyle: mainColor,
                        strokeStyle: "rgba(0,0,0,0.6)",
                        strokeWidth: 2,
                        x: badgeX,
                        y: badgeY + (i === 0 ? 0 : 2),
                        fontSize: i === 0 ? 14 : 11,
                        fontFamily: 'Arial',
                        text: (i === 0 ? '★ ' : '') + label,
                        fromCenter: false
                    });
                }
            }
        } catch (_) {}
        // For PV3+ use dashed strokes if visible
        if (!minimalOverlay && i >= 2) {
            try {
                const dash = [8, 8];
                $("#canvas").drawLine({
                    strokeStyle: mainColor,
                    strokeWidth: Math.max(3, Math.round(strokeWidth * 0.7)),
                    x1: pf.width, y1: pf.height,
                    x2: pt.width, y2: pt.height,
                    strokeDash: dash
                });
            } catch (_) {}
        }
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
    // Safety: ensure it's not duplicated or stale
    if (!lastFen) return;
    if (lastAutoMovedFen === lastFen) return; // avoid double fire on same position

    // Confidence gating using MultiPV and WDL/CP
    if (!passesAutoMoveConfidenceGate()) {
        return;
    }

    const { from, to, promo } = uciToSquares(uciMove);
    if (!from || !to) return;
    // Minimal legality check: ensure the 'from' square has our piece per FEN
    try {
        const piece = getFenSquarePiece(lastFen, from);
        if (!piece) return;
        const isWhitePiece = piece === piece.toUpperCase();
        if ((lastPlayingAs === 1 && !isWhitePiece) || (lastPlayingAs === 2 && isWhitePiece)) {
            return;
        }
    } catch (_) {}

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
        window.postMessage({ type: 'AUTO_MOVE', move: { from, to, promo: promo || (isPromotionMove(uciMove) ? 'q' : undefined) }, delayMs: delay }, '*');
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

function getFenSquarePiece(fen, square) {
    try {
        if (!fen || !square) return null;
        const boardPart = String(fen).split(' ')[0];
        const rows = boardPart.split('/');
        if (!rows || rows.length !== 8) return null;
        const file = square[0];
        const rankNum = parseInt(square[1], 10);
        if (!file || !(rankNum >= 1 && rankNum <= 8)) return null;
        const fileIndex = 'abcdefgh'.indexOf(file);
        if (fileIndex < 0) return null;
        // FEN rows go from rank 8 (index 0) to rank 1 (index 7)
        const rowIndex = 8 - rankNum;
        const row = rows[rowIndex];
        let col = 0;
        for (let i = 0; i < row.length; i++) {
            const ch = row[i];
            if (/[1-8]/.test(ch)) {
                col += parseInt(ch, 10);
            } else {
                if (col === fileIndex) return ch;
                col += 1;
            }
            if (col > 7) break;
        }
        return null;
    } catch (_) { return null; }
}

function processFEN(fen) {
    // Cancel any ongoing search before starting a new one
    try { stockfish.postMessage('stop'); } catch (e) { console.warn('[ChessBot] Failed to send "stop" to stockfish:', e); }

    // It's a new position, so clear the auto-move lock
    lastAutoMovedFen = null;

    const startSearch = () => {
        stockfish.postMessage('position fen ' + fen);
        // Reset cached PVs for this position
        latestMultiPVLines = new Array(Math.max(1, selectedMultiPV));
        stockfish.postMessage(`setoption name MultiPV value ${selectedMultiPV}`);
        // Use UCI clock fields if we have valid clocks; fallback to movetime otherwise
        const c = lastClocks && lastClocks.ok ? lastClocks : null;
        if (c && typeof c.wtime === 'number' && typeof c.btime === 'number') {
            const winc = typeof c.winc === 'number' ? c.winc : 0;
            const binc = typeof c.binc === 'number' ? c.binc : 0;
            try {
                stockfish.postMessage(`go wtime ${c.wtime} btime ${c.btime} winc ${winc} binc ${binc}`);
            } catch (_) {
                stockfish.postMessage(`go movetime ${selectedThinkMs}`);
            }
        } else {
            stockfish.postMessage(`go movetime ${selectedThinkMs}`);
        }
    };
    runWhenEngineReady(startSearch);

    // Watchdog: ensure we eventually get a bestmove; otherwise, retry this search
    function clearBestmoveWatchdog() {
        try { if (bestmoveTimerId) { clearTimeout(bestmoveTimerId); bestmoveTimerId = null; } } catch (_) {}
    }
    clearBestmoveWatchdog();
    const thisToken = ++currentSearchToken;
    const fenAtStart = fen;
    bestmoveTimerId = setTimeout(() => {
        if (thisToken !== currentSearchToken) return; // superseded
        if (!lastFen || lastFen !== fenAtStart) return; // position changed
        const active = getActiveColorFromFEN(lastFen);
        if (active !== lastPlayingAs) return; // not our turn anymore
        try {
            console.warn('[ChessBot] bestmove watchdog triggered; retrying search');
            stockfish.postMessage('stop');
            runWhenEngineReady(() => {
                try {
                    stockfish.postMessage('position fen ' + lastFen);
                    stockfish.postMessage(`setoption name MultiPV value ${selectedMultiPV}`);
                    const c = lastClocks && lastClocks.ok ? lastClocks : null;
                    if (c && typeof c.wtime === 'number' && typeof c.btime === 'number') {
                        const winc = typeof c.winc === 'number' ? c.winc : 0;
                        const binc = typeof c.binc === 'number' ? c.binc : 0;
                        stockfish.postMessage(`go wtime ${c.wtime} btime ${c.btime} winc ${winc} binc ${binc}`);
                    } else {
                        stockfish.postMessage(`go movetime ${selectedThinkMs}`);
                    }
                } catch (_) {}
            });
        } catch (_) {}
    }, Math.min(8000, Math.max(1000 + Number(selectedThinkMs) || 200, Number(selectedThinkMs) + 1200)));
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

function setupBoardResizeObserver(chessBoard) {
    try {
        if (!('ResizeObserver' in window) || !chessBoard) return;
        if (boardResizeObserver) {
            try { boardResizeObserver.disconnect(); } catch (_) {}
            boardResizeObserver = null;
        }
        const canvas = document.getElementById('canvas');
        boardResizeObserver = new ResizeObserver(() => {
            try {
                if (!canvas) return;
                canvas.width = chessBoard.offsetWidth;
                canvas.height = chessBoard.offsetHeight;
                // Recompute points to keep arrows aligned
                if (lastPlayingAs === 1) {
                    initializeWhite(chessBoard);
                } else if (lastPlayingAs === 2) {
                    initializeBlack(chessBoard);
                }
                drawMultiPVArrows();
            } catch (_) {}
        });
        boardResizeObserver.observe(chessBoard);
    } catch (_) {}
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

        // Notify engine of a new game and clear hash for fresh searches
        try {
            if (stockfish) {
                stockfish.postMessage('ucinewgame');
                stockfish.postMessage('setoption name Clear Hash value true');
            }
        } catch (_) {}

        // **Reinitialize the board based on color**
        if (gameInfo.playingAs === 1) {
            initializeWhite(chessBoard);
        } else {
            initializeBlack(chessBoard);
        }

        createCanvas(chessBoard);
        setupBoardResizeObserver(chessBoard);
    }
}

let lastPlayingAs = null; // Track previous player color
let lastClocks = { ok: false };
let lastPredictedPonderMove = null;
let isPondering = false;

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GET_INIT_GAME_INFO') {
        const gameInfo = {
            fen: event.data.gameInfo.fen,
            playingAs: event.data.gameInfo.playingAs,
            clocks: event.data.gameInfo.clocks || null,
            lastMoveUci: event.data.gameInfo.lastMoveUci || null,
        };

        lastFen = gameInfo.fen;
        reinitializeBoard(gameInfo);
        if (gameInfo.clocks && typeof gameInfo.clocks === 'object') {
            lastClocks = Object.assign({ ok: false, winc: 0, binc: 0 }, gameInfo.clocks);
        }
        // Only analyze on init if it's our turn to move
        const active = getActiveColorFromFEN(gameInfo.fen);
        if (active == gameInfo.playingAs) {
            processFEN(gameInfo.fen);
        } else {
            try { $("#canvas").clearCanvas(); } catch (e) {}
            // We just moved; start pondering if enabled
            startPonderIfEnabled(gameInfo.fen);
        }
    }

    if (event.data && event.data.type === 'move_made') {
        const gameInfo = {
            fen: event.data.gameInfo.fen,
            playingAs: event.data.gameInfo.playingAs,
            clocks: event.data.gameInfo.clocks || null,
            lastMoveUci: event.data.gameInfo.lastMoveUci || null,
        };

        $("#canvas").clearCanvas();

        lastFen = gameInfo.fen;
        reinitializeBoard(gameInfo);
        if (gameInfo.clocks && typeof gameInfo.clocks === 'object') {
            lastClocks = Object.assign({ ok: false, winc: 0, binc: 0 }, gameInfo.clocks);
        }

        const active = getActiveColorFromFEN(gameInfo.fen);
        if (active == gameInfo.playingAs) {
            // Opponent has just moved, it's our turn → ponder result handling
            if (isPondering) {
                const played = gameInfo.lastMoveUci || null;
                if (played && lastPredictedPonderMove && played.toLowerCase() === lastPredictedPonderMove.toLowerCase()) {
                    try { stockfish.postMessage('ponderhit'); } catch (_) {}
                } else {
                    try { stockfish.postMessage('stop'); } catch (_) {}
                }
                isPondering = false;
            }
            processFEN(gameInfo.fen);
        } else {
            // We just moved
            startPonderIfEnabled(gameInfo.fen);
        }
    }
});


// Listen to background.js
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type === 'set-level') {
        selectedLevel = String(Math.max(0, Math.min(20, parseInt(request.radioValue, 10) || 8)));
        console.log("Updating Stockfish level to:", selectedLevel);
        try { stockfish.postMessage(`setoption name Skill Level value ${selectedLevel}`); } catch (_) {}
        // Re-evaluate position with new level
        if (lastFen) {
            const active = getActiveColorFromFEN(lastFen);
            if (active == lastPlayingAs) { processFEN(lastFen); }
        }
    }
    if (request.type === 'set-think-time') {
        selectedThinkMs = Math.max(200, Math.min(5000, parseInt(request.radioValue, 10) || 200));
        console.log("Updating Stockfish think time to:", selectedThinkMs, "ms");
        if (lastFen) {
            const active = getActiveColorFromFEN(lastFen);
            if (active == lastPlayingAs) { processFEN(lastFen); }
        }
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
        try { stockfish.postMessage(`setoption name MultiPV value ${selectedMultiPV}`); } catch (_) {}
        if (lastFen) {
            const active = getActiveColorFromFEN(lastFen);
            if (active == lastPlayingAs) { processFEN(lastFen); }
        }
    }
    if (request.type === 'set-minimal-overlay') {
        minimalOverlay = Boolean(request.enabled);
        try { drawMultiPVArrows(); } catch (_) {}
    }
    if (request.type === 'set-elo-enabled') {
        const enabled = Boolean(request.enabled);
        chrome.storage.sync.get({ eloValue: 1600 }, (items) => {
            try {
                stockfish.postMessage(`setoption name UCI_LimitStrength value ${enabled ? 'true' : 'false'}`);
                if (enabled) {
                    const e = Math.max(800, Math.min(2800, parseInt(items.eloValue, 10) || 1600));
                    stockfish.postMessage(`setoption name UCI_Elo value ${e}`);
                } else {
                    stockfish.postMessage(`setoption name Skill Level value ${selectedLevel}`);
                }
            } catch (_) {}
        });
        if (lastFen) {
            const active = getActiveColorFromFEN(lastFen);
            if (active == lastPlayingAs) { processFEN(lastFen); }
        }
    }
    if (request.type === 'set-elo') {
        const elo = Math.max(800, Math.min(2800, parseInt(request.value, 10) || 1600));
        try {
            stockfish.postMessage(`setoption name UCI_Elo value ${elo}`);
        } catch (_) {}
        if (lastFen) {
            const active = getActiveColorFromFEN(lastFen);
            if (active == lastPlayingAs) { processFEN(lastFen); }
        }
    }
    if (request.type === 'set-hash') {
        const mb = Math.max(16, Math.min(256, parseInt(request.value, 10) || 64));
        try { stockfish.postMessage(`setoption name Hash value ${mb}`); } catch (_) {}
    }
    if (request.type === 'set-ponder') {
        const enabled = Boolean(request.enabled);
        try { stockfish.postMessage(`setoption name Ponder value ${enabled ? 'true' : 'false'}`); } catch (_) {}
    }
    if (request.type === 'set-autoplay-confidence') {
        autoMoveConfidencePct = Math.max(0, Math.min(20, parseInt(request.value, 10) || 0));
    }
});

// --- Helpers for auto-move gating and pondering ---
function passesAutoMoveConfidenceGate() {
    try {
        // No gating if disabled
        return (typeof autoMoveConfidencePct === 'number' && autoMoveConfidencePct > 0)
            ? compareTopTwoPVConfidence(autoMoveConfidencePct)
            : true;
    } catch (_) { return true; }
}

function compareTopTwoPVConfidence(thresholdPct) {
    if (!Array.isArray(latestMultiPVLines) || latestMultiPVLines.length < 2) return true;
    const a = latestMultiPVLines[0];
    const b = latestMultiPVLines[1];
    if (!a || !b) return true;
    const aWin = a.wdl && typeof a.wdl.winPct === 'number' ? a.wdl.winPct : null;
    const bWin = b.wdl && typeof b.wdl.winPct === 'number' ? b.wdl.winPct : null;
    if (aWin != null && bWin != null) {
        return (aWin - bWin) >= thresholdPct;
    }
    // Fallback to cp difference if WDL unavailable
    const aCp = a.score && a.score.type === 'cp' ? a.score.value : null;
    const bCp = b.score && b.score.type === 'cp' ? b.score.value : null;
    if (aCp != null && bCp != null) {
        return (aCp - bCp) >= 50; // ~0.5 pawn default guard
    }
    return true;
}

function startPonderIfEnabled(fen) {
    try {
        chrome.storage.sync.get({ ponderEnabled: false }, (items) => {
            if (!items || !items.ponderEnabled) return;
            try {
                stockfish.postMessage('stop');
            } catch (_) {}
            try {
                stockfish.postMessage('position fen ' + fen);
                stockfish.postMessage('go ponder');
                isPondering = true;
            } catch (_) { isPondering = false; }
        });
    } catch (_) {}
}
