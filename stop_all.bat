@echo off
setlocal
title Stop Omniverse Streaming Processes

echo ===================================================
echo  Stopping Omniverse Kit and Web Client Processes
echo ===================================================
echo.

echo [INFO] Terminating kit.exe processes...
taskkill /F /IM kit.exe /T 2>nul
if errorlevel 1 (
    echo [INFO] No kit.exe process was running.
) else (
    echo [SUCCESS] Terminated kit.exe.
)

echo [INFO] Freeing port 5173 (Vite)...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo.
echo [DONE] All streaming and client processes stopped.
timeout /t 2 >nul
