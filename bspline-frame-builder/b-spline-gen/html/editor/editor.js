/**
 * editor.js - SVG.js Vector Stamp Editor (Phase 3)
 * Refactored into a modular ES6 architecture.
 */

import { initIO, save, saveWithTextCopies, saveForRasterization, open, sync3DBackground, getPointerPos } from './editor-io.js';
import { commitText, cancelText } from './editor-text-session.js';
import { initText, setFontFamily, setFontSize } from './editor-text-style.js';
import { fitCurve, getHybridBezierPath } from './editor-curves.js';
import { getDynamicTolerance, getNodes, getNearbyElement } from './editor-hit.js';
import { initInteraction, updateHandles } from './editor-interaction.js';
import { resetTransform, flattenTransform } from './editor-transform-handles.js';
import { setMode, updateToolbarVisibility, updateSelectionHighlight, setHover, select, selectAdd, selectMany, updateHistoryButtons } from './editor-ui.js';
import { setupEditorToolbar } from './editor-controls.js';
import { initLayerControls, setActiveLayer, applyLayerState, renderLayersPanel } from './layers.js';
import { createEditorCanvas } from './init.js';
import { fitView as _fitView } from './editor-view.js';
import { snapFor, applyGrid, loadGridPrefs, saveGridPrefs } from './editor-grid.js';
import { LATTICE_DEFAULTS } from './editor-lattice.js';
import { dbg } from './debug.js';
import { fusLog } from '../core/fusion-bridge.js';

/** UNDO diagnostic helper. After fixing the spurious handleEnd pushes
 *  (task 16), kept fusLog-only so the Fusion log file still carries the
 *  trace if regressions appear, but console output is quieted. Flip
 *  window.__editorDebug = 'UNDO' to re-enable the console branch via dbg. */
function _undoLog(msg) {
    dbg('UNDO', msg);
    try { fusLog(`[UNDO] ${msg}`); } catch (_) {}
}

/** Pull the calling function name out of a fresh stack trace so the
 *  UNDO log can attribute each pushState to who fired it. Best-effort —
 *  returns '?' if the runtime obscures the stack (e.g. some bundlers). */
function _shortCaller() {
    try {
        const stack = new Error().stack || '';
        const lines = stack.split('\n').slice(2, 6); // skip _shortCaller + pushState frames
        for (const line of lines) {
            // Match "at <fnName>" or "<fnName>@" — works for V8 + WebKit.
            const m = line.match(/at\s+([\w$.<>]+)\s/) || line.match(/^\s*([\w$.<>]+)@/);
            if (m && m[1] && m[1] !== 'Object' && !m[1].endsWith('.pushState')) {
                return m[1];
            }
        }
        return lines[0]?.trim().slice(0, 60) || '?';
    } catch {
        return '?';
    }
}

