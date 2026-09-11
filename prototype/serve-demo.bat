@echo off
title MediKiosk demo - local server (keep this window open)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js was not found on this computer.
  echo  Install it from https://nodejs.org  then run this file again.
  echo.
  echo  Alternative without Node:
  echo    python -m http.server 8000
  echo    then open  http://localhost:8000/module-a-kiosk-demo.html
  echo.
  pause
  exit /b 1
)
node serve-demo.mjs
echo.
echo  Server stopped.
pause
