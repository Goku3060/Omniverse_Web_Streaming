# Omniverse Digital Twin Conveyor & Scene Control Architecture

## Purpose

This project connects a React web client to a running NVIDIA Omniverse Kit USD
PhysX simulation. The browser displays the Kit viewport as an interactive WebRTC video
stream and offers logistics controls (**Drop Package**, **Conveyor Speed**, **Empty Bin**).
Pressing a control sends a command through the stream's bidirectional data channel; Kit
authors rigid body packages or modifies PhysX surface velocity on the open USD stage
and streams live physics telemetry and package arrival counts back to the browser.

The React application is a control and telemetry surface for Kit, not a second scene
renderer. USD and PhysX remain authoritative on the Kit side.

## System context

```mermaid
flowchart LR
    User[User]
    React[React client<br/>Vite + TypeScript]
    SDK[NVIDIA ov-web-rtc<br/>AppStreamer]
    Kit[Kit USD Viewer Streaming<br/>omni.kit.livestream.app]
    Messaging[USD Viewer Messaging Extension]
    Conveyor[Conveyor & Physics Engine<br/>PhysX Surface Velocity API]
    Stage[Active USD stage<br/>Conveyor_Simulation.usd / .usda]
    ViewerSetup[USD Viewer Setup Extension]

    User -->|Drop Package / Change Speed| React
    React -->|dropPackageRequest / setSpeed| SDK
    SDK <-->|WebRTC video + data messages| Kit
    Kit --> Messaging
    Messaging -->|dispatch actions| Conveyor
    Conveyor -->|Author RigidBody Packages + Surface Velocity| Stage
    Stage -->|PhysX simulation updates| Conveyor
    Conveyor -->|containerCountUpdate / arrivals| Messaging
    Messaging -->|telemetry events| SDK
    SDK -->|onCustomEvent| React
    Kit -->|NVENC H.264 stream (720p)| SDK
    SDK -->|HTML5 video element| React
    ViewerSetup -->|loads stage and viewport layout| Kit
```

### Runtime components

| Component | Location | Responsibility |
|---|---|---|
| React entry point | `src/main.tsx` | Finds the page root and mounts the React application. |
| React application | `src/App.tsx` | Builds the control panel, connects the WebRTC client, renders stream/status state, sends logistics commands, and processes Kit telemetry. |
| Page shell | `index.html` | Supplies the root element, metadata, and application entry module. |
| Client styling | `src/index.css` | Styles the React control surface, status feedback, and video frame. |
| WebRTC SDK | `@nvidia/ov-web-rtc` | Negotiates a direct Kit stream, attaches media to the video/audio elements, and transports application messages. |
| Streaming application layer | `source/apps/my_company.my_usd_viewer_streaming.kit` | Extends the base Viewer application with Kit app streaming dependencies and settings (720p stable). |
| Base Viewer application | `source/apps/my_company.my_usd_viewer.kit` | Defines the Viewer application and includes the local extension dependencies. |
| Viewer setup extension | `my_company.my_usd_viewer_setup_extension` | Loads the configured USD stage (`Conveyor_Simulation.usd`), sets default stage lighting, and loads the layout. |
| Messaging extension | `my_company.my_usd_viewer_messaging_extension` | Bridges WebRTC custom messages to Kit event-dispatcher handlers and registers response events. |
| Conveyor Simulation extension | `my_company.my_python_ui_extension` | Manages PhysX surface velocity, package dynamic rigid bodies, and collection bin arrivals. |

### Dependency direction

The intended dependency chain is:

```text
my_company.my_usd_viewer_streaming.kit
└── my_company.my_usd_viewer.kit
    ├── my_company.my_python_ui_extension
    └── my_company.my_usd_viewer_setup_extension
        └── my_company.my_usd_viewer_messaging_extension
            └── my_company.my_python_ui_extension
```

