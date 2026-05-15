import os
import folder_paths


# Up-axis rotation matrices applied to the scene root so camera math is always consistent.
# These rotate the model so "world up" matches the chosen axis.
UP_AXIS_OPTIONS = ["+Y", "-Y", "+Z", "-Z", "+X", "-X"]

# Maps each up-axis choice to a quaternion [x, y, z, w] that rotates
# that axis to +Y (Three.js default up).  Sent to the JS viewer via
# the postMessage protocol and applied to the model root object.
UP_AXIS_QUATERNIONS = {
    "+Y": [0, 0, 0, 1],           # identity — model already Y-up
    "-Y": [0, 0, 1, 0],           # 180° around Z
    "+Z": [0.7071068, 0, 0, 0.7071068],   # -90° around X  (Z → Y)
    "-Z": [-0.7071068, 0, 0, 0.7071068],  # +90° around X  (-Z → Y)
    "+X": [0, 0, -0.7071068, 0.7071068],  # +90° around Z  (X → Y)
    "-X": [0, 0, 0.7071068, 0.7071068],   # -90° around Z  (-X → Y)
}

SUPPORTED_EXTENSIONS = {".glb", ".gltf", ".obj", ".fbx", ".stl", ".ply", ".splat"}


def get_3d_files():
    input_dir = folder_paths.get_input_directory()
    model_dir = os.path.join(input_dir, "3d")
    os.makedirs(model_dir, exist_ok=True)
    files = []
    for f in os.listdir(model_dir):
        if os.path.splitext(f)[1].lower() in SUPPORTED_EXTENSIONS:
            files.append(f)
    return sorted(files) if files else ["none"]


class CameraControlLoad3D:
    """
    Load a 3D model and expose its camera pose (azimuth, elevation, distance)
    as workflow values so external API callers can control the viewpoint without
    touching the UI.

    Camera inputs are optional overrides. When connected they drive the viewer;
    when left at default the interactive viewer pose is used instead.
    """

    CATEGORY = "3D/Camera"
    FUNCTION = "load_3d"
    RETURN_TYPES = ("IMAGE", "FLOAT", "FLOAT", "FLOAT", "STRING")
    RETURN_NAMES = ("image", "azimuth", "elevation", "distance", "model_path")
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_file": (get_3d_files(), {"tooltip": "3D file from ComfyUI/input/3d/"}),
                "width":  ("INT", {"default": 512, "min": 64, "max": 4096, "step": 8}),
                "height": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 8}),
                "up_axis": (UP_AXIS_OPTIONS, {"default": "+Y", "tooltip": "Which axis in the source model points up"}),
            },
            "optional": {
                # When these are connected the viewer is locked to them;
                # the interactive camera widget is overridden.
                "azimuth":   ("FLOAT", {"default": 0.0,  "min": 0.0,   "max": 360.0, "step": 0.1,
                                        "tooltip": "Horizontal rotation in degrees (0 = front, 90 = right)"}),
                "elevation": ("FLOAT", {"default": 20.0, "min": -90.0, "max": 90.0,  "step": 0.1,
                                        "tooltip": "Vertical angle in degrees (0 = horizon, 90 = top)"}),
                "distance":  ("FLOAT", {"default": 5.0,  "min": 0.01,  "max": 1000.0,"step": 0.01,
                                        "tooltip": "Camera distance from the model centre"}),
            },
            "hidden": {
                # The JS widget writes the live interactive camera pose into this
                # hidden input before execution so it round-trips through the server.
                "camera_widget_state": ("STRING", {"default": "{}"}),
            },
        }

    def load_3d(self, model_file, width, height, up_axis,
                azimuth=None, elevation=None, distance=None,
                camera_widget_state="{}"):
        import json
        import torch
        import numpy as np

        input_dir = folder_paths.get_input_directory()
        model_path = os.path.join(input_dir, "3d", model_file)

        # Resolve camera values: explicit inputs beat the widget state.
        state = {}
        try:
            state = json.loads(camera_widget_state) if camera_widget_state else {}
        except Exception:
            pass

        final_azimuth   = azimuth   if azimuth   is not None else float(state.get("azimuth",   0.0))
        final_elevation = elevation if elevation is not None else float(state.get("elevation", 20.0))
        final_distance  = distance  if distance  is not None else float(state.get("distance",   5.0))

        # The actual render is done by the JS iframe widget and sent back as a
        # screenshot blob.  On the Python side we return a placeholder black
        # image so the node output is always a valid IMAGE tensor regardless of
        # whether the workflow is running headless.  When the browser is open the
        # real screenshot tensor is injected via the ui dict (see below).
        placeholder = torch.zeros((1, height, width, 3), dtype=torch.float32)

        return {
            "ui": {
                # Tells the JS widget which file to load and what camera pose to
                # apply.  The widget picks these up in onExecuted().
                "model_file":    [model_file],
                "model_path":    [model_path],
                "camera_params": [{
                    "azimuth":   final_azimuth,
                    "elevation": final_elevation,
                    "distance":  final_distance,
                    "up_axis":   up_axis,
                    "up_quat":   UP_AXIS_QUATERNIONS[up_axis],
                }],
                "width":  [width],
                "height": [height],
            },
            "result": (placeholder, final_azimuth, final_elevation, final_distance, model_path),
        }


NODE_CLASS_MAPPINGS = {
    "CameraControlLoad3D": CameraControlLoad3D,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CameraControlLoad3D": "Load 3D (Camera Control)",
}
