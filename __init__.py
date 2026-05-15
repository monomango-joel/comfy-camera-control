import os
import shutil

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

# ── Web directory registration ────────────────────────────────────────────────
WEB_DIRECTORY = os.path.join(os.path.dirname(__file__), "web")

# ── Copy gsplat-bundle.js from comfyui-geometrypack if available ──────────────
# viewer_splat.html needs this bundle to render Gaussian splats.
# We look for it in sibling custom_nodes directories so we don't ship a copy.
def _copy_gsplat_bundle():
    dst = os.path.join(WEB_DIRECTORY, "js", "gsplat-bundle.js")
    if os.path.exists(dst):
        return  # already present

    # Search sibling custom_nodes for the bundle.
    custom_nodes_dir = os.path.dirname(os.path.dirname(__file__))
    candidates = [
        os.path.join(custom_nodes_dir, "comfyui-geometrypack", "web", "js", "gsplat-bundle.js"),
        os.path.join(custom_nodes_dir, "ComfyUI-3D-Pack", "web", "js", "gsplat-bundle.js"),
    ]
    for src in candidates:
        if os.path.exists(src):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            print(f"[CameraControl] Copied gsplat-bundle.js from {src}")
            return

    print("[CameraControl] gsplat-bundle.js not found — splat viewer will use CDN fallback")

_copy_gsplat_bundle()
