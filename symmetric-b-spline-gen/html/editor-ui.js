/**
 * editor-ui.js - Mode management, toolbar sync, and selection highlights for VectorEditor.
 */

export function setMode(editor, mode) {
    if (editor._editingTextEl) editor._commitText();
    if (editor._isDrawing) editor._cancelDrawing();
    
    editor._currentMode = mode;
    updateToolbarVisibility(editor);

    // Update active class on buttons
    const btns = document.querySelectorAll('.editor-sidebar .tool-btn');
    btns.forEach(btn => {
        btn.classList.toggle('active', btn.id === `tool${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
        // Special case for Draw mode (toolDraw)
        if (mode === 'draw' && btn.id === 'toolDraw') btn.classList.add('active');
        // Special case for Select mode (toolSelect)
        if (mode === 'select' && btn.id === 'toolSelect') btn.classList.add('active');
        // Special case for Node mode (toolNode)
        if (mode === 'node' && btn.id === 'toolNode') btn.classList.add('active');
    });

    const container = document.getElementById('editorSVGContainer');
    if (container) {
        container.classList.remove('mode-select', 'mode-draw', 'mode-line', 'mode-text', 'mode-circle', 'mode-rect', 'mode-node');
        container.classList.add(`mode-${mode}`);
    }
}

export function updateToolbarVisibility(editor) {
    const strokeGroup = document.getElementById('editorStrokeGroup');
    const fontGroup = document.getElementById('editorFontGroup');
    const el = editor._selectedElement;

    if (strokeGroup) {
        const isDrawingShape = ['draw', 'line', 'rect', 'circle'].includes(editor._currentMode);
        const isShapeSelected = el && el.type !== 'text';
        strokeGroup.classList.toggle('hidden', !(isDrawingShape || isShapeSelected));
    }
    if (fontGroup) {
        const isTextMode = editor._currentMode === 'text';
        const isTextSelected = el && el.type === 'text';
        fontGroup.classList.toggle('hidden', !(isTextMode || isTextSelected));
    }

    const expandBtn = document.getElementById('toolExpand');
    if (expandBtn) {
        const isExpandable = el && el.type !== 'text' && el.type !== 'image';
        expandBtn.classList.toggle('hidden', !isExpandable);
    }
}

export function updateNodeCountUI(editor, pathData) {
    const el = document.getElementById('editorNodeCount');
    if (!el) return;
    if (!pathData) {
        el.textContent = 'Nodes: --';
        return;
    }

    let count = 0;
    const cmds = pathData.match(/[MLCAZ]/gi);
    if (cmds) count = cmds.length;
    
    if (editor._selectedElement) {
        if (editor._selectedElement.type === 'polyline' || editor._selectedElement.type === 'polygon') {
            count = editor._selectedElement.array().length;
        }
    }
    
    el.textContent = `Nodes: ${count}`;
}

export function updateSelectionHighlight(editor) {
    if (editor._selectionHighlight) { 
        editor._selectionHighlight.remove(); 
        editor._selectionHighlight = null; 
    }
    if (!editor._selectedElement || !editor._draw || !editor._highlightLayer) return;

    const el = editor._selectedElement;
    if (el.type === 'text') {
        const b = el.bbox();
        editor._selectionHighlight = editor._highlightLayer.rect(b.w + 0.1, b.h + 0.04)
            .move(b.x - 0.05, b.y - 0.02)
            .fill({ color: '#ffcc00', opacity: 0.1 })
            .stroke({ color: '#ffcc00', width: 0.02, opacity: 0.5 })
            .radius(0.04)
            .back();
    } else {
        const sw = parseFloat(el.attr('stroke-width')) || editor._strokeWidth;
        const tol5px = editor._getDynamicTolerance(5);
        editor._selectionHighlight = el.clone()
            .fill('none')
            .stroke({ 
                color: '#ffcc00', 
                width: sw + (tol5px * 2), 
                opacity: 0.4 
            })
            .removeClass('svg-selected')
            .removeClass('svg-hover')
            .attr('pointer-events', 'none');
        editor._highlightLayer.add(editor._selectionHighlight);
        editor._selectionHighlight.back();
    }
}

export function select(editor, el) {
    if (editor._selectedElement === el) return;
    editor._deselect();
    editor._selectedElement = el;

    if (el) {
        const layerSel = document.getElementById('editorLayerSelect');
        if (layerSel) layerSel.value = el.attr('data-layer') || "0";

        if (el.type === 'text') {
            const f = el.font();
            editor._fontFamily = f.family;
            editor._fontSize = f.size;
        } else {
            editor._strokeWidth = parseFloat(el.attr('stroke-width')) || editor._strokeWidth;
        }
    }
    
    if (editor._hoverHighlight) { 
        editor._hoverHighlight.remove(); 
        editor._hoverHighlight = null; 
    }
    if (editor._hoveredElement) editor._hoveredElement.removeClass('svg-hover');
    
    el.addClass('svg-selected');
    editor._updateHandles(); 
    editor._updateSelectionHighlight(); 
    updateToolbarVisibility(editor);
    if (editor._onSelect) editor._onSelect(el);
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

    if (el.type === 'text') {
        const b = el.bbox();
        editor._hoverHighlight = editor._highlightLayer.rect(b.w + 0.1, b.h + 0.04)
            .move(b.x - 0.05, b.y - 0.02)
            .fill({ color: '#0066cc', opacity: 0.15 })
            .radius(0.04)
            .attr('pointer-events', 'none');
    } else {
        const tol5px = editor._getDynamicTolerance(5);
        editor._hoverHighlight = el.clone()
            .fill('none') 
            .stroke({ 
                color: '#0066cc', 
                width: (parseFloat(el.attr('stroke-width')) || editor._strokeWidth) + (tol5px * 2),
                opacity: 0.8 
            })
            .removeClass('svg-selected')
            .removeClass('svg-hover')
            .attr('pointer-events', 'none');
        
        editor._highlightLayer.add(editor._hoverHighlight);
        editor._hoveredElement.addClass('svg-hover');
    }
}
