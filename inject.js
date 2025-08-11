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
