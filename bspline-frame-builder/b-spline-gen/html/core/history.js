/**
 * history.js — Global undo/redo and snapshot system.
 */

import {
    P, preDelta, postDelta, extraThickenThinMask, persistableP
} from './state.js';
import { markDirty } from './dirty.js';
import { getFrameRecord } from './frame-record.js';
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
/** Tooling fields with NO entry in TOOLING_DEFAULTS: absent on a layer = their default (a saved roster is never back-filled
 *  with them, AGENTS.md rule 3). Fred 2026-11-23: 'placement' (core/stamp/placement.js, absent = 'withSurface'). A restore
 *  of a snapshot taken while one was absent removes it again. */
export const OPTIONAL_LAYER_TOOLING_FIELDS = Object.freeze(['placement']);
export const LAYER_TOOLING_FIELDS = Object.keys(TOOLING_DEFAULTS).concat(['visible'], OPTIONAL_LAYER_TOOLING_FIELDS);

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
/** true while applySnapshot restores P (a project load, a global undo): read by core/in-editor-3d.js's 'restoring' rows */
export function isRestoring() { return _isRestoring; }

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
            else if (OPTIONAL_LAYER_TOOLING_FIELDS.includes(f)) delete layer[f];
        }
    }
}

/**
 * Captures a complete system snapshot.
 */
/** Items 69 / 71: what a global step may RESTORE beyond P -- the keys a global undo otherwise never puts back
 *  (UNDO_KEEPS below: the frame and the drawing have their own undo). A step declares its own transition
 *  of them, `extra.restore = { frame: { before, after }, editorSvg: { before, after } }`, and only that step's undo /
 *  redo applies it (a sidebar frame edit, frame-panel.js editFrameNow; a sidebar board change, recordBoardStep).
 *  `read` = the live value; `afterAt` = when the step's `after` is read: 'step' right after the change (a synchronous
 *  write), 'undo' when the step is undone (an async result). */
export const UNDO_STEP_RESTORES = Object.freeze({
    frame: { read: () => JSON.parse(JSON.stringify(getFrameRecord())), afterAt: 'step' }, // setFrameRecord writes now
    editorSvg: { read: () => P.editorSvg, afterAt: 'undo' }, // the drawing a board change produced (the re-lay is async)
});
const _restoreSide = (restore, side) => (restore ? Object.fromEntries(Object.entries(restore).map(([k, t]) => [k, t[side]])) : undefined);

