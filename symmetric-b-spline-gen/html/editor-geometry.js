/**
 * editor-geometry.js - path fitting, simplification, and stroke expansion for VectorEditor.
 * Includes Philip J. Schneider's Least-Squares Curve Fitting and RDP algorithm.
 */

// --- INTERNAL GEOM UTILS ---
function _add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function _sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function _mul(a, s) { return { x: a.x * s, y: a.y * s }; }
function _dot(a, b) { return (a.x * b.x + a.y * b.y); }
function _distSq(a, b) { return ((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }
function _distBetween(a, b) { return Math.sqrt(_distSq(a, b)); }
function _normalize(v) { 
    const l = Math.sqrt(v.x * v.x + v.y * v.y); 
    return l > 0 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 }; 
}

export function getDynamicTolerance(editor, px = 5) {
    if (!editor._draw) return 0.1;
    const view = editor._draw.viewbox();
    const svgEl = document.getElementById('editorSVGContainer');
    if (!svgEl) return 0.1;
    const screenWidth = svgEl.clientWidth || 800;
    return (px * view.width) / screenWidth;
}

export function fitCurve(editor, points, error) {
    if (points.length < 2) return "";
    const pts = points.map(p => ({ x: p[0], y: p[1] }));
    const tan1 = _normalize(_sub(pts[1], pts[0]));
    const lastIdx = pts.length - 1;
    const tan2 = _normalize(_sub(pts[lastIdx - 1], pts[lastIdx]));
    
    const segments = [];
    fitRecursive(pts, 0, lastIdx, tan1, tan2, error, segments);
    
    let d = `M ${pts[0].x.toFixed(3)},${pts[0].y.toFixed(3)}`;
    segments.forEach(seg => {
        d += ` C ${seg[1].x.toFixed(3)},${seg[1].y.toFixed(3)} ${seg[2].x.toFixed(3)},${seg[2].y.toFixed(3)} ${seg[3].x.toFixed(3)},${seg[3].y.toFixed(3)}`;
    });
    return d;
}

function fitRecursive(pts, first, last, tan1, tan2, error, segments) {
    const n = last - first + 1;
    if (n === 2) {
        const dist = _distBetween(pts[first], pts[last]) / 3.0;
        const b = [
            pts[first],
            _add(pts[first], _mul(tan1, dist)),
            _add(pts[last], _mul(tan2, dist)),
            pts[last]
        ];
        segments.push(b);
        return;
    }

    let u = [0];
    for (let i = 1; i < n; i++) u.push(u[i-1] + _distBetween(pts[first+i], pts[first+i-1]));
    for (let i = 0; i < n; i++) u[i] /= u[n-1];

    let b = generateBezier(pts, first, last, u, tan1, tan2);
    
    let maxErr = 0, split = first;
    for (let i = 1; i < n - 1; i++) {
        const p = evalBezier(b, u[i]);
        const d = _distSq(pts[first + i], p);
        if (d > maxErr) { maxErr = d; split = first + i; }
    }

    if (maxErr < error * error) {
        segments.push(b);
    } else {
        const tanCenter = _normalize(_sub(pts[split - 1], pts[split + 1]));
        const tanCenterOpp = _mul(tanCenter, -1);
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
        C[0][0] += _dot(a1, a1); C[0][1] += _dot(a1, a2);
        C[1][0] += _dot(a1, a2); C[1][1] += _dot(a2, a2);
        const tmp = _sub(pts[first + i], _add(_mul(pts[first], o3 + 3 * u1 * o2), _mul(pts[last], u3 + 3 * u2 * o)));
        X[0] += _dot(tmp, a1); X[1] += _dot(tmp, a2);
    }
    const det = C[0][0] * C[1][1] - C[1][0] * C[0][1];
    let alpha1, alpha2;
    if (Math.abs(det) < 1e-10) {
        const dist = _distBetween(pts[first], pts[last]) / 3;
        alpha1 = alpha2 = dist;
    } else {
        alpha1 = (X[0] * C[1][1] - X[1] * C[0][1]) / det;
        alpha2 = (C[0][0] * X[1] - C[1][0] * X[0]) / det;
    }
    if (alpha1 < 1e-6 || alpha2 < 1e-6) {
        const dist = _distBetween(pts[first], pts[last]) / 3;
        alpha1 = alpha2 = dist;
    }
    return [pts[first], _add(pts[first], _mul(tan1, alpha1)), _add(pts[last], _mul(tan2, alpha2)), pts[last]];
}

function evalBezier(b, t) {
    const o = 1 - t;
    return _add(_add(_mul(b[0], o*o*o), _mul(b[1], 3*t*o*o)), _add(_mul(b[2], 3*t*t*o), _mul(b[3], t*t*t)));
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
    } else {
        return [points[0], points[end]];
    }
}

