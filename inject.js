// inject.js

const MAX_RETRIES = 100;
let retryCount = 0;
let currentElement = null; // active wc-simple-move-list
let gameObserver = null;
let boardObserver = null;
let fenPollTimerId = null;
let docObserver = null;
let urlWatchTimerId = null;
let lastAnnouncedFen = null;

// Helper function to extract game info
function getGameInfo(element) {
    const fen = element.board.game.getFEN();
    const raw = element.board.game.getPlayingAs();
    // Normalize to 1 (white) / 2 (black)
    let playingAs = raw;
    if (raw !== 1 && raw !== 2) {
        if (raw === 'white' || raw === 'w' || raw === 0) playingAs = 1;
        else if (raw === 'black' || raw === 'b') playingAs = 2;
    }
    const clocks = sampleClocks(element, playingAs);
    const lastMoveUci = sampleLastMoveUci(element);
    return { fen, playingAs, clocks, lastMoveUci };
}

function parseMsFromClockText(txt) {
    // Supports mm:ss, h:mm:ss
    if (!txt) return null;
    const m = String(txt).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1] || '0', 10);
    const mm = parseInt(m[2] || '0', 10);
    const ss = parseInt(m[3] || '0', 10);
    if (Number.isNaN(h) || Number.isNaN(mm) || Number.isNaN(ss)) return null;
    return ((h * 3600) + (mm * 60) + ss) * 1000;
}

function sampleClocks(element, playingAs) {
    // Try to glean clocks from DOM; if not found, return {ok:false}
    try {
        const result = { ok: false, wtime: 0, btime: 0, winc: 0, binc: 0 };
        // a) Try game object APIs if present
        try {
            const g = element && element.board && element.board.game;
            if (g) {
                const wms = typeof g.getWhiteTime === 'function' ? g.getWhiteTime() : null;
                const bms = typeof g.getBlackTime === 'function' ? g.getBlackTime() : null;
                if (typeof wms === 'number' && typeof bms === 'number') {
                    result.wtime = Math.max(0, Math.floor(wms));
                    result.btime = Math.max(0, Math.floor(bms));
                    result.ok = true;
                }
                const inc = typeof g.getIncrement === 'function' ? g.getIncrement() : null;
                if (typeof inc === 'number') {
                    result.winc = Math.max(0, Math.floor(inc));
                    result.binc = Math.max(0, Math.floor(inc));
                }
                if (result.ok) return result;
            }
        } catch (_) {}
        // Prefer explicit clock components
        const candidates = Array.from(document.querySelectorAll('[data-cy*="clock"], .clock, .clock-component, [class*="clock"]'));
        const texts = candidates.map(el => (el && el.isConnected && el.offsetParent !== null) ? (el.textContent || '').trim() : '').filter(Boolean);
        // Fallback: scan spans/divs for mm:ss
        if (texts.length < 2) {
            const generic = Array.from(document.querySelectorAll('span,div,strong'))
                .filter(el => el && el.isConnected && el.offsetParent !== null)
                .map(el => (el.textContent || '').trim())
                .filter(Boolean)
                .filter(t => /\b\d{1,2}:\d{2}\b/.test(t));
            texts.push(...generic.slice(0, 4));
        }
        // Extract first two plausible times
        const times = [];
        for (const t of texts) {
            const m = t.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g);
            if (m) {
                for (const piece of m) {
                    const ms = parseMsFromClockText(piece);
                    if (typeof ms === 'number') times.push(ms);
                    if (times.length >= 2) break;
                }
            }
            if (times.length >= 2) break;
        }
        if (times.length >= 2) {
            // Heuristic: the top/left clock generally belongs to the opponent, bottom/right to us.
            // Without precise mapping, assume order [opponent, us] in many layouts, but we have playingAs.
            // We'll map based on playingAs: if white (1), wtime is likely the second time; if black (2), wtime first.
            if (playingAs === 1) {
                result.wtime = times[1] || times[0];
                result.btime = times[0];
            } else {
                result.wtime = times[0];
                result.btime = times[1] || times[0];
            }
            result.ok = true;
        }
        // Attempt to parse increments from any visible time control string like "5 | 3" or "5+3"
        const incMs = sampleIncrementMs();
        if (typeof incMs === 'number' && incMs >= 0) {
            result.winc = incMs;
            result.binc = incMs;
        }
        return result;
    } catch (e) {
        return { ok: false };
    }
}

