@echo off
setlocal
cd /d "%~dp0"
if exist "release\JScript-0.3.3-Windows\JScript.exe" (
  start "" "release\JScript-0.3.3-Windows\JScript.exe"
) else if exist "release\JScript-0.3.2-Windows\JScript.exe" (
  start "" "release\JScript-0.3.2-Windows\JScript.exe"
) else if exist "release\JScript-0.3.1-Windows\JScript.exe" (
  start "" "release\JScript-0.3.1-Windows\JScript.exe"
) else if exist "release\JScript-0.3.0-Windows\JScript.exe" (
  start "" "release\JScript-0.3.0-Windows\JScript.exe"
) else if exist "release\JScript-0.2.1-Windows\JScript.exe" (
  start "" "release\JScript-0.2.1-Windows\JScript.exe"
) else if exist "release\JScript-Windows\JScript.exe" (
  start "" "release\JScript-Windows\JScript.exe"
) else (
  echo La versione portatile non e' presente. Esegui pnpm run pack.
  pause
)
