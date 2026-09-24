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
 * SE7s: what a scale-handle drag actually DOES to the element is no longer
 * one universal "compose a scale into `transform`" rule — that scaled the
 * stroke (carve width) and, on a rotated element, sheared it (handles sat
 * on the WORLD-aligned bbox, scaling along world X/Y instead of the
 * element's own axes). It's now a per-kind declaration (HANDLE_EDIT,
 * handle-edit.js): 'endpoints' (line) moves one endpoint along the line's
 * own direction; 'radius'/'radii' (circle/ellipse) resize in place, centre
 * fixed; 'geometry' (rect/path/polyline/polygon) bakes straight into
 * coordinates on every move from the drag-start snapshot, so `transform`
 * never carries a scale and stroke-width is invariant; 'scale' (text, and
 * the fallback for anything undeclared) keeps the old transform-compose
 * behaviour. A single selection edits in the element's OWN frame (handles
 * placed by mapping its local bbox through its full matrix, o/n vectors
 * computed in local space via toLocal) so a rotated element's side handle
 * stretches along ITS edge, not world X/Y; this reduces to exactly the old
 * world-frame math when the element isn't rotated/translated non-trivially
 * (a local bbox mapped through an identity-rotation matrix IS the world
 * bbox). A multi-selection keeps the shared WORLD frame (one combined bbox,
 * one shared anchor/handle/pointer), and each element is still edited by
 * its own HANDLE_EDIT rule from that shared anchor.
 *
 * Corner-handle scaling uses cornerScale (handle-edit.js) — a projection of
 * the pointer onto the anchor->handle direction — replacing the old
 * dominant-pointer-axis pick, which made a thin element's corner scale
 * wildly (a 0.02x3 tie scaled x15 for a 0.3" sideways drag) and a
 * near-square box's factor jitter as the dominant axis flipped.
 */
import { worldBbox, worldPoint, toLocal, transformPoint } from './editor-coords.js';
import { PATH_LAYOUT, normalizeForBake } from './path-layout.js';
import { snapFor } from './editor-grid.js';
import {
    HANDLE_EDIT, cornerScale,
    multiplyMatrix, translateMatrix, scaleMatrix, rotateMatrix, matrixToString,
} from './handle-edit.js';

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
 * SE7s: a single selection places every handle by mapping the element's
 * LOCAL bbox fractional point through its FULL matrix (rotation and all) —
 * not a world-AABB fraction — so the handles sit on the element's own
 * (possibly rotated) corners instead of the axis-aligned box around it.
 * For an unrotated/untranslated element this is numerically identical to
 * the old world-AABB placement (mapping a local point through an
 * identity-rotation matrix IS its world position), so nothing changes for
 * the common case. A multi-selection keeps the combined WORLD bbox — one
 * shared box the group scales/rotates as a unit, exactly as before.
 */
export function renderTransformHandles(editor) {
    if (!editor._handleLayer) return [];
    const sel = editor._selectedElements || [];
    if (!sel.length) return [];

    const single = sel.length === 1 ? sel[0] : null;
    let worldOf;
    if (single) {
        const b = single.bbox();
        if (!b || !Number.isFinite(b.w) || !Number.isFinite(b.h)) return [];
        const m = single.matrix();
        worldOf = (fx, fy) => transformPoint(m, { x: b.x + b.w * fx, y: b.y + b.h * fy });
    } else {
        const bb = _combinedBbox(sel);
        if (!bb || !Number.isFinite(bb.w) || !Number.isFinite(bb.h)) return [];
        worldOf = (fx, fy) => ({ x: bb.x + bb.w * fx, y: bb.y + bb.h * fy });
    }

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
        const { x: hx, y: hy } = worldOf(h.hx, h.hy);
        const { x: ax, y: ay } = worldOf(h.ax, h.ay);
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

    // Rotate handle — connecting tick + circle floating above the top edge
    // (the element's own "up", via worldOf, not necessarily world "up").
    const center = worldOf(0.5, 0.5);
    const topMid = worldOf(0.5, 0);
    let dx = topMid.x - center.x, dy = topMid.y - center.y;
    const dlen = Math.hypot(dx, dy) || 1;
    dx /= dlen; dy /= dlen;
    const rx = topMid.x + dx * rotateOffset;
    const ry = topMid.y + dy * rotateOffset;
    editor._handleLayer.line(topMid.x, topMid.y, rx, ry)
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
        cx: center.x, cy: center.y,
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

/** True if `m`'s linear part carries any rotation/skew (b or c nonzero) —
 *  a pure scale+translate matrix always has b=c=0. Used only to decide
 *  whether a rect needs promoting to a path before a 'geometry' edit (see
 *  _snapshotGeometry): an axis-aligned rect's raw x/y/width/height is
 *  always representable directly; a rotated one needs a general point
 *  list, because the anchor-relative scale that comes out of a shared
 *  WORLD-frame multi-selection drag (round-tripped through toLocal) can
 *  leave a non-axis-aligned quadrilateral in local space. */
function _isRotated(m) {
    return !!m && (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9);
}

/**
 * Snapshot what we need at drag start so applyTransformDrag can recompute
 * a fresh result on each move without accumulating drift.
 *
 * SE7s: the anchor/handle used for the corner-projection / side-ratio
 * factor now come from one of two frames, decided ONCE here and carried on
 * `state.frame`:
 *   'local' — a single selection: anchor/handle are the element's OWN
 *     local-bbox fractional points (untransformed), and applyTransformDrag
 *     maps the live pointer into that same local space via toLocal before
 *     computing o/n — so the factor is correct in the element's own
 *     (possibly rotated) axes, not world X/Y.
 *   'world' — a multi-selection (or nothing selected, unreachable here):
 *     the existing combined-bbox behaviour, anchor/handle taken straight
 *     from the hit-tested world-space handle record, exactly as before.
 * Per-element HANDLE_EDIT kind is resolved here too, with whatever
 * kind-specific snapshot that kind's own edit needs (line endpoints/
 * direction, circle/ellipse start radii, geometry's point list) — built
 * once so every move re-derives from the SAME drag-start data instead of
 * the element's own already-mutated state (which would drift/compound).
 */
export function beginTransform(editor, handleRec, pt) {
    const sel = editor._selectedElements || [];
    if (!sel.length) return null;

    if (handleRec.kind === 'rotate') {
        return {
            handle: handleRec,
            els: sel.map(el => ({ el, m0: el.matrix() })),
            anchor: { x: handleRec.cx, y: handleRec.cy },
            initAngle: Math.atan2(handleRec.hy - handleRec.cy, handleRec.hx - handleRec.cx),
            startPt: { x: pt.x, y: pt.y },
            moved: false,
        };
    }

    const frame = sel.length === 1 ? 'local' : 'world';
    let anchorPt, handlePt;
    if (frame === 'local') {
        const def = SCALE_HANDLES.find(s => s.id === handleRec.id);
        const b = sel[0].bbox();
        anchorPt = { x: b.x + b.w * def.ax, y: b.y + b.h * def.ay };
        handlePt = { x: b.x + b.w * def.hx, y: b.y + b.h * def.hy };
    } else {
        anchorPt = { x: handleRec.ax, y: handleRec.ay };
        handlePt = { x: handleRec.hx, y: handleRec.hy };
    }
    // The handle's WORLD position at drag start, regardless of frame — the
    // 'endpoints' (line) rule needs this to tell which of ITS OWN two
    // endpoints was actually grabbed, independent of the shared anchor.
    const handleWorld = frame === 'local' ? transformPoint(sel[0].matrix(), handlePt) : handlePt;

    const els = sel.map(rawEl => {
        let el = rawEl;
        const kind = HANDLE_EDIT[el.type] || 'scale';
        if (kind === 'geometry' && el.type === 'rect' && _isRotated(el.matrix())) {
            el = _promoteRectToPath(editor, el);
        }
        const m0 = el.matrix();
        const rec = { el, m0, kind };
        if (kind === 'geometry') {
            rec.snapshot = _snapshotGeometry(el);
        } else if (kind === 'radius') {
            rec.r0 = parseFloat(el.attr('r')) || 0;
        } else if (kind === 'radii') {
            rec.rx0 = parseFloat(el.attr('rx')) || 0;
            rec.ry0 = parseFloat(el.attr('ry')) || 0;
        } else if (kind === 'endpoints') {
            const p1 = { x: parseFloat(el.attr('x1')) || 0, y: parseFloat(el.attr('y1')) || 0 };
            const p2 = { x: parseFloat(el.attr('x2')) || 0, y: parseFloat(el.attr('y2')) || 0 };
            const w1 = transformPoint(m0, p1);
            const w2 = transformPoint(m0, p2);
            const d1 = Math.hypot(handleWorld.x - w1.x, handleWorld.y - w1.y);
            const d2 = Math.hypot(handleWorld.x - w2.x, handleWorld.y - w2.y);
            const movingIsP1 = d1 <= d2;
            rec.movingIsP1 = movingIsP1;
            rec.anchorWorld = movingIsP1 ? w2 : w1;
            const moving = movingIsP1 ? w1 : w2;
            const ddx = moving.x - rec.anchorWorld.x, ddy = moving.y - rec.anchorWorld.y;
            const len = Math.hypot(ddx, ddy);
            rec.dirUnit = len > 1e-9 ? { x: ddx / len, y: ddy / len } : null;
        }
        return rec;
    });

    return {
        handle: handleRec,
        frame,
        anchorPt,
        handlePt,
        els,
        startPt: { x: pt.x, y: pt.y },
        moved: false,
    };
}

/** Read a 'geometry'-kind element's editable points into a flat list plus
 *  a write-back closure, so applyTransformDrag can recompute every point
 *  from the SAME drag-start snapshot on every move (never re-reading the
 *  element's own, already-mutated geometry, which would compound error). */
function _snapshotGeometry(el) {
    if (el.type === 'rect') {
        const x = parseFloat(el.attr('x')) || 0;
        const y = parseFloat(el.attr('y')) || 0;
        const w = parseFloat(el.attr('width')) || 0;
        const h = parseFloat(el.attr('height')) || 0;
        const points = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
        return {
            points,
            write(pts) {
                const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
                const nx = Math.min(...xs), ny = Math.min(...ys);
                el.attr({ x: nx, y: ny, width: Math.max(...xs) - nx, height: Math.max(...ys) - ny });
            },
        };
    }
    if (el.type === 'polyline' || el.type === 'polygon') {
        const points = el.array().map(p => ({ x: p[0], y: p[1] }));
        return { points, write: (pts) => el.plot(pts.map(p => [p.x, p.y])) };
    }
    // path (including a rect just promoted by _promoteRectToPath): every
    // A becomes cubics and every H/V becomes a full L first (SE8a's
    // normalizeForBake) so PATH_LAYOUT's `pts` covers every remaining
    // segment uniformly — the same normalization _bakeMatrixIntoPath uses,
    // reused here rather than re-hand-rolled.
    const normalized = normalizeForBake(el.array());
    const slots = [];
    const points = [];
    normalized.forEach((seg, segIdx) => {
        const layout = PATH_LAYOUT[seg[0]];
        if (!layout || !layout.pts) return;
        for (const [xi, yi] of layout.pts) {
            slots.push({ segIdx, xi, yi });
            points.push({ x: seg[xi], y: seg[yi] });
        }
    });
    return {
        points,
        write(pts) {
            slots.forEach((s, i) => {
                normalized[s.segIdx][s.xi] = pts[i].x;
                normalized[s.segIdx][s.yi] = pts[i].y;
            });
            el.plot(normalized);
        },
    };
}

/** Replace a ROTATED rect with an equivalent path holding the SAME 4
 *  corners in local space and the SAME `transform` (rotation/translation
 *  only — a rect never carries scale in `transform` post-SE7s) — so a
 *  'geometry' edit has one general point-list representation to work with
 *  instead of needing a second, rotation-aware x/y/width/height formula.
 *  An axis-aligned rect never goes through here (see beginTransform). */
function _promoteRectToPath(editor, el) {
    const x = parseFloat(el.attr('x')) || 0;
    const y = parseFloat(el.attr('y')) || 0;
    const w = parseFloat(el.attr('width')) || 0;
    const h = parseFloat(el.attr('height')) || 0;
    const d = `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
    const parent = el.parent();
    const newPath = parent.path(d)
        .fill(el.attr('fill') || 'none')
        .stroke({
            color: el.attr('stroke') || '#000',
            width: parseFloat(el.attr('stroke-width')) || 0.5,
        })
        .attr('transform', el.attr('transform') || null);
    const node = el.node;
    for (const attr of Array.from(node.attributes)) {
        if (attr.name.startsWith('data-')) newPath.attr(attr.name, attr.value);
    }
    try { newPath.insertAfter(el); } catch (_) {}
    el.remove();
    const sel = editor._selectedElements || [];
    const idx = sel.indexOf(el);
    if (idx !== -1) sel[idx] = newPath;
    return newPath;
}

/**
 * Recompute the result of the drag-so-far and write it — geometry attrs,
 * r/rx/ry, endpoint attrs, or `transform`, per each element's own
 * HANDLE_EDIT kind — from the drag-start snapshot in `state`, given the
 * live pointer `pt` (world space) and `modifiers` ({shift, alt}). Shift
 * held while scaling locks a side handle to uniform scaling; shift held
 * while rotating snaps to 15° increments; alt held bypasses grid-snap for
 * an 'endpoints' (line) drag, matching SNAP_POLICY's Alt-bypass elsewhere.
 */
export function applyTransformDrag(editor, state, pt, modifiers) {
    if (!state || !state.els || !state.els.length) return;

    const h = state.handle;
    const mods = modifiers || {};

    if (h.kind === 'rotate') {
        const a = Math.atan2(pt.y - state.anchor.y, pt.x - state.anchor.x);
        let deg = (a - state.initAngle) * 180 / Math.PI;
        if (mods.shift) deg = Math.round(deg / 15) * 15;
        const delta = rotateMatrix(deg, state.anchor.x, state.anchor.y);
        for (const rec of state.els) {
            rec.el.attr('transform', matrixToString(multiplyMatrix(delta, rec.m0)));
        }
        state.moved = true;
        editor._updateSelectionHighlight();
        editor._notifyChange('live');
        return;
    }

    if (h.kind !== 'scale') return;

    // o = anchor->handle at drag start, n = anchor->pointer now — both in
    // the drag's own frame (local, mapped through toLocal for the single-
    // selection case; world, straight from the shared bbox, otherwise).
    let ox, oy, nx, ny;
    if (state.frame === 'local') {
        const localPt = toLocal(state.els[0].el, pt);
        ox = state.handlePt.x - state.anchorPt.x;
        oy = state.handlePt.y - state.anchorPt.y;
        nx = localPt.x - state.anchorPt.x;
        ny = localPt.y - state.anchorPt.y;
    } else {
        ox = state.handlePt.x - state.anchorPt.x;
        oy = state.handlePt.y - state.anchorPt.y;
        nx = pt.x - state.anchorPt.x;
        ny = pt.y - state.anchorPt.y;
    }

    const sxRaw = h.sx && Math.abs(ox) > 1e-6 ? nx / ox : 1;
    const syRaw = h.sy && Math.abs(oy) > 1e-6 ? ny / oy : 1;

    let sx, sy;
    if (h.sx && h.sy) {
        // Corner = uniform, via the projection onto anchor->handle — see
        // handle-edit.js's own docstring for why (replaces a dominant-
        // pointer-axis pick that made a thin element's scale factor
        // explode and a near-square one's jitter between adjacent frames).
        const f = cornerScale(ox, oy, nx, ny);
        sx = f; sy = f;
    } else if (mods.shift) {
        // Side handle with Shift → uniform from the controlled axis.
        const f = h.sx ? sxRaw : syRaw;
        sx = f; sy = f;
    } else {
        sx = sxRaw;
        sy = syRaw;
    }

    // Don't let an axis collapse to zero — the element would become
    // invisible and singular, and there'd be no way back.
    const FLOOR = 0.01;
    if (Math.abs(sx) < FLOOR) sx = sx < 0 ? -FLOOR : FLOOR;
    if (Math.abs(sy) < FLOOR) sy = sy < 0 ? -FLOOR : FLOOR;

    for (const rec of state.els) {
        _applyScaleToElement(state, rec, sx, sy, h, pt, !!mods.alt, editor);
    }
    state.moved = true;

    editor._updateSelectionHighlight();
    // SE8b / SA-UNDO-1: was the REAL _onChange() per mousemove — see
    // editor-interaction.js's dragNode for the full explanation. handleEnd
    // fires the one 'commit' per gesture.
    editor._notifyChange('live');
}

/** Dispatch a single element's share of the drag per its own HANDLE_EDIT
 *  kind. sx/sy are the shared factor(s) computed once above (ignored
 *  entirely by 'endpoints', which tracks the raw pointer instead — a line
 *  doesn't scale, it changes length). */
function _applyScaleToElement(state, rec, sx, sy, h, pt, altBypass, editor) {
    if (rec.kind === 'endpoints') {
        if (!rec.dirUnit) return; // degenerate (zero-length) line — nothing to project onto
        const dot = (pt.x - rec.anchorWorld.x) * rec.dirUnit.x + (pt.y - rec.anchorWorld.y) * rec.dirUnit.y;
        const newWorld = {
            x: rec.anchorWorld.x + dot * rec.dirUnit.x,
            y: rec.anchorWorld.y + dot * rec.dirUnit.y,
        };
        const snapped = snapFor(newWorld, editor._grid, 'select', 'move', altBypass);
        const local = toLocal(rec.el, snapped);
        if (rec.movingIsP1) rec.el.attr({ x1: local.x, y1: local.y });
        else rec.el.attr({ x2: local.x, y2: local.y });
        return;
    }

    if (rec.kind === 'radius') {
        const f = h.sx ? sx : sy;
        rec.el.attr('r', rec.r0 * f);
        return;
    }

    if (rec.kind === 'radii') {
        rec.el.attr({ rx: rec.rx0 * sx, ry: rec.ry0 * sy });
        return;
    }

    if (rec.kind === 'geometry') {
        const anchor = state.anchorPt;
        const newPts = rec.snapshot.points.map((p) => {
            if (state.frame === 'local') {
                return { x: anchor.x + (p.x - anchor.x) * sx, y: anchor.y + (p.y - anchor.y) * sy };
            }
            // World-frame (multi-selection): round-trip through THIS
            // element's own (unchanging, for 'geometry') matrix, so the
            // group scales together in world space without ever writing a
            // scale into any member's transform.
            const worldP = worldPoint(rec.el, p);
            const worldNew = { x: anchor.x + (worldP.x - anchor.x) * sx, y: anchor.y + (worldP.y - anchor.y) * sy };
            return toLocal(rec.el, worldNew);
        });
        rec.snapshot.write(newPts);
        return;
    }

    // 'scale' (text, and the fallback for anything undeclared): compose a
    // delta scale onto the drag-start matrix, in the SAME frame the o/n
    // vectors above were computed in — world: delta outer (delta x m0, as
    // before); local: delta inner (m0 x delta) so the scale happens in the
    // element's OWN pre-rotation axes, not world X/Y.
    const anchor = state.anchorPt;
    const delta = multiplyMatrix(
        translateMatrix(anchor.x, anchor.y),
        multiplyMatrix(scaleMatrix(sx, sy), translateMatrix(-anchor.x, -anchor.y)),
    );
    const composed = state.frame === 'local'
        ? multiplyMatrix(rec.m0, delta)
        : multiplyMatrix(delta, rec.m0);
    rec.el.attr('transform', matrixToString(composed));
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
    return bakeMatrixIntoElement(el, el.matrix());
}

/**
 * Bake an EXPLICIT matrix `m` into the element's geometry (rather than the
 * element's own transform). flattenTransform is the special case
 * bakeMatrixIntoElement(el, el.matrix()); the carve export (bakeSvgForCarving)
 * uses it with (carveMatrix × el.matrix()) to fold the board→Fusion mapping
 * into the coordinates. Returns false for types we can't bake (text/image/g).
 */
export function bakeMatrixIntoElement(el, m) {
    if (!el || typeof el.attr !== 'function') return false;
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
        const p1 = transformPoint(m, { x: +el.attr('x1') || 0, y: +el.attr('y1') || 0 });
        const p2 = transformPoint(m, { x: +el.attr('x2') || 0, y: +el.attr('y2') || 0 });
        el.attr({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
        el.attr('transform', null);
        return true;
    }

    if (type === 'polyline' || type === 'polygon') {
        const pts = el.array().map(p => {
            const w = transformPoint(m, { x: p[0], y: p[1] });
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

function _isIdentity(m) {
    return m && m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

/**
 * Walk a path's d, transform every control point through `m`, and write
 * the result back. Mirrors the manual baking used in editor-expand-text.js
 * (SVG.js's own .transform() on path elements has historically been
 * unreliable for path baking).
 *
 * SE8a / SA-ROUNDTRIP-1: the old version paired up EVERY remaining
 * numeric slot as an (x,y) point, which is wrong for `A` (7 params —
 * rx ry x-rotation large-arc-flag sweep-flag x y, none of which pair up
 * as points except the last two) and for a rotated/skewed `H`/`V` (no
 * longer horizontal/vertical once the matrix lands, so it can't stay an
 * H/V at all). normalizeForBake converts every A to cubics (using the
 * PRE-bake local cursor — an arc's own parametrization depends on where
 * it starts) and every H/V to a full L FIRST; only then does PATH_LAYOUT
 * say which slots to transform, uniformly, for every remaining command.
 */
function _bakeMatrixIntoPath(pathEl, m) {
    const raw = new SVG.PathArray(pathEl.attr('d'));
    const normalized = normalizeForBake(raw);
    normalized.forEach(seg => {
        const layout = PATH_LAYOUT[seg[0]];
        if (!layout || !layout.pts) return; // Z, or (shouldn't occur post-normalize) A/H/V
        for (const [xi, yi] of layout.pts) {
            const p = transformPoint(m, { x: seg[xi], y: seg[yi] });
            seg[xi] = p.x;
            seg[yi] = p.y;
        }
    });
    pathEl.attr('d', normalized.map(seg => seg.join(' ')).join(' '));
}

// Standard 4-cubic circle/ellipse Bezier approximation constant
// (kappa = 4/3 * (sqrt(2) - 1)), same value used industry-wide.
const KAPPA = 0.5522847498;

/**
 * Convert a rect / circle / ellipse to a path `d` string. Used by
 * flattenTransform before baking a non-identity matrix — primitives
 * can't carry rotation/skew in their native attributes, so we promote
 * them to a path first and then bake the matrix into the d.
 *
 * SE8a / SA-ROUNDTRIP-1: circle/ellipse used to become two half-arcs
 * (sweep=0) — every one of them then hit _bakeMatrixIntoPath's arc-
 * corruption bug on every carve export (carveMatrix is never identity).
 * 4 cubics (kappa approximation) sidesteps the whole problem: a cubic's
 * control points transform correctly under ANY affine, so there's no
 * arc left to corrupt. (A generic user-drawn `A` — e.g. from a pasted
 * SVG — still goes through path-layout.js's arcToCubics at bake time;
 * this fixes the one guaranteed-common source, not just this instance.)
 * Returns '' if the geometry would be degenerate (zero size) or the
 * element type isn't a supported primitive.
 */
function _primitiveToPathData(el) {
    if (!el || typeof el.attr !== 'function') return '';
    const type = el.type;

    if (type === 'rect') {
        const x = +el.attr('x') || 0;
        const y = +el.attr('y') || 0;
        const w = +el.attr('width')  || 0;
        const h = +el.attr('height') || 0;
        if (w <= 0 || h <= 0) return '';
        return 'M ' + x + ' ' + y
             + ' L ' + (x + w) + ' ' + y
             + ' L ' + (x + w) + ' ' + (y + h)
             + ' L ' + x + ' ' + (y + h) + ' Z';
    }

    if (type === 'circle' || type === 'ellipse') {
        const cx = +el.attr('cx') || 0;
        const cy = +el.attr('cy') || 0;
        const rx = type === 'circle' ? (+el.attr('r') || 0) : (+el.attr('rx') || 0);
        const ry = type === 'circle' ? (+el.attr('r') || 0) : (+el.attr('ry') || 0);
        if (rx <= 0 || ry <= 0) return '';
        const kx = rx * KAPPA, ky = ry * KAPPA;
        return 'M ' + (cx + rx) + ' ' + cy
             + ' C ' + (cx + rx) + ' ' + (cy + ky) + ' ' + (cx + kx) + ' ' + (cy + ry) + ' ' + cx + ' ' + (cy + ry)
             + ' C ' + (cx - kx) + ' ' + (cy + ry) + ' ' + (cx - rx) + ' ' + (cy + ky) + ' ' + (cx - rx) + ' ' + cy
             + ' C ' + (cx - rx) + ' ' + (cy - ky) + ' ' + (cx - kx) + ' ' + (cy - ry) + ' ' + cx + ' ' + (cy - ry)
             + ' C ' + (cx + kx) + ' ' + (cy - ry) + ' ' + (cx + rx) + ' ' + (cy - ky) + ' ' + (cx + rx) + ' ' + cy
             + ' Z';
    }

    return '';
}