function sampleIncrementMs() {
    try {
        // Scan common containers for time control signatures
        const nodes = Array.from(document.querySelectorAll('[data-cy*="game-info"], [data-cy*="time-control"], .game-controls, .game-title, header, h1, h2, h3, .layout, .board-layout, .header'));
        const texts = nodes.map(n => (n && n.isConnected) ? (n.textContent || '').trim() : '').filter(Boolean);
        texts.push((document.title || '').trim());
        const joined = texts.join(' | ').toLowerCase();
        // Match formats: "5 | 3", "5|3", "5+3"
        const m = joined.match(/\b(\d{1,2})\s*(?:\||\+)\s*(\d{1,2})\b/);
        if (m) {
            const incSec = parseInt(m[2], 10);
            if (!Number.isNaN(incSec)) return incSec * 1000;
        }
        return null;
    } catch (_) { return null; }
}

function sampleLastMoveUci(element) {
    try {
        if (element && element.board && element.board.game) {
            const g = element.board.game;
            if (typeof g.getLastMove === 'function') {
                const m = g.getLastMove();
                if (m && m.from && m.to) {
                    const promo = m.promotion ? String(m.promotion).toLowerCase().charAt(0) : '';
                    return (m.from + m.to + (promo || ''));
                }
            }
        }
    } catch (_) {}
    return null;
}

function extractFullmoveNumber(fen) {
    try {
        const parts = String(fen || '').trim().split(/\s+/);
        if (parts.length >= 6) {
            const n = parseInt(parts[5], 10);
            if (!Number.isNaN(n)) return n;
        }
    } catch (_) {}
    return null;
}

function looksLikeInitialPosition(fen) {
    try {
        // Heuristic: end with " 0 1" for standard initial position
        return /\s0\s+1$/.test(String(fen || '').trim());
    } catch (_) { return false; }
}

function announceIfFenChanged(deferMs = 0) {
    const doAnnounce = () => {
        try {
            if (!currentElement || !currentElement.board || !currentElement.board.game) return;
            const gi = getGameInfo(currentElement);
            if (gi.fen && gi.fen !== lastAnnouncedFen) {
                const prev = lastAnnouncedFen;
                const prevMove = extractFullmoveNumber(prev);
                const currMove = extractFullmoveNumber(gi.fen);
                const isNewGame = (currMove === 1 && (prevMove == null || (typeof prevMove === 'number' && prevMove > 1))) || looksLikeInitialPosition(gi.fen);
                lastAnnouncedFen = gi.fen;
                if (isNewGame) {
                    window.postMessage({ type: 'GET_INIT_GAME_INFO', gameInfo: gi }, '*');
                } else {
                    window.postMessage({ type: 'move_made', gameInfo: gi }, '*');
                }
            }
        } catch (_) {}
    };
    if (deferMs && deferMs > 0) setTimeout(doAnnounce, deferMs); else doAnnounce();
}

// Pick the most likely active move list (and implicitly its board)
function pickActiveMoveList() {
    const lists = Array.from(document.querySelectorAll('wc-simple-move-list'));
    if (!lists || lists.length === 0) return null;
    // Prefer lists with board.game present and visible board
    const withBoard = lists
        .filter(el => el && el.board && el.board.game && el.isConnected)
        .map(el => ({ el, rect: el.board && el.board.getBoundingClientRect ? el.board.getBoundingClientRect() : { width: 0, height: 0 } }))
        .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
    if (withBoard.length > 0) return withBoard[0].el;
    return lists[0];
}

