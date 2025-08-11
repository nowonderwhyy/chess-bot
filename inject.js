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
    return { fen, playingAs };
}

function announceIfFenChanged(deferMs = 0) {
    const doAnnounce = () => {
        try {
            if (!currentElement || !currentElement.board || !currentElement.board.game) return;
            const gi = getGameInfo(currentElement);
            if (gi.fen && gi.fen !== lastAnnouncedFen) {
                lastAnnouncedFen = gi.fen;
                window.postMessage({ type: 'move_made', gameInfo: gi }, '*');
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
            setTimeout(afterClickCheck, 60);
        }
        return true;
    } catch (e) {
        console.error('[ChessBot][inject] performAutoMove error', e);
        return false;
    }
}

window.addEventListener('message', (event) => {
    const d = event && event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'AUTO_MOVE' && d.move && d.move.from && d.move.to) {
        const ok = performAutoMove(d.move.from, d.move.to, Number(d.delayMs) || 0);
        if (!ok) {
            console.warn('[ChessBot][inject] AUTO_MOVE failed for', d.move);
        }
    }
}, false);
