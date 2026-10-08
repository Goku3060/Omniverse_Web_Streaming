# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import time
import carb
from pxr import Gf, Usd, UsdGeom

try:
    from pxr import UsdPhysics
except ImportError:
    UsdPhysics = None

try:
    from pxr import PhysxSchema
except ImportError:
    PhysxSchema = None

try:
    import omni.timeline
except ImportError:
    omni.timeline = None

# Curated palette for vibrant packages
PACKAGE_COLORS = [
    Gf.Vec3f(0.85, 0.55, 0.15),  # Cardboard Amber / Gold
    Gf.Vec3f(0.18, 0.62, 0.92),  # Industrial Electric Blue
    Gf.Vec3f(0.46, 0.73, 0.12),  # NVIDIA Neon Green
    Gf.Vec3f(0.92, 0.32, 0.20),  # Safety Coral Orange
    Gf.Vec3f(0.70, 0.35, 0.85),  # Deep Purple
    Gf.Vec3f(0.10, 0.78, 0.72),  # Cyan Teal
]

# Tracked active simulation state
_tracked_packages: dict[str, dict] = {}
_delivered_count: int = 0
_conveyor_speed: float = 140.0


def ensure_timeline_playing():
    """Ensure the Omniverse physics simulation clock is actively running."""
    if omni.timeline:
        try:
            timeline = omni.timeline.get_timeline_interface()
            if not timeline.is_playing():
                timeline.play()
        except Exception as e:
            carb.log_warn(f"Could not start timeline for physics: {e}")


def get_delivered_count() -> int:
    return _delivered_count


def set_conveyor_speed(stage: Usd.Stage, speed: float) -> bool:
    """Dynamically update conveyor surface velocity."""
    global _conveyor_speed
    _conveyor_speed = float(speed)
    belt_prim = stage.GetPrimAtPath("/World/ConveyorBelt_A06_PR_NVD_01/Geometry/SM_ConveyorBelt_A06_Belt_01")
    if belt_prim.IsValid() and PhysxSchema:
        try:
            surface_vel = PhysxSchema.PhysxSurfaceVelocityAPI(belt_prim)
            if not surface_vel:
                surface_vel = PhysxSchema.PhysxSurfaceVelocityAPI.Apply(belt_prim)
            if surface_vel:
                # Custom belt mesh local Y points in world -X; (0, -speed, 0) drives forward in world +X towards the bin
                surface_vel.GetSurfaceVelocityAttr().Set(Gf.Vec3f(0.0, -_conveyor_speed, 0.0))
                return True
        except Exception as e:
            carb.log_error(f"Failed to update conveyor speed: {e}")
    return False


def setup_conveyor_scene(stage: Usd.Stage):
    """Procedurally assemble the conveyor, guide rails, container bin, and physics scene."""
    if not stage.GetPrimAtPath("/World").IsValid():
        stage.DefinePrim("/World", "Xform")

    up_axis = UsdGeom.GetStageUpAxis(stage)
    is_y_up = (up_axis == UsdGeom.Tokens.y)

    # 1. Physics Scene setup with gravity
    if UsdPhysics:
        scene_path = "/World/PhysicsScene"
        if not stage.GetPrimAtPath(scene_path).IsValid():
            scene = UsdPhysics.Scene.Define(stage, scene_path)
            if is_y_up:
                scene.CreateGravityDirectionAttr().Set(Gf.Vec3f(0.0, -1.0, 0.0))
            else:
                scene.CreateGravityDirectionAttr().Set(Gf.Vec3f(0.0, 0.0, -1.0))
            scene.CreateGravityMagnitudeAttr().Set(980.0)

    # 2. Ground Plane Collider
    ground_path = "/World/GroundPlane"
    if not stage.GetPrimAtPath(ground_path).IsValid():
        ground = UsdGeom.Cube.Define(stage, ground_path)
        ground.GetSizeAttr().Set(1.0)
        # 1600x1600 ground tile
        if is_y_up:
            UsdGeom.XformCommonAPI(ground.GetPrim()).SetScale(Gf.Vec3f(1600.0, 2.0, 1600.0))
            UsdGeom.XformCommonAPI(ground.GetPrim()).SetTranslate(Gf.Vec3d(0.0, -1.0, 0.0))
        else:
            UsdGeom.XformCommonAPI(ground.GetPrim()).SetScale(Gf.Vec3f(1600.0, 1600.0, 2.0))
            UsdGeom.XformCommonAPI(ground.GetPrim()).SetTranslate(Gf.Vec3d(0.0, 0.0, -1.0))

        try:
            ground.CreateDisplayColorAttr().Set([Gf.Vec3f(0.12, 0.14, 0.16)])
        except Exception:
            pass

        if UsdPhysics:
            UsdPhysics.CollisionAPI.Apply(ground.GetPrim())

    # 3. Clean up any previous procedural container or conveyor if present
    for old_path in ("/World/Container", "/World/Conveyor"):
        old_prim = stage.GetPrimAtPath(old_path)
        if old_prim.IsValid():
            try:
                stage.RemovePrim(old_path)
                carb.log_info(f"Removed procedural {old_path} in favor of custom assets.")
            except Exception as e:
                carb.log_warn(f"Could not remove {old_path}: {e}")

    # 4. Configure Custom Conveyor Asset (apply collision and surface velocity)
    custom_belt = stage.GetPrimAtPath("/World/ConveyorBelt_A06_PR_NVD_01/Geometry/SM_ConveyorBelt_A06_Belt_01")
    if custom_belt.IsValid():
        if UsdPhysics:
            UsdPhysics.CollisionAPI.Apply(custom_belt)
        if PhysxSchema:
            surface_vel = PhysxSchema.PhysxSurfaceVelocityAPI.Apply(custom_belt)
            # Custom belt mesh local Y points in world -X; (0, -speed, 0) drives forward in world +X towards the bin
            surface_vel.CreateSurfaceVelocityAttr().Set(Gf.Vec3f(0.0, -_conveyor_speed, 0.0))

    # Apply collisions to the conveyor frame and guide rails
    custom_geom = stage.GetPrimAtPath("/World/ConveyorBelt_A06_PR_NVD_01/Geometry")
    if custom_geom.IsValid() and UsdPhysics:
        for child in custom_geom.GetChildren():
            if child.GetName() != "SM_ConveyorBelt_A06_Belt_01":
                UsdPhysics.CollisionAPI.Apply(child)

    # 5. Configure Custom Bin Asset (apply collision so delivered packages stay inside)
    custom_bin = stage.GetPrimAtPath("/World/Bin_A06_30x51x19cm_PR_V_NVD_01")
    if custom_bin.IsValid() and UsdPhysics:
        for child in custom_bin.GetChildren():
            UsdPhysics.CollisionAPI.Apply(child)


    # 5. Position Camera to view the entire conveyor pipeline
    frame_conveyor_camera(stage)

    # 6. Ensure physics timeline is rolling
    ensure_timeline_playing()