function cleanupObservers() {
    try { if (gameObserver) { gameObserver.disconnect(); } } catch (_) {}
    gameObserver = null;
    try { if (boardObserver) { boardObserver.disconnect(); } } catch (_) {}
    boardObserver = null;
    try { if (docObserver) { docObserver.disconnect(); } } catch (_) {}
    docObserver = null;
    try { if (fenPollTimerId) { clearInterval(fenPollTimerId); } } catch (_) {}
    fenPollTimerId = null;
}

// Function to handle board detection and observer/polling setup
function findBoard() {
    const element = pickActiveMoveList();

    if (!element) {
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            console.warn(`[ChessBot][inject] wc-simple-move-list not found. Retry ${retryCount}/${MAX_RETRIES}...`);
            window.setTimeout(findBoard, 1000);
        } else {
            console.error(`[ChessBot][inject] Element not found after ${MAX_RETRIES} retries.`);
        }
        return;
    }

    // If unchanged, do nothing
    if (currentElement === element) {
        return;
    }

    // Switch to new element
    cleanupObservers();
    currentElement = element;

    // Send initial game info
    let gameInfo;
    try {
        gameInfo = getGameInfo(currentElement);
        lastAnnouncedFen = gameInfo.fen;
        window.postMessage({ type: 'GET_INIT_GAME_INFO', gameInfo: gameInfo }, '*');
    } catch (e) {
        console.warn('[ChessBot][inject] Failed to read initial game info:', e);
        // Try again soon
        window.setTimeout(findBoard, 1000);
        return;
    }

    // Observe changes to the board (when moves are made)
    gameObserver = new MutationObserver(() => {
        // Defer slightly to allow FEN to settle after DOM updates
        announceIfFenChanged(60);
    });
    try {
        gameObserver.observe(currentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        if (currentElement.shadowRoot) {
            gameObserver.observe(currentElement.shadowRoot, { childList: true, subtree: true, attributes: true, characterData: true });
        }
    } catch (_) {}

    // Also observe the main board element and its shadow root for changes
    try {
        const boardEl = document.querySelector('wc-chess-board');
        if (boardEl) {
            boardObserver = new MutationObserver(() => {
                announceIfFenChanged(60);
            });
            boardObserver.observe(boardEl, { childList: true, subtree: true, attributes: true, characterData: true });
            if (boardEl.shadowRoot) {
                boardObserver.observe(boardEl.shadowRoot, { childList: true, subtree: true, attributes: true, characterData: true });
            }
        }
    } catch (_) {}

    // Fallback: poll FEN periodically; re-resolve references each tick
    const pollIntervalMs = 700;
    fenPollTimerId = setInterval(() => {
        try {
            // If current element is gone, attempt to re-bind
            if (!currentElement || !currentElement.isConnected || !currentElement.board || !currentElement.board.game) {
                findBoard();
                return;
            }
            const currentFen = currentElement.board.game.getFEN();
            if (currentFen && currentFen !== lastAnnouncedFen) {
                announceIfFenChanged(0);
            }
        } catch (_) {
            // Try to recover on next tick
        }
    }, pollIntervalMs);

    // Observe document changes to catch replacement of elements in SPA
    try {
        docObserver = new MutationObserver(() => {
            if (!currentElement || !currentElement.isConnected) {
                findBoard();
            }
        });
        docObserver.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}

    // Watch URL changes in SPA navigation
    try {
        if (urlWatchTimerId) clearInterval(urlWatchTimerId);
        let lastUrl = location.href;
        urlWatchTimerId = setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                retryCount = 0;
                findBoard();
            }
        }, 1000);
    } catch (_) {}
}

// Initialize the script
(function () {
    try {
        findBoard();
    } catch (error) {
        console.error('Error initializing script:', error);
    }
})();

// --- Auto-move executor in page context ---
function mapSquareToClientXY(boardEl, playingAs, algebraic) {
    if (!boardEl || !algebraic) return null;
    const rank = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const rankBlack = ["h", "g", "f", "e", "d", "c", "b", "a"];
    const rect = boardEl.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const cellW = w / 8;
    const cellH = h / 8;
    const fileChar = algebraic[0];
    const rankNum = parseInt(algebraic[1], 10);
    if (!fileChar || !(rankNum >= 1 && rankNum <= 8)) return null;
    const files = playingAs === 1 ? rank : rankBlack;
    const fileIndex = files.indexOf(fileChar);
    if (fileIndex < 0) return null;
    // yIndex is 8 - rank for white perspective; reversed for black perspective
    const yIndex = playingAs === 1 ? (8 - rankNum) : (rankNum - 1);
    const centerX = rect.left + (fileIndex + 0.5) * cellW;
    const centerY = rect.top + (yIndex + 0.5) * cellH;
    return { x: centerX, y: centerY };
}

