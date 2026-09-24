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
import { worldBbox, toLocal } from './editor-coords.js';
import { setEditorStatusHint, restoreModeHint, ANCHOR_HINT, maybeShowExpandCallout } from './editor-ui.js';
import { on, el, _isTypingTarget } from './dom.js';
import { dbg } from './debug.js';
import { fusLog } from '../core/fusion-bridge.js';
import {
    renderTransformHandles, hitTestHandle,
    beginTransform, applyTransformDrag,
} from './editor-transform-handles.js';
import { updateMarquee, finalizeMarquee, clearMarquee } from './editor-marquee.js';
import { startEraserStroke, updateEraserStroke, finishEraserStroke } from './editor-eraser.js';
import { viewboxFor, zoomAbout, applyView, screenToModelDelta } from './editor-view.js';
import { updateSnapCursor, clearSnapCursor, applyTouchMarkerOffset, updateGridHover, clearGridHover } from './editor-grid.js';
import { getDynamicTolerance } from './editor-hit.js';
import {
    toLattice, fromLattice, classifyDrag, constrain, latticeCrossings,
    emitSegment, emitNode, LATTICE_ATTR, nearestRailRow, orient,
} from './editor-lattice.js';
import { detachOwnership, PATTERN_DEFAULTS } from './editor-lattice-pattern.js';
import {
    INPUT_PROFILE, inputProfileFor, computePinchUpdate,
    shouldCancelDrawOnPointerDown, isPinching,
} from './editor-input.js';

function _strokeLog(msg) {
    dbg('STROKE', msg);
    try { fusLog(`[STROKE] ${msg}`); } catch (_) {}
}

// SE8c / SA-DECL-3: the tolerance literals left after SE7m's INPUT_PROFILE
// sweep that are NOT hit-tolerances (tap/grab decision boundaries already
// live in INPUT_PROFILE — see clickThresholdPx below) but purely visual or
// geometry parameters — named here instead of left as bare numbers, with
// no behaviour change (same values as before).
const PASTE_OFFSET_PX = 8; // visual nudge so a paste doesn't sit exactly on the original — not a hit-tolerance, same regardless of input device.
const CURVE_FIT_TOLERANCE_PX = 2; // simplify/fit epsilon shared by the anchor-mode commit path and the freehand draw finish path — a stroke-quality parameter, not an input-precision one.
const NODE_HANDLE_BASE_RADIUS_PX = 5; // render radius of the node-edit diamond handles — visual size, not gated per pointer type this turn.

/** T6: the one place that clears pan-related state (Space-held, active
 *  drag, and both CSS classes). Space-keyup and the mouseup pan-end branch
 *  are the normal paths; window 'blur' and a fresh open() are the ones
 *  that don't fire a matching keyup/mouseup — focus leaving the modal
 *  (alt-tab, a native confirm dialog, the palette losing focus — all
 *  common in Fusion's palette host) used to leave `_spaceHeld` stuck true,
 *  so the next left-click panned instead of drawing, with the
 *  'pan-ready' cursor stuck on screen. */
export function resetPanState(editor) {
    editor._spaceHeld = false;
    editor._isPanning = false;
    editor._panStart = null;
    const c = el('editorSVGContainer');
    if (c) {
        c.classList.remove('pan-ready');
        c.classList.remove('panning');
    }
}


export function initInteraction(editor) {
    const svgNode = editor._draw.node;
    // SE7m: ONE path for mouse/touch/pen via Pointer Events, replacing the
    // separate mouse*/touch* listener pairs — a PointerEvent carries
    // clientX/clientY directly (like MouseEvent), so getPointerPos's
    // existing e.touches-then-e.clientX fallback (editor-io.js) already
    // handles it correctly with zero changes there. editor._activePointers
    // (pointerId -> {x,y} client coords) is what makes a second finger
    // SEEN instead of ignored — the old code's `e.touches.length > 1`
    // early-return in handleStart is gone; see handlePointerDown below.
    editor._activePointers = new Map();
    editor._pointerType = 'mouse';
    on(svgNode, 'pointerdown', (e) => handlePointerDown(editor, e), { passive: false });
    on(window,  'pointermove', (e) => handlePointerMove(editor, e), { passive: false });
    on(window,  'pointerup',   (e) => handlePointerUp(editor, e));
    on(window,  'pointercancel', (e) => handlePointerUp(editor, e));
    on(svgNode, 'dblclick',  (e) => handleDblClick(editor, e));
    // SE2: wheel = zoom about the cursor. passive:false so preventDefault
    // stops the modal body from scrolling.
    on(svgNode, 'wheel', (e) => handleWheel(editor, e), { passive: false });
    // SE7a: the pointer leaving the canvas is the one path that fires no
    // further pointermove to naturally hide the hover snap-cursor.
    on(svgNode, 'pointerleave', () => { clearSnapCursor(editor); clearGridHover(editor); });
    // BUG-28: global keyboard shortcuts for the editor — Delete /
    // Backspace removes the whole multi-selection, Ctrl/Cmd+C copies it
    // onto editor._clipboard, Ctrl/Cmd+V pastes (with a small offset so
    // duplicates are visible) onto the active editor layer.
    on(window, 'keydown', (e) => _handleEditorKeydown(editor, e));
    // SE2: matching keyup so Space-held-for-pan releases reliably.
    on(window, 'keyup', (e) => _handleEditorKeyup(editor, e));
    // T6: focus leaving the page/palette (alt-tab, a native dialog, the
    // palette losing focus) fires no keyup/mouseup — 'blur' is the one
    // event that reliably does, so it's the backstop reset.
    on(window, 'blur', () => resetPanState(editor));
}

