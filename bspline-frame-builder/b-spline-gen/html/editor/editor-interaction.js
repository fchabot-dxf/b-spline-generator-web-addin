/**
 * editor-interaction.js - Selection, handles, and mouse/touch logic for VectorEditor. 
 * Includes restored drawing lifecycle for Freehand, Line, Rect, and Circle.
 */
import { fitCurve, ramerDouglasPeucker } from './editor-curves.js';
import { startTextAt, beginTextEdit } from './editor-text.js';
import { getActiveLayer } from './layers.js';


export function initInteraction(editor) {
    const el = editor._draw.node;

    el.addEventListener('mousedown', e => handleStart(editor, e));
    window.addEventListener('mousemove', e => handleMove(editor, e));
    window.addEventListener('mouseup', e => handleEnd(editor, e));
    // Double-click on a text element opens it for editing (any mode)
    el.addEventListener('dblclick', e => handleDblClick(editor, e));

    el.addEventListener('touchstart', e => handleStart(editor, e), { passive: false });
    window.addEventListener('touchmove', e => handleMove(editor, e), { passive: false });
    window.addEventListener('touchend', e => handleEnd(editor, e));
}

function handleDblClick(editor, e) {
    const pt = editor._getMousePoint(e);
    const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
    if (hit && hit.type === 'text') {
        e.preventDefault();
        e.stopPropagation();
        // Switch to text mode automatically so the user can start typing
        if (editor._currentMode !== 'text') editor.setMode('text');
        beginTextEdit(editor, hit);
    }
}

function handleStart(editor, e) {
    console.log(`[TEXT-DBG] handleStart fired: type=${e.type} mode=${editor._currentMode} hasEditingText=${!!editor._editingTextEl} ts=${Math.round(e.timeStamp)} target=<${e.target?.tagName}>`);
    if (e.type === 'touchstart' && e.touches.length > 1) {
        console.log('[TEXT-DBG] handleStart: multi-touch, returning');
        return;
    }
    let pt = editor._getMousePoint(e);
    // Apply snapping at start of interaction
    pt = editor._snap(pt);

    // Node mode owns its own click flow: nodes first, then path-body to
    // (re-)select an element, never element-translate, never deselect on
    // empty-space click. This keeps the node-edit context stable while
    // the user works on a path.
    if (editor._currentMode === 'node') {
        if (editor._selectedElement) {
            const nodes = editor._getNodes(editor._selectedElement);
            const tol = editor._getDynamicTolerance(15);
            const hitIdx = nodes.findIndex(n => Math.hypot(n.x - pt.x, n.y - pt.y) < tol);
            if (hitIdx !== -1) {
                editor._isDragging = true;
                editor._dragNodeIndex = hitIdx;
                editor._lastDragPt = pt;
                return;
            }
        }
        // Missed all nodes — try to (re-)select the path under the cursor.
        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        if (hit && hit !== editor._selectedElement) {
            editor._select(hit);
        }
        // Whether we hit a path or empty space, do NOT initiate an
        // element-translate drag and do NOT deselect — node mode preserves
        // the current selection so the user can keep working on its nodes.
        return;
    }

    const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
    console.log(`[TEXT-DBG] handleStart hit-test: ${hit ? `HIT type=${hit.type}` : 'no hit'}`);
    if (hit) {
        // In text mode, clicking an existing text element opens it for editing
        if (editor._currentMode === 'text' && hit.type === 'text') {
            console.log('[TEXT-DBG] handleStart branch: text-mode, hit text → beginTextEdit');
            beginTextEdit(editor, hit);
            return;
        }
        // In text mode, ignore non-text elements — place new text instead
        if (editor._currentMode === 'text') {
            console.log('[TEXT-DBG] handleStart branch: text-mode, hit non-text → startTextAt');
            editor._deselect();
            startTextAt(editor, pt, e);
            return;
        }
        editor._isDragging = true;
        editor._lastDragPt = pt;
        if (editor._selectedElement !== hit) editor._select(hit);
    } else {
        editor._deselect();

        // Start drawing if in a drawing mode
        const drawModes = ['draw', 'line', 'rect', 'circle'];
        if (drawModes.includes(editor._currentMode)) {
            startDrawing(editor, pt);
        } else if (editor._currentMode === 'text') {
            console.log('[TEXT-DBG] handleStart branch: text-mode, no hit → startTextAt');
            startTextAt(editor, pt, e);
        } else {
            // Standard selection drag logic
            editor._isDragging = true;
            editor._lastDragPt = pt;
        }
    }
}

