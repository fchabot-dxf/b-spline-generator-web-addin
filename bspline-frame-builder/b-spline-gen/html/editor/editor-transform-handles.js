/**
 * editor-transform-handles.js — Figma-style on-canvas transform handles
 * (8 scale + 1 rotate) for the SVG editor's select mode, plus helpers
 * to reset or flatten (= bake into geometry) the resulting transform.
 *
 * The handles live in editor._handleLayer next to the dashed bbox.
 * Their geometry is rendered with pointer-events: none — hit-testing
 * is done manually by editor-interaction so we don't fight SVG.js's
 * own DOM listeners or the existing element pick path.
 *
 * Pivot rules (per user choice):
 *   - Scale handles  → anchor = opposite corner / opposite side of the
 *                      bbox. Dragging NE keeps SW pinned, etc.
 *   - Rotate handle  → pivot = bbox center (always).
 *
 * Transform composition: at drag start we capture the element's
 * current matrix (m0) and on every move set
 *     transform = delta × m0
 * via the SVG `transform` attribute. Geometry (d, points, x/y) is
 * never touched — the transform stays re-editable. Call
 * flattenTransform() to bake it into geometry when you need a clean
 * d (e.g. before export / rasterize); call resetTransform() to throw
 * the transform away.
 */
import { worldBbox } from './editor-coords.js';

// ── Handle layout: corner + side scale handles. hx/hy give the handle
// position as a (0..1) fraction of the bbox; ax/ay give the anchor
// (opposite corner/side). sx/sy say which axes that handle controls.
const SCALE_HANDLES = [
    { id: 'nw', hx: 0,   hy: 0,   ax: 1,   ay: 1,   sx: true,  sy: true  },
    { id: 'n',  hx: 0.5, hy: 0,   ax: 0.5, ay: 1,   sx: false, sy: true  },
    { id: 'ne', hx: 1,   hy: 0,   ax: 0,   ay: 1,   sx: true,  sy: true  },
    { id: 'e',  hx: 1,   hy: 0.5, ax: 0,   ay: 0.5, sx: true,  sy: false },
    { id: 'se', hx: 1,   hy: 1,   ax: 0,   ay: 0,   sx: true,  sy: true  },
    { id: 's',  hx: 0.5, hy: 1,   ax: 0.5, ay: 0,   sx: false, sy: true  },
    { id: 'sw', hx: 0,   hy: 1,   ax: 1,   ay: 0,   sx: true,  sy: true  },
    { id: 'w',  hx: 0,   hy: 0.5, ax: 1,   ay: 0.5, sx: true,  sy: false },
];

/**
 * Render the 8 scale handles + the rotate handle around the current
 * selection. Returns the records array so editor-interaction can
 * hit-test against them. Returns [] if there's nothing to draw.
 *
 * Multi-selection: the bbox is the union of all selected elements'
 * world bboxes. Dragging a handle then applies the SAME delta matrix
 * to every selected element (composed onto each element's start-of-
 * drag matrix), so the group scales / rotates as a unit.
 */
export function renderTransformHandles(editor) {
    if (!editor._handleLayer) return [];
    const sel = editor._selectedElements || [];
    if (!sel.length) return [];

    const bb = _combinedBbox(sel);
    if (!bb || !Number.isFinite(bb.w) || !Number.isFinite(bb.h)) return [];

    const view = (editor._draw && editor._draw.viewbox) ? editor._draw.viewbox() : null;
    const viewMin = view ? Math.min(view.width, view.height) : 100;
    // Handle half-size in model units. Scales with the viewbox so the
    // handles stay visually consistent on small AND large stocks.
    const sz = Math.max(viewMin * 0.012, 0.05);
    const strokeW = viewMin * 0.0025;
    const rotateOffset = sz * 5;

    const records = [];

    // Scale handles — white square with blue border.
    for (const h of SCALE_HANDLES) {
        const hx = bb.x + bb.w * h.hx;
        const hy = bb.y + bb.h * h.hy;
        const ax = bb.x + bb.w * h.ax;
        const ay = bb.y + bb.h * h.ay;
        editor._handleLayer.rect(sz * 2, sz * 2)
            .move(hx - sz, hy - sz)
            .fill('#ffffff')
            .stroke({ color: '#0066cc', width: strokeW })
            .attr('pointer-events', 'none');
        records.push({
            kind: 'scale',
            id: h.id,
            hx, hy, ax, ay,
            sx: h.sx, sy: h.sy,
            hitR: sz * 1.8,
        });
    }

    // Rotate handle — connecting tick + circle floating above the top edge.
    const rx = bb.x + bb.w * 0.5;
    const ry = bb.y - rotateOffset;
    const cx = bb.x + bb.w * 0.5;
    const cy = bb.y + bb.h * 0.5;
    editor._handleLayer.line(rx, bb.y, rx, ry)
        .stroke({ color: '#0066cc', width: strokeW })
        .attr('pointer-events', 'none');
    editor._handleLayer.circle(sz * 2)
        .center(rx, ry)
        .fill('#ffffff')
        .stroke({ color: '#0066cc', width: strokeW })
        .attr('pointer-events', 'none');
    records.push({
        kind: 'rotate',
        id: 'rotate',
        hx: rx, hy: ry,
        cx, cy,
        hitR: sz * 2,
    });

    return records;
}

