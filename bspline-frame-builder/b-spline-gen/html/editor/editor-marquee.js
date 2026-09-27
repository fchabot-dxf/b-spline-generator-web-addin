/**
 * editor-marquee.js — drag-rectangle multi-select for the SVG editor.
 *
 * Lifecycle (driven by editor-interaction.js):
 *   start  → selectHandler.start records editor._marqueeStart and sets
 *            editor._isDragging = true. No rect is drawn yet.
 *   move   → updateMarquee(editor, pt) draws / updates the rect in the
 *            handle layer between start and pt, restyled every move to
 *            match the CURRENT drag direction (see below).
 *   end    → finalizeMarquee(editor) reads the current rect + mode,
 *            picks matching sketch-layer children, and selects them
 *            (additive if _marqueeAdditive, else replacing the
 *            current selection).
 *
 * H20 item 2 (Fred: "box select should have the 2 way select mode,
 * include and exclude"), Fusion/CAD convention: the drag direction (not
 * a separate mode toggle) picks between two selection rules, continuously
 * re-evaluated every move (dragging past the start point flips it back):
 *   WINDOW   (pt.x >= start.x, "left-to-right"): only elements whose
 *            whole world bbox is FULLY inside the box.
 *   CROSSING (pt.x <  start.x, "right-to-left"): every element the box
 *            touches OR encloses — the box's own bbox overlap, sharpened
 *            with an actual outline sample (not just bbox-vs-bbox) so a
 *            piece that's only HALF inside the box is still picked, but
 *            one that merely shares empty bbox space with it isn't.
 */
import { worldBbox } from './editor-coords.js';
import { _sampleElement } from './editor-eraser.js';

// CROSSING keeps the pre-H20 look (the only style that existed before) --
// WINDOW is new, so it gets a visually distinct treatment per the dispatch
// ("solid outline, light fill" vs "dashed outline, different tint").
const CROSSING_STYLE = { color: '#0066cc', fillOpacity: 0.08, dashed: true };
const WINDOW_STYLE   = { color: '#2ea043', fillOpacity: 0.06, dashed: false };

function _styleFor(mode) {
    return mode === 'window' ? WINDOW_STYLE : CROSSING_STYLE;
}

/** Update (or create) the marquee rectangle as the mouse moves. */
export function updateMarquee(editor, pt) {
    if (!editor._marqueeStart || !editor._handleLayer) return;

    const s = editor._marqueeStart;
    const x = Math.min(s.x, pt.x);
    const y = Math.min(s.y, pt.y);
    const w = Math.abs(pt.x - s.x);
    const h = Math.abs(pt.y - s.y);

    // Re-evaluated every move (not locked from the first movement) --
    // dragging back past the start point flips WINDOW <-> CROSSING.
    const mode = pt.x >= s.x ? 'window' : 'crossing';
    editor._marqueeMode = mode;
    const style = _styleFor(mode);

    const view = (editor._draw && editor._draw.viewbox) ? editor._draw.viewbox() : null;
    const strokeW = view ? Math.max(view.width, view.height) * 0.002 : 1;
    const dasharray = style.dashed ? `${strokeW * 3},${strokeW * 2}` : null;

    if (!editor._marqueeRect) {
        editor._marqueeRect = editor._handleLayer.rect(w, h)
            .move(x, y)
            .fill({ color: style.color, opacity: style.fillOpacity })
            .stroke({ color: style.color, width: strokeW, dasharray })
            .attr('pointer-events', 'none');
        return;
    }
    editor._marqueeRect.size(w, h).move(x, y)
        .fill({ color: style.color, opacity: style.fillOpacity })
        .stroke({ color: style.color, width: strokeW, dasharray });
}

/**
 * End the marquee gesture: pick all sketch-layer elements whose
 * world bbox intersects the marquee, apply the new selection, then
 * clear the rect + per-drag state. Returns the number of elements
 * picked (0 if the rect was a degenerate click).
 */
