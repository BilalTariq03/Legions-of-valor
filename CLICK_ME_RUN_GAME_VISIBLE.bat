@echo off
setlocal
title Legions of Valor - Local Server

REM ============================================================
REM LEGIONS OF VALOR - BEGINNER SAFE RUN FILE
REM ============================================================
REM This file starts a local web server and opens Microsoft Edge.
REM Keep this black window open while you play.
REM If you close this window, localhost will stop working.
REM ============================================================

cd /d "%~dp0"
set "PORT=5173"
set "URL=http://localhost:%PORT%/"

echo.
echo ============================================================
echo  LEGIONS OF VALOR - LOCAL BROWSER SERVER
echo ============================================================
echo.
echo Project folder:
echo %CD%
echo.
echo The game will open at:
echo %URL%
echo.
echo IMPORTANT: Keep this black window open while playing.
echo.

REM Find Python. Windows may expose it as "py" or "python".
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set "PYTHON_CMD=py -3"
  goto :found_python
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set "PYTHON_CMD=python"
  goto :found_python
)

echo ERROR: Python was not found on this computer.
echo.
echo Fix option 1:
echo   Install Python from https://www.python.org/downloads/
echo   During install, tick: Add Python to PATH
echo.
echo Fix option 2:
echo   Open this folder in VS Code and use the Live Server extension.
echo.
pause
exit /b 1

:found_python
echo Python command found: %PYTHON_CMD%
echo.
echo Opening Microsoft Edge in 2 seconds...
echo If Edge shows "can't reach this page", wait a moment and refresh.
echo.

REM Open Edge after a tiny delay, while this script continues into the server.
start "Open Legions of Valor" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 2; Start-Process msedge '%URL%'"

echo Starting server now...
echo.
echo If you see "Serving HTTP on", the server is working.
echo Press CTRL+C in this window to stop the server.
echo.
%PYTHON_CMD% -m http.server %PORT%

echo.
echo The server stopped.
echo If there was an error saying the address is already in use, close the old server window and try again.
pause
