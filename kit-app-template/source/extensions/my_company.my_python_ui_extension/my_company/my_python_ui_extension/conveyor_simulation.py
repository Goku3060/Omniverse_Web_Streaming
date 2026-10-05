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
    belt_prim = stage.GetPrimAtPath("/World/Conveyor/Belt")
    if belt_prim.IsValid() and PhysxSchema:
        try:
            surface_vel = PhysxSchema.PhysxSurfaceVelocityAPI(belt_prim)
            if surface_vel:
                surface_vel.GetSurfaceVelocityAttr().Set(Gf.Vec3f(_conveyor_speed, 0.0, 0.0))
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

    # 3. Conveyor Assembly
    conveyor_path = "/World/Conveyor"
    if not stage.GetPrimAtPath(conveyor_path).IsValid():
        stage.DefinePrim(conveyor_path, "Xform")

    # 3a. Conveyor Moving Belt
    belt_path = "/World/Conveyor/Belt"
    if not stage.GetPrimAtPath(belt_path).IsValid():
        belt = UsdGeom.Cube.Define(stage, belt_path)
        belt.GetSizeAttr().Set(1.0)
        # Length 400 along X, Width 80, Thickness 10
        belt_elev = 80.0
        if is_y_up:
            UsdGeom.XformCommonAPI(belt.GetPrim()).SetScale(Gf.Vec3f(400.0, 10.0, 80.0))
            UsdGeom.XformCommonAPI(belt.GetPrim()).SetTranslate(Gf.Vec3d(0.0, belt_elev, 0.0))
        else:
            UsdGeom.XformCommonAPI(belt.GetPrim()).SetScale(Gf.Vec3f(400.0, 80.0, 10.0))
            UsdGeom.XformCommonAPI(belt.GetPrim()).SetTranslate(Gf.Vec3d(0.0, 0.0, belt_elev))

        try:
            belt.CreateDisplayColorAttr().Set([Gf.Vec3f(0.15, 0.18, 0.22)])  # Charcoal Belt
        except Exception:
            pass

        if UsdPhysics:
            UsdPhysics.CollisionAPI.Apply(belt.GetPrim())

        if PhysxSchema:
            surface_vel = PhysxSchema.PhysxSurfaceVelocityAPI.Apply(belt.GetPrim())
            surface_vel.CreateSurfaceVelocityAttr().Set(Gf.Vec3f(_conveyor_speed, 0.0, 0.0))

    # 3b. Conveyor Frame Legs
    for idx, x_leg in enumerate((-160.0, 0.0, 160.0)):
        leg_path = f"/World/Conveyor/Leg_{idx}"
        if not stage.GetPrimAtPath(leg_path).IsValid():
            leg = UsdGeom.Cube.Define(stage, leg_path)
            leg.GetSizeAttr().Set(1.0)
            if is_y_up:
                UsdGeom.XformCommonAPI(leg.GetPrim()).SetScale(Gf.Vec3f(12.0, 75.0, 76.0))
                UsdGeom.XformCommonAPI(leg.GetPrim()).SetTranslate(Gf.Vec3d(x_leg, 37.5, 0.0))
            else:
                UsdGeom.XformCommonAPI(leg.GetPrim()).SetScale(Gf.Vec3f(12.0, 76.0, 75.0))
                UsdGeom.XformCommonAPI(leg.GetPrim()).SetTranslate(Gf.Vec3d(x_leg, 0.0, 37.5))
            try:
                leg.CreateDisplayColorAttr().Set([Gf.Vec3f(0.28, 0.32, 0.36)])
            except Exception:
                pass

    # 3c. Conveyor Side Guide Rails (keep packages on the belt)
    for side_idx, z_offset in enumerate((-44.0, 44.0)):
        rail_path = f"/World/Conveyor/Rail_{side_idx}"
        if not stage.GetPrimAtPath(rail_path).IsValid():
            rail = UsdGeom.Cube.Define(stage, rail_path)
            rail.GetSizeAttr().Set(1.0)
            if is_y_up:
                UsdGeom.XformCommonAPI(rail.GetPrim()).SetScale(Gf.Vec3f(400.0, 22.0, 6.0))
                UsdGeom.XformCommonAPI(rail.GetPrim()).SetTranslate(Gf.Vec3d(0.0, 92.0, z_offset))
            else:
                UsdGeom.XformCommonAPI(rail.GetPrim()).SetScale(Gf.Vec3f(400.0, 6.0, 22.0))
                UsdGeom.XformCommonAPI(rail.GetPrim()).SetTranslate(Gf.Vec3d(0.0, z_offset, 92.0))
            try:
                rail.CreateDisplayColorAttr().Set([Gf.Vec3f(0.40, 0.44, 0.50)])
            except Exception:
                pass
            if UsdPhysics:
                UsdPhysics.CollisionAPI.Apply(rail.GetPrim())

    # 4. Collection Container Bin (at discharge end X = 270.0)
    container_root = "/World/Container"
    if not stage.GetPrimAtPath(container_root).IsValid():
        stage.DefinePrim(container_root, "Xform")

    # Container Floor
    c_floor_path = "/World/Container/Floor"
    if not stage.GetPrimAtPath(c_floor_path).IsValid():
        c_floor = UsdGeom.Cube.Define(stage, c_floor_path)
        c_floor.GetSizeAttr().Set(1.0)
        if is_y_up:
            UsdGeom.XformCommonAPI(c_floor.GetPrim()).SetScale(Gf.Vec3f(120.0, 6.0, 120.0))
            UsdGeom.XformCommonAPI(c_floor.GetPrim()).SetTranslate(Gf.Vec3d(275.0, 3.0, 0.0))
        else:
            UsdGeom.XformCommonAPI(c_floor.GetPrim()).SetScale(Gf.Vec3f(120.0, 120.0, 6.0))
            UsdGeom.XformCommonAPI(c_floor.GetPrim()).SetTranslate(Gf.Vec3d(275.0, 0.0, 3.0))
        try:
            c_floor.CreateDisplayColorAttr().Set([Gf.Vec3f(0.18, 0.48, 0.72)])  # Container Industrial Blue
        except Exception:
            pass
        if UsdPhysics:
            UsdPhysics.CollisionAPI.Apply(c_floor.GetPrim())

    # Container 4 Perimeter Walls (open top to catch boxes)
    walls_config = [
        # (name, scale_x, scale_y_or_z, translate_x, translate_other)
        ("Wall_Back", 120.0, 6.0, 275.0, 60.0),    # back wall
        ("Wall_Front", 120.0, 6.0, 275.0, -60.0),  # front wall
        ("Wall_Right", 6.0, 120.0, 335.0, 0.0),    # far right end stop
        ("Wall_Left", 6.0, 120.0, 215.0, 0.0),     # intake barrier under belt
    ]
    for w_name, sx, sz_or_sy, tx, tz_or_ty in walls_config:
        w_path = f"/World/Container/{w_name}"
        if not stage.GetPrimAtPath(w_path).IsValid():
            wall = UsdGeom.Cube.Define(stage, w_path)
            wall.GetSizeAttr().Set(1.0)
            wall_h = 55.0
            if is_y_up:
                UsdGeom.XformCommonAPI(wall.GetPrim()).SetScale(Gf.Vec3f(sx, wall_h, sz_or_sy))
                UsdGeom.XformCommonAPI(wall.GetPrim()).SetTranslate(Gf.Vec3d(tx, wall_h / 2.0 + 6.0, tz_or_ty))
            else:
                UsdGeom.XformCommonAPI(wall.GetPrim()).SetScale(Gf.Vec3f(sx, sz_or_sy, wall_h))
                UsdGeom.XformCommonAPI(wall.GetPrim()).SetTranslate(Gf.Vec3d(tx, tz_or_ty, wall_h / 2.0 + 6.0))
            try:
                wall.CreateDisplayColorAttr().Set([Gf.Vec3f(0.92, 0.72, 0.15)])  # Safety Amber Walls
            except Exception:
                pass
            if UsdPhysics:
                UsdPhysics.CollisionAPI.Apply(wall.GetPrim())

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
                # Positioned slightly to the right of center (X=50), elevated, angled down
                if is_y_up:
                    cam_xform.SetTranslate(Gf.Vec3d(50.0, 240.0, 360.0))
                    cam_xform.SetRotate(Gf.Vec3f(-26.0, 0.0, 0.0))
                else:
                    cam_xform.SetTranslate(Gf.Vec3d(50.0, -360.0, 240.0))
                    cam_xform.SetRotate(Gf.Vec3f(64.0, 0.0, 0.0))
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

    # Spawn directly above conveyor intake (X = -150)
    intake_x = -150.0
    drop_height = 125.0  # Belt is at 85; box drops ~40 units onto belt

    if is_y_up:
        UsdGeom.XformCommonAPI(box.GetPrim()).SetTranslate(Gf.Vec3d(intake_x, drop_height, 0.0))
    else:
        UsdGeom.XformCommonAPI(box.GetPrim()).SetTranslate(Gf.Vec3d(intake_x, 0.0, drop_height))

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

    # Container discharge zone thresholds
    # Belt ends at X=200; container extends from X=215 to 335
    # Belt surface is at elevation ~85 (box center ~101); container floor is at ground (elevation < 78 for stacked boxes)
    min_x_threshold = 205.0
    max_elev_threshold = 78.0

    for path, data in list(_tracked_packages.items()):
        if data["delivered"]:
            continue

        prim = stage.GetPrimAtPath(path)
        if not prim.IsValid():
            continue

        try:
            xformable = UsdGeom.Xformable(prim)
            world_transform = xformable.ComputeLocalToWorldTransform(Usd.TimeCode.Default())
            translation = world_transform.ExtractTranslation()
            curr_x = translation[0]
            curr_elev = translation[1] if is_y_up else translation[2]

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