export function finalizeMarquee(editor) {
    const s = editor._marqueeStart;
    const r = editor._marqueeRect;
    // SE8f: captured BEFORE clearMarquee (below), which resets
    // _marqueeAdditive to false — reading editor._marqueeAdditive AFTER
    // that call (as this function used to, further down) meant the
    // additive branch could never run: a shift-drag marquee silently
    // REPLACED the selection instead of merging into it, discovered once
    // _selectMany actually started running (previously the additive
    // branch threw before this ordering bug could even show itself).
    const additive = editor._marqueeAdditive;
    // H20 item 2: same "read before clearMarquee resets it" rule as
    // `additive` above -- _marqueeMode would otherwise already be gone.
    const mode = editor._marqueeMode || 'window';
    clearMarquee(editor);
    if (!s) return 0;

    if (!r) {
        // No movement after mousedown → plain empty-canvas click. The
        // deselect already happened at start (when shift wasn't held);
        // nothing more to do.
        return 0;
    }

    // Read the rect's final geometry — it's in model space.
    const x = +r.attr('x') || 0;
    const y = +r.attr('y') || 0;
    const w = +r.attr('width')  || 0;
    const h = +r.attr('height') || 0;
    if (w <= 0 || h <= 0) return 0;
    const marquee = { x, y, x2: x + w, y2: y + h };

    const sketchChildren = editor._sketchLayer
        ? editor._sketchLayer.children().toArray()
        : [];

    const picked = [];
    for (const el of sketchChildren) {
        // Ignore hidden / transient helpers (anchor preview, etc.).
        if (!el || !el.node || !el.node.parentNode) continue;
        const cls = el.node.getAttribute('class') || '';
        // SE7h add-on (Fred: generated Rails/Ties/Nodes were unclickable):
        // a marquee in 'select' mode picks from any VISIBLE layer, not
        // just the active one — 'inactive-layer' (dimmed, non-active)
        // pieces are now includable; 'layer-hidden' (the eye off) still
        // excludes, same as clicking never selects a hidden layer either.
        if (cls.includes('layer-hidden')) continue;
        // Don't pick the marquee rect itself (defensive — it lives in
        // _handleLayer, not _sketchLayer, but cheap to guard).
        if (el === r) continue;
        const bb = worldBbox(el);
        if (!bb || !Number.isFinite(bb.w) || !Number.isFinite(bb.h)) continue;
        if (!_aabbIntersect(marquee, bb)) continue;

        if (mode === 'window') {
            // WINDOW: only elements FULLY inside the box.
            if (_aabbContains(marquee, bb)) picked.push(el);
        } else {
            // CROSSING: bbox overlap already confirmed above -- that alone
            // is enough when the box also fully encloses the bbox, or when
            // the element can't be sampled (e.g. <text>, no getTotalLength:
            // bbox overlap is the best available signal for it). Otherwise
            // sharpen with an actual outline sample so a piece that merely
            // shares empty bbox corner-space with the box (but whose real
            // geometry never enters it) isn't picked just because AABBs
            // touch.
            if (_aabbContains(marquee, bb)) { picked.push(el); continue; }
            const pts = _sampleElement(el);
            if (!pts) { picked.push(el); continue; }
            const touches = pts.some((p) => p.x >= marquee.x && p.x <= marquee.x2 && p.y >= marquee.y && p.y <= marquee.y2);
            if (touches) picked.push(el);
        }
    }

    if (!picked.length) {
        // Empty marquee: when additive, keep what was there; otherwise
        // already deselected at start.
        return 0;
    }

    if (additive) {
        // Merge with the existing selection. Order: existing first,
        // newcomers appended so the last picked element becomes the
        // primary (consistent with shift-click semantics).
        const merged = (editor._selectedElements || []).slice();
        for (const el of picked) {
            if (!merged.includes(el)) merged.push(el);
        }
        editor._selectMany(merged);
    } else {
        editor._selectMany(picked);
    }

    return picked.length;
}

/** Tear down the marquee rect + per-drag flags. Safe to call any time. */
export function clearMarquee(editor) {
    if (editor._marqueeRect) {
        try { editor._marqueeRect.remove(); } catch (_) {}
    }
    editor._marqueeRect     = null;
    editor._marqueeStart    = null;
    editor._marqueeAdditive = false;
    editor._marqueeMode     = null;
}

function _aabbIntersect(a, b) {
    return !(b.x2 < a.x || b.x > a.x2 || b.y2 < a.y || b.y > a.y2);
}

/** True if bbox `bb` is FULLY inside box `a` (WINDOW-mode containment). */
function _aabbContains(a, bb) {
    return bb.x >= a.x && bb.x2 <= a.x2 && bb.y >= a.y && bb.y2 <= a.y2;
}