// ── the undo MESH STORE (STL-RELIEF, Fred 2026-11-22: "undo should store the instruction, not the model") ─────────────
// Measured before: every snapshot deep-copied every STL mesh string (~0.5 MB at 50k triangles), even a step that only moved an
// STL. Now a snapshot holds `{ ref: h }` in place of each P.stlLayers[i].mesh that has a content hash `h`
// (core/stl/mesh.js encodeMesh), and the mesh object itself is kept ONCE here, h -> mesh. Mesh objects are never written
// (main/stl-panel.js is copy-on-write: a change is a NEW mesh object with a new h), so the store hands the restore the SAME
// objects. The live P is never changed; saved files / sessions / cloud saves go through persistableP and never see a ref.
// A mesh without `h` (an old record) stays inline, as before. An `h` that names DIFFERENT text (the collision-prone hash of
// records saved before the hash fix) stays inline too, never swapped for the other mesh. Entries no snapshot references any
// more are dropped whenever the history drops snapshots (_pruneMeshStore).
// HEIGHT-PAINTER: the same store for a height patch's raster (P.heightLayers[i].raster, core/height/raster.js) -- the
// stored blobs are DECLARED here, one entry each (the P list, the record field holding the blob, how to recognise a stored
// one, when two with the same h are the same content), each with its own h -> blob map; one mechanism reads them all.
// HEIGHT-PAINTER slice 2: `inner` = a list INSIDE each record whose items hold the same field (a layered height patch's
// `layers[i].raster`, core/height/compose.js); its blobs go through the same store, the same way.
const _isStoredMesh = (m) => !!(m && typeof m === 'object' && typeof m.h === 'string' && m.h && typeof m.pos === 'string' && typeof m.idx === 'string');
const _isStoredRaster = (m) => !!(m && typeof m === 'object' && typeof m.h === 'string' && m.h && typeof m.data === 'string' && typeof m.enc === 'string');
export const UNDO_BLOB_STORES = Object.freeze([
    Object.freeze({ list: 'stlLayers', field: 'mesh', isStored: _isStoredMesh,
        same: (a, b) => a.pos === b.pos && a.idx === b.idx && a.nv === b.nv && a.nt === b.nt }),
    Object.freeze({ list: 'heightLayers', field: 'raster', inner: 'layers', isStored: _isStoredRaster,
        same: (a, b) => a.data === b.data && a.enc === b.enc && a.cols === b.cols && a.rows === b.rows }),
]);
const _blobMaps = new Map(UNDO_BLOB_STORES.map((s) => [s.list, new Map()]));
const _isBlobRef = (s, m) => !!(m && typeof m === 'object' && typeof m.ref === 'string' && !s.isStored(m) && !('pos' in m) && !('data' in m));
/** `rec` with each blob slot of store `s` (rec[field], and rec[inner][i][field]) through `fn`; the SAME object when none changed. */
function _mapBlobs(s, rec, fn) {
    if (!rec || typeof rec !== 'object') return rec;
    let out = rec;
    if (rec[s.field] !== undefined) { const n = fn(rec[s.field]); if (n !== rec[s.field]) out = { ...out, [s.field]: n }; }
    if (s.inner && Array.isArray(rec[s.inner])) {
        let changed = false;
        const items = rec[s.inner].map((it) => {
            if (!it || typeof it !== 'object' || it[s.field] === undefined) return it;
            const n = fn(it[s.field]);
            if (n === it[s.field]) return it;
            changed = true;
            return { ...it, [s.field]: n };
        });
        if (changed) out = { ...out, [s.inner]: items };
    }
    return out;
}
/** Each blob slot's value of store `s` in `rec` (read only). */
function _eachBlob(s, rec, visit) { _mapBlobs(s, rec, (b) => { visit(b); return b; }); }
/** `blob` kept once under its h; false when the store holds DIFFERENT content under that h (then it stays inline). */
function _keepBlob(s, blob) {
    const map = _blobMaps.get(s.list);
    const had = map.get(blob.h);
    if (had === undefined) { map.set(blob.h, blob); return true; }
    return had === blob || s.same(had, blob);
}
/** A snapshot's deep copy of persistableP() with each stored blob as `{ ref: h }`. */
function _snapshotP() {
    const p = persistableP();
    const swapped = {};
    for (const s of UNDO_BLOB_STORES) {
        const recs = p[s.list];
        if (!Array.isArray(recs)) continue;
        let any = false;
        const next = recs.map((l) => { const n = _mapBlobs(s, l, (b) => (s.isStored(b) && _keepBlob(s, b) ? { ref: b.h } : b)); if (n !== l) any = true; return n; });
        if (any) swapped[s.list] = next;
    }
    return JSON.parse(JSON.stringify(Object.keys(swapped).length ? { ...p, ...swapped } : p));
}
/** The snapshot as the restore must see it: every `{ ref }` back to its stored blob object (the snapshot itself is untouched). */
function _rehydrated(snap) {
    if (!snap || !snap.P) return snap;
    const back = {};
    for (const s of UNDO_BLOB_STORES) {
        const recs = snap.P[s.list];
        if (!Array.isArray(recs)) continue;
        const map = _blobMaps.get(s.list);
        let any = false;
        const next = recs.map((l) => { const n = _mapBlobs(s, l, (b) => (_isBlobRef(s, b) && map.has(b.ref) ? map.get(b.ref) : b)); if (n !== l) any = true; return n; });
        if (any) back[s.list] = next;
    }
    return Object.keys(back).length ? { ...snap, P: { ...snap.P, ...back } } : snap;
}
/** Drop the blobs no snapshot (undo or redo) references any more. */
function _pruneMeshStore() {
    for (const s of UNDO_BLOB_STORES) {
        const map = _blobMaps.get(s.list);
        if (!map.size) continue;
        const used = new Set();
        for (const snap of [...globalHistoryLog, ...globalRedoLog]) {
            const recs = snap && snap.P && snap.P[s.list];
            if (Array.isArray(recs)) for (const l of recs) _eachBlob(s, l, (b) => { if (_isBlobRef(s, b)) used.add(b.ref); });
        }
        for (const h of [...map.keys()]) if (!used.has(h)) map.delete(h);
    }
}
/** How many blobs the undo store of P list `list` holds (tests / diagnostics). */
export function historyBlobStoreSize(list) { return _blobMaps.get(list)?.size ?? 0; }
/** How many STL meshes the undo store holds (tests / diagnostics). */
export function historyMeshStoreSize() { return historyBlobStoreSize('stlLayers'); }

export function takeSnapshot(label = "Action", extra = {}) {
    // Capture state into a single object
    const snapshot = {
        label: label,
        P: _snapshotP(), // Deep copy parameters (each STL mesh by reference to the mesh store)
        preDelta: preDelta ? new Float32Array(preDelta) : null,
        postDelta: postDelta ? new Float32Array(postDelta) : null,
        extraThickenThinMask: extraThickenThinMask ? new Float32Array(extraThickenThinMask) : null,
        layerConfigs: JSON.parse(JSON.stringify(persistableP().stampLayers)),
        activeLayerIdx: P.activeLayerIdx,
        layerTooling: captureLayerTooling(), // SE5c
        ...(extra.restore ? { restore: JSON.parse(JSON.stringify(extra.restore)) } : {}),
    };

    globalHistoryLog.push(snapshot);
    globalRedoLog.length = 0; // New action clears redo path
    if (globalHistoryLog.length > GLOBAL_MAX_HISTORY) globalHistoryLog.shift();
    _pruneMeshStore();
    if (label !== "Initial") markDirty();
    updateGlobalButtons();
}

