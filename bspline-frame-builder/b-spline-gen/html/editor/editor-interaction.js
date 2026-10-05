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
import { logAction } from '../core/action-log.js';
import { fitCurve, ramerDouglasPeucker } from './editor-curves.js';
import { cutHandler } from './editor-cut-tool.js'; // SE16 ✂
import { primitiveFromContourD, nearestOnContourPrimitive } from './editor-contour-cut.js';
import { stripeHandler } from './editor-stripe-tool.js'; // F27 item 3
import { brickBrushHandler, brickAccentClickHandler, brickElementSelectHandler, brickWallAreaHandler } from './editor-brick-tool.js'; // F35 item 1, item 15, item 22
import { withChain, writeChainRow, writeChainTranslate, updateJointSlide, pushTieJoints, tieEndNodes, minPieceLength } from './editor-lattice-chains.js'; // SE16
import { startTextAt, beginTextEdit } from './editor-text-session.js';
import { getActiveLayer, ensureActiveLayer, applyLayerState, getElementLayer, setActiveLayer, isOnVisibleLayer } from './layers.js';
import { worldBbox, toLocal, worldPoint } from './editor-coords.js';
import { setEditorStatusHint, restoreModeHint, ANCHOR_HINT, maybeShowExpandCallout, updateHistoryButtons } from './editor-ui.js';
import { on, el, _isTypingTarget } from './dom.js';
import { dbg } from './debug.js';
import { fusLog } from '../core/fusion-bridge.js';
import { haptic, resetHapticSnap } from '../core/haptics.js';
import {
    renderTransformHandles, hitTestHandle,
    beginTransform, applyTransformDrag, setHandleCursor, paramHandleCursorAxis,
} from './editor-transform-handles.js';
import { updateMarquee, finalizeMarquee, clearMarquee } from './editor-marquee.js';
import { startEraserStroke, updateEraserStroke, finishEraserStroke } from './editor-eraser.js';
import { viewboxFor, zoomAbout, applyView, screenToModelDelta } from './editor-view.js';
import { updateSnapCursor, clearSnapCursor, applyTouchMarkerOffset, updateGridHover, clearGridHover, snapToGrid, SNAP_POLICY } from './editor-grid.js';
import { getDynamicTolerance, pastClickThreshold } from './editor-hit.js';
import { nearestGeometrySnap, geometrySnapTargets, GEOMETRY_SNAP_TOL_PX } from './editor-snap-resolver.js';
import {
    toLattice, toLatticeFractional, fromLattice, constrainToKind, latticeCrossings,
    emitSegment, emitNode, LATTICE_ATTR, nearestRailRow, orient,
    isLatticePoint, moveRailAlongAxis, translateTie,
    nearestEndWithin, stretchRailEnd, stretchTieEnd, LATTICE_DRAW_KINDS,
} from './editor-lattice.js';
import { PATTERN_DEFAULTS, getLayerPattern, _resolveExtent, _scalePrimitiveToLattice, usesContourCenterline, _findBoundaryElements, resolvePatternLayer, clipHandRailToBoundary, bakeContourPieceTransform, CONTOUR_SEG_INDEX_ATTR } from './editor-lattice-pattern.js';
import { insideSpans, insetGeneratedPresetPathDToPrimitives } from './editor-lattice-boundary.js';
import {
    INPUT_PROFILE, inputProfileFor, computePinchUpdate,
    shouldCancelDrawOnPointerDown, isPinching,
} from './editor-input.js';
// H5 MULTI-SELECT: kept as its own module (not inlined here) so this
// turn's edits to this shared, concurrently-extended file stay a few
// one-line hooks — see editor-multiselect-gesture.js's own doc comment.
import { armMultiSelectPress, cancelMultiSelectHoldIfMoved, cancelMultiSelectHold } from './editor-multiselect-gesture.js';
// T81 item 7: rail END handle + boundary limit + rider pruning for the
// existing SE7k end-stretch -- own module, same reasoning as H5's above.
import {
    armRailEndStretch, railEndTarget, whenRailLimitReady, pruneAfterRailStretch,
    endRailEndStretch, setRailEndHover, renderRailEndHandle, railEndAxis,
} from './editor-rail-end-stretch.js';
// H6 CONTEXT-MENU: same reasoning, own module — see its own doc comment.
import {
    armContextMenuHold, cancelContextMenuHoldIfMoved, cancelContextMenuHold,
    bindContextMenu, targetKindOf, heldMenu, dismissHeldMenu,
} from './editor-context-menu.js';
// T59 (SE14's own deferred "Slice 3 editing model"): axis-locked param
// handles + tap-a-segment. generateSilhouette/boardRegion/hitTestSegment
// are pure; the properties-shape-lattice.js imports are its own MODULE-
// LEVEL public API (lifted out of that panel's own closures specifically
// so this file — which has no panel DOM at all — can call the identical
// write/regenerate logic, not a second copy of it).
import { generateSilhouette, joinSegmentPathsIntoClosedD } from './editor-shape-lattice-generator.js';
import { hitTestSegment, hitTestArcGrip, nearestSegment } from './editor-shape-lattice-interaction.js';
import { renderTouchConfirm } from './editor-touch-confirm.js';
import {
    currentPattern, currentShape, regenerateSilhouette, regenerateSilhouetteAndFill,
    paramHandleRecords, renderShapeLatticeHandles, openSegmentStyleBar, _shapeContourRegion,
    _contourSegmentEl,
} from './properties-shape-lattice.js';
import { commitEdit } from './editor-commit.js';
import { SELECTION_COLOR, APP_HANDLE_STROKE } from './editor-transform-handles.js';
import { distToSegment as _distToSegment } from './editor-primitives.js'; // audit tidy-up: the one copy

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
    // H6 CONTEXT-MENU: desktop's own trigger — scoped to svgNode alone, see
    // bindContextMenu's own doc comment for why (the 3D preview canvas has
    // its own, separate contextmenu suppression).
    bindContextMenu(editor, svgNode);
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
    // H5 MULTI-SELECT: a NEW press (including a 2nd finger landing) always
    // invalidates a hold pending from a DIFFERENT, earlier press — same
    // "a 2nd finger cancels an in-progress draw" reasoning just below. This
    // runs before THIS press's own selection handling ever arms a new
    // hold, so it can never cancel itself.
    cancelMultiSelectHold();
    cancelContextMenuHold(); // H6: same reasoning, own timer — see its own doc comment.
    editor._pointerType = e.pointerType || 'mouse';
    editor._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* defensive: capture can fail on some UAs/synthetic events */ }
    const count = editor._activePointers.size;

    // Fred: "Zooming shouldn't move geometry inadvertently". The first finger of a
    // pinch starts a normal one-finger gesture (select/move a piece, drag a handle,
    // pull an arc...) and can move things before the second finger lands; cancelling
    // only a pen stroke left those moves in place. Now a second finger puts the
    // drawing back exactly as it was when the first finger touched down.
    // Audit (batch 3): also when the first finger's PRESS already committed something (Lattice Node mode places a
    // node on press) -- that press was the start of a pinch, not an edit.
    const pressCommitted = !!(editor._touchGestureHistory && Array.isArray(editor._undoStack)
        && editor._undoStack.length > editor._touchGestureHistory.undoLen);
    if (count === 2 && editor._touchGestureSnapshot && (editor._isDrawing || editor._isDragging || pressCommitted)) {
        _abortTouchGesture(editor);
    } else if (shouldCancelDrawOnPointerDown(count, editor._isDrawing)) {
        if (typeof editor._cancelDrawing === 'function') editor._cancelDrawing();
    }
    if (count !== 1) editor._touchGestureSnapshot = null;

    if (isPinching(count)) {
        e.preventDefault();
        // Fred: the canvas "jumps ... after I release the fingers", in both tabs. The first finger had started
        // a one-finger PAN (remembering the view at that moment); the pinch moved the view but never ended that
        // pan, so when one finger lifted and the other moved a pixel, the stale pan re-applied its old start
        // view: a 40-120 px snap. A pinch now ends any one-finger pan, and (_afterPinch) the finger left down
        // after a pinch does nothing until every finger is up.
        if (editor._isPanning) resetPanState(editor);
        clearAimSelect(editor); // a second finger: pinch, not aim
        editor._afterPinch = true;
        const ids = Array.from(editor._activePointers.keys());
        editor._pinchPrev = {
            p1: editor._activePointers.get(ids[0]),
            p2: editor._activePointers.get(ids[1]),
        };
        return;
    }
    if (count !== 1) return; // 3rd+ finger — tracked, no gesture

    // FB-APP F18 (FRAME-TAB-ZOOM): in the Frame tab the artwork is locked -- no tool starts. Fred ("lose 1f pan"):
    // a one-finger drag no longer pans (two fingers pan and zoom, pinch above); the frame panel takes handle drags.
    if (editor._artworkLocked) { if (e.pointerType !== 'touch') _startPan(editor, e); return; }

    // The drawing as this touch found it, for _abortTouchGesture (mouse/pen never pinch).
    editor._touchGestureSnapshot = (e.pointerType === 'touch' && typeof editor._snapshotState === 'function')
        ? editor._snapshotState() : null;
    // Audit (batch 3): and the history as it was, so an abort also takes back a step the PRESS itself pushed
    // (Lattice Node mode places + pushes on press) -- else a phantom step stayed and Redo brought back a node the
    // user never placed.
    editor._touchGestureHistory = editor._touchGestureSnapshot && Array.isArray(editor._undoStack)
        ? { undoLen: editor._undoStack.length, redo: Array.isArray(editor._redoStack) ? editor._redoStack.slice() : null, last: editor._lastPushedState }
        : null;
    handleStart(editor, e);
    _logPointer(editor, e, 'press');
}

/** Fred's action log (core/action-log.js): a canvas press / release -- model point, pointer, tool, and the state it
 *  left (what is selected, whether an aim / drag / draw is under way). */
function _logPointer(editor, e, a) {
    try {
        const p = editor._getMousePoint(e);
        const sel = (editor._selectedElements || []).map((el) => el.node.getAttribute(LATTICE_ATTR) || el.type);
        logAction(a, {
            x: p.x, y: p.y, ptr: e.pointerType, mode: editor._currentMode,
            sub: editor._currentMode === 'lattice' ? editor._lattice.drawKind : undefined,
            sel: sel.length ? sel.join(',') : undefined,
            state: [editor._aimSelect && 'aim', editor._isDragging && 'drag', editor._isDrawing && 'draw',
                editor._latticeMove && 'latticeMove', editor._isPanning && 'pan'].filter(Boolean).join(',') || undefined,
        });
    } catch (_) { /* logging never breaks a gesture */ }
}

/** A pinch took over a one-finger touch gesture: drop every in-progress gesture
 *  WITHOUT committing it and restore the drawing (sketch + layer patterns, i.e.
 *  shape params too) to the snapshot taken when that finger touched down. No
 *  undo step is added or removed; the pinch then zooms as usual. */
/** Audit (batch 1): ONE reset for every drag-gesture field, so no gesture can start with state left over from
 *  an earlier one -- a pinch used to leave `_transformState` / `_dragNodeIndex` set (only handleEnd cleared them),
 *  and the next one-finger drag then drove the detached pre-restore elements and pushed an empty undo step.
 *  Called by a pinch abort, at every press (handleStart) and at the end of handleEnd. Never touches multi-press
 *  state (pen anchor mode, a pending ✓/✗, text editing). */
export function resetDragGestureState(editor) {
    editor._isDragging = false;
    editor._selMove = null;
    editor._transformState = null;
    editor._dragNodeIndex = -1;
    editor._dragNodes = null;
    if (editor._marqueeRect) clearMarquee(editor); // removes a half-drawn box too
    editor._marqueeStart = null;
    editor._marqueeRect = null;
    editor._dragMoved = false;
    editor._grabAtFinger = false;
}

function _abortTouchGesture(editor) {
    clearAimSelect(editor);
    const snap = editor._touchGestureSnapshot;
    editor._touchGestureSnapshot = null;
    if (typeof editor._cancelDrawing === 'function') editor._cancelDrawing(); // a pen path in progress
    editor._isDrawing = false;
    resetDragGestureState(editor);
    editor._latticeMove = null;
    editor._latticeStart = null;
    editor._shapeLatticeDragKey = null;
    editor._shapeLatticeDragCtx = null;
    editor._shapeLatticeDragOffsetY = 0;
    editor._shapeArcPress = null;
    editor._railEndDrag = null;
    // a scissors / stripe AIM in progress (editor-touch-confirm.js) is dropped; a PENDING check/X stays (its
    // preview is re-drawn with the handles), so zooming in to check before confirming is fine.
    if (editor._touchAim) { editor._touchAim = null; for (const id of ['cut-marker', 'stripe-marker']) document.getElementById(id)?.remove(); }
    document.querySelectorAll('.shape-lattice-segment-bar').forEach((bar) => bar.remove());
    setHandleCursor(null);
    if (snap && typeof editor._restoreState === 'function') editor._restoreState(snap);
    const hist = editor._touchGestureHistory;
    editor._touchGestureHistory = null;
    if (hist && Array.isArray(editor._undoStack) && editor._undoStack.length > hist.undoLen) {
        editor._undoStack.length = hist.undoLen;
        if (hist.redo && Array.isArray(editor._redoStack)) { editor._redoStack.length = 0; editor._redoStack.push(...hist.redo); }
        editor._lastPushedState = hist.last;
        updateHistoryButtons(editor);
    }
    if (typeof editor._updateHandles === 'function') editor._updateHandles();
}

function _startPan(editor, e) {
    e.preventDefault();
    editor._isPanning = true;
    editor._panStart = { clientX: e.clientX, clientY: e.clientY, cx: editor._view.cx, cy: editor._view.cy };
    const c = el('editorSVGContainer');
    if (c) c.classList.add('panning');
}

function handlePointerMove(editor, e) {
    // H5 MULTI-SELECT: movement past the click threshold cancels a pending
    // hold and falls through to a normal drag — first, before any other
    // early return, so it's never skipped by a later one. NOT paired with
    // a blanket `if (editor._artworkLocked) return` here (an earlier draft
    // had one) — F18's own artwork-locked handling below (the untracked-
    // pointer branch just below, and the pan-continuation branch further
    // down) is more nuanced than that, and a blanket return here would
    // have broken its pan-while-locked case.
    cancelMultiSelectHoldIfMoved(e);
    cancelContextMenuHoldIfMoved(e); // H6: same still-vs-drag threshold.
    if (!editor._activePointers.has(e.pointerId)) {
        // FB-APP F9/F18: in the Frame tab (artwork locked) there is no hover/snap feedback
        if (editor._artworkLocked) return;
        // Fred ("scrolling the form is also pressing on the canvas behind the form"): a pointer the canvas never
        // saw go down is a finger on the form/drawer/toolbar -- a touch has no hover, so it never reaches the
        // canvas; a mouse only hovers the canvas while it is actually over it.
        if (e.pointerType === 'touch' || !_overCanvas(editor, e)) return;
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
        const { factor, midpoint, panDx, panDy } = computePinchUpdate(editor._pinchPrev, next);
        if (editor._draw && typeof editor._draw.point === 'function') {
            // Pan by the midpoint's own movement FIRST — zoomAbout alone
            // never translates the view when factor is ~1 (a pure slide),
            // see computePinchUpdate's own doc comment — THEN zoom about
            // the new midpoint, so a combined pinch+slide zooms about
            // where the fingers ended up this frame, not where they were.
            const { dx, dy } = _screenDeltaToModel(editor, panDx, panDy);
            editor._view.cx -= dx;
            editor._view.cy -= dy;
            const pivot = editor._draw.point(midpoint.x, midpoint.y);
            editor._view = zoomAbout(editor._view, pivot, factor);
            applyView(editor);
        }
        editor._pinchPrev = next;
        return;
    }
    if (count > 2) return; // 3rd+ finger moving — ignored, matches pointerdown
    // FB-APP F18: locked (Frame tab) = pan/pinch only
    if (editor._afterPinch) return; // the finger still down after a pinch: inert until all are lifted
    if (editor._artworkLocked) { if (editor._isPanning) handleMove(editor, e); return; }

    handleMove(editor, e);
}

/** Is the event over the drawing canvas itself (not a panel, drawer or toolbar laid over it)? */
function _overCanvas(editor, e) {
    const svg = editor._draw && editor._draw.node;
    const t = e && e.target;
    return !!(svg && t && (t === svg || (typeof svg.contains === 'function' && svg.contains(t))));
}