/**
 * SE7m: pointer-tracking wrapper around the pre-existing single-pointer
 * handleStart. Every pointerdown updates editor._activePointers first —
 * the resulting COUNT decides what happens:
 *   1 pointer  -> the existing single-pointer gesture start (handleStart),
 *                 unchanged behavior for mouse/pen/one-finger-touch.
 *   2 pointers -> SA-MOBILE-14/15: cancel any in-progress draw WITHOUT
 *                 committing it, then start pinch tracking. Never reaches
 *                 handleStart — a pinch is not a draw/select gesture.
 *   3+ pointers -> ignored (tracked in the map so a later pointerup keeps
 *                 the count honest, but no gesture starts or changes).
 */
function handlePointerDown(editor, e) {
    editor._pointerType = e.pointerType || 'mouse';
    editor._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* defensive: capture can fail on some UAs/synthetic events */ }
    const count = editor._activePointers.size;

    if (shouldCancelDrawOnPointerDown(count, editor._isDrawing)) {
        if (typeof editor._cancelDrawing === 'function') editor._cancelDrawing();
    }

    if (isPinching(count)) {
        e.preventDefault();
        const ids = Array.from(editor._activePointers.keys());
        editor._pinchPrev = {
            p1: editor._activePointers.get(ids[0]),
            p2: editor._activePointers.get(ids[1]),
        };
        return;
    }
    if (count !== 1) return; // 3rd+ finger — tracked, no gesture

    handleStart(editor, e);
}

function handlePointerMove(editor, e) {
    if (!editor._activePointers.has(e.pointerId)) {
        // A move from a pointer we never saw go down (e.g. a mouse move
        // with no button held, which still fires pointermove on some
        // UAs) — treat exactly like the old mousemove-with-no-drag path.
        handleMove(editor, e);
        return;
    }
    editor._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const count = editor._activePointers.size;

    if (isPinching(count) && editor._pinchPrev) {
        e.preventDefault();
        const ids = Array.from(editor._activePointers.keys());
        const next = {
            p1: editor._activePointers.get(ids[0]),
            p2: editor._activePointers.get(ids[1]),
        };
        const { factor, midpoint } = computePinchUpdate(editor._pinchPrev, next);
        if (editor._draw && typeof editor._draw.point === 'function') {
            const pivot = editor._draw.point(midpoint.x, midpoint.y);
            editor._view = zoomAbout(editor._view, pivot, factor);
            applyView(editor);
        }
        editor._pinchPrev = next;
        return;
    }
    if (count > 2) return; // 3rd+ finger moving — ignored, matches pointerdown

    handleMove(editor, e);
}

function handlePointerUp(editor, e) {
    editor._activePointers.delete(e.pointerId);
    try { e.target.releasePointerCapture(e.pointerId); } catch (_) {}
    const count = editor._activePointers.size;

    if (count >= 2) return; // still pinching with the remaining fingers — nothing to end yet
    if (editor._pinchPrev) {
        // Was pinching, now down to 0 or 1 fingers — end the pinch WITHOUT
        // resuming a single-finger draw/select on whichever finger is
        // still down (the standard "lifting one finger of a pinch doesn't
        // start drawing" touch convention).
        editor._pinchPrev = null;
        return;
    }
    if (count > 0) return; // still tracking a lower-priority extra finger

    handleEnd(editor, e);
}

