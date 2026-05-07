/**
 * "Expand" turns a selected element into a filled outline path.
 * Three strategies, tried in order:
 *
 *   1. Text → opentype.js fast path. Generates the glyph outline from
 *      the bundled .ttf, bakes the element's transform + (x, y) anchor
 *      into the path data, replaces the <text> with a <path>.
 *
 *   2. Path/polyline/line → geometric stroke offset. Samples the path,
 *      builds parallel offset banks at ±strokeWidth/2, joins them with
 *      round end caps. Bakes any transform into the offset coords.
 *
 *   3. Anything else → canvg trace fallback. Rasterizes the element to
 *      a canvas, walks the alpha mask to extract contour loops, then
 *      pipes those loops through RDP simplification + the hybrid
 *      bezier path builder.
 */
import { stripSvgjsAttributes } from '../core/svg-utils.js';
import { FONT_MAP } from './editor-fonts.js';
import { fitCurve, ramerDouglasPeucker, getHybridBezierPath } from './editor-curves.js';
import { getDynamicTolerance } from './editor-hit.js';

// Lazy-load canvg v3 (ESM) for the trace fallback.
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
        const rawFamily = el.attr('font-family') || "Arial";
        const fontFamily = rawFamily.replace(/['"]/g, '').trim();
        const fontSize = parseFloat(el.attr('font-size') || '3.0');
        const contentNodes = el.node.childNodes;
        let rawContent = "";
        contentNodes.forEach(node => {
            if (node.nodeType === 3) rawContent += node.nodeValue;
            else if (node.nodeName === 'tspan') rawContent += node.textContent;
        });
        if (!rawContent) rawContent = el.text() || "";

        const fontFile = FONT_MAP[fontFamily];
        if (fontFile) {
            try {
                console.log(`[EXPAND] Starting: "${fontFamily}"`);
                const opentypeMod = await import('https://esm.sh/opentype.js');
                const opentype = opentypeMod.default || opentypeMod;

                // opentype.load() is deprecated in newer opentype.js
                // builds and the callback no longer fires reliably,
                // which makes expand hang silently. Fetch the font
                // ourselves and feed the buffer to opentype.parse —
                // the supported path. URL is resolved against THIS
                // module so it survives different host page locations.
                const fontUrl = new URL(`../fonts/${fontFile}`, import.meta.url).href;
                const fontResp = await fetch(fontUrl);
                if (!fontResp.ok) throw new Error(`Font fetch failed: ${fontResp.status} ${fontUrl}`);
                const fontBuffer = await fontResp.arrayBuffer();
                const font = opentype.parse(fontBuffer);

                if (font) {
                    // Baseline mode depends on which convention the <text>
                    // was placed under:
                    //   - new (alphabetic): el.y() is already the baseline
                    //     → opentype generates path with baseline at y=0,
                    //     translation by el.y() lands the baseline at the
                    //     same world y as the live render and the stamp.
                    //   - legacy (hanging): el.y() is the visual top, so
                    //     opentype keeps the historical +ascender shift.
                    const ascentUnits = font.tables.hhea?.ascender || font.ascender || font.tables.os2?.sTypoAscender || 0;
                    const scaleFactor = (1 / font.unitsPerEm) * fontSize;
                    const ascender = ascentUnits * scaleFactor;
                    const isLegacyHanging = el.attr('dominant-baseline') === 'hanging';
                    const baselineYOffset = isLegacyHanging ? ascender : 0;

                    // PUA Mapping for Symbol fonts
                    let processedContent = rawContent;
                    const isSymbolic = ["Symbol", "Wingdings", "Webdings"].includes(fontFamily);
                    if (isSymbolic) {
                        processedContent = Array.from(rawContent).map(c => {
                            const code = c.charCodeAt(0);
                            return (code > 31 && code < 127) ? String.fromCharCode(0xF000 + code) : c;
                        }).join('');
                    }

                    // Combine the element's transform matrix with the raw
                    // x/y attribute. IMPORTANT: read x/y via attr(), NOT
                    // via el.x()/el.y() — those return the rendered bbox
                    // position, which already includes the transform
                    // translation. Using them here would double-count
                    // the transform and displace the expanded path by
                    // the same amount as any prior drag.
                    const ax = parseFloat(el.attr('x')) || 0;
                    const ay = parseFloat(el.attr('y')) || 0;
                    const m = el.matrix().translate(ax, ay);

                    try {
                        const pathObj = font.getPath(processedContent, 0, baselineYOffset, fontSize);
                        let d = pathObj.toPathData(2);

                        const expanded = editor._sketchLayer.path(d)
                            .fill('#000000')
                            .stroke('none')
                            .attr('fill-rule', 'evenodd')
                            .attr('data-layer', el.attr('data-layer') || "0");

                        // Manually transform every point in the path segment
                        // list. This bypasses SVG.js's .transform() API which
                        // had failed to bake transforms reliably here.
                        const pArray = new SVG.PathArray(d);
                        pArray.forEach(seg => {
                            // Segments: [Type, x1, y1, x2, y2...] or [Type, x, y]
                            for (let i = 1; i < seg.length; i += 2) {
                                if (typeof seg[i] === 'number' && typeof seg[i + 1] === 'number') {
                                    const pt = new SVG.Point(seg[i], seg[i + 1]).transform(m);
                                    seg[i] = pt.x;
                                    seg[i + 1] = pt.y;
                                }
                            }
                        });

                        expanded.plot(pArray.toString());
                        expanded.attr('transform', null);

                        // Metadata backup for re-editing. SVG.js's clone()
                        // inserts the clone into the parent by default —
                        // we only want the markup, so build a temp clone,
                        // pull its serialized SVG, then remove it. Without
                        // the explicit remove(), this clone leaked into the
                        // sketch layer on every expand, leaving a ghost
                        // text behind the new expanded path.
                        const tmp = el.clone();
                        tmp.removeClass('svg-selected').removeClass('svg-hover');
                        const textCopy = tmp.svg();
                        tmp.remove();
                        expanded.attr('data-original-text-svg', el.attr('data-original-text-svg') || textCopy);

                        editor._select(expanded);
                    } finally {
                        // Ensure the original text is always removed
                        el.remove();
                    }
                    if (commit && editor.pushState) editor.pushState();
                    return;
                }
            } catch (e) {
                console.error("[EXPAND] Opentype logic failed:", e);
            }
        } else {
            console.warn(`[EXPAND] No mapping for "${fontFamily}"`);
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

    // Prepare isolated SVG for just this element. If the element has been
    // moved via transform, preserve that transform when tracing.
    const rawSvg = el.attr('data-original-text-svg') || el.attr('data-original-svg') || el.svg();
    const transformAttr = el.attr('transform');
    const svgContent = stripSvgjsAttributes(rawSvg);
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
                        (bbox.y - pad) + (gy / canvasH) * hIn,
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
        const density = 1.0;
        const accuracyFinal = 1.0;
        const simplifyFinal = 1.0;
        const tol = getDynamicTolerance(editor, 1.0);
        const simplifyLevel = Math.max(1, Math.min(500, simplifyFinal));
        const simplifyFactor = Math.sqrt(simplifyLevel / 15);
        const accuracyFactor = Math.max(0.5, Math.min(2.0, accuracyFinal));
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
            if (!expanded.attr('data-original-svg') && !expanded.attr('data-original-text-svg')) {
                expanded.attr('data-original-svg', el.svg());
            }

            el.remove();
            editor._select(expanded);
            if (commit && editor.pushState) editor.pushState();
        }
    } catch (err) {
        console.error("[EXPAND] Trace failure:", err);
    }
}

/**
 * Geometric Offset (smart stroke-to-fill). Samples the path at high
 * resolution, builds parallel offset banks at ±strokeWidth/2 and round
 * end caps, then assembles them into a single closed-fill path. The
 * sampled points get the element's transform baked in so the resulting
 * `d` is in user/model space and the new path can ship with no transform.
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
