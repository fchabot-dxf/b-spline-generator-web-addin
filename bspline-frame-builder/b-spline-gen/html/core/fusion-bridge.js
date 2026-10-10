
/**
 * fusion-bridge.js — Handles communication with the Fusion 360 Python backend.
 */

import { P, isFusionMode, setIsFusionMode } from './state.js';
import { COORD_SYSTEM } from './coords.js';
import { fusLog } from './fusion-log.js';
import { releaseHeldStage } from './loading-signal.js';
import FUSION_HOST from '../data/fusion-host.js';

export { fusLog } from './fusion-log.js';

let pollInterval = null;

/**
 * Asks Python for the design's widthIn/heightIn parameters (B9). The reply
 * arrives asynchronously via the 'sync_board' handshake — unchanged.
 */
export function requestDesignParams() {
    try {
        adsk.fusionSendData('get_design_params', '{}');
        fusLog('get_design_params sent to Python');
    } catch (e) {
        fusLog(`requestDesignParams FAILED: ${e.message}`);
    }
}

/** The single control that reflects Fusion send/import state: the header 'Send to Fusion' button.
 *  (#btnFusionApply was removed from the HTML on 2026-04-09; this replaces four null-guarded lookups.) */
export const FUSION_IDLE_LABEL = 'Send to Fusion';
export function fusionActionButton() { return document.getElementById('btnDownload'); }
export function setFusionActionState(text, disabled) {
    const b = fusionActionButton(); if (!b) return;
    b.textContent = text; b.disabled = !!disabled;
}

let _statusGen = 0;
/** The one status line for Fusion traffic (UX2). kind: 'info' | 'busy' | 'ok' | 'warn'. Empty text hides it;
 *  'ok' auto-clears after 3 s. */
export function setFusionStatus(text, kind = 'info') {
    const el = document.getElementById('fusion-status');
    if (!el) return;
    const gen = ++_statusGen;
    el.textContent = text;
    el.dataset.kind = kind;
    el.hidden = !text;
    if (kind === 'ok' && text) {
        setTimeout(() => {
            if (_statusGen !== gen) return; // a newer message already replaced this one
            el.textContent = '';
            el.hidden = true;
        }, 3000);
    }
}

/**
 * Sends current 3D mesh data to Fusion's canvas for real-time preview.
 */
export function sendFusionMeshPreview(preview) {
    if (!isFusionMode || !preview) return;
    const data = preview.getMeshData(P.exportOrientation);
    if (!data) return;

    fusLog('[COORD_STD] sendFusionMeshPreview: sending mesh data to Fusion');

    const liveSync = document.getElementById('liveSync');
    if (liveSync && !liveSync.checked) return;

    try {
        adsk.fusionSendData('preview_mesh', JSON.stringify(data));
    } catch (e) {
        fusLog(`sendFusionMeshPreview FAILED: ${e.message}`);
    }
}

/**
 * 2026-10-09 (seat A; Fred's showcase Sends were 5-44 MB of JSON, two full STEP texts, ~170 chunks): the Send's
 * transport, declared once. The add-in announces the encodings it reads ('send_transport', send_transport.py); the
 * palette uses the first of `encodings` both sides know, and declares it in 'generate_start'. 'gzip-b64' = the JSON
 * text gzipped (CompressionStream) and base64'd; the add-in decodes it back to the exact text before json.loads.
 * Plain whenever the add-in did not announce gzip (an older add-in), CompressionStream is missing, or compressing
 * fails -- a Send never fails over its transport.
 */
export const SEND_TRANSPORT = Object.freeze({ version: 1, encodings: Object.freeze(['gzip-b64', 'plain']) });
let _addinEncodings = ['plain']; // until the add-in says otherwise

/** The add-in's 'send_transport' handshake: {version, encodings}. */
export function setAddinSendTransport(info) {
    const enc = info && Array.isArray(info.encodings) ? info.encodings.filter((e) => typeof e === 'string') : [];
    _addinEncodings = enc.length ? enc : ['plain'];
}

/** base64 of bytes, in pieces a multiple of 3 bytes long (so the pieces' base64 concatenates). */
function _base64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3 * 16384) out += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + 3 * 16384)));
    return out;
}

/** The payload as it travels: { encoding, data }. Never throws (plain on any trouble). */
export async function encodeSendPayload(payloadString, addinEncodings = _addinEncodings) {
    const encoding = SEND_TRANSPORT.encodings.find((e) => addinEncodings.includes(e)) || 'plain';
    if (encoding === 'gzip-b64' && typeof CompressionStream === 'function') {
        try {
            const stream = new Blob([payloadString]).stream().pipeThrough(new CompressionStream('gzip'));
            const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
            return { encoding, data: _base64(bytes) };
        } catch (e) {
            fusLog(`[COORD_STD] gzip failed, sending plain: ${e.message}`);
        }
    }
    return { encoding: 'plain', data: payloadString };
}

