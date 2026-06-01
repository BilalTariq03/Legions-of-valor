@echo off
setlocal
cd /d "%~dp0"
set "GAME_ROOT=%CD%"
title Legions of Valor - No Python Local Server

echo LEGIONS OF VALOR - NO PYTHON RUNNER
echo ============================================================
echo This runner uses Windows PowerShell, so you do NOT need Python.
echo Keep the PowerShell/server window open while playing.
echo.
echo Project folder: %GAME_ROOT%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%GAME_ROOT%\tools\local-server.ps1" -Root "%GAME_ROOT%" -Port 5173

echo.
echo Server stopped.
pause
