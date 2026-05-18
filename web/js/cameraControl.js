/**
 * ComfyUI Camera Control — node widget
 *
 * Registers the "CameraControlLoad3D" node with:
 *  - An iframe that shows the Three.js 3D viewer (viewer.html)
 *  - Bidirectional camera sync:
 *      interactive drag → updates hidden widget state → flows as node outputs
 *      API-supplied azimuth/elevation/distance inputs → posted into the iframe
 *  - Auto-preview: after each model load the viewer sends a screenshot which is
 *      uploaded as cc3d-preview-{nodeId}.png so Python can return a real IMAGE tensor
 */

import { app } from "../../../scripts/app.js";

const NODE_NAME = "CameraControlLoad3D";

// Detect extension folder from import URL (handles any install name).
const EXTENSION_FOLDER = (() => {
    const url = import.meta.url;
    const m = url.match(/\/extensions\/([^/]+)\//);
    return m ? m[1] : "comfy-camera-control";
})();

const VIEWER_URL       = () => `/extensions/${EXTENSION_FOLDER}/viewer.html?v=${Date.now()}`;
const SPLAT_VIEWER_URL = () => `/extensions/${EXTENSION_FOLDER}/viewer_splat.html?v=${Date.now()}`;
const SPLAT_EXTS = new Set(['ply', 'splat', 'spz']);

function isSplatFile(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    return SPLAT_EXTS.has(ext);
}

// ─── Widget dimensions ───────────────────────────────────────────────────────
const DEFAULT_WIDTH  = 512;
const DEFAULT_HEIGHT = 512;
const CONTROLS_HEIGHT = 38;  // px reserved for the viewer's own controls bar
const NODE_PADDING    = 10;  // extra vertical slack

app.registerExtension({
    name: "comfycameracontrol.load3d",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

            const node = this;

            // ── iframe ────────────────────────────────────────────────────────
            const iframe = document.createElement("iframe");
            iframe.style.cssText = "width:100%;height:100%;border:none;display:block;";
            iframe.src = VIEWER_URL();

            let iframeReady = false;
            let pendingMsg = null;
            let currentViewerType = "mesh"; // "mesh" | "splat"

            iframe.addEventListener("load", () => {
                iframeReady = true;
                if (pendingMsg) {
                    iframe.contentWindow?.postMessage(pendingMsg.msg, "*", pendingMsg.transfer || []);
                    pendingMsg = null;
                }
            });

            function sendToViewer(msg, transfer = []) {
                if (!msg) return;
                if (iframeReady && iframe.contentWindow) {
                    iframe.contentWindow.postMessage(msg, "*", transfer);
                } else {
                    pendingMsg = { msg, transfer };
                }
            }

            function switchViewer(type, msg, transfer = []) {
                if (currentViewerType === type && iframeReady) {
                    sendToViewer(msg, transfer);
                    return;
                }
                currentViewerType = type;
                iframeReady = false;
                pendingMsg = msg ? { msg, transfer } : null;
                iframe.src = type === "splat" ? SPLAT_VIEWER_URL() : VIEWER_URL();
            }

            // ── DOM widget ────────────────────────────────────────────────────
            const widget = node.addDOMWidget(
                "viewer_iframe",
                "CAMERA_VIEWER",
                iframe,
                {
                    getValue() { return ""; },
                    setValue() {},
                    serialize: false,
                }
            );

            // Keep aspect ratio square and fill node width.
            let nodeWidth = DEFAULT_WIDTH;
            widget.computeSize = function (w) {
                nodeWidth = w || DEFAULT_WIDTH;
                return [nodeWidth, nodeWidth + CONTROLS_HEIGHT + NODE_PADDING];
            };

            node.setSize([DEFAULT_WIDTH, DEFAULT_WIDTH + CONTROLS_HEIGHT + NODE_PADDING + 60]);

            // ── Hidden state widgets ──────────────────────────────────────────
            function getCameraStateWidget() {
                return node.widgets?.find(w => w.name === "camera_widget_state");
            }
            function getPreviewImageWidget() {
                return node.widgets?.find(w => w.name === "preview_image");
            }

            // ── Read current API input values ────────────────────────────────
            function getInputOverrides() {
                const azW   = node.widgets?.find(w => w.name === "azimuth");
                const elW   = node.widgets?.find(w => w.name === "elevation");
                const distW = node.widgets?.find(w => w.name === "distance");
                return {
                    azimuth:   azW   ? azW.value   : null,
                    elevation: elW   ? elW.value   : null,
                    distance:  distW ? distW.value : null,
                };
            }

            function getUpAxisQuat() {
                const upW = node.widgets?.find(w => w.name === "up_axis");
                if (!upW) return null;
                const UP_QUATS = {
                    "+Y": [0, 0, 0, 1],
                    "-Y": [0, 0, 1, 0],
                    "+Z": [0.7071068, 0, 0, 0.7071068],
                    "-Z": [-0.7071068, 0, 0, 0.7071068],
                    "+X": [0, 0, -0.7071068, 0.7071068],
                    "-X": [0, 0, 0.7071068, 0.7071068],
                };
                return UP_QUATS[upW.value] || null;
            }

            // ── Screenshot helpers ────────────────────────────────────────────
            async function blobFromDataUrl(dataUrl) {
                const base64 = dataUrl.split(",")[1];
                const bytes  = atob(base64);
                const buf    = new Uint8Array(bytes.length);
                for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
                return new Blob([buf], { type: "image/png" });
            }

            // Upload a screenshot to the output directory (button-triggered).
            async function uploadOutputScreenshot(dataUrl) {
                const blob = await blobFromDataUrl(dataUrl);
                const ts   = new Date().toISOString().replace(/[:.]/g, "-");
                const fd   = new FormData();
                fd.append("image",     blob, `camera-control-${ts}.png`);
                fd.append("type",      "output");
                fd.append("subfolder", "");
                await fetch("/upload/image", { method: "POST", body: fd });
            }

            // Upload a preview screenshot to input so Python can read it back.
            // Returns the server-assigned filename.
            async function uploadPreviewScreenshot(dataUrl) {
                const blob     = await blobFromDataUrl(dataUrl);
                const filename = `cc3d-preview-${node.id}.png`;
                const fd       = new FormData();
                fd.append("image",     blob, filename);
                fd.append("type",      "input");
                fd.append("subfolder", "");
                fd.append("overwrite", "true");
                try {
                    const resp = await fetch("/upload/image", { method: "POST", body: fd });
                    if (!resp.ok) return null;
                    const data = await resp.json();
                    const savedName = data.name || filename;
                    const pw = getPreviewImageWidget();
                    if (pw) pw.value = savedName;
                    return savedName;
                } catch {
                    return null;
                }
            }

            // Take a screenshot from the viewer, then call the given handler.
            // oneShot=true means the SCREENSHOT message is intercepted before
            // the general handler so only one upload happens.
            let screenshotHandler = null;  // null = route to output; fn = intercept

            function takePreviewScreenshot() {
                screenshotHandler = (dataUrl) => {
                    screenshotHandler = null;
                    uploadPreviewScreenshot(dataUrl).catch(console.error);
                };
                sendToViewer({ type: "TAKE_SCREENSHOT" });
            }

            // ── Messages from iframe ──────────────────────────────────────────
            window.addEventListener("message", event => {
                const msg = event.data;
                if (!msg || !msg.type) return;
                if (event.source !== iframe.contentWindow) return;

                if (msg.type === "CAMERA_CHANGED") {
                    const sw = getCameraStateWidget();
                    if (sw) {
                        sw.value = JSON.stringify({
                            azimuth:   msg.azimuth,
                            elevation: msg.elevation,
                            distance:  msg.distance,
                        });
                    }
                }

                if (msg.type === "SCREENSHOT") {
                    if (screenshotHandler) {
                        screenshotHandler(msg.image);
                    } else {
                        // Button-triggered: save to output directory.
                        uploadOutputScreenshot(msg.image).catch(console.error);
                    }
                }

                if (msg.type === "MODEL_LOADED") {
                    // Viewer finished loading — capture a preview for Python.
                    // Small delay so the first frame is rendered.
                    setTimeout(takePreviewScreenshot, 500);
                }

                if (msg.type === "FILE_UPLOADED") {
                    refreshModelDropdown(msg.filename).catch(console.error);
                }

                if (msg.type === "SWITCH_TO_SPLAT_VIEWER") {
                    switchViewer("splat", {
                        type:     "LOAD_MODEL",
                        filepath: msg.filepath,
                        upQuat:   msg.upQuat || null,
                        camera:   null,
                        locked:   false,
                    });
                }
            });

            // ── onExecuted: node ran → push new model + camera into viewer ───
            const onExecuted = node.onExecuted;
            node.onExecuted = function (message) {
                onExecuted?.apply(this, arguments);

                const modelFile    = message?.model_file?.[0];
                const cameraParams = message?.camera_params?.[0];
                const width        = message?.width?.[0]  || DEFAULT_WIDTH;
                const height       = message?.height?.[0] || DEFAULT_HEIGHT;

                if (!modelFile) return;

                const filepath = `/view?filename=${encodeURIComponent(modelFile)}&type=input&subfolder=3d`;

                const overrides = getInputOverrides();
                const cp = cameraParams || {};
                const camPose = {
                    azimuth:   overrides.azimuth   ?? cp.azimuth   ?? 0,
                    elevation: overrides.elevation ?? cp.elevation ?? 20,
                    distance:  overrides.distance  ?? cp.distance  ?? 5,
                };

                const locked = (
                    overrides.azimuth   !== null ||
                    overrides.elevation !== null ||
                    overrides.distance  !== null
                );

                const loadMsg = {
                    type:    "LOAD_MODEL",
                    filepath,
                    upQuat:  cp.up_quat || getUpAxisQuat(),
                    camera:  camPose,
                    locked,
                    width,
                    height,
                };

                const viewerType = isSplatFile(modelFile) ? "splat" : "mesh";

                if (viewerType === "splat") {
                    switchViewer("splat", null);
                    fetch(filepath)
                        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
                        .then(buf => {
                            sendToViewer({
                                type:     "LOAD_MODEL_DATA",
                                data:     buf,
                                filename: modelFile,
                                camera:   loadMsg.camera,
                                locked:   loadMsg.locked,
                            }, [buf]);
                        })
                        .catch(err => console.error("[CameraControl] Failed to fetch splat:", err));
                } else {
                    switchViewer(viewerType, loadMsg);
                }

                const targetW = Math.max(width, DEFAULT_WIDTH);
                node.setSize([targetW, targetW + CONTROLS_HEIGHT + NODE_PADDING + 60]);
            };

            // ── Widget value changes → live camera sync ───────────────────────
            const origConfigure = node.configure;
            node.configure = function (data) {
                origConfigure?.apply(this, arguments);
                scheduleViewerSync();
            };

            let syncTimer = null;
            function scheduleViewerSync() {
                clearTimeout(syncTimer);
                syncTimer = setTimeout(viewerSync, 120);
            }

            function viewerSync() {
                const overrides = getInputOverrides();
                if (overrides.azimuth !== null || overrides.elevation !== null || overrides.distance !== null) {
                    const sw = getCameraStateWidget();
                    let state = {};
                    try { state = sw ? JSON.parse(sw.value || "{}") : {}; } catch {}
                    sendToViewer({
                        type:      "SET_CAMERA",
                        azimuth:   overrides.azimuth   ?? state.azimuth   ?? 0,
                        elevation: overrides.elevation ?? state.elevation ?? 20,
                        distance:  overrides.distance  ?? state.distance  ?? 5,
                        locked:    true,
                    });
                }

                const upQuat = getUpAxisQuat();
                if (upQuat) {
                    sendToViewer({ type: "SET_UP_AXIS", upQuat });
                }
            }

            // ── Dropdown refresh after drag-and-drop upload ───────────────────
            async function refreshModelDropdown(filename) {
                try {
                    const res = await fetch("/object_info/CameraControlLoad3D");
                    if (!res.ok) return;
                    const info = await res.json();
                    const newList = info?.CameraControlLoad3D?.input?.required?.model_file?.[0];
                    if (!Array.isArray(newList)) return;

                    const modelWidget = node.widgets?.find(w => w.name === "model_file");
                    if (!modelWidget) return;

                    modelWidget.options.values = newList;
                    if (newList.includes(filename)) {
                        modelWidget.value = filename;
                    }
                    node.setDirtyCanvas(true, true);
                } catch (err) {
                    console.error("[CameraControl] Failed to refresh dropdown:", err);
                }
            }

            const originalOnWidgetChanged = node.onWidgetChanged;
            node.onWidgetChanged = function (name, value, oldValue, widget) {
                originalOnWidgetChanged?.apply(this, arguments);
                if (["azimuth", "elevation", "distance", "up_axis"].includes(name)) {
                    scheduleViewerSync();
                }
            };

            return r;
        };
    },
});