export class VectorEditor {
    constructor() {
        this._draw = null;
        this._bgLayer = null;
        this._gridLayer = null;
        this._sketchLayer = null;
        this._handleLayer = null;
        this._highlightLayer = null;

        this._mW = 7;
        this._mH = 9;
        // SE2: the one view record — zoom 1 = the whole board, cx/cy is
        // the model-space center. See editor-view.js for the derivation
        // into an SVG viewBox and the zoom/pan math.
        this._view = { zoom: 1, cx: this._mW / 2, cy: this._mH / 2 };
        // SE6: the one grid record — see editor-grid.js for the pure
        // snap/draw derivations. Loaded here (not initEditor) since it's
        // plain per-viewer prefs with no DOM/layer dependency.
        this._grid = loadGridPrefs();
        // SE7a: the lattice tool's own settings (not persisted — a fresh
        // session starts with auto-nodes on, matching LATTICE_DEFAULTS).
        this._lattice = { ...LATTICE_DEFAULTS };
        // SE8b: the pending rAF id for _notifyChange('live')'s throttle —
        // null when no frame is currently scheduled.
        this._pendingChangeFrame = null;
        this._spaceHeld = false;
        this._isPanning = false;
        this._panStart = null;
        this._currentMode = 'draw';
        this._strokeWidth = 0.5;
        // SE9 (Fred amend): stroke and fill are ALWAYS the same color for a
        // given element — one field, not a _strokeColor/_fillColor pair.
        // New shapes use it for both; FILL/STROKE/BOTH below only decides
        // whether fill is 'none', never a second, independent color.
        this._color = '#000000';
        // Step 27: fill mode for new shapes. 'stroke' = outline only (legacy
        // behavior, default), 'fill' = solid interior, 'both' = outline +
        // interior. Pen-anchor paths auto-close with Z when fill is active.
        this._fillMode = 'stroke';
        this._fontFamily = "Arial";
        this._fontSize = 3.0;
        this._expandDetail = 1.0;
        this._expandSimplify = 15;
        this._expandAccuracy = 1.0;
        this._isRefreshingExpand = false;
        this._pendingExpandRefresh = false;
        this._expandRefreshTimer = null;

        // Multi-selection is the source of truth. _selectedElement is
        // a getter/setter alias (primary = LAST clicked, matching the
        // 'last clicked wins' UX). All legacy `editor._selectedElement = X`
        // writes funnel through the setter and replace the selection;
        // multi-aware code uses editor._selectAdd / editor._selectMany.
        this._selectedElements = [];
        this._hoveredElement = null;
        this._isDrawing = false;
        this._currentPath = null;
        this._points = [];
        this._undoStack = [];
        this._redoStack = [];
        this._maxUndo = 30;
        
        this._dragNodeIndex = -1;
        this._hoverNodeIndex = -1;
        this._isClickMode = false;
        this._dragDist = 0;
        this._activeLayer = '0';

        // Transform handles state: records produced by renderTransform-
        // Handles each updateHandles cycle, and per-drag capture on grab.
        this._transformHandles = [];
        this._transformState = null;
    }

    /** Primary selection — the most-recently clicked element. Legacy
     *  reads of editor._selectedElement keep working via this getter. */
    get _selectedElement() {
        const arr = this._selectedElements;
        return (arr && arr.length) ? arr[arr.length - 1] : null;
    }
    /** Setter is the 'replace selection' path used by every legacy
     *  call site. Multi-aware code should call _selectAdd / _selectMany. */
    set _selectedElement(el) {
        if (el === null || el === undefined) this._selectedElements = [];
        else this._selectedElements = [el];
    }

    initEditor(containerId, backgroundCanvasId, onChange, onCommit, onSelect) {
        this._backgroundCanvasId = backgroundCanvasId;
        this._onChange = onChange;
        this._onCommit = onCommit;
        this._onSelect = onSelect;

        const canvas = createEditorCanvas(containerId);
        this._draw = canvas.draw;
        this._bgLayer = canvas.bgLayer;
        this._gridLayer = canvas.gridLayer;
        this._sketchLayer = canvas.sketchLayer;
        this._handleLayer = canvas.handleLayer;
        this._highlightLayer = canvas.highlightLayer;

        initIO(this);
        initInteraction(this);
        initText(this);

        this.setModelMetrics(this._mW, this._mH);
        this.setMode(this._currentMode);
        setupEditorToolbar(this);
        initLayerControls(this);
    }


    save(dpi = 96) {
        this._commitText();
        return save(this, dpi); 
    }

    saveWithTextCopies(dpi = 96) {
        this._commitText();
        return saveWithTextCopies(this, dpi);
    }
    /**
     * Async save that embeds @font-face (base64 data: URLs) for every
     * font referenced by a <text>. Use this for the stamp/rasterization
     * pipeline so on-screen and stamped glyphs match on iOS, where the
     * rasterizer is detached from document-level @font-face.
     */
    saveForRasterization(dpi = 96) {
        this._commitText();
        return saveForRasterization(this, dpi);
    }
    open(svgString, w, h) { return open(this, svgString, w, h); }
    sync3DBackground() { return sync3DBackground(this); }
    
