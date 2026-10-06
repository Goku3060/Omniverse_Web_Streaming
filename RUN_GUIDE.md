# Omniverse Digital Twin Conveyor - Quick Run & Operations Guide

This guide describes how to run and manage the **Omniverse Web Streaming Digital Twin** with your custom conveyor USD scene (`Conveyor_Simulation.usd`) without running into memory, console, or port issues.

---

## Architecture at a Glance

The application consists of two communicating services:

```text
[ Browser / React Web UI ]  <--- WebRTC (Port 49221 / 48021) --->  [ Omniverse Kit Streaming ]
   URL: http://127.0.0.1:5173                                          USD: Conveyor_Simulation.usd
   Controls: Drop Package, Velocity, Empty Bin                         Physics: PhysX Surface Velocity
```

1. **Backend**: Headless Omniverse Kit running `my_company.my_usd_viewer_streaming.kit`.
   - Loads `Conveyor_Simulation.usd`.
   - Runs the PhysX simulation (conveyor surface velocity, package rigid bodies).
   - Serves an interactive H.264 WebRTC video and data channel on **port `49221`**.
2. **Frontend**: Vite + React Web Application in `Poc_test`.
   - Connects to Kit via `@nvidia/ov-web-rtc`.
   - Displays real-time video stream and live digital twin metrics (container count, speeds, events).
   - Serves on **port `5173`** (`http://127.0.0.1:5173`).

---

## Option 1: One-Click Quick Launch (Recommended)

In the root folder (`D:\Omniverse_learning\`), three batch scripts are provided:

### 1. Start the Kit Streaming Server
Double-click:
```text
start_streaming_server.bat
```
- Automatically builds any modified extensions.
- Launches Kit in stable 720p mode with `Conveyor_Simulation.usd`.
- Wait ~15 seconds until you see `[Info] RTX ready` or `app ready`.

### 2. Start the Web Client
Double-click:
```text
start_web_client.bat
```
- Installs npm packages if needed and starts the Vite dev server.
- Open **[http://127.0.0.1:5173](http://127.0.0.1:5173)** in Google Chrome or Microsoft Edge.
- The stream will connect automatically.

### 3. Stop Everything Cleanly
Double-click:
```text
stop_all.bat
```
- Instantly terminates any running `kit.exe` and frees port `5173` so no zombie processes hold your GPU VRAM.

---

## Option 2: Manual Terminal Commands (PowerShell)

If you prefer to run commands manually in your terminal:

### Terminal 1: Kit Streaming Server
```powershell
cd D:\Omniverse_learning\kit-app-template

# 1. Build extensions (run whenever you edit python or kit files)
.\repo.bat build

# 2. Launch the streaming layer with Conveyor_Simulation.usd
& ".\_build\windows-x86_64\release\kit\kit.exe" `
  ".\_build\windows-x86_64\release\apps\my_company.my_usd_viewer_streaming.kit" `
  --no-window `
  "--/app/auto_load_usd=D:\Omniverse_learning\Conveyor_Simulation.usd" `
  "--/app/renderer/resolution/width=1280" `
  "--/app/renderer/resolution/height=720" `
  "--/app/window/width=1280" `
  "--/app/window/height=720" `
  "--/exts/omni.kit.livestream.app/primaryStream/dynamicResize=false"
```

### Terminal 2: React Web Client
```powershell
cd D:\Omniverse_learning\Poc_test

# Install dependencies if running for the first time
npm install

# Start Vite server
npm run dev -- --host 127.0.0.1
```
Open **[http://127.0.0.1:5173](http://127.0.0.1:5173)** in your browser.

---

## Key Hardware & Stability Notes

### 1. 4 GB Laptop GPU (RTX 3050 Ti) Memory Sizing
- Full 1080p RTX real-time rendering + ray-tracing BVH + WebRTC NVENC encoder can exceed 3.5 GB of VRAM.
- To prevent `CUDA error 700: cudaErrorIllegalAddress` / Out-of-Memory crashes, the streaming app is locked to **1280×720 (720p)** with `dynamicResize = false`.
- **Important**: Do not run the standalone **USD Composer** desktop app and the **Streaming Server** at the same time on a 4 GB laptop GPU, as both compete for the same VRAM.

### 2. Why `.\repo.bat launch` should not be run without an argument in scripts
- Running `.\repo.bat launch` with no arguments triggers an interactive terminal menu asking which app to launch (`InquirerPy`).
- In automated scripts or headless environments, this causes `NoConsoleScreenBufferError`.
- Directly execute `kit.exe` with the target `.kit` file as shown above instead.

### 3. Custom Assets Integration
The Python simulation logic in `kit-app-template\source\extensions\my_company.my_python_ui_extension\my_company\my_python_ui_extension\conveyor_simulation.py` dynamically recognizes your USD assets:
- **Belt Mesh**: `/World/ConveyorBelt_A06_PR_NVD_01/Geometry/SM_ConveyorBelt_A06_Belt_01` (receives collision & `PhysxSurfaceVelocityAPI`).
- **Conveyor Structure**: `/World/ConveyorBelt_A06_PR_NVD_01/Geometry` (receives collision).
- **Bin**: `/World/Bin_A06_30x51x19cm_PR_V_NVD_01` (receives collision).
- **Spawn & Arrival Calculation**: Bounding box coordinates are calculated at runtime, so packages drop accurately on the belt intake and count into the bin correctly.
