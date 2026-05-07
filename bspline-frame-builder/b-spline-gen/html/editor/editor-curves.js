/**
 * Curve fitting and path-data helpers for the freehand drawing tool and
 * the geometric trace fallback in expand. Includes Philip J. Schneider's
 * Least-Squares Bezier fit, Ramer–Douglas–Peucker simplification, and a
 * "hybrid" smooth path builder that uses sharp corners where the angle
 * exceeds a threshold and tangent-matched cubics elsewhere.
 */
import { COORD_SYSTEM } from '../core/coords.js';
import { add, sub, mul, dot, distSq, distBetween, normalize } from './editor-math.js';

export function fitCurve(editor, points, error) {
    if (points.length < 2) return "";
    if (window && window.console) {
        console.log(`[COORD_STD] fitCurve: Converting ${points.length} points for export`);
        points.forEach((p, i) => {
            const orig = { x: p[0], y: p[1] };
            const phys = COORD_SYSTEM.toPhysical(orig.x, orig.y);
            console.log(`[COORD_STD] fitCurve: pt${i} UI (${orig.x},${orig.y}) -> Physical (${phys.x},${phys.y})`);
        });
    }
    const pts = points.map(p => ({ x: p[0], y: p[1] }));
    const tan1 = normalize(sub(pts[1], pts[0]));
    const lastIdx = pts.length - 1;
    const tan2 = normalize(sub(pts[lastIdx - 1], pts[lastIdx]));

    const segments = [];
    fitRecursive(pts, 0, lastIdx, tan1, tan2, error, segments);

    let d = `M ${pts[0].x.toFixed(3)},${pts[0].y.toFixed(3)}`;
    const lineTolerance = Math.max(error * 0.25, 0.5);
    segments.forEach(seg => {
        if (isLinearSegment(seg, lineTolerance)) {
            d += ` L ${seg[3].x.toFixed(3)},${seg[3].y.toFixed(3)}`;
        } else {
            d += ` C ${seg[1].x.toFixed(3)},${seg[1].y.toFixed(3)} ${seg[2].x.toFixed(3)},${seg[2].y.toFixed(3)} ${seg[3].x.toFixed(3)},${seg[3].y.toFixed(3)}`;
        }
    });
    return d;
}

function isLinearSegment(seg, tolerance) {
    if (!seg || seg.length !== 4) return false;
    const a = seg[0], d = seg[3];
    const len = distBetween(a, d);
    if (len < 1e-6) return true;
    return getPointLineDist(seg[1], a, d) <= tolerance && getPointLineDist(seg[2], a, d) <= tolerance;
}

function fitRecursive(pts, first, last, tan1, tan2, error, segments) {
    const n = last - first + 1;
    if (n === 2) {
        const dist = distBetween(pts[first], pts[last]) / 3.0;
        const b = [
            pts[first],
            add(pts[first], mul(tan1, dist)),
            add(pts[last], mul(tan2, dist)),
            pts[last],
        ];
        segments.push(b);
        return;
    }

    let u = [0];
    for (let i = 1; i < n; i++) u.push(u[i - 1] + distBetween(pts[first + i], pts[first + i - 1]));
    for (let i = 0; i < n; i++) u[i] /= u[n - 1];

    let b = generateBezier(pts, first, last, u, tan1, tan2);

    let maxErr = 0, split = first;
    for (let i = 1; i < n - 1; i++) {
        const p = evalBezier(b, u[i]);
        const d = distSq(pts[first + i], p);
        if (d > maxErr) { maxErr = d; split = first + i; }
    }

    if (maxErr < error * error) {
        segments.push(b);
    } else {
        const tanCenter = normalize(sub(pts[split - 1], pts[split + 1]));
        const tanCenterOpp = mul(tanCenter, -1);
        fitRecursive(pts, first, split, tan1, tanCenter, error, segments);
        fitRecursive(pts, split, last, tanCenterOpp, tan2, error, segments);
    }
}

function generateBezier(pts, first, last, u, tan1, tan2) {
    const n = last - first + 1;
    const C = [[0, 0], [0, 0]], X = [0, 0];
    for (let i = 0; i < n; i++) {
        const u1 = u[i], u2 = u1 * u1, u3 = u2 * u1;
        const o = 1 - u1, o2 = o * o, o3 = o2 * o;
        const a1 = tan1, a2 = tan2;
        const b1 = 3 * u1 * o2, b2 = 3 * u2 * o;
        C[0][0] += dot(a1, a1); C[0][1] += dot(a1, a2);
        C[1][0] += dot(a1, a2); C[1][1] += dot(a2, a2);
        const tmp = sub(pts[first + i], add(mul(pts[first], o3 + 3 * u1 * o2), mul(pts[last], u3 + 3 * u2 * o)));
        X[0] += dot(tmp, a1); X[1] += dot(tmp, a2);
    }
    const det = C[0][0] * C[1][1] - C[1][0] * C[0][1];
    let alpha1, alpha2;
    if (Math.abs(det) < 1e-10) {
        const dist = distBetween(pts[first], pts[last]) / 3;
        alpha1 = alpha2 = dist;
    } else {
        alpha1 = (X[0] * C[1][1] - X[1] * C[0][1]) / det;
        alpha2 = (C[0][0] * X[1] - C[1][0] * X[0]) / det;
    }
    if (alpha1 < 1e-6 || alpha2 < 1e-6) {
        const dist = distBetween(pts[first], pts[last]) / 3;
        alpha1 = alpha2 = dist;
    }
    return [pts[first], add(pts[first], mul(tan1, alpha1)), add(pts[last], mul(tan2, alpha2)), pts[last]];
}