The streaming layer inherits the base Viewer dependencies and adds
`omni.kit.livestream.app`. The messaging extension coordinates directly with
the conveyor simulation extension to handle commands and stream telemetry. Kit discovers these
local packages through the app's configured extension folders; `repo.bat
build` stages them under `_build/windows-x86_64/release/`.

## Conveyor Simulation message contract

The protocol uses named custom application messages over the WebRTC data channel.
The browser and Kit use matching event types and payload shapes.

### 1. Drop Package Request (`dropPackageRequest`)
- **Direction**: Browser $\to$ Kit
- **Payload**: `{}`
- **Action**: Kit defines a rigid body package box at the conveyor intake $(X = -310, Y = 155, Z = 1.4)$ with `PhysicsRigidBodyAPI`, `PhysicsCollisionAPI`, and `MassAPI`.
- **Response**: `dropPackageResult` with `{ "result": "success", "path": "/World/Packages/Package_1" }`.

### 2. Set Conveyor Speed (`setConveyorSpeed`)
- **Direction**: Browser $\to$ Kit
- **Payload**: `{ "speed": 120.0 }`
- **Action**: Dynamically updates `PhysxSurfaceVelocityAPI` on `SM_ConveyorBelt_A06_Belt_01` to `(0.0, -speed, 0.0)`.

### 3. Reset Container / Clear Bin (`resetContainerRequest`)
- **Direction**: Browser $\to$ Kit
- **Payload**: `{}`
- **Action**: Removes delivered package prims from `/World/Packages` and resets internal counter to 0.

### 4. Telemetry Broadcast (`containerCountUpdate`)
- **Direction**: Kit $\to$ Browser
- **Payload**: `{ "count": 5, "last_package": "/World/Packages/Package_5" }`
- **Action**: Dispatched automatically every time a package arrives at the collection bin $(X \ge 340, Y \le 105)$.

## Request and response sequence

```mermaid
sequenceDiagram
    actor User
    participant UI as React App
    participant SDK as AppStreamer
    participant Stream as Kit WebRTC stream
    participant Bridge as Messaging extension
    participant Conveyor as Conveyor Simulation
    participant USD as Active USD stage

    User->>UI: Click Drop Package
    UI->>UI: Update status; dispatch request
    UI->>SDK: sendMessage({event_type: "dropPackageRequest", payload: {}})
    SDK->>Stream: Send custom application message
    Stream->>Bridge: Dispatch dropPackageRequest event
    Bridge->>Conveyor: drop_package(stage)
    Conveyor->>USD: Author RigidBody Package at intake
    USD-->>Conveyor: Created prim path
    Conveyor-->>Bridge: Package path
    Bridge->>Stream: Dispatch dropPackageResult event
    Stream-->>SDK: Deliver custom response
    SDK-->>UI: onCustomEvent(dropPackageResult)
    loop PhysX Simulation
        USD->>Conveyor: Package travels along belt to bin
        Conveyor->>Bridge: containerCountUpdate (count: N)
        Bridge->>Stream: Deliver containerCountUpdate
        Stream-->>UI: Update live package counter
    end
    USD-->>Stream: Rendered viewport frames (720p)
    Stream-->>UI: WebRTC video
