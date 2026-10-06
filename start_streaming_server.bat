@echo off
setlocal
title Omniverse Kit Streaming Server

echo ===================================================
echo  Starting Omniverse Kit WebRTC Streaming Server
echo  Scene: Conveyor_Simulation.usd (720p Stable Mode)
echo ===================================================
echo.

cd /d "%~dp0kit-app-template"

if not exist "_build\windows-x86_64\release\kit\kit.exe" (
    echo [INFO] First-time build detected. Running repo.bat build...
    call .\repo.bat build
    if errorlevel 1 (
        echo [ERROR] Build failed! Check log above.
        pause
        exit /b 1
    )
)

echo [INFO] Launching Kit Streaming Service...
echo [INFO] WebRTC Signaling Port: 49221
echo [INFO] Press Ctrl+C in this window to stop the server.
echo.

".\_build\windows-x86_64\release\kit\kit.exe" ^
  ".\_build\windows-x86_64\release\apps\my_company.my_usd_viewer_streaming.kit" ^
  --no-window ^
  "--/app/auto_load_usd=%~dp0Conveyor_Simulation.usd" ^
  "--/app/renderer/resolution/width=1280" ^
  "--/app/renderer/resolution/height=720" ^
  "--/app/window/width=1280" ^
  "--/app/window/height=720" ^
  "--/exts/omni.kit.livestream.app/primaryStream/dynamicResize=false"

pause