    setMode(mode) { return setMode(this, mode); }
    setStrokeWidth(w) {
        this._strokeWidth = w;
        const sel = this._selectedElements;
        if (!sel || !sel.length) return;
        for (const el of sel) el.stroke({ width: w });
        this._updateSelectionHighlight();
        this._commitStyleChange();
    }
    // SE9: sets _color for NEW shapes and recolors the current selection.
    // Stroke is always written (harmless when a mode has it at width:0 —
    // it just stays invisible at the new color); fill is written ONLY when
    // the element currently has a real (non-'none') fill, so a stroke-only
    // shape doesn't suddenly grow a visible interior. Text has no
    // meaningful stroke visually, but gets one anyway for consistency with
    // every other kind, plus its fill (text's color IS its fill).
    setColor(color) {
        this._color = color;
        const sel = this._selectedElements;
        if (!sel || !sel.length) return;
        for (const el of sel) {
            if (!el || typeof el.stroke !== 'function') continue;
            el.stroke({ color });
            if (typeof el.fill !== 'function') continue;
            if (el.type === 'text') {
                el.fill(color);
                continue;
            }
            let currentFill;
            try { currentFill = el.attr('fill'); } catch (_) { currentFill = null; }
            if (currentFill && currentFill !== 'none') el.fill(color);
        }
        this._updateSelectionHighlight();
        this._commitStyleChange();
    }
    // SE8a / SA-UNDO-2: setStrokeWidth had neither pushState() nor
    // _onChange() (permanently un-undoable, and the carve preview never
    // updated until an unrelated edit happened to fire _onChange()).
    // _commitStyleChange exists so a future style setter can't reintroduce
    // that gap by hand-rolling it again — mirrors the pattern
    // setFontFamily/setFontSize (editor-text-style.js) already get right,
    // just not previously factored into one place. (SE8d removed the prior
    // setStrokeColor as dead; SE9 brings color back as setColor above,
    // now driving one _color field shared by stroke and fill.)
    _commitStyleChange() {
        if (typeof this.pushState === 'function') this.pushState();
        if (this._onChange) this._onChange();
    }
    /**
     * SE8b / SA-UNDO-1: the ONE place a drag-continuation path notifies
     * the outside world. `_onChange(kind)` (main/app-init.js's
     * runChangePipeline, SE8b-2) runs a DECLARED subset of
     * saveForRasterization + P.editorSvg write + saveLastSession +
     * refreshAllStampMasks per `kind` (CHANGE_PIPELINE) — 'live' skips
     * the localStorage write (saveLastSession) entirely; only 'commit'
     * persists. Before SE8b, dragNode/translateSelection/applyTransformDrag
     * called the full pipeline straight from every raw mousemove (commonly
     * 15-40+ times per drag, uncoalesced — pushState was already correctly
     * gated to fire once at mouseup by _dragMoved; only _onChange bypassed
     * that gate).
     *
     * 'live' (every drag-continuation call): coalesces to AT MOST ONE
     * call per animation frame — a THROTTLE, not a debounce: an
     * already-pending frame is left alone (ignored) rather than
     * cancelled-and-rescheduled, so a CONTINUOUS drag still gets the
     * pipeline running once every frame instead of being starved until
     * the drag stops (a naive cancel-and-reschedule, the pattern
     * main/skeleton-editor.js already uses elsewhere for a different
     * purpose, would do exactly that here).
     * 'commit' (handleEnd, once per gesture; every other discrete edit
     * already called _onChange directly — those default to 'commit' via
     * the callback's own parameter default, unaffected by this kind
     * threading): cancels any pending 'live' frame and fires the pipeline
     * immediately, so the FINAL position is what gets committed — never a
     * stale queued frame, and never a skipped persist for the gesture's
     * actual final state.
     */
    _notifyChange(kind) {
        if (!this._onChange) return;
        if (kind === 'commit') {
            if (this._pendingChangeFrame != null) {
                cancelAnimationFrame(this._pendingChangeFrame);
                this._pendingChangeFrame = null;
            }
            this._onChange(kind);
            return;
        }
        if (this._pendingChangeFrame != null) return; // already scheduled this frame
        this._pendingChangeFrame = requestAnimationFrame(() => {
            this._pendingChangeFrame = null;
            if (this._onChange) this._onChange(kind);
        });
    }
    setFontFamily(f) { return setFontFamily(this, f); }
    setFontSize(s) { return setFontSize(this, s); }

