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
import { getActiveLayer, ensureActiveLayer, applyLayerState } from './layers.js';
import { worldBbox } from './editor-coords.js';
import { setEditorStatusHint, restoreModeHint, ANCHOR_HINT, maybeShowExpandCallout } from './editor-ui.js';
import { on } from './dom.js';
import { dbg } from './debug.js';
import { fusLog } from '../core/fusion-bridge.js';
import {
    renderTransformHandles, hitTestHandle,
    beginTransform, applyTransformDrag,
} from './editor-transform-handles.js';
import { updateMarquee, finalizeMarquee, clearMarquee } from './editor-marquee.js';
import { startEraserStroke, updateEraserStroke, finishEraserStroke } from './editor-eraser.js';

function _strokeLog(msg) {
    dbg('STROKE', msg);
    try { fusLog(`[STROKE] ${msg}`); } catch (_) {}
}


export function initInteraction(editor) {
    const svgNode = editor._draw.node;
    on(svgNode, 'mousedown', (e) => handleStart(editor, e));
    on(window,  'mousemove', (e) => handleMove(editor, e));
    on(window,  'mouseup',   (e) => handleEnd(editor, e));
    on(svgNode, 'dblclick',  (e) => handleDblClick(editor, e));
    on(svgNode, 'touchstart', (e) => handleStart(editor, e), { passive: false });
    on(window,  'touchmove',  (e) => handleMove(editor, e),  { passive: false });
    on(window,  'touchend',   (e) => handleEnd(editor, e));
}

function handleDblClick(editor, e) {
    if (editor._anchorMode && editor._currentMode === 'draw') {
        e.preventDefault(); e.stopPropagation();
        _commitAnchorPath(editor); return;
    }
    const pt = editor._getMousePoint(e);
    const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
    if (hit && hit.type === 'text') {
        e.preventDefault(); e.stopPropagation();
        if (editor._currentMode !== 'text') editor.setMode('text');
        beginTextEdit(editor, hit);
    }
}

function handleStart(editor, e) {
    dbg('TEXT-DBG', `handleStart fired: type=${e.type} mode=${editor._currentMode} hasEditingText=${!!editor._editingTextEl} ts=${Math.round(e.timeStamp)} target=<${e.target?.tagName}>`);
    if (e.type === 'touchstart' && e.touches.length > 1) return;
    const pt = editor._snap(editor._getMousePoint(e));
    const handler = getModeHandler(editor._currentMode);
    if (handler.start) handler.start(editor, pt, e);
}

function handleMove(editor, e) {
    const pt = editor._snap(editor._getMousePoint(e));
    if (editor._isDrawing) {
        const handler = getModeHandler(editor._currentMode);
        if (handler.update) handler.update(editor, pt);
        return;
    }
    if (editor._isDragging) {
        if (editor._transformState) {
            applyTransformDrag(editor, editor._transformState, pt, { shift: !!e.shiftKey });
            if (editor._transformState.moved) editor._dragMoved = true;
            return;
        }
        if (editor._dragNodeIndex !== -1) { dragNode(editor, pt); return; }
        if (editor._marqueeStart) { updateMarquee(editor, pt); return; }
        if ((editor._selectedElements || []).length) translateSelection(editor, pt);
        return;
    }
    const handler = getModeHandler(editor._currentMode);
    if (handler.hover) handler.hover(editor, pt);
}

function handleEnd(editor, e) {
    if (editor._isDrawing) {
        const handler = getModeHandler(editor._currentMode);
        _strokeLog(`handleEnd  isDrawing=true  mode=${editor._currentMode}  hasFinish=${!!handler.finish}`);
        if (handler.finish) handler.finish(editor);
        return;
    }
    if (editor._isDragging) {
        editor._isDragging = false;
        const wasNodeDrag  = editor._dragNodeIndex !== -1;
        const wasTransform = !!editor._transformState;
        const wasMarquee   = !!editor._marqueeStart;
        if (wasNodeDrag) editor._dragNodeIndex = -1;
        if (wasTransform) editor._transformState = null;
        if (wasMarquee) {
            finalizeMarquee(editor);
            editor._dragMoved = false;
            return;
        }
        if (editor._dragMoved) editor.pushState();
        editor._dragMoved = false;
        if (wasTransform) editor._updateHandles();
    }
}


