/**
 * runtime.js — Fusion ↔ JS bridge.
 *
 * Mirrors step-editor's runtime, kept identical so the two add-ins
 * share the same wire shape and any future shared modules can talk to
 * either bridge without a per-host detour.
 */

'use strict';

/**
 * True when `adsk.fusionSendData` is available — the page is hosted in
 * Fusion's webview rather than a plain browser. Standalone builds /
 * Cloudflare Pages return false and every sendToPython() call no-ops.
 */
export function isFusion() {
  try {
    return typeof adsk !== 'undefined' && !!adsk && typeof adsk.fusionSendData === 'function';
  } catch (_) {
    return false;
  }
}

/** Fire an action over the Fusion bridge. Silently drops in standalone. */
export function sendToPython(action, data) {
  if (!isFusion()) return;
  try {
    adsk.fusionSendData(action, JSON.stringify(data || {}));
  } catch (e) {
    /* Bridge call can throw if the page is mid-reload. Ignore. */
  }
}

/** Send a log line to the Python side. The Python add-in appends it
 *  to stamp_editor_log.txt with a [JS LOG] prefix. */
export function pyLog(msg) {
  sendToPython('log', { msg: String(msg) });
}