export function getPointLineDist(pt, a, b) {
    const p = Array.isArray(pt) ? {x:pt[0], y:pt[1]} : pt;
    const p1 = Array.isArray(a) ? {x:a[0], y:a[1]} : a;
    const p2 = Array.isArray(b) ? {x:b[0], y:b[1]} : b;
    
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const l2 = dx*dx + dy*dy;
    if (l2 === 0) return _distBetween(p, p1);
    
    let t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return _distBetween(p, { x: p1.x + t * dx, y: p1.y + t * dy });
}

export function getHybridBezierPath(points, isClosed = false, cornerAngleThreshold = 95) {
    if (points.length < 2) return "";
    if (points.length === 2) return `M ${points[0][0].toFixed(3)},${points[0][1].toFixed(3)} L ${points[1][0].toFixed(3)},${points[1][1].toFixed(3)}`;
    const getPt = (idx) => points[(idx + points.length) % points.length];
    const getAngle = (idx) => {
        const p1 = getPt(idx - 1), p2 = getPt(idx), p3 = getPt(idx + 1);
        const v1 = [p2[0]-p1[0], p2[1]-p1[1]], v2 = [p3[0]-p2[0], p3[1]-p2[1]];
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

export function getNodes(el) {
    const pts = [];
    if (el.type === 'line') {
        pts.push({ x: el.attr('x1'), y: el.attr('y1') });
        pts.push({ x: el.attr('x2'), y: el.attr('y2') });
    } else if (el.type === 'polyline' || el.type === 'polygon') {
        el.array().forEach(p => pts.push({ x: p[0], y: p[1] }));
    } else if (el.type === 'path') {
        el.array().forEach(seg => {
            const type = seg[0];
            if (type === 'M' || type === 'L') {
                pts.push({ x: seg[1], y: seg[2] });
            } else if (type === 'C') {
                pts.push({ x: seg[5], y: seg[6] });
            } else if (type === 'Q') {
                pts.push({ x: seg[3], y: seg[4] });
            }
        });
    } else if (el.type === 'rect') {
        const x = el.attr('x'), y = el.attr('y'), w = el.attr('width'), h = el.attr('height');
        pts.push({ x: x, y: y }); pts.push({ x: x + w, y: y });
        pts.push({ x: x + w, y: y + h }); pts.push({ x: x, y: y + h });
    } else if (el.type === 'circle' || el.type === 'ellipse') {
        pts.push({ x: el.attr('cx'), y: el.attr('cy') });
    }
    return pts;
}

export function getNearbyElement(editor, pt, tol = 0.1) {
    if (!editor._sketchLayer) return null;
    let bestEl = null;
    let bestDistSq = Infinity;

    editor._sketchLayer.children().toArray().forEach(el => {
        const b = el.bbox();
        const sw = parseFloat(el.attr('stroke-width')) || editor._strokeWidth || 0.01;
        const buffer = tol + (sw / 2);
        
        if (pt.x >= b.x - buffer && pt.x <= b.x2 + buffer &&
            pt.y >= b.y - buffer && pt.y <= b.y2 + buffer) {
            const cx = (b.x + b.x2) / 2;
            const cy = (b.y + b.y2) / 2;
            const dSq = (pt.x - cx) ** 2 + (pt.y - cy) ** 2;
            if (dSq < bestDistSq) { bestDistSq = dSq; bestEl = el; }
        }
    });

    return bestEl;
}

// Lazy-load canvg v3 (ESM) to match modular loader in stamp.js
let _CanvgClass = null;
async function _loadCanvg() {
    if (_CanvgClass) return _CanvgClass;
    try {
        const mod = await import('https://esm.sh/canvg@3');
        _CanvgClass = mod.Canvg || mod.default?.Canvg || mod.default;
        return _CanvgClass || null;
    } catch (e) {
        console.error('[EXPAND] Failed to dynamically load canvg v3:', e);
        return null;
    }
}

export async function expandCurrent(editor) {
    if (!editor._selectedElement) return;
    const el = editor._selectedElement;
    
    // v40: Expansion Logic (Stroke-to-Fill conversion)
    // Renders the element to a hidden canvas, traces alpha edges, and fits a path.
    const bbox = el.bbox();
    const pad = 0.5; // inch padding for the trace region
    const wIn = bbox.w + pad * 2;
    const hIn = bbox.h + pad * 2;
    
    const canvas = document.createElement('canvas');
    // v41: Dynamic resolution based on physical size (Target 150 DPI)
    const displaySize = Math.max(512, Math.min(2048, Math.round(wIn * 150)));
    canvas.width = displaySize;
    canvas.height = displaySize;
    const ctx = canvas.getContext('2d');
    
    // Prepare isolated SVG for just this element
    const svgStr = el.attr('data-original-svg') || el.svg();
    const canvgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${displaySize}" height="${displaySize}" viewBox="${bbox.x - pad} ${bbox.y - pad} ${wIn} ${hIn}">${svgStr}</svg>`;
    
    const Canvg = await _loadCanvg();
    if (!Canvg) {
        console.error("[EXPAND] canvg library NOT available");
        return;
    }

    try {
        const v = await Canvg.fromString(ctx, canvgText);
        await v.render();
        
        const img = ctx.getImageData(0, 0, displaySize, displaySize).data;
        const pts = [];
        const threshold = 127;
        
        // Edge detector
        for (let y = 1; y < displaySize - 1; y += 1) {
            for (let x = 1; x < displaySize - 1; x += 1) {
                const i = (y * displaySize + x) * 4 + 3;
                if (img[i] > threshold) {
                    const top = ((y-1)*displaySize + x)*4 + 3;
                    const bot = ((y+1)*displaySize + x)*4 + 3;
                    const left = (y*displaySize + x-1)*4 + 3;
                    const right = (y*displaySize + x+1)*4 + 3;
                    if (img[top] <= threshold || img[bot] <= threshold || img[left] <= threshold || img[right] <= threshold) {
                        pts.push([
                            (bbox.x - pad) + (x / displaySize) * wIn,
                            (bbox.y - pad) + (y / displaySize) * hIn
                        ]);
                    }
                }
            }
        }
        
        if (pts.length < 3) {
            console.warn("[EXPAND] No edges detected in trace.");
            return;
        }

        const subpaths = [];
        let curr = pts.shift();
        let currentPath = [curr];
        const pixelScaleX = wIn / displaySize;
        const pixelScaleY = hIn / displaySize;
        const maxDistSq = (pixelScaleX * pixelScaleX + pixelScaleY * pixelScaleY) * 16; 

        while (pts.length > 0) {
            let bestIdx = -1;
            let bestDist = Infinity;
            for (let i = 0; i < Math.min(pts.length, 1000); i++) {
                const d = (pts[i][0] - curr[0])**2 + (pts[i][1] - curr[1])**2;
                if (d < bestDist) { bestDist = d; bestIdx = i; }
            }
            if (bestIdx === -1) bestIdx = 0;
            
            curr = pts.splice(bestIdx, 1)[0];
            if (bestDist > maxDistSq) {
                subpaths.push(currentPath);
                currentPath = [curr];
            } else {
                currentPath.push(curr);
            }
        }
        if (currentPath.length > 2) subpaths.push(currentPath);
        
        let pathData = "";
        const tol = getDynamicTolerance(editor, 2.0);
        for (const sp of subpaths) {
            if (sp.length < 3) continue;
            const pruned = ramerDouglasPeucker(sp, tol);
            const cData = fitCurve(editor, pruned, tol * 2.1);
            if (cData) pathData += cData + " ";
        }
        
        if (pathData) {
            const layer = el.attr('data-layer') || "0";
            const expanded = editor._sketchLayer.path(pathData)
                .fill(editor._strokeColor)
                .stroke('none')
                .attr('data-layer', layer);
            
            // Link to original data for future refinement if possible
            expanded.attr('data-original-svg', el.attr('data-original-svg') || el.svg());
            
            el.remove();
            editor._select(expanded);
            if (editor.pushState) editor.pushState();
        }
    } catch (err) {
        console.error("[EXPAND] Trace failure:", err);
    }
}