/** Hit-test a model-space point against the handle records. Returns
 *  the closest handle within its hit radius, or null. */
export function hitTestHandle(records, pt) {
    if (!records || records.length === 0) return null;
    let best = null, bestDist = Infinity;
    for (const r of records) {
        const d = Math.hypot(pt.x - r.hx, pt.y - r.hy);
        if (d <= r.hitR && d < bestDist) { best = r; bestDist = d; }
    }
    return best;
}

/**
 * Snapshot what we need at drag start so applyTransformDrag can
 * compose a fresh transform on each move without accumulating drift.
 * Captures m0 per element so the SAME delta matrix applied to each
 * stays correct under the group operation.
 */
export function beginTransform(editor, handleRec, pt) {
    const sel = editor._selectedElements || [];
    if (!sel.length) return null;
    return {
        handle: handleRec,
        // Per-element start matrices. Composition on each move:
        //   el.transform = delta × els[i].m0
        els: sel.map(el => ({ el, m0: el.matrix() })),
        anchor: handleRec.kind === 'scale'
            ? { x: handleRec.ax, y: handleRec.ay }
            : { x: handleRec.cx, y: handleRec.cy },
        initAngle: handleRec.kind === 'rotate'
            ? Math.atan2(handleRec.hy - handleRec.cy, handleRec.hx - handleRec.cx)
            : 0,
        startPt: { x: pt.x, y: pt.y },
        moved: false,
    };
}

/**
 * Compose a delta transform (scale or rotate around the captured
 * anchor) on top of the element's start-of-drag matrix and write it
 * back to the transform attribute.
 *
 * Shift held while scaling locks a side handle to uniform scaling;
 * shift held while rotating snaps to 15° increments. Optional polish
 * but cheap — most editors do the same.
 */
export function applyTransformDrag(editor, state, pt, modifiers) {
    if (!state || !state.els || !state.els.length) return;

    const h = state.handle;
    const mods = modifiers || {};
    let delta;

    if (h.kind === 'scale') {
        const ax = state.anchor.x;
        const ay = state.anchor.y;

        // Vectors from the anchor: original handle, current mouse.
        const ox = h.hx - ax;
        const oy = h.hy - ay;
        const nx = pt.x - ax;
        const ny = pt.y - ay;

        const sxRaw = h.sx && Math.abs(ox) > 1e-6 ? nx / ox : 1;
        const syRaw = h.sy && Math.abs(oy) > 1e-6 ? ny / oy : 1;

        let sx, sy;
        if (h.sx && h.sy) {
            // Corner = uniform. Pick the dominant axis so dragging
            // diagonally tracks the cursor naturally.
            const useX = Math.abs(nx - ox) >= Math.abs(ny - oy);
            const f = useX ? sxRaw : syRaw;
            sx = f; sy = f;
        } else if (mods.shift) {
            // Side handle with Shift → uniform from the controlled axis.
            const f = h.sx ? sxRaw : syRaw;
            sx = f; sy = f;
        } else {
            sx = sxRaw;
            sy = syRaw;
        }

        // Don't let an axis collapse to zero — the element would
        // become invisible and singular, and there'd be no way back.
        const FLOOR = 0.01;
        if (Math.abs(sx) < FLOOR) sx = sx < 0 ? -FLOOR : FLOOR;
        if (Math.abs(sy) < FLOOR) sy = sy < 0 ? -FLOOR : FLOOR;

        delta = new SVG.Matrix()
            .translate(ax, ay)
            .scale(sx, sy)
            .translate(-ax, -ay);
    } else if (h.kind === 'rotate') {
        const a = Math.atan2(pt.y - state.anchor.y, pt.x - state.anchor.x);
        let deg = (a - state.initAngle) * 180 / Math.PI;
        if (mods.shift) {
            deg = Math.round(deg / 15) * 15;
        }
        delta = new SVG.Matrix().rotate(deg, state.anchor.x, state.anchor.y);
    } else {
        return;
    }

    // new transform = delta × m0_i  (compose per-element in world space)
    for (const rec of state.els) {
        const composed = delta.multiply(rec.m0);
        rec.el.attr('transform', composed.toString());
    }
    state.moved = true;

    editor._updateSelectionHighlight();
    if (editor._onChange) editor._onChange();
}

