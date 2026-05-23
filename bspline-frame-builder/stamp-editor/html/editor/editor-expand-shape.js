/**
 * Expand strategy 2: geometric stroke offset for vector shapes.
 *
 * Open shapes (path / polyline / line) get a stroke offset with round
 * start/end caps, then a polygon-clipping union pass to dissolve any
 * self-intersections from a self-crossing input stroke.
 *
 * Closed shapes (rect / circle / ellipse / polygon, or a path whose d
 * ends in Z) build inner + outer offsets, then a polygon-clipping
 * difference produces a clean annular ring.
 *
 * Filled shapes (fill not equal to none) fall through to the trace
 * strategy. The geometric offset here is for stroke-to-fill conversion.
 *
 * Returns true if it produced a path and replaced the original element,
 * false otherwise (orchestrator falls through to the trace strategy).
 *
 * If polygon-clipping fails to load, the function falls back to
 * emitting the raw even-odd path so the editor stays useful.
 */
import { fusLog } from '../core/fusion-bridge.js';
import { commitExpandedPath } from './editor-expand-commit.js';

// Dynamic-loaded so a missing editor-expand-union.js cannot break the
// editor module chain at panel boot. The first expand call resolves
// the import; subsequent calls hit the cached promise.
let _unionMod = null;
let _unionModPromise = null;
function _loadUnionMod() {
    if (_unionMod) return _unionMod;
    if (_unionModPromise) return _unionModPromise;
    _unionModPromise = import('./editor-expand-union.js')
        .then(function (mod) { _unionMod = mod; return mod; })
        .catch(function (e) {
            try { fusLog('[EXPAND-SHAPE] union module load failed: ' + e.message); } catch (_) {}
            return null;
        });
    return _unionModPromise;
}

const OPEN_SHAPES = ['path', 'polyline', 'line'];
const CLOSED_SHAPES = ['rect', 'circle', 'ellipse', 'polygon'];

function _xLog(msg) {
    if (typeof window !== 'undefined' && window.__editorDebug === 'EXPAND-SHAPE') {
        try { console.log('[EXPAND-SHAPE] ' + msg); } catch (_) {}
    }
    try { fusLog('[EXPAND-SHAPE] ' + msg); } catch (_) {}
}

export async function expandShape(editor, el, options) {
    const opts = options || {};
    const commit = opts.commit !== false;
    _xLog('entry  type=' + (el && el.type) + '  data-layer="' + (el && el.attr && el.attr('data-layer')) + '"');
    if (!OPEN_SHAPES.includes(el.type) && !CLOSED_SHAPES.includes(el.type)) {
        _xLog('skip: type not in OPEN or CLOSED sets');
        return false;
    }

    const fill = (el.attr('fill') || '').toLowerCase();
    const isFilled = fill && fill !== 'none' && fill !== 'transparent';
    if (isFilled) {
        _xLog('skip: filled -> trace fallback');
        return false;
    }

    const sw = parseFloat(el.attr('stroke-width')) || 0.5;
    const matrix = el.matrix();
    const isClosed = CLOSED_SHAPES.includes(el.type) ||
        (el.type === 'path' && /[zZ]\s*$/.test(el.attr('d') || ''));
    _xLog('computing offsets  sw=' + sw + '  isClosed=' + isClosed);

    const offsets = expandGeometric(editor, el, sw, matrix, isClosed);
    if (!offsets) {
        _xLog('offsets returned null -> trace fallback');
        return false;
    }
    _xLog('offsets kind=' + offsets.kind +
          ' loopPts=' + (offsets.loop ? offsets.loop.length : 'N/A') +
          ' outerPts=' + (offsets.outer ? offsets.outer.length : 'N/A') +
          ' innerPts=' + (offsets.inner ? offsets.inner.length : 'N/A'));

    const unionMod = await _loadUnionMod();

    let geoD = null;
    let geoDSource = 'none';
    if (offsets.kind === 'open') {
        if (unionMod && unionMod.unionSelfIntersecting) {
            geoD = await unionMod.unionSelfIntersecting(offsets.loop);
            if (geoD) geoDSource = 'open-union';
        }
        if (!geoD) {
            geoD = ringToPathData(offsets.loop);
            geoDSource = 'open-fallback';
        }
    } else if (offsets.kind === 'closed') {
        if (unionMod && unionMod.differenceForAnnulus) {
            geoD = await unionMod.differenceForAnnulus(offsets.outer, offsets.inner);
            if (geoD) geoDSource = 'closed-diff';
        }
        if (!geoD) {
            geoD = ringToPathData(offsets.outer) + ' ' + ringToPathData(offsets.inner);
            geoDSource = 'closed-fallback';
        }
    }

    if (!geoD || !geoD.trim()) {
        _xLog('geoD empty after both paths -> return false');
        return false;
    }
    _xLog('geoD OK  source=' + geoDSource + '  len=' + geoD.length);

    const expanded = commitExpandedPath(editor, el, geoD, { commit, isText: false });
    if (!expanded) {
        _xLog('commitExpandedPath returned null -> return false');
        return false;
    }
    return true;
}