// ─── Mode handlers ──────────────────────────────────────────────────

const selectHandler = {
    start(editor, pt, e) {
        const shift = !!(e && e.shiftKey);
        if ((editor._selectedElements || []).length) {
            const grabbed = hitTestHandle(editor._transformHandles, pt);
            if (grabbed) {
                editor._dragMoved = false;
                editor._isDragging = true;
                editor._transformState = beginTransform(editor, grabbed, pt);
                editor._lastDragPt = pt;
                return;
            }
        }
        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        editor._dragMoved = false;
        if (hit) {
            editor._isDragging = true;
            editor._lastDragPt = pt;
            if (shift) editor._selectAdd(hit);
            else if (!(editor._selectedElements || []).includes(hit)) editor._select(hit);
            return;
        }
        if (!shift) editor._deselect();
        editor._isDragging      = true;
        editor._lastDragPt      = pt;
        editor._marqueeStart    = { x: pt.x, y: pt.y };
        editor._marqueeAdditive = shift;
        editor._marqueeRect     = null;
    },
    hover(editor, pt) {
        if ((editor._selectedElements || []).length
            && hitTestHandle(editor._transformHandles, pt)) {
            editor._setHover(null); return;
        }
        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        editor._setHover(hit);
    },
};

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
        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        if (hit && hit !== editor._selectedElement) editor._select(hit);
    },
    hover(editor, pt) {
        if (!editor._selectedElement) {
            const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
            editor._setHover(hit); return;
        }
        const hitIdx = findNodeAt(editor, pt);
        if (editor._hoverNodeIndex !== hitIdx) {
            editor._hoverNodeIndex = hitIdx;
            editor._updateHandles();
        }
        if (hitIdx === -1) {
            const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
            editor._setHover(hit && hit !== editor._selectedElement ? hit : null);
        } else editor._setHover(null);
    },
};

const textHandler = {
    start(editor, pt, e) {
        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        if (hit && hit.type === 'text') { beginTextEdit(editor, hit); return; }
        if (hit) editor._deselect();
        startTextAt(editor, pt, e);
    },
    hover(editor, pt) {
        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        editor._setHover(hit);
    },
};

function makeDrawingHandler(modeId) {
    return {
        start(editor, pt) {
            editor._deselect();
            editor._isDrawing = true;
            editor._points = [[pt.x, pt.y]];
            editor._currentPath = createDrawingShape(editor, modeId, pt);
        },
        update(editor, pt) { updateDrawingShape(editor, modeId, pt); },
        finish(editor) { finishDrawing(editor, modeId); },
    };
}

const drawHandler = {
    start(editor, pt, e) {
        if (editor._anchorPreviewLine || editor._anchorKeyHandler) {
            _cleanupAnchorMode(editor);
            editor._currentPath = null;
            editor._anchorPts   = [];
        }
        if (editor._anchorMode) { editor._anchorDownPt = pt; return; }
        editor._deselect();
        editor._isDrawing      = true;
        editor._anchorDownPt   = pt;
        editor._anchorFreehand = false;
        editor._points         = [[pt.x, pt.y]];
        editor._currentPath    = createDrawingShape(editor, 'draw', pt);
    },
    update(editor, pt) {
        if (editor._anchorMode) { _updateAnchorPreview(editor, pt); return; }
        if (!editor._anchorFreehand) {
            const dp = editor._anchorDownPt;
            if (dp) {
                const dist = Math.hypot(pt.x - dp.x, pt.y - dp.y);
                if (dist > editor._getDynamicTolerance(3)) editor._anchorFreehand = true;
            }
        }
        if (editor._anchorFreehand) updateDrawingShape(editor, 'draw', pt);
    },
    finish(editor) {
        if (editor._anchorMode) {
            const pt = editor._anchorDownPt;
            if (pt) _addAnchorPoint(editor, pt);
            return;
        }
        if (editor._anchorFreehand) {
            editor._anchorFreehand = false;
            finishDrawing(editor, 'draw');
        } else {
            editor._anchorFreehand = false;
            _startAnchorMode(editor, editor._anchorDownPt);
        }
    },
};

