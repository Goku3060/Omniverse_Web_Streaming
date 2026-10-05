import carb
from pxr import Gf, Usd, UsdGeom

try:
    import omni.kit.viewport.utility as vp_utils
except ImportError:
    vp_utils = None

# Curated palette for visually distinct cubes side by side
CUBE_COLORS = [
    Gf.Vec3f(0.46, 0.73, 0.12),  # NVIDIA Green
    Gf.Vec3f(0.20, 0.55, 0.95),  # Electric Blue
    Gf.Vec3f(0.95, 0.40, 0.20),  # Coral Amber
    Gf.Vec3f(0.65, 0.30, 0.85),  # Purple
    Gf.Vec3f(0.10, 0.80, 0.75),  # Cyan
    Gf.Vec3f(0.95, 0.75, 0.10),  # Gold
]


def spawn_cube(stage: Usd.Stage) -> str:
    """Create a uniquely colored cube placed side by side with existing cubes, perfectly framed by the camera."""
    if not stage.GetPrimAtPath("/World").IsValid():
        stage.DefinePrim("/World", "Xform")

    cube_index = 0
    cube_path = "/World/Cube"
    while stage.GetPrimAtPath(cube_path).IsValid():
        cube_index += 1
        cube_path = f"/World/Cube_{cube_index}"

    cube = UsdGeom.Cube.Define(stage, cube_path)
    if not cube.GetPrim().IsValid():
        raise RuntimeError(f"Failed to create cube at {cube_path}")

    cube_size = 100.0
    spacing = 130.0  # 100 unit cube width + 30 unit gap side by side
    cube.GetSizeAttr().Set(cube_size)

    # Assign distinct color so side-by-side cubes are easily distinguishable
    try:
        color = CUBE_COLORS[cube_index % len(CUBE_COLORS)]
        cube.CreateDisplayColorAttr().Set([color])
    except Exception as e:
        carb.log_warn(f"Could not set cube displayColor: {e}")

    half_size = cube_size / 2.0
    up_axis = UsdGeom.GetStageUpAxis(stage)
    y = half_size if up_axis == UsdGeom.Tokens.y else 0.0
    z = half_size if up_axis == UsdGeom.Tokens.z else 0.0

    # Place cubes side by side along X
    UsdGeom.XformCommonAPI(cube.GetPrim()).SetTranslate(
        Gf.Vec3d(cube_index * spacing, y, z)
    )

    # Dynamically frame all side-by-side cubes so none are pushed off-screen
    try:
        cam_path = None
        if vp_utils:
            cam_path = vp_utils.get_active_viewport_camera_string()
        if not cam_path or not stage.GetPrimAtPath(cam_path).IsValid():
            for candidate in ("/OmniverseKit_Persp", "/World/Camera", "/Camera"):
                if stage.GetPrimAtPath(candidate).IsValid():
                    cam_path = candidate
                    break

        if cam_path:
            cam_prim = stage.GetPrimAtPath(cam_path)
            if cam_prim.IsValid():
                cam_xform = UsdGeom.XformCommonAPI(cam_prim)
                # Center camera along the middle of all spawned cubes
                center_x = (cube_index * spacing) / 2.0
                # Pull back smoothly as row of cubes widens
                cam_dist = max(350.0, 300.0 + (cube_index * 60.0))
                cam_elevation = half_size + 100.0 + (cube_index * 10.0)

                if up_axis == UsdGeom.Tokens.z:
                    cam_xform.SetTranslate(Gf.Vec3d(center_x, -cam_dist, cam_elevation))
                    cam_xform.SetRotate(Gf.Vec3f(75, 0, 0))
                else:
                    cam_xform.SetTranslate(Gf.Vec3d(center_x, cam_elevation, cam_dist))
                    cam_xform.SetRotate(Gf.Vec3f(-15, 0, 0))
    except Exception as e:
        carb.log_error(f"Could not adjust viewport camera: {e}")

    return cube_path
