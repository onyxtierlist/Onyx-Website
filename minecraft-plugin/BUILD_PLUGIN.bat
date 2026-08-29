@echo off
setlocal
cd /d "%~dp0"
where mvn >nul 2>&1
if errorlevel 1 (
  echo Maven is not installed.
  echo Install Maven, then run this file again.
  pause
  exit /b 1
)
mvn clean package
if errorlevel 1 (
  echo Build failed. Make sure the Paper API version in pom.xml matches your server.
  pause
  exit /b 1
)
echo.
echo Built target\OnyxPlayedSync.jar
pause
