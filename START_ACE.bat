@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)
if not exist ".env" (
  echo No .env found. Run SETUP_ADMIN.bat once to create your private admin credentials.
  pause
  exit /b 1
)
echo Starting ONYX...
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
node server.js
pause
