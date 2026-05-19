import math
import os
import folder_paths
from pathlib import Path
from typing_extensions import override

import nodes
from comfy_api.latest import IO, InputImpl, Types


SUPPORTED_EXTENSIONS = {".glb", ".gltf", ".obj", ".fbx", ".stl", ".ply", ".splat", ".spz", ".ksplat"}


def normalize_path(path):
    return path.replace("\\", "/")


def get_3d_files():
    input_dir = os.path.join(folder_paths.get_input_directory(), "3d")
    os.makedirs(input_dir, exist_ok=True)
    base = Path(folder_paths.get_input_directory())
    files = [
        normalize_path(str(p.relative_to(base)))
        for p in Path(input_dir).rglob("*")
        if p.suffix.lower() in SUPPORTED_EXTENSIONS
    ]
    return sorted(files) if files else ["none"]


def camera_info_to_spherical(camera_info):
    """Convert {position, target, zoom} → (azimuth°, elevation°, distance)."""
    if not camera_info:
        return 0.0, 20.0, 5.0
    pos = camera_info.get("position") or {}
    tgt = camera_info.get("target") or {}
    dx = pos.get("x", 0.0) - tgt.get("x", 0.0)
    dy = pos.get("y", 0.0) - tgt.get("y", 0.0)
    dz = pos.get("z", 0.0) - tgt.get("z", 0.0)
    dist = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
    elevation = math.degrees(math.asin(max(-1.0, min(1.0, dy / dist))))
    azimuth = (math.degrees(math.atan2(dx, dz)) + 360.0) % 360.0
    return azimuth, elevation, dist


class CameraControlLoad3D(IO.ComfyNode):
    """Load a 3D model with programmatic camera control on top of the native Load3D viewer.

    The native widget handles file loading (incl. SPZ v3), rendering, and screenshot
    capture. JS-side wiring pushes azimuth/elevation/distance overrides into the
    viewer; this node reads back the resulting camera state for downstream outputs.
    """

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        # Re-execute every queue so a fresh screenshot from the viewer is used.
        import time
        return str(time.time())

    @classmethod
    @override
    def define_schema(cls):
        return IO.Schema(
            node_id="CameraControlLoad3D",
            display_name="Load 3D (Camera Control)",
            category="3D/Camera",
            inputs=[
                IO.Combo.Input("model_file", options=get_3d_files(),
                               upload=IO.UploadType.model,
                               tooltip="3D file (glb/gltf/obj/fbx/stl/ply/splat/spz)"),
                IO.Load3D.Input("image"),
                IO.Int.Input("width", default=512, min=64, max=4096, step=8),
                IO.Int.Input("height", default=512, min=64, max=4096, step=8),
                IO.Float.Input("azimuth", default=0.0, min=0.0, max=360.0, step=0.1,
                               optional=True,
                               tooltip="Horizontal rotation (0=front, 90=right)"),
                IO.Float.Input("elevation", default=20.0, min=-90.0, max=90.0, step=0.1,
                               optional=True,
                               tooltip="Vertical angle (0=horizon, 90=top)"),
                IO.Float.Input("distance", default=5.0, min=0.01, max=1000.0, step=0.01,
                               optional=True,
                               tooltip="Normalized camera distance (1 = bounding-sphere radius)"),
            ],
            outputs=[
                IO.Image.Output(display_name="image"),
                IO.Float.Output(display_name="azimuth"),
                IO.Float.Output(display_name="elevation"),
                IO.Float.Output(display_name="distance"),
                IO.String.Output(display_name="model_path"),
                IO.File3DAny.Output(display_name="model_3d"),
            ],
        )

    @classmethod
    @override
    def execute(cls, model_file, image, width, height,
                azimuth=None, elevation=None, distance=None) -> IO.NodeOutput:
        import torch

        # The native Load3D widget normally produces a dict:
        #   {image, mask, normal, camera_info, recording?}
        # Defensive handling: an old workflow or unconfigured widget may pass
        # a bare string (model file) or None — fall back to a black tensor.
        print(f"[CameraControl] execute: model_file={model_file!r}, image type={type(image).__name__}, value={image!r}")

        if isinstance(image, dict):
            image_field = image.get("image", "")
            camera_info = image.get("camera_info")
        else:
            image_field = ""
            camera_info = None

        output_image = None
        if image_field:
            try:
                image_path = folder_paths.get_annotated_filepath(image_field)
                load_image = nodes.LoadImage()
                output_image, _ = load_image.load_image(image=image_path)
            except Exception as e:
                print(f"[CameraControl] failed to load preview image '{image_field}': {e}")

        if output_image is None:
            output_image = torch.zeros((1, height, width, 3), dtype=torch.float32)

        out_az, out_el, out_dist = camera_info_to_spherical(camera_info)

        final_az = azimuth if azimuth is not None else out_az
        final_el = elevation if elevation is not None else out_el
        final_dist = distance if distance is not None else out_dist

        model_path = folder_paths.get_annotated_filepath(model_file)
        file_3d = Types.File3D(model_path)

        return IO.NodeOutput(output_image, final_az, final_el, final_dist, model_path, file_3d)


NODE_CLASS_MAPPINGS = {"CameraControlLoad3D": CameraControlLoad3D}
NODE_DISPLAY_NAME_MAPPINGS = {"CameraControlLoad3D": "Load 3D (Camera Control)"}