/**
 * Streams large payloads in 256KB chunks to bypass Fusion-web bridge limits.
 */
export async function sendFusionPayloadChunked(payloadString, { beforeFinish } = {}) {
    const CHUNK_SIZE = 256 * 1024;
    const { encoding, data } = await encodeSendPayload(payloadString);
    const totalChunks = Math.ceil(data.length / CHUNK_SIZE);

    fusLog(`[COORD_STD] sendFusionPayloadChunked: starting chunked send (${payloadString.length} chars as ${encoding}: ${data.length} chars, ${totalChunks} chunks)`);
    try {
        adsk.fusionSendData('generate_start', JSON.stringify({ totalChunks, encoding, version: SEND_TRANSPORT.version }));
        for (let i = 0; i < totalChunks; i++) {
            const chunk = data.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const progress = Math.round(((i + 1) / totalChunks) * 100);
            fusLog(`[COORD_STD] Sending chunk ${i + 1}/${totalChunks} (${progress}%)...`);
            adsk.fusionSendData('generate_chunk', JSON.stringify({ index: i, data: chunk }));
        }
        if (beforeFinish) await beforeFinish(); // item 70: e.g. paint Fusion's first stage before the import starts
        adsk.fusionSendData('generate_finish', '{}');
        fusLog('[COORD_STD] Chunked send finished. Handoff to Python for import.');
    } catch (e) {
        fusLog(`[COORD_STD] sendFusionPayloadChunked FAILED: ${e.message}`);
        throw e;
    }
}

/**
 * Initiates the reliable polling loop for Fusion status updates.
 */
export function startFusionPolling() {
    if (pollInterval) clearInterval(pollInterval);
    let _pollTicks = 0;
    // F35 item 16 follow-up: called from sendToFusion (main/export-flow.js), which -- when Export
    // differs from Display -- has ALREADY swapped P.spacing to P.exportSpacing for the duration of
    // the Send (see export-flow.js's own withExportResolution); P.spacing here is already the
    // EFFECTIVE value this particular build is running at, not necessarily Display's own setting.
    const timeoutTicks = (P.spacing <= 0.05) ? 300 : 90;

    pollInterval = setInterval(() => {
        _pollTicks++;
        if (_pollTicks >= timeoutTicks) {
            fusLog(`Poll timeout (${timeoutTicks * 5}s): bridge never confirmed. Stopping poll — palette left open.`);
            clearInterval(pollInterval); pollInterval = null;
            // Do NOT send 'ok' here — that would hide the palette unexpectedly.
            // Just re-enable the button so the user knows the wait is over.
            setFusionActionState(FUSION_IDLE_LABEL, false);
            releaseHeldStage(); // item 70
            setFusionStatus('Fusion did not confirm the import — check the Fusion log', 'warn');
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

/** H23 item 92: true when the add-in declared this page as its Fusion palette (?host=fusion, html/data/fusion-host.js). */
export function declaredFusionHost() {
    const search = typeof location !== 'undefined' ? location.search : '';
    return new URLSearchParams(search).get(FUSION_HOST.param) === FUSION_HOST.value;
}

/**
 * Detects if running inside Fusion 360 or in a standard browser.
 * H23 item 92: Fusion can inject `adsk` seconds after the page starts (measured ~3 s on a palette restoring a brick
 * wall -- the old fixed 300 ms opened it as the website, with no Send button). A page the add-in declared as its
 * palette waits for adsk up to FUSION_HOST.modeDetectTimeoutMs, deciding the moment it appears; any other page (the
 * website, an older add-in) decides after webGraceMs, so a browser session never waits on Fusion.
 */
export function pollMode(onFusionReady, onWebMode) {
    const waitMs = declaredFusionHost() ? FUSION_HOST.modeDetectTimeoutMs : FUSION_HOST.webGraceMs;
    const t0 = Date.now();
    const check = () => {
        if (typeof adsk !== 'undefined' && adsk.fusionSendData) {
            setIsFusionMode(true);
            // how close a late adsk came to modeDetectTimeoutMs -- the margin the declared timeout must keep
            fusLog(`[MODE] Fusion host: adsk after ${Date.now() - t0} ms (waits up to ${waitMs} ms)`);
            onFusionReady();
        } else if (Date.now() - t0 < waitMs) {
            setTimeout(check, FUSION_HOST.pollMs);
        } else {
            setIsFusionMode(false);
            onWebMode();
        }
    };
    check();
}
