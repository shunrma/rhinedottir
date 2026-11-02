@echo off
rem Double-click to publish a new version of a pack.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
set /p PACK=Pack id [create-motion]: 
if "%PACK%"=="" set PACK=create-motion
set /p FROM=Instance folder [C:\Users\%USERNAME%\curseforge\minecraft\Instances\Server]: 
if "%FROM%"=="" set FROM=C:\Users\%USERNAME%\curseforge\minecraft\Instances\Server
set /p VERSION=New version (leave empty to bump automatically): 
set /p OPTS=Include your options.txt in this update? (y/N): 
set EXTRA=
if not "%VERSION%"=="" set EXTRA=--version %VERSION%
if /i "%OPTS%"=="y" set EXTRA=%EXTRA% --options
node publish.mjs --pack "%PACK%" --from "%FROM%" %EXTRA% --dry-run || (pause & exit /b 1)
echo.
set /p GO=Publish this? (y/N): 
if /i not "%GO%"=="y" exit /b 0
node publish.mjs --pack "%PACK%" --from "%FROM%" %EXTRA%
pause
