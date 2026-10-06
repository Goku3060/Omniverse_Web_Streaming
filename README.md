# Omniverse Digital Twin Conveyor & Web Streaming

A real-time, low-latency bidirectional WebRTC streaming architecture connecting a **React Digital Twin dashboard** to an **NVIDIA Omniverse Kit PhysX Simulation**.

The browser displays the Omniverse Kit viewport as an interactive WebRTC video stream and provides logistics controls (Drop Package on Belt, Auto-Cycle, Belt Surface Velocity adjustment, Container Reset). Commands and physics telemetry travel bidirectionally across the WebRTC data channel in real time.

---

## Architecture Overview

```mermaid
flowchart LR
    User[User]
    React[React Web Client<br/>Vite + TypeScript]
    SDK[NVIDIA ov-web-rtc<br/>AppStreamer]
    Kit[Omniverse Kit Streaming App<br/>omni.kit.livestream.app]
    Bridge[USD Messaging Extension<br/>EventDispatcher]
    Conveyor[Conveyor & Physics Engine<br/>PhysX Surface Velocity API]
    Stage[Active USD Stage<br/>Conveyor_Simulation.usd]

    User -->|Drop Package / Change Speed| React
    React -->|dropPackageRequest / setSpeed| SDK
    SDK <-->|WebRTC Video + Data Channel| Kit
    Kit --> Bridge
    Bridge -->|dispatch actions| Conveyor
    Conveyor -->|Author RigidBody Boxes + Set Velocity| Stage
    Stage -->|PhysX Simulation Updates| Conveyor
    Conveyor -->|containerCountUpdate / arrivals| Bridge
    Bridge -->|telemetry events| SDK
    SDK -->|onCustomEvent| React
    Kit -->|NVENC H.264 Stream (720p)| SDK
    SDK -->|HTML5 Video Element| React
```

### Components

| Component | Path | Description |
| :--- | :--- | :--- |
| **React Digital Twin Client** | `Poc_test/` | Modern React UI powered by Vite, TypeScript, and `@nvidia/ov-web-rtc`. |
| **Streaming App** | `kit-app-template/source/apps/my_company.my_usd_viewer_streaming.kit` | Kit application configured with WebRTC livestreaming, NVENC H.264 encoding, and run-loop rate-limiting. |
| **Messaging Extension** | `kit-app-template/source/extensions/my_company.my_usd_viewer_messaging_extension` | Bridges WebRTC custom messages to Kit's event dispatcher. |
| **Conveyor Simulation Extension** | `kit-app-template/source/extensions/my_company.my_python_ui_extension` | Manages PhysX surface velocity, package spawning, and collection bin arrivals. |
| **Viewer Setup Extension** | `kit-app-template/source/extensions/my_company.my_usd_viewer_setup_extension` | Loads USD stages and sets up default lighting and layout. |
| **USD Digital Twin Stage** | `Conveyor_Simulation.usd` | Modular industrial conveyor belt and collection bin stage. |

---

## Anti-Freeze & Performance Optimizations

This project incorporates production-grade performance tuning based on official NVIDIA Omniverse development guidelines:

1. **Hardware H.264 Codec Pinning**: Client enforces explicit `VideoCodec.H264` and `codecList: ['H264']` to prevent browser fallback to software decoders (VP8/VP9) and keyframe stalls.
2. **Kit Run-Loop Rate Limiting**: Server run-loop is rate-limited (`rateLimitEnabled = true`, `rateLimitFrequency = 60`) to eliminate frame-pacing jitter and NVENC encoder starvation.
3. **Livestream Core Tuning**: Bitrate capped at 10 Mbps (`videoBitrate = 10000000`, `videoFps = 60`) to prevent UDP packet drop bursts on port `48021`.
4. **Dynamic Side-by-Side Placement & Camera Framing**: Cubes are spaced 130 units apart along the horizontal axis with alternating vibrant colors; camera centers on the row's midpoint and pulls back smoothly so all cubes remain framed side by side.
5. **Decoded Frame Watchdog**: WebRTC client continuously verifies `getVideoPlaybackQuality().totalVideoFrames` to detect and surface decode freezes.
6. **Pinned Video Layout**: Viewport CSS uses `position: absolute; inset: 0; object-fit: contain;` to avoid layout reflow thrashing during 60 FPS hardware video decoding.

---

## Prerequisites

- **OS**: Windows 10 / 11 (64-bit)
- **GPU**: NVIDIA RTX GPU with up-to-date Game Ready or Studio Drivers
- **Node.js**: v18.0 or newer
- **Omniverse Kit SDK**: 110.3+ (installed automatically via `kit-app-template`)

---

## Getting Started

> [!TIP]
> For detailed troubleshooting and GPU memory notes, see the full **[RUN_GUIDE.md](RUN_GUIDE.md)**.

### Quick Start (One-Click)

1. **Start Streaming Server**: Double-click `start_streaming_server.bat` in the root folder.
2. **Start Web Client**: Double-click `start_web_client.bat` in the root folder.
3. Open **[http://127.0.0.1:5173/](http://127.0.0.1:5173/)** in Google Chrome or Microsoft Edge.
4. **Stop All**: Double-click `stop_all.bat` to cleanly terminate all processes when done.

### Manual Terminal Commands

#### 1. Build and Launch the Streaming Server
```powershell
cd kit-app-template
.\repo.bat build

& ".\_build\windows-x86_64\release\kit\kit.exe" `
  ".\_build\windows-x86_64\release\apps\my_company.my_usd_viewer_streaming.kit" `
  --no-window `
  "--/app/auto_load_usd=..\Conveyor_Simulation.usd" `
  "--/app/renderer/resolution/width=1280" `
  "--/app/renderer/resolution/height=720" `
  "--/app/window/width=1280" `
  "--/app/window/height=720" `
  "--/exts/omni.kit.livestream.app/primaryStream/dynamicResize=false"
```

#### 2. Start the React Web Client
In a separate terminal:
```powershell
cd Poc_test
npm install
npm run dev -- --host 127.0.0.1
```
Open **[http://127.0.0.1:5173/](http://127.0.0.1:5173/)** in your browser.

---

## Usage

1. Wait for the status indicator in the web app to show **`Connected to Kit (Streaming active)`**.
2. Click **`Spawn Cube`**.
3. A uniquely colored cube will appear on the stage resting on the ground plane.
4. Click **`Spawn Cube`** repeatedly to spawn multiple cubes placed neatly **side by side**, with the camera smoothly expanding its field of view to keep all cubes in frame.

---

## License

This repository uses components from the NVIDIA Omniverse Kit App Template and NVIDIA Omniverse WebRTC SDK. Refer to individual subdirectories for respective licenses.
