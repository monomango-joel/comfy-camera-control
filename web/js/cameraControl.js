/**
 * ComfyUI Camera Control — JS wiring for the CameraControlLoad3D node.
 *
 * The node uses ComfyUI's native Load3D widget for rendering and screenshots.
 * To drive the camera live from the azimuth/elevation/distance sliders, we
 * monkey-patch the CameraManager class (exposed via window.comfyAPI). When a
 * CameraManager is created we register it by the canvas DOM element its
 * OrbitControls is attached to; then we look it up by walking down from our
 * node's widget element to find the canvas.
 */

import { app } from "../../../scripts/app.js";

const NODE_NAME = "CameraControlLoad3D";

// canvas DOM element → CameraManager instance
const canvasToCameraManager = new WeakMap();

// Patch CameraManager.prototype.setControls to register the canvas→manager link.
// Called as early as possible; if comfyAPI isn't ready yet, retry on a timer.
function patchCameraManager() {
    const CM = window.comfyAPI?.CameraManager?.CameraManager;
    if (!CM || CM.prototype._cc_patched) return !!CM;
    const origSetControls = CM.prototype.setControls;
    CM.prototype.setControls = function (controls) {
        const result = origSetControls.apply(this, arguments);
        try {
            // OrbitControls' .domElement is the canvas it listens on.
            const canvas = controls?.domElement;
            if (canvas) {
                canvasToCameraManager.set(canvas, this);
            }
        } catch (e) { /* ignore */ }
        return result;
    };
    CM.prototype._cc_patched = true;
    return true;
}

// Try to patch immediately; retry until it succeeds (comfyAPI is populated lazily).
let patchAttempts = 0;
function tryPatch() {
    if (patchCameraManager()) return;
    if (++patchAttempts < 200) setTimeout(tryPatch, 100);
}
tryPatch();

// Find the canvas associated with this node's 3D widget.
function findNodeCanvas(node) {
    // The Load3D widget appends a canvas inside the node's DOM. Search the
    // page for canvases owned by this node's widget element if any.
    if (!node.widgets) return null;
    for (const w of node.widgets) {
        const el = w?.element || w?.inputEl;
        if (!el) continue;
        if (el.tagName === "CANVAS") return el;
        const canvas = el.querySelector?.("canvas");
        if (canvas) return canvas;
    }
    return null;
}

function getCameraManagerForNode(node) {
    const canvas = findNodeCanvas(node);
    if (!canvas) return null;
    return canvasToCameraManager.get(canvas) || null;
}

function widgetValue(node, name, fallback) {
    const w = node.widgets?.find(x => x.name === name);
    return w ? w.value : fallback;
}

// State per-node: the "baseline" camera distance used to normalize the slider.
// First time we touch the camera, snapshot the current distance as scale=current/sliderValue,
// so the slider value at that moment maps to the existing framing.
const nodeBaselineScale = new WeakMap();

function pushCameraToViewer(node) {
    const cm = getCameraManagerForNode(node);
    if (!cm || typeof cm.setCameraState !== "function") return false;

    const az = widgetValue(node, "azimuth", 0);
    const el = widgetValue(node, "elevation", 20);
    const distNorm = widgetValue(node, "distance", 5);

    const current = cm.getCameraState();
    const target = current?.target ?? { x: 0, y: 0, z: 0 };
    const zoom = current?.zoom ?? 1;

    let scale = nodeBaselineScale.get(node);
    if (!scale) {
        const dx = (current?.position?.x ?? 0) - target.x;
        const dy = (current?.position?.y ?? 0) - target.y;
        const dz = (current?.position?.z ?? 0) - target.z;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        scale = r > 0.0001 ? (r / Math.max(0.0001, distNorm || 1)) : 1;
        nodeBaselineScale.set(node, scale);
    }
    const worldDist = distNorm * scale;

    const azR = az * Math.PI / 180;
    const elR = el * Math.PI / 180;
    const position = {
        x: target.x + worldDist * Math.cos(elR) * Math.sin(azR),
        y: target.y + worldDist * Math.sin(elR),
        z: target.z + worldDist * Math.cos(elR) * Math.cos(azR),
    };

    cm.setCameraState({ position, target, zoom });
    return true;
}

app.registerExtension({
    name: "comfycameracontrol.load3d",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            const node = this;

            let pushTimer = null;
            const schedulePush = () => {
                clearTimeout(pushTimer);
                pushTimer = setTimeout(() => pushCameraToViewer(node), 30);
            };

            const wireWidgets = () => {
                let wired = 0;
                for (const name of ["azimuth", "elevation", "distance"]) {
                    const w = node.widgets?.find(x => x.name === name);
                    if (!w || w._cc_wired) continue;
                    const orig = w.callback;
                    w.callback = function () {
                        const res = orig?.apply(this, arguments);
                        schedulePush();
                        return res;
                    };
                    w._cc_wired = true;
                    wired++;
                }
                return wired === 3;
            };
            if (!wireWidgets()) {
                setTimeout(wireWidgets, 50);
                setTimeout(wireWidgets, 250);
                setTimeout(wireWidgets, 1000);
            }

            return r;
        };
    },
});