function handleWheel(editor, e) {
    if (!editor._draw) return;
    e.preventDefault();
    const before = editor._getMousePoint(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    editor._view = zoomAbout(editor._view, before, factor);
    applyView(editor);
}

function _isEditorActive(editor) {
    // Only react to keyboard shortcuts when the editor modal is open AND
    // the user isn't typing in another input (text shapes, the layer-
    // name inline-rename input, etc.).
    const modal = document.getElementById('svgEditorModal');
    if (!modal || modal.style.display === 'none') return false;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return false;
    if (editor._editingTextEl) return false;
    return true;
}

function _handleEditorKeydown(editor, e) {
    if (!_isEditorActive(editor)) return;
    const sel = (editor._selectedElements || []);

    // SE2: Space held = pan-ready (checked in handleStart). preventDefault
    // so the modal body doesn't scroll while held.
    if (e.code === 'Space') {
        e.preventDefault();
        editor._spaceHeld = true;
        const c = el('editorSVGContainer');
        if (c) c.classList.add('pan-ready');
        return;
    }

    // Delete / Backspace — remove all selected.
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length > 0) {
        e.preventDefault();
        editor.deleteSelected();
        return;
    }

    // Single-key tool shortcuts (V/A/P/T/L/R/C/E) — declared on the button
    // itself via data-key (bspline_gen_palette.html), not hand-rolled here,
    // so the tooltip text and the key can never drift apart again. Skip
    // when any modifier is held (the Ctrl+C/V/A shortcuts below still need
    // their letters) or the user is typing into a text field.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !_isTypingTarget(e.target)) {
        const toolBtn = document.querySelector(`#svgEditorModal [data-key="${e.key.toLowerCase()}"]`);
        if (toolBtn) {
            e.preventDefault();
            toolBtn.click();
            return;
        }
    }

    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;

    // Ctrl/Cmd + C — copy selection.
    if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        copySelection(editor);
        return;
    }

    // Ctrl/Cmd + V — paste clipboard onto the active layer.
    if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        pasteClipboard(editor);
        return;
    }

    // Ctrl/Cmd + A — select every visible shape across all visible layers.
    if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        selectAllVisible(editor);
    }
}

function _handleEditorKeyup(editor, e) {
    if (!_isEditorActive(editor)) return;
    if (e.code === 'Space') {
        resetPanState(editor);
    }
}

// SE7m / SA-MOBILE-11: copySelection/pasteClipboard/selectAllVisible are
// declared once here and called from BOTH the Ctrl+C/V/A keydown handler
// above AND the on-screen action group's Copy/Paste/Select-all buttons
// (wired in editor-controls.js) — one behavior, two input paths, not two
// copies of the same logic.

/** Copy the current selection onto editor._clipboard. No-op (not an
 *  error) when nothing is selected — matches the keyboard shortcut's own
 *  pre-existing silent-no-op behavior for an empty selection. */
export function copySelection(editor) {
    const sel = editor._selectedElements || [];
    if (sel.length === 0) return;
    editor._clipboard = sel.map((el) => ({
        // Capture each element's outer SVG markup + its data-layer so
        // paste can put it back on the same layer (or rewrite to active
        // on cross-layer paste).
        outerSvg: el.node ? el.node.outerHTML : '',
        layer: el.attr ? (el.attr('data-layer') || null) : null,
    })).filter((c) => c.outerSvg);
}

/** Paste editor._clipboard onto the active layer. No-op when the
 *  clipboard is empty. */
export function pasteClipboard(editor) {
    const clip = editor._clipboard;
    if (!Array.isArray(clip) || clip.length === 0) return;
    _pasteFromClipboard(editor, clip);
}

/** Select every visible shape across all visible layers. */
export function selectAllVisible(editor) {
    if (!editor._sketchLayer) return;
    const all = editor._sketchLayer.children().toArray().filter((el) => {
        if (!el || !el.node) return false;
        const cls = el.node.getAttribute('class') || '';
        return !cls.includes('layer-hidden');
    });
    editor._selectMany(all);
}

/** Cancel an in-progress pen/anchor path WITHOUT committing it — the
 *  on-screen equivalent of Esc (SA-MOBILE-10), which has no touch
 *  keyboard to press. No-op when nothing is being drawn. */
export function cancelCurrentDrawing(editor) {
    if (editor._isDrawing && typeof editor._cancelDrawing === 'function') {
        editor._cancelDrawing();
    }
}

function _pasteFromClipboard(editor, clip) {
    if (!editor._sketchLayer) return;
    const sketchNode = editor._sketchLayer.node;
    const activeLayer = ensureActiveLayer(editor);
    // Small offset so the pasted copy doesn't sit exactly on top.
    const dx = editor._getDynamicTolerance ? editor._getDynamicTolerance(PASTE_OFFSET_PX) : 0.2;
    const dy = dx;

    const newEls = [];
    for (const entry of clip) {
        try {
            const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            wrapper.innerHTML = entry.outerSvg;
            const node = wrapper.firstElementChild;
            if (!node) continue;
            node.setAttribute('data-layer', String(activeLayer));
            sketchNode.appendChild(node);
            // Wrap in svg.js so translate() works.
            const adopted = window.SVG && window.SVG.adopt ? window.SVG.adopt(node) : null;
            if (adopted && typeof adopted.translate === 'function') {
                try { adopted.translate(dx, dy); } catch (_) {}
                newEls.push(adopted);
            }
        } catch (_) { /* skip malformed clipboard entries */ }
    }
    if (newEls.length) {
        editor._selectMany(newEls);
    }
    if (typeof editor.pushState === 'function') {
        try { editor.pushState(); } catch (_) {}
    }
    if (editor._onChange) { try { editor._onChange(); } catch (_) {} }
}

