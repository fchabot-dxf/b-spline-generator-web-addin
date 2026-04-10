
/**
 * editor-geometry.js - path fitting, simplification, and stroke expansion for VectorEditor.
 * Includes Philip J. Schneider's Least-Squares Curve Fitting and RDP algorithm.
 */

/**
 * editor-geometry.js - path fitting, simplification, and stroke expansion for VectorEditor.
 * Includes Philip J. Schneider's Least-Squares Curve Fitting and RDP algorithm.
 */
if (window && window.console) {
    console.log('[COORD_STD] editor-geometry.js loaded!');
}
import { COORD_SYSTEM } from './coords.js';

const FONT_MAP = {
    "Arial": "arial.ttf",
    "Tahoma": "tahoma.ttf",
    "Verdana": "verdana.ttf",
    "Bahnschrift": "bahnschrift.ttf",
    "Impact": "impact.ttf",
    "Georgia": "georgia.ttf",
    "Times New Roman": "times.ttf",
    "Courier New": "courier.ttf",
    "Cascadia Code": "CascadiaCode-Regular.ttf",
    "Cascadia Mono": "CascadiaMono-Regular.ttf",
    "Marlett": "marlett.ttf",
    "Symbol": "symbol.ttf",
    "Webdings": "webdings.ttf",
    "Wingdings": "wingdings.ttf",
    "Segoe UI Symbol": "segoe-symbols.ttf",
    "Segoe MDL2 Assets": "segoe-mdl2.ttf",
    "Segoe Fluent Icons": "segoe-fluent-icons.ttf",
    "Segoe UI Emoji": "segoe-emoji.ttf"
};

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
    // Log before converting points for export
    if (window && window.console) {
        console.log(`[COORD_STD] fitCurve: Converting ${points.length} points for export`);
        points.forEach((p, i) => {
            const orig = { x: p[0], y: p[1] };
            const phys = COORD_SYSTEM.toPhysical(orig.x, orig.y);
            console.log(`[COORD_STD] fitCurve: pt${i} UI (${orig.x},${orig.y}) -> Physical (${phys.x},${phys.y})`);
        });
    }
    const pts = points.map(p => ({ x: p[0], y: p[1] }));
    const tan1 = _normalize(_sub(pts[1], pts[0]));
    const lastIdx = pts.length - 1;
    const tan2 = _normalize(_sub(pts[lastIdx - 1], pts[lastIdx]));
    
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
    const len = _distBetween(a, d);
    if (len < 1e-6) return true;
    return getPointLineDist(seg[1], a, d) <= tolerance && getPointLineDist(seg[2], a, d) <= tolerance;
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
    if (window && window.console) {
        points.forEach((p, i) => {
            const orig = { x: p[0], y: p[1] };
            const phys = COORD_SYSTEM.toPhysical(orig.x, orig.y);
            console.log(`[COORD_STD] getHybridBezierPath: pt${i} UI (${orig.x},${orig.y}) -> Physical (${phys.x},${phys.y})`);
        });
    }
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

