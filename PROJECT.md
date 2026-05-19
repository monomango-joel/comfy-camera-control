---
name: Camera Control 3D Viewer Project
description: Goal is to add azimuth/elevation/distance camera control to ComfyUI's 3D viewer, mirroring the native Load3D node structure
type: project
---

## Project Goal
Extend ComfyUI's 3D viewer with **programmatic camera control** via azimuth/elevation/distance inputs. Users can drive the camera viewpoint via workflow values instead of only mouse interaction.

## Native Node Reference
**Location:** `C:\Users\Joel\Downloads\ComfyUI-master\ComfyUI-master\comfy_extras\nodes_load_3d.py`

Key patterns we're mirroring:
- `folder_paths.get_annotated_filepath()` for proper file path handling (fixes SPZ loading)
- Recursive file discovery with `rglob("*")`  
- `Types.File3D()` wrapping for file serialization
- New API migration: `IO.ComfyNode` + `IO.Schema`
- File upload support: `upload=IO.UploadType.model`

## Current Implementation
**File:** `nodes.py` (dual API support)
- **New API:** `IO.ComfyNode` with schema-based inputs/outputs
- **Fallback:** Old dict-based API for older ComfyUI versions
- **Camera control outputs:** Azimuth, elevation, distance (floats)
- **UI integration:** Custom viewers in iframes communicate via `postMessage`

## Viewers
1. **viewer.html** — Three.js for glb/gltf/obj/fbx/stl/ply (disabled mouse, camera only via API)
2. **viewer_splat.html** — Gaussian Splats 3D for ply/splat/spz/ksplat (disabled mouse, camera only via API)

## Current Issue
SPZ files fail with "incorrect buffer size" error when loaded via `/view?filename=...` endpoint. Native node handles same files correctly—investigating file serving/loading mechanism.
