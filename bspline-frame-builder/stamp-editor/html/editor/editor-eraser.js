/**
 * editor-eraser.js — vector eraser for the SVG editor.
 *
 * Drag a freehand stroke; on release we build a "fat polygon" from the
 * stroke (offset by eraserWidth/2 each side, with round caps), then
 * walk every sketch-layer child and subtract / split based on its
 * geometry:
 *
 *   - Filled paths / closed shapes (rect, circle, ellipse, polygon,
 *     or a path whose d ends in Z) →
 *         polygon-clip difference. If the result is empty, the
 *         element is removed; if it splits into multiple regions, we
 *         emit them as one multi-subpath d so the shape stays a
 *         single element with the same layer / fill / stroke attrs.
 *
 *   - Open strokes (line, polyline, freehand path) →
 *         sample-and-split. For each consecutive pair of samples we
 *         check whether either end falls inside the eraser polygon;
 *         segments that stay outside are kept, the rest are dropped.
 *         The remaining segments are re-emitted as one or more new
 *         <path> elements (so a single stroke can split into several).
 *
 *   - <text> →  skipped. Use the Expand tool to turn text into a
 *               filled path first, then erase.
 *
 * Uses the same polygon-clipping@0.15.7 lazy-load that
 * editor-expand-union.js already manages, so we don't pull in a
 * second copy of the library. If the load fails (offline), the
 * eraser silently no-ops on filled shapes but still splits strokes
 * locally (no clipper needed for the open-stroke path).
 */
import {
    loadClipper,
    multiPolygonToPathData,
} from './editor-expand-union.js';
import { applyLayerState } from './layers.js';
import { fusLog } from '../core/fusion-bridge.js';

const PREVIEW_STROKE = '#ff3b30';     // iOS red — visually distinct from the pen tool
const PREVIEW_OPACITY = 0.55;
const SAMPLE_STEP_IN_MODEL = 0.04;    // ~25 samples per inch — fine enough for most shapes

function _eLog(msg) {
    if (typeof window !== 'undefined' && window.__editorDebug === 'ERASER') {
        try { console.log('[ERASER] ' + msg); } catch (_) {}
    }
    try { fusLog('[ERASER] ' + msg); } catch (_) {}
}


// ─── Lifecycle ────────────────────────────────────────────────────

/** Begin a fresh eraser stroke at `pt`. Creates a red preview path
 *  in the sketch layer that follows the cursor; it's removed in
 *  finishEraserStroke before any geometry mutation. */
export function startEraserStroke(editor, pt) {
    editor._eraserPoints = [{ x: pt.x, y: pt.y }];
    const w = _eraserWidth(editor);
    editor._eraserPath = editor._sketchLayer
        .path(`M ${pt.x} ${pt.y}`)
        .fill('none')
        .stroke({ color: PREVIEW_STROKE, width: w, linecap: 'round', linejoin: 'round', opacity: PREVIEW_OPACITY })
        .attr('pointer-events', 'none');
    _eLog(`start  pt=(${pt.x.toFixed(2)},${pt.y.toFixed(2)})  w=${w}`);
}

/** Extend the eraser preview to include `pt`. */
export function updateEraserStroke(editor, pt) {
    const pts = editor._eraserPoints;
    if (!pts || !editor._eraserPath) return;
    pts.push({ x: pt.x, y: pt.y });
    const d = editor._eraserPath.attr('d') + ` L ${pt.x} ${pt.y}`;
    editor._eraserPath.attr('d', d);
}

/** Finalize the eraser: remove the preview, build the eraser
 *  polygon, then subtract / split every intersecting sketch-layer
 *  element. Pushes one undo snapshot iff something changed. */
