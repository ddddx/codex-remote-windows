@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

:: Try to find codex.cmd in PATH, fallback to default npm location
where codex.cmd >nul 2>nul
if errorlevel 1 (
  set "CODEX_CMD=%APPDATA%\npm\codex.cmd"
) else (
  set "CODEX_CMD=codex.cmd"
)
set "NPM_CACHE=%ROOT%.npm-cache"
set "CODEX_APP_SERVER_WS=ws://127.0.0.1:4792"
set "PORT=8787"

if not exist "%NPM_CACHE%" mkdir "%NPM_CACHE%"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found in PATH.
  pause
  exit /b 1
)

:: Kill any existing instances on our ports
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4792.*LISTENING"') do taskkill /PID %%a /F >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%.*LISTENING"') do taskkill /PID %%a /F >nul 2>nul
ping -n 2 127.0.0.1 >nul

echo Starting Codex app-server on 127.0.0.1:4792 ...
start "Codex AppServer 4792" cmd /k ""%CODEX_CMD%" app-server --listen ws://127.0.0.1:4792"

:: Wait for app-server
set "APP_READY="
for /l %%I in (1,1,20) do (
  netstat -ano | findstr /r /c:":4792 .*LISTENING" >nul 2>nul
  if not errorlevel 1 set "APP_READY=1"
  if defined APP_READY goto :app_ready
  ping -n 2 127.0.0.1 >nul
)

:app_ready
if not defined APP_READY (
  echo [ERROR] app-server failed to start on port 4792.
  pause
  exit /b 1
)
echo [OK] app-server listening on 4792.

echo Starting Web controller on 127.0.0.1:%PORT% ...
start "Codex Web 8787" cmd /k "cd /d "%ROOT%" && set "npm_config_cache=%NPM_CACHE%" && set "CODEX_APP_SERVER_WS=%CODEX_APP_SERVER_WS%" && set "PORT=%PORT%" && node src/server.js"

:: Wait for web server
set "WEB_READY="
for /l %%I in (1,1,20) do (
  netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>nul
  if not errorlevel 1 set "WEB_READY=1"
  if defined WEB_READY goto :web_ready
  ping -n 2 127.0.0.1 >nul
)

:web_ready
if not defined WEB_READY (
  echo [ERROR] web server failed to start on port %PORT%.
  pause
  exit /b 1
)

echo.
echo ========================================
echo  All services started successfully!
echo ========================================
echo  Local:   http://127.0.0.1:%PORT%
echo  LAN:     http://%%COMPUTERNAME%%:%PORT%
echo ========================================
echo.
echo Use stop-codex-remote.bat to stop.

endlocal