function handlePointerUp(editor, e) {
    // Fred ("scrolling the form is also pressing on the canvas"): a finger lifted off the form/drawer never
    // started a canvas gesture, so it ends nothing (it used to run handleEnd, committing whatever was pending).
    if (!editor._activePointers.has(e.pointerId)) return;
    // H5 MULTI-SELECT: releasing before the hold time elapses is just a
    // quick second tap — a no-op, since the first tap already left the
    // piece selected alone (there is nothing left to restore). Also
    // reached via pointercancel (same handler, line above in
    // initInteraction), which is exactly the other case that should cancel
    // a pending hold.
    cancelMultiSelectHold();
    cancelContextMenuHold(); // H6: a release before the hold time is just a quick tap, no menu.
    editor._activePointers.delete(e.pointerId);
    try { e.target.releasePointerCapture(e.pointerId); } catch (_) {}
    const count = editor._activePointers.size;

    if (count >= 2) return; // still pinching with the remaining fingers — nothing to end yet
    if (count === 0) editor._afterPinch = false; // every finger up: the next touch starts fresh
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
    _logPointer(editor, e, 'release');
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
    if (editor._artworkLocked) return false; // FB-APP F8: the Frame tab (artwork read-only)
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
    // T80 item 3 (Fred: "duplicating a tie should also duplicate its node"):
    // a selected tie's own end nodes (tieEndNodes -- editor-lattice-chains.js)
    // come along, so Duplicate (= this + pasteClipboard) and a plain Ctrl+C/V
    // both offset the tie's nodes WITH it (same shared code path, box or
    // Shape Lattice alike). A Set, keyed by element identity: a node two
    // selected ties SHARE is added once, so paste creates one copy, not a
    // stacked double.
    const toCopy = new Set(sel);
    for (const el of sel) {
        if (el && el.node && el.node.getAttribute(LATTICE_ATTR) === 'tie') {
            for (const n of tieEndNodes(editor, el)) toCopy.add(n.el);
        }
    }
    editor._clipboard = Array.from(toCopy).map((el) => ({
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
    // H13: every drag starts fresh -- a drag that begins already snapped in
    // place (e.g. the previous one also ended snapped) must still tick
    // once, which a bare false->true transition would otherwise miss.
    resetHapticSnap();
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
    // Audit (batch 1, the rule Lattice got first -- Fred: "It's catching rails instead"): an EXISTING thing is
    // picked at the FINGER (`editor._pressFinger`, no aim offset, no snap); the aim point `pt` is only for placing
    // or aiming something NEW. A handler that grabs something at the finger sets `editor._grabAtFinger`, and the
    // rest of that drag then follows the finger too (handleMove), so nothing jumps 40 px on the first move.
    resetDragGestureState(editor);
    const finger = editor._getMousePoint(e);
    editor._pressFinger = finger;
    const aimed = applyTouchMarkerOffset(editor, finger);
    editor._pressRaw = aimed; // the unsnapped press, for a selection move's own-ends snap (_selectionMoveDelta)
    const pt = editor._snap(aimed, e.altKey, 'start');

    const handler = getModeHandler(editor._currentMode);
    if (handler.start) handler.start(editor, pt, e);
}

function handleMove(editor, e) {
    if (editor._isPanning) {
        _panBy(editor, e.clientX - editor._panStart.clientX, e.clientY - editor._panStart.clientY);
        return;
    }
    if (editor._aimSelect) { _updateAimSelect(editor, e); return; }
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
    const finger = editor._getMousePoint(e);
    const aimed = editor._grabAtFinger ? finger : applyTouchMarkerOffset(editor, finger);
    // Audit (batch 1): every drag snap excludes what is being dragged -- a node / handle drag used to snap back
    // onto the edited element's own points and stick (only the translate path excluded them).
    const dragged = editor._isDragging && (editor._transformState || editor._dragNodeIndex !== -1)
        ? new Set(editor._selectedElements && editor._selectedElements.length ? editor._selectedElements : [editor._selectedElement].filter(Boolean))
        : null;
    const pt = editor._snap(aimed, e.altKey, 'move', dragged);
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
        if ((editor._selectedElements || []).length) translateSelection(editor, pt, aimed, !!e.altKey);
        return;
    }
    const handler = getModeHandler(editor._currentMode);
    // `aimed` unsnapped: a hover picks with the same point and picker its press will (audit batch 1)
    if (handler.hover) handler.hover(editor, pt, aimed);
}

// Shared by the single-finger drag-pan (_panBy) and the two-finger pinch's
// own pan term (handlePointerMove) — screen-px delta -> model-space delta,
// using the editor SVG root's CURRENT rendered size and uniform scale
// (preserveAspectRatio="meet" on the editor root — see editor-view.js's
// viewScale docstring; NOT clientWidth/clientHeight divided per-axis,
// which disagrees with the actual render on whichever axis is
// letterboxed).
function _screenDeltaToModel(editor, dxClient, dyClient) {
    const vb = viewboxFor(editor._view, editor._mW, editor._mH);
    const svgEl = document.getElementById('editorSVGContainer');
    const clientWidth  = (svgEl && svgEl.clientWidth)  || 1;
    const clientHeight = (svgEl && svgEl.clientHeight) || 1;
    return screenToModelDelta(vb, clientWidth, clientHeight, dxClient, dyClient);
}

function _panBy(editor, dxClient, dyClient) {
    const { dx, dy } = _screenDeltaToModel(editor, dxClient, dyClient);
    editor._view.cx = editor._panStart.cx - dx;
    editor._view.cy = editor._panStart.cy - dy;
    applyView(editor);
}

function handleEnd(editor, e) {
    if (editor._isPanning) {
        resetPanState(editor);
        return;
    }
    if (editor._aimSelect) { _finishAimSelect(editor); return; }
    if (editor._isDrawing) {
        const handler = getModeHandler(editor._currentMode);
        _strokeLog(`handleEnd  isDrawing=true  mode=${editor._currentMode}  hasFinish=${!!handler.finish}`);
        if (handler.finish) handler.finish(editor);
        return;
    }
    if (editor._isDragging) {
        editor._isDragging = false;
        editor._selMove = null;
        editor._grabAtFinger = false;
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
            // UI5 item 0 (advisor's own fresh-profile repro: a Shape
            // Lattice Select-mode drag genuinely MOVED the piece on
            // screen — confirmed live, transform="matrix(...)" was
            // really applied — but every raw x1/y1/x2/y2 attribute
            // still read as if nothing happened). translateSelection
            // (a plain body drag, not a resize/rotate handle or a node-
            // path edit) moves a selected element via el.translate(),
            // leaving a transform= matrix — the ordinary, correct way
            // this app's Select tool has always moved a hand-drawn
            // shape. But this app's OWN declared convention for a
            // LATTICE piece's move is to bake the result into raw attrs
            // with no transform left (_bakeLatticeTransform, shared with
            // _beginLatticeMove's own identical bake) — generatePattern
            // and every other lattice-aware reader (attachment checks,
            // manifest export) reads x1/y1/x2/y2 directly, never a
            // transform matrix. Baking ONLY the plain-body-drag case
            // (never wasTransform/wasNodeDrag/wasMarquee, all excluded
            // above) — a lattice piece is never resized/rotated via
            // handles or node-edited today, so this never fires for
            // those, but scoping it explicitly avoids assuming that stays
            // true forever.
            for (const el of (editor._selectedElements || [])) {
                const kind = el.node.getAttribute(LATTICE_ATTR);
                if (kind === 'rail' || kind === 'tie' || kind === 'node') _bakeLatticeTransform(el, kind);
                else if (el.node.hasAttribute(CONTOUR_SEG_INDEX_ATTR)) bakeContourPieceTransform(el); // audit batch 2
            }
            // SE7b slice 3 / design §2 retired this turn (SE7i, Fred: "I'll
            // create a new one if I want"): a completed drag used to
            // detach the elements it touched from their Lattice pattern
            // (strip data-lattice-gen) so Regenerate would never re-sweep
            // a hand-moved piece. SE7i's own generatePattern now clears
            // EVERY owned piece in the active layer on Generate/Regenerate
            // — "including pieces moved by hand since" — which only holds
            // if a plain move no longer strips ownership first; keeping
            // both rules active would silently re-detach every dragged
            // piece before Regenerate ever got a chance to sweep it.
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

/** Audit (batch 1): the point an EXISTING thing is picked at -- the finger itself (handleStart's
 *  `_pressFinger`), falling back to `pt` for a caller with no press (tests, synthetic starts). */
const _pickPt = (editor, pt) => editor._pressFinger || pt;

/** Audit (batch 1): a press grabbed an existing thing at the finger -- the drag follows the finger from here
 *  (handleMove), and its start is the finger snapped with the grabbed things left out of the snap. */
function _grabAtFinger(editor, pt, e, exclude) {
    editor._grabAtFinger = true;
    const finger = _pickPt(editor, pt);
    editor._pressRaw = finger;
    return editor._pressFinger ? editor._snap(finger, !!(e && e.altKey), 'start', exclude) : pt;
}

/** Audit (batch 1): where a Lattice / Shape Lattice press picks an existing rail/tie/node. Select sub-mode picks
 *  at the FINGER (Fred: "It's catching rails instead"); an Add mode (Rail/Tie/Node) is aiming with the marker, so
 *  a piece is grabbed only where the MARKER is -- a finger resting on another rail must not steal a new rail's
 *  draw. (Unsnapped either way: the grid snap is for placing, not for picking.) */
function _latticePickPt(editor, pt, e) {
    const adding = LATTICE_DRAW_KINDS.some((k) => k.value === editor._lattice.drawKind);
    if (adding) return editor._pressRaw || pt;
    return e && typeof editor._getMousePoint === 'function' ? editor._getMousePoint(e) : pt;
}

/** What a tap / press / aim-select at `pt` selects: the generic pick (any visible layer), except that lattice
 *  pieces go by the lattice tools' own rule -- the generic pick ranks by bounding-box CENTRE, so a tie-end node
 *  (its centre right under the finger) always beat the long rail it sits on (Fred: "longpress node"). Lattice rule:
 *  the nearest centreline, a node only when the point is on its dot. */
function _pickSelectable(editor, pt) {
    const tol = getDynamicTolerance(editor, 10, 'slopPx');
    const hit = editor._getNearbyElement(pt, tol, { anyVisibleLayer: true });
    if (hit && !hit.node.getAttribute(LATTICE_ATTR)) return hit;
    const near = _nearbyLatticePiece(editor, pt, tol);
    // T81 item 6 (Fred: "I can't seem to select contour segment"): `hit` above is now either a lattice
    // piece or nothing -- the generic bbox-center search already handed back anything else. A lattice
    // piece this precise re-check also found must still lose to a contour/boundary genuinely closer by
    // visible edge (rails are drawn reaching the contour's own edge, so one is ALWAYS "found" near it).
    const seg = near.el ? _boundaryNear(editor, pt) : null;
    return _contourWinsPick(seg, near) ? seg.el : (near.el || hit || null);
}

// ─── aim-select (touch) ────────────────────────────────────────────────────
// Fred: "tap hold and drag enters a hover feedback mode to see what gets selected" -- like the scissors' aim.
// A one-finger press on EMPTY space in a Select mode (the Select tool, Box / Shape Lattice Select), then a drag:
// the marker above the finger (the touch-marker offset) lights the piece it is over, the same outline a mouse
// hover gets and the same pick a tap makes (_pickSelectable); lifting selects it (over nothing: nothing). A hold
// there still opens the canvas menu first; dragging on from it closes the menu (past AIM_AFTER_HOLD_PX, so a
// wobble while holding doesn't) and aims, and sliding onto a menu row and lifting picks that row instead.
const AIM_AFTER_HOLD_PX = 20;
const AIM_RING_ID = 'aim-select-ring';

function _beginAimSelect(editor, e) {
    editor._aimSelect = { startX: e.clientX, startY: e.clientY, moved: false, el: null, row: null };
}

function _aimRowMark(aim, row) {
    if (aim.row === row) return;
    if (aim.row) aim.row.style.background = '';
    aim.row = row;
    if (row) row.style.background = 'rgba(30,111,234,0.12)';
}

function _updateAimSelect(editor, e) {
    const aim = editor._aimSelect;
    const held = heldMenu();
    if (held) {
        const under = typeof document !== 'undefined' && document.elementFromPoint ? document.elementFromPoint(e.clientX, e.clientY) : null;
        const row = under && under.closest ? under.closest('.context-menu-row') : null;
        _aimRowMark(aim, row);
        if (row) { editor._setHover(null); _clearAimRing(editor); return; } // on the menu: pick a row on lift
        if (Math.hypot(e.clientX - held.clientX, e.clientY - held.clientY) < AIM_AFTER_HOLD_PX) return;
        dismissHeldMenu();
        aim.moved = true;
    }
    if (!aim.moved) {
        if (Math.hypot(e.clientX - aim.startX, e.clientY - aim.startY) < inputProfileFor('touch').clickThresholdPx) return;
        aim.moved = true;
    }
    const finger = editor._getMousePoint(e);
    const aimed = applyTouchMarkerOffset(editor, finger);
    aim.el = _pickSelectable(editor, aimed);
    editor._setHover(aim.el || null);
    _drawAimRing(editor, finger, aimed);
}

function _drawAimRing(editor, finger, aimed) {
    const layer = editor._handleLayer;
    if (!layer) return;
    clearSnapCursor(editor); // the aim ring replaces the (grid-snapped) marker -- the pick is unsnapped
    _clearAimRing(editor);
    const r = getDynamicTolerance(editor, 9);
    const g = layer.group().id(AIM_RING_ID).attr('pointer-events', 'none');
    g.line(finger.x, finger.y, aimed.x, aimed.y + r).stroke({ color: SELECTION_COLOR, width: r * 0.18, opacity: 0.7 });
    g.circle(2 * r).center(aimed.x, aimed.y).fill('none').stroke({ color: SELECTION_COLOR, width: r * 0.25 });
}

function _clearAimRing(editor) {
    const layer = editor._handleLayer;
    const old = layer && layer.findOne ? layer.findOne('#' + AIM_RING_ID) : null;
    if (old) old.remove();
}

/** Drops an aim-select without selecting (a pinch, an aborted gesture, a tool switch). */
export function clearAimSelect(editor) {
    const aim = editor._aimSelect;
    editor._aimSelect = null;
    if (!aim) return;
    _aimRowMark(aim, null);
    _clearAimRing(editor);
    editor._setHover(null);
}

function _finishAimSelect(editor) {
    const aim = editor._aimSelect;
    const row = aim.row;
    const el = aim.moved ? aim.el : null;
    clearAimSelect(editor);
    if (row) { row.click(); return; } // slid onto the hold's menu: that row
    if (!el) return;
    const hitLayer = getElementLayer(el);
    if (hitLayer !== getActiveLayer(editor)) setActiveLayer(editor, hitLayer);
    editor._select(el);
}

const selectHandler = {
    // UI4 item 0: `presetHit` lets a caller that already resolved (and
    // trusts) a specific element skip this function's own generic
    // hit-test — shapeLatticeHandler.start passes one it found via
    // _getNearbyLatticePiece, since the generic editor._getNearbyElement
    // below can be a genuine bbox-center-distance TIE between a rail/tie
    // that touches the silhouette's own edge and that edge's own contour
    // segment (identical endpoints — confirmed live), a tie the generic
    // search resolves in the contour's favor (DOM order). Every other
    // caller omits it and keeps today's own hit-test exactly.
    start(editor, pt, e, presetHit = null) {
        const shift = !!(e && e.shiftKey);
        const pick = _pickPt(editor, pt);
        if ((editor._selectedElements || []).length) {
            const grabbed = hitTestHandle(editor._transformHandles, pick);
            if (grabbed) {
                const start = _grabAtFinger(editor, pt, e, new Set(editor._selectedElements));
                editor._dragMoved = false;
                editor._isDragging = true;
                editor._transformState = beginTransform(editor, grabbed, start);
                editor._lastDragPt = start;
                return;
            }
        }
        // SE7h add-on (Fred: generated Rails/Ties/Nodes were unclickable):
        // 'select' mode hit-tests across every VISIBLE layer, not just the
        // active one — see isOnVisibleLayer's own doc comment (layers.js).
        const hit = presetHit || _pickSelectable(editor, pick);
        editor._dragMoved = false;
        // UI4 item 0's one-shot _skipBoundaryRefillOnce flag is gone (F17 P2): refreshBoundaryPatterns refills only
        // when the fill's declared inputs changed (boundaryFillInputs), so a moved rail/tie/node survives any commit.
        if (hit) {
            // Clicking an element on a DIFFERENT layer makes that layer
            // the active one — the natural expectation that clicking
            // something makes it (and its layer) what you're now editing,
            // rather than requiring a pre-emptive layer pick in the
            // sidebar just to select what you can already see and click.
            const hitLayer = getElementLayer(hit);
            if (hitLayer !== getActiveLayer(editor)) setActiveLayer(editor, hitLayer);
            editor._isDragging = true;
            editor._lastDragPt = _grabAtFinger(editor, pt, e, new Set([hit, ...(editor._selectedElements || [])]));
            editor._selMove = null; // a fresh move: its snap anchors/targets are captured on the first move tick
            // H5 MULTI-SELECT: text is excluded (double-tap already opens
            // text editing there, handleDblClick above) — a plain, no-
            // modifier press on anything else can be the first or second
            // half of a double-tap-and-hold; armMultiSelectPress's own doc
            // comment explains why the replace-select below is skipped
            // (not run twice) when it returns true.
            if (shift) {
                editor._selectAdd(hit);
            } else if (hit.type !== 'text' && armMultiSelectPress(editor, hit, e)) {
                // second half of a double-tap: leave selection as tap 1 left it.
            } else {
                if (!(editor._selectedElements || []).includes(hit)) editor._select(hit);
                // H6 CONTEXT-MENU: a fresh press (not shift, not the second
                // half of a double-tap) is also a hold-to-menu candidate —
                // armContextMenuHold no-ops on desktop (right-click is its
                // own, separate trigger there).
                armContextMenuHold(editor, { kind: targetKindOf(hit), el: hit, point: pt }, e);
            }
            return;
        }
        // MOB5 (Fred: "pan and zoom doesn't work well in mobile") — a
        // one-finger drag on EMPTY canvas in Select mode used to always
        // start a marquee, on every pointer type. On touch that competes
        // with the far more commonly wanted "let me look around" gesture:
        // a mouse user already has Space+drag or a scroll wheel to pan; a
        // touch user has no one-finger equivalent without this. Declaring
        // touch = pan, mouse/pen = marquee (unchanged) reuses the SAME
        // _isPanning/_panStart state Space+drag/middle-click already
        // drive — handleMove/handleEnd's own pan branches (above) pick
        // this up with no new plumbing.
        if (!shift) editor._deselect();
        // H6 CONTEXT-MENU: a hold on empty canvas opens the empty-canvas
        // menu (Paste/Select all/Fit view) — no-ops on desktop, same as above.
        armContextMenuHold(editor, { kind: 'empty', el: null, point: pt }, e);
        // Fred ("lose 1f pan" + "tap hold and drag ... hover feedback to see what gets selected"): a one-finger
        // drag from empty space AIMS -- the marker above the finger lights what a lift selects (aim-select, below);
        // two fingers pan and zoom. (MOB5's one-finger pan used to live here.)
        if (editor._pointerType === 'touch') { _beginAimSelect(editor, e); return; }
        editor._isDragging      = true;
        editor._lastDragPt      = pt;
        editor._marqueeStart    = { x: pt.x, y: pt.y };
        editor._marqueeAdditive = shift;
        editor._marqueeRect     = null;
    },
    hover(editor, pt, raw = pt) {
        if ((editor._selectedElements || []).length
            && hitTestHandle(editor._transformHandles, raw)) {
            editor._setHover(null); return;
        }
        editor._setHover(_pickSelectable(editor, raw)); // the same pick a press / aim-select makes
    },
};

const nodeHandler = {
    start(editor, pt, e) {
        const pick = _pickPt(editor, pt);
        if (editor._selectedElement) {
            // SE7n: cache the node list (not just the hit index) — dragNode
            // needs the SAME closures for the rest of this gesture (a
            // rect's opposite-corner pin, a path's segment index) rather
            // than rebuilding them from the element's already-mutated
            // attrs on every subsequent move.
            const { idx, nodes } = findNodeAt(editor, pick);
            if (idx !== -1) {
                editor._isDragging = true;
                editor._dragNodeIndex = idx;
                editor._dragNodes = nodes;
                editor._lastDragPt = _grabAtFinger(editor, pt, e, new Set([editor._selectedElement]));
                return;
            }
        }
        // SE7h add-on: same anyVisibleLayer relaxation as selectHandler.
        const hit = editor._getNearbyElement(pick, getDynamicTolerance(editor, 10, 'slopPx'), { anyVisibleLayer: true });
        if (hit && hit !== editor._selectedElement) {
            const hitLayer = getElementLayer(hit);
            if (hitLayer !== getActiveLayer(editor)) setActiveLayer(editor, hitLayer);
            editor._select(hit);
        }
    },
    hover(editor, pt, raw = pt) {
        pt = raw; // audit batch 1: hover picks where the press will
        if (!editor._selectedElement) {
            const hit = editor._getNearbyElement(pt, getDynamicTolerance(editor, 10, 'slopPx'), { anyVisibleLayer: true });
            editor._setHover(hit); return;
        }
        const { idx: hitIdx } = findNodeAt(editor, pt);
        if (editor._hoverNodeIndex !== hitIdx) {
            editor._hoverNodeIndex = hitIdx;
            editor._updateHandles();
        }
        if (hitIdx === -1) {
            const hit = editor._getNearbyElement(pt, getDynamicTolerance(editor, 10, 'slopPx'), { anyVisibleLayer: true });
            editor._setHover(hit && hit !== editor._selectedElement ? hit : null);
        } else editor._setHover(null);
    },
};

const textHandler = {
    start(editor, pt, e) {
        const hit = editor._getNearbyElement(_pickPt(editor, pt), getDynamicTolerance(editor, 10, 'slopPx'));
        if (hit && hit.type === 'text') { beginTextEdit(editor, hit); return; }
        if (hit) editor._deselect();
        startTextAt(editor, pt, e); // a NEW text goes where the aim is
    },
    hover(editor, pt, raw = pt) {
        const hit = editor._getNearbyElement(raw, getDynamicTolerance(editor, 10, 'slopPx'));
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
    commitEdit(editor); // audit batch 3: the one commit
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
            commitEdit(editor); // audit batch 3: the one commit
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
    // H1 (SNAP-SPLIT, generalizing UI5 item 5's own fix): RAIL-SPACING can
    // now place a rail's row genuinely off the standard grid -- `s.a`
    // (toLattice-ROUNDED) would silently report the wrong row, and
    // nearestRailRow's own tolerance-based match (its own doc comment)
    // would then compare a tie's end against the WRONG target. `s.aWorld`
    // (the raw world point) through toLatticeFractional keeps this exact
    // for an off-grid rail while staying a no-op for an ordinary
    // integer-row one.
    return _collectLatticeElements(editor, spacing)
        .filter((s) => s.kind === 'rail')
        .map((s) => orient(toLatticeFractional(s.aWorld, spacing), orientation).j);
}

/**
 * SE7i (Section 4: "attachment derivation reads each piece's WORLD
 * geometry... never raw attrs"): every rail/tie/node on the ACTIVE layer,
 * in REAL (un-oriented) lattice coords — reading each element's WORLD
 * position (worldPoint bakes any transform= a Select-mode drag wrote)
 * rather than its raw x1/y1/cx/cy attributes, the same "moved elements
 * count where they ARE" fix SE7n already applied to findNodeAt/
 * _elementIdentityLatticePoints. Renamed + extended from the old
 * _collectLatticeSegments (rail/tie only, raw attrs, no `el` reference):
 * its two existing callers (_existingRailRows above, finish()'s own
 * crossing search below) still apply orient() themselves afterward,
 * unchanged — this just makes what they read correct under a transform.
 * Also now returns nodes (`{kind:'node', el, point, onGrid}`) for the
 * connected-editing move feature below; existing rail/tie-only callers
 * harmlessly filter those out. `excludeEl` skips the element currently
 * being dragged so it can't attach to or collide with itself.
 *
 * `aOnGrid`/`bOnGrid`/`onGrid` (SE7i): whether that END's WORLD point was
 * EXACTLY on a lattice point (isLatticePoint), checked on the RAW world
 * point BEFORE `toLattice` rounds it — `a`/`b`/`point` are already
 * rounded-to-nearest-cell, so checking on-grid-ness on THOSE instead
 * would be vacuously true for every end (any point rounds to some cell)
 * and silently defeat the whole "exact grid point, not just nearest"
 * attachment rule. Existing rail/tie-only callers don't read these
 * fields and are unaffected. */
function _collectLatticeElements(editor, spacing, excludeEl = null) {
    if (!editor._sketchLayer) return [];
    const activeLayer = getActiveLayer(editor);
    // T76 (SE17): gather across ALL of this pattern's own rail/tie/node
    // kind-layers, not just whichever ONE is currently active — a rail
    // living on the Rails layer must still find its own ties on the Ties
    // layer for "move connected" to work at all. Resolved from `excludeEl`
    // itself when given (the piece already being dragged — the most
    // specific context available, and correct even when the active layer
    // hasn't caught up to it yet); else the active layer. Falls back to
    // `[activeLayer]` alone for a pre-SE17 pattern with no `.layers` map
    // yet (every kind still resolves to that one shared layer, unchanged
    // from before this turn).
    const anchorLayerId = excludeEl ? getElementLayer(excludeEl) : activeLayer;
    const patternLayer = resolvePatternLayer(editor, anchorLayerId);
    const pattern = patternLayer && patternLayer.pattern;
    const layerIds = pattern && pattern.layers
        ? new Set([pattern.layers.rails, pattern.layers.ties, pattern.layers.nodes].filter(Boolean))
        : new Set([activeLayer]);
    const out = [];
    for (const ch of editor._sketchLayer.children().toArray()) {
        if (!ch || !ch.node || ch === excludeEl) continue;
        if (!layerIds.has(getElementLayer(ch))) continue;
        const kind = ch.node.getAttribute(LATTICE_ATTR);
        if (kind === 'rail' || kind === 'tie') {
            const x1 = parseFloat(ch.node.getAttribute('x1'));
            const y1 = parseFloat(ch.node.getAttribute('y1'));
            const x2 = parseFloat(ch.node.getAttribute('x2'));
            const y2 = parseFloat(ch.node.getAttribute('y2'));
            if ([x1, y1, x2, y2].some(Number.isNaN)) continue;
            const aWorld = worldPoint(ch, { x: x1, y: y1 });
            const bWorld = worldPoint(ch, { x: x2, y: y2 });
            out.push({
                kind, el: ch,
                a: toLattice(aWorld, spacing), b: toLattice(bWorld, spacing),
                aOnGrid: isLatticePoint(aWorld, spacing), bOnGrid: isLatticePoint(bWorld, spacing),
                // UI5 item 5: the RAW world endpoints too, alongside the
                // rounded-to-grid a/b above — a contour-anchored end sits
                // at a genuine FRACTIONAL lattice position, so matching
                // "is THIS the same point as that piece's own end" needs
                // the real coordinate, not the nearest integer cell.
                aWorld, bWorld,
            });
        } else if (kind === 'node') {
            const cx = parseFloat(ch.node.getAttribute('cx'));
            const cy = parseFloat(ch.node.getAttribute('cy'));
            if (Number.isNaN(cx) || Number.isNaN(cy)) continue;
            const world = worldPoint(ch, { x: cx, y: cy });
            out.push({ kind, el: ch, point: toLattice(world, spacing), onGrid: isLatticePoint(world, spacing), world });
        }
    }
    return out;
}

/**
 * SE7i/SE7k: snapshot everything a drag-to-move-or-stretch gesture needs,
 * captured ONCE at drag start — attachments derive from this frozen
 * snapshot for the whole gesture ("attachments are fixed at drag start; a
 * dragged rail never picks up ties it crosses mid-drag": Fred). Returns
 * `{kind:'rail'|'tie'|'node', mode:'move'|'stretch', ...}` — `mode`
 * dispatches _updateLatticeMove/_finishLatticeMove below; a `'node'` kind
 * only ever means `mode:'move'` (a standalone dot with nothing under it —
 * SE7k AMEND 5 retired every node-specific move/stretch redirect, see this
 * function's own body). Candidates come from _collectLatticeElements
 * (world-geometry-aware, active-layer-scoped, excluding the grabbed
 * element itself — EXCEPT the node-classification branch, which needs its
 * own grabbed node to remain a candidate so it can be carried along with
 * whichever piece it turns out to belong to). UI5 item 5 (advisor,
 * generalizing T73's own fix beyond the contour): "attach" means the
 * candidate's own REAL WORLD position exactly matches (tolerance, not
 * `===`) what it's claimed to attach to — Fred's original SE7i ruling,
 * "attach should mean snapped to grid on the same point, not merely close
 * to one," is preserved by that tolerance being tight (1e-6): a hand-
 * nudged tie a visible distance off its row still fails it exactly as it
 * failed the old isLatticePoint/`_OFF_GRID_SENTINEL` gate this replaced —
 * the difference is only that the "grid" a genuine attachment can sit on
 * is no longer assumed to be the standard integer one (a Shape Lattice's
 * on-boundary end, or a future off-grid RAIL-SPACING row, are exact,
 * intentional positions too). `startAttrs` is normally the grabbed
 * element's own
 * pre-drag attrs (captured AFTER the transform-bake below), used at
 * finish() to detect a true no-op (bare click) — the node-classification
 * branches are the exception, where it's the MATCHED piece's attrs
 * instead, since that's what actually ends up moving/stretching.
 *
 * SE7i (Section 4: "a Lattice-mode move BAKES its result into the attrs
 * (no transform left)"): if the grabbed element already carries a
 * transform= (e.g. a prior Select-mode move), it's baked into its raw
 * x1/y1/x2/y2 (or cx/cy) attrs HERE, before anything else reads or
 * writes them — every subsequent live write in this gesture sets those
 * raw attrs directly and would otherwise double-apply a leftover
 * transform on top of the new coordinates. */
/** SE7i (Section 4: "a Lattice-mode move BAKES its result into the attrs
 *  (no transform left)"), extracted from _beginLatticeMove's own former
 *  inline bake (UI5 item 0: the SAME bake is now also needed at the END
 *  of a plain Select-mode drag — see handleEnd's own call below) so both
 *  call sites share it rather than diverging. If `hit` carries a
 *  `transform=` (either a prior Select-mode move this function is baking
 *  before a NEW lattice-mode grab, or one Select mode itself just applied
 *  via translateSelection), folds it into the raw x1/y1/x2/y2 (or cx/cy)
 *  attrs and clears it — a no-op if there's no transform to bake. */
/** UI5 item 5 (Fred: "the node likely drops because the contour is not on
 *  the grid... node matching uses the declared tolerance, not exact grid
 *  coords"): is `p1` genuinely the SAME point as `p2`, in real WORLD
 *  (model-inch) space? The one comparison every "does this node belong to
 *  THIS piece's end" check below should use instead of rounding both
 *  sides to the nearest INTEGER lattice cell first (isLatticePoint/
 *  onGrid) and comparing THOSE — correct for an ordinary board-mode piece
 *  (always integer-aligned already), but silently wrong for a Shape
 *  Lattice piece anchored to the contour's own FRACTIONAL crossing: two
 *  points 0.4 cells apart can round to the SAME integer cell (a false
 *  match) while a genuinely-attached node sitting exactly at a fractional
 *  end (0 real distance away) gets rejected outright by the on-grid gate
 *  (a false miss — confirmed live, T73's own contour-anchored ties). 1e-6
 *  matches this file's own established float-compare tolerance elsewhere
 *  (_clampStretchToContour's span check, etc). */
function _sameWorldPoint(p1, p2, tol = 1e-6) {
    return Math.abs(p1.x - p2.x) < tol && Math.abs(p1.y - p2.y) < tol;
}

function _bakeLatticeTransform(hit, kind) {
    if (kind === 'node') {
        const nodeWorld = worldPoint(hit, { x: parseFloat(hit.attr('cx')), y: parseFloat(hit.attr('cy')) });
        if (hit.attr('transform')) { hit.attr({ transform: null }); hit.center(nodeWorld.x, nodeWorld.y); }
    } else {
        const aWorld = worldPoint(hit, { x: parseFloat(hit.attr('x1')), y: parseFloat(hit.attr('y1')) });
        const bWorld = worldPoint(hit, { x: parseFloat(hit.attr('x2')), y: parseFloat(hit.attr('y2')) });
        if (hit.attr('transform')) hit.attr({ x1: aWorld.x, y1: aWorld.y, x2: bWorld.x, y2: bWorld.y, transform: null });
    }
}

// `grabPt` (Fred: "It's catching rails instead"): where the finger/mouse REALLY pressed (no touch-aim offset, no
// grid snap) -- it decides end-STRETCH vs body-MOVE; `pt` stays the gesture's own start for the move deltas.
function _beginLatticeMove(editor, hit, kind, pt, spacing, orientation, grabPt = pt) {
    // Bake any leftover transform (a prior Select-mode move) into the
    // grabbed element's raw attrs FIRST, once, before anything below
    // reads or writes them — see this function's own header comment.
    _bakeLatticeTransform(hit, kind);
    const startAttrs = kind === 'node'
        ? { cx: hit.attr('cx'), cy: hit.attr('cy') }
        : { x1: hit.attr('x1'), y1: hit.attr('y1'), x2: hit.attr('x2'), y2: hit.attr('y2') };
    // Post-bake, the raw attrs ARE the world position (identity matrix,
    // or none) — worldPoint on them now is just a pass-through, but
    // reading through it uniformly (rather than branching on whether a
    // bake just happened) keeps this one code path for both cases.
    const aWorld = kind === 'node' ? null : worldPoint(hit, { x: parseFloat(hit.attr('x1')), y: parseFloat(hit.attr('y1')) });
    const bWorld = kind === 'node' ? null : worldPoint(hit, { x: parseFloat(hit.attr('x2')), y: parseFloat(hit.attr('y2')) });

    // SE7k AMEND 5 (Fred: "it's not about nodes, it's the feature's END
    // that can stretch it" — supersedes SE7j and AMENDs 2-4's own node-
    // specific wording): ONE rule for rails and ties alike — grab within
    // the declared end-grab zone (INPUT_PROFILE's handlePx, the same
    // "you grabbed a small control point" concept a transform handle
    // uses) of a piece's OWN endpoint -> STRETCH that end; grab the body
    // anywhere else -> MOVE (SE7i, unchanged). Nodes are NOT a special
    // grab target any more: a node sitting exactly at a piece's end is
    // simply inside that end's zone; a mid-span crossing node is on a
    // tie's body -> MOVE that tie; a standalone node -> moves itself.
    const endGrabTolCells = getDynamicTolerance(editor, 8, 'handlePx') / spacing;

    if (kind === 'rail' || kind === 'tie') {
        // T73: the piece's OWN endpoints, read via toLatticeFractional (not
        // toLattice) -- an on-boundary Shape Lattice end sits at the
        // contour's true FRACTIONAL crossing (e.g. canonical i=2.5), not
        // necessarily an integer cell. toLattice's Math.round would collapse
        // that to 3, silently drifting the piece's own recorded position a
        // half-cell away from where it actually is; nearestEndWithin below
        // then compares the click against the WRONG point and misses the
        // end-grab zone entirely, falling back to a body MOVE. Confirmed
        // live (T73 diagnostic, CDP): clicking exactly on an on-boundary
        // rail's own end reported mode:'move', not 'stretch', until this
        // read became fractional. A board-mode piece's endpoints are always
        // already integer, so this is a no-op there.
        const pieceCanon = { a: orient(toLatticeFractional(aWorld, spacing), orientation), b: orient(toLatticeFractional(bWorld, spacing), orientation) };
        const ptFracCanon = orient(toLatticeFractional(grabPt, spacing), orientation);
        const end = nearestEndWithin(pieceCanon, ptFracCanon, endGrabTolCells);

        if (end) {
            const candidates = _collectLatticeElements(editor, spacing, hit);
            // UI5 item 5: match against the grabbed piece's own REAL end
            // (aWorld/bWorld), not the on-grid-gated canonical point — see
            // _sameWorldPoint's own doc comment.
            const endWorld = end === 'a' ? aWorld : bWorld;
            const endNodeMatch = candidates.find((c) => c.kind === 'node' && _sameWorldPoint(c.world, endWorld));
            return {
                kind, mode: 'stretch', el: hit, orientation, spacing, startAttrs,
                pieceCanon, end, endNode: endNodeMatch ? endNodeMatch.el : null,
            };
        }

        if (kind === 'rail') {
            const candidates = _collectLatticeElements(editor, spacing, hit);
            // UI5 item 5 (advisor: "write the fix GENERALLY — an end
            // attached to something... snaps to that thing... not a
            // contour-only special case" — RAIL-SPACING will put rails
            // themselves off-grid next): moveRailAlongAxis now matches by
            // real-world TOLERANCE (its own doc comment), not `===` on an
            // isLatticePoint-gated, toLattice-ROUNDED value — the SAME
            // "compare exact positions, not the nearest integer cell"
            // fix as every other node/piece match in this file. The old
            // aOnGrid/bOnGrid/onGrid gate (and its _OFF_GRID_SENTINEL) was
            // there to stop a coincidentally-ROUNDED near-miss from
            // reading as attached; an exact fractional comparison can't
            // produce that false positive in the first place (a hand-
            // nudged tie 0.01in off its row fails a 1e-6 tolerance just as
            // it failed integer rounding), so the gate is now redundant
            // for this purpose and dropped rather than kept as dead
            // weight — every candidate's own REAL end goes straight in.
            const ties = candidates.filter((c) => c.kind === 'tie').map((c) => ({
                el: c.el,
                a: orient(toLatticeFractional(c.aWorld, spacing), orientation),
                b: orient(toLatticeFractional(c.bWorld, spacing), orientation),
            }));
            const nodes = candidates
                .filter((c) => c.kind === 'node')
                .map((c) => ({ el: c.el, point: orient(toLatticeFractional(c.world, spacing), orientation) }));
            return { kind, mode: 'move', el: hit, orientation, spacing, startAttrs, railCanon: pieceCanon, ties, nodes };
        }

        // kind === 'tie', body grab -> MOVE (whole tie slides, free in
        // BOTH axes — SE7j's constrainToIAxis is retired: that redirect
        // only ever existed to force node-grabs into an axis-locked tie
        // move, and nodes no longer redirect into a tie move at all).
        const startCanon = orient(toLattice(pt, spacing), orientation);
        const candidates = _collectLatticeElements(editor, spacing, hit);
        // UI5 item 5: match against the tie's own REAL ends (aWorld/
        // bWorld), not the on-grid-gated canonical point — a node sitting
        // exactly at a contour-anchored (fractional) tie end used to be
        // silently excluded here (onGrid false for a non-integer point),
        // so it was left behind, DETACHED, when the tie's body was
        // dragged. The OUTPUT point is fractional too (toLatticeFractional,
        // not the rounded c.point) — _updateLatticeMove's own per-frame
        // `node.point.i + di` just adds an integer delta, so a rounded
        // starting point here would silently drift the node a fraction of
        // a cell off its own true attachment on every subsequent move.
        const nodes = candidates
            .filter((c) => c.kind === 'node' && (_sameWorldPoint(c.world, aWorld) || _sameWorldPoint(c.world, bWorld)))
            .map((c) => ({ el: c.el, point: orient(toLatticeFractional(c.world, spacing), orientation) }));
        return { kind, mode: 'move', el: hit, orientation, spacing, startAttrs, tieCanon: pieceCanon, startCanon, nodes };
    }

    // kind === 'node'. Classify by WHAT'S UNDER IT, in TIE-priority order
    // (Fred's own framing throughout was "pulling on nodes should lengthen
    // the TIE" — a node that happens to coincide with both a tie's end and
    // a rail's end, a rare edge case, resolves to the tie): a tie's own
    // end -> STRETCH that tie's end; mid-span on a tie's body -> MOVE that
    // tie (whole slide); else a rail's own end -> STRETCH that rail's end;
    // else standalone (a bare Circle-tool dot, or a rail's mid-span node
    // with no tie there) -> free node move.
    // UI5 item 5: toLatticeFractional, not toLattice -- the grabbed node
    // itself can be a contour-anchored end-node (a fractional position),
    // and rounding it here would misfile it against the wrong row/column
    // below exactly like pieceCanon's own earlier fractional fix.
    const nodeWorld = { x: parseFloat(startAttrs.cx), y: parseFloat(startAttrs.cy) };
    const nodeCanon = orient(toLatticeFractional(nodeWorld, spacing), orientation);
    // No excludeEl: `hit` is a NODE, a different kind than whatever piece
    // this gesture ends up touching, so excluding it would silently drop
    // it from that piece's own "nodes riding along" collection.
    const candidates = _collectLatticeElements(editor, spacing, null);

    for (const c of candidates) {
        if (c.kind !== 'tie') continue;
        // UI5 item 5: the tie's own REAL ends (fractional-safe), not the
        // on-grid-gated canonical a/b -- a tie stretched to the contour
        // (T73) has a genuinely fractional end, and the old `!c.aOnGrid ||
        // !c.bOnGrid` gate skipped this tie ENTIRELY in that case, so
        // grabbing its own end-node fell through to "standalone node" —
        // detaching it from the tie instead of stretching the tie's end.
        const tieCanon = { a: orient(toLatticeFractional(c.aWorld, spacing), orientation), b: orient(toLatticeFractional(c.bWorld, spacing), orientation) };
        if (Math.abs(tieCanon.a.i - nodeCanon.i) > 1e-6) continue; // must be the tie's own column
        const jMin = Math.min(tieCanon.a.j, tieCanon.b.j), jMax = Math.max(tieCanon.a.j, tieCanon.b.j);
        if (nodeCanon.j < jMin - 1e-6 || nodeCanon.j > jMax + 1e-6) continue;

        const tieStartAttrs = { x1: c.el.attr('x1'), y1: c.el.attr('y1'), x2: c.el.attr('x2'), y2: c.el.attr('y2') };
        if (_sameWorldPoint(nodeWorld, c.aWorld)) {
            return { kind: 'tie', mode: 'stretch', el: c.el, orientation, spacing, startAttrs: tieStartAttrs, pieceCanon: tieCanon, end: 'a', endNode: hit };
        }
        if (_sameWorldPoint(nodeWorld, c.bWorld)) {
            return { kind: 'tie', mode: 'stretch', el: c.el, orientation, spacing, startAttrs: tieStartAttrs, pieceCanon: tieCanon, end: 'b', endNode: hit };
        }
        // Mid-span crossing -> MOVE the whole tie, carrying every node
        // along its full length (both ends and any other crossings), same
        // "grabbing anywhere on it carries everything it carries" rule a
        // direct body-grab already gets. Fractional throughout (not the
        // rounded `point`/`onGrid` fields) — same reasoning as the column/
        // range check just above.
        const nodes = candidates
            .filter((cc) => cc.kind === 'node')
            .map((cc) => ({ el: cc.el, point: orient(toLatticeFractional(cc.world, spacing), orientation) }))
            .filter((n) => Math.abs(n.point.i - tieCanon.a.i) < 1e-6 && n.point.j >= jMin - 1e-6 && n.point.j <= jMax + 1e-6);
        return { kind: 'tie', mode: 'move', el: c.el, orientation, spacing, startAttrs: tieStartAttrs, tieCanon, startCanon: nodeCanon, nodes };
    }

    for (const c of candidates) {
        if (c.kind !== 'rail') continue;
        // UI5 item 5: same real-world-end match as the tie loop above.
        const railCanon = { a: orient(toLatticeFractional(c.aWorld, spacing), orientation), b: orient(toLatticeFractional(c.bWorld, spacing), orientation) };
        for (const end of ['a', 'b']) {
            if (_sameWorldPoint(nodeWorld, end === 'a' ? c.aWorld : c.bWorld)) {
                const railStartAttrs = { x1: c.el.attr('x1'), y1: c.el.attr('y1'), x2: c.el.attr('x2'), y2: c.el.attr('y2') };
                return { kind: 'rail', mode: 'stretch', el: c.el, orientation, spacing, startAttrs: railStartAttrs, pieceCanon: railCanon, end, endNode: hit };
            }
        }
    }

    return { kind: 'node', mode: 'move', el: hit, orientation, spacing, startAttrs, nodeCanon };
}

/** Write a rail-move result (moveRailAlongAxis's own return shape) back
 *  onto the real elements — the rail's own line, every attached tie's
 *  ONE affected endpoint (the other is left exactly as it was, so the
 *  tie visibly stretches), and every carried node's centre. */
function _writeRailMove(move, result) {
    const { orientation, spacing } = move;
    if (move.chain) writeChainRow(move, result.rail.a.j); // SE16: every segment of a cut rail takes the new row
    else {
        const railA = fromLattice(orient(result.rail.a, orientation), spacing);
        const railB = fromLattice(orient(result.rail.b, orientation), spacing);
        move.el.attr({ x1: railA.x, y1: railA.y, x2: railB.x, y2: railB.y });
    }
    for (const { tie, end, point } of result.tieUpdates) {
        const p = fromLattice(orient(point, orientation), spacing);
        if (end === 'a') tie.el.attr({ x1: p.x, y1: p.y });
        else tie.el.attr({ x2: p.x, y2: p.y });
    }
    for (const { node, point } of result.nodeUpdates) {
        const p = fromLattice(orient(point, orientation), spacing);
        node.el.center(p.x, p.y);
    }
}

/** T48's own `_rowScanLine`/`_colScanLine` (editor-lattice-pattern.js,
 *  module-private there), duplicated rather than imported across that
 *  module boundary for two small pure helpers this file's own contour-
 *  stretch clamp (below) needs — same "genuinely shared small pure
 *  helper" convention `_distToSegment` above already uses. Real
 *  (un-oriented) scan line for a CANONICAL row `j` (a rail) / column `i`
 *  (a tie) — see editor-lattice-pattern.js's own doc comment on the
 *  originals for the full derivation. */
function _rowScanLine(j, orientation) {
    const p0 = orient({ i: 0, j }, orientation);
    const p1 = orient({ i: 1, j }, orientation);
    return { point: { x: p0.i, y: p0.j }, dir: { x: p1.i - p0.i, y: p1.j - p0.j } };
}
function _colScanLine(i, orientation) {
    const p0 = orient({ i, j: 0 }, orientation);
    const p1 = orient({ i, j: 1 }, orientation);
    return { point: { x: p0.i, y: p0.j }, dir: { x: p1.i - p0.i, y: p1.j - p0.j } };
}

/** UI5 AMEND 2 (Fred, "T73 rule": rail/tie ends that sit on the contour
 *  stay ON the contour segment): clamps a stretch's target axis value to
 *  the boundary's own insideSpans along the piece's FIXED axis (the row
 *  for a rail, the column for a tie) — the SAME span-clip math
 *  `_resolveExtent`'s own 'boundary' branch already uses to bound
 *  freshly-GENERATED rails/ties (editor-lattice-pattern.js), applied here
 *  to a single live END-STRETCH instead of a whole grid. Gated on
 *  `usesContourCenterline` — the SAME declared condition T73 AMEND 3
 *  already established for GENERATION ("a Shape Lattice with its contour
 *  shown forces 'on-boundary' regardless of the pattern's own stored
 *  endRule"): a no-op for the box Lattice (board-mode, no boundary at
 *  all) AND for a Shape Lattice whose contour is hidden or whose endRule
 *  is inset/joint/loose (freshly-generated ends don't reach the contour
 *  there either, so a drag has nothing to stay coincident with).
 *
 *  Reads the boundary from the LIVE DRAWN CONTOUR ELEMENTS
 *  (`_findBoundaryElements` + `joinSegmentPathsIntoClosedD` +
 *  `insetGeneratedPresetPathDToPrimitives(d, 0)`) — the exact same
 *  synchronous branch `_resolveBoundaryPrimitives` itself takes for a
 *  generated (N-segment) contour under this same `usesContourCenterline`
 *  gate (halfWidth 0) — rather than a fresh `generateSilhouette` call.
 *  Confirmed live (T73 diagnostic) the two are NOT geometrically
 *  identical: `insetGeneratedPresetPathDToPrimitives`'s own path
 *  round-trip through the drawn `d` shifts a crossing by a fraction of a
 *  lattice unit versus a bare fresh silhouette — using the SAME source
 *  the actual rails/ties were placed against is what makes an end that's
 *  already sitting on the contour clamp to ITS OWN position (a no-op)
 *  instead of drifting. Picks whichever span CONTAINS the fixed end's own
 *  position (not just the first span on that row/column) so a multi-lobe
 *  silhouette (e.g. the hourglass' waist) clamps against the lobe the
 *  piece is actually in. */
function _clampStretchToContour(editor, move, targetAxisValue) {
    const pattern = getLayerPattern(editor);
    if (!pattern || !usesContourCenterline(pattern)) return targetAxisValue;
    const shapeId = pattern.boundary && pattern.boundary.shapeId;
    const boundaryEls = _findBoundaryElements(editor, shapeId);
    if (boundaryEls.length <= 1) return targetAxisValue; // async shapeToInnerBoundaryPrimitives path -- not reachable synchronously here; see doc comment
    let scaled;
    try {
        const combinedD = joinSegmentPathsIntoClosedD(boundaryEls.map((el) => el.attr('d') || ''));
        const primitives = insetGeneratedPresetPathDToPrimitives(combinedD, 0);
        scaled = primitives.map((p) => _scalePrimitiveToLattice(p, move.spacing));
    } catch (_) {
        return targetAxisValue; // defensive: never let a boundary lookup crash a live drag
    }
    const fixedEnd = move.end === 'a' ? move.pieceCanon.b : move.pieceCanon.a;
    const scanLine = move.kind === 'rail' ? _rowScanLine(fixedEnd.j, move.orientation) : _colScanLine(fixedEnd.i, move.orientation);
    const spans = insideSpans(scanLine, scaled);
    if (!spans.length) return targetAxisValue; // no boundary crossing on this row/column -- nothing to clamp against
    const fixedAlong = move.kind === 'rail' ? fixedEnd.i : fixedEnd.j;
    const span = spans.find(([lo, hi]) => fixedAlong >= lo - 1e-6 && fixedAlong <= hi + 1e-6) || spans[0];
    return Math.max(span[0], Math.min(span[1], targetAxisValue));
}

/** SE7k AMEND 4/5: one tick of an end-STRETCH gesture — recomputes the
 *  stretched end from the FIXED drag-start snapshot and the CURRENT
 *  pointer, writing straight to `move.el`'s attrs and carrying its own
 *  end-node (if any) along. `stretchFn`/`axisOf` are the one thing that
 *  differs between a rail (varies canonical i, its own row j fixed) and a
 *  tie (varies canonical j, its own column i fixed) — everything else
 *  (grid+rail-row snap already applied by the caller for a tie, clamp-
 *  against-the-other-end, carry the end node) is identical, so this is
 *  ONE function for both rather than near-duplicate rail/tie copies. */
function _updateLatticeStretch(editor, move, targetAxisValue, stretchFn) {
    const { orientation, spacing } = move;
    const stretched = stretchFn(move.pieceCanon, move.end, targetAxisValue);
    const a = fromLattice(orient(stretched.a, orientation), spacing);
    const b = fromLattice(orient(stretched.b, orientation), spacing);
    move.el.attr({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    if (move.endNode) {
        const p = fromLattice(orient(stretched[move.end], orientation), spacing);
        move.endNode.center(p.x, p.y);
    }
    if (move.railEnd && typeof editor._updateHandles === 'function') editor._updateHandles(); // T81 item 7: the end handle rides the end
}

/** Fred: "The only distance it should use is the stroke width." A rail or
 *  tie end-stretch's shortest length is the piece's own stroke width
 *  (`minPieceLength`), in canonical cells -- never one lattice cell. The
 *  T81 item 7 end handle arms the same value as `move.railEnd.minLen`. */
function _stretchMinCells(move) {
    return minPieceLength(move.el) / (move.spacing || 1);
}
function _railStretchFn(move) {
    const minLen = move.railEnd ? move.railEnd.minLen : _stretchMinCells(move);
    return (canon, end, target) => stretchRailEnd(canon, end, target, minLen);
}

/** H1 (SNAP-SPLIT): the nearest existing geometry point to the RAW
 *  pointer, as a canonical axis value (`'i'` or `'j'`, matching whichever
 *  axis the caller's own gesture varies) — null when GEOMETRY snap is off
 *  or nothing qualifies, so every caller below falls through to its own
 *  existing grid/rail-row logic unchanged. `move.el` is excluded so a
 *  piece can't snap to its own about-to-move endpoint (nearestGeometrySnap
 *  itself is generic across every visible layer's own rails/ties/nodes/
 *  contour/hand-drawn geometry, editor-snap-resolver.js's own doc
 *  comment — no lattice-specific candidate gathering needed here). */
function _geometryAxisSnap(editor, move, pt, axis) {
    if (!editor._grid || !editor._grid.geometrySnap) return null;
    const tol = getDynamicTolerance(editor, GEOMETRY_SNAP_TOL_PX, 'slopPx');
    // SE16: a cut rail's chain never snaps onto one of its OWN segments' points
    const hit = nearestGeometrySnap(pt, editor, tol, move.excludeSet || move.el);
    if (!hit) return null;
    return orient(toLatticeFractional(hit, move.spacing), move.orientation)[axis];
}

/** SE7i/SE7k: one tick of a piece-move-or-stretch gesture — recomputes the
 *  live geometry from the FIXED drag-start snapshot (`editor._latticeMove`)
 *  and the CURRENT pointer position, writing straight to the real
 *  elements' attrs (no separate preview overlay, no transform= — SE7i
 *  Section 4: "a Lattice-mode move BAKES its result into the attrs"). Runs
 *  on every mousemove; the eventual undo step is a single pushState() at
 *  finish(), not one per tick. */
// T81 item 5 (Fred: "the yellow highlight is persistent even after I
// released a moved tie"): thin wrapper so EVERY exit of
// _updateLatticeMoveGeometry (it has several — joint slide, a chained tie
// translate, and the plain fall-through case) refreshes the SELECTION HALO
// (editor-ui.js, #ffcc00) exactly once, rather than one-off calls sprinkled
// at each `return` that a future added branch could forget. The halo is a
// static clone taken at grab time (Select sub-mode selects the piece it
// just grabbed); every write in the geometry function moves the REAL
// element, never it. translateSelection/dragNode (this file's own Select/
// Node-mode drag paths) already refresh it every move tick — this lattice
// move path never did, so the halo stayed glued to the piece's PRE-drag
// position for the whole gesture, "persistent" exactly as reported.
function _updateLatticeMove(editor, pt) {
    _updateLatticeMoveGeometry(editor, pt);
    if (typeof editor._updateSelectionHighlight === 'function') editor._updateSelectionHighlight();
}

function _updateLatticeMoveGeometry(editor, pt) {
    const move = editor._latticeMove;
    const { spacing, orientation } = move;
    const canonPt = orient(toLattice(pt, spacing), orientation);

    if (move.mode === 'joint') { // SE16: a cut rail's joint slides ALONG the rail, both ends together (Fred Q3)
        updateJointSlide(move, _geometryAxisSnap(editor, move, pt, move.axis) ?? canonPt[move.axis]);
        return;
    }
    if (move.kind === 'rail' && move.mode === 'stretch') {
        // A rail's end moves along its OWN axis (canonical i) only — its
        // row (j) never changes during a stretch, unlike a move. H1: a
        // nearby GEOMETRY target (another rail's own end, a tie's column,
        // an intersection) wins over the plain grid value when GEOMETRY
        // is on and something is within tolerance. T73: clamped to the
        // contour when the layer's pattern is boundary-mode (a no-op for
        // board-mode box Lattice) — applied AFTER either source picks the
        // raw target, same "snap first, then pull back inside the
        // contour" composition the tie-stretch branch below already uses.
        const targetI = _geometryAxisSnap(editor, move, pt, 'i') ?? canonPt.i;
        // T81 item 7: then the lattice boundary limit resolved at grab
        // (board extent, or the row's clip span for a boundary pattern --
        // the SAME clip a drawn rail gets), plus a GEOM snap onto that
        // boundary crossing (editor-rail-end-stretch.js).
        const geomOn = !!(editor._grid && editor._grid.geometrySnap);
        const tolCells = getDynamicTolerance(editor, GEOMETRY_SNAP_TOL_PX, 'slopPx') / spacing;
        const target = railEndTarget(move, _clampStretchToContour(editor, move, targetI), tolCells, geomOn);
        _updateLatticeStretch(editor, move, target, _railStretchFn(move));
    } else if (move.kind === 'rail') {
        // A rail moves only ACROSS its own direction — never slides
        // along its own length — so only the row (canonical j) tracks
        // the pointer; moveRailAlongAxis carries the i-range over as-is.
        const targetJ = pushTieJoints(move, _geometryAxisSnap(editor, move, pt, 'j') ?? canonPt.j); // F19: cut ties' joints pushed ahead
        const result = moveRailAlongAxis(move.railCanon, targetJ, move.ties, move.nodes);
        _writeRailMove(move, result);
    } else if (move.kind === 'tie' && move.mode === 'stretch') {
        // A tie's end moves along its OWN axis (canonical j). H1: GEOMETRY
        // on tries the existing rail-row magnetism FIRST (railSnapRows —
        // the SAME snap a freshly-drawn tie's end already gets, T30/SE7k's
        // own update(); ROADMAP's own "ties' rail contacts" target,
        // row-based so the tie can land anywhere along the rail's own
        // length, not just at its two endpoints), then falls back to a
        // plain nearby-point geometry match, then the grid — all three
        // gated the SAME way now instead of the rail-row magnetism firing
        // unconditionally regardless of either toggle.
        let target = canonPt.j;
        if (editor._grid && editor._grid.geometrySnap) {
            const railSnapRows = getLayerPattern(editor)?.ties?.railSnapRows ?? PATTERN_DEFAULTS.ties.railSnapRows;
            const railRows = _existingRailRows(editor, spacing, orientation);
            const snappedRow = nearestRailRow(canonPt.j, railRows, railSnapRows);
            target = snappedRow != null ? snappedRow : (_geometryAxisSnap(editor, move, pt, 'j') ?? canonPt.j);
        }
        // T73: same contour clamp as the rail-stretch branch above, applied
        // AFTER the rail-row snap so the two constraints compose (snap
        // first, then pull back inside the contour if the snapped row
        // itself falls outside it).
        _updateLatticeStretch(editor, move, _clampStretchToContour(editor, move, target), (c, e, t) => stretchTieEnd(c, e, t, _stretchMinCells(move)));
    } else if (move.kind === 'tie') {
        // A tie "drags freely... NOT confined between rails" — a rigid
        // translation of both ends by the same snapped delta, free in
        // BOTH axes (SE7k AMEND 5 retired SE7j's constrainToIAxis: that
        // only ever existed to force a node-grab into an axis-locked tie
        // move, and a node grab no longer redirects into a tie MOVE at
        // all — it redirects into a STRETCH, above, or a plain mid-span
        // move here, which was always free in both axes).
        const di = canonPt.i - move.startCanon.i;
        const dj = canonPt.j - move.startCanon.j;
        if (move.chain) { writeChainTranslate(move, di, dj); return; } // SE16: a cut tie moves as one
        const moved = translateTie(move.tieCanon, di, dj);
        const a = fromLattice(orient(moved.a, orientation), spacing);
        const b = fromLattice(orient(moved.b, orientation), spacing);
        move.el.attr({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        for (const node of move.nodes) {
            // `move.nodes` can include a MID-SPAN crossing (not just the
            // tie's own 2 endpoints) when triggered via a node grab —
            // applying the delta to the node's OWN starting point (rather
            // than assuming it sits at tieCanon.a or .b) handles both
            // cases identically and costs nothing for the endpoint case,
            // where node.point already equals tieCanon.a/b exactly.
            const p = fromLattice(orient({ i: node.point.i + di, j: node.point.j + dj }, orientation), spacing);
            node.el.center(p.x, p.y);
        }
    } else {
        // 'node': no piece under it at all — a plain free single-point
        // move. H1: GEOMETRY on and a nearby target found -> that exact
        // point (both axes, not just one -- a free node isn't confined to
        // a single row/column the way a rail/tie stretch is); otherwise
        // the plain grid point, exactly as before H1.
        let p;
        if (editor._grid && editor._grid.geometrySnap) {
            const tol = getDynamicTolerance(editor, GEOMETRY_SNAP_TOL_PX, 'slopPx');
            p = nearestGeometrySnap(pt, editor, tol, move.el);
        }
        if (!p) p = fromLattice(orient(canonPt, orientation), spacing);
        move.el.center(p.x, p.y);
    }
}

/** SE7i/SE7k: commit a piece-move-or-stretch gesture — one undo step for
 *  EVERYTHING that changed (the rail/tie/node itself plus every stretched
 *  tie and carried node for a move, or the one carried end-node for a
 *  stretch), skipped entirely when nothing actually changed (a bare click
 *  on an existing piece, matching "a bare click does nothing" for the
 *  draw-new gesture this one sits alongside). Reads generically off
 *  `move.el`'s own attrs regardless of `mode` — a stretch and a move both
 *  just end up as new x1/y1/x2/y2 (or cx/cy) on that one element. Moved/
 *  stretched pieces KEEP their OWNERSHIP_ATTR — this function never
 *  touches it, by construction. */
function _finishLatticeMove(editor) {
    const move = editor._latticeMove;
    editor._latticeMove = null;
    editor._isDrawing = false;
    // T81 item 7: a rail end stretch whose boundary limit is still
    // resolving (async boundary lookup) commits once it lands, re-applying
    // the limit to the last target first -- the release is never allowed
    // to commit an end past the boundary.
    const pending = whenRailLimitReady(move);
    if (pending) {
        return pending.then(() => {
            const r = move.railEnd;
            if (r.lastRaw != null) _updateLatticeStretch(editor, move, railEndTarget(move, r.lastRaw, r.tolCells, r.geomOn), _railStretchFn(move));
            _commitLatticeMove(editor, move);
        });
    }
    _commitLatticeMove(editor, move);
}

function _commitLatticeMove(editor, move) {
    endRailEndStretch(editor); // T81 item 7: drop the held end-handle look, every release
    // T81 item 5: the ONE end-of-drag cleanup every exit path (pointerup,
    // pointercancel, lost capture — all funnel into handleEnd -> this
    // function) already runs through. Unconditional, before the `moved`
    // check below: refreshes the selection halo to the piece's FINAL real
    // position even on a no-op release (harmless — nothing changed, so the
    // halo drawn at grab time is already correct) and is a plain no-op if
    // `applyLayerState` below happens to deselect (its own doc comment: a
    // piece that became non-editable by its layer) — that already clears
    // every highlight itself.
    if (typeof editor._updateSelectionHighlight === 'function') editor._updateSelectionHighlight();
    const nowAttrs = move.kind === 'node'
        ? { cx: move.el.attr('cx'), cy: move.el.attr('cy') }
        : { x1: move.el.attr('x1'), y1: move.el.attr('y1'), x2: move.el.attr('x2'), y2: move.el.attr('y2') };
    const moved = Object.keys(move.startAttrs).some((k) => move.startAttrs[k] !== nowAttrs[k]);
    if (!moved) return;
    // T81 item 7: ties/nodes left past a stretched rail's new end go in
    // THIS same undo step (before the one pushState below).
    if (move.railEnd) {
        move.railEndPruned = pruneAfterRailStretch(editor, move);
        // T81 item 5 (re-reported): pruneAfterRailStretch removes elements from the DOM directly and knows
        // nothing about selection -- a tie/node that rode along SELECTED (possible when the grabbed rail
        // end was already part of a multi-selection, so the grab above never replaced it) is now a detached
        // element still sitting in editor._selectedElements, and the halo refresh above already ran before
        // this prune, so its clone is never torn down either. Drop anything no longer in the document and
        // resync the halo to match -- the same "is this element still live" check editor-grid.js's own
        // _connected() uses for a stale snap-cursor wrapper.
        const sel = editor._selectedElements || [];
        const live = sel.filter((el) => el && el.node && el.node.isConnected);
        if (live.length !== sel.length) {
            editor._selectedElements = live;
            if (typeof editor._updateSelectionHighlight === 'function') editor._updateSelectionHighlight();
        }
    }
    applyLayerState(editor);
    if (typeof editor.pushState === 'function') editor.pushState();
    // audit batch 2: through the commit hooks like every other edit (a pending refill is settled in THIS step)
    if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
    else if (editor._onChange) editor._onChange();
}

/** SE7k: the active layer's own pattern widths/colors, defaults filled in
 *  — the ONE numbers hand-drawn pieces use now (rails/ties/nodes), same
 *  source Generate reads, replacing LATTICE_STYLE-derived sizing and the
 *  general toolbar color (Fred was confused the two differed). A layer
 *  with no `.pattern` yet reads as PATTERN_DEFAULTS, same "missing =
 *  defaults" convention every other pattern-field read here already uses. */
function _currentPatternStyle(editor) {
    const pattern = getLayerPattern(editor) ?? PATTERN_DEFAULTS;
    return {
        widths: { ...PATTERN_DEFAULTS.widths, ...pattern.widths },
        colors: { ...PATTERN_DEFAULTS.colors, ...pattern.colors },
    };
}

/** SE7k: emit a rail/tie/node with the layer pattern's own width+color for
 *  `kind`, via the SAME "swap editor._color, emit, restore" idiom
 *  generatePattern (editor-lattice-pattern.js) already uses to get
 *  per-kind colors out of emitSegment/emitNode without adding a second
 *  color-override parameter to either — one mechanism for both the
 *  generator and the hand tool, not two. `kind` is 'rail'|'tie'|'node';
 *  the PATTERN.widths/colors key names are 'rails'/'ties'/'nodes' — this
 *  is the one place that maps between them for the hand tool (the
 *  generator's own loop does the same mapping inline per kind). */
function _emitStyled(editor, kind, a, b) {
    const { widths, colors } = _currentPatternStyle(editor);
    const styleKey = kind === 'rail' ? 'rails' : kind === 'tie' ? 'ties' : 'nodes';
    const previousColor = editor._color;
    editor._color = colors[styleKey];
    // a hand-drawn rail / tie / node goes onto the lattice's own layer for its kind (Rails / Ties / Nodes), not
    // whichever layer happens to be active -- a tie drawn with Rails active used to land on Rails (and under it)
    const pattern = getLayerPattern(editor);
    const kindLayer = pattern && pattern.layers && pattern.layers[styleKey];
    const previousLayer = editor._activeLayer;
    if (kindLayer && (editor._layers || []).some((l) => l.id === kindLayer)) editor._activeLayer = kindLayer;
    const el = kind === 'node'
        ? emitNode(editor, a, widths.nodeDiameter / 2)
        : emitSegment(editor, kind, a, b, widths[styleKey]);
    editor._activeLayer = previousLayer;
    editor._color = previousColor;
    return el;
}

/** SE7k AMEND 1 (Fred: "spawn or drag, what's best?" — advisor ruling:
 *  BOTH): a Rail click's default spawn — the FULL board-extent row at the
 *  clicked canonical row, "same extent Generate uses" (LATTICE_DRAW_KINDS'
 *  own clickSpawn:'fullRow'). Reuses editor-lattice-pattern.js's own
 *  _resolveExtent + the SAME orient()-conjugation computePattern itself
 *  applies to that extent (editor-lattice-pattern.js:271-275) rather than
 *  a second copy of that margin/orientation math — a rail spawned here and
 *  one Generate would draw on this same row are byte-identical in extent.
 *  Returns {a,b} in CANONICAL coords. */
function _spawnRailFullRow(editor, clickCanon, orientation) {
    const pattern = getLayerPattern(editor) ?? PATTERN_DEFAULTS;
    // T80 item 2: a boundary-mode (Shape Lattice) row's extent IS the shape
    // -- spawn the whole row and let finish()'s clip keep what's inside.
    if (pattern.extent?.mode === 'boundary') {
        return { a: { i: -Infinity, j: clickCanon.j }, b: { i: Infinity, j: clickCanon.j } };
    }
    const rawExtent = _resolveExtent(editor, pattern);
    const extentMin = orient({ i: rawExtent.iMin, j: rawExtent.jMin }, orientation);
    const extentMax = orient({ i: rawExtent.iMax, j: rawExtent.jMax }, orientation);
    return {
        a: { i: extentMin.i, j: clickCanon.j },
        b: { i: extentMax.i, j: clickCanon.j },
    };
}

/** SE7k AMEND 1: a Tie click's default spawn — bridges the two nearest
 *  EXISTING rail rows straddling the click (clickSpawn:'betweenRails');
 *  with fewer than two rails to bridge, falls back to a fixed span of the
 *  active layer's own `ties.spanMin` rows (PATTERN_DEFAULTS if the layer
 *  has no pattern yet) starting at the click, extending toward increasing
 *  canonical j — a plain, deterministic default, not a random draw (that's
 *  the GENERATOR's own job, not a single click's). Returns {a,b} in
 *  CANONICAL coords. */
function _spawnTieBetweenRails(editor, clickCanon, orientation, spacing) {
    const railRows = _existingRailRows(editor, spacing, orientation);
    const above = railRows.filter((r) => r < clickCanon.j);
    const below = railRows.filter((r) => r > clickCanon.j);
    if (above.length && below.length) {
        const jAbove = Math.max(...above);
        const jBelow = Math.min(...below);
        return { a: { i: clickCanon.i, j: jAbove }, b: { i: clickCanon.i, j: jBelow } };
    }
    const pattern = getLayerPattern(editor) ?? PATTERN_DEFAULTS;
    const spanMin = Math.max(1, pattern.ties?.spanMin ?? PATTERN_DEFAULTS.ties.spanMin);
    return { a: { i: clickCanon.i, j: clickCanon.j }, b: { i: clickCanon.i, j: clickCanon.j + spanMin } };
}

/** latticeHandler.finish's emit step: draw each CANONICAL {a, b} piece of
 *  `kind`, auto-nodes at its crossings, then one commit. Pieces is one
 *  segment normally; a Shape Lattice rail clipped by its shape (T80 item 2)
 *  can give several, or none (drawn wholly outside -> nothing, no commit). */
function _emitHandPieces(editor, kind, pieces, orientation, spacing) {
    if (!pieces.length) return;
    // Gathered BEFORE the new segment is emitted (unchanged from
    // before SE7h) so it never crosses against itself — oriented into
    // the canonical frame since the crossing math below is.
    const existing = editor._lattice.autoNodes
        ? _collectLatticeElements(editor, spacing)
            .filter((s) => s.kind === 'rail' || s.kind === 'tie')
            .map((s) => ({ kind: s.kind, a: orient(s.a, orientation), b: orient(s.b, orientation) }))
        : [];
    for (const { a: aCanon, b: bCanon } of pieces) {
        // emitSegment draws the REAL a/b — only the crossing math below
        // needs the canonical conjugation, same reasoning as
        // computePattern's own crossings step. SE7k: styled from the
        // active layer's own pattern (_emitStyled), not LATTICE_STYLE/the
        // toolbar color.
        _emitStyled(editor, kind, fromLattice(orient(aCanon, orientation), spacing), fromLattice(orient(bCanon, orientation), spacing));
        if (editor._lattice.autoNodes) {
            const crossingsCanon = latticeCrossings({ kind, a: aCanon, b: bCanon }, existing);
            crossingsCanon.forEach((ptCanon) => {
                const latPt = orient(ptCanon, orientation);
                const p = fromLattice(latPt, spacing);
                _emitStyled(editor, 'node', p, p);
            });
        }
    }
    applyLayerState(editor);
    commitEdit(editor); // audit batch 3: the one commit
}

// SE7k (Fred: "needs an add rail and add tie, add node button"): the Add:
// segmented control (properties-lattice.js, from LATTICE_DRAW_KINDS) picks
// editor._lattice.drawKind explicitly — rail/tie drags are CONSTRAINED to
// that kind regardless of which way the mouse actually moves (replaces
// the old classifyDrag/constrain direction-guessing), and node mode places
// immediately on click, no drag needed (see the 'node' branch in start()
// below). Snaps to the lattice ALWAYS via toLattice/fromLattice directly,
// NOT editor._snap — the lattice tool IS the grid, independent of the
// SNAP toggle (SNAP_POLICY's 'always' row exists for the hover cursor/
// other callers of _snap, not for this handler's own point resolution).
const latticeHandler = {
    start(editor, pt, e) {
        const spacing = editor._grid.spacing || 0.25;
        editor._latticeSpacing = spacing;
        const drawKind = editor._lattice.drawKind || 'rail';

        // SE7i (Section 3, connected editing): drag ON an existing rail/
        // tie/node moves it, structure-aware; drag on empty space (or on
        // a non-lattice shape) still draws a new rail/tie exactly as
        // before. SE7k: this check runs BEFORE the drawKind branch below,
        // so dragging ON an existing piece still moves it no matter which
        // Add mode is active — only empty space reaches the kind-specific
        // behavior.
        // T76 (SE17): `_getNearbyLatticePiece` (not `editor._getNearbyElement`,
        // this block's own pre-SE17 mechanism) — the SAME rail/tie/node-only
        // hit-test `shapeLatticeHandler.start` already uses, coordinating on
        // ONE shared implementation rather than two, per the dispatch's own
        // instruction. Critically, it is NOT layer-scoped at all (unlike
        // `getNearbyElement`'s own active-layer-only default) — a rail is
        // now on the Rails layer while a tie sits on the Ties layer, so a
        // hit-test confined to "whichever layer is active" would miss
        // every piece of a DIFFERENT kind than the one just clicked.
        const tol = getDynamicTolerance(editor, 10, 'slopPx');
        // Fred ("In lattice I can't move selected ties easily" / "It's catching rails instead"): the piece is
        // picked where the finger/mouse REALLY is. `pt` is the touch-aim point (40 px ABOVE the finger) snapped to
        // the grid -- right for drawing a new rail/tie, but on a tie a rail's length away from the finger it hit
        // the rail above. Shape Lattice already hit-tests the raw point (shapeLatticeHandler.start).
        const rawPt = _latticePickPt(editor, pt, e);
        const near = _nearbyLatticePiece(editor, rawPt, tol);
        // T81 item 6 (Fred: "I can't seem to select contour segment"): this tool had NO such check at
        // all -- any rail/tie/node in range committed unconditionally below, and a hand-picked boundary's
        // own contour is always reachable with rails clipped right to its edge, so it never got a turn.
        // The SAME pick-priority `_boundaryNear`/`_contourWinsPick` shapeLatticeHandler.start uses: a
        // piece wins only when it's genuinely closer by visible edge, not merely in range.
        const seg = near.el ? _boundaryNear(editor, rawPt) : null;
        const hit = _contourWinsPick(seg, near) ? null : near.el;
        const hitKind = hit ? hit.node.getAttribute(LATTICE_ATTR) : null;
        if (hitKind === 'rail' || hitKind === 'tie' || hitKind === 'node') {
            // T76 (SE17): grabbing a piece on a DIFFERENT kind-layer than
            // the currently active one makes ITS layer the active one —
            // same "clicking something makes it what you're now editing"
            // rule selectHandler/nodeHandler's own analogous hit already
            // applies (this file, above).
            const hitLayer = getElementLayer(hit);
            if (hitLayer !== getActiveLayer(editor)) setActiveLayer(editor, hitLayer);
            // UI3 AMEND 1/3 (Fred): Select sub-mode also SELECTS the
            // grabbed piece (reusing editor._select/_selectAdd — the same
            // whole-selection state editor.setColor/deleteSelected read —
            // not a second selection system) — move/stretch below is
            // already unconditional on drawKind and needs no change: a
            // bare tap (no movement) leaves the piece selected with
            // nothing moved (_finishLatticeMove's own no-op check), and a
            // real drag moves/stretches it exactly as every other drawKind
            // already does.
            if (drawKind === 'select') {
                const shift = !!(e && e.shiftKey);
                // H5 MULTI-SELECT: same shape as selectHandler.start's own
                // identical branch above (a lattice piece is never text,
                // so no type check needed here).
                if (shift) {
                    editor._selectAdd(hit);
                } else if (armMultiSelectPress(editor, hit, e)) {
                    // second half of a double-tap: leave selection as tap 1 left it.
                } else {
                    if (!(editor._selectedElements || []).includes(hit)) editor._select(hit);
                    // H6 CONTEXT-MENU: same shape as selectHandler.start's
                    // own identical branch above.
                    armContextMenuHold(editor, { kind: targetKindOf(hit), el: hit, point: pt }, e);
                }
            } else {
                editor._deselect();
            }
            editor._isDrawing = true;
            const orientation = getLayerPattern(editor)?.orientation ?? PATTERN_DEFAULTS.orientation;
            editor._latticeMove = withChain(editor, _beginLatticeMove(editor, hit, hitKind, pt, spacing, orientation, rawPt));
            armRailEndStretch(editor, editor._latticeMove); // T81 item 7
            return;
        }

        // UI3 AMEND 1: Select sub-mode on empty space just (de)selects —
        // never falls into the rail/tie/node ADD behaviour below (matches
        // selectHandler.start's own "click empty space deselects" shape,
        // minus the marquee/pan — a lattice-panel Select tap is for
        // picking an existing piece, not drawing a new selection box).
        if (drawKind === 'select') {
            // Fred ("Moving contour piece won't snap" -- "I was in lattice"): a contour piece (or any other drawn
            // piece) under the press used to be ignored here -- no grab, no move. It now goes through the SAME
            // select-and-drag Shape Lattice's Select already hands it to (selectHandler: select, translate with
            // its ends snapping onto other geometry, one undo step on release).
            const other = editor._getNearbyElement(rawPt, tol, { anyVisibleLayer: true });
            if (other) { selectHandler.start(editor, pt, e, other); return; }
            if (!(e && e.shiftKey)) editor._deselect();
            // H6 CONTEXT-MENU: same shape as selectHandler.start's own
            // identical hook above.
            armContextMenuHold(editor, { kind: 'empty', el: null, point: pt }, e);
            if (editor._pointerType === 'touch') _beginAimSelect(editor, e); // aim-select, as in the Select tool
            return;
        }

        editor._deselect();

        if (drawKind === 'node') {
            // SE7k: Node mode places immediately — "no drag needed" — the
            // same click-to-dot shape circleHandler.finish already uses
            // for a near-zero-radius Circle drag, just triggered at
            // start() instead of a radius check, since there's no preview
            // to distinguish click-from-drag here at all. emitNode itself
            // no-ops (returns null) if a node already sits at this exact
            // lattice cell (findNodeAt) — "click on an existing node does
            // nothing" for free; a click close enough to COUNT as a grab
            // (getNearbyElement's own tolerance) was already handled above
            // as a move instead, never reaching this branch.
            editor._latticeStart = null;
            editor._latticeEnd = null;
            editor._isDrawing = false;
            const point = fromLattice(toLattice(pt, spacing), spacing);
            const created = _emitStyled(editor, 'node', point, point);
            if (!created) return;
            applyLayerState(editor);
            commitEdit(editor); // audit batch 3: the one commit
            return;
        }

        editor._latticeStart = toLattice(pt, spacing);
        editor._latticeEnd = editor._latticeStart;
        // SE7k AMEND 1: the RAW (unrounded) point, tracked alongside the
        // lattice-snapped one — click-vs-drag (finish(), below) compares
        // real pointer distance against the standard slop, which a
        // lattice-cell-quantized comparison alone would get wrong at low
        // zoom (one cell can span many screen pixels there).
        editor._latticeRawStart = pt;
        editor._latticeRawLast = pt;
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
        if (editor._latticeMove) { _updateLatticeMove(editor, pt); return; }
        if (!editor._latticePreview) return;
        editor._latticeRawLast = pt; // SE7k AMEND 1: click-vs-drag, see start()'s own comment
        const spacing = editor._latticeSpacing;
        // SE7h: the hand tool conjugates through the SAME orient() the
        // generator uses (editor-lattice.js) — transpose into the
        // canonical (horizontal) frame, run constrainToKind/the rail-row
        // snap EXACTLY as written for horizontal, then transpose the
        // result back out. See orient()'s own doc comment.
        const orientation = getLayerPattern(editor)?.orientation ?? PATTERN_DEFAULTS.orientation;
        const drawKind = editor._lattice.drawKind || 'rail'; // never 'node' here — node completes in start()
        const a = editor._latticeStart;
        const bLat = toLattice(pt, spacing);
        const aCanon = orient(a, orientation);
        const bCanon = orient(bLat, orientation);
        let constrainedCanon = constrainToKind(aCanon, bCanon, drawKind);
        // T30: a tie drag's END snaps to the nearest rail ROW within
        // railSnapRows. SE7k: gated on the EXPLICIT drawKind now, not a
        // direction-guessed shape — a Tie drag always gets row-snapping,
        // a Rail drag never does, regardless of which way the mouse
        // actually moved. finish() below just reads back whatever
        // _latticeEnd ends up here — no separate snap step needed there.
        // SE7h: "row" here means canonical-frame row — in vertical
        // orientation that's a REAL column, per _existingRailRows' own
        // doc comment. T30 AMEND (Fred): ONE setting for both surfaces —
        // reads the Pattern panel's own railSnapRows field (SE7i: the
        // ACTIVE layer's own pattern, via getLayerPattern — persisted per
        // layer now, not once per file) rather than a second, hand-tool-
        // only default; a layer with no `.pattern` yet (never Generated
        // on) falls back to PATTERN_DEFAULTS, same "missing = defaults"
        // convention as every other read of a possibly-absent pattern
        // field.
        if (drawKind === 'tie') {
            const railSnapRows = getLayerPattern(editor)?.ties?.railSnapRows ?? PATTERN_DEFAULTS.ties.railSnapRows;
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
        if (editor._latticeMove) return _finishLatticeMove(editor); // T81 item 7: may be a promise (async boundary limit)
        editor._isDrawing = false;
        if (editor._latticePreview) { editor._latticePreview.remove(); editor._latticePreview = null; }
        const a = editor._latticeStart;
        const b = editor._latticeEnd || a;
        const rawStart = editor._latticeRawStart;
        const rawLast = editor._latticeRawLast || rawStart;
        editor._latticeStart = null;
        editor._latticeEnd = null;
        editor._latticeRawStart = null;
        editor._latticeRawLast = null;
        if (!a) return;
        const orientation = getLayerPattern(editor)?.orientation ?? PATTERN_DEFAULTS.orientation;
        const spacing = editor._latticeSpacing;
        const kind = editor._lattice.drawKind === 'tie' ? 'tie' : 'rail'; // SE7k: explicit choice, never guessed — 'node' can't get here (start() returns before setting a preview)

        // SE7k AMEND 1 (Fred: "spawn or drag, what's best?" — advisor
        // ruling: BOTH, standard click-vs-drag): a CLICK (raw pointer
        // moved no more than the standard slop — same tolerance/base px
        // getNearbyElement's own hit-test above uses) SPAWNS this kind's
        // declared default (LATTICE_DRAW_KINDS' clickSpawn) instead of
        // drawing the exact dragged segment. Compared on the RAW points,
        // not the lattice-snapped a/b — at low zoom one lattice cell can
        // span many screen pixels, so a same-cell check alone would wrongly
        // call a real, deliberate short drag a "click".
        // Audit (batch 1): the tap-vs-drag rule (pastClickThreshold), not the hit slop -- at phone zoom the 22 px
        // touch slop spans a whole cell or more, so a short deliberate rail/tie drag spawned a full default piece.
        const isClick = !pastClickThreshold(editor, rawStart, rawLast);

        let aCanon, bCanon;
        if (isClick) {
            const clickCanon = orient(a, orientation);
            const spawned = kind === 'rail'
                ? _spawnRailFullRow(editor, clickCanon, orientation)
                : _spawnTieBetweenRails(editor, clickCanon, orientation, spacing);
            aCanon = spawned.a; bCanon = spawned.b;
        } else {
            aCanon = orient(a, orientation);
            bCanon = orient(b, orientation);
            if (aCanon.i === bCanon.i && aCanon.j === bCanon.j) return; // defensive: a drag past the slop that still lands back on the SAME cell (e.g. a fast flick) draws nothing, matching the old "bare click does nothing" floor
        }

        // T80 item 2: in a boundary-mode pattern (Shape Lattice) a hand rail
        // is clipped to the shape exactly as a generated rail on that row is
        // (clipHandRailToBoundary) -- 0, 1 or several inside pieces. The
        // boundary resolve is async, so this branch returns its promise.
        const pattern = getLayerPattern(editor);
        if (kind === 'rail' && pattern?.extent?.mode === 'boundary') {
            const j = aCanon.j;
            return clipHandRailToBoundary(editor, pattern, j, aCanon.i, bCanon.i, spacing).then((pieces) => {
                _emitHandPieces(editor, kind, pieces.map((p) => ({ a: { i: p.a, j }, b: { i: p.b, j } })), orientation, spacing);
            });
        }
        _emitHandPieces(editor, kind, [{ a: aCanon, b: bCanon }], orientation, spacing);
    },
    // SE7i (Section 3: "Hover feedback: the piece under the pointer
    // highlights in Lattice mode, so grab vs draw is visible"): reuses
    // the same _setHover highlight mechanism select/node mode already
    // use — a lattice piece under the pointer gets the highlight; a
    // non-lattice shape (or empty space, where a drag would draw) gets
    // none, matching "drag ON an existing piece" being the only case
    // this tool treats specially.
    hover(editor, pt, raw = pt) {
        // Audit (batch 1): the SAME picker and point the press uses (start: _getNearbyLatticePiece at the raw
        // point, any visible layer) -- the hover used the generic active-layer picker at the grid-snapped point,
        // so it could light one piece while the press grabbed another.
        pt = raw;
        const tol = getDynamicTolerance(editor, 10, 'slopPx');
        // the Select sub-mode picks like the Select tool (and aim-select) -- contour / drawn pieces too
        const hit = editor._lattice.drawKind === 'select' ? _pickSelectable(editor, pt) : _getNearbyLatticePiece(editor, pt, tol);
        editor._setHover(hit || null);
        // T81 item 7: a rail END under the pointer shows its end handle +
        // the shared handle cursor, left-right or up-down by the rail's own
        // direction (a press there stretches, SE7k).
        // Only clears a cursor it set itself (another handle system -- the
        // Frame tab's -- may own it otherwise).
        const railEnd = _railEndUnder(editor, pt);
        const hadRailEnd = !!editor._railEndHover;
        setRailEndHover(editor, railEnd);
        if (railEnd || hadRailEnd) setHandleCursor(railEnd ? 'hover' : null, railEndAxis(railEnd));
    },
};

/** T81 item 7: which rail END (`{el, end}`) a press at `pt` would STRETCH,
 *  or null -- the SAME decision `_beginLatticeMove` makes, read-only (no
 *  transform bake): the piece `_getNearbyLatticePiece` picks, then either a
 *  rail within its end-grab zone (handlePx) of one of its own ends, or a
 *  node sitting exactly on a rail's end that isn't on a tie (a node on a
 *  tie's column span resolves to that TIE first, tie priority). */
function _railEndUnder(editor, pt) {
    if (!editor._grid) return null;
    const spacing = editor._grid.spacing || 0.25;
    const hit = _getNearbyLatticePiece(editor, pt, getDynamicTolerance(editor, 10, 'slopPx'));
    const kind = hit ? hit.node.getAttribute(LATTICE_ATTR) : null;
    if (kind !== 'rail' && kind !== 'node') return null;
    const orientation = getLayerPattern(editor)?.orientation ?? PATTERN_DEFAULTS.orientation;
    const canon = (w) => orient(toLatticeFractional(w, spacing), orientation);
    const ends = (el) => ({
        a: worldPoint(el, { x: parseFloat(el.attr('x1')), y: parseFloat(el.attr('y1')) }),
        b: worldPoint(el, { x: parseFloat(el.attr('x2')), y: parseFloat(el.attr('y2')) }),
    });
    if (kind === 'rail') {
        const { a, b } = ends(hit);
        const end = nearestEndWithin({ a: canon(a), b: canon(b) }, canon(pt), getDynamicTolerance(editor, 8, 'handlePx') / spacing);
        return end ? { el: hit, end } : null;
    }
    const w = worldPoint(hit, { x: parseFloat(hit.attr('cx')), y: parseFloat(hit.attr('cy')) });
    const nc = canon(w);
    const cands = _collectLatticeElements(editor, spacing, null);
    for (const c of cands) {
        if (c.kind !== 'tie') continue;
        const ta = canon(c.aWorld), tb = canon(c.bWorld);
        if (Math.abs(ta.i - nc.i) > 1e-6) continue;
        if (nc.j >= Math.min(ta.j, tb.j) - 1e-6 && nc.j <= Math.max(ta.j, tb.j) + 1e-6) return null;
    }
    for (const c of cands) {
        if (c.kind !== 'rail') continue;
        if (_sameWorldPoint(w, c.aWorld)) return { el: c.el, end: 'a' };
        if (_sameWorldPoint(w, c.bWorld)) return { el: c.el, end: 'b' };
    }
    return null;
}

/** UI4 item 0 / UI5 item 0 (Fred, live: a Select tap on the topmost/
 *  bottommost rail of a Shape Lattice silhouette hit the CONTOUR instead
 *  — fixed below by scoping to rail/tie/node only; then the advisor's own
 *  fresh-profile repro found a SECOND, distinct ambiguity this same
 *  function's first version re-introduced: a NODE sitting anywhere near
 *  a RAIL's own body (a crossing node, "at crossings"/"at tie ends" are
 *  both on) could win a bbox-CENTER distance comparison against the rail
 *  even when the click is genuinely on the rail's body far from that
 *  node — a tiny node's bbox center IS the click point (~0 distance)
 *  while a long rail's bbox center is at its OWN 50% mark, however far
 *  that is from wherever along its length was actually clicked. Confirmed
 *  live via a temporary diagnostic: ~50% of trials selected kind:'node'
 *  when the intent (and the screen point) was clearly the rail's body.
 *  Distance-to-ACTUAL-GEOMETRY (a point for a node, the true line segment
 *  for a rail/tie via _distToSegment above) has no such bias — replaces
 *  the bbox-center distance entirely, not just for the contour case.
 *  Rather than touch the shared, heavily-used editor._getNearbyElement
 *  (editor-hit.js, used by every mode's own hit-testing; a distance
 *  algorithm change there risks other pickers), this stays a small,
 *  self-contained search scoped to ONLY rail/tie/node elements — a
 *  contour segment can never match it at all. Not exported, this file's
 *  own use only (shapeLatticeHandler.start, below). */
function _getNearbyLatticePiece(editor, pt, tol) {
    return _nearbyLatticePiece(editor, pt, tol).el;
}

/** `_getNearbyLatticePiece` with its distance: `{ el, dist, edge }` -- `dist` to the
 *  piece's centreline (or node centre), `edge` to its visible edge (dist minus half its
 *  stroke, floored at 0). `el` null when nothing is in reach. */
function _nearbyLatticePiece(editor, pt, tol) {
    if (!editor._sketchLayer) return { el: null, dist: Infinity, edge: Infinity };
    let bestEl = null;
    let bestDist = Infinity;
    let bestRank = Infinity;
    let bestSw = 0;
    editor._sketchLayer.children().toArray().forEach((el) => {
        const kind = el.node.getAttribute(LATTICE_ATTR);
        if (kind !== 'rail' && kind !== 'tie' && kind !== 'node') return;
        // Audit (batch 1): a piece on a hidden layer is never picked (every other picker already filtered it --
        // getNearbyElement, the scissors/stripe _lineUnder, geometrySnapTargets)
        if (!isOnVisibleLayer(editor, el)) return;
        const sw = parseFloat(el.attr('stroke-width')) || editor._strokeWidth || 0.01;
        const buffer = tol + (sw / 2);
        let d, rank;
        if (kind === 'node') {
            const c = worldPoint(el, { x: parseFloat(el.attr('cx')), y: parseFloat(el.attr('cy')) });
            d = Math.hypot(pt.x - c.x, pt.y - c.y);
            // workflow audit (Fred: "longpress node"): a node sits ON its rail, so the two tie near its centre --
            // the node wins only when the finger is on its drawn dot; anywhere else the nearer line does
            const r = parseFloat(el.attr('r')) || 0;
            rank = d <= r ? -1 : d;
        } else {
            const a = worldPoint(el, { x: parseFloat(el.attr('x1')), y: parseFloat(el.attr('y1')) });
            const b = worldPoint(el, { x: parseFloat(el.attr('x2')), y: parseFloat(el.attr('y2')) });
            d = _distToSegment(pt, a, b);
            rank = d;
        }
        if (d <= buffer && rank < bestRank) { bestRank = rank; bestDist = d; bestEl = el; bestSw = sw; }
    });
    return { el: bestEl, dist: bestDist, edge: bestEl ? Math.max(0, bestDist - bestSw / 2) : Infinity };
}

/**
 * T59 (SE14's own deferred "Slice 3 editing model") — the Shape Lattice
 * tool's own canvas gestures: drag an axis-locked param handle, or tap a
 * silhouette segment to open its style bar. Same `_isDrawing` + handler-
 * object shape `latticeHandler` already established (not the
 * `_isDragging` family select/node/transform use, which is hard-coded
 * into `handleMove`/`handleEnd` and would need editing those shared
 * functions instead) — `start` decides which of the three gestures this
 * pointer-down is; ONLY the handle-drag case sets `_isDrawing`, so
 * `update`/`finish` below are NEVER called for the other two (a segment
 * tap is a one-shot action with no drag state at all; a fallback to
 * `selectHandler.start` sets `_isDragging` itself, which `handleMove`/
 * `handleEnd` dispatch on BEFORE ever reaching this handler again this
 * gesture — confirmed by reading those two functions, not assumed).
 *
 * `pt` (handed in by handleStart/handleMove) already carries whatever
 * touch-marker offset applies (`applyTouchMarkerOffset`, editor-grid.js)
 * — used AS GIVEN here, not bypassed: `updateSnapCursor` (handleMove's
 * own unconditional first step) draws that SAME offset marker ring
 * regardless of tool, so a param handle tracks the ring the user
 * actually sees, matching every OTHER touch-draggable thing in this
 * editor (node-drag, lattice rail/tie drag) rather than special-casing
 * this ONE tool to read the raw pointer position underneath the ring.
 * `SNAP_POLICY.shapeLattice: 'none'` (editor-grid.js) already keeps grid-
 * snap out of the way; the marker offset is a SEPARATE, deliberately-kept
 * convention.
 */
const shapeLatticeHandler = {
    start(editor, pt, e) {
        // T59: use the RAW pointer position (bypassing applyTouchMarkerOffset,
        // editor-grid.js), NOT the `pt` handed in — measured live, not just
        // reasoned about: a handle's own hit radius (~25 screen px, matching
        // INPUT_PROFILE's touch handlePx*1.8) is SMALLER than touch's own
        // 40px marker offset, so a finger placed exactly on the visible
        // handle circle would, with the offset applied, always land OUTSIDE
        // the hit radius — confirmed with a live CDP touch-drag before
        // landing on this fix (an earlier version of this comment argued the
        // offset should stay, reasoning "consistent with every other touch
        // gesture" — that reasoning didn't survive contact with a real
        // touch event; a small PRECISION target isn't the same case as a
        // drawing gesture, and this session's own house rule is to re-
        // measure rather than re-derive the same wrong conclusion twice).
        const rawPt = editor._getMousePoint(e);
        // T80 item 2: update()/finish() below route to latticeHandler while a
        // rail/tie draw is in progress (_latticeStart set) -- a cancelled draw
        // (_cancelDrawing never clears it) must not leak into this press.
        editor._latticeStart = null;
        editor._shapeArcPress = null; // F27 item 2 arc pull: a stale press (a hold that opened the menu) never leaks
        // Fred: "I still can't select contour segment" -- each arc's radius dot sits at the
        // middle of its arc, exactly where a tap lands, and grabbing it at once swallowed
        // the tap. The dot keeps its handle priority (it wins over a rail ending under it,
        // e.g. at the waist pinch) but presses like its arc: a TAP selects the segment
        // (+ style bar), a DRAG past the click threshold pulls the radius.
        const dot = hitTestHandle((editor._paramHandles || []).filter((r) => r.axis === 'arc'), rawPt);
        const hit = dot ? null : hitTestHandle((editor._paramHandles || []).filter((r) => r.axis !== 'arc'), rawPt);
        if (dot) {
            _pressContourSegment(editor, dot.segment, { handle: dot, side: 0, segment: dot.segment }, rawPt, pt, e);
            return;
        }
        if (hit) {
            editor._isDrawing = true;
            editor._shapeLatticeDragKey = hit.key;
            // F27 item 2 arc pull: a radius dot is its arc's right side; the grab value anchors a parked square.
            editor._shapeLatticeDragCtx = { side: 0, grab: { value: hit.value } };
            // T81 item 1: the SAME visual a hover shows, held for the whole
            // drag (Touch has no hover at all, so this is its only cue).
            setHandleCursor('active', paramHandleCursorAxis(hit));
            if (typeof editor._updateHandles === 'function') editor._updateHandles();
            // `update(editor, pt)` below only ever gets the OFFSET point
            // (handleMove's own signature has no `e`) — capture the
            // offset's own constant delta here, once, and re-add it on
            // every subsequent move (applyTouchMarkerOffset is a pure,
            // fixed vertical shift, editor-grid.js:203-206 — no other
            // state it could depend on mid-drag).
            editor._shapeLatticeDragOffsetY = rawPt.y - pt.y;
            return;
        }
        // UI4 item 0 (Fred, live: a Select-mode tap/drag on a rail/tie/
        // node opened the segment style bar instead of selecting the
        // piece): hitTestSegment below is a "nearest contour edge within
        // tolerance" check, not an exact hit-test — a rail/tie/node lying
        // anywhere near the contour (common: rails span corner-to-corner,
        // so their own body can sit within slopPx of the silhouette edge)
        // could win it before an existing lattice piece was ever checked.
        // A piece under the cursor is a more specific target than "close
        // to some edge" and must take priority — same order
        // latticeHandler.start already uses for the box Lattice tool.
        // _getNearbyLatticePiece (this file, above), not the generic
        // editor._getNearbyElement — a rail/tie touching the silhouette's
        // own edge can have IDENTICAL endpoints to that edge's own
        // contour segment (confirmed live), which the generic hit-test's
        // bbox-center tie-break resolves in the CONTOUR's favor.
        const latticeTol = getDynamicTolerance(editor, 10, 'slopPx');
        const latticePick = _latticePickPt(editor, pt, e);
        const near = _nearbyLatticePiece(editor, latticePick, latticeTol);
        // Fred: "I still can't select contour segment" -- rails end ON the contour, so a
        // finger's wide reach found a rail on most contour taps and the rail always won.
        // Now the CLOSER one wins, measured to each one's visible edge (a tap inside the
        // contour's own stroke picks the contour even with a rail end touching it); on a
        // tie, the nearer centreline. The UI4 item 0 rule still holds where it matters: a
        // tap on a rail/tie/node itself is closer to it than to any contour edge.
        // T81 item 6 re-reported: `_boundaryNear`, not `_contourSegmentNear` directly -- this tool
        // ALSO supports a HAND-PICKED boundary ("Pick shape…"), which has no `shape.segments` for the
        // analytic path and left `seg` permanently null (rail always won) for that case.
        const seg = near.el ? _boundaryNear(editor, latticePick) : null;
        const contourWins = _contourWinsPick(seg, near);
        const latticeHit = contourWins ? null : near.el;
        if (latticeHit) {
            // UI5 AMEND 2 (advisor, live: the earlier fix moved the piece
            // but with the GENERIC Select move — no grid snap, ties left
            // behind a moved rail, a tie dragged off its own rails, an
            // end-drag translating the whole tie instead of stretching):
            // "the SAME constrained lattice-move path as the box Lattice
            // (one code path)" — this is EXACTLY latticeHandler.start's
            // own existing-piece branch (below), replicated here rather
            // than falling back to selectHandler's plain translate. Tap
            // (no movement) still selects via the same editor._select/
            // _selectAdd the box tool's own Select sub-mode uses;
            // update()/finish() below dispatch into the SAME
            // _updateLatticeMove/_finishLatticeMove machinery whenever
            // editor._latticeMove is active, regardless of which tool's
            // own mode is current — see their own new top line each.
            const shift = !!(e && e.shiftKey);
            // H5 MULTI-SELECT: same shape as selectHandler.start's own
            // identical branch above (a lattice piece is never text, so no
            // type check needed here).
            if (shift) {
                editor._selectAdd(latticeHit);
            } else if (armMultiSelectPress(editor, latticeHit, e)) {
                // second half of a double-tap: leave selection as tap 1 left it.
            } else {
                if (!(editor._selectedElements || []).includes(latticeHit)) editor._select(latticeHit);
                // H6 CONTEXT-MENU: same shape as selectHandler.start's own
                // identical branch above.
                armContextMenuHold(editor, { kind: targetKindOf(latticeHit), el: latticeHit, point: pt }, e);
            }
            editor._isDrawing = true;
            const spacing = editor._grid.spacing || 0.25;
            const orientation = getLayerPattern(editor)?.orientation ?? PATTERN_DEFAULTS.orientation;
            const hitKind = latticeHit.node.getAttribute(LATTICE_ATTR);
            // pt (this function's own 2nd param), not rawPt -- _beginLatticeMove
            // is designed against the touch-offset-adjusted point, matching
            // latticeHandler.start's own identical call exactly.
            editor._latticeMove = withChain(editor, _beginLatticeMove(editor, latticeHit, hitKind, pt, spacing, orientation, latticePick));
            armRailEndStretch(editor, editor._latticeMove); // T81 item 7
            return;
        }
        // T80 item 2 (Fred: "where are add geometry tools"): with Rail/Tie/
        // Node picked in the icon row, empty space draws through the box
        // Lattice tool's own handler -- one add path, not a second (a rail
        // is clipped to the shape in its finish(), see _emitHandPieces).
        // Ahead of the segment tap: an add mode means "add here".
        if (LATTICE_DRAW_KINDS.some((k) => k.value === editor._lattice.drawKind)) {
            latticeHandler.start(editor, pt, e);
            return;
        }
        {
            // F27 item 2 arc pull (Fred: "more intuitive to pull the arc than the arc
            // center"): a radius param's arc is its handle, so a press on one is a
            // TAP or a DRAG, decided by the click threshold (update() below): the
            // tap is exactly today's segment tap (select + style bar, T81 item 6,
            // run right here at the press as always); a drag past the threshold
            // reshapes the radius instead. `grip` counts only where the tap picks
            // that same arc (_arcGripUnder), and widens the tap to the grip's own
            // (handle) tolerance so the hover highlight never promises a grab the
            // press would miss.
            const grip = _arcGripUnder(editor, rawPt);
            const found = _contourSegmentAt(editor, rawPt);
            const segIndex = found != null ? found : (grip ? grip.segment : null);
            if (segIndex != null) {
                _pressContourSegment(editor, segIndex, grip, rawPt, pt, e);
                return;
            }
        }
        // Neither a handle nor a segment — same fallback behavior this
        // tool had before T59 (getModeHandler's own `|| selectHandler`,
        // now bypassed since this entry exists): pick/move/marquee.
        selectHandler.start(editor, pt, e);
    },
    /** Per-frame LIVE update — writes ONE param, re-derives the
     *  silhouette SYNCHRONOUSLY (`regenerateSilhouette`, no
     *  `generatePattern` call), and re-renders the handles from the
     *  freshly-written params so the dragged handle's own on-screen
     *  position stays exactly on its declared axis (`computeParamHandles`
     *  recomputes every anchor from the CURRENT resolved params on every
     *  call — there's no separate "handle position" state to drift from
     *  the data). Never calls `generatePattern` per frame (T59's own
     *  dispatch: "regenerates the path + refills ON RELEASE"). */
    update(editor, pt) {
        // UI5 AMEND 2: a lattice-piece move/stretch started above dispatches
        // through the SAME _updateLatticeMove the box Lattice tool's own
        // latticeHandler.update uses — same check, same order, so both
        // tools' Select-mode piece drags share ONE constrained-move
        // implementation rather than diverging.
        if (editor._latticeMove) { _updateLatticeMove(editor, pt); return; }
        if (editor._latticeStart) { latticeHandler.update(editor, pt); return; } // T80 item 2: a rail/tie being drawn
        if (editor._shapeArcPress && !_beginArcDrag(editor, pt)) return; // F27 item 2 arc pull: still a tap
        const key = editor._shapeLatticeDragKey;
        if (!key) return;
        const rawPt = { x: pt.x, y: pt.y + (editor._shapeLatticeDragOffsetY || 0) };
        const p = currentPattern(editor);
        const shape = currentShape(p);
        const handle = paramHandleRecords(editor).find((h) => h.key === key);
        if (!handle) return;
        // F27 item 2 arc pull: the drag writes the handle's PATCH -- its own key, or
        // for the hourglass waist (a CAD circle) waistReach and waistRadius together.
        const patch = handle.patchFromWorld(rawPt, editor._shapeLatticeDragCtx || {});
        const value = patch[key];
        // H13: valueFromWorld already clamped -- comparing against the
        // handle's own declared range (editor-shape-lattice-interaction.js)
        // tells us whether THIS drag tick actually hit the bound, without
        // that pure module touching haptic()/navigator/document itself.
        if (handle.range && (value === handle.range.min || value === handle.range.max)) haptic('limit');
        shape.params = { ...shape.params, ...patch };
        regenerateSilhouette(editor, p); // its own end calls editor._updateHandles(), re-rendering from the NEW params
        editor._notifyChange('live');
    },
    /** Release: the ONE full regenerate+refill (`generatePattern`'s own
     *  single `pushState`/`commit` — T59's own fixed double-pushState bug
     *  makes this genuinely ONE undo step now, not two). */
    finish(editor) {
        // UI5 AMEND 2: same dispatch as update() above, for the SAME reason
        // (_finishLatticeMove already sets editor._isDrawing = false itself,
        // matching latticeHandler.finish's own identical one-line dispatch).
        if (editor._latticeMove) return _finishLatticeMove(editor); // T81 item 7: may be a promise
        if (editor._latticeStart) return latticeHandler.finish(editor); // T80 item 2: a rail/tie being drawn
        editor._isDrawing = false;
        if (editor._shapeArcPress) {
            // F27 item 2 arc pull: released before the click threshold -- a TAP, and the
            // tap (segment select + style bar) already ran at the press. Nothing reshaped,
            // no regenerate, no undo step; just drop the pressed highlight.
            editor._shapeArcPress = null;
            if (typeof editor._updateHandles === 'function') editor._updateHandles();
            return;
        }
        editor._shapeLatticeDragKey = null;
        editor._shapeLatticeDragCtx = null;
        editor._shapeLatticeDragOffsetY = 0;
        // T81 item 1: back to hover (the pointer is very likely still on the
        // handle it just released) or idle -- the next hover() call
        // self-corrects if it isn't (no fresh pointer position here to
        // re-test against).
        setHandleCursor(editor._shapeHandleHover ? 'hover' : null, _paramHandleAxis(editor, editor._shapeHandleHover));
        // H23 item 66: was fire-and-forget (no `return`) -- harmless while
        // generatePattern's own async work finished inside the SAME
        // microtask drain a caller's `await finish()` already waited out,
        // but item 66's own second `_resolveBoundaryPrimitives` await
        // (editor-lattice-pattern.js) added one more microtask hop and
        // exposed it live (a flaky-by-construction gap, not a new one):
        // `pushState` landed AFTER an awaiting caller's own next assertion
        // already ran. Returned now, matching this SAME function's own
        // sibling branches just above (`_finishLatticeMove`/
        // `latticeHandler.finish`, both explicitly "may be a promise").
        return regenerateSilhouetteAndFill(editor);
    },
    /** T81 item 1: hover feedback for the param handles -- grows/fills the
     *  hovered one (renderShapeLatticeHandles) and sets the shared grab
     *  cursor. `pt` is already the offset-adjusted point handleMove passes
     *  every mode's own hover() (no raw event here), matching what a real
     *  grab at this same point would hit — SNAP_POLICY.shapeLattice is
     *  'none', so `pt` carries no grid-snap discrepancy against it either. */
    hover(editor, pt, raw = pt) {
        pt = raw; // audit batch 1: hover picks where the press will (start hit-tests the raw point)
        if (editor._shapeArcPress && !editor._isDrawing) editor._shapeArcPress = null; // a hold's menu ended that press
        // F27 item 2 arc pull: the marks first (a square in reach wins), then a radius
        // param's arc, either side -- its only affordance is the highlight of both.
        const hit = hitTestHandle(editor._paramHandles || [], pt) || _arcGripUnder(editor, pt)?.handle || null;
        const key = hit ? hit.key : null;
        if (editor._shapeHandleHover !== key) {
            editor._shapeHandleHover = key;
            if (typeof editor._updateHandles === 'function') editor._updateHandles();
        }
        // T81 item 7: a rail END (never under a param handle -- a press
        // there grabs the handle first, start()'s own priority).
        const railEnd = key ? null : _railEndUnder(editor, pt);
        setRailEndHover(editor, railEnd);
        setHandleCursor(key || railEnd ? 'hover' : null, key ? paramHandleCursorAxis(hit) : railEndAxis(railEnd));
        if (selectHandler.hover) selectHandler.hover(editor, pt, pt);
    },
};

/** T59 tap-a-segment, factored out (F27 item 2 arc pull: the arc grip below
 *  asks it too): the contour segment a tap at `pt` selects -- the nearest one
 *  within slopPx of the generated silhouette -- or null. */
/** A press on contour segment `segIndex` (T81 item 6 tap + F27 item 2 arc pull):
 *  selects it and opens its style bar (the TAP, run at the press as always); when
 *  `grip` (an arc grip or a radius dot on that arc) is given, also arms the press
 *  so a DRAG past the click threshold pulls that radius instead (update()). */
/** The drawn contour piece nearest `pt` (within the hit slop) of the current pattern's contour, or null. */
function _contourPieceAt(editor, pt) {
    const p = currentPattern(editor);
    if (!p || !p.boundary || !p.boundary.shapeId || !pt) return null;
    const tol = getDynamicTolerance(editor, 10, 'slopPx');
    let best = null, bestD = Infinity;
    for (const el of _findBoundaryElements(editor, p.boundary.shapeId)) {
        const prim = primitiveFromContourD(el.attr('d'));
        if (!prim) continue;
        const q = nearestOnContourPrimitive(prim, pt);
        const d = Math.hypot(q.x - pt.x, q.y - pt.y);
        if (d <= tol + (parseFloat(el.attr('stroke-width')) || 0) / 2 && d < bestD) { bestD = d; best = el; }
    }
    return best;
}

function _pressContourSegment(editor, segIndex, grip, rawPt, pt, e) {
    // T81 item 6 (PRIORITY BUG, Fred: "I can't seem to select
    // contour segment"): this branch used to ONLY open the
    // style bar -- never editor._select/_selectAdd, so the
    // segment never reached editor._selectedElements, the
    // Selected-piece panel never showed it, and per-segment
    // colour (which reads that panel's own selection) had no
    // way to reach a segment via a plain tap at all. Same
    // select dance the rail/tie/node branch above already
    // uses (shift adds, a double-tap leaves selection alone,
    // else replace + arm the context-menu hold) -- one
    // declared "tap selects" behavior, not a second for
    // contour. The style bar still opens on the SAME tap
    // (unchanged); this only ADDS the missing selection.
    // Audit (batch 2): the PIECE under the tap (geometry), not the piece whose index happens to equal the tapped
    // topology segment -- after a kink, cut or stripe those index spaces differ, and the wrong piece (e.g. the
    // third stripe of another edge) was selected and recoloured.
    const segEl = _contourPieceAt(editor, rawPt) || _contourSegmentEl(editor, segIndex);
    if (segEl) {
        const shift = !!(e && e.shiftKey);
        if (shift) {
            editor._selectAdd(segEl);
        } else if (armMultiSelectPress(editor, segEl, e)) {
            // second half of a double-tap: leave selection as tap 1 left it.
        } else {
            if (!(editor._selectedElements || []).includes(segEl)) editor._select(segEl);
            armContextMenuHold(editor, { kind: targetKindOf(segEl), el: segEl, point: pt }, e);
        }
    }
    openSegmentStyleBar(editor, segIndex, e.clientX, e.clientY);
    if (grip) {
        editor._isDrawing = true; // so the move/release reach update()/finish() below
        editor._shapeArcPress = {
            key: grip.handle.key, side: grip.side, start: rawPt, offsetY: rawPt.y - pt.y,
            grab: { value: grip.handle.value },
        };
        if (typeof editor._updateHandles === 'function') editor._updateHandles(); // lit while pressed (Touch)
    }
}

/** The nearest contour segment to `pt` with its centreline and visible-edge
 *  distances (`{ index, dist, edge }`, edge = dist minus half the drawn contour
 *  stroke), or null when the shape has no generated segments. */
function _contourSegmentNear(editor, pt) {
    const p = currentPattern(editor);
    const shape = currentShape(p);
    if (!(shape.source === 'generated' && Array.isArray(shape.segments))) return null;
    const { primitives } = generateSilhouette(_shapeContourRegion(editor, p), shape);
    const { index, dist } = nearestSegment(primitives, shape.segments, pt);
    if (index == null) return null;
    const segEl = _contourSegmentEl(editor, index);
    const sw = segEl ? parseFloat(segEl.attr('stroke-width')) || 0 : 0;
    return { index, dist, edge: Math.max(0, dist - sw / 2) };
}

function _contourSegmentAt(editor, pt) {
    const p = currentPattern(editor);
    const shape = currentShape(p);
    if (!(shape.source === 'generated' && Array.isArray(shape.segments))) return null;
    const { primitives } = generateSilhouette(_shapeContourRegion(editor, p), shape);
    return hitTestSegment(primitives, shape.segments, pt, getDynamicTolerance(editor, 10, 'slopPx'));
}

/** T81 item 6 (Fred: "I can't seem to select contour segment"): `_contourSegmentNear`'s own general form
 *  -- for a GENERATED Shape Lattice silhouette it IS `_contourSegmentNear` (unchanged, analytic); for a
 *  HAND-PICKED boundary (Box Lattice, or Shape Lattice's own "Pick shape…" -- no `shape.segments` to
 *  re-derive geometry from) it reads the ACTUAL drawn element(s) via `_findBoundaryElements` +
 *  `primitiveFromContourD`/`nearestOnContourPrimitive`, the SAME machinery `_contourPieceAt` already uses
 *  to resolve a tap into an element (not a new geometry mechanism — reused here only for the DISTANCE a
 *  pick-priority decision needs). `getLayerPattern`, not `currentPattern` (Shape Lattice's own accessor,
 *  with side effects this tool-agnostic check must not trigger for a plain Box Lattice layer that never
 *  touches `.shape` at all). `{ el, dist, edge }`, or null with no boundary pattern at all. */
function _boundaryNear(editor, pt) {
    const p = getLayerPattern(editor);
    if (!p) return null;
    if (p.shape && p.shape.source === 'generated' && Array.isArray(p.shape.segments)) {
        const seg = _contourSegmentNear(editor, pt);
        return seg ? { ...seg, el: _contourSegmentEl(editor, seg.index) } : null;
    }
    if (!p.boundary || !p.boundary.shapeId) return null;
    let best = null;
    for (const el of _findBoundaryElements(editor, p.boundary.shapeId)) {
        const prim = primitiveFromContourD(el.attr('d'));
        if (!prim) continue;
        const q = nearestOnContourPrimitive(prim, pt);
        const dist = Math.hypot(q.x - pt.x, q.y - pt.y);
        if (!best || dist < best.dist) {
            const sw = parseFloat(el.attr('stroke-width')) || 0;
            best = { el, dist, edge: Math.max(0, dist - sw / 2) };
        }
    }
    return best;
}

/** T81 item 6: does the contour/boundary win the pointer over a nearby lattice piece, by visible EDGE
 *  distance (a tie's own centreline distance as the tiebreak -- the SAME pair `_nearbyLatticePiece` and
 *  `_boundaryNear` both return). Declared once, used by latticeHandler.start, shapeLatticeHandler.start
 *  and _pickSelectable (the main Select tool) rather than copied three times. */
function _contourWinsPick(seg, near) {
    return !!(seg && (seg.edge < near.edge || (seg.edge === near.edge && seg.dist < near.dist)));
}

/** F27 item 2 arc pull: the radius param's arc under `pt` -- `{ handle, side,
 *  segment }` (side 1 = the mirrored left arc) within the handles' own hit
 *  tolerance, or null. Only where a tap would pick that SAME segment (or no
 *  segment at all): near a junction with a straight horn the tap's nearest-
 *  segment rule wins, so hover, tap and drag always agree on the target. */
function _arcGripUnder(editor, pt) {
    const grips = (editor._paramHandles || []).filter((r) => r.axis === 'arc');
    if (!grips.length) return null;
    const grip = hitTestArcGrip(grips, pt, grips[0].hitR);
    if (!grip) return null;
    const segment = grip.side === 1 ? grip.handle.mirrorSegment : grip.handle.segment;
    const tapped = _contourSegmentAt(editor, pt);
    return tapped == null || tapped === segment ? { ...grip, segment } : null;
}

/** F27 item 2 arc pull: a pressed arc becomes a radius DRAG once the pointer
 *  passes the click threshold (the same clickThresholdPx every other tap-vs-drag
 *  call reads); true once it has. The tap's style bar goes (the drag is not a
 *  style edit); the tapped segment stays selected, as a dragged thing does. */
function _beginArcDrag(editor, pt) {
    const press = editor._shapeArcPress;
    const rawPt = { x: pt.x, y: pt.y + press.offsetY };
    if (Math.hypot(rawPt.x - press.start.x, rawPt.y - press.start.y) <= getDynamicTolerance(editor, 3, 'clickThresholdPx')) return false;
    document.querySelectorAll('.shape-lattice-segment-bar').forEach((bar) => bar.remove());
    cancelContextMenuHold();
    cancelMultiSelectHold();
    editor._shapeArcPress = null;
    editor._shapeLatticeDragKey = press.key;
    editor._shapeLatticeDragCtx = { side: press.side, grab: press.grab };
    editor._shapeLatticeDragOffsetY = press.offsetY;
    setHandleCursor('active', 'plain'); // Fred: a radius keeps the normal pointer
    return true;
}

/** F27 item 2 follow-up: a Shape Lattice param handle's cursor axis (its drag axis, or 'plain' for a radius). */
function _paramHandleAxis(editor, key) {
    const h = key ? (editor._paramHandles || []).find((r) => r.key === key) : null;
    return paramHandleCursorAxis(h);
}

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
    shapeLattice: shapeLatticeHandler,
    cut:     cutHandler, // SE16 ✂ (editor-cut-tool.js)
    stripe:  stripeHandler, // F27 item 3 (editor-stripe-tool.js)
    brickBrush: brickBrushHandler, // F35 item 1 (editor-brick-tool.js)
    brickAccentClick: brickAccentClickHandler, // F35 item 15: Custom raised accents, click bricks
    brickElementSelect: brickElementSelectHandler, // F35 item 22: Select a Wall / Frame element
    brickWallArea: brickWallAreaHandler, // F35 item 22 slice 2: paint a wall area
};

export function getModeHandler(mode) { return modeHandlers[mode] || selectHandler; }


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

/** Fred: "Moving contour piece won't snap to geometry". A dragged selection used to follow the snapped POINTER,
 *  and the pointer's geometry snap still counted the dragged piece's own points (moving along with it), so the
 *  piece stuck to itself and never reached anything else. Now, CAD-style: the selection's own points (ends,
 *  corners, segment ends, captured at grab) snap onto OTHER geometry (the targets, also captured at grab, leave
 *  the selection out) within the usual tolerance, the nearest pair winning; otherwise the pointer snap applies as
 *  before, minus the selection's own points. Alt bypasses, as everywhere. */
const SEL_MOVE_MAX_ANCHORS = 400;

function _selectionMoveDelta(editor, pt, raw, bypass) {
    const sel = editor._selectedElements || [];
    let ms = editor._selMove;
    if (!ms) {
        const start = { x: editor._lastDragPt.x, y: editor._lastDragPt.y };
        // the anchors' search measures from the UNSNAPPED press (a grid-snapped press point -- Lattice snaps its
        // press to the grid -- would throw the ends up to half a cell off the target they're near)
        const rawStart = editor._pressRaw ? { x: editor._pressRaw.x, y: editor._pressRaw.y } : start;
        ms = editor._selMove = { start, rawStart, applied: { x: 0, y: 0 }, exclude: new Set(sel), anchors: null, targets: null };
    }
    if (!raw) return { x: pt.x - ms.start.x, y: pt.y - ms.start.y };
    const geomOn = !!(editor._grid && editor._grid.geometrySnap) && !bypass;
    if (geomOn) {
        if (!ms.anchors) {
            ms.anchors = [];
            for (const el of sel) {
                let nodes = [];
                try { nodes = editor._getNodes(el) || []; } catch (_) { /* not a node-bearing element */ }
                for (const n of nodes) if (ms.anchors.length < SEL_MOVE_MAX_ANCHORS) ms.anchors.push({ x: n.x, y: n.y });
            }
            ms.targets = geometrySnapTargets(editor, ms.exclude);
        }
        const rx = raw.x - ms.rawStart.x, ry = raw.y - ms.rawStart.y;
        const tol = getDynamicTolerance(editor, GEOMETRY_SNAP_TOL_PX, 'slopPx');
        let best = null, bestD = tol * tol;
        for (const a of ms.anchors) {
            const ax = a.x + rx, ay = a.y + ry;
            for (const t of ms.targets) {
                const d = (t.x - ax) ** 2 + (t.y - ay) ** 2;
                if (d <= bestD) { bestD = d; best = { x: t.x - a.x, y: t.y - a.y }; }
            }
        }
        if (best) return best;
    }
    // Audit (batch 3): no end snapped -> the FINGER's own travel, in whole grid steps when the grid snaps. It used
    // to be snap(pointer now) - snap(pointer at grab): both ends pulled to (different) geometry, so a 0.54 in
    // finger move shifted the piece 1.0 in (MEASURED).
    const d = { x: raw.x - ms.rawStart.x, y: raw.y - ms.rawStart.y };
    const policy = SNAP_POLICY[editor._currentMode] || 'point';
    return (policy !== 'none' && !bypass) || policy === 'always' ? snapToGrid(d, editor._grid, false) : d;
}

function translateSelection(editor, pt, raw = null, bypass = false) {
    const want = _selectionMoveDelta(editor, pt, raw, bypass);
    const ms = editor._selMove;
    const dx = want.x - ms.applied.x;
    const dy = want.y - ms.applied.y;
    ms.applied = want;
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
    commitEdit(editor); // audit batch 3: the one commit
    try { maybeShowExpandCallout(editor); } catch (_) {}
}


// ─── Selection handles ─────────────────────────────────────────────

export function updateHandles(editor) {
    if (!editor._handleLayer) return;
    editor._handleLayer.clear();
    editor._transformHandles = [];
    renderTouchConfirm(editor); // a pending scissors / stripe check + X survives every handle re-render
    // T59: the Shape Lattice tool's own param handles don't depend on
    // `_selectedElements` at all (a generated silhouette needs no
    // selection to be draggable) — branch BEFORE the selection-gated
    // early-returns below, which exist for the select/node transform
    // handles only.
    if (editor._currentMode === 'shapeLattice') {
        editor._paramHandles = renderShapeLatticeHandles(editor);
        renderRailEndHandle(editor); // T81 item 7
        return;
    }
    if (editor._currentMode === 'lattice') { renderRailEndHandle(editor); return; } // T81 item 7 (lattice mode draws no selection handles)
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
                .stroke({ color: SELECTION_COLOR, width: strokeW, dasharray: `${strokeW * 4},${strokeW * 2}` })
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
        const fillStr = isDragging ? '#ff3300' : (isHovered ? SELECTION_COLOR : '#00ffff');
        const strokeW = (isDragging || isHovered) ? baseR * 0.9 : baseR * 0.4;
        const strokeC = isDragging ? '#ffffff' : (isHovered ? '#a06b00' : APP_HANDLE_STROKE);
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
