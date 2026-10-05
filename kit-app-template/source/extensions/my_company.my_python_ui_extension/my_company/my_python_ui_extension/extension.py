# SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: LicenseRef-NvidiaProprietary
#
# NVIDIA CORPORATION, its affiliates and licensors retain all intellectual
# property and proprietary rights in and to this material, related
# documentation and any modifications thereto. Any use, reproduction,
# disclosure or distribution of this material and related documentation
# without an express license agreement from NVIDIA CORPORATION or
# its affiliates is strictly prohibited.

import omni.ext
import omni.ui as ui
import omni.usd
from my_company.my_python_ui_extension.cube_spawner import (
    spawn_cube as spawn_cube_in_stage,
)


# Functions and vars are available to other extensions as usual in python:
# `my_company.my_python_ui_extension.some_public_function(x)`
def some_public_function(x: int):
    """This is a public function that can be called from other extensions."""
    print(f"[my_company.my_python_ui_extension] some_public_function was called with {x}")
    return x ** x


# Any class derived from `omni.ext.IExt` in the top level module (defined in
# `python.modules` of `extension.toml`) will be instantiated when the extension
# gets enabled, and `on_startup(ext_id)` will be called. Later when the
# extension gets disabled on_shutdown() is called.
class MyExtension(omni.ext.IExt):
    """This extension provides a UI for spawning cubes in the active USD stage."""
    # ext_id is the current extension id. It can be used with the extension
    # manager to query additional information, like where this extension is
    # located on the filesystem.
    def on_startup(self, _ext_id):
        """This is called every time the extension is activated."""
        print("[my_company.my_python_ui_extension] Extension startup")

        self._window = ui.Window(
            "Spawn Cube", width=180, height=70
        )
        with self._window.frame:

            def on_spawn_cube(_event=None):
                stage = omni.usd.get_context().get_stage()
                if stage is not None:
                    spawn_cube_in_stage(stage)

            ui.Button("Spawn Cube", clicked_fn=on_spawn_cube)

    def on_shutdown(self):
        """This is called every time the extension is deactivated. It is used
        to clean up the extension state."""
        print("[my_company.my_python_ui_extension] Extension shutdown")
