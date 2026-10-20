@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 or newer, then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Installing project dependencies. No global pnpm installation is required.
  call npx.cmd --yes pnpm@11.25.0 install --frozen-lockfile
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Tooku will select an available local port and open the browser.
echo Keep this window open. Press Ctrl+C to stop Tooku.
call node scripts/dev-server.mjs --open
if errorlevel 1 pause