function ringToPathData(points) {
    if (!points || points.length < 3) return '';
    let d = 'M ' + points[0].x.toFixed(3) + ' ' + points[0].y.toFixed(3);
    for (let i = 1; i < points.length; i++) {
        d += ' L ' + points[i].x.toFixed(3) + ' ' + points[i].y.toFixed(3);
    }
    return d + ' Z';
}

function expandGeometric(editor, el, strokeWidth, matrix, isClosed) {
    const pathNode = el.node;
    if (typeof pathNode.getTotalLength !== 'function') {
        _xLog('expandGeometric: no getTotalLength -> null');
        return null;
    }
    const length = pathNode.getTotalLength();
    if (length <= 0) {
        _xLog('expandGeometric: length non-positive -> null');
        return null;
    }

    const step = 0.02;
    const numSamples = Math.max(2, Math.ceil(length / step));
    _xLog('expandGeometric: length=' + length.toFixed(3) + '  samples=' + numSamples);

    const pts = [];
    const hasTransform = matrix && typeof matrix.a === 'number' && !(
        matrix.a === 1 && matrix.b === 0 && matrix.c === 0 &&
        matrix.d === 1 && matrix.e === 0 && matrix.f === 0
    );
    for (let i = 0; i <= numSamples; i++) {
        const t = (i / numSamples) * length;
        let pt = pathNode.getPointAtLength(t);
        if (hasTransform && typeof SVG !== 'undefined' && SVG.Point) {
            const worldPt = new SVG.Point(pt.x, pt.y).transform(matrix);
            pt = { x: worldPt.x, y: worldPt.y };
        }
        pts.push(pt);
    }

    const halfWidth = strokeWidth / 2;

    if (isClosed) {
        const last = pts[pts.length - 1];
        const first = pts[0];
        if (Math.hypot(last.x - first.x, last.y - first.y) < step) pts.pop();

        const N = pts.length;
        const outer = [];
        const inner = [];
        for (let i = 0; i < N; i++) {
            const prev = pts[(i - 1 + N) % N];
            const next = pts[(i + 1) % N];
            const dx = next.x - prev.x;
            const dy = next.y - prev.y;
            const mag = Math.hypot(dx, dy) || 1;
            const nx = -dy / mag;
            const ny = dx / mag;
            outer.push({ x: pts[i].x + nx * halfWidth, y: pts[i].y + ny * halfWidth });
            inner.push({ x: pts[i].x - nx * halfWidth, y: pts[i].y - ny * halfWidth });
        }

        return { kind: 'closed', outer: outer, inner: inner };
    }

    const leftBank = [];
    const rightBank = [];
    for (let i = 0; i < pts.length; i++) {
        let dx, dy;
        if (i === 0) { dx = pts[1].x - pts[0].x; dy = pts[1].y - pts[0].y; }
        else if (i === pts.length - 1) { dx = pts[i].x - pts[i-1].x; dy = pts[i].y - pts[i-1].y; }
        else { dx = pts[i+1].x - pts[i-1].x; dy = pts[i+1].y - pts[i-1].y; }
        const mag = Math.hypot(dx, dy) || 1;
        const nx = -dy / mag;
        const ny = dx / mag;
        leftBank.push({ x: pts[i].x + nx * halfWidth, y: pts[i].y + ny * halfWidth });
        rightBank.push({ x: pts[i].x - nx * halfWidth, y: pts[i].y - ny * halfWidth });
    }

    const startCap = [];
    const startP = pts[0];
    const startNext = pts[1];
    const baseAngle = Math.atan2(startNext.y - startP.y, startNext.x - startP.x);
    for (let a = 0; a <= Math.PI; a += Math.PI / 8) {
        const ang = baseAngle - Math.PI / 2 - a;
        startCap.push({ x: startP.x + Math.cos(ang) * halfWidth, y: startP.y + Math.sin(ang) * halfWidth });
    }
    const endCap = [];
    const endP = pts[pts.length - 1];
    const endPrev = pts[pts.length - 2];
    const endAngle = Math.atan2(endP.y - endPrev.y, endP.x - endPrev.x);
    for (let a = 0; a <= Math.PI; a += Math.PI / 8) {
        const ang = endAngle + Math.PI / 2 - a;
        endCap.push({ x: endP.x + Math.cos(ang) * halfWidth, y: endP.y + Math.sin(ang) * halfWidth });
    }

    const loop = [];
    for (const p of startCap)  loop.push(p);
    for (const p of leftBank)  loop.push(p);
    for (const p of endCap)    loop.push(p);
    for (let i = rightBank.length - 1; i >= 0; i--) loop.push(rightBank[i]);
    return { kind: 'open', loop: loop };
}
