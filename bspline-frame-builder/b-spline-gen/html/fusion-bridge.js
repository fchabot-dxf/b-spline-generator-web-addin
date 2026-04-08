/**
 * fusion-bridge.js — Handles communication with the Fusion 360 Python backend.
 */

import { P, isFusionMode, setIsFusionMode } from './state.js';

let pollInterval = null;

/**
 * Diagnostic logging bridge to fusion_hybrid_log.txt.
 */
export function fusLog(msg) {
    try { adsk.fusionSendData('log', JSON.stringify({ msg: String(msg) })); } catch (_) { }
}

/**
 * Sends current 3D mesh data to Fusion's canvas for real-time preview.
 */
export function sendFusionMeshPreview(preview) {
    if (!isFusionMode || !preview) return;
    const data = preview.getMeshData(P.exportOrientation);
    if (!data) return;

    const liveSync = document.getElementById('liveSync');
    if (liveSync && !liveSync.checked) return;

    try {
        adsk.fusionSendData('preview_mesh', JSON.stringify(data));
    } catch (e) {
        fusLog(`sendFusionMeshPreview FAILED: ${e.message}`);
    }
}

/**
 * Sends the final high-fidelity preview before export.
 */
export function sendFusionPreview(preview) {
    if (!isFusionMode || !preview) return;
    const data = preview.getMeshData(P.exportOrientation);
    if (!data) return;
    try {
        adsk.fusionSendData('preview', JSON.stringify(data));
    } catch (e) {
        fusLog(`sendFusionPreview FAILED: ${e.message}`);
    }
}

/**
 * Streams large payloads in 256KB chunks to bypass Fusion-web bridge limits.
 */
export async function sendFusionPayloadChunked(payloadString) {
    const CHUNK_SIZE = 256 * 1024;
    const totalChunks = Math.ceil(payloadString.length / CHUNK_SIZE);

    fusLog(`Starting chunked send: ${payloadString.length} chars, ${totalChunks} chunks`);
    try {
        adsk.fusionSendData('generate_start', JSON.stringify({ totalChunks }));
        for (let i = 0; i < totalChunks; i++) {
            const chunk = payloadString.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const progress = Math.round(((i + 1) / totalChunks) * 100);
            fusLog(`Sending chunk ${i + 1}/${totalChunks} (${progress}%)...`);
            adsk.fusionSendData('generate_chunk', JSON.stringify({ index: i, data: chunk }));
        }
        adsk.fusionSendData('generate_finish', '{}');
        fusLog('Chunked send finished. Handoff to Python for import.');
    } catch (e) {
        fusLog(`Chunked send FAILED: ${e.message}`);
        throw e;
    }
}

/**
 * Initiates the reliable polling loop for Fusion status updates.
 */
export function startFusionPolling(btnApply) {
    if (pollInterval) clearInterval(pollInterval);
    let _pollTicks = 0;
    const timeoutTicks = (P.spacing <= 0.05) ? 300 : 90;

    pollInterval = setInterval(() => {
        _pollTicks++;
        if (_pollTicks >= timeoutTicks) {
            fusLog(`Poll timeout (${timeoutTicks * 2}s): bridge never confirmed. Stopping poll — palette left open.`);
            clearInterval(pollInterval); pollInterval = null;
            // Do NOT send 'ok' here — that would hide the palette unexpectedly.
            // Just re-enable the button so the user knows the wait is over.
            if (btnApply) { btnApply.disabled = false; btnApply.textContent = 'Apply to Fusion'; }
            return;
        }

        try {
            if (_pollTicks % 2 === 0) fusLog(`Still waiting for Fusion... (poll #${_pollTicks})`);
            adsk.fusionSendData('check_import_status', '{}');
        } catch (e) { fusLog(`Polling check failed: ${e.message}`); }
    }, 5000);
    return pollInterval;
}

export function stopFusionPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

/**
 * Detects if running inside Fusion 360 or in a standard browser.
 */
export function pollMode(onFusionReady, onWebMode) {
    // FIX: was 30 × 100 ms = 3 s blank delay in every browser session.
    // Fusion injects `adsk` before the page parses, so 3 checks (300 ms) is ample.
    let modeChecks = 0;
    const MAX_MODE_CHECKS = 3;
    const check = () => {
        if (typeof adsk !== 'undefined' && adsk.fusionSendData) {
            setIsFusionMode(true);
            onFusionReady();
        } else if (modeChecks < MAX_MODE_CHECKS) {
            modeChecks++;
            setTimeout(check, 100);
        } else {
            setIsFusionMode(false);
            onWebMode();
        }
    };
    check();
}