function evalBezier(b, t) {
    const o = 1 - t;
    return add(add(mul(b[0], o*o*o), mul(b[1], 3*t*o*o)), add(mul(b[2], 3*t*t*o), mul(b[3], t*t*t)));
}

export function ramerDouglasPeucker(points, epsilon) {
    if (points.length <= 2) return points;
    let dmax = 0;
    let index = 0;
    const end = points.length - 1;
    for (let i = 1; i < end; i++) {
        const d = getPointLineDist(points[i], points[0], points[end]);
        if (d > dmax) { index = i; dmax = d; }
    }
    if (dmax > epsilon) {
        const recResult1 = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
        const recResult2 = ramerDouglasPeucker(points.slice(index), epsilon);
        return recResult1.slice(0, recResult1.length - 1).concat(recResult2);
    }
    return [points[0], points[end]];
}

function getPointLineDist(pt, a, b) {
    const p  = Array.isArray(pt) ? { x: pt[0], y: pt[1] } : pt;
    const p1 = Array.isArray(a)  ? { x: a[0],  y: a[1]  } : a;
    const p2 = Array.isArray(b)  ? { x: b[0],  y: b[1]  } : b;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const l2 = dx*dx + dy*dy;
    if (l2 === 0) return distBetween(p, p1);

    let t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return distBetween(p, { x: p1.x + t * dx, y: p1.y + t * dy });
}

export function getHybridBezierPath(points, isClosed = false, cornerAngleThreshold = 95) {
    if (points.length < 2) return "";
    if (window && window.console) {
        points.forEach((p, i) => {
            const orig = { x: p[0], y: p[1] };
            const phys = COORD_SYSTEM.toPhysical(orig.x, orig.y);
            console.log(`[COORD_STD] getHybridBezierPath: pt${i} UI (${orig.x},${orig.y}) -> Physical (${phys.x},${phys.y})`);
        });
    }
    if (points.length === 2) {
        return `M ${points[0][0].toFixed(3)},${points[0][1].toFixed(3)} L ${points[1][0].toFixed(3)},${points[1][1].toFixed(3)}`;
    }
    const getPt = (idx) => points[(idx + points.length) % points.length];
    const getAngle = (idx) => {
        const p1 = getPt(idx - 1), p2 = getPt(idx), p3 = getPt(idx + 1);
        const v1 = [p2[0] - p1[0], p2[1] - p1[1]], v2 = [p3[0] - p2[0], p3[1] - p2[1]];
        const l1 = Math.sqrt(v1[0]**2 + v1[1]**2), l2 = Math.sqrt(v2[0]**2 + v2[1]**2);
        if (l1 < 0.005 || l2 < 0.005) return 0;
        const dotVal = (v1[0]*v2[0] + v1[1]*v2[1]) / (l1 * l2);
        return Math.acos(Math.min(1, Math.max(-1, dotVal))) * (180 / Math.PI);
    };
    let path = `M ${points[0][0].toFixed(3)},${points[0][1].toFixed(3)}`;
    const limit = isClosed ? points.length : points.length - 1;
    for (let i = 0; i < limit; i++) {
        const p1 = getPt(i);
        const p2 = getPt(i + 1);
        const a1 = getAngle(i), a2 = getAngle(i + 1);
        const isSharp = (a1 > cornerAngleThreshold || a2 > cornerAngleThreshold);
        if (isSharp) {
            path += ` L ${p2[0].toFixed(3)},${p2[1].toFixed(3)}`;
        } else {
            const p0 = getPt(i - 1), p3 = getPt(i + 2);
            const segLen = Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2);
            let t1x = (p2[0] - p0[0]) / 6, t1y = (p2[1] - p0[1]) / 6;
            let t2x = (p3[0] - p1[0]) / 6, t2y = (p3[1] - p1[1]) / 6;
            const t1len = Math.sqrt(t1x * t1x + t1y * t1y);
            if (t1len > segLen) { t1x *= segLen / t1len; t1y *= segLen / t1len; }
            const t2len = Math.sqrt(t2x * t2x + t2y * t2y);
            if (t2len > segLen) { t2x *= segLen / t2len; t2y *= segLen / t2len; }
            const cp1x = p1[0] + t1x, cp1y = p1[1] + t1y;
            const cp2x = p2[0] - t2x, cp2y = p2[1] - t2y;
            path += ` C ${cp1x.toFixed(3)},${cp1y.toFixed(3)} ${cp2x.toFixed(3)},${cp2y.toFixed(3)} ${p2[0].toFixed(3)},${p2[1].toFixed(3)}`;
        }
    }
    if (isClosed) path += ' Z';
    return path;
}
