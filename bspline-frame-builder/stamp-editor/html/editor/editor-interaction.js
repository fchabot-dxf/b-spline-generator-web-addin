/**
 * editor-interaction.js — Selection, handles, and mouse/touch logic.
 *
 * The high-level handlers (handleStart, handleMove, handleEnd) are thin:
 * they normalize the event into a snapped model-space point, then
 * dispatch into a per-mode handler from `modeHandlers`. Each handler
 * implements as little as it needs (start / hover / update / finish).
 * Adding a new tool is one entry in `modeHandlers` plus, if it's a
 * drawing tool, one entry in `createDrawingShape` / `updateDrawingShape`.
 *
 * Drag / draw continuations (node-drag, element-translate, freehand
 * stroke-update) are handled before the mode dispatch so they survive
 * a mid-gesture mode change.
 */
import { fitCurve, ramerDouglasPeucker } from './editor-curves.js';
import { startTextAt, beginTextEdit } from './editor-text-session.js';
import { getActiveLayer } from './layers.js';
import { on } from './dom.js';
import { dbg } from './debug.js';


export function initInteraction(editor) {
    const svgNode = editor._draw.node;

    on(svgNode, 'mousedown', (e) => handleStart(editor, e));
    on(window,  'mousemove', (e) => handleMove(editor, e));
    on(window,  'mouseup',   (e) => handleEnd(editor, e));
    // Double-click on a text element opens it for editing (any mode).
    on(svgNode, 'dblclick',  (e) => handleDblClick(editor, e));

    on(svgNode, 'touchstart', (e) => handleStart(editor, e), { passive: false });
    on(window,  'touchmove',  (e) => handleMove(editor, e),  { passive: false });
    on(window,  'touchend',   (e) => handleEnd(editor, e));
}

function handleDblClick(editor, e) {
    const pt = editor._getMousePoint(e);
    const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
    if (hit && hit.type === 'text') {
        e.preventDefault();
        e.stopPropagation();
        if (editor._currentMode !== 'text') editor.setMode('text');
        beginTextEdit(editor, hit);
    }
}

function handleStart(editor, e) {
    dbg('TEXT-DBG', `handleStart fired: type=${e.type} mode=${editor._currentMode} hasEditingText=${!!editor._editingTextEl} ts=${Math.round(e.timeStamp)} target=<${e.target?.tagName}>`);
    if (e.type === 'touchstart' && e.touches.length > 1) {
        dbg('TEXT-DBG', 'handleStart: multi-touch, returning');
        return;
    }
    const pt = editor._snap(editor._getMousePoint(e));
    const handler = getModeHandler(editor._currentMode);
    if (handler.start) handler.start(editor, pt, e);
}

function handleMove(editor, e) {
    const pt = editor._snap(editor._getMousePoint(e));

    // Drawing in progress: stay in update-mode regardless of which tool
    // the user clicked since the drag began.
    if (editor._isDrawing) {
        const handler = getModeHandler(editor._currentMode);
        if (handler.update) handler.update(editor, pt);
        return;
    }

    // Drag in progress: node-drag if a node was grabbed, otherwise
    // element-translate.
    if (editor._isDragging) {
        if (editor._dragNodeIndex !== -1) dragNode(editor, pt);
        else if (editor._selectedElement) translateSelection(editor, pt);
        return;
    }

    // Idle hover.
    const handler = getModeHandler(editor._currentMode);
    if (handler.hover) handler.hover(editor, pt);
}

