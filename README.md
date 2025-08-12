# Chess FEN Extractor

This extension extracts FEN positions from Chess.com pages and overlays Stockfish analysis.

## Native Stockfish via WebSocket (recommended)

Use a local WebSocket bridge to connect the extension to the native `stockfish-windows-x86-64-avx2.exe` for maximum strength.

Steps:

1. Verify the native engine exists at `C:\\Users\\paulk\\Desktop\\stockfish\\stockfish-windows-x86-64-avx2.exe`.
   - To use a different path, set env var `STOCKFISH_BIN` before starting the bridge.
2. Start the bridge:

```
cd bridge
npm install
npm start
```

The extension connects to `ws://127.0.0.1:8181` by default. To change the URL, set `engineWsUrl` in extension storage.

### One-click start on Windows

From `C:\\Users\\paulk\\Desktop\\Chess.com-master\\bridge` you can double‑click:

- `start_stockfish_bridge.cmd` — visible console window with logs. Installs deps on first run, then launches the bridge. Edit inside to change `STOCKFISH_BIN` or set environment variables before running.
- `start_stockfish_bridge_hidden.vbs` — starts the same .cmd silently in the background.

Environment variables you can set before launching:

- `STOCKFISH_BIN` — path to `stockfish-windows-x86-64-avx2.exe`
- `STOCKFISH_WS_PORT` — port to listen on (default 8181)

## Build and package the extension

This repo is a plain MV3 extension. There is no bundler step; to produce a zip suitable for loading or publishing:

1. Ensure `lib/` libs, `manifest.json`, `content.js`, `background.js`, `inject.js`, `popup.*`, and `icons/` are present.
2. Create a zip from the project root excluding development files:

   - Windows (PowerShell):
     ```powershell
     $dest = "release/chess-com-native-stockfish.zip"
     New-Item -ItemType Directory -Force release | Out-Null
     Compress-Archive -Path @(
       'manifest.json','background.js','content.js','inject.js','popup.html','popup.js','popup.css','icons','lib'
     ) -DestinationPath $dest -Force
     ```

   - Or zip manually from Explorer selecting the files above.

3. Load the unpacked folder during development (`chrome://extensions`). For distribution, use the zip.

Notes:

- The `bridge/` folder is not part of the extension package; it runs separately on your machine.
- `.gitignore` excludes `bridge/node_modules/`, logs, and release zips.

This is a chrome extension that you can install, it will show you the best moves on chess.com. The extension popup has some options like elo level & depth.

I went to +2800 elo in bullet with this and 2400 in blitz. Somehow i didnt get banned with this for a very long time, started using this cheat in 2022, forgot about it and played some games for the lolz until i reached 2800 elo. I then got banned tho.

WHY?
Because i can... it's a fun little project if you want to try reading node values in a web app & use the internal functions of web components.

HOW? 
The extension injects a script in chess.com to set an observer on the moves list. When a move is made it reads the FEN position and sends it to the extension back where stockfish can do it's thing.
Once i get the position of the move, i draw an arrow to it using a canvas that was created as overlay on the board component.
