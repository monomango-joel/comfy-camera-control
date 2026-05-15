import os
import shutil

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

# ── Web directory registration ────────────────────────────────────────────────
# ComfyUI looks for WEB_DIRECTORY on the module to know where to serve static
# files from.  Files placed here are served under:
#   /extensions/<folder-name>/
# The folder name is the directory name (i.e. "comfy-camera-control").

WEB_DIRECTORY = os.path.join(os.path.dirname(__file__), "web")
