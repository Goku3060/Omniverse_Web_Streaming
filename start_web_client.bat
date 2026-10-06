@echo off
setlocal
title Omniverse Digital Twin Web Client

echo ===================================================
echo  Starting Omniverse Digital Twin Web Client
echo  URL: http://127.0.0.1:5173
echo ===================================================
echo.

cd /d "%~dp0Poc_test"

if not exist "node_modules" (
    echo [INFO] Installing NPM dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed!
        pause
        exit /b 1
    )
)

echo [INFO] Starting Vite Development Server...
echo [INFO] Open http://127.0.0.1:5173 in Chrome or Edge
echo.

call npm run dev -- --host 127.0.0.1

pause
