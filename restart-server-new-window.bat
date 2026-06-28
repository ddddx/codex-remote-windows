@echo off
setlocal

start "Codex Remote Server" /D "%~dp0" cmd /k "call npm restart"

endlocal
