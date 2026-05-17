/**
 * editor-ui.js - Mode management, toolbar sync, and selection highlights for VectorEditor.
 */
import { el as getEl, queryAll, query } from './dom.js';
import { worldBbox } from './editor-coords.js';

export function setMode(editor, mode) {
    if (editor._editingTextEl) editor._commitText();
    if (editor._isDrawing) editor._cancelDrawing();
    
    editor._currentMode = mode;
    updateToolbarVisibility(editor, mode, editor._selectedElement);

    // Update active class on buttons
    const btns = queryAll('.editor-sidebar .tool-btn');
    btns.forEach(btn => {
        btn.classList.toggle('active', btn.id === `tool${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
        // Special case for Draw mode (toolDraw)
        if (mode === 'draw' && btn.id === 'toolDraw') btn.classList.add('active');
        // Special case for Select mode (toolSelect)
        if (mode === 'select' && btn.id === 'toolSelect') btn.classList.add('active');
        // Special case for Node mode (toolNode)
        if (mode === 'node' && btn.id === 'toolNode') btn.classList.add('active');
    });

    const container = getEl('editorSVGContainer');
    if (container) {
        container.classList.remove('mode-select', 'mode-draw', 'mode-line', 'mode-text', 'mode-circle', 'mode-rect', 'mode-node');
        container.classList.add(`mode-${mode}`);
    }

    // Restore handles refresh on mode switch
    editor._updateHandles();
    editor._updateSelectionHighlight();
}

export function updateToolbarVisibility(editor, mode, el) {
    const isTextMode = mode === 'text' || (el && el.type === 'text');
    
    const fontGroup = getEl('editorFontGroup');
    const expandGroup = getEl('editorExpandGroup');
    const symbolToggle = getEl('editorSymbolKeyboardToggle');
    const divider = query('.property-divider');
    const strokeGroup = getEl('editorStrokeGroup');

    const isExpandMode = mode === 'expand';

    if (fontGroup) fontGroup.classList.toggle('hidden', !isTextMode);
    if (expandGroup) expandGroup.classList.toggle('hidden', !isExpandMode);
    if (symbolToggle) symbolToggle.classList.toggle('hidden', !isTextMode);
    if (divider) divider.classList.toggle('hidden', !isTextMode && !isExpandMode);
    
    // Hide stroke group in expand mode (no room) and text mode (text uses
    // fill, not stroke — the stroke input doesn't apply).
    if (strokeGroup) strokeGroup.classList.toggle('hidden', isExpandMode || isTextMode);
    
    const selectPanel = getEl('editorSelectPanel');
    
    // Selection details logic
    if (selectPanel) {
        const hasSelection = el || (editor._selectedNodes && editor._selectedNodes.length > 0);
        selectPanel.classList.toggle('hidden', !hasSelection);
    }

    // Sync Snap Toggle UI
    const snapToggle = getEl('editorSnapToggle');
    if (snapToggle) snapToggle.classList.toggle('active', editor._isSnapping);

    // Auto-hide symbol keyboard if leaving text mode (but keep it open when using the text tool)
    const symbolPanel = getEl('editorSymbolKeyboard');
    if (symbolPanel && !isTextMode && symbolPanel.classList.contains('hidden') === false) {
        // Only hide if we explicitly click a non-text tool button
        // (Managed in tool click listeners, but we keep this as a fallback)
    }

    const expandBtn = getEl('toolExpand');
    // Ensure Expand tool is always visible in the new Native CAD layout
    if (expandBtn) {
        expandBtn.classList.remove('hidden');
    }
}

export function updateNodeCountUI(editor, data) {
    const ui = getEl('editorNodeCountUI');
    if (!ui) return;

    let count = '--';
    if (data && data.nodes !== undefined) count = data.nodes;
    else if (editor._selectedElement) {
        const type = editor._selectedElement.type;
        if (type === 'polyline' || type === 'polygon') count = editor._selectedElement.array().length;
        else if (type === 'line') count = 2;
        else if (type === 'rect' || type === 'circle' || type === 'text') count = 1;
    }

    const x = data?.x !== undefined ? data.x.toFixed(1) : '--';
    const y = data?.y !== undefined ? data.y.toFixed(1) : '--';

    ui.textContent = `Nodes: ${count} / X: ${x} Y: ${y}`;
}

/**
 * Both selection and hover highlights have the same shape: text gets a
 * filled rounded-rect behind the bbox; everything else gets a translucent
 * stroke clone of itself. The variants differ only in colors, opacities,
 * and whether the highlight goes behind the original (selection only).
 */
function _renderHighlight(editor, el, color, opts) {
    if (!el || !editor._draw || !editor._highlightLayer) return null;
    const { textFillOpacity, textStrokeOpacity, lineStrokeOpacity, back } = opts;
    let shape;
    if (el.type === 'text') {
        // worldBbox bakes the element's transform into the bbox so the
        // highlight follows drag-translated text instead of staying at
        // the local x/y attrs.
        const b = worldBbox(el);
        shape = editor._highlightLayer.rect(b.w + 0.1, b.h + 0.04)
            .move(b.x - 0.05, b.y - 0.02)
            .fill({ color, opacity: textFillOpacity })
            .radius(0.04);
        if (textStrokeOpacity) shape.stroke({ color, width: 0.02, opacity: textStrokeOpacity });
    } else {
        const sw = parseFloat(el.attr('stroke-width')) || editor._strokeWidth;
        const tol5px = editor._getDynamicTolerance(5);
        shape = el.clone()
            .fill('none')
            .stroke({ color, width: sw + (tol5px * 2), opacity: lineStrokeOpacity })
            .removeClass('svg-selected')
            .removeClass('svg-hover')
            .attr('pointer-events', 'none');
        editor._highlightLayer.add(shape);
    }
    if (back) shape.back();
    return shape;
}

export function updateSelectionHighlight(editor) {
    if (editor._selectionHighlight) {
        editor._selectionHighlight.remove();
        editor._selectionHighlight = null;
    }
    if (!editor._selectedElement) return;
    // Hide selection glow in Node Edit mode for clearer point selection.
    if (editor._currentMode === 'node') return;

    editor._selectionHighlight = _renderHighlight(editor, editor._selectedElement, '#ffcc00', {
        textFillOpacity: 0.1,
        textStrokeOpacity: 0.5,
        lineStrokeOpacity: 0.4,
        back: true,
    });
}

export function select(editor, selectedEl) {
    if (editor._selectedElement === selectedEl) return;
    editor._deselect();
    editor._selectedElement = selectedEl;

    if (selectedEl) {
        const layerSel = getEl('editorLayerSelect');
        if (layerSel) layerSel.value = selectedEl.attr('data-layer') || "0";

        if (selectedEl.type === 'text') {
            const f = selectedEl.font();
            editor._fontFamily = f.family || editor._fontFamily;
            // font size comes back as a string from SVG.js; force it to a number
            const parsedSize = parseFloat(f.size);
            if (!isNaN(parsedSize) && parsedSize > 0) editor._fontSize = parsedSize;
            // Sync the toolbar inputs so the displayed values match the selected element
            const ffEl = getEl('editorFontFamily');
            const fsEl = getEl('editorFontSize');
            if (ffEl && Array.from(ffEl.options).some(o => o.value === editor._fontFamily)) {
                ffEl.value = editor._fontFamily;
            }
            if (fsEl) fsEl.value = editor._fontSize;
        } else {
            editor._strokeWidth = parseFloat(selectedEl.attr('stroke-width')) || editor._strokeWidth;
        }
    }
    
    if (editor._hoverHighlight) { 
        editor._hoverHighlight.remove(); 
        editor._hoverHighlight = null; 
    }
    if (editor._hoveredElement) editor._hoveredElement.removeClass('svg-hover');
    
    selectedEl.addClass('svg-selected');
    editor._updateHandles(); 
    editor._updateSelectionHighlight(); 
    updateToolbarVisibility(editor);
    if (editor._onSelect) editor._onSelect(selectedEl);
}

export function setHover(editor, el) {
    if (editor._hoveredElement === el) return;

    if (editor._hoverHighlight) {
        editor._hoverHighlight.remove();
        editor._hoverHighlight = null;
    }
    if (editor._hoveredElement) editor._hoveredElement.removeClass('svg-hover');

    editor._hoveredElement = el;
    if (!el || el === editor._selectedElement) return;

    editor._hoverHighlight = _renderHighlight(editor, el, '#0066cc', {
        textFillOpacity: 0.15,
        textStrokeOpacity: 0,
        lineStrokeOpacity: 0.8,
        back: false,
    });
    if (el.type === 'text' && editor._hoverHighlight) {
        editor._hoverHighlight.attr('pointer-events', 'none');
    } else if (editor._hoveredElement) {
        editor._hoveredElement.addClass('svg-hover');
    }
}