function handleMove(editor, e) {
    let pt = editor._getMousePoint(e);
    // Apply snapping during movement
    pt = editor._snap(pt);
    
    // If drawing, update the current shape
    if (editor._isDrawing) {
        updateDrawing(editor, pt);
        return;
    }

    // Hover logic
    if (!editor._isDragging) {
        // In node mode with a selection, prioritize node-hover (so the
        // diamond lights up) and suppress the element-hover halo unless
        // we're hovering over a different element that the user might
        // want to switch to. Without this, the bright element halo over
        // the selected path drowns out the subtle node hover.
        if (editor._currentMode === 'node' && editor._selectedElement) {
            const nodes = editor._getNodes(editor._selectedElement);
            const tol = editor._getDynamicTolerance(15);
            const hitIdx = nodes.findIndex(n => Math.hypot(n.x - pt.x, n.y - pt.y) < tol);
            if (editor._hoverNodeIndex !== hitIdx) {
                editor._hoverNodeIndex = hitIdx;
                editor._updateHandles();
            }
            // Only run element-hover if the cursor isn't on a node AND the
            // path under the cursor is a different element (potential
            // re-select target).
            if (hitIdx === -1) {
                const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
                editor._setHover(hit && hit !== editor._selectedElement ? hit : null);
            } else {
                editor._setHover(null);
            }
            return;
        }

        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        editor._setHover(hit);
        return;
    }

    if (editor._dragNodeIndex !== -1) {
        dragNode(editor, pt);
    } else if (editor._selectedElement) {
        const dx = pt.x - editor._lastDragPt.x;
        const dy = pt.y - editor._lastDragPt.y;
        editor._selectedElement.translate(dx, dy);
        editor._updateHandles();
        editor._updateSelectionHighlight();
        editor._lastDragPt = pt;
        if (editor._onChange) editor._onChange();
    }
}

function handleEnd(editor, e) {
    const pt = editor._getMousePoint(e);

    if (editor._isDrawing) {
        finishDrawing(editor, pt);
        return;
    }

    if (editor._isDragging) {
        editor._isDragging = false;
        if (editor._dragNodeIndex !== -1) {
            editor._dragNodeIndex = -1;
            editor.pushState();
        } else if (editor._selectedElement) {
            editor.pushState();
        }
    }
}

function dragNode(editor, pt) {
    // Note: pt is already snapped by handleMove
    const el = editor._selectedElement;
    const idx = editor._dragNodeIndex;
    if (el.type === 'line') {
        if (idx === 0) el.attr({ x1: pt.x, y1: pt.y });
        else el.attr({ x2: pt.x, y2: pt.y });
    } else if (el.type === 'polyline' || el.type === 'polygon') {
        const arr = el.array();
        arr[idx] = [pt.x, pt.y];
        el.plot(arr);
    } else if (el.type === 'path') {
        const arr = el.array();
        const seg = arr[idx];
        if (seg) {
            seg[seg.length - 2] = pt.x;
            seg[seg.length - 1] = pt.y;
            el.plot(arr);
        }
    }
    editor._updateHandles();
    editor._updateSelectionHighlight();
    if (editor._onChange) editor._onChange();
}

function startDrawing(editor, pt) {
    editor._isDrawing = true;
    editor._points = [[pt.x, pt.y]];
    const layer = getActiveLayer(editor);
    
    if (editor._currentMode === 'draw') {
        editor._currentPath = editor._sketchLayer.path(`M ${pt.x} ${pt.y}`)
            .fill('none')
            .stroke({ color: editor._strokeColor, width: editor._strokeWidth, linecap: 'round', linejoin: 'round' })
            .attr('data-layer', layer);
    } else if (editor._currentMode === 'line') {
        editor._currentPath = editor._sketchLayer.line(pt.x, pt.y, pt.x, pt.y)
            .stroke({ color: editor._strokeColor, width: editor._strokeWidth, linecap: 'round' })
            .attr('data-layer', layer);
    } else if (editor._currentMode === 'rect') {
        editor._currentPath = editor._sketchLayer.rect(0, 0)
            .move(pt.x, pt.y)
            .fill('none')
            .stroke({ color: editor._strokeColor, width: editor._strokeWidth })
            .attr('data-layer', layer);
    } else if (editor._currentMode === 'circle') {
        editor._currentPath = editor._sketchLayer.circle(0)
            .center(pt.x, pt.y)
            .fill('none')
            .stroke({ color: editor._strokeColor, width: editor._strokeWidth })
            .attr('data-layer', layer);
    }
}