function dispatchPointerEvent(target, type, x, y) {
    const ev = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerType: 'mouse',
        clientX: Math.round(x),
        clientY: Math.round(y),
        buttons: type === 'pointerdown' ? 1 : 0,
    });
    target.dispatchEvent(ev);
}

function dispatchMouseEvent(target, type, x, y) {
    const ev = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: Math.round(x),
        clientY: Math.round(y),
        button: 0,
        buttons: type === 'mousedown' ? 1 : 0,
    });
    target.dispatchEvent(ev);
}

function performAutoMove(from, to, delayMs) {
    try {
        const list = document.querySelectorAll('wc-simple-move-list');
        if (!list || list.length === 0) {
            console.warn('[ChessBot][inject] wc-simple-move-list not found');
            return false;
        }
        const element = list.item(0);
        const boardEl = document.querySelector('wc-chess-board');
        if (!boardEl || !element || !element.board || !element.board.game) {
            console.warn('[ChessBot][inject] board not ready');
            return false;
        }
        const playingAs = element.board.game.getPlayingAs();
        const pFrom = mapSquareToClientXY(boardEl, playingAs, from);
        const pTo = mapSquareToClientXY(boardEl, playingAs, to);
        if (!pFrom || !pTo) {
            console.warn('[ChessBot][inject] failed to map squares', from, to);
            return false;
        }
        const fromEl = document.elementFromPoint(pFrom.x, pFrom.y) || boardEl;
        const toEl = document.elementFromPoint(pTo.x, pTo.y) || boardEl;

        const fenBefore = element.board.game.getFEN();

        // Attempt click-click sequence
    const doClickSequence = () => {
            dispatchPointerEvent(fromEl, 'pointerdown', pFrom.x, pFrom.y);
            dispatchMouseEvent(fromEl, 'mousedown', pFrom.x, pFrom.y);
            dispatchPointerEvent(fromEl, 'pointerup', pFrom.x, pFrom.y);
            dispatchMouseEvent(fromEl, 'mouseup', pFrom.x, pFrom.y);
            fromEl.click();

            dispatchPointerEvent(toEl, 'pointerdown', pTo.x, pTo.y);
            dispatchMouseEvent(toEl, 'mousedown', pTo.x, pTo.y);
            dispatchPointerEvent(toEl, 'pointerup', pTo.x, pTo.y);
            dispatchMouseEvent(toEl, 'mouseup', pTo.x, pTo.y);
            toEl.click();
        };

        const doDragSequence = () => {
            dispatchPointerEvent(fromEl, 'pointerdown', pFrom.x, pFrom.y);
            dispatchMouseEvent(fromEl, 'mousedown', pFrom.x, pFrom.y);
            // interpolate a couple of moves towards target
            const steps = 4;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const x = pFrom.x + (pTo.x - pFrom.x) * t;
                const y = pFrom.y + (pTo.y - pFrom.y) * t;
                const el = document.elementFromPoint(x, y) || boardEl;
                dispatchPointerEvent(el, 'pointermove', x, y);
                dispatchMouseEvent(el, 'mousemove', x, y);
            }
            dispatchPointerEvent(toEl, 'pointerup', pTo.x, pTo.y);
            dispatchMouseEvent(toEl, 'mouseup', pTo.x, pTo.y);
        };

        const afterClickCheck = () => {
            try {
                const fenAfter = element.board.game.getFEN();
                if (fenAfter !== fenBefore) {
                    console.log('[ChessBot][inject] click-click succeeded');
                    return;
                }
                // Try drag as fallback
                console.log('[ChessBot][inject] click-click did not change FEN; trying drag');
                doDragSequence();
                setTimeout(() => postPromotionIfNeeded(element, boardEl, playingAs, to, fenBefore), 60);
            } catch (e) {
                console.warn('[ChessBot][inject] FEN check error', e);
            }
        };

        if (delayMs && delayMs > 0) {
            setTimeout(() => {
                doClickSequence();
                setTimeout(afterClickCheck, 60);
            }, delayMs);
        } else {
            doClickSequence();
            setTimeout(() => { afterClickCheck(); postPromotionIfNeeded(element, boardEl, playingAs, to, fenBefore); }, 60);
        }
        return true;
    } catch (e) {
        console.error('[ChessBot][inject] performAutoMove error', e);
        return false;
    }
}

