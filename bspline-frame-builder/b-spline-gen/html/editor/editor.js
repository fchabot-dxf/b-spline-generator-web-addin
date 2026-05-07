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
import { setMode, updateToolbarVisibility, updateNodeCountUI, updateSelectionHighlight, setHover, select } from './editor-ui.js';
import { setupEditorToolbar } from './editor-controls.js';
import { initLayerControls, setActiveLayer } from './layers.js';
import { createEditorCanvas } from './init.js';

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
        this._fontFamily = "Arial";
        this._fontSize = 3.0;
        this._expandDetail = 1.0;
        this._expandSimplify = 15;
        this._expandAccuracy = 1.0;
        this._isRefreshingExpand = false;
        this._pendingExpandRefresh = false;
        this._expandRefreshTimer = null;

        this._selectedElement = null;
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
        
        this._isSnapping = false;
        this._snapSize = 2.0;
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
        if (this._selectedElement) {
            this._selectedElement.stroke({ color });
            if (this._selectedElement.type === 'text') this._selectedElement.fill(color);
            this.pushState();
        }
    }
    setStrokeWidth(w) { 
        this._strokeWidth = w;
        if (this._selectedElement) {
            this._selectedElement.stroke({ width: w });
            this._updateSelectionHighlight();
        }
    }
    setFontFamily(f) { return setFontFamily(this, f); }
    setFontSize(s) { return setFontSize(this, s); }

    toggleSnapping() {
        this._isSnapping = !this._isSnapping;
        updateToolbarVisibility(this); // Refresh status bar styles
        return this._isSnapping;
    }

    _snap(pt) {
        if (!this._isSnapping) return pt;
        return {
            x: Math.round(pt.x / this._snapSize) * this._snapSize,
            y: Math.round(pt.y / this._snapSize) * this._snapSize
        };
    }

    setActiveLayer(layerId) { return setActiveLayer(this, layerId); }

    pushState() {
        const state = this._sketchLayer.children().map(el => el.svg()).join('');
        this._redoStack.length = 0;
        this._undoStack.push(state);
        if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
        if (this._onCommit) this._onCommit('push');
    }

    undo() {
        if (this._undoStack.length < 2) return;
        const current = this._undoStack.pop();
        this._redoStack.push(current);
        const prev = this._undoStack[this._undoStack.length - 1];
        this._sketchLayer.clear();
        this._sketchLayer.svg(prev);
        if (this._onChange) this._onChange();
    }

    redo() {
        if (!this._redoStack.length) return;
        const next = this._redoStack.pop();
        this._undoStack.push(next);
        this._sketchLayer.clear();
        this._sketchLayer.svg(next);
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
    _cancelDrawing() { if(this._currentPath) this._currentPath.remove(); this._isDrawing = false; }

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