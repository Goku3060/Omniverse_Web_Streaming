# Overview

The React streaming client sends messages such as `dropPackageRequest`,
`setConveyorSpeed`, and `resetContainerRequest` to the Kit application.
The messaging extension handles these actions on the active conveyor USD stage
and dispatches real-time physics telemetry (`dropPackageResult`, `containerCountUpdate`)
back to the client.