    /** Clear the transform attribute on every selected element. */
    resetSelectionTransform() {
        const sel = this._selectedElements;
        if (!sel || !sel.length) return false;
        let changedAny = false;
        for (const el of sel) { if (resetTransform(el)) changedAny = true; }
        if (changedAny) {
            this._updateHandles();
            this._updateSelectionHighlight();
            this.pushState();
            if (this._onChange) this._onChange();
        }
        return changedAny;
    }

    /** Bake every selected element's transform into its geometry. */
    flattenSelectionTransform() {
        const sel = this._selectedElements;
        if (!sel || !sel.length) return false;
        let anyPromoted = false, anyFlat = false;
        for (const el of sel) {
            const wasType = el.type;
            const ok = flattenTransform(el);
            if (!ok) continue;
            anyFlat = true;
            if (wasType === 'rect' || wasType === 'circle' || wasType === 'ellipse') anyPromoted = true;
        }
        if (!anyFlat) return false;
        if (anyPromoted) this._deselect();
        this._updateHandles();
        this._updateSelectionHighlight();
        this.pushState();
        if (this._onChange) this._onChange();
        return true;
    }

    // SE1 removed the old dead snap toggle and left this as an identity
    // pass-through with two live callers (editor-interaction.js's
    // handleStart/handleMove). SE6 gave it a real grid to snap to. SE7a:
    // snap is now a per-tool DECLARATION (SNAP_POLICY in editor-grid.js) —
    // blanket snapping quantised the pen's freehand stroke and the eraser.
    // `phase` ('start' | 'move') plus `this._currentMode` pick the policy;
    // bypass is Alt-held (ignored by policies that don't honour it).
    _snap(pt, bypass = false, phase = 'start') {
        return snapFor(pt, this._grid, this._currentMode, phase, bypass);
    }

    /** One setter for the grid toolbar: merge a patch, persist, redraw,
     *  return the new record so the caller can sync its own UI state. */
    setGrid(patch) {
        this._grid = { ...this._grid, ...patch };
        saveGridPrefs(this._grid);
        applyGrid(this);
        return this._grid;
    }

    setActiveLayer(layerId) { return setActiveLayer(this, layerId); }

    /**
     * Capture a full snapshot: sketch-layer markup PLUS the layer roster
     * and active layer. Saving the sketch alone (the pre-layer-refactor
     * behavior) left dangling inactive-layer classes and orphaned
     * data-layer attributes after restore, so the editor would appear
     * frozen / wrong-dim after Ctrl+Z. The snapshot is a plain object
     * to keep restore back-compatible: if a string sneaks in from
     * legacy code it's treated as the bare sketch SVG.
     */
    pushState() {
        // Caller trace lets us see WHO is pushing (finishDrawing,
        // setStrokeWidth, ensureActiveLayer, etc.) so we can spot
        // spurious snapshots that are erroneously grouping strokes.
        const caller = _shortCaller();
        const childCount = this._sketchLayer.children().toArray().length;
        const state = {
            svg: this._sketchLayer.children().map(el => el.svg()).join(''),
            // SE7i: each layer's own `.pattern` (seed/colors/rails/ties/
            // nodes/widths config — generatePattern's own PATTERN object,
            // mutated in place) is deep-cloned here too, not just spread —
            // a plain `{ ...l }` only shallow-copies, so `l.pattern` would
            // stay the SAME nested object generatePattern later mutates in
            // place, silently rewriting THIS snapshot's seed right along
            // with the live layer (exactly the bug SE7g fixed for the old
            // file-level editor._latticePattern, now guarded per-layer
            // instead since Section 1 moved settings onto the layer).
            layers: Array.isArray(this._layers)
                ? this._layers.map(l => ({
                    ...l,
                    pattern: l.pattern ? JSON.parse(JSON.stringify(l.pattern)) : l.pattern,
                  }))
                : [],
            activeLayer: this._activeLayer,
        };
        this._redoStack.length = 0;
        this._undoStack.push(state);
        if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
        _undoLog( `pushState  caller=${caller}  children=${childCount}  stack=${this._undoStack.length}  redo=${this._redoStack.length}  svgLen=${state.svg.length}`);
        if (this._onCommit) this._onCommit('push');
        updateHistoryButtons(this);
    }

