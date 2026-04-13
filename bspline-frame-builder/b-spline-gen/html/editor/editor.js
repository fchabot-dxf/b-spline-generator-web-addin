/**
 * editor.js - SVG.js Vector Stamp Editor (Phase 3)
 * Refactored into a modular ES6 architecture.
 */

import { initIO, save, saveWithTextCopies, open, sync3DBackground, getPointerPos } from './editor-io.js';
import { initText, commitText, cancelText, setFontFamily, setFontSize } from './editor-text.js';
import { getDynamicTolerance, getNodes, fitCurve, getHybridBezierPath, expandCurrent, getNearbyElement } from './editor-geometry.js';
import { initInteraction, updateHandles } from './editor-interaction.js';
import { setMode, updateToolbarVisibility, updateNodeCountUI, updateSelectionHighlight, setHover, select } from './editor-ui.js';
import { setupEditorToolbar } from './editor-controls.js';


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
        this._maxUndo = 30;
        
        this._dragNodeIndex = -1;
        this._hoverNodeIndex = -1;
        this._isClickMode = false;
        this._dragDist = 0;
    }

    initEditor(containerId, backgroundCanvasId, onChange, onCommit, onSelect) {
        this._backgroundCanvasId = backgroundCanvasId;
        this._onChange = onChange;
        this._onCommit = onCommit;
        this._onSelect = onSelect;

        const container = document.getElementById(containerId);
        if (container) container.innerHTML = "";
        this._draw = window.SVG().addTo('#'+containerId).size('100%', '100%');
        this._bgLayer = this._draw.group().id('bg-layer');
        this._sketchLayer = this._draw.group().id('sketch-layer');
        this._handleLayer = this._draw.group().id('handle-layer');
        this._highlightLayer = this._draw.group().id('highlight-layer');

        initIO(this);
        initInteraction(this);
        initText(this);

        this.setModelMetrics(this._mW, this._mH);
        this.setMode(this._currentMode);
        setupEditorToolbar(this);
    }


    async expandAction() {
        this._commitText();
        await expandCurrent(this, this._expandDetail, this._expandSimplify, this._expandAccuracy, true);
        if (this._onChange) this._onChange();
    }



    save(dpi = 96) { 
        this._commitText();
        return save(this, dpi); 
    }

    saveWithTextCopies(dpi = 96) {
        this._commitText();
        return saveWithTextCopies(this, dpi);
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

    pushState() {
        const state = this._sketchLayer.children().map(el => el.svg()).join('');
        this._undoStack.push(state);
        if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
        if (this._onCommit) this._onCommit('push');
    }

    undo() {
        if (this._undoStack.length < 2) return;
        this._undoStack.pop(); 
        const prev = this._undoStack[this._undoStack.length - 1];
        this._sketchLayer.clear();
        this._sketchLayer.svg(prev);
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