function handleEnd(editor, e) {
    if (editor._isDrawing) {
        const handler = getModeHandler(editor._currentMode);
        if (handler.finish) handler.finish(editor);
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


// ─── Mode handlers ──────────────────────────────────────────────────

const selectHandler = {
    start(editor, pt) {
        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        dbg('TEXT-DBG', `handleStart hit-test: ${hit ? `HIT type=${hit.type}` : 'no hit'}`);
        if (hit) {
            editor._isDragging = true;
            editor._lastDragPt = pt;
            if (editor._selectedElement !== hit) editor._select(hit);
        } else {
            editor._deselect();
            editor._isDragging = true;
            editor._lastDragPt = pt;
        }
    },
    hover(editor, pt) {
        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        editor._setHover(hit);
    },
};

/**
 * Node mode owns its own click flow: nodes first, then path-body to
 * (re-)select an element, never element-translate, never deselect on
 * empty-space click. This keeps the node-edit context stable while the
 * user works on a path.
 */
const nodeHandler = {
    start(editor, pt) {
        if (editor._selectedElement) {
            const hitIdx = findNodeAt(editor, pt);
            if (hitIdx !== -1) {
                editor._isDragging = true;
                editor._dragNodeIndex = hitIdx;
                editor._lastDragPt = pt;
                return;
            }
        }
        // Missed all nodes — try to (re-)select the path under the cursor.
        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        if (hit && hit !== editor._selectedElement) editor._select(hit);
        // Whether we hit a path or empty space, do NOT initiate an
        // element-translate drag and do NOT deselect.
    },
    hover(editor, pt) {
        // Without a selection, fall back to the standard element-hover
        // halo so the user can see what they're about to pick.
        if (!editor._selectedElement) {
            const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
            editor._setHover(hit);
            return;
        }
        // With a selection: prioritize node hit-test (so the diamond
        // lights up), suppress element-hover on the selected path.
        const hitIdx = findNodeAt(editor, pt);
        if (editor._hoverNodeIndex !== hitIdx) {
            editor._hoverNodeIndex = hitIdx;
            editor._updateHandles();
        }
        if (hitIdx === -1) {
            // Off all nodes — show element-hover for OTHER elements
            // (re-select hint) but not the selected one.
            const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
            editor._setHover(hit && hit !== editor._selectedElement ? hit : null);
        } else {
            editor._setHover(null);
        }
    },
};

/**
 * Text mode: clicking an existing text picks it up for editing,
 * everything else places a new text at the click point.
 */
const textHandler = {
    start(editor, pt, e) {
        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        if (hit && hit.type === 'text') {
            dbg('TEXT-DBG', 'text-mode start: hit text → beginTextEdit');
            beginTextEdit(editor, hit);
            return;
        }
        if (hit) {
            dbg('TEXT-DBG', 'text-mode start: hit non-text → startTextAt');
            editor._deselect();
        } else {
            dbg('TEXT-DBG', 'text-mode start: no hit → startTextAt');
        }
        startTextAt(editor, pt, e);
    },
    hover(editor, pt) {
        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        editor._setHover(hit);
    },
};

/**
 * Drawing tools (freehand pen, line, rect, circle) all share a
 * start→update→finish lifecycle; the difference is just the SVG.js
 * primitive used and how the live-preview shape responds to mouse
 * movement.
 */
function makeDrawingHandler(modeId) {
    return {
        start(editor, pt) {
            editor._deselect();
            editor._isDrawing = true;
            editor._points = [[pt.x, pt.y]];
            editor._currentPath = createDrawingShape(editor, modeId, pt);
        },
        update(editor, pt) {
            updateDrawingShape(editor, modeId, pt);
        },
        finish(editor) {
            finishDrawing(editor, modeId);
        },
    };
}

const modeHandlers = {
    select: selectHandler,
    node:   nodeHandler,
    text:   textHandler,
    draw:   makeDrawingHandler('draw'),
    line:   makeDrawingHandler('line'),
    rect:   makeDrawingHandler('rect'),
    circle: makeDrawingHandler('circle'),
};

function getModeHandler(mode) {
    return modeHandlers[mode] || selectHandler;
}


// ─── Shared helpers ────────────────────────────────────────────────

function findNodeAt(editor, pt) {
    if (!editor._selectedElement) return -1;
    const nodes = editor._getNodes(editor._selectedElement);
    const tol = editor._getDynamicTolerance(15);
    return nodes.findIndex(n => Math.hypot(n.x - pt.x, n.y - pt.y) < tol);
}

function dragNode(editor, pt) {
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

function translateSelection(editor, pt) {
    const dx = pt.x - editor._lastDragPt.x;
    const dy = pt.y - editor._lastDragPt.y;
    editor._selectedElement.translate(dx, dy);
    editor._updateHandles();
    editor._updateSelectionHighlight();
    editor._lastDragPt = pt;
    if (editor._onChange) editor._onChange();
}


// ─── Drawing primitives ────────────────────────────────────────────

function createDrawingShape(editor, modeId, pt) {
    const layer = getActiveLayer(editor);
    const stroke = { color: editor._strokeColor, width: editor._strokeWidth };
    if (modeId === 'draw') {
        return editor._sketchLayer.path(`M ${pt.x} ${pt.y}`)
            .fill('none')
            .stroke({ ...stroke, linecap: 'round', linejoin: 'round' })
            .attr('data-layer', layer);
    }
    if (modeId === 'line') {
        return editor._sketchLayer.line(pt.x, pt.y, pt.x, pt.y)
            .stroke({ ...stroke, linecap: 'round' })
            .attr('data-layer', layer);
    }
    if (modeId === 'rect') {
        return editor._sketchLayer.rect(0, 0)
            .move(pt.x, pt.y)
            .fill('none')
            .stroke(stroke)
            .attr('data-layer', layer);
    }
    if (modeId === 'circle') {
        return editor._sketchLayer.circle(0)
            .center(pt.x, pt.y)
            .fill('none')
            .stroke(stroke)
            .attr('data-layer', layer);
    }
    return null;
}

function updateDrawingShape(editor, modeId, pt) {
    if (!editor._currentPath) return;
    const start = editor._points[0];
    if (modeId === 'draw') {
        editor._points.push([pt.x, pt.y]);
        // Live preview of the freehand stroke. Refit happens on finish.
        const d = editor._currentPath.attr('d') + ` L ${pt.x} ${pt.y}`;
        editor._currentPath.attr('d', d);
    } else if (modeId === 'line') {
        editor._currentPath.attr({ x2: pt.x, y2: pt.y });
    } else if (modeId === 'rect') {
        const x = Math.min(pt.x, start[0]);
        const y = Math.min(pt.y, start[1]);
        const w = Math.abs(pt.x - start[0]);
        const h = Math.abs(pt.y - start[1]);
        editor._currentPath.size(w, h).move(x, y);
    } else if (modeId === 'circle') {
        const r = Math.hypot(pt.x - start[0], pt.y - start[1]);
        editor._currentPath.radius(r);
    }
}

function finishDrawing(editor, modeId) {
    editor._isDrawing = false;
    if (!editor._currentPath) return;

    if (modeId === 'draw') {
        if (editor._points.length > 2) {
            const tol = editor._getDynamicTolerance(2);
            const simplified = ramerDouglasPeucker(editor._points, tol);
            const fitted = fitCurve(editor, simplified, tol * 1.5);
            if (fitted) editor._currentPath.attr('d', fitted);
        } else {
            // Just a dot or tiny line — discard.
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


// ─── Selection handles (node mode) ─────────────────────────────────

export function updateHandles(editor) {
    if (!editor._handleLayer) return;
    editor._handleLayer.clear();
    if (!editor._selectedElement) return;
    if (editor._currentMode !== 'node') return;

    const nodes = editor._getNodes(editor._selectedElement);
    const validNodes = nodes.filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
    if (validNodes.length === 0) return;

    // Diamond size: dynamic-tolerance baseline with a model-space floor
    // so they stay visible on tall/wide viewboxes. The floor is ~1.5%
    // of the smaller viewport dimension.
    const r = editor._getDynamicTolerance(5);
    const view = editor._draw && editor._draw.viewbox ? editor._draw.viewbox() : null;
    const minR = view ? Math.min(view.width, view.height) * 0.008 : 0;
    const baseR = Math.max(r, minR);

    validNodes.forEach((pt, i) => {
        const isDragging = (editor._dragNodeIndex === i);
        const isHovered = (editor._hoverNodeIndex === i);

        // Idle = cyan, hover = yellow (bigger), drag = red (biggest).
        const rad = isDragging ? baseR * 3.2 : (isHovered ? baseR * 2.8 : baseR * 2);
        const hR = rad * 0.7;
        const fillStr = isDragging ? '#ff3300' : (isHovered ? '#ffcc00' : '#00ffff');
        const strokeW = (isDragging || isHovered) ? baseR * 0.9 : baseR * 0.4;
        const strokeC = isDragging ? '#ffffff' : (isHovered ? '#a06b00' : '#0066cc');

        editor._handleLayer.polygon([
            [pt.x, pt.y - hR],
            [pt.x + hR, pt.y],
            [pt.x, pt.y + hR],
            [pt.x - hR, pt.y],
        ])
        .fill(fillStr)
        .stroke({ color: strokeC, width: strokeW, linejoin: 'round' })
        .attr('pointer-events', 'none');
    });
}
