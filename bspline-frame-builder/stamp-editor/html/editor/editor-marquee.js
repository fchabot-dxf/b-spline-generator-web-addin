/**
 * editor-marquee.js — drag-rectangle multi-select for the SVG editor.
 *
 * Lifecycle (driven by editor-interaction.js):
 *   start  → selectHandler.start records editor._marqueeStart and sets
 *            editor._isDragging = true. No rect is drawn yet.
 *   move   → updateMarquee(editor, pt) draws / updates a dashed
 *            rect in the handle layer between start and pt.
 *   end    → finalizeMarquee(editor) reads the current rect, runs an
 *            AABB intersection test against every sketch-layer child,
 *            and selects all matches (additive if _marqueeAdditive,
 *            else replacing the current selection).
 *
 * AABB-based picking is "Inkscape rubber-band" semantics: any shape
 * whose world bbox even touches the marquee is included. Per-pixel
 * containment / strict containment can be added later behind an
 * editor flag if the user wants Figma-style "only fully enclosed".
 */
import { worldBbox } from './editor-coords.js';

const STROKE_COLOR = '#0066cc';
const FILL_COLOR   = '#0066cc';
const FILL_OPACITY = 0.08;

/** Update (or create) the marquee rectangle as the mouse moves. */
export function updateMarquee(editor, pt) {
    if (!editor._marqueeStart || !editor._handleLayer) return;

    const s = editor._marqueeStart;
    const x = Math.min(s.x, pt.x);
    const y = Math.min(s.y, pt.y);
    const w = Math.abs(pt.x - s.x);
    const h = Math.abs(pt.y - s.y);

    const view = (editor._draw && editor._draw.viewbox) ? editor._draw.viewbox() : null;
    const strokeW = view ? Math.max(view.width, view.height) * 0.002 : 1;

    if (!editor._marqueeRect) {
        editor._marqueeRect = editor._handleLayer.rect(w, h)
            .move(x, y)
            .fill({ color: FILL_COLOR, opacity: FILL_OPACITY })
            .stroke({ color: STROKE_COLOR, width: strokeW, dasharray: `${strokeW * 3},${strokeW * 2}` })
            .attr('pointer-events', 'none');
        return;
    }
    editor._marqueeRect.size(w, h).move(x, y);
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
        if (cls.includes('layer-hidden') || cls.includes('inactive-layer')) continue;
        // Don't pick the marquee rect itself (defensive — it lives in
        // _handleLayer, not _sketchLayer, but cheap to guard).
        if (el === r) continue;
        const bb = worldBbox(el);
        if (!bb || !Number.isFinite(bb.w) || !Number.isFinite(bb.h)) continue;
        if (_aabbIntersect(marquee, bb)) picked.push(el);
    }

    if (!picked.length) {
        // Empty marquee: when additive, keep what was there; otherwise
        // already deselected at start.
        return 0;
    }

    if (editor._marqueeAdditive) {
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
}

function _aabbIntersect(a, b) {
    return !(b.x2 < a.x || b.x > a.x2 || b.y2 < a.y || b.y > a.y2);
}
