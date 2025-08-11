// content.js

// Inject the script to extract the FEN from the page
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
document.head.appendChild(script);

var rank = ["a", "b", "c", "d", "e", "f", "g", "h"];
var rankBlack = ["h", "g", "f", "e", "d", "c", "b", "a"];
var point = [];

let stockfish = null;
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
    stockfish.postMessage('setoption name Skill Level value 8');

    stockfish.onmessage = function (event) {
        const moveRaw = event.data;
        if (moveRaw.indexOf('bestmove') > -1) {
            const bestmove = moveRaw.slice(9, moveRaw.indexOf('ponder') - 1);
            drawBestMove(bestmove);
            const pondermove = moveRaw.slice(moveRaw.indexOf('ponder') + 7, moveRaw.length);
            drawPonderMove(pondermove);
        }
    };

    return stockfish;
}

// Exécuter la fonction immédiatement
loadStockfish().then((stockfish) => {
    console.log("Stockfish loaded!");
});

function initializeBlack(board) {
    board.position = "relative";
    var itemWidth = board.offsetWidth / 8;
    var itemHeight = board.offsetHeight / 8;
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
    board.position = "relative";
    var itemWidth = board.offsetWidth / 8;
    var itemHeight = board.offsetHeight / 8;
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

function processFEN(fen) {
    stockfish.postMessage('position fen ' + fen);
    stockfish.postMessage('go movetime 200');
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

        reinitializeBoard(gameInfo);

        processFEN(gameInfo.fen);
    }

    if (event.data && event.data.type === 'move_made') {
        const gameInfo = {
            fen: event.data.gameInfo.fen,
            playingAs: event.data.gameInfo.playingAs,
        };

        $("#canvas").clearCanvas();

        reinitializeBoard(gameInfo);

        if (getActiveColorFromFEN(gameInfo.fen) == gameInfo.playingAs) {
            processFEN(gameInfo.fen);
        }
    }
});


// Listen to background.js
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type === 'set-level') {
        console.log("Updating Stockfish level to:", request.radioValue);
        stockfish.postMessage(`setoption name Skill Level value ${request.radioValue}`);
    }
    if (request.type === 'set-mode') {
        console.log("Updating Stockfish mode to:", request.radioValue);
        const mode = request.radioValue === "1" ? "go depth 15" : "go depth 245";
        stockfish.postMessage(mode);
    }
});