    undo() {
        if (this._undoStack.length < 2) {
            _undoLog( `undo  noop  stack=${this._undoStack.length}  (need >=2)`);
            updateHistoryButtons(this);
            return;
        }
        const current = this._undoStack.pop();
        this._redoStack.push(current);
        const prev = this._undoStack[this._undoStack.length - 1];
        _undoLog( `undo  popped  stack(after)=${this._undoStack.length}  redo=${this._redoStack.length}  restoringChildren=${(prev.svg||'').match(/<(path|line|rect|circle|polyline|polygon|text|g)\b/g)?.length ?? 0}`);
        this._restoreState(prev);
        updateHistoryButtons(this);
    }

    redo() {
        if (!this._redoStack.length) {
            _undoLog( `redo  noop  redo=0`);
            updateHistoryButtons(this);
            return;
        }
        const next = this._redoStack.pop();
        this._undoStack.push(next);
        _undoLog( `redo  popped  stack=${this._undoStack.length}  redo(after)=${this._redoStack.length}`);
        this._restoreState(next);
        updateHistoryButtons(this);
    }

    /** Rehydrate the editor from a snapshot object (or legacy SVG string).
     *  Order matters: layers/active must land BEFORE applyLayerState so
     *  the dim/hide pass sees the right active id; renderLayersPanel
     *  redraws the right sidebar so add/remove undo is visible. */
    _restoreState(state) {
        const isObj = state && typeof state === 'object';
        const svg = isObj ? (state.svg || '') : String(state || '');

        if (this._selectedElement) this._deselect();
        this._sketchLayer.clear();
        _undoLog(`restoreState  after clear()  children=${this._sketchLayer.children().toArray().length}  svgLen=${svg.length}`);
        if (svg) this._sketchLayer.svg(svg);
        // Snapshot of post-injection state — confirms svg.js actually
        // materialized the snapshot's children. If this says 0, the bug
        // is .svg(string) not parsing/inserting; if it says N and the
        // user sees 0, the bug is downstream (hiding class, transform,
        // or CSS).
        const postInject = this._sketchLayer.children().toArray();
        _undoLog(`restoreState  after .svg(snapshot)  children=${postInject.length}`);
        postInject.slice(0, 5).forEach((ch, i) => {
            const node = ch.node;
            const cls = node?.getAttribute('class') || '';
            const dl = node?.getAttribute('data-layer');
            const tag = node?.tagName;
            const stroke = node?.getAttribute('stroke') || '(none)';
            const display = node ? window.getComputedStyle(node).display : '?';
            _undoLog(`restoreState  child[${i}] tag=${tag} data-layer="${dl}" class="${cls}" stroke=${stroke} computedDisplay=${display}`);
        });

        if (isObj && Array.isArray(state.layers)) {
            this._layers = state.layers.map(l => ({ ...l }));
        }
        if (isObj && 'activeLayer' in state) {
            this._activeLayer = state.activeLayer;
        }
        _undoLog(`restoreState  layers/active set  layers=[${(this._layers||[]).map(l=>l.id).join(',')}]  active=${this._activeLayer}`);

        applyLayerState(this);
        renderLayersPanel(this);
        // After applyLayerState, re-check each child's class + computed
        // display to see whether toggleClass actually cleared the hiding
        // class (B2 hypothesis #5 from BUGS_OPEN.md). If display=none
        // here, that's the smoking gun.
        const postApply = this._sketchLayer.children().toArray();
        postApply.slice(0, 5).forEach((ch, i) => {
            const node = ch.node;
            const cls = node?.getAttribute('class') || '';
            const display = node ? window.getComputedStyle(node).display : '?';
            _undoLog(`restoreState  POST-applyLayerState  child[${i}] class="${cls}" computedDisplay=${display}`);
        });
        _undoLog( `restoreState done  children=${this._sketchLayer.children().toArray().length}  layers=${(this._layers||[]).length}  active=${this._activeLayer}`);
        if (this._onChange) this._onChange();
    }

