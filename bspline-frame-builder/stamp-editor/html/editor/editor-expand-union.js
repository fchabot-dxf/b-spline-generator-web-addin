/**
 * Polygon-clipping union helper for the expand pipeline.
 *
 * Lazy-loads polygon-clipping@0.15.7 from esm.sh (mirrors the canvg
 * lazy-load in editor-expand-trace.js). The library handles
 * self-intersecting input by tessellating into a valid multipolygon —
 * which is exactly what we need to clean up self-crossing strokes
 * coming out of expandGeometric.
 *
 * If the library fails to load (offline / network blocked), callers
 * fall back to emitting the raw closed loop. In that fallback the
 * even-odd fill rule will cancel overlaps the way it did before — not
 * pretty, but never blocking the editor.
 *
 * polygon-clipping vocabulary:
 *   Ring         = closed list of [x, y] points (first ≠ last; close implied)
 *   Polygon      = [outerRing, innerRing1, innerRing2, ...]  (outer + holes)
 *   MultiPolygon = [polygon1, polygon2, ...]                 (disjoint islands)
 */
import { fusLog } from '../core/fusion-bridge.js';

let _clipperPromise = null;
let _clipper = null;

function _uLog(msg) {
    if (typeof window !== 'undefined' && window.__editorDebug === 'EXPAND-SHAPE') {
        try { console.log('[EXPAND-UNION] ' + msg); } catch (_) {}
    }
    try { fusLog('[EXPAND-UNION] ' + msg); } catch (_) {}
}

/** Load polygon-clipping once, cache the module. Concurrent callers
 *  share the same in-flight import promise. */
export async function loadClipper() {
    if (_clipper) return _clipper;
    if (_clipperPromise) return _clipperPromise;
    _clipperPromise = (async () => {
        try {
            const mod = await import('https://esm.sh/polygon-clipping@0.15.7');
            // The default export is the polygon-clipping namespace with
            // .union / .intersection / .difference / .xor methods.
            _clipper = mod.default || mod;
            if (!_clipper || typeof _clipper.union !== 'function') {
                _uLog('module loaded but union() missing — keeping null');
                _clipper = null;
            } else {
                _uLog('polygon-clipping loaded OK');
            }
            return _clipper;
        } catch (e) {
            _uLog(`load failed: ${e.message}`);
            return null;
        }
    })();
    return _clipperPromise;
}

/** Convert [{x,y}, ...] → polygon-clipping ring ([[x,y], ...]).
 *  Drops the trailing close-duplicate if present so the library
 *  doesn't see a zero-length segment. */
function pointsToRing(points) {
    if (!points || points.length < 3) return null;
    const ring = points.map(p => [p.x, p.y]);
    // Strip trailing duplicate if first ≈ last (sub-pixel tolerance).
    const a = ring[0], b = ring[ring.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) ring.pop();
    return ring.length >= 3 ? ring : null;
}

/** Serialize a polygon-clipping MultiPolygon as SVG path data.
 *  Each ring becomes a moveto+linetos+Z subpath; outer rings come
 *  before holes within a polygon. Fill-rule "evenodd" or "nonzero"
 *  both render this correctly because polygon-clipping returns
 *  consistently-oriented rings. */
export function multiPolygonToPathData(multi) {
    if (!Array.isArray(multi) || multi.length === 0) return '';
    const parts = [];
    for (const polygon of multi) {
        for (const ring of polygon) {
            if (!Array.isArray(ring) || ring.length < 3) continue;
            let s = `M ${ring[0][0].toFixed(3)} ${ring[0][1].toFixed(3)}`;
            for (let i = 1; i < ring.length; i++) {
                s += ` L ${ring[i][0].toFixed(3)} ${ring[i][1].toFixed(3)}`;
            }
            s += ' Z';
            parts.push(s);
        }
    }
    return parts.join(' ');
}

/** Resolve self-intersections in a single closed ring.
 *
 *  Pass in a sequence of {x, y} points describing a (possibly
 *  self-intersecting) closed boundary. Returns SVG path data for the
 *  cleaned-up shape: one or more outer rings + holes, all consistently
 *  oriented. The crossings are dissolved into a real topological
 *  union — no even-odd cancellation, no Swiss-cheese.
 *
 *  Returns null if polygon-clipping isn't loaded yet or the ring is
 *  degenerate. Callers should fall back to emitting raw d in that case. */
export async function unionSelfIntersecting(points) {
    const clipper = await loadClipper();
    if (!clipper) {
        _uLog('unionSelfIntersecting: no clipper, returning null');
        return null;
    }
    const ring = pointsToRing(points);
    if (!ring) {
        _uLog('unionSelfIntersecting: ring degenerate (n<3 after dedupe)');
        return null;
    }
    try {
        // union of one polygon with itself = cleanup of self-intersections.
        const result = clipper.union([[ring]]);
        const d = multiPolygonToPathData(result);
        _uLog(`unionSelfIntersecting: ringPts=${ring.length} -> dLen=${d.length}`);
        return d || null;
    } catch (e) {
        _uLog(`unionSelfIntersecting: clipper threw ${e.message}`);
        return null;
    }
}

/** Subtract `innerPts` from `outerPts` to produce an annular ring.
 *  Used by closed-shape expansion: the swept stroke region is the
 *  outer-boundary polygon with the inner-boundary polygon punched out.
 *
 *  Handles self-intersection in either input (e.g. figure-8 closed
 *  shape) because polygon-clipping normalizes during the difference op.
 *
 *  Returns null on failure; caller falls back to raw two-loop emit. */
export async function differenceForAnnulus(outerPts, innerPts) {
    const clipper = await loadClipper();
    if (!clipper) {
        _uLog('differenceForAnnulus: no clipper');
        return null;
    }
    const outerRing = pointsToRing(outerPts);
    const innerRing = pointsToRing(innerPts);
    if (!outerRing || !innerRing) {
        _uLog('differenceForAnnulus: ring(s) degenerate');
        return null;
    }
    try {
        // Step 1: union each ring with itself to dissolve any self-cross.
        const outerMulti = clipper.union([[outerRing]]);
        const innerMulti = clipper.union([[innerRing]]);
        // Step 2: difference yields the annulus.
        const result = clipper.difference(outerMulti, innerMulti);
        const d = multiPolygonToPathData(result);
        _uLog(`differenceForAnnulus: outer=${outerRing.length} inner=${innerRing.length} -> dLen=${d.length}`);
        return d || null;
    } catch (e) {
        _uLog(`differenceForAnnulus: clipper threw ${e.message}`);
        return null;
    }
}
