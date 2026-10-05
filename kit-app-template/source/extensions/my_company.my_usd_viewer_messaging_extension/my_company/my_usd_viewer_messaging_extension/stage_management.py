# SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: LicenseRef-NvidiaProprietary
#
# NVIDIA CORPORATION, its affiliates and licensors retain all intellectual
# property and proprietary rights in and to this material, related
# documentation and any modifications thereto. Any use, reproduction,
# disclosure or distribution of this material and related documentation
# without an express license agreement from NVIDIA CORPORATION or
# its affiliates is strictly prohibited.

import traceback

from pxr import UsdGeom, Usd

import time
import carb
import carb.dictionary
import carb.events
import omni.usd
import omni.kit.app
import omni.kit.livestream.messaging as messaging
from my_company.my_python_ui_extension.cube_spawner import spawn_cube
from my_company.my_python_ui_extension.conveyor_simulation import (
    drop_package,
    check_container_arrivals,
    reset_container,
    set_conveyor_speed,
    get_delivered_count,
    ensure_timeline_playing,
)

from carb.eventdispatcher import get_eventdispatcher
from omni.kit.viewport.utility import get_active_viewport_camera_string


class StageManager:
    """This class manages the stage and its related events."""
    def __init__(self):
        # Internal messaging state
        self._is_external_update: bool = False
        self._camera_attrs = {}
        self._subscriptions = []
        self._last_arrival_check: float = 0.0

        # -- register outgoing events/messages
        outgoing = [
            # notify when user selects something in the viewport.
            "stageSelectionChanged",
            # response to request for children of a prim
            "getChildrenResponse",
            # response to request for primitive being pickable.
            "makePrimsPickableResponse",
            # response to the request to reset camera attributes
            "resetStageResponse",
            # response to a cube spawn request from the React client.
            "spawnCubeResult",
            # response to dropping a package on the conveyor
            "dropPackageResult",
            # response to resetting the container
            "resetContainerResult",
            # response to updating conveyor speed
            "setConveyorSpeedResult",
            # real-time telemetry push when a box drops into the container bin
            "containerCountUpdate",
        ]

        for o in outgoing:
            messaging.register_event_type_to_send(o)
            omni.kit.app.register_event_alias(
                carb.events.type_from_string(o),
                o,
            )

        # -- register incoming events/messages
        incoming = {
            # request to get children of a prim
            'getChildrenRequest': self._on_get_children,
            # request to select a prim
            'selectPrimsRequest': self._on_select_prims,
            # request to make primitives pickable
            'makePrimsPickable': self._on_make_pickable,
            # request to reset camera
            'resetStage': self._on_reset_camera,
            # request to spawn a cube in the current USD stage (aliases to dropPackage)
            'spawnCubeRequest': self._on_drop_package,
            # industrial conveyor package drop
            'dropPackageRequest': self._on_drop_package,
            # empty collection container
            'resetContainerRequest': self._on_reset_container,
            # adjust conveyor belt speed
            'setConveyorSpeedRequest': self._on_set_conveyor_speed,
        }

        ed = get_eventdispatcher()
        for event_type, handler in incoming.items():
            omni.kit.app.register_event_alias(
                carb.events.type_from_string(event_type),
                event_type,
            )
            self._subscriptions.append(
                ed.observe_event(
                    observer_name=f"StageManager:{event_type}",
                    event_name=event_type,
                    on_event=handler,
                )
            )

        # -- subscribe to update event stream for real-time physics arrival detection
        self._update_sub = omni.kit.app.get_app().get_update_event_stream().create_subscription_to_pop(
            self._on_update, name="StageManager:ConveyorArrivalMonitor"
        )

        # -- subscribe to stage events
        usd_context = omni.usd.get_context()
        self._subscriptions.append(
            ed.observe_event(
                observer_name="StageManager:StageOpened",
                event_name=usd_context.stage_event_name(omni.usd.StageEventType.ASSETS_LOADED),
                on_event=self._on_stage_event_opened,
            )
        )
        self._subscriptions.append(
            ed.observe_event(
                observer_name="StageManager:SelectionChanged",
                event_name=usd_context.stage_event_name(omni.usd.StageEventType.SELECTION_CHANGED),
                on_event=self._on_stage_event_selection_changed,
            )
        )

    def get_children(self, prim_path, filters=None):
        """
        Collect any children of the given `prim_path`, potentially filtered by `filters`
        """
        stage = omni.usd.get_context().get_stage()
        prim = stage.GetPrimAtPath(prim_path)
        if not prim:
            return []

        filter_types = {
            "USDGeom": UsdGeom.Mesh,
            "mesh": UsdGeom.Mesh,
            "xform": UsdGeom.Xform,
            "scope": UsdGeom.Scope,
        }

        children = []
        for child in prim.GetChildren():
            # If a child doesn't pass any filter, we skip it.
            if filters is not None:
                if isinstance(filters, carb.dictionary.Item):
                    filters = filters.get_dict()
                if not any(child.IsA(filter_types[filt]) for filt in filters if filt in filter_types):
                    continue

            child_name = child.GetName()
            child_path = str(prim.GetPath())
            # Skipping over cameras
            if child_name.startswith('OmniverseKit_'):
                continue
            # Also skipping rendering primitives.
            if prim_path == '/' and child_name == 'Render':
                continue
            child_path = child_path if child_path != '/' else ''
            carb.log_info(f'child_path: {child_path}')
            info = {"name": child_name, "path": f'{child_path}/{child_name}'}

            # We return an empty list here to indicate that children are
            # available, but the current app does not support pagination,
            # so we use this to lazy load the stage tree.
            if child.GetChildren():
                info["children"] = []

            children.append(info)

        return children

    def _on_get_children(self, event: carb.events.IEvent) -> None:
        """
        Handler for the `getChildrenRequest` event
        Collects a filtered collection of a given primitives children.
        """

        carb.log_info(
            "Received message to return list of a prim\'s children"
        )
        children = self.get_children(
            prim_path=event.payload["prim_path"],
            filters=event.payload["filters"]
        )
        payload = {
            "prim_path": event.payload["prim_path"],
            "children": children
        }


        get_eventdispatcher().dispatch_event("getChildrenResponse", payload=payload)

    def _on_select_prims(self, event: carb.events.IEvent) -> None:
        """
        Handler for `selectPrimsRequest` event.

        Selects the given primitives.
        """
        new_selection = []
        if "paths" in event.payload:
            if isinstance(event.payload["paths"], carb.dictionary.Item):
                new_selection = list(event.payload["paths"].get_dict())
            else:
                new_selection = list(event.payload["paths"])
            carb.log_info(f"Received message to select '{new_selection}'")
        # Flagging this as an external event because it
        # was initiated by the client.
        self._is_external_update = True
        sel = omni.usd.get_context().get_selection()
        sel.clear_selected_prim_paths()
        sel.set_selected_prim_paths(new_selection, True)

    def _on_stage_event_opened(self, event):
        stage = omni.usd.get_context().get_stage()
        stage_url = stage.GetRootLayer().identifier if stage else ''

        if stage_url:
            # Clear before using, so that we're sure the data is only
            # from the new stage.
            self._camera_attrs.clear()
            # Capture the active camera's camera data, used to reset
            # the scene to a known good state.
            ctx = omni.usd.get_context()
            if (prim := ctx.get_stage().GetPrimAtPath(get_active_viewport_camera_string())):
                for attr in prim.GetAttributes():
                    self._camera_attrs[attr.GetName()] = attr.Get()

            # Ensure physics timeline is playing
            ensure_timeline_playing()

    def _on_stage_event_selection_changed(self, event):
        # If the selection changed came from an external event,
        # we don't need to let the streaming client know because it
        # initiated the change and is already aware.
        if self._is_external_update:
            self._is_external_update = False
        else:
            payload = {"prims": omni.usd.get_context().get_selection().
                        get_selected_prim_paths()}

            get_eventdispatcher().dispatch_event("stageSelectionChanged", payload=payload)
            carb.log_info(f"Selection changed: Path to USD prims currently selected = {omni.usd.get_context().get_selection().get_selected_prim_paths()}")

    def _on_update(self, event: carb.events.IEvent) -> None:
        """Periodic simulation tick observer: checks for package arrivals in collection bin."""
        now = time.time()
        # Evaluate at ~20 Hz to avoid overhead while maintaining instantaneous response
        if now - self._last_arrival_check < 0.05:
            return
        self._last_arrival_check = now

        stage = omni.usd.get_context().get_stage()
        if not stage:
            return

        try:
            arrivals = check_container_arrivals(stage)
            for arrival in arrivals:
                # Real-time unsolicited push event to streaming WebRTC client
                payload = {
                    "count": arrival["total_count"],
                    "total_count": arrival["total_count"],
                    "box_path": arrival["box_path"],
                    "timestamp": arrival["timestamp"],
                }
                get_eventdispatcher().dispatch_event("containerCountUpdate", payload=payload)
        except Exception:
            carb.log_warn(f"Error checking container arrivals: {traceback.format_exc()}")

    def _on_reset_camera(self, event: carb.events.IEvent):
        """
        Handler for `resetStage` event.

        Resets the camera back to values collected when the stage was opened.
        A success message is sent if all attributes are succesfully reset, and error message is set otherwise.
        """
        ctx = omni.usd.get_context()
        stage = ctx.get_stage()
        try:
            # Reset the camera.
            # The camera lives on the session layer, which has a higher
            # opinion than the root stage. So we need to explicitly target
            # the session layer when resetting the camera's attributes.
            camera_prim = ctx.get_stage().GetPrimAtPath(
                get_active_viewport_camera_string()
            )
            edit_context = Usd.EditContext(
                stage, Usd.EditTarget(stage.GetSessionLayer())
            )
            with edit_context:
                for name, value in self._camera_attrs.items():
                    attr = camera_prim.GetAttribute(name)
                    attr.Set(value)
        except Exception as e:
            payload = {"result": "error", "error": str(e)}
        else:
            payload = {"result": "success", "error": ""}

        get_eventdispatcher().dispatch_event("resetStageResponse", payload=payload)

    def _on_drop_package(self, event: carb.events.IEvent) -> None:
        """Drop an industrial package onto the conveyor belt."""
        stage = omni.usd.get_context().get_stage()
        if stage is None:
            payload = {"result": "error", "error": "No USD stage is open"}
        else:
            try:
                pkg_path = drop_package(stage)
                payload = {
                    "result": "success",
                    "path": pkg_path,
                    "total_delivered": get_delivered_count(),
                }
            except Exception:
                carb.log_error(
                    f"dropPackageRequest handler failed: {traceback.format_exc()}"
                )
                payload = {
                    "result": "error",
                    "error": "Failed to drop package on conveyor",
                }

        get_eventdispatcher().dispatch_event("dropPackageResult", payload=payload)
        # Also dispatch spawnCubeResult for backward compatibility
        get_eventdispatcher().dispatch_event("spawnCubeResult", payload=payload)

    def _on_reset_container(self, event: carb.events.IEvent) -> None:
        """Empty all packages from the container and reset count."""
        stage = omni.usd.get_context().get_stage()
        if stage is None:
            payload = {"result": "error", "error": "No USD stage is open"}
        else:
            try:
                reset_container(stage)
                payload = {"result": "success", "count": 0}
            except Exception:
                carb.log_error(
                    f"resetContainerRequest handler failed: {traceback.format_exc()}"
                )
                payload = {"result": "error", "error": "Failed to reset container"}

        get_eventdispatcher().dispatch_event("resetContainerResult", payload=payload)
        # Immediately notify client of 0 count
        get_eventdispatcher().dispatch_event("containerCountUpdate", payload={"count": 0, "total_count": 0, "reset": True})

    def _on_set_conveyor_speed(self, event: carb.events.IEvent) -> None:
        """Adjust the conveyor linear surface velocity."""
        stage = omni.usd.get_context().get_stage()
        speed = 140.0
        if "speed" in event.payload:
            try:
                speed = float(event.payload["speed"])
            except (ValueError, TypeError):
                pass

        if stage is None:
            payload = {"result": "error", "error": "No USD stage is open"}
        else:
            try:
                success = set_conveyor_speed(stage, speed)
                payload = {"result": "success" if success else "error", "speed": speed}
            except Exception:
                carb.log_error(
                    f"setConveyorSpeedRequest handler failed: {traceback.format_exc()}"
                )
                payload = {"result": "error", "error": "Failed to set conveyor speed"}

        get_eventdispatcher().dispatch_event("setConveyorSpeedResult", payload=payload)

    def _on_make_pickable(self, event: carb.events.IEvent):
        """
        Handler for `makePrimsPickable` event.

        Adds the provided primitives to the set of selectable objects in the viewport.
        Sends 'makePrimsPickableResponse' back to streamer with
        current success status.
        """
        ctx = omni.usd.get_context()
        paths = []
        try:
            if "paths" in event.payload:
                if isinstance(event.payload["paths"], carb.dictionary.Item):
                    paths = list(event.payload["paths"].get_dict())
                else:
                    paths = list(event.payload["paths"])

            for path in paths:
                ctx.set_pickable(path, True)
        except Exception:
            carb.log_error(
                f"makePrimsPickable handler failed: {traceback.format_exc()}"
            )
            payload = {"result": "error", "error": "Failed to update pickable prims"}
        else:
            payload = {"result": "success", "error": ""}

        get_eventdispatcher().dispatch_event("makePrimsPickableResponse", payload=payload)

    def on_shutdown(self):
        """This is called every time the extension is deactivated. It is used
        to clean up the extension state."""
        # Clean up update subscription
        self._update_sub = None
        # Resetting the state.
        self._subscriptions.clear()
        self._is_external_update: bool = False
        self._camera_attrs.clear()

