# Overview

The React streaming client can send a `spawnCubeRequest` message to the Kit
application. The messaging extension creates a uniquely named cube in the
active stage and replies with `spawnCubeResult`, including the created prim
path or an error.