/**
 * Union of the world-space bboxes of every element in `els`. Used by
 * renderTransformHandles to wrap the multi-selection in one combined
 * bbox so dragging a corner scales the group as a unit.
 */
function _combinedBbox(els) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let any = false;
    for (const el of els) {
        const b = worldBbox(el);
        if (!b || !Number.isFinite(b.w) || !Number.isFinite(b.h)) continue;
        any = true;
        if (b.x  < minX) minX = b.x;
        if (b.y  < minY) minY = b.y;
        if (b.x2 > maxX) maxX = b.x2;
        if (b.y2 > maxY) maxY = b.y2;
    }
    if (!any) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, x2: maxX, y2: maxY };
}

/**
 * Delete the element's transform attribute, returning it to identity.
 * The element snaps back to wherever its raw coordinates put it.
 */
export function resetTransform(el) {
    if (!el || typeof el.attr !== 'function') return false;
    const had = !!el.attr('transform');
    el.attr('transform', null);
    return had;
}

/**
 * Bake the element's current transform attribute into its geometry
 * (path d, line endpoints, polygon/polyline points, or — for shape
 * primitives — convert to a path first then bake). After flatten,
 * the element's transform attribute is identity.
 *
 * Returns true on success, false if the element type isn't supported
 * (e.g. <text> — flattening text loses font-rendered geometry; for
 * those, expand to a path first via the Expand tool, then flatten).
 */
export function flattenTransform(el) {
    if (!el || typeof el.attr !== 'function') return false;
    const m = el.matrix();
    if (!m || _isIdentity(m)) {
        el.attr('transform', null);
        return true;
    }

    const type = el.type;

    if (type === 'path') {
        _bakeMatrixIntoPath(el, m);
        el.attr('transform', null);
        return true;
    }

    if (type === 'line') {
        const p1 = _xform(m, +el.attr('x1') || 0, +el.attr('y1') || 0);
        const p2 = _xform(m, +el.attr('x2') || 0, +el.attr('y2') || 0);
        el.attr({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
        el.attr('transform', null);
        return true;
    }

    if (type === 'polyline' || type === 'polygon') {
        const pts = el.array().map(p => {
            const w = _xform(m, p[0], p[1]);
            return [w.x, w.y];
        });
        el.plot(pts);
        el.attr('transform', null);
        return true;
    }

    if (type === 'rect' || type === 'circle' || type === 'ellipse') {
        // Rotated/skewed primitives can't be expressed with native attrs
        // — promote to a path and bake. Pure translate+scale could be
        // baked into x/y/w/h, but going through path is uniform and
        // already used elsewhere in the codebase.
        const d = _primitiveToPathData(el);
        if (!d) return false;
        const parent = el.parent();
        if (!parent) return false;
        const newPath = parent.path(d)
            .fill(el.attr('fill') || 'none')
            .stroke({
                color: el.attr('stroke') || '#000',
                width: parseFloat(el.attr('stroke-width')) || 0.5,
            });
        // Copy data-* attrs (layer membership, etc.) onto the new path.
        const node = el.node;
        for (const attr of Array.from(node.attributes)) {
            if (attr.name.startsWith('data-')) newPath.attr(attr.name, attr.value);
        }
        // Bake the transform into the new path's d, then remove original.
        _bakeMatrixIntoPath(newPath, m);
        newPath.attr('transform', null);
        // Re-parent in the same z-order slot if possible.
        try { newPath.insertAfter(el); } catch (_) {}
        el.remove();
        return true;
    }

    // text, image, g — leave it alone; caller can fall back to "reset".
    return false;
}

/** Apply a SVG.Matrix to a (x,y) point and return a plain {x,y}. */
function _xform(m, x, y) {
    if (typeof SVG !== 'undefined' && SVG.Point) {
        const p = new SVG.Point(x, y).transform(m);
        return { x: p.x, y: p.y };
    }
    // Manual fallback — affine: [a c e; b d f; 0 0 1] · [x; y; 1]
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function _isIdentity(m) {
    return m && m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

/**
 * Walk a path's d, transform every control point through `m`, and
 * write the result back. Mirrors the manual baking used in
 * editor-expand-text.js (SVG.js's own .transform() on path elements
 * has historically been unreliable for path baking).
 */
function _bakeMatrixIntoPath(pathEl, m) {
    const arr = new SVG.PathArray(pathEl.attr('d'));
    arr.forEach(seg => {
        for (let i = 1; i < seg.length; i += 2) {
            if (typeof seg[i]