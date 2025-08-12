/*
 WebSocket → UCI bridge for native Stockfish on Windows.

 - One Stockfish process per WebSocket client
 - Text frames in, text lines out
 - Spawns the native engine executable for max strength
*/

const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

// Configuration
const PORT = process.env.STOCKFISH_WS_PORT ? Number(process.env.STOCKFISH_WS_PORT) : 8181;
// Default location of the native binary as per user's workspace
const DEFAULT_ENGINE_PATH = process.env.STOCKFISH_BIN || path.resolve(
  'C:/Users/paulk/Desktop/stockfish/stockfish-windows-x86-64-avx2.exe'
);

function createEngineProcess(enginePath) {
  const child = spawn(enginePath, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdin.setDefaultEncoding('utf-8');
  return child;
}

const wss = new WebSocket.Server({ port: PORT });
console.log(`[bridge] Listening on ws://127.0.0.1:${PORT}`);

wss.on('connection', (ws, req) => {
  const enginePath = DEFAULT_ENGINE_PATH;
  console.log(`[bridge] Client connected from ${req.socket.remoteAddress}; spawning engine: ${enginePath}`);

  let engine;
  try {
    engine = createEngineProcess(enginePath);
  } catch (err) {
    console.error('[bridge] Failed to spawn engine:', err);
    try { ws.send(`info string ERROR spawning engine: ${String(err && err.message || err)}`); } catch (_) {}
    ws.close();
    return;
  }

  // Initialize UCI and apply server-side options (Syzygy/EvalFile) once uciok arrives
  try { engine.stdin.write('uci\n'); } catch (_) {}
  let didApplyServerOptions = false;
  let stdoutBuffer = '';
  const applyServerOptions = () => {
    if (didApplyServerOptions) return;
    didApplyServerOptions = true;
    try {
      if (process.env.SYZYGY_PATH) {
        engine.stdin.write(`setoption name SyzygyPath value ${process.env.SYZYGY_PATH}\n`);
        if (process.env.SYZYGY_PROBE_LIMIT) {
          engine.stdin.write(`setoption name SyzygyProbeLimit value ${process.env.SYZYGY_PROBE_LIMIT}\n`);
        }
        engine.stdin.write('setoption name Syzygy50MoveRule value true\n');
      }
      if (process.env.EVALFILE) {
        engine.stdin.write(`setoption name EvalFile value ${process.env.EVALFILE}\n`);
      }
    } catch (err) {
      try { ws.send(`info string server option apply failed: ${String(err && err.message || err)}`); } catch (_) {}
    }
  };

  // Forward engine stdout lines to WebSocket client
  let buffer = '';
  engine.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf-8');
    buffer += text;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) {
        if (!didApplyServerOptions && line.trim() === 'uciok') {
          applyServerOptions();
        }
        try { ws.send(line); } catch (_) {}
      }
    }
  });
  engine.stderr.on('data', (chunk) => {
    const line = chunk.toString('utf-8').trim();
    if (line) {
      try { ws.send(`info string ${line}`); } catch (_) {}
    }
  });

  engine.on('exit', (code, signal) => {
    console.log(`[bridge] Engine exited code=${code} signal=${signal}`);
    try { ws.close(); } catch (_) {}
  });

  // Forward text frames to engine stdin with newline, but sandbox 'speedtest'
  ws.on('message', (data) => {
    try {
      const text = String(data).replace(/\r?\n/g, '');
      if (text.length === 0) return;
      // No sandbox here; speedtest is allowed but runs in engine process.
      engine.stdin.write(text + '\n');
    } catch (err) {
      console.error('[bridge] write error:', err);
    }
  });

  ws.on('close', () => {
    try { engine.stdin.end(); } catch (_) {}
    try { engine.kill(); } catch (_) {}
    console.log('[bridge] Client disconnected, engine terminated');
  });
});


