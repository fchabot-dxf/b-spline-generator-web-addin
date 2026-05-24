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
import { setMode, updateToolbarVisibility, updateNodeCountUI, updateSelectionHighlight, setHover, select, selectAdd, selectMany } from './editor-ui.js';
import { setupEditorToolbar } from './editor-controls.js';
import { initLayerControls, setActiveLayer, applyLayerState, renderLayersPanel } from './layers.js';
import { createEditorCanvas } from './init.js';
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
        this._sketchLayer = null;
        this._handleLayer = null;
        this._highlightLayer = null;
        
        this._mW = 7;
        this._mH = 9;
        this._currentMode = 'draw';
        this._strokeWidth = 0.5;
        this._strokeColor = '#000000';
        // Step 27: fill mode for new shapes. 'stroke' = outline only (legacy
        // behavior, default), 'fill' = solid interior, 'both' = outline +
        // interior. Pen-anchor paths auto-close with Z when fill is active.
        this._fillMode = 'stroke';
        this._fillColor = '#000000';
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
        
        this._isSnapping = false;
        this._snapSize = 2.0;
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
    setStrokeColor(color) {
        this._strokeColor = color;
        const sel = this._selectedElements;
        if (!sel || !sel.length) return;
        for (const el of sel) {
            el.stroke({ color });
            if (el.type === 'text') el.fill(color);
        }
        this.pushState();
    }
    setStrokeWidth(w) {
        this._strokeWidth = w;
        const sel = this._selectedElements;
        if (!sel || !sel.length) return;
        for (const el of sel) el.stroke({ width: w });
        this._updateSelectionHighlight();
    }
    setFontFamily(f) { return setFontFamily(this, f); }
    setFontSize(s) { return setFontSize(this, s); }

    toggleSnapping() {
        this._isSnapping = !this._isSnapping;
        updateToolbarVisibility(this); // Refresh status bar styles
        return this._isSnapping;
    }

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

    _snap(pt) {
        if (!this._isSnapping) return pt;
        return {
            x: Math.round(pt.x / this._snapSize) * this._snapSize,
            y: Math.round(pt.y / this._snapSize) * this._snapSize
        };
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
        // setStrokeColor, ensureActiveLayer, etc.) so we can spot
        // spurious snapshots that are erroneously grouping strokes.
        const caller = _shortCaller();
        const childCount = this._sketchLayer.children().toArray().length;
        const state = {
            svg: this._sketchLayer.children().map(el => el.svg()).join(''),
            layers: Array.isArray(this._layers)
                ? this._layers.map(l => ({ ...l }))
                : [],
            activeLayer: this._activeLayer,
        };
        this._redoStack.length = 0;
        this._undoStack.push(state);
        if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
        _undoLog( `pushState  caller=${caller}  children=${childCount}  stack=${this._undoStack.length}  redo=${this._redoStack.length}  svgLen=${state.svg.length}`);
        if (this._onCommit) this._onCommit('push');
    }

    undo() {
        if (this._undoStack.length < 2) {
            _undoLog( `undo  noop  stack=${this._undoStack.length}  (need >=2)`);
            return;
        }
        const current = this._undoStack.pop();
        this._redoStack.push(current);
        const prev = this._undoStack[this._undoStack.length - 1];
        _undoLog( `undo  popped  stack(after)=${this._undoStack.length}  redo=${this._redoStack.length}  restoringChildren=${(prev.svg||'').match(/<(path|line|rect|circle|polyline|polygon|text|g)\b/g)?.length ?? 0}`);
        this._restoreState(prev);
    }

    redo() {
        if (!this._redoStack.length) {
            _undoLog( `redo  noop  redo=0`);
            return;
        }
        const next = this._redoStack.pop();
        this._undoStack.push(next);
        _undoLog( `redo  popped  stack=${this._undoStack.length}  redo(after)=${this._redoStack.length}`);
        this._restoreState(next);
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
    _getNearbyElement(pt, tol) { return getNearbyElement(this, pt, tol); }
    _getMousePoint(e) { return getPointerPos(this, e); }
    _updateHandles() { return updateHandles(this); }
    _updateSelectionHighlight() { return updateSelectionHighlight(this); }
    _updateNodeCountUI(data) { return updateNodeCountUI(this, data); }
    _select(el) { return select(this, el); }
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
        this._draw.viewbox(0, 0, w, h);
        this._bgLayer.clear();
        // Remove the grey viewbox background rectangle so the preview is not clipped by it.
        this.sync3DBackground();
    }

    deleteSelected() {
        if (this._selectedElement) {
            this._selectedElement.remove();
            this._deselect();
            this.pushState();
            if (this._onChange) this._onChange();
        }
    }

    _deselect() {
        if (this._selectedElement) this._selectedElement.removeClass('svg-selected');
        this._selectedElement = null;
        if (this._handleLayer) this._handleLayer.clear();
        if (this._selectionHighlight) { this._selectionHighlight.remove(); this._selectionHighlight = null; }
        updateToolbarVisibility(this);
    }
}