export async function finishEraserStroke(editor) {
    const pts = editor._eraserPoints || [];
    const preview = editor._eraserPath;
    editor._eraserPoints = null;
    editor._eraserPath = null;
    if (preview) { try { preview.remove(); } catch (_) {} }
    if (pts.length < 2) {
        _eLog(`finish  abort  pts=${pts.length}`);
        return;
    }

    const w = _eraserWidth(editor);
    const eraserRing = _buildFatPolygon(pts, w);
    if (!eraserRing || eraserRing.length < 3) {
        _eLog('finish  eraser ring degenerate');
        return;
    }

    const clipper = await loadClipper();
    if (!clipper) {
        // Library failed to load — still process open strokes (which
        // don't need the clipper) and skip filled shapes.
        _eLog('finish  clipper unavailable, open-strokes-only mode');
    }

    // Normalize the eraser polygon (in case the freehand crossed itself).
    let eraserMulti = null;
    if (clipper) {
        try {
            eraserMulti = clipper.union([[eraserRing]]);
        } catch (e) {
            _eLog(`finish  eraser union threw: ${e.message}`);
        }
    }

    const children = editor._sketchLayer.children().toArray();
    let anyChanged = false;

    for (const el of children) {
        // The preview is already removed, but be defensive.
        if (!el || !el.node || !el.node.parentNode) continue;
        if (el.type === 'text') continue;

        const cls = el.node.getAttribute('class') || '';
        if (cls.includes('layer-hidden')) continue;

        try {
            const changed = await _eraseElement(editor, el, eraserRing, eraserMulti, clipper);
            if (changed) anyChanged = true;
        } catch (e) {
            _eLog(`element erase threw  type=${el.type}  err=${e.message}`);
        }
    }

    if (anyChanged) {
        applyLayerState(editor);
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
    _eLog(`finish  anyChanged=${anyChanged}  scanned=${children.length}`);
}


// ─── Per-element erase ───────────────────────────────────────────

/**
 * Decide whether `el` is a filled / closed shape (polygon-clip
 * subtract) or an open stroke (sample-and-split), then dispatch.
 * Returns true if anything mutated.
 */
async function _eraseElement(editor, el, eraserRing, eraserMulti, clipper) {
    const sampled = _sampleElement(el);
    if (!sampled || sampled.length < 2) return false;

    // Quick bbox reject — if the element bbox doesn't intersect the
    // eraser bbox, skip the heavy work.
    if (!_bboxesIntersect(sampled, eraserRing)) return false;

    const fill = (el.attr('fill') || '').toLowerCase();
    const isFilled = fill && fill !== 'none' && fill !== 'transparent';
    const closed = isFilled || _isClosedShape(el);

    if (closed) {
        if (!clipper || !eraserMulti) return false;
        return _eraseFilled(editor, el, sampled, eraserMulti, clipper);
    }
    return _eraseOpenStroke(editor, el, sampled, eraserRing);
}

/** Polygon-clip difference for a closed/filled element. */
function _eraseFilled(editor, el, sampled, eraserMulti, clipper) {
    const ring = sampled.map(p => [p.x, p.y]);
    if (ring.length < 3) return false;
    let result;
    try {
        const elMulti = clipper.union([[ring]]);
        result = clipper.difference(elMulti, eraserMulti);
    } catch (e) {
        _eLog(`difference threw  ${e.message}`);
        return false;
    }
    if (!result || result.length === 0) {
        // Entire shape was erased.
        el.remove();
        return true;
    }
    const newD = multiPolygonToPathData(result);
    if (!newD) return false;

    // If the result is geometrically equivalent to the original (no
    // intersection), skip the replacement to avoid spurious undo entries.
    // Cheap check: bbox area unchanged within a small tolerance.
    // (A real "no overlap" detection requires more work; this is fine
    //  for the common case where the eraser missed.)
    // — left as a TODO; current behaviour is to always replace, which
    //   is safe and just generates a redundant undo entry in edge cases.

    _replaceWithPath(editor, el, newD, {
        fill:        el.attr('fill') || '#000000',
        fillRule:    el.attr('fill-rule') || 'evenodd',
        stroke:      el.attr('stroke') || 'none',
        strokeWidth: el.attr('stroke-width'),
        dataLayer:   el.attr('data-layer'),
        transform:   null,    // sampled coords are already world-space
    });
    return true;
}

/**
 * Open-stroke split: walk the sampled polyline and keep contiguous
 * runs whose points fall OUTSIDE the eraser polygon. Each kept run
 * gets re-emitted as its own <path>. If everything's inside, the
 * original is removed.
 */
function _eraseOpenStroke(editor, el, sampled, eraserRing) {
    const inside = sampled.map(p => _pointInRing(p, eraserRing));
    // If nothing's inside, the eraser missed this stroke entirely.
    if (inside.every(v => !v)) return false;
    // If everything's inside, the stroke is gone.
    if (inside.every(v => v)) { el.remove(); return true; }

    // Walk the points, accumulating segments of outside points.
    const segments = [];
    let cur = null;
    for (let i = 0; i < sampled.length; i++) {
        if (!inside[i]) {
            if (!cur) cur = [];
            cur.push(sampled[i]);
        } else if (cur) {
            if (cur.length >= 2) segments.push(cur);
            cur = null;
        }
    }
    if (cur && cur.length >= 2) segments.push(cur);

    if (!segments.length) { el.remove(); return true; }

    // Common style: keep original stroke + width + endcap + layer.
    // stroke-linecap is preserved so a square-capped stroke that's
    // split by the eraser produces square-capped sub-strokes (and a
    // round one stays round). Same for linejoin on the kept polyline.
    const style = {
        stroke:       el.attr('stroke') || '#000000',
        strokeWidth:  el.attr('stroke-width'),
        strokeLinecap:  el.attr('stroke-linecap')  || _nodeStyleProp(el, 'stroke-linecap')  || 'round',
        strokeLinejoin: el.attr('stroke-linejoin') || _nodeStyleProp(el, 'stroke-linejoin') || 'round',
        fill:        'none',
        dataLayer:   el.attr('data-layer'),
        transform:   null,
    };
    // Replace the original with the first segment; emit any extra
    // segments as new siblings so each gets its own undo / select handle.
    const firstD = _pointsToPathD(segments[0]);
    const newFirst = _replaceWithPath(editor, el, firstD, style);
    for (let i = 1; i < segments.length; i++) {
        const d = _pointsToPathD(segments[i]);
        if (!d) continue;
        const sibling = _appendPath(editor, d, style);
        if (newFirst && sibling) {
            try { sibling.insertAfter(newFirst); } catch (_) {}
        }
    }
    return true;
}


// ─── Geometry helpers ────────────────────────────────────────────

/** Build a closed polygon ring (list of {x,y}) tracing the fat outline
 *  of a freehand stroke `pts` of width `w`. Round caps on each end. */
function _buildFatPolygon(pts, w) {
    if (!pts || pts.length < 2) return null;
    const half = Math.max(w * 0.5, 1e-4);

    const leftBank  = [];
    const rightBank = [];
    for (let i = 0; i < pts.length; i++) {
        let dx, dy;
        if (i === 0)                  { dx = pts[1].x - pts[0].x;       dy = pts[1].y - pts[0].y; }
        else if (i === pts.length - 1) { dx = pts[i].x - pts[i-1].x;     dy = pts[i].y - pts[i-1].y; }
        else                           { dx = pts[i+1].x - pts[i-1].x;   dy = pts[i+1].y - pts[i-1].y; }
        const mag = Math.hypot(dx, dy) || 1;
        const nx = -dy / mag;
        const ny =  dx / mag;
        leftBank.push({  x: pts[i].x + nx * half, y: pts[i].y + ny * half });
        rightBank.push({ x: pts[i].x - nx * half, y: pts[i].y - ny * half });
    }

    // Round end-caps: 8-segment arcs at each tip.
    const startCap = _arcCap(pts[0],            pts[1],            half, true);
    const endCap   = _arcCap(pts[pts.length-1], pts[pts.length-2], half, false);

    // Stitch: [start-cap] → [left bank] → [end-cap] → [right bank reversed]
    const loop = [];
    for (const p of startCap)  loop.push(p);
    for (const p of leftBank)  loop.push(p);
    for (const p of endCap)    loop.push(p);
    for (let i = rightBank.length - 1; i >= 0; i--) loop.push(rightBank[i]);
    return loop.map(p => [p.x, p.y]);
}

function _arcCap(tip, neighbor, radius, isStart) {
    // Direction from neighbor → tip (so the cap arcs outward at the tip).
    const baseAng = Math.atan2(tip.y - neighbor.y, tip.x - neighbor.x);
    const out = [];
    // Sweep 180° centred on baseAng. isStart and end-cap go opposite ways,
    // but since we stitch end-cap between the left + reversed right banks
    // the orientation works out by reversing the sweep at the start.
    const dir = isStart ? -1 : 1;
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI;
        const ang = baseAng + dir * (Math.PI / 2 + t);
        out.push({ x: tip.x + Math.cos(ang) * radius, y: tip.y + Math.sin(ang) * radius });
    }
    return out;
}

