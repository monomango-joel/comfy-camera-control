/**
 * ComfyUI Camera Control — node widget
 *
 * Registers the "CameraControlLoad3D" node with:
 *  - An iframe that shows the Three.js 3D viewer (viewer.html)
 *  - Bidirectional camera sync:
 *      interactive drag → updates hidden widget state → flows as node outputs
 *      API-supplied azimuth/elevation/distance inputs → posted into the iframe
 */

import { app } from "../../../scripts/app.js";

const NODE_NAME = "CameraControlLoad3D";

// Detect extension folder from import URL (handles any install name).
const EXTENSION_FOLDER = (() => {
    const url = import.meta.url;
    const m = url.match(/\/extensions\/([^/]+)\//);
    return m ? m[1] : "comfy-camera-control";
})();

const VIEWER_URL = () =>
    `/extensions/${EXTENSION_FOLDER}/viewer.html?v=${Date.now()}`;

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

            iframe.addEventListener("load", () => {
                iframeReady = true;
                if (pendingMsg) {
                    iframe.contentWindow?.postMessage(pendingMsg, "*");
                    pendingMsg = null;
                }
            });

            function sendToViewer(msg) {
                if (iframeReady && iframe.contentWindow) {
                    iframe.contentWindow.postMessage(msg, "*");
                } else {
                    pendingMsg = msg;
                }
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

            // ── Hidden state widget ───────────────────────────────────────────
            // Stores the live camera pose so it round-trips as a node input.
            // We look it up by name to avoid index fragility.
            function getCameraStateWidget() {
                return node.widgets?.find(w => w.name === "camera_widget_state");
            }

            // ── Read current API input values ────────────────────────────────
            // Returns {azimuth, elevation, distance} from the named widgets if
            // they exist and are connected, otherwise returns null per field.
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

            // ── Messages from iframe → update state widget ────────────────────
            window.addEventListener("message", event => {
                const msg = event.data;
                if (!msg || !msg.type) return;

                // Only handle messages from our own viewer iframe.
                if (event.source !== iframe.contentWindow) return;

                if (msg.type === "CAMERA_CHANGED") {
                    // Interactive camera drag — store pose in hidden widget.
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
                    // Forward screenshot to ComfyUI upload endpoint.
                    uploadScreenshot(msg.image).catch(console.error);
                }
            });

            // ── Screenshot upload ─────────────────────────────────────────────
            async function uploadScreenshot(dataUrl) {
                const base64 = dataUrl.split(",")[1];
                const bytes  = atob(base64);
                const buf    = new Uint8Array(bytes.length);
                for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
                const blob = new Blob([buf], { type: "image/png" });

                const ts       = new Date().toISOString().replace(/[:.]/g, "-");
                const filename = `camera-control-${ts}.png`;
                const fd       = new FormData();
                fd.append("image", blob, filename);
                fd.append("type", "output");
                fd.append("subfolder", "");

                await fetch("/upload/image", { method: "POST", body: fd });
            }

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

                // Build camera pose: explicit API inputs > server-returned params.
                const overrides = getInputOverrides();
                const cp = cameraParams || {};
                const camPose = {
                    azimuth:   overrides.azimuth   ?? cp.azimuth   ?? 0,
                    elevation: overrides.elevation ?? cp.elevation ?? 20,
                    distance:  overrides.distance  ?? cp.distance  ?? 5,
                };

                // Any of azimuth/elevation/distance connected = camera is API-driven.
                const locked = (
                    overrides.azimuth   !== null ||
                    overrides.elevation !== null ||
                    overrides.distance  !== null
                );

                sendToViewer({
                    type:    "LOAD_MODEL",
                    filepath,
                    upQuat:  cp.up_quat || getUpAxisQuat(),
                    camera:  camPose,
                    locked,
                    width,
                    height,
                });

                // Resize node to match requested dimensions (keep square-ish).
                const targetW = Math.max(width, DEFAULT_WIDTH);
                node.setSize([targetW, targetW + CONTROLS_HEIGHT + NODE_PADDING + 60]);
            };

            // ── Widget value changes (up_axis, azimuth, etc.) → live update ──
            // Re-send SET_CAMERA / SET_UP_AXIS without reloading.
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
                // Only push if we have real values (widget exists).
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

            // Watch widget changes so live camera updates work during editing.
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