function _startAnchorMode(editor, pt) {
    editor._anchorMode = true;
    editor._anchorPts  = [[pt.x, pt.y]];
    if (editor._currentPath) editor._currentPath.attr('d', `M ${pt.x} ${pt.y}`);
    _ensureAnchorPreview(editor, pt);
    _installAnchorKeyHandler(editor);
    setEditorStatusHint(ANCHOR_HINT);
}

function _addAnchorPoint(editor, pt) {
    editor._anchorPts.push([pt.x, pt.y]);
    if (editor._currentPath) {
        const d = editor._currentPath.attr('d') + ` L ${pt.x} ${pt.y}`;
        editor._currentPath.attr('d', d);
    }
    if (editor._anchorPreviewLine) {
        editor._anchorPreviewLine.attr({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
    }
}

function _ensureAnchorPreview(editor, fromPt) {
    if (editor._anchorPreviewLine) {
        editor._anchorPreviewLine.attr({ x1: fromPt.x, y1: fromPt.y, x2: fromPt.x, y2: fromPt.y });
        return;
    }
    const color = editor._strokeColor || '#888888';
    const width = editor._strokeWidth  || 1;
    editor._anchorPreviewLine = editor._sketchLayer
        .line(fromPt.x, fromPt.y, fromPt.x, fromPt.y)
        .stroke({ color, width, dasharray: '5 4', opacity: 0.55 })
        .attr('pointer-events', 'none');
}

function _updateAnchorPreview(editor, toPt) {
    if (!editor._anchorPreviewLine) return;
    const pts = editor._anchorPts;
    if (!pts || pts.length === 0) return;
    const last = pts[pts.length - 1];
    editor._anchorPreviewLine.attr({ x1: last[0], y1: last[1], x2: toPt.x, y2: toPt.y });
}

function _commitAnchorPath(editor) {
    if (!editor._anchorMode) return;
    _cleanupAnchorMode(editor);
    if (!editor._currentPath || !editor._anchorPts || editor._anchorPts.length < 2) {
        if (editor._currentPath) editor._currentPath.remove();
        editor._currentPath = null;
        editor._anchorPts   = [];
        editor._points      = [];
        editor._isDrawing   = false;
        return;
    }
    const tol    = editor._getDynamicTolerance(2);
    const fitted = fitCurve(editor, editor._anchorPts, tol * 1.5);
    if (fitted) {
        // BUG-27 parity with finishDrawing: close anchor-mode paths
        // with Z when in fill / both mode so they rasterize as regions.
        const mode = editor._fillMode || 'stroke';
        const d = (mode === 'fill' || mode === 'both') && !fitted.trim().endsWith('Z')
            ? `${fitted} Z`
            : fitted;
        editor._currentPath.attr('d', d);
    }
    const finalPath     = editor._currentPath;
    editor._currentPath = null;
    editor._anchorPts   = [];
    editor._points      = [];
    editor._isDrawing   = false;
    editor._select(finalPath);
    applyLayerState(editor);
    if (typeof editor.pushState === 'function') editor.pushState();
    if (editor._onChange) editor._onChange();
    try { maybeShowExpandCallout(editor); } catch (_) {}
}

function _cancelAnchorMode(editor) {
    _cleanupAnchorMode(editor);
    if (editor._currentPath) { editor._currentPath.remove(); editor._currentPath = null; }
    editor._anchorPts = [];
    editor._points    = [];
    editor._isDrawing = false;
}

function _cleanupAnchorMode(editor) {
    editor._anchorMode = false;
    if (editor._anchorPreviewLine) {
        editor._anchorPreviewLine.remove();
        editor._anchorPreviewLine = null;
    }
    if (editor._anchorKeyHandler) {
        window.removeEventListener('keydown', editor._anchorKeyHandler);
        editor._anchorKeyHandler = null;
    }
    try { restoreModeHint(editor); } catch (_) {}
}

function _installAnchorKeyHandler(editor) {
    if (editor._anchorKeyHandler) return;
    editor._anchorKeyHandler = (e) => {
        if (!editor._anchorMode || editor._currentMode !== 'draw') {
            window.removeEventListener('keydown', editor._anchorKeyHandler);
            editor._anchorKeyHandler = null;
            return;
        }
        if (e.key === 'Enter')      { e.preventDefault(); _commitAnchorPath(editor); }
        else if (e.key === 'Escape') { e.preventDefault(); _cancelAnchorMode(editor); }
    };
    window.addEventListener('keydown', editor._anchorKeyHandler);
}

const eraseHandler = {
    start(editor, pt) {
        editor._deselect();
        editor._isDrawing = true;
        startEraserStroke(editor, pt);
    },
    update(editor, pt) { updateEraserStroke(editor, pt); },
    finish(editor) {
        finishEraserStroke(editor).catch(e => _strokeLog(`eraser finish threw: ${e.message}`));
    },
};

const modeHandlers = {
    select: selectHandler,
    node:   nodeHandler,
    text:   textHandler,
    draw:   drawHandler,
    line:   makeDrawingHandler('line'),
    rect:   makeDrawingHandler('rect'),
    circle: makeDrawingHandler('circle'),
    erase:  eraseHandler,
};

function getModeHandler(mode) { return modeHandlers[mode] || selectHandler; }


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
    editor._dragMoved = true;
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
    if (dx !== 0 || dy !== 0) editor._dragMoved = true;
    for (const el of (editor._selectedElements || [])) {
        el.translate(dx, dy);
    }
    editor._updateHandles();
    editor._updateSelectionHighlight();
    editor._lastDragPt = pt;
    if (editor._onChange) editor._onChange();
}


// ─── Drawing primitives ────────────────────────────────────────────

function createDrawingShape(editor, modeId, pt) {
    const layer = ensureActiveLayer(editor);
    const stroke = { color: editor._strokeColor, width: editor._strokeWidth };
    // BUG-27 fill mode: pick fill + stroke based on the user's choice in
    // the editor toolbar. Lines never get filled (no interior). Pen
    // paths in 'fill' mode are auto-closed with Z at commit time so the
    // rasterizer treats the enclosed area as a region.
    const mode = editor._fillMode || 'stroke';
    const fillColor = editor._fillColor || editor._strokeColor || '#000000';
    const fillForShape = (mode === 'stroke') ? 'none' : fillColor;
    const strokeForShape = (mode === 'fill')
        ? { color: 'none', width: 0 }
        : stroke;
    if (modeId === 'draw') {
        return editor._sketchLayer.path(`M ${pt.x} ${pt.y}`)
            .fill(fillForShape)
            .stroke({ ...strokeForShape, linecap: 'round', linejoin: 'round' })
            .attr('data-layer', layer);
    }
    if (modeId === 'line') {
        // Lines are stroke-only by nature.
        return editor._sketchLayer.line(pt.x, pt.y, pt.x, pt.y)
            .stroke({ ...stroke, linecap: 'round' })
            .attr('data-layer', layer);
    }
    if (modeId === 'rect') {
        return editor._sketchLayer.rect(0, 0)
            .move(pt.x, pt.y)
            .fill(fillForShape)
            .stroke(strokeForShape)
            .attr('data-layer', layer);
    }
    if (modeId === 'circle') {
        return editor._sketchLayer.circle(0)
            .center(pt.x, pt.y)
            .fill(fillForShape)
            .stroke(strokeForShape)
            .attr('data-layer', layer);
    }
    return null;
}

function updateDrawingShape(editor, modeId, pt) {
    if (!editor._currentPath) return;
    const start = editor._points[0];
    if (modeId === 'draw') {
        editor._points.push([pt.x, pt.y]);
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
    _strokeLog(`finishDrawing  ENTER  modeId=${modeId}  hasCurrentPath=${!!editor._currentPath}  pointsLen=${editor._points.length}`);
    editor._isDrawing = false;
    if (!editor._currentPath) {
        _strokeLog(`finishDrawing  EARLY-RETURN  reason=no-currentPath`);
        return;
    }
    if (modeId === 'draw') {
        if (editor._points.length > 2) {
            const tol = editor._getDynamicTolerance(2);
            const simplified = ramerDouglasPeucker(editor._points, tol);
            const fitted = fitCurve(editor, simplified, tol * 1.5);
            if (fitted) {
                // BUG-27: in fill / both mode, auto-close the path with Z
                // so the rasterizer treats the enclosed region as a fill.
                const mode = editor._fillMode || 'stroke';
                const d = (mode === 'fill' || mode === 'both') && !fitted.trim().endsWith('Z')
                    ? `${fitted} Z`
                    : fitted;
                editor._currentPath.attr('d', d);
            }
        } else {
            editor._currentPath.remove();
            editor._currentPath = null;
            return;
        }
    }
    const finalPath = editor._currentPath;
    editor._currentPath = null;
    editor._points = [];
    editor._select(finalPath);
    applyLayerState(editor);
    if (typeof editor.pushState === 'function') editor.pushState();
    if (editor._onChange) editor._onChange();
    try { maybeShowExpandCallout(editor); } catch (_) {}
}


// ─── Selection handles ─────────────────────────────────────────────

export function updateHandles(editor) {
    if (!editor._handleLayer) return;
    editor._handleLayer.clear();
    editor._transformHandles = [];
    const sel = editor._selectedElements || [];
    if (!sel.length) return;
    if (editor._currentMode !== 'node' && editor._currentMode !== 'select') return;

    if (editor._currentMode === 'select') {
        try {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            let any = false;
            for (const el of sel) {
                const b = worldBbox(el);
                if (!b || !Number.isFinite(b.w) || !Number.isFinite(b.h)) continue;
                any = true;
                if (b.x  < minX) minX = b.x;
                if (b.y  < minY) minY = b.y;
                if (b.x2 > maxX) maxX = b.x2;
                if (b.y2 > maxY) maxY = b.y2;
            }
            if (!any) return;
            const bb = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
            const view = (editor._draw && editor._draw.viewbox) ? editor._draw.viewbox() : null;
            const strokeW = view ? Math.max(view.width, view.height) * 0.0025 : 1;
            editor._handleLayer.rect(bb.w, bb.h)
                .move(bb.x, bb.y)
                .fill('none')
                .stroke({ color: '#ffcc00', width: strokeW, dasharray: `${strokeW * 4},${strokeW * 2}` })
                .attr('pointer-events', 'none');
            editor._transformHandles = renderTransformHandles(editor);
        } catch (_) {}
        return;
    }

    const nodes = editor._getNodes(editor._selectedElement);
    const validNodes = nodes.filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
    if (validNodes.length === 0) return;

    const r = editor._getDynamicTolerance(5);
    const view = editor._draw && editor._draw.viewbox ? editor._draw.viewbox() : null;
    const minR = view ? Math.min(view.width, view.height) * 0.008 : 0;
    const baseR = Math.max(r, minR);

    validNodes.forEach((pt, i) => {
        const isDragging = (editor._dragNodeIndex === i);
        const isHovered = (editor._hoverNodeIndex === i);
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
