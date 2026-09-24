/**
 * history.js — Global undo/redo and snapshot system.
 */

import {
    P, preDelta, postDelta, extraThickenThinMask, persistableP
} from './state.js';
import { markDirty } from './dirty.js';
import { TOOLING_DEFAULTS } from '../editor/layers.js';

const GLOBAL_MAX_HISTORY = 40; // Increased capacity for complex sculpting
export const globalHistoryLog = [];
export const globalRedoLog = [];

// SE5c: the editor._layers fields a snapshot captures/restores — TOOLING
// only, never content. Reuses TOOLING_DEFAULTS' own key list (editor/
// layers.js) instead of re-listing depth/profile/angle/etc. here, so a
// field added there is captured here for free; `visible` is added
// separately since that file special-cases it (never defaulted through
// TOOLING_DEFAULTS, see its own header comment) but it's still tooling
// a sidebar control can flip.
export const LAYER_TOOLING_FIELDS = Object.keys(TOOLING_DEFAULTS).concat(['visible']);

/**
 * UX-UNDO: every sidebar control's undo scope, declared once — 'global'
 * (the palette's own undo/redo, per the ROADMAP ruling "undo follows
 * where the change was made") or 'none' (no undo step at all). Anything
 * NOT listed here defaults to 'global': the common case needs zero
 * registration, so a new slider is undoable for free the moment it's
 * wired through bind()/the layer-only binders/tweaks-ui — only a
 * genuine visual-only exception (it changes what's DISPLAYED, not the
 * model or anything persisted) needs naming.
 *
 *   showMesh         — iso-curve view toggle (setCurvesVisible); doesn't
 *                       touch the heightfield or any exported data.
 *   thickenWireframe — solid-vs-wireframe PREVIEW render mode only.
 *   showLeaders      — leader-line overlay visibility in the preview.
 */
export const UNDO_SCOPE = {
    showMesh: 'none',
    thickenWireframe: 'none',
    showLeaders: 'none',
};

export function undoScopeOf(id) {
    return UNDO_SCOPE[id] || 'global';
}

// Rapid repeated commits (five quick +/- stepper clicks, each firing its
// own synthetic `change`) must coalesce into ONE undo step, not five —
// declared here as a single shared window so every call site behaves
// the same way without its own ad-hoc debounce.
const UNDO_COALESCE_MS = 400;
let _pendingUndoTimer = null;

// applySnapshot's own restore loop writes every P key back through
// syncUItoParam, which (correctly, per its own comment) dispatches a
// real 'change' event on checkboxes so dependent panels re-sync. That
// same 'change' is exactly what bind() listens on to schedule an undo
// step — so without this guard, every undo/redo would immediately
// schedule ANOTHER snapshot as a side effect of restoring the previous
// one. main/snapshot-manager.js (the only caller) brackets its restore
// loop with setUndoRestoring(true/false); core/ can't reach into main/'s
// AppState.isInitializing (core never imports main/, see the layering
// every other file here respects), so this is its own dedicated flag.
let _isRestoring = false;
export function setUndoRestoring(flag) { _isRestoring = !!flag; }

/**
 * Returns true if the SVG Editor modal is currently visible.
 */
export function isEditorOpen() {
    const modal = document.getElementById('svgEditorModal');
    return modal && modal.style.display !== 'none';
}

/** SE5c: read TOOLING-only fields off the live editor._layers roster, one
 *  plain object per layer keyed by its stable id. Never touches content
 *  (`_mask`, or anything SVG-element-shaped) — LAYER_TOOLING_FIELDS names
 *  exactly the fields that are read, so a field this doesn't know about
 *  can't leak in by accident. `window.svgEditor` may not exist yet (early
 *  init, or a non-browser test environment) — returns [] rather than
 *  throwing, same guard shape as every other `window.svgEditor` reader
 *  in main/stamp/*. */
function captureLayerTooling() {
    const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
    const layers = (editor && Array.isArray(editor._layers)) ? editor._layers : [];
    return layers.map((l) => {
        const picked = { id: l.id };
        for (const f of LAYER_TOOLING_FIELDS) picked[f] = l[f];
        return picked;
    });
}