/** Item 69 (seat E, measured: the history held only Initial / widthIn / heightIn after a brick lay, so undoing the
 *  next step also reverted brickSettings): before a step that must undo to EXACTLY the current board, record the
 *  current board first when the newest snapshot no longer matches it. */
/** Save audit #1: the P keys a global undo / redo never puts back from an older snapshot -- the drawing and the frame have
 *  their own undo (a step that changes them declares its own transition, UNDO_STEP_RESTORES). Read by the restore
 *  (main/snapshot-manager.js) AND by ensureUndoBaseline: seat D measured (2026-10-10) a frame change + Undo, then the
 *  brick re-lay rewriting editorSvg -- the only difference -- so the next change recorded a baseline whose undo changed
 *  nothing on screen. */
export const UNDO_KEEPS = Object.freeze(['editorSvg', 'frame']);
// a stored STL mesh / height raster compares by its content hash, never by its text (a snapshot holds `{ ref: h }`, the
// live P the blob)
const _undoComparable = (p) => JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !UNDO_KEEPS.includes(k))),
    (k, v) => (UNDO_BLOB_STORES.some((s) => s.isStored(v)) ? { ref: v.h } : v));

export function ensureUndoBaseline(label = 'Before change') {
    const top = globalHistoryLog[globalHistoryLog.length - 1];
    if (top && _undoComparable(top.P) === _undoComparable(persistableP())) return false;
    takeSnapshot(label);
    return true;
}

/** Item 71 (seat E, measured: a sidebar Brick quick pick took no step -- the main screen's Undo then undid the older
 *  Apply step, put back pre-lay brick settings and left the laid bricks + 3D as picked): THE way a sidebar change that
 *  re-lays the board becomes ONE global step -- the board before it as the baseline, the drawing before it as the
 *  step's own restore. Inside the editor the editor's own undo owns the change (no global step). */
export function recordBoardStep(label, change) {
    return recordStep(label, ['editorSvg'], change);
}

/** Fred ("changing wood frame doesn't make an undo step"; seat D measured: 0 / 8 sidebar frame edits came back on the
 *  main Undo): THE way a sidebar change becomes ONE global step -- the board before it as the baseline, plus the
 *  UNDO_STEP_RESTORES keys it changes (`restores`) as the step's own transition. Inside the editor the editor's own
 *  undo owns the change (no global step). */
export function recordStep(label, restores, change) {
    if (_isRestoring || isEditorOpen()) return change();
    ensureUndoBaseline('Before ' + label);
    const restore = Object.fromEntries(restores.map((k) => [k, { before: UNDO_STEP_RESTORES[k].read() }]));
    const out = change();
    for (const k of restores) if (UNDO_STEP_RESTORES[k].afterAt === 'step') restore[k].after = UNDO_STEP_RESTORES[k].read();
    takeSnapshot(label, { restore });
    return out;
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

/** Seat D measured (main, 2026-10-10: a fresh 7 in board, load an 8 in project, width 8.5, Undo -> 7 -- the board BEFORE
 *  the load, with the loaded frame and drawing kept: a mix of two projects): a load never touched the history. THE load
 *  path's own history step (snapshot-manager.js applySnapshot, source 'load': a project load, New project): the
 *  history starts over at the loaded board -- one baseline, no redo, no pending step -- so an undo never crosses a load. */
export function startHistoryAt(label) {
    if (_pendingUndoTimer) { clearTimeout(_pendingUndoTimer); _pendingUndoTimer = null; }
    globalHistoryLog.length = 0;
    globalRedoLog.length = 0;
    takeSnapshot(label);
}

/**
 * Routes the global undo request.
 */
export function unifiedUndo(applySnapshot) {
    if (isEditorOpen()) return;
    if (_pendingUndoTimer) { clearTimeout(_pendingUndoTimer); _pendingUndoTimer = null; }
    if (globalHistoryLog.length <= 1) return;

    const current = globalHistoryLog.pop();
    globalRedoLog.push(current);
    const previous = globalHistoryLog[globalHistoryLog.length - 1];
    if (current.restore) {
        for (const [k, t] of Object.entries(current.restore)) if (t.after === undefined) t.after = UNDO_STEP_RESTORES[k].read();
    }
    applySnapshot(_rehydrated(previous), _restoreSide(current.restore, 'before')); // items 69 / 71: the undone step's own restores
    updateGlobalButtons();
}

/**
 * Routes the global redo request.
 */
export function unifiedRedo(applySnapshot) {
    if (isEditorOpen()) return;
    if (_pendingUndoTimer) { clearTimeout(_pendingUndoTimer); _pendingUndoTimer = null; }
    if (globalRedoLog.length === 0) return;

    const snap = globalRedoLog.pop();
    globalHistoryLog.push(snap);
    applySnapshot(_rehydrated(snap), _restoreSide(snap.restore, 'after')); // items 69 / 71: the redone step's own restores
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