def frame_conveyor_camera(stage: Usd.Stage):
    """Position viewport camera to capture intake, moving belt, and collection container."""
    up_axis = UsdGeom.GetStageUpAxis(stage)
    is_y_up = (up_axis == UsdGeom.Tokens.y)

    for cam_name in ("/OmniverseKit_Persp", "/World/Camera", "/Camera"):
        cam_prim = stage.GetPrimAtPath(cam_name)
        if cam_prim.IsValid():
            try:
                cam_xform = UsdGeom.XformCommonAPI(cam_prim)
                # Centered around X=50, elevated, capturing full conveyor from -370 to +450 including bin at 416
                if is_y_up:
                    cam_xform.SetTranslate(Gf.Vec3d(50.0, 270.0, 520.0))
                    cam_xform.SetRotate(Gf.Vec3f(-25.0, 0.0, 0.0))
                else:
                    cam_xform.SetTranslate(Gf.Vec3d(50.0, -520.0, 270.0))
                    cam_xform.SetRotate(Gf.Vec3f(65.0, 0.0, 0.0))
                break
            except Exception as e:
                carb.log_warn(f"Could not frame camera: {e}")


def drop_package(stage: Usd.Stage) -> str:
    """Spawn a rigid-body package above the conveyor intake point."""
    ensure_timeline_playing()

    packages_root = "/World/Packages"
    if not stage.GetPrimAtPath(packages_root).IsValid():
        stage.DefinePrim(packages_root, "Xform")

    pkg_index = len(_tracked_packages) + 1
    pkg_path = f"/World/Packages/Box_{pkg_index}"
    while stage.GetPrimAtPath(pkg_path).IsValid():
        pkg_index += 1
        pkg_path = f"/World/Packages/Box_{pkg_index}"

    box = UsdGeom.Cube.Define(stage, pkg_path)
    if not box.GetPrim().IsValid():
        raise RuntimeError(f"Failed to define package at {pkg_path}")

    # Package dimensions: 32x32x32 unit box
    box_size = 32.0
    box.GetSizeAttr().Set(box_size)

    # Color palette
    color = PACKAGE_COLORS[pkg_index % len(PACKAGE_COLORS)]
    try:
        box.CreateDisplayColorAttr().Set([color])
    except Exception:
        pass

    up_axis = UsdGeom.GetStageUpAxis(stage)
    is_y_up = (up_axis == UsdGeom.Tokens.y)

    # Spawn directly above conveyor intake (belt extends from X=-369 to +347, elevation ~117, Z ~1.4)
    intake_x = -310.0
    drop_height = 155.0
    belt_z = 1.4

    custom_belt = stage.GetPrimAtPath("/World/ConveyorBelt_A06_PR_NVD_01/Geometry/SM_ConveyorBelt_A06_Belt_01")
    if custom_belt.IsValid():
        bbox_cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), ['default', 'proxy', 'render'])
        bbox = bbox_cache.ComputeWorldBound(custom_belt).ComputeAlignedBox()
        intake_x = bbox.GetMin()[0] + 55.0
        if is_y_up:
            drop_height = bbox.GetMax()[1] + 35.0
            belt_z = (bbox.GetMin()[2] + bbox.GetMax()[2]) / 2.0
        else:
            drop_height = bbox.GetMax()[2] + 35.0
            belt_z = (bbox.GetMin()[1] + bbox.GetMax()[1]) / 2.0

    if is_y_up:
        UsdGeom.XformCommonAPI(box.GetPrim()).SetTranslate(Gf.Vec3d(intake_x, drop_height, belt_z))
    else:
        UsdGeom.XformCommonAPI(box.GetPrim()).SetTranslate(Gf.Vec3d(intake_x, belt_z, drop_height))

    # Apply Rigid Body & Collision APIs
    if UsdPhysics:
        try:
            UsdPhysics.RigidBodyAPI.Apply(box.GetPrim())
            UsdPhysics.CollisionAPI.Apply(box.GetPrim())
            mass_api = UsdPhysics.MassAPI.Apply(box.GetPrim())
            mass_api.CreateMassAttr().Set(2.0)
        except Exception as e:
            carb.log_warn(f"Could not apply physics to package: {e}")

    # Register for tracking
    _tracked_packages[pkg_path] = {
        "path": pkg_path,
        "delivered": False,
        "spawn_time": time.time(),
    }

    return pkg_path


