@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  pause
  exit /b 1
)
node setup-admin.js
pause
