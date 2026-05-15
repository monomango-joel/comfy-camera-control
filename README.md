# comfy-camera-control

ComfyUI custom node: **Load 3D (Camera Control)**

Loads a 3D model and exposes camera **azimuth**, **elevation**, and **distance** as workflow values, so external API callers can control the viewpoint without touching the UI.

## Install

```
cd D:\ComfyUI\custom_nodes
git clone https://github.com/joelmono/comfy-camera-control
```

Restart ComfyUI.

## Supported formats

### Mesh/3D Models
`.glb`, `.gltf`, `.obj`, `.fbx`, `.stl` — place files in `ComfyUI/input/3d/`

### Gaussian Splats
`.ply`, `.splat`, `.spz` — place files in `ComfyUI/input/3d/`

**SPZ files** (Niantic Scaniverse format with zstd compression) are automatically decompressed and loaded.

## Usage

### Interactive (browser)
Drop the node into a workflow. Drag the 3D viewer to orbit. Camera values are written into the node outputs automatically.

### API-driven (headless)

POST to `/api/prompt` with the azimuth / elevation / distance widgets set:

```json
{
  "1": {
    "class_type": "CameraControlLoad3D",
    "inputs": {
      "model_file": "my_model.glb",
      "width": 512,
      "height": 512,
      "up_axis": "+Y",
      "azimuth": 135,
      "elevation": 30,
      "distance": 4.5
    }
  }
}
```

The node outputs: `IMAGE`, `azimuth` (FLOAT), `elevation` (FLOAT), `distance` (FLOAT), `model_path` (STRING).

## Up axis

Use `up_axis` to correct models that were exported with a different convention:

| Value | Meaning |
|-------|---------|
| `+Y`  | Model Y points up (default for most GLTF/FBX) |
| `+Z`  | Model Z points up (Blender default OBJ export) |
| `-Y`  | Model Y points down |
| etc.  | |

## Architecture

```
__init__.py          # Registers node + serves web/
nodes.py             # Python node class (INPUT_TYPES, RETURN_TYPES, execute)
web/
  viewer.html        # Three.js 3D viewer (iframe, postMessage protocol)
  viewer_splat.html  # gsplat Gaussian splatting viewer (iframe)
  js/
    cameraControl.js # ComfyUI widget (registers extension, wires iframe)
    spz-decoder.js   # Shared SPZ decompression utility (Niantic format)
```

### postMessage protocol (parent ↔ iframe)

**Parent → iframe:**

| `type`           | Fields | Purpose |
|------------------|--------|---------|
| `LOAD_MODEL`     | `filepath`, `upQuat`, `camera`, `locked` | Load new file |
| `SET_CAMERA`     | `azimuth`, `elevation`, `distance`, `locked` | Move camera only |
| `SET_UP_AXIS`    | `upQuat` | Rotate model root |
| `TAKE_SCREENSHOT`| — | Request PNG |

**Iframe → parent:**

| `type`          | Fields | Purpose |
|-----------------|--------|---------|
| `CAMERA_CHANGED`| `azimuth`, `elevation`, `distance` | Interactive drag update |
| `MODEL_LOADED`  | `radius` | Load complete |
| `MODEL_ERROR`   | `error` | Load failed |
| `SCREENSHOT`    | `image` (data URL) | PNG capture |
