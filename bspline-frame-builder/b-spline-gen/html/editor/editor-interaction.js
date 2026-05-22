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

/** STROKE diagnostic helper — traces the drawing lifecycle so we can see
 *  which paths drop a pushState. Dual-pipes to Fusion log file so it
 *  shows up in b_spline_gen_log.txt regardless of window.__editorDebug. */
function _strokeLog(msg) {
    dbg('STROKE', msg);
    try { fusLog(`[STROKE] ${msg}`); } catch (_) {}
}


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
    // In anchor mode, the second click of a double-click commits the path.
    if (editor._anchorMode && editor._currentMode === 'draw') {
        e.preventDefault();
        e.stopPropagation();
        _commitAnchorPath(editor);
        return;
    }
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
        _strokeLog(`handleEnd  isDrawing=true  mode=${editor._currentMode}  hasFinish=${!!handler.finish}  hasCurrentPath=${!!editor._currentPath}`);
        if (handler.finish) handler.finish(editor);
        else _strokeLog(`handleEnd  WARNING: no finish handler for mode=${editor._currentMode} — stroke may be orphaned (path stays in DOM, no pushState fires)`);
        return;
    }
    if (editor._isDragging) {
        editor._isDragging = false;
        const wasNodeDrag = editor._dragNodeIndex !== -1;
        if (wasNodeDrag) editor._dragNodeIndex = -1;
        // Only push state if the drag actually moved something. A plain
        // click (mousedown→mouseup with no intervening movement) used to
        // emit a noop snapshot every time, padding the undo stack with
        // identical entries and making Ctrl+Z feel like it took multiple
        // presses to undo one stroke. _dragMoved is set true the first
        // time dragNode/translateSelection mutates the element.
        if (editor._dragMoved) {
            editor.pushState();
        }
        editor._dragMoved = false;
    }
}


// ─── Mode handlers ──────────────────────────────────────────────────

const selectHandler = {
    start(editor, pt) {
        const hit = editor._getNearbyElement(pt, editor._getDynamicTolerance(10));
        dbg('TEXT-DBG', `handleStart hit-test: ${hit ? `HIT type=${hit.type}` : 'no hit'}`);
        editor._dragMoved = false;
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
            _strokeLog(`handler.start  modeId=${modeId}  pt=(${pt.x.toFixed(2)},${pt.y.toFixed(2)})  pathCreated=${!!editor._currentPath}  sketchChildren=${editor._sketchLayer.children().toArray().length}`);
        },
        update(editor, pt) {
            updateDrawingShape(editor, modeId, pt);
        },
        finish(editor) {
            finishDrawing(editor, modeId);
        },
    };
}

/**
 * Anchor-click pen handler for 'draw' mode.
 *
 * Intent detection (per gesture):
 *   • Click (mouse barely moves < threshold) → place anchor point.
 *     First click enters anchor mode; subsequent clicks add anchors.
 *     Double-click or Enter key commits the path; Escape cancels.
 *   • Drag (mouse moves beyond threshold before mouseup) → freehand
 *     stroke, exactly like the previous behaviour.
 *
 * Anchor state lives on the editor instance:
 *   _anchorMode        {boolean}  true while collecting anchor points
 *   _anchorPts         {Array}    [[x,y], …]
 *   _anchorDownPt      {{x,y}}    position of the most-recent mousedown
 *   _anchorFreehand    {boolean}  true once drag threshold is exceeded
 *   _anchorPreviewLine {SVG.Line} dashed rubberband from last anchor
 *   _anchorKeyHandler  {Function} keydown listener ref (for removal)
 */