    // Delegation Helpers
    _getDynamicTolerance(px) { return getDynamicTolerance(this, px); }
    _getNodes(el) { return getNodes(el); }
    // SE7h add-on: this delegation wrapper dropped a 3rd argument entirely
    // (opts) until this fix — editor-interaction.js's selectHandler/
    // nodeHandler pass { anyVisibleLayer: true } through editor.
    // _getNearbyElement (not the getNearbyElement export directly), so the
    // option was silently discarded here and the click-any-visible-layer
    // fix never actually reached the live app despite every unit test
    // (which calls getNearbyElement directly) passing. Caught by the
    // live-browser proof, not the suite — see WORK-LOG.
    _getNearbyElement(pt, tol, opts) { return getNearbyElement(this, pt, tol, opts); }
    _getMousePoint(e) { return getPointerPos(this, e); }
    _updateHandles() { return updateHandles(this); }
    _updateSelectionHighlight() { return updateSelectionHighlight(this); }
    _select(el) { return select(this, el); }
    // SE8f: imported from editor-ui.js since the multi-selection refactor
    // (see this constructor's own "_selectAdd / _selectMany" comments,
    // above) but never actually delegated — Ctrl+A (guarded, silently
    // no-op'd), Shift-click add (unguarded, threw), paste (guarded), and
    // marquee-finalize (unguarded, threw) all call editor._selectMany/
    // _selectAdd assuming they exist. Found while measuring the drag
    // pipeline (SE8b-3) trying to select more than one element.
    _selectAdd(el) { return selectAdd(this, el); }
    _selectMany(els) { return selectMany(this, els); }
    _setHover(el) { return setHover(this, el); }
    _commitText() { return commitText(this); }
    _cancelDrawing() {
        try { fusLog(`[STROKE] _cancelDrawing  isDrawing=${this._isDrawing}  hadPath=${!!this._currentPath}  (path removed if present, NO pushState)`); } catch (_) {}
        if(this._currentPath) this._currentPath.remove();
        this._isDrawing = false;
    }

    setModelMetrics(w, h) {
        if (!this._draw) return;
        this._mW = w; this._mH = h;
        // SE2: resets _view to fit the (possibly new) board size and pushes
        // it to the live viewbox — no other code should call
        // this._draw.viewbox(...) as a setter directly.
        _fitView(this);
        // SE6: board size changed -> redraw the grid at the new extent.
        applyGrid(this);
        this._bgLayer.clear();
        // Remove the grey viewbox background rectangle so the preview is not clipped by it.
        this.sync3DBackground();
    }

    /** Reset the view to fit the whole board — bound to the Fit tool button. */
    fitView() { _fitView(this); }

    deleteSelected() {
        // BUG-28 multi-select: remove every selected element, not just
        // the primary. Snapshot the array first because .remove() mutates
        // the DOM and the getter/array shifts under us otherwise.
        const sel = (this._selectedElements || []).slice();
        if (sel.length === 0) return;
        for (const el of sel) {
            try { el.remove(); } catch (_) {}
        }
        this._deselect();
        this.pushState();
        if (this._onChange) this._onChange();
    }

    /** T8: the one place that clears "what's selected" — _selectedElement(s)
     *  (via the setter below), _selectedNodes, the handle layer, and EVERY
     *  highlight halo (not just the legacy single alias). Content-wipe sites
     *  (Clear, open()) call this directly rather than a separate wrapper —
     *  it's already complete, so a second name over it would add nothing. */
    _deselect() {
        if (this._selectedElement) this._selectedElement.removeClass('svg-selected');
        this._selectedElement = null;
        this._selectedNodes = [];
        if (this._handleLayer) this._handleLayer.clear();
        if (this._selectionHighlight) { this._selectionHighlight.remove(); this._selectionHighlight = null; }
        if (this._selectionHighlights) {
            for (const h of this._selectionHighlights) { try { h.remove(); } catch (_) {} }
        }
        this._selectionHighlights = [];
        updateToolbarVisibility(this);
    }
}