```

## Conveyor physics & package authoring behavior

`conveyor_simulation.py` handles scene setup and runtime physics:

1. **Custom SimReady Belt Configuration**: Locates `/World/ConveyorBelt_A06_PR_NVD_01/Geometry/SM_ConveyorBelt_A06_Belt_01` and applies `PhysxSurfaceVelocityAPI`.
2. **Velocity Vector Alignment**: Because the belt mesh local Y-axis aligns with World $-X$ with a scale factor of 3.58, setting local velocity to `(0.0, -speed, 0.0)` drives packages forward in World $+X$ towards the bin.
3. **Collision Surfaces**: Guide rails, structural frame, and collection bin receive `CollisionAPI` directly so packages stay on the belt and remain inside the bin.
4. **Intake Package Drop**: Packages are spawned at the intake with realistic dimensions, mass (2.5 kg), and random safety colors (Amazon yellow, cardboard brown, priority blue, etc.).
5. **Collection Arrival Detection**: An update subscription monitors package positions each simulation step. When a package enters the bin discharge zone ($X \ge 340, Y \le 105$), it is marked as delivered and emits `containerCountUpdate`.
6. **Camera Viewport Framing**: An automated camera framing routine (`frame_conveyor_camera`) centers the camera at $(20, 260, 480)$ with a $-25^\circ$ pitch to frame the entire conveyor pipeline.

## Connection and UI state

The React application maintains:

- `connection`: `connecting`, `connected`, or `error`.
- `connectionMessage`: human-readable transport status.
- `isSpawning`: prevents duplicate clicks while a request is pending.
- `commandMessage`: send, result, or timeout feedback.
- `isStreamStalled`: WebRTC frame watchdog status detecting frozen decoded frames.

On mount, `App.tsx` creates an `AppStreamer` instance (cached via `useMemo` to prevent redundant network reconnections on render) and calls `connect` with a direct
stream configuration. The video and audio element IDs connect the SDK to
`index.html`. Resolution and frame-rate requests are set to 1920×1080 and 60
FPS with explicit `VideoCodec.H264` pinning and run-loop rate-limiting on the Kit server to eliminate frame pacing jitter and encoder freezes. The signaling host defaults to the browser page's hostname. A different
Kit host can be provided with a URL such as
`http://localhost:5173/?server=192.168.1.20`.

On unmount, the React effect clears a pending result timer and terminates the
streamer instance. A `--no-window` Kit launch hides Kit's local desktop
window; it does not hide the stream from this React page.

## Startup and local development

Run the Kit streaming application and Vite development server as separate
processes. From `D:\Omniverse_learning\kit-app-template`, build after changing
Kit files, then launch the built streaming layer with the target stage:

```powershell
.\repo.bat build
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

In another PowerShell window:

```powershell
cd D:\Omniverse_learning\Poc_test
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173` in Chromium. Wait for **Connected to Kit**, click
**Drop Package**, and watch the rigid body box travel into the collection bin.
Keep both the Kit process and the React development server running for the
duration of the test.

The streaming host and browser must be able to reach the Kit signaling service
and establish the WebRTC media/data connection. Setting `?server=` only
chooses the signaling hostname; it does not configure firewalls, advertise
public addresses, or provide TURN relays.

## Failure handling and diagnostics

| Symptom | Likely layer | First checks |
|---|---|---|
| Browser remains “Connecting to Kit” | Signaling/network | Confirm Kit is running the built `my_company.my_usd_viewer_streaming.kit`; use the reachable Kit host in `?server=`; check firewall and signaling errors in Kit and browser consoles. |
| Stream connects but request times out | Data messaging | Check the Kit log for messaging-extension startup and `dropPackageRequest` errors; verify both processes were rebuilt/restarted after Kit source changes. |
| Browser shows a Kit error result | USD operation | Confirm `Conveyor_Simulation.usd` is loaded; inspect Kit logs for server-side traceback. |
| Packages slide sideways or stall | PhysX simulation | Verify belt mesh surface velocity vector matches local coordinates `(0.0, -speed, 0.0)`. |
| “Connected to Kit” but black viewport | Rendering/media | Check Kit viewport, renderer/GPU startup, browser WebRTC media status, and console output independently of the data-channel command. |

Avoid adding a second message bridge or HTTP API for this operation. Use the
existing stream messaging extension for Kit commands and keep message payloads
minimal and explicitly validated server-side.

## Verification

The implementation has been validated with:

- React TypeScript typecheck, production build, formatting check, and smoke
  test.
- Kit release build.
- Python UI extension simulation for conveyor surface velocity and package physics.
- Messaging extension test for the `dropPackageRequest` handler, returned paths,
  and container count updates.
- Live local browser-to-Kit WebRTC test streaming interactive PhysX simulation at 720p 60 FPS.