/**
 * Sample a sketch element into a polyline of world-space {x,y} points.
 * Uses getTotalLength + getPointAtLength (same approach as
 * editor-expand-shape), then bakes the element's transform matrix
 * onto each sample.
 */
function _sampleElement(el) {
    const node = el.node;
    if (!node || typeof node.getTotalLength !== 'function') return null;
    let len;
    try { len = node.getTotalLength(); } catch (_) { return null; }
    if (!Number.isFinite(len) || len <= 0) return null;

    const step = SAMPLE_STEP_IN_MODEL;
    const n = Math.max(8, Math.ceil(len / step));

    const m = (typeof el.matrix === 'function') ? el.matrix() : null;
    const hasT = m && typeof m.a === 'number' && !(
        m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0
    );

    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = (i / n) * len;
        let pt;
        try { pt = node.getPointAtLength(t); } catch (_) { return pts.length ? pts : null; }
        if (hasT && typeof SVG !== 'undefined' && SVG.Point) {
            const w = new SVG.Point(pt.x, pt.y).transform(m);
            pts.push({ x: w.x, y: w.y });
        } else if (hasT) {
            pts.push({ x: m.a*pt.x + m.c*pt.y + m.e, y: m.b*pt.x + m.d*pt.y + m.f });
        } else {
            pts.push({ x: pt.x, y: pt.y });
        }
    }
    return pts;
}

