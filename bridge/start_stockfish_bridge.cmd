@echo off
setlocal ENABLEEXTENSIONS

REM Change to this script's directory
cd /d "%~dp0"

REM Default configuration (can be overridden by environment variables)
if "%STOCKFISH_WS_PORT%"=="" set "STOCKFISH_WS_PORT=8181"
if "%STOCKFISH_BIN%"=="" set "STOCKFISH_BIN=C:\Users\paulk\Desktop\stockfish\stockfish-windows-x86-64-avx2.exe"

echo.
echo [bridge] Starting Stockfish WebSocket bridge on ws://127.0.0.1:%STOCKFISH_WS_PORT%
echo [bridge] Engine: %STOCKFISH_BIN%
echo.

REM Validate Node.js availability
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js not found in PATH. Please install from https://nodejs.org/ and try again.
  echo You can also run from an elevated PowerShell: npm install; npm start
  pause
  exit /b 1
)

REM Validate engine binary path exists
if not exist "%STOCKFISH_BIN%" (
  echo ERROR: Stockfish binary not found at:
  echo   %STOCKFISH_BIN%
  echo Set STOCKFISH_BIN before running, or edit this .cmd file to point to your binary.
  pause
  exit /b 1
)

REM Install deps on first run
if not exist "node_modules" (
  echo Installing dependencies...
  npm install || (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

REM Launch the server (foreground). Close this window to stop the bridge.
set "PORT=%STOCKFISH_WS_PORT%"
set "BIN=%STOCKFISH_BIN%"
set "STOCKFISH_WS_PORT=%PORT%"
set "STOCKFISH_BIN=%BIN%"
node server.js

echo.
echo [bridge] Stopped.
pause


