@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found in PATH.
  pause
  exit /b 1
)

echo Stopping Codex Remote...
echo.
node restart-codex-remote.js stop
endlocal