function postPromotionIfNeeded(element, boardEl, playingAs, to, fenBefore) {
    try {
        // If still same FEN and destination rank is promotion rank, try to select Queen
        const fenNow = element.board.game.getFEN();
        if (fenNow !== fenBefore) return;
        const rankChar = to && to[1];
        const isPromotionSquare = (playingAs === 1 && rankChar === '8') || (playingAs === 2 && rankChar === '1');
        if (!isPromotionSquare) return;
        if (tryClickPromotionQueen(boardEl, playingAs, to)) {
            setTimeout(() => {
                try {
                    const f2 = element.board.game.getFEN();
                    if (f2 === fenBefore) {
                        // Try again with alternative strategy
                        tryClickPromotionQueen(boardEl, playingAs, to, true);
                    }
                } catch (_) {}
            }, 80);
        }
    } catch (_) {}
}

function tryClickPromotionQueen(boardEl, playingAs, to, alternate) {
    try {
        // Strategy 1: Look for explicit promotion picker elements
        const sr = boardEl.shadowRoot;
        if (sr) {
            const options = sr.querySelectorAll('[data-test-promotion-piece], [data-cy*="promotion"], [class*="promotion"] button, [class*="promotion"] [role="button"], [class*="promotion-piece"]');
            for (const el of options) {
                const label = (el.getAttribute('aria-label') || el.title || el.textContent || '').toLowerCase();
                const ds = el.dataset || {};
                if (label.includes('queen') || label.includes('q') || ds.piece === 'q' || ds.piece === 'queen') {
                    el.click();
                    return true;
                }
            }
        }
        // Strategy 2: Click at likely queen slot along the file near destination square
        const rect = boardEl.getBoundingClientRect();
        const w = rect.width; const h = rect.height;
        const cellW = w / 8; const cellH = h / 8;
        const fileChar = to[0];
        const files = ['a','b','c','d','e','f','g','h'];
        const fileIndex = files.indexOf(fileChar);
        if (fileIndex < 0) return false;
        const centerX = rect.left + (fileIndex + 0.5) * cellW;
        // For white promotion, queen typically at farthest towards top; for black towards bottom.
        const slots = [0,1,2,3].map(i => i);
        const clickOrder = playingAs === 1 ? slots : slots.slice().reverse();
        for (const i of clickOrder) {
            const y = playingAs === 1 ? (rect.top + (0.5 + i) * cellH) : (rect.top + (7.5 - i) * cellH);
            const target = document.elementFromPoint(centerX, y) || boardEl;
            dispatchPointerEvent(target, 'pointerdown', centerX, y);
            dispatchMouseEvent(target, 'mousedown', centerX, y);
            dispatchPointerEvent(target, 'pointerup', centerX, y);
            dispatchMouseEvent(target, 'mouseup', centerX, y);
            target.click();
            if (!alternate) break; // if alternate mode, click all
        }
        return true;
    } catch (e) { return false; }
}

window.addEventListener('message', (event) => {
    const d = event && event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'AUTO_MOVE' && d.move && d.move.from && d.move.to) {
        const ok = performAutoMove(d.move.from, d.move.to, Number(d.delayMs) || 0, d.move.promo || 'q');
        if (!ok) {
            console.warn('[ChessBot][inject] AUTO_MOVE failed for', d.move);
        }
    }
}, false);