function updateDrawing(editor, pt) {
    if (!editor._currentPath) return;
    const start = editor._points[0];
    
    if (editor._currentMode === 'draw') {
        editor._points.push([pt.x, pt.y]);
        // Live preview of the freehand line
        const d = editor._currentPath.attr('d') + ` L ${pt.x} ${pt.y}`;
        editor._currentPath.attr('d', d);
    } else if (editor._currentMode === 'line') {
        editor._currentPath.attr({ x2: pt.x, y2: pt.y });
    } else if (editor._currentMode === 'rect') {
        const x = Math.min(pt.x, start[0]);
        const y = Math.min(pt.y, start[1]);
        const w = Math.abs(pt.x - start[0]);
        const h = Math.abs(pt.y - start[1]);
        editor._currentPath.size(w, h).move(x, y);
    } else if (editor._currentMode === 'circle') {
        const r = Math.hypot(pt.x - start[0], pt.y - start[1]);
        editor._currentPath.radius(r);
    }
}

function finishDrawing(editor, pt) {
    editor._isDrawing = false;
    if (!editor._currentPath) return;

    if (editor._currentMode === 'draw') {
        if (editor._points.length > 2) {
            const tol = editor._getDynamicTolerance(2);
            const simplified = ramerDouglasPeucker(editor._points, tol);
            const fitted = fitCurve(editor, simplified, tol * 1.5);
            if (fitted) {
                editor._currentPath.attr('d', fitted);
            }
        } else {
            // Just a dot or tiny line
            editor._currentPath.remove();
            editor._currentPath = null;
            return;
        }
    }

    const finalPath = editor._currentPath;
    editor._currentPath = null;
    editor._points = [];
    
    editor._select(finalPath);
    if (typeof editor.pushState === 'function') editor.pushState();
    if (editor._onChange) editor._onChange();
}


export function updateHandles(editor) {
    if (!editor._handleLayer) return;
    editor._handleLayer.clear();
    if (!editor._selectedElement) return;
    if (editor._currentMode !== 'node') return;

    const nodes = editor._getNodes(editor._selectedElement);
    const validNodes = nodes.filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
    if (validNodes.length === 0) return;

    // Diamond size: dynamic-tolerance baseline with a model-space floor so
    // they don't shrink to invisibility on tall/wide viewboxes. The floor
    // is ~1.5% of the smaller viewport dimension, which is comfortably
    // clickable on any reasonable canvas size.
    const r = editor._getDynamicTolerance(5);
    const view = editor._draw && editor._draw.viewbox ? editor._draw.viewbox() : null;
    const minR = view ? Math.min(view.width, view.height) * 0.008 : 0;
    const baseR = Math.max(r, minR);

    validNodes.forEach((pt, i) => {
        const isDragging = (editor._dragNodeIndex === i);
        const isHovered = (editor._hoverNodeIndex === i);

        // Hover/drag states get bigger handles AND a strong color shift
        // so the user can tell at a glance which node they're about to
        // grab. Idle state uses cyan; hover flips to yellow; drag goes
        // bright red.
        const rad = isDragging ? baseR * 3.2 : (isHovered ? baseR * 2.8 : baseR * 2);
        const hR = rad * 0.7;
        const fillStr = isDragging ? '#ff3300' : (isHovered ? '#ffcc00' : '#00ffff');
        const strokeW = (isDragging || isHovered) ? baseR * 0.9 : baseR * 0.4;
        const strokeC = isDragging ? '#ffffff' : (isHovered ? '#a06b00' : '#0066cc');

        editor._handleLayer.polygon([
            [pt.x, pt.y - hR],
            [pt.x + hR, pt.y],
            [pt.x, pt.y + hR],
            [pt.x - hR, pt.y]
        ])
        .fill(fillStr)
        .stroke({ color: strokeC, width: strokeW, linejoin: 'round' })
        .attr('pointer-events', 'none');
    });
}