const drawHandler = {
    start(editor, pt, e) {
        // Clean up orphaned anchor state (e.g. mode was switched mid-path
        // via a keyboard shortcut that bypassed _cancelDrawing).
        if (editor._anchorPreviewLine || editor._anchorKeyHandler) {
            _cleanupAnchorMode(editor);
            editor._currentPath = null;
            editor._anchorPts   = [];
        }

        if (editor._anchorMode) {
            // Already collecting anchors — record where mousedown fired.
            editor._anchorDownPt = pt;
            return;
        }

        // Fresh start: create the live path; decide freehand vs anchor on mouseup.
        editor._deselect();
        editor._isDrawing      = true;
        editor._anchorDownPt   = pt;
        editor._anchorFreehand = false;
        editor._points         = [[pt.x, pt.y]];
        editor._currentPath    = createDrawingShape(editor, 'draw', pt);
        _strokeLog(`drawHandler.start  pt=(${pt.x.toFixed(2)},${pt.y.toFixed(2)})  pathCreated=${!!editor._currentPath}`);
    },
    update(editor, pt) {
        if (editor._anchorMode) {
            _updateAnchorPreview(editor, pt);
            return;
        }
        if (!editor._anchorFreehand) {
            const dp = editor._anchorDownPt;
            if (dp) {
                const dist = Math.hypot(pt.x - dp.x, pt.y - dp.y);
                if (dist > editor._getDynamicTolerance(3)) {
                    editor._anchorFreehand = true;
                }
            }
        }
        if (editor._anchorFreehand) {
            updateDrawingShape(editor, 'draw', pt);
        }
    },
    finish(editor) {
        if (editor._anchorMode) {
            // Mouse-up in anchor mode → place anchor at the mousedown position.
            const pt = editor._anchorDownPt;
            if (pt) _addAnchorPoint(editor, pt);
            // Keep _isDrawing = true so subsequent events keep routing here.
            return;
        }
        if (editor._anchorFreehand) {
            // User dragged — commit as a normal freehand stroke.
            editor._anchorFreehand = false;
            finishDrawing(editor, 'draw');
        } else {
            // Short click — enter anchor mode with the first anchor point.
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
    // Swap the status-hint banner so the user sees the commit/cancel
    // instructions while in anchor mode. See BUG-02.
    setEditorStatusHint(ANCHOR_HINT);
    _strokeLog(`_startAnchorMode  firstAnchor=(${pt.x.toFixed(2)},${pt.y.toFixed(2)})`);
}

function _addAnchorPoint(editor, pt) {
    editor._anchorPts.push([pt.x, pt.y]);
    if (editor._currentPath) {
        const d = editor._currentPath.attr('d') + ` L ${pt.x} ${pt.y}`;
        editor._currentPath.attr('d', d);
    }
    // Move the rubberband origin to the new anchor.
    if (editor._anchorPreviewLine) {
        editor._anchorPreviewLine.attr({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
    }
    _strokeLog(`_addAnchorPoint  pt=(${pt.x.toFixed(2)},${pt.y.toFixed(2)})  total=${editor._anchorPts.length}`);
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
    _strokeLog(`_commitAnchorPath  pts=${editor._anchorPts?.length}`);
    _cleanupAnchorMode(editor);

    if (!editor._currentPath || !editor._anchorPts || editor._anchorPts.length < 2) {
        if (editor._currentPath) editor._currentPath.remove();
        editor._currentPath = null;
        editor._anchorPts   = [];
        editor._points      = [];
        editor._isDrawing   = false;
        return;
    }

    // Smooth through the anchor points with fitCurve for a clean bezier result.
    const tol    = editor._getDynamicTolerance(2);
    const fitted = fitCurve(editor, editor._anchorPts, tol * 1.5);
    if (fitted) editor._currentPath.attr('d', fitted);

    const finalPath     = editor._currentPath;
    editor._currentPath = null;
    editor._anchorPts   = [];
    editor._points      = [];
    editor._isDrawing   = false;
    editor._select(finalPath);
    // Newly-appended anchor path needs the same layer-class treatment
    // freehand strokes get in finishDrawing (BUG-04 parity).
    applyLayerState(editor);
    _strokeLog(`_commitAnchorPath  COMMIT  about to pushState`);
    if (typeof editor.pushState === 'function') editor.pushState();
    if (editor._onChange) editor._onChange();
    // First-shape onboarding pointer at the Expand tool (BUG-06).
    try { maybeShowExpandCallout(editor); } catch (_) {}
}

function _cancelAnchorMode(editor) {
    _strokeLog(`_cancelAnchorMode`);
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
    // Restore the regular per-mode hint (usually 'draw' since the user
    // is still on the pen tool — but defer to the editor's current mode
    // in case anything switched it out from under us).
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
        if (e.key === 'Enter') {
            e.preventDefault();
            _commitAnchorPath(editor);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            _cancelAnchorMode(editor);
        }
    };
    window.addEventListener('keydown', editor._anchorKeyHandler);
}

const modeHandlers = {
    select: selectHandler,
    node:   nodeHandler,
    text:   textHandler,
    draw:   drawHandler,
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
    editor._selectedElement.translate(dx, dy);
    editor._updateHandles();
    editor._updateSelectionHighlight();
    editor._lastDragPt = pt;
    if (editor._onChange) editor._onChange();
}


// ─── Drawing primitives ────────────────────────────────────────────

function createDrawingShape(editor, modeId, pt) {
    // First-draw auto-create: if the user starts drawing on a session
    // with no layers yet (the default "none on open" state), spin up
    // "Layer 1" and make it active so the new element has somewhere
    // to live. Bundled into the next pushState so undo = one click.
    const layer = ensureActiveLayer(editor);
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
    _strokeLog(`finishDrawing  ENTER  modeId=${modeId}  hasCurrentPath=${!!editor._currentPath}  pointsLen=${editor._points.length}`);
    editor._isDrawing = false;
    if (!editor._currentPath) {
        _strokeLog(`finishDrawing  EARLY-RETURN  reason=no-currentPath  (NO pushState)`);
        return;
    }

    if (modeId === 'draw') {
        if (editor._points.length > 2) {
            const tol = editor._getDynamicTolerance(2);
            const simplified = ramerDouglasPeucker(editor._points, tol);
            const fitted = fitCurve(editor, simplified, tol * 1.5);
            if (fitted) editor._currentPath.attr('d', fitted);
        } else {
            // Just a dot or tiny line — discard.
            _strokeLog(`finishDrawing  DISCARD  modeId=draw  pointsLen=${editor._points.length}  (path removed, NO pushState)`);
            editor._currentPath.remove();
            editor._currentPath = null;
            return;
        }
    }

    const finalPath = editor._currentPath;
    editor._currentPath = null;
    editor._points = [];
    editor._select(finalPath);
    // Apply layer state so the newly-appended element picks up the
    // layer-hidden / inactive-layer classes if its layer is toggled off.
    // Without this, shapes drawn while a layer's visibility is off would
    // still render. See BUG-04.
    applyLayerState(editor);
    _strokeLog(`finishDrawing  COMMIT  modeId=${modeId}  about to pushState  sketchChildren=${editor._sketchLayer.children().toArray().length}`);
    if (typeof editor.pushState === 'function') editor.pushState();
    if (editor._onChange) editor._onChange();
    // First-shape onboarding pointer at the Expand tool (BUG-06).
    try { maybeShowExpandCallout(editor); } catch (_) {}
}


// ─── Selection handles (node mode) ─────────────────────────────────

export function updateHandles(editor) {
    if (!editor._handleLayer) return;
    editor._handleLayer.clear();
    if (!editor._selectedElement) return;
    // 'node' mode → diamond handles per anchor. 'select' mode → simple
    // bounding box so the user can see WHAT is selected (BUG-05).
    // Any other mode shows nothing.
    if (editor._currentMode !== 'node' && editor._currentMode !== 'select') return;

    // ── Select mode: draw an axis-aligned bounding box around the element.
    if (editor._currentMode === 'select') {
        try {
            const bb = worldBbox(editor._selectedElement);
            if (!bb || !Number.isFinite(bb.w) || !Number.isFinite(bb.h)) return;
            const view = (editor._draw && editor._draw.viewbox) ? editor._draw.viewbox() : null;
            const strokeW = view ? Math.max(view.width, view.height) * 0.0025 : 1;
            editor._handleLayer.rect(bb.w, bb.h)
                .move(bb.x, bb.y)
                .fill('none')
                .stroke({ color: '#ffcc00', width: strokeW, dasharray: `${strokeW * 4},${strokeW * 2}` })
                .attr('pointer-events', 'none');
        } catch (_) { /* element gone / no bbox available — leave empty */ }
        return;
    }

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
