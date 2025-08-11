// inject.js

const MAX_RETRIES = 100;
let retryCount = 0;

// Helper function to extract game info
function getGameInfo(element) {
    const fen = element.board.game.getFEN();
    const playingAs = element.board.game.getPlayingAs();
    return { fen, playingAs };
}

// Function to handle board detection and observer setup
function findBoard() {
    const elements = document.querySelectorAll("wc-simple-move-list");

    if (elements.length === 0) {
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            console.error(`Element not found. Retry attempt ${retryCount}...`);
            window.setTimeout(findBoard, 1000); // Retry with a delay
        } else {
            console.error(`Element not found after ${MAX_RETRIES} retries.`);
        }
        return;
    }

    const element = elements.item(0);
    // console.dir(element);

    // Send initial game info
    const gameInfo = getGameInfo(element);
    window.postMessage({ type: 'GET_INIT_GAME_INFO', gameInfo: gameInfo }, '*');

    // Observe changes to the board (when moves are made)
    const observer = new MutationObserver(() => {
        try {
            const gameInfo = getGameInfo(element);
            window.postMessage({ type: 'move_made', gameInfo: gameInfo }, '*');
        } catch (error) {
            console.error("Error extracting game info:", error);
        }
    });

    observer.observe(element, { childList: true, subtree: true });
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