function handleDblClick(editor, e) {
    if (editor._anchorMode && editor._currentMode === 'draw') {
        e.preventDefault(); e.stopPropagation();
        _commitAnchorPath(editor); return;
    }
    const pt = editor._getMousePoint(e);
    const hit = editor._getNearbyElement(pt, getDynamicTolerance(editor, 10, 'slopPx'));
    if (hit && hit.type === 'text') {
        e.preventDefault(); e.stopPropagation();
        if (editor._currentMode !== 'text') editor.setMode('text');
        beginTextEdit(editor, hit);
    }
}

function handleStart(editor, e) {
    dbg('TEXT-DBG', `handleStart fired: type=${e.type} mode=${editor._currentMode} hasEditingText=${!!editor._editingTextEl} ts=${Math.round(e.timeStamp)} target=<${e.target?.tagName}>`);
    // SE7m: the "second finger ignored" guard that used to live here
    // (e.type==='touchstart' && e.touches.length>1) is gone — handleStart
    // is now only ever called by handlePointerDown when
    // editor._activePointers.size===1 (a PointerEvent has no .touches to
    // check anyway); the 2+-pointer pinch/cancel decision happens there.

    // SE2: pan — middle-button drag, or Space + left drag. Checked before
    // the mode dispatch so it works no matter which tool is active.
    if (e.button === 1 || (editor._spaceHeld && e.button === 0)) {
        e.preventDefault();
        editor._isPanning = true;
        editor._panStart = {
            clientX: e.clientX, clientY: e.clientY,
            cx: editor._view.cx, cy: editor._view.cy,
        };
        const c = el('editorSVGContainer');
        if (c) c.classList.add('panning');
        return;
    }

    // SE7m: touch commits at the MARKER position, not the raw finger
    // position, so the same offset updateSnapCursor draws the ring at is
    // applied here BEFORE snapping (applyTouchMarkerOffset is a no-op for
    // mouse/pen — INPUT_PROFILE's markerOffsetPx: 0).
    const pt = editor._snap(applyTouchMarkerOffset(editor, editor._getMousePoint(e)), e.altKey, 'start');
    const handler = getModeHandler(editor._currentMode);
    if (handler.start) handler.start(editor, pt, e);
}

