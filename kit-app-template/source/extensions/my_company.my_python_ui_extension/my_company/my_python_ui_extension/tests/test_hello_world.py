# SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: LicenseRef-NvidiaProprietary
#
# NVIDIA CORPORATION, its affiliates and licensors retain all intellectual
# property and proprietary rights in and to this material, related
# documentation and any modifications thereto. Any use, reproduction,
# disclosure or distribution of this material and related documentation
# without an express license agreement from NVIDIA CORPORATION or
# its affiliates is strictly prohibited.

# NOTE:
#   omni.kit.test - std python's unittest module with additional wrapping to add
#   suport for async/await tests
#   For most things refer to unittest docs:
#   https://docs.python.org/3/library/unittest.html
import omni.kit.test
import omni.usd
from pxr import UsdGeom

# Extension for writing UI tests (to simulate UI interaction)
import omni.kit.ui_test as ui_test

# Import extension python module we are testing with absolute import path,
# as if we are external user (other extension)
import my_company.my_python_ui_extension


# Having a test class dervived from omni.kit.test.AsyncTestCase declared on the
# root of module will make it auto-discoverable by omni.kit.test
class Test(omni.kit.test.AsyncTestCase):
    # Before running each test
    async def setUp(self):
        pass

    # After running each test
    async def tearDown(self):
        pass

    # Actual test, notice it is an "async" function, so "await" can be used if needed
    async def test_hello_public_function(self):
        result = my_company.my_python_ui_extension.some_public_function(4)
        self.assertEqual(result, 256)

    async def test_window_button(self):
        # Find the button in our window
        spawn_button = ui_test.find(
            "Spawn Cube//Frame/**/Button[*].text=='Spawn Cube'"
        )

        await omni.usd.get_context().new_stage_async()
        await spawn_button.click()

        stage = omni.usd.get_context().get_stage()
        self.assertIsNotNone(stage)
        cube_prim = stage.GetPrimAtPath("/World/Cube")
        self.assertTrue(cube_prim.IsValid())

        up_axis = UsdGeom.GetStageUpAxis(stage)
        vertical_index = 1 if up_axis == UsdGeom.Tokens.y else 2
        translation = cube_prim.GetAttribute("xformOp:translate").Get()
        self.assertAlmostEqual(translation[vertical_index], 1.0)

        await spawn_button.click()
        second_cube = stage.GetPrimAtPath("/World/Cube_1")
        self.assertTrue(second_cube.IsValid())
        second_translation = second_cube.GetAttribute("xformOp:translate").Get()
        self.assertAlmostEqual(second_translation[vertical_index], 1.0)
        self.assertAlmostEqual(second_translation[0], 2.5)