function _isClosedShape(el) {
    const t = el.type;
    if (t === 'rect' || t === 'circle' || t === 'ellipse' || t === 'polygon') return true;
    if (t === 'path') return /[zZ]\s*$/.test(el.attr('d') || '');
    return false;
}

/** Point-in-polygon via ray casting. Ring is [[x,y], ...]. */
function _pointInRing(pt, ring) {
    let inside = false;
    const x = pt.x, y = pt.y;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

/** Cheap AABB intersection check between a {x,y} sample list and a
 *  ring of [x,y] arrays. */
function _bboxesIntersect(samplePts, ring) {
    let aMinX = Infinity, aMaxX = -Infinity, aMinY = Infinity, aMaxY = -Infinity;
    for (const p of samplePts) {
        if (p.x < aMinX) aMinX = p.x;
        if (p.x > aMaxX) aMaxX = p.x;
        if (p.y < aMinY) aMinY = p.y;
        if (p.y > aMaxY) aMaxY = p.y;
    }
    let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
    for (const r of ring) {
        if (r[0] < bMinX) bMinX = r[0];
        if (r[0] > bMaxX) bMaxX = r[0];
        if (r[1] < bMinY) bMinY = r[1];
        if (r[1] > bMaxY) bMaxY = r[1];
    }
    return !(bMaxX < aMinX || bMinX > aMaxX || bMaxY < aMinY || bMinY > aMaxY);
}

function _pointsToPathD(pts) {
    if (!pts || pts.length < 2) return '';
    let s = `M ${pts[0].x.toFixed(3)} ${pts[0].y.toFixed(3)}`;
    for (let i = 1; i < pts.length; i++) {
        s += ` L ${pts[i].x.toFixed(3)} ${pts[i].y.toFixed(3)}`;
    }
    return s;
}


// ─── DOM helpers ──────────────────────────────────────────────────

/**
 * Replace `oldEl` in the sketch layer with a fresh <path> carrying
 * `d` plus the given attributes. Preserves z-order via insertAfter,
 * then removes the original. Returns the new path.
 */
function _replaceWithPath(editor, oldEl, d, style) {
    const parent = oldEl.parent() || editor._sketchLayer;
    const np = parent.path(d);
    _applyStyle(np, style);

    try { np.insertAfter(oldEl); } catch (_) {}
    oldEl.remove();
    return np;
}

/** Append a fresh <path> to the sketch layer with the given style. */
function _appendPath(editor, d, style) {
    const np = editor._sketchLayer.path(d);
    _applyStyle(np, style);
    return np;
}

/** Apply a normalized style object to a path element. Centralized so
 *  filled-replacement and open-stroke-replacement can share the
 *  same attribute-mapping (stroke colour, width, linecap, linejoin,
 *  fill, fill-rule, layer, transform reset). */
function _applyStyle(pathEl, style) {
    const stroke = { color: style.stroke || '#000000' };
    const sw = style.strokeWidth != null ? parseFloat(style.strokeWidth) : null;
    if (sw != null && Number.isFinite(sw)) stroke.width = sw;
    // Endcap / linejoin preservation. Falls through to round when the
    // caller hasn't specified — open-stroke replacement always sets
    // these from the original element; the filled-replacement path
    // leaves them undefined since the result is fill-only.
    if (style.strokeLinecap)  stroke.linecap  = style.strokeLinecap;
    if (style.strokeLinejoin) stroke.linejoin = style.strokeLinejoin;

    pathEl.fill(style.fill || '#000000').stroke(stroke);
    if (style.fill && style.fill !== 'none' && style.fillRule) {
        pathEl.attr('fill-rule', style.fillRule);
    }
    if (style.dataLayer != null)   pathEl.attr('data-layer', style.dataLayer);
    if (style.transform === null)  pathEl.attr('transform', null);
}

/** Read a CSS property off the element's inline style. SVG.js's
 *  .attr() doesn't see CSS-styled stroke-linecap/-linejoin, so we
 *  consult the DOM node when the attribute is missing. */
function _nodeStyleProp(el, prop) {
    try {
        const node = el.node;
        if (node && node.style && node.style[_camel(prop)]) return node.style[_camel(prop)];
    } catch (_) {}
    return null;
}

function _camel(kebab) {
    return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Resolve the eraser width — for now we ride the editor's stroke
 *  width so the existing sidebar input controls eraser size too.
 *  A dedicated slider can be wired here later. */
function _eraserWidth(editor) {
    return Number(editor._eraserWidth) || Number(editor._strokeWidth) || 0.5;
}
