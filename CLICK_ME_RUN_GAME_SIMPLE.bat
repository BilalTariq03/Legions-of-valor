@echo off
setlocal
cd /d "%~dp0"
title Legions of Valor - Simple Runner

echo LEGIONS OF VALOR - SIMPLE RUNNER
echo ============================================================
echo This uses Windows PowerShell and does not require Python.
echo Keep this window open while playing.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\local-server.ps1" -Port 5173

echo.
echo Server stopped.
pause
