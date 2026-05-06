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

echo Starting Codex Remote...
echo.
node restart-codex-remote.js restart
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Codex Remote exited with code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