function handleMove(editor, e) {
    if (editor._isPanning) {
        _panBy(editor, e.clientX - editor._panStart.clientX, e.clientY - editor._panStart.clientY);
        return;
    }
    // SE7a: hover feedback — where would the next click land? Unconditional
    // (drawing or not): in lattice mode the marker doubles as the rail/tie
    // start indicator once a gesture is under way.
    updateSnapCursor(editor, e);
    // T31 (SE6c): grid hover feedback — the row/column/node the pointer is
    // nearest to, independent of whether this gesture would snap. AFTER
    // updateSnapCursor so its own node-ring suppression ("if both are
    // shown, the node ring IS the snap ring") can read the snap cursor's
    // just-updated connected/position state, not a stale one from the
    // previous move event.
    updateGridHover(editor, e);
    const pt = editor._snap(applyTouchMarkerOffset(editor, editor._getMousePoint(e)), e.altKey, 'move');
    if (editor._isDrawing) {
        const handler = getModeHandler(editor._currentMode);
        if (handler.update) handler.update(editor, pt);
        return;
    }
    if (editor._isDragging) {
        if (editor._transformState) {
            // SE7s: alt bypasses grid-snap for an 'endpoints' (line) drag,
            // matching SNAP_POLICY's existing Alt-bypass semantics elsewhere.
            // SE7m: the on-screen Lock toggle (SA-MOBILE-12) ORs into the
            // same `shift` modifier real Shift already drives — one read,
            // two sources, no new branch in editor-transform-handles.js.
            applyTransformDrag(editor, editor._transformState, pt, { shift: !!e.shiftKey || !!editor._lockAspect, alt: !!e.altKey });
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

function _panBy(editor, dxClient, dyClient) {
    const vb = viewboxFor(editor._view, editor._mW, editor._mH);
    const svgEl = document.getElementById('editorSVGContainer');
    const clientWidth  = (svgEl && svgEl.clientWidth)  || 1;
    const clientHeight = (svgEl && svgEl.clientHeight) || 1;
    // Uniform scale (preserveAspectRatio="meet" on the editor root — see
    // editor-view.js's viewScale docstring), not clientWidth/clientHeight
    // divided per-axis: that disagrees with the actual render on whichever
    // axis is letterboxed.
    const { dx, dy } = screenToModelDelta(vb, clientWidth, clientHeight, dxClient, dyClient);
    editor._view.cx = editor._panStart.cx - dx;
    editor._view.cy = editor._panStart.cy - dy;
    applyView(editor);
}

function handleEnd(editor, e) {
    if (editor._isPanning) {
        resetPanState(editor);
        return;
    }
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
        if (wasNodeDrag) { editor._dragNodeIndex = -1; editor._dragNodes = null; }
        if (wasTransform) editor._transformState = null;
        if (wasMarquee) {
            finalizeMarquee(editor);
            editor._dragMoved = false;
            return;
        }
        if (editor._dragMoved) {
            // SE7b slice 3 / design §2: any completed drag detaches the
            // elements it touched from their Lattice pattern (if owned) —
            // strip data-lattice-gen BEFORE pushState() so the detach and
            // the move land in the SAME undo step (one Ctrl+Z reverts
            // both the position and re-establishes ownership together,
            // rather than a split state where undo restores the position
            // but leaves it detached, or vice versa). Node-drag targets
            // editor._selectedElement (singular); translate and transform
            // both target editor._selectedElements (plural) — covers all
            // 3 gestures that converge here.
            const dragged = wasNodeDrag
                ? (editor._selectedElement ? [editor._selectedElement] : [])
                : (editor._selectedElements || []);
            detachOwnership(dragged);
            editor.pushState();
            // SE8b / SA-UNDO-1: the move-handlers now only ever fire
            // 'live' (rAF-coalesced) — this is the one 'commit' per
            // gesture that guarantees the full pipeline actually runs
            // with the FINAL position, not whatever a pending/cancelled
            // 'live' frame happened to leave queued.
            editor._notifyChange('commit');
        }
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
        const hit = editor._getNearbyElement(pt, getDynamicTolerance(editor, 10, 'slopPx'));
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
        const hit = editor._getNearbyElement(pt, getDynamicTolerance(editor, 10, 'slopPx'));
        editor._setHover(hit);
    },
};

const nodeHandler = {
    start(editor, pt) {
        if (editor._selectedElement) {
            // SE7n: cache the node list (not just the hit index) — dragNode
            // needs the SAME closures for the rest of this gesture (a
            // rect's opposite-corner pin, a path's segment index) rather
            // than rebuilding them from the element's already-mutated
            // attrs on every subsequent move.
            const { idx, nodes } = findNodeAt(editor, pt);
            if (idx !== -1) {
                editor._isDragging = true;
                editor._dragNodeIndex = idx;
                editor._dragNodes = nodes;
                editor._lastDragPt = pt;
                return;
            }
        }
        const hit = editor._getNearbyElement(pt, getDynamicTolerance(editor, 10, 'slopPx'));
        if (hit && hit !== editor._selectedElement) editor._select(hit);
    },
    hover(editor, pt) {
        if (!editor._selectedElement) {
            const hit = editor._getNearbyElement(pt, getDynamicTolerance(editor, 10, 'slopPx'));
            editor._setHover(hit); return;
        }
        const { idx: hitIdx } = findNodeAt(editor, pt);
        if (editor._hoverNodeIndex !== hitIdx) {
            editor._hoverNodeIndex = hitIdx;
            editor._updateHandles();
        }
        if (hitIdx === -1) {
            const hit = editor._getNearbyElement(pt, getDynamicTolerance(editor, 10, 'slopPx'));
            editor._setHover(hit && hit !== editor._selectedElement ? hit : null);
        } else editor._setHover(null);
    },
};

const textHandler = {
    start(editor, pt, e) {
        const hit = editor._getNearbyElement(pt, getDynamicTolerance(editor, 10, 'slopPx'));
        if (hit && hit.type === 'text') { beginTextEdit(editor, hit); return; }
        if (hit) editor._deselect();
        startTextAt(editor, pt, e);
    },
    hover(editor, pt) {
        const hit = editor._getNearbyElement(pt, getDynamicTolerance(editor, 10, 'slopPx'));
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
                if (dist > getDynamicTolerance(editor, 3, 'clickThresholdPx')) editor._anchorFreehand = true;
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
    const color = editor._color || '#888888';
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
    const tol    = editor._getDynamicTolerance(CURVE_FIT_TOLERANCE_PX);
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

// SE7a: Circle is the node tool for a bare click (Fred's amend — no
// click-to-node in the lattice tool, "isn't Circle enough?"). Custom
// handler (not makeDrawingHandler) because only circle needs the
// click-vs-drag branch in finish; SNAP_POLICY's 'center' row (editor-
// grid.js) already keeps the radius-setting drag unsnapped with no
// special-casing needed here.
const circleHandler = {
    start(editor, pt) {
        editor._deselect();
        editor._isDrawing = true;
        editor._points = [[pt.x, pt.y]];
        editor._currentPath = createDrawingShape(editor, 'circle', pt);
    },
    update(editor, pt) { updateDrawingShape(editor, 'circle', pt); },
    finish(editor) {
        if (!editor._currentPath) { editor._isDrawing = false; return; }
        const r = parseFloat(editor._currentPath.node.getAttribute('r')) || 0;
        if (r < getDynamicTolerance(editor, 3, 'clickThresholdPx')) {
            // No meaningful drag — drop the near-zero circle and emit a
            // default dot instead, through the SAME emitNode the lattice
            // tool's auto-nodes use (one emitter, two callers, identical
            // elements).
            const start = editor._points[0];
            editor._currentPath.remove();
            editor._currentPath = null;
            editor._points = [];
            editor._isDrawing = false;
            emitNode(editor, { x: start[0], y: start[1] });
            applyLayerState(editor);
            if (typeof editor.pushState === 'function') editor.pushState();
            if (editor._onChange) editor._onChange();
            return;
        }
        finishDrawing(editor, 'circle');
    },
};

/** T30: the ROW of every existing rail on the sketch, IN THE CANONICAL
 *  FRAME (orient()'d) — what a tie drag's free end snaps toward. A real
 *  rail segment's "row" is whichever endpoint component is constant for
 *  that kind (real-j when horizontal, real-i when vertical, per SE7h) —
 *  orienting each endpoint into canonical space and reading `.j` gives
 *  that constant coordinate regardless of orientation, matching the
 *  canonical-space value `update()` below compares against. Duplicate
 *  rows are harmless (nearestRailRow just scans for the closest, ties
 *  broken toward the first match), so no dedup needed. */
function _existingRailRows(editor, spacing, orientation) {
    return _collectLatticeSegments(editor, spacing)
        .filter((s) => s.kind === 'rail')
        .map((s) => orient(s.a, orientation).j);
}

/** Existing rail/tie segments on the sketch, as {kind, a, b} in lattice
 *  coords — the crossing set latticeCrossings needs. Gathered BEFORE the
 *  new segment is emitted so it never crosses against itself. */
function _collectLatticeSegments(editor, spacing) {
    if (!editor._sketchLayer) return [];
    const segs = [];
    for (const ch of editor._sketchLayer.children().toArray()) {
        if (!ch || !ch.node) continue;
        const kind = ch.node.getAttribute(LATTICE_ATTR);
        if (kind !== 'rail' && kind !== 'tie') continue;
        const x1 = parseFloat(ch.node.getAttribute('x1'));
        const y1 = parseFloat(ch.node.getAttribute('y1'));
        const x2 = parseFloat(ch.node.getAttribute('x2'));
        const y2 = parseFloat(ch.node.getAttribute('y2'));
        if ([x1, y1, x2, y2].some(Number.isNaN)) continue;
        segs.push({
            kind,
            a: toLattice({ x: x1, y: y1 }, spacing),
            b: toLattice({ x: x2, y: y2 }, spacing),
        });
    }
    return segs;
}

// SE7a: Lattice — drag along a row for a rail, along a column for a tie;
// a bare click does nothing (Circle is the node tool, per Fred's amend).
// Snaps to the lattice ALWAYS via toLattice/fromLattice directly, NOT
// editor._snap — the lattice tool IS the grid, independent of the SNAP
// toggle (SNAP_POLICY's 'always' row exists for the hover cursor/other
// callers of _snap, not for this handler's own point resolution).
const latticeHandler = {
    start(editor, pt) {
        editor._deselect();
        const spacing = editor._grid.spacing || 0.25;
        editor._latticeSpacing = spacing;
        editor._latticeStart = toLattice(pt, spacing);
        editor._latticeEnd = editor._latticeStart;
        editor._isDrawing = true;
        const p = fromLattice(editor._latticeStart, spacing);
        const color = editor._color || '#888888';
        const width = editor._strokeWidth || 1;
        editor._latticePreview = editor._sketchLayer
            .line(p.x, p.y, p.x, p.y)
            .stroke({ color, width, dasharray: '5 4', opacity: 0.6 })
            .attr('pointer-events', 'none');
    },
    update(editor, pt) {
        if (!editor._latticePreview) return;
        const spacing = editor._latticeSpacing;
        // SE7h: the hand tool conjugates through the SAME orient() the
        // generator uses (editor-lattice.js) — transpose into the
        // canonical (horizontal) frame, run constrain/the tie-shape test/
        // the rail-row snap EXACTLY as written for horizontal, then
        // transpose the result back out. See orient()'s own doc comment.
        const orientation = editor._latticePattern?.orientation ?? PATTERN_DEFAULTS.orientation;
        const a = editor._latticeStart;
        const bLat = toLattice(pt, spacing);
        const aCanon = orient(a, orientation);
        const bCanon = orient(bLat, orientation);
        let constrainedCanon = constrain(aCanon, bCanon);
        // T30: a tie drag's END snaps to the nearest rail ROW within
        // railSnapRows — mirrors constrain's own dominant-axis test
        // (rather than reading it back off `constrained`, whose rail
        // branch trivially sets j:a.j and can't be told apart from an
        // un-snapped tie value at that same row) so only a genuinely
        // vertical (tie-shaped) drag-in-progress gets row-snapped. finish()
        // below just reads back whatever _latticeEnd ends up being here —
        // no separate snap step needed there. SE7h: "row" here means
        // canonical-frame row — in vertical orientation that's a REAL
        // column, per _existingRailRows' own doc comment.
        // T30 AMEND (Fred): ONE setting for both surfaces — reads the
        // Pattern panel's own railSnapRows field (editor._latticePattern.
        // ties.railSnapRows, persisted with the pattern) rather than a
        // second, hand-tool-only default; initLatticeProperties() (called
        // unconditionally at editor setup, editor-controls.js) guarantees
        // editor._latticePattern already exists by the time any tool can
        // be used, so the PATTERN_DEFAULTS fallback below is only ever
        // for a still-uninitialized editor in a test harness.
        const isTieShaped = Math.abs(bCanon.i - aCanon.i) < Math.abs(bCanon.j - aCanon.j);
        if (isTieShaped) {
            const railSnapRows = editor._latticePattern?.ties?.railSnapRows ?? PATTERN_DEFAULTS.ties.railSnapRows;
            const railRows = _existingRailRows(editor, spacing, orientation);
            const snapped = nearestRailRow(constrainedCanon.j, railRows, railSnapRows);
            if (snapped != null) constrainedCanon = { i: constrainedCanon.i, j: snapped };
        }
        const constrained = orient(constrainedCanon, orientation);
        editor._latticeEnd = constrained;
        const p2 = fromLattice(constrained, spacing);
        editor._latticePreview.attr({ x2: p2.x, y2: p2.y });
    },
    finish(editor) {
        editor._isDrawing = false;
        if (editor._latticePreview) { editor._latticePreview.remove(); editor._latticePreview = null; }
        const a = editor._latticeStart;
        const b = editor._latticeEnd || a;
        editor._latticeStart = null;
        editor._latticeEnd = null;
        if (!a) return;
        const orientation = editor._latticePattern?.orientation ?? PATTERN_DEFAULTS.orientation;
        const aCanon = orient(a, orientation);
        const bCanon = orient(b, orientation);
        const kind = classifyDrag(aCanon, bCanon);
        if (kind === 'node') return; // bare click in lattice mode does nothing
        const spacing = editor._latticeSpacing;
        // Gathered BEFORE the new segment is emitted (unchanged from
        // before SE7h) so it never crosses against itself — oriented into
        // the canonical frame since the crossing math below is.
        const existing = editor._lattice.autoNodes
            ? _collectLatticeSegments(editor, spacing).map((s) => ({
                kind: s.kind, a: orient(s.a, orientation), b: orient(s.b, orientation),
              }))
            : [];
        // emitSegment draws the REAL a/b (unchanged) — only the crossing
        // math below needs the canonical conjugation, same reasoning as
        // computePattern's own crossings step.
        emitSegment(editor, kind, fromLattice(a, spacing), fromLattice(b, spacing));
        if (editor._lattice.autoNodes) {
            const crossingsCanon = latticeCrossings({ kind, a: aCanon, b: bCanon }, existing);
            crossingsCanon.forEach((ptCanon) => {
                const latPt = orient(ptCanon, orientation);
                emitNode(editor, fromLattice(latPt, spacing));
            });
        }
        applyLayerState(editor);
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    },
};

const modeHandlers = {
    select:  selectHandler,
    node:    nodeHandler,
    text:    textHandler,
    draw:    drawHandler,
    line:    makeDrawingHandler('line'),
    rect:    makeDrawingHandler('rect'),
    circle:  circleHandler,
    erase:   eraseHandler,
    lattice: latticeHandler,
};

function getModeHandler(mode) { return modeHandlers[mode] || selectHandler; }


// ─── Shared helpers ────────────────────────────────────────────────

/** Returns { idx, nodes } — nodes is the freshly-built list (WORLD coords
 *  + a set() closure per node, see editor-hit.js), idx is the one under
 *  pt or -1. Callers that only need the index (hover) can destructure
 *  just that; a drag start needs `nodes` too, to reuse across the whole
 *  gesture (see nodeHandler.start's own comment). */
function findNodeAt(editor, pt) {
    if (!editor._selectedElement) return { idx: -1, nodes: [] };
    const nodes = editor._getNodes(editor._selectedElement);
    const tol = getDynamicTolerance(editor, 15, 'grabPx'); // SA-MOBILE-2 — node-grab radius
    const idx = nodes.findIndex(n => Math.hypot(n.x - pt.x, n.y - pt.y) < tol);
    return { idx, nodes };
}

/** SE7n: map the WORLD pointer into the element's own local space via the
 *  inverse of its transform matrix, then hand it to the cached node's
 *  own set() — no per-shape-type branching left here at all. Before this,
 *  the world pointer was written straight into local attributes, so any
 *  element moved/scaled/rotated via Select (which writes a `transform`)
 *  jumped by its transform offset the instant you tried to drag a node. */
function dragNode(editor, pt) {
    const el = editor._selectedElement;
    const nodes = editor._dragNodes;
    const idx = editor._dragNodeIndex;
    editor._dragMoved = true;
    if (!nodes || !nodes[idx]) return;
    // SE8b / SA-COORD-3,4: the inline el.matrix().inverse() + transformPoint
    // composition SE7n wrote here is now the declared toLocal (editor-
    // coords.js) — one write-side inverse, not a second inline copy.
    nodes[idx].set(toLocal(el, pt));
    editor._updateHandles();
    editor._updateSelectionHighlight();
    // SE8b / SA-UNDO-1: was the REAL editor._onChange() (full remask +
    // rasterize + localStorage) firing on every raw mousemove — commonly
    // 15-40+ times per drag. 'live' coalesces to at most one call per
    // animation frame; handleEnd fires the real 'commit' once the
    // gesture actually ends.
    editor._notifyChange('live');
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
    editor._notifyChange('live'); // SE8b / SA-UNDO-1 — see dragNode's own comment
}


// ─── Drawing primitives ────────────────────────────────────────────

/**
 * SE8c / SA-DECL-1: the create/update per-tool if/else chains that used to
 * live in createDrawingShape/updateDrawingShape below, declared as one
 * table — adding a drawing tool is one entry here, not a new branch in
 * two different functions that have to be kept in step by hand.
 *
 * `create(editor, pt, style)` returns the new svg.js element WITHOUT the
 * `data-layer` attr — createDrawingShape applies that once, after
 * dispatch, since every shape needs the exact same attr call (no reason
 * to repeat it four times). `style` is `{ stroke, fillForShape,
 * strokeForShape }`, computed once by createDrawingShape from the
 * editor's current fill-mode/colors — identical for every shape kind.
 *
 * `update(editor, el, pt, start)` mutates the in-progress element in
 * place; `start` is `editor._points[0]` (the gesture's anchor point).
 * Only 'draw' touches `editor._points` itself (the running freehand
 * polyline other tools don't accumulate).
 */
export const DRAW_SHAPES = {
    draw: {
        create: (editor, pt, { fillForShape, strokeForShape }) =>
            editor._sketchLayer.path(`M ${pt.x} ${pt.y}`)
                .fill(fillForShape)
                .stroke({ ...strokeForShape, linecap: 'round', linejoin: 'round' }),
        update: (editor, el, pt) => {
            editor._points.push([pt.x, pt.y]);
            el.attr('d', `${el.attr('d')} L ${pt.x} ${pt.y}`);
        },
    },
    // Lines are stroke-only by nature.
    line: {
        create: (editor, pt, { stroke }) =>
            editor._sketchLayer.line(pt.x, pt.y, pt.x, pt.y).stroke({ ...stroke, linecap: 'round' }),
        update: (editor, el, pt) => el.attr({ x2: pt.x, y2: pt.y }),
    },
    rect: {
        create: (editor, pt, { fillForShape, strokeForShape }) =>
            editor._sketchLayer.rect(0, 0).move(pt.x, pt.y).fill(fillForShape).stroke(strokeForShape),
        update: (editor, el, pt, start) => {
            const x = Math.min(pt.x, start[0]);
            const y = Math.min(pt.y, start[1]);
            const w = Math.abs(pt.x - start[0]);
            const h = Math.abs(pt.y - start[1]);
            el.size(w, h).move(x, y);
        },
    },
    circle: {
        create: (editor, pt, { fillForShape, strokeForShape }) =>
            editor._sketchLayer.circle(0).center(pt.x, pt.y).fill(fillForShape).stroke(strokeForShape),
        update: (editor, el, pt, start) => el.radius(Math.hypot(pt.x - start[0], pt.y - start[1])),
    },
};

function createDrawingShape(editor, modeId, pt) {
    const layer = ensureActiveLayer(editor);
    const stroke = { color: editor._color, width: editor._strokeWidth };
    // BUG-27 fill mode: pick fill + stroke based on the user's choice in
    // the editor toolbar. Lines never get filled (no interior). Pen
    // paths in 'fill' mode are auto-closed with Z at commit time so the
    // rasterizer treats the enclosed area as a region.
    const mode = editor._fillMode || 'stroke';
    const fillColor = editor._color || '#000000';
    const fillForShape = (mode === 'stroke') ? 'none' : fillColor;
    const strokeForShape = (mode === 'fill')
        ? { color: 'none', width: 0 }
        : stroke;
    const shape = DRAW_SHAPES[modeId];
    if (!shape) return null;
    const el = shape.create(editor, pt, { stroke, fillForShape, strokeForShape });
    return el ? el.attr('data-layer', layer) : null;
}

function updateDrawingShape(editor, modeId, pt) {
    if (!editor._currentPath) return;
    const shape = DRAW_SHAPES[modeId];
    if (!shape) return;
    shape.update(editor, editor._currentPath, pt, editor._points[0]);
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
            const tol = editor._getDynamicTolerance(CURVE_FIT_TOLERANCE_PX);
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

    const r = editor._getDynamicTolerance(NODE_HANDLE_BASE_RADIUS_PX);
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