function _transformPoint(el, pt) {
    if (!el || !el.node || !el.node.ownerSVGElement || typeof el.node.getCTM !== 'function') return pt;
    try {
        const svg = el.node.ownerSVGElement;
        const svgPt = svg.createSVGPoint();
        svgPt.x = pt.x;
        svgPt.y = pt.y;
        const matrix = el.node.getCTM();
        if (!matrix) return pt;
        const transformed = svgPt.matrixTransform(matrix);
        return { x: transformed.x, y: transformed.y };
    } catch (err) {
        return pt;
    }
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
    return pts.map(pt => _transformPoint(el, pt));
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

export async function expandCurrent(editor, detail = 1.0, simplify = 15, accuracy = 1.0, commit = true) {
    if (!editor._selectedElement) return;
    const el = editor._selectedElement;
    
    // Step 1: Text Elements (Opentype.js Fast-Path)
    if (el.type === 'text') {
        const fontFamily = el.attr('font-family') || "Arial";
        const fontSize = parseFloat(el.attr('font-size') || '3.0');
        const contentNodes = el.node.childNodes;
        let rawContent = "";
        contentNodes.forEach(node => { if (node.nodeType === 3) rawContent += node.nodeValue; else if (node.nodeName === 'tspan') rawContent += node.textContent; });
        if (!rawContent) rawContent = el.text() || "";
        
        const fontFile = FONT_MAP[fontFamily];
        if (fontFile) {
            try {
                const opentype = await import('https://esm.sh/opentype.js');
                const font = await opentype.load(`${window.location.origin}/fonts/${fontFile}`);
                if (font) {
                    const ascentUnits = font.tables.os2?.sTypoAscender || font.tables.hhea?.ascender || font.ascender;
                    const scale = (1 / font.unitsPerEm) * fontSize;
                    const ascender = ascentUnits * scale;
                    
                    const matrix = el.transform();
                    const localX = el.x();
                    const localBaselineY = el.y() + (el.attr('dominant-baseline') === 'hanging' ? ascender : 0);
                    
                    // Step 1.1: Generate raw path data in LOCAL space
                    const pathData = font.getPath(rawContent, localX, localBaselineY, fontSize);
                    let d = pathData.toPathData(2); 

                    const layer = el.attr('data-layer') || "0";
                    const expanded = editor._sketchLayer.path(d)
                        .fill('#000000')
                        .stroke('none')
                        .attr('fill-rule', 'evenodd')
                        .attr('data-layer', layer);

                    // Step 1.2: BAKE the full matrix into the path data and clear transform
                    // This ensures the geometry survives the editor's "re-open" which wipes transforms.
                    if (matrix) {
                        const bakedD = expanded.array().transform(matrix).toString();
                        expanded.plot(bakedD);
                        expanded.attr('transform', null);
                    }

                    expanded.attr('data-original-text-svg', el.attr('data-original-text-svg') || el.svg());
                    el.remove();
                    editor._select(expanded);
                    if (commit && editor.pushState) editor.pushState();
                    return; 
                }
            } catch (e) {
                console.warn("[EXPAND] Opentype.js failed. Falling back to trace.", e);
            }
        }
    }

    // Step 2: Vector Shapes (Geometric Math Fast-Path)
    if (el.type === 'path' || el.type === 'polyline' || el.type === 'line') {
        const sw = parseFloat(el.attr('stroke-width')) || 0.5;
        const matrix = el.transform(); // Get current element transform
        const geoD = expandGeometric(editor, el, sw, matrix);
        if (geoD) {
            const layer = el.attr('data-layer') || "0";
            const expanded = editor._sketchLayer.path(geoD)
                .fill('#000000')
                .stroke('none')
                .attr('fill-rule', 'evenodd')
                .attr('data-layer', layer);
            
            // Clear transform as it's now baked into geoD
            expanded.attr('transform', null);
            expanded.attr('data-original-svg', el.svg());
            el.remove();
            editor._select(expanded);
            if (commit && editor.pushState) editor.pushState();
            return; 
        }
    }

    // Step 3: Fallback Tracing (for complex elements/images)
    const bbox = el.bbox();
    const pad = 0.5; 
    const wIn = bbox.w + pad * 2;
    const hIn = bbox.h + pad * 2;
    const canvas = document.createElement('canvas');
    const canvasW = Math.max(256, Math.min(3072, Math.round(wIn * 260)));
    const canvasH = Math.max(256, Math.min(3072, Math.round(hIn * 260)));
    canvas.width = canvasW; canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    
    // Prepare isolated SVG for just this element.
    // If the element has been moved via transform, preserve that transform when tracing.
    const rawSvg = el.attr('data-original-text-svg') || el.attr('data-original-svg') || el.svg();
    const transformAttr = el.attr('transform');
    const svgContent = rawSvg.replace(/\s+svgjs:[^=]+="[^"]*"/g, '');
    const transformedContent = transformAttr ? `<g transform="${transformAttr}">${svgContent}</g>` : svgContent;
    const canvgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" preserveAspectRatio="none" viewBox="${bbox.x - pad} ${bbox.y - pad} ${wIn} ${hIn}">${transformedContent}</svg>`;
    
    const Canvg = await _loadCanvg();
    if (!Canvg) {
        console.error("[EXPAND] canvg library NOT available");
        return;
    }

    try {
        const v = await Canvg.fromString(ctx, canvgText);
        await v.render();
        
        const img = ctx.getImageData(0, 0, canvasW, canvasH).data;
        const threshold = 127;
        const mask = new Uint8Array(canvasW * canvasH);
        let hasPixel = false;

        for (let y = 0; y < canvasH; y++) {
            for (let x = 0; x < canvasW; x++) {
                const alpha = img[(y * canvasW + x) * 4 + 3];
                const idx = y * canvasW + x;
                mask[idx] = alpha > threshold ? 1 : 0;
                if (mask[idx]) hasPixel = true;
            }
        }

        if (!hasPixel) {
            console.warn("[EXPAND] No filled pixels detected in trace.");
            return;
        }

        const segments = new Map();
        const key = (x, y) => `${x},${y}`;
        const addSegment = (ax, ay, bx, by) => {
            const a = key(ax, ay);
            const b = key(bx, by);
            if (!segments.has(a)) segments.set(a, new Set());
            if (!segments.has(b)) segments.set(b, new Set());
            segments.get(a).add(b);
            segments.get(b).add(a);
        };
        const isFilled = (x, y) => x >= 0 && x < canvasW && y >= 0 && y < canvasH && mask[y * canvasW + x];

        for (let y = 0; y < canvasH; y++) {
            for (let x = 0; x < canvasW; x++) {
                if (!isFilled(x, y)) continue;
                if (!isFilled(x + 1, y)) addSegment(x + 1, y, x + 1, y + 1);
                if (!isFilled(x, y + 1)) addSegment(x, y + 1, x + 1, y + 1);
                if (!isFilled(x - 1, y)) addSegment(x, y, x, y + 1);
                if (!isFilled(x, y - 1)) addSegment(x, y, x + 1, y);
            }
        }

        function removeEdge(a, b) {
            const sa = segments.get(a);
            const sb = segments.get(b);
            if (sa) {
                sa.delete(b);
                if (sa.size === 0) segments.delete(a);
            }
            if (sb) {
                sb.delete(a);
                if (sb.size === 0) segments.delete(b);
            }
        }

        const loops = [];
        while (segments.size > 0) {
            const start = segments.keys().next().value;
            const loop = [start];
            let current = start;
            let previous = null;
            let safety = 0;

            while (true) {
                const neighbors = Array.from(segments.get(current) || []);
                if (neighbors.length === 0 || safety++ > canvasW * canvasH * 4) break;
                let next = neighbors[0];
                if (previous && neighbors.length > 1 && neighbors.includes(previous)) {
                    next = neighbors.find(n => n !== previous);
                }
                removeEdge(current, next);
                previous = current;
                current = next;
                if (current === start) break;
                loop.push(current);
            }
            if (loop.length > 2) {
                const coords = loop.map(pt => {
                    const [gx, gy] = pt.split(',').map(Number);
                    return [
                        (bbox.x - pad) + (gx / canvasW) * wIn,
                        (bbox.y - pad) + (gy / canvasH) * hIn
                    ];
                });
                loops.push(coords);
            }
        }

        if (loops.length === 0) {
            console.warn("[EXPAND] No contour loops extracted from trace.");
            return;
        }

        let pathData = "";
        const tol = getDynamicTolerance(editor, 1.0);
        const simplifyLevel = Math.max(1, Math.min(500, simplify));
        const simplifyFactor = Math.sqrt(simplifyLevel / 15);
        const accuracyFactor = Math.max(0.5, Math.min(2.0, accuracy));
        const simpTol = Math.max(0.05, tol * 0.5 / density * simplifyFactor / accuracyFactor);
        const cornerAngle = Math.max(20, 95 / density / accuracyFactor);
        for (const loop of loops) {
            if (loop.length < 3) continue;
            const pruned = ramerDouglasPeucker(loop, simpTol);
            let cData = getHybridBezierPath(pruned, true, cornerAngle);
            if (!cData) {
                cData = fitCurve(editor, pruned, Math.max(0.1, tol * 2.0 / density * simplifyFactor / accuracyFactor));
            }
            cData = cData.trim();
            if (cData && !cData.endsWith('Z')) cData += ' Z';
            if (cData) pathData += cData + " ";
        }
        
        if (pathData) {
            const layer = el.attr('data-layer') || "0";
            const expanded = editor._sketchLayer.path(pathData)
                .fill('#000000')
                .stroke('none')
                .attr('fill-rule', 'evenodd')
                .attr('data-layer', layer);
            
            if (el.attr('data-original-text-svg')) expanded.attr('data-original-text-svg', el.attr('data-original-text-svg'));
            if (el.attr('data-original-svg')) expanded.attr('data-original-svg', el.attr('data-original-svg'));
            if (!expanded.attr('data-original-svg') && !expanded.attr('data-original-text-svg')) expanded.attr('data-original-svg', el.svg());
            
            el.remove();
            editor._select(expanded);
            if (commit && editor.pushState) editor.pushState();
        }
    } catch (err) {
        console.error("[EXPAND] Trace failure:", err);
    }
}

/**
 * Advanced Vector Expansion: Geometric Offset (Smart Stroke-to-Fill)
 * Offsets a path mathematically to create a perfect outline with round caps.
 */
function expandGeometric(editor, el, strokeWidth, matrix) {
    const pathNode = el.node;
    if (typeof pathNode.getTotalLength !== 'function') return null;
    const length = pathNode.getTotalLength();
    if (length <= 0) return null;
    
    // Sampling rate: high resolution (approx every 0.02 units)
    const step = 0.02;
    const numSamples = Math.max(2, Math.ceil(length / step));
    
    const pts = [];
    for (let i = 0; i <= numSamples; i++) {
        const t = (i / numSamples) * length;
        let pt = pathNode.getPointAtLength(t);
        
        // BAKE transform into sampled points
        if (matrix) {
            const worldPt = new editor._draw.point(pt.x, pt.y).transform(matrix);
            pt = { x: worldPt.x, y: worldPt.y };
        }
        pts.push(pt);
    }
    
    const halfWidth = strokeWidth / 2;
    const leftBank = [];
    const rightBank = [];
    for (let i = 0; i < pts.length; i++) {
        let dx, dy;
        if (i === 0) { dx = pts[1].x - pts[0].x; dy = pts[1].y - pts[0].y; }
        else if (i === pts.length - 1) { dx = pts[i].x - pts[i-1].x; dy = pts[i].y - pts[i-1].y; }
        else { dx = pts[i+1].x - pts[i-1].x; dy = pts[i+1].y - pts[i-1].y; }
        const mag = Math.hypot(dx, dy) || 1;
        const nx = -dy / mag; const ny = dx / mag;
        leftBank.push({ x: pts[i].x + nx * halfWidth, y: pts[i].y + ny * halfWidth });
        rightBank.push({ x: pts[i].x - nx * halfWidth, y: pts[i].y - ny * halfWidth });
    }
    
    const startCap = [];
    const startP = pts[0]; const startNext = pts[1];
    const baseAngle = Math.atan2(startNext.y - startP.y, startNext.x - startP.x);
    for (let a = Math.PI; a >= 0; a -= Math.PI / 8) {
        const ang = baseAngle - Math.PI / 2 - a;
        startCap.push({ x: startP.x + Math.cos(ang) * halfWidth, y: startP.y + Math.sin(ang) * halfWidth });
    }
    const endCap = [];
    const endP = pts[pts.length - 1]; const endPrev = pts[pts.length - 2];
    const endAngle = Math.atan2(endP.y - endPrev.y, endP.x - endPrev.x);
    for (let a = 0; a <= Math.PI; a += Math.PI / 8) {
        const ang = endAngle - Math.PI / 2 - a;
        endCap.push({ x: endP.x + Math.cos(ang) * halfWidth, y: endP.y + Math.sin(ang) * halfWidth });
    }
    
    let d = `M ${startCap[0].x.toFixed(3)} ${startCap[0].y.toFixed(3)}`;
    for (let i = 1; i < startCap.length; i++) d += ` L ${startCap[i].x.toFixed(3)} ${startCap[i].y.toFixed(3)}`;
    for (const p of leftBank) d += ` L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
    for (const p of endCap) d += ` L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
    for (let i = rightBank.length - 1; i >= 0; i--) d += ` L ${rightBank[i].x.toFixed(3)} ${rightBank[i].y.toFixed(3)}`;
    d += " Z";
    return d;
}
