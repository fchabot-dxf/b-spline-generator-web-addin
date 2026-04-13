/**
 * editor.js - SVG.js Vector Stamp Editor (Phase 3)
 * Refactored into a modular ES6 architecture.
 */

import { initIO, save, saveWithTextCopies, open, sync3DBackground, getPointerPos } from './editor-io.js';
import { initText, beginTextEdit, commitText, cancelText, setFontFamily, setFontSize, insertSymbol } from './editor-text.js';
import { getDynamicTolerance, getNodes, fitCurve, getHybridBezierPath, expandCurrent, getNearbyElement } from './editor-geometry.js';
import { initInteraction, updateHandles } from './editor-interaction.js';
import { setMode, updateToolbarVisibility, updateNodeCountUI, updateSelectionHighlight, setHover, select } from './editor-ui.js';

const SYMBOL_FONTS = [
    'Symbol',
    'Webdings',
    'Wingdings',
    'Segoe UI Symbol',
    'Segoe MDL2 Assets',
    'Segoe Fluent Icons',
    'Segoe UI Emoji'
];

const SYMBOL_FONT_RANGES = {
    'Symbol': { start: 32, end: 255 },
    'Webdings': { start: 32, end: 255 },
    'Wingdings': { start: 32, end: 255 },
    'Segoe UI Symbol': { start: 32, end: 255 },
    'Segoe MDL2 Assets': { start: 0xE700, end: 0xE7FF },
    'Segoe Fluent Icons': { start: 0xF700, end: 0xF7FF },
    'Segoe UI Emoji': { start: 0x1F300, end: 0x1F35F }
};

function populateSymbolKeyboard(editor, family = 'Symbol') {
    const grid = document.getElementById('editorSymbolKeyboardGrid');
    const panel = document.getElementById('editorSymbolKeyboard');
    if (!grid || !panel) return;
    grid.innerHTML = '';

    const fontFamily = family || 'Symbol';
    const range = SYMBOL_FONT_RANGES[fontFamily] || { start: 32, end: 255 };
    const start = range.start;
    const end = range.end;
    const count = Math.max(0, end - start + 1);
    const isMobile = window.innerWidth <= 720;
    const columns = isMobile
        ? Math.min(6, Math.max(4, Math.ceil(Math.sqrt(count))))
        : Math.min(16, Math.max(8, Math.ceil(Math.sqrt(count))));
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(30px, 1fr))`;

    if (isMobile) {
        panel.style.width = '';
        panel.style.height = '';
        panel.style.maxHeight = '55vh';
    } else {
        const rowCount = Math.ceil(count / columns);
        const height = Math.min(420, Math.max(180, rowCount * 36 + 90));
        panel.style.height = `${height}px`;
        panel.style.width = `${Math.min(420, Math.max(260, columns * 36 + 24))}px`;
    }

    for (let code = start; code <= end; code++) {
        const char = String.fromCodePoint(code);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'symbol-key';
        btn.textContent = char;
        btn.style.all = 'unset';
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.width = '100%';
        btn.style.height = '34px';
        btn.style.border = '1px solid rgba(0,0,0,0.1)';
        btn.style.borderRadius = '4px';
        btn.style.background = 'var(--surface2)';
        btn.style.color = 'var(--text)';
        btn.style.fontFamily = `'${fontFamily}', sans-serif`;
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', () => {
            if (editor._editingTextEl) {
                insertSymbol(editor, char, fontFamily);
            } else {
                alert('Open a text object and start editing before inserting symbols.');
            }
        });
        grid.appendChild(btn);
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
        this._bindToolbar();
    }

    _bindToolbar() {
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };
        bind('toolSelect', () => this.setMode('select'));
        bind('toolNode', () => this.setMode('node'));
        bind('toolDraw', () => this.setMode('draw'));
        bind('toolLine', () => this.setMode('line'));
        bind('toolRect', () => this.setMode('rect'));
        bind('toolCircle', () => this.setMode('circle'));
        bind('toolText', () => this.setMode('text'));
        bind('toolDelete', () => this.deleteSelected());
        bind('toolExpand', () => this.expandAction());
        bind('editorUndo', () => this.undo());
        bind('editorDownload', async () => {
            const svgText = await this.saveWithTextCopies();
            if (!svgText) return;
            const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
            const now = new Date();
            const timestamp = now.toISOString().replace(/[:T]/g, '-').replace(/\.\d+Z$/, '');
            const name = `svg-editor-${timestamp}.svg`;
            if (typeof saveAs === 'function') {
                saveAs(blob, name);
            } else {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = name;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        });
        bind('editorClear', () => {
            if (confirm("Clear all?")) {
                this._sketchLayer.clear();
                this.pushState();
                if (this._onChange) this._onChange();
            }
        });

        // Modal Action Bindings
        bind('editorApply', () => {
            this._commitText();
            if (this._onCommit) this._onCommit(this.save());
        });
        bind('editorCancel', () => {
            if (this._onCommit) this._onCommit(null);
        });
        
        const strokeSld = document.getElementById('editorStrokeWidthSlider');
        const strokeNum = document.getElementById('editorStrokeWidth');
        if (strokeSld && strokeNum) {
            strokeSld.addEventListener('input', () => {
                strokeNum.value = strokeSld.value;
                this.setStrokeWidth(parseFloat(strokeSld.value));
            });
            strokeNum.addEventListener('input', () => {
                strokeSld.value = strokeNum.value;
                this.setStrokeWidth(parseFloat(strokeNum.value));
            });
        }


        // Font family & size controls
        const fontFamilyEl = document.getElementById('editorFontFamily');
        if (fontFamilyEl) {
            fontFamilyEl.addEventListener('change', () => {
                this.setFontFamily(fontFamilyEl.value);
            });
        }
        const fontSizeEl = document.getElementById('editorFontSize');
        if (fontSizeEl) {
            fontSizeEl.addEventListener('input', () => {
                const s = parseFloat(fontSizeEl.value);
                if (!isNaN(s) && s > 0) this.setFontSize(s);
            });
        }
        // Font size stepper buttons (±0.2)
        const fsMinus = document.getElementById('editorFontSizeMinus');
        const fsPlus  = document.getElementById('editorFontSizePlus');
        const stepFontSize = (delta) => {
            if (!fontSizeEl) return;
            const cur = parseFloat(fontSizeEl.value) || this._fontSize;
            const next = Math.max(0.2, Math.round((cur + delta) * 10) / 10);
            fontSizeEl.value = next;
            this.setFontSize(next);
        };
        fsMinus?.addEventListener('click', () => stepFontSize(-0.2));
        fsPlus?.addEventListener('click',  () => stepFontSize(+0.2));

        const symbolToggle = document.getElementById('editorSymbolKeyboardToggle');
        const symbolPanel = document.getElementById('editorSymbolKeyboard');
        const symbolClose = document.getElementById('editorSymbolKeyboardClose');
        const symbolFamily = document.getElementById('editorSymbolFamily');

        if (symbolToggle && symbolPanel && symbolFamily) {
            symbolToggle.addEventListener('click', () => {
                const isOpen = !symbolPanel.classList.toggle('hidden');
                if (isOpen) {
                    populateSymbolKeyboard(this, symbolFamily.value || 'Symbol');
                    symbolFamily.focus();
                }
            });
        }
        symbolClose?.addEventListener('click', () => symbolPanel?.classList.add('hidden'));
        symbolFamily?.addEventListener('change', () => {
            if (symbolPanel && !symbolPanel.classList.contains('hidden')) {
                populateSymbolKeyboard(this, symbolFamily.value || 'Symbol');
            }
        });
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