def check_container_arrivals(stage: Usd.Stage) -> list[dict]:
    """Evaluate active packages to detect when they drop into the container bin."""
    global _delivered_count
    newly_delivered = []
    up_axis = UsdGeom.GetStageUpAxis(stage)
    is_y_up = (up_axis == UsdGeom.Tokens.y)

    # Container discharge zone thresholds:
    # Belt ends at X=346.97; bin extends from X=289 to 543 below belt surface Y=117.7
    min_x_threshold = 340.0
    max_elev_threshold = 105.0

    custom_belt = stage.GetPrimAtPath("/World/ConveyorBelt_A06_PR_NVD_01/Geometry/SM_ConveyorBelt_A06_Belt_01")
    if custom_belt.IsValid():
        bbox_cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), ['default', 'proxy', 'render'])
        bbox = bbox_cache.ComputeWorldBound(custom_belt).ComputeAlignedBox()
        min_x_threshold = bbox.GetMax()[0] - 5.0
        if is_y_up:
            max_elev_threshold = bbox.GetMax()[1] - 12.0
        else:
            max_elev_threshold = bbox.GetMax()[2] - 12.0

    for path, data in list(_tracked_packages.items()):
        if data["delivered"]:
            continue

        prim = stage.GetPrimAtPath(path)
        if not prim.IsValid():
            continue

        try:
            xformable = UsdGeom.Xformable(prim)
            time_code = Usd.TimeCode.Default()
            if omni.timeline:
                try:
                    tl = omni.timeline.get_timeline_interface()
                    if tl and tl.is_playing():
                        time_code = Usd.TimeCode(tl.get_current_time() * stage.GetTimeCodesPerSecond())
                except Exception:
                    pass

            world_transform = xformable.ComputeLocalToWorldTransform(time_code)
            translation = world_transform.ExtractTranslation()
            curr_x = translation[0]
            curr_elev = translation[1] if is_y_up else translation[2]

            # Fallback check against default timecode if time_code was not at default
            if time_code != Usd.TimeCode.Default() and curr_x == -150.0:
                wt_default = xformable.ComputeLocalToWorldTransform(Usd.TimeCode.Default())
                tr_def = wt_default.ExtractTranslation()
                if tr_def[0] != -150.0:
                    curr_x = tr_def[0]
                    curr_elev = tr_def[1] if is_y_up else tr_def[2]

            # Box has rolled off conveyor and fallen into the container
            if curr_x >= min_x_threshold and curr_elev <= max_elev_threshold:
                data["delivered"] = True
                _delivered_count += 1
                newly_delivered.append({
                    "box_path": path,
                    "total_count": _delivered_count,
                    "timestamp": time.time(),
                    "x": float(curr_x),
                    "elevation": float(curr_elev),
                })
                carb.log_info(f"Package delivered into container: {path} (Total: {_delivered_count})")
        except Exception as e:
            carb.log_warn(f"Error checking package transform for {path}: {e}")

    return newly_delivered


def reset_container(stage: Usd.Stage) -> int:
    """Clear all packages from the container and reset counter to 0."""
    global _delivered_count, _tracked_packages
    _delivered_count = 0

    packages_root = stage.GetPrimAtPath("/World/Packages")
    if packages_root.IsValid():
        for child in list(packages_root.GetChildren()):
            try:
                stage.RemovePrim(child.GetPath())
            except Exception as e:
                carb.log_warn(f"Could not remove package prim {child.GetPath()}: {e}")

    _tracked_packages.clear()
    carb.log_info("Container reset to 0 boxes.")
    return 0
