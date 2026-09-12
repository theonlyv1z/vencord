@echo off
setlocal EnableDelayedExpansion
title Netherware Vencord plugins - installer

echo.
echo  ==============================================
echo   Netherware Vencord plugins - installer
echo  ==============================================
echo.

set "VENCORD_DIR=%USERPROFILE%\Vencord"
set "PLUGINS_REPO=https://github.com/theonlyv1z/vencord"

where git >nul 2>&1
if errorlevel 1 (
    echo  [1/5] Installing Git...
    winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
    set "PATH=%ProgramFiles%\Git\cmd;!PATH!"
) else (
    echo  [1/5] Git found.
)

where node >nul 2>&1
if errorlevel 1 (
    echo  [2/5] Installing Node.js LTS...
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;!PATH!"
) else (
    echo  [2/5] Node.js found.
)

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Node.js still isn't on PATH. Close this window, open a NEW command prompt and run this script again.
    pause
    exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
    echo  [3/5] Installing pnpm...
    call npm install -g pnpm
    set "PATH=%APPDATA%\npm;!PATH!"
) else (
    echo  [3/5] pnpm found.
)

if not exist "%VENCORD_DIR%\package.json" (
    echo  [4/5] Cloning Vencord into %VENCORD_DIR%...
    git clone https://github.com/Vendicated/Vencord "%VENCORD_DIR%" || goto :fail
) else (
    echo  [4/5] Vencord already at %VENCORD_DIR%, updating...
    git -C "%VENCORD_DIR%" pull --ff-only
)

if not exist "%VENCORD_DIR%\src\userplugins\.git" (
    if exist "%VENCORD_DIR%\src\userplugins" rmdir /s /q "%VENCORD_DIR%\src\userplugins"
    git clone %PLUGINS_REPO% "%VENCORD_DIR%\src\userplugins" || goto :fail
) else (
    git -C "%VENCORD_DIR%\src\userplugins" pull --ff-only
)

cd /d "%VENCORD_DIR%" || goto :fail

echo  [5/5] Building and injecting...
call pnpm install --frozen-lockfile || goto :fail
call pnpm build || goto :fail

taskkill /f /im Discord.exe >nul 2>&1
call pnpm inject --branch stable || goto :fail

echo.
echo  Starting Discord...
start "" "%LOCALAPPDATA%\Discord\Update.exe" --processStart Discord.exe

echo.
echo  Done. Open Discord Settings, then Vencord ^> Plugins and enable NetherwareClips / DownloadAssets.
echo.
pause
exit /b 0

:fail
echo.
echo  Something failed - scroll up for the error.
pause
exit /b 1
