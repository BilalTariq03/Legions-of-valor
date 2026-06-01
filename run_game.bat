@echo off
REM Legions of Valor local runner for Windows / Microsoft Edge.
REM This starts a simple local web server, then opens the game in Edge.
REM Online multiplayer still requires Firebase config in src\config\firebase-config.js.

cd /d "%~dp0"
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  start "LoV Local Server" /min py -m http.server 5173
  timeout /t 2 /nobreak >nul
  start msedge "http://localhost:5173"
) else (
  where python >nul 2>nul
  if %ERRORLEVEL% EQU 0 (
    start "LoV Local Server" /min python -m http.server 5173
    timeout /t 2 /nobreak >nul
    start msedge "http://localhost:5173"
  ) else (
    echo Python not found. Install Python or run this folder through VS Code Live Server.
    pause
  )
)