/** SE5c: the other half of captureLayerTooling — write a captured
 *  tooling set back onto a live layers array, matched by id. A layer
 *  named in `layerTooling` that no longer exists in `layers` (added/
 *  removed since the snapshot was taken) is skipped: layer existence is
 *  drawing structure, not tooling, and out of this mechanism's scope
 *  (the UX-UNDO ruling only extends takeSnapshot/applySnapshot to
 *  TOOLING). Exported standalone (not inlined into applySnapshot) so
 *  the restore half is testable without the rest of that function's
 *  heavy rebuild/remask pipeline. */
export function restoreLayerTooling(layers, layerTooling) {
    if (!Array.isArray(layers) || !Array.isArray(layerTooling)) return;
    for (const saved of layerTooling) {
        const layer = layers.find((l) => l && l.id === saved.id);
        if (!layer) continue;
        for (const f of LAYER_TOOLING_FIELDS) {
            if (saved[f] !== undefined) layer[f] = saved[f];
        }
    }
}

/**
 * Captures a complete system snapshot.
 */
export function takeSnapshot(label = "Action") {
    // Capture state into a single object
    const snapshot = {
        label: label,
        P: JSON.parse(JSON.stringify(persistableP())), // Deep copy parameters
        preDelta: preDelta ? new Float32Array(preDelta) : null,
        postDelta: postDelta ? new Float32Array(postDelta) : null,
        extraThickenThinMask: extraThickenThinMask ? new Float32Array(extraThickenThinMask) : null,
        layerConfigs: JSON.parse(JSON.stringify(persistableP().stampLayers)),
        activeLayerIdx: P.activeLayerIdx,
        layerTooling: captureLayerTooling(), // SE5c
    };

    globalHistoryLog.push(snapshot);
    globalRedoLog.length = 0; // New action clears redo path
    if (globalHistoryLog.length > GLOBAL_MAX_HISTORY) globalHistoryLog.shift();
    if (label !== "Initial") markDirty();
    updateGlobalButtons();
}

/**
 * UX-UNDO: commit-time hook for every sidebar control binder (ui-utils'
 * bind()/syncPair, the per-layer-only binders in main/stamp/_dom-
 * binders.js, tweaks-ui). Called on `change` — release/blur/select
 * commit, never on `input` — so the live-drag tick still only writes
 * the value; no snapshot until the value settles. Gated on undoScopeOf
 * (a 'none' control, e.g. a pure view toggle, never reaches history at
 * all) and on isEditorOpen (the sidebar has no business firing while the
 * SVG editor modal owns the interaction — belt-and-suspenders, since the
 * two control sets are already disjoint DOM). Rapid repeated commits
 * (five quick +/- stepper clicks each firing their own synthetic
 * `change`) coalesce into ONE step: every call here resets the same
 * shared timer, so only the LAST commit in a burst actually snapshots —
 * capturing whichever value the burst finally settled on.
 */
export function scheduleUndoSnapshot(id, label) {
    if (_isRestoring) return;
    if (undoScopeOf(id) !== 'global') return;
    if (isEditorOpen()) return;
    if (_pendingUndoTimer) clearTimeout(_pendingUndoTimer);
    _pendingUndoTimer = setTimeout(() => {
        _pendingUndoTimer = null;
        takeSnapshot(label || id || 'Change');
    }, UNDO_COALESCE_MS);
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
        // Must clear the native `disabled` attribute (shipped in the HTML),
        // not just a CSS class — otherwise the button stays non-interactive
        // and click handlers never fire. This is why undo/redo appeared dead
        // in Fusion, where the host captures Ctrl+Z so the buttons are the
        // only undo path.
        uBtn.disabled = !canUndo;
        uBtn.classList.toggle('disabled', !canUndo);
        uBtn.style.opacity = canUndo ? '1' : '0.4';
    }
    if (rBtn) {
        const canRedo = globalRedoLog.length > 0;
        rBtn.disabled = !canRedo;
        rBtn.classList.toggle('disabled', !canRedo);
        rBtn.style.opacity = canRedo ? '1' : '0.4';
    }
}
