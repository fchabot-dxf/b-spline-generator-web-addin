/**
 * history.js — Global undo/redo and snapshot system.
 */

import { 
    P, preDelta, postDelta, extraThickenThinMask
} from './state.js';

const GLOBAL_MAX_HISTORY = 40; // Increased capacity for complex sculpting
export const globalHistoryLog = [];
export const globalRedoLog = [];

/**
 * Returns true if the SVG Editor modal is currently visible.
 */
export function isEditorOpen() {
    const modal = document.getElementById('svgEditorModal');
    return modal && modal.style.display !== 'none';
}

/**
 * Captures a complete system snapshot.
 */
export function takeSnapshot(label = "Action", stampSvgText = null) {
    // Capture state into a single object
    const snapshot = {
        label: label,
        P: JSON.parse(JSON.stringify(P)), // Deep copy parameters
        preDelta: preDelta ? new Float32Array(preDelta) : null,
        postDelta: postDelta ? new Float32Array(postDelta) : null,
        extraThickenThinMask: extraThickenThinMask ? new Float32Array(extraThickenThinMask) : null,
        stampSvgText: stampSvgText,
            layerConfigs: JSON.parse(JSON.stringify(P.stampLayers || [])),
        activeLayerIdx: P.activeLayerIdx
    };

    globalHistoryLog.push(snapshot);
    globalRedoLog.length = 0; // New action clears redo path
    if (globalHistoryLog.length > GLOBAL_MAX_HISTORY) globalHistoryLog.shift();
    updateGlobalButtons();
}

/**
 * Routes the global undo request.
 */
export function unifiedUndo(applySnapshot) {
    if (isEditorOpen()) return;
    if (globalHistoryLog.length <= 1) return;

    const current = globalHistoryLog.pop();
    globalRedoLog.push(current);
    const previous = globalHistoryLog[globalHistoryLog.length - 1];
    applySnapshot(previous);
    updateGlobalButtons();
}

/**
 * Routes the global redo request.
 */
export function unifiedRedo(applySnapshot) {
    if (isEditorOpen()) return;
    if (globalRedoLog.length === 0) return;

    const snap = globalRedoLog.pop();
    globalHistoryLog.push(snap);
    applySnapshot(snap);
    updateGlobalButtons();
}

/**
 * Updates the visual state of the global history buttons.
 */
export function updateGlobalButtons() {
    const uBtn = document.getElementById('btnGlobalUndo');
    const rBtn = document.getElementById('btnGlobalRedo');
    if (uBtn) {
        const canUndo = globalHistoryLog.length > 1;
        uBtn.classList.toggle('disabled', !canUndo);
        uBtn.style.opacity = canUndo ? '1' : '0.4';
    }
    if (rBtn) {
        const canRedo = globalRedoLog.length > 0;
        rBtn.classList.toggle('disabled', !canRedo);
        rBtn.style.opacity = canRedo ? '1' : '0.4';
    }
}
