/**
 * Expand strategy 3: canvg trace fallback. The catch-all for anything
 * the previous strategies couldn't handle (filled shapes, <image>, <g>,
 * unknown elements). Rasterizes the element to a canvas, extracts the
 * boundary of every filled region as a marching-squares pixel walk,
 * then pipes the resulting loops through RDP simplification + the
 * hybrid bezier path builder.
 *
 * Lossy by nature — clean geometry comes back as polygon approximations,
 * thin strokes can drop out at low canvas resolution. The earlier
 * strategies should catch most editor-drawn shapes; trace exists for
 * imported SVGs and complex content where there's no analytical path.
 */
import { stripSvgjsAttributes, decodeSnapshot } from '../core/svg-utils.js';
import { fitCurve, ramerDouglasPeucker, getHybridBezierPath } from './editor-curves.js';
import { getDynamicTolerance } from './editor-hit.js';
import { commitExpandedPath } from './editor-expand-commit.js';

// Lazy-load canvg v3 so the editor's main bundle isn't bloated by it.
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

export async function expandTrace(editor, el, { commit = true } = {}) {
    const bbox = el.bbox();
    const pad = 0.5;
    const wIn = bbox.w + pad * 2;
    const hIn = bbox.h + pad * 2;
    const canvas = document.createElement('canvas');
    const canvasW = Math.max(256, Math.min(3072, Math.round(wIn * 260)));
    const canvasH = Math.max(256, Math.min(3072, Math.round(hIn * 260)));
    canvas.width = canvasW; canvas.height = canvasH;
    const ctx = canvas.getContext('2d');

    // Prepare isolated SVG for just this element. If the element has
    // been moved via transform, preserve that transform when tracing.
    const rawSvg = decodeSnapshot(el.attr('data-original-text-svg') || el.attr('data-original-svg')) || el.svg();
    const transformAttr = el.attr('transform');
    const svgContent = stripSvgjsAttributes(rawSvg);
    const transformedContent = transformAttr ? `<g transform="${transformAttr}">${svgContent}</g>` : svgContent;
    const canvgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" preserveAspectRatio="none" viewBox="${bbox.x - pad} ${bbox.y - pad} ${wIn} ${hIn}">${transformedContent}</svg>`;

    const Canvg = await _loadCanvg();
    if (!Canvg) {
        console.error("[EXPAND] canvg library NOT available");
        return false;
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
            return false;
        }

        const loops = extractLoops(mask, canvasW, canvasH, bbox, pad, wIn, hIn);
        if (loops.length === 0) {
            console.warn("[EXPAND] No contour loops extracted from trace.");
            return false;
        }

        // Tuning constants kept verbatim from the pre-split version so
        // visual output matches. The factors collapse with the hardcoded
        // 1s but the Math.max floors (0.05, 0.1, 20) still bind on small
        // tolerance values, so don't fold the multiplications away.
        const density = 1.0;
        const accuracyFinal = 1.0;
        const simplifyFinal = 1.0;
        const tol = getDynamicTolerance(editor, 1.0);
        const simplifyLevel = Math.max(1, Math.min(500, simplifyFinal));
        const simplifyFactor = Math.sqrt(simplifyLevel / 15);
        const accuracyFactor = Math.max(0.5, Math.min(2.0, accuracyFinal));
        const simpTol = Math.max(0.05, tol * 0.5 / density * simplifyFactor / accuracyFactor);
        const cornerAngle = Math.max(20, 95 / density / accuracyFactor);
        const fitTol = Math.max(0.1, tol * 2.0 / density * simplifyFactor / accuracyFactor);

        let pathData = "";
        for (const loop of loops) {
            if (loop.length < 3) continue;
            const pruned = ramerDouglasPeucker(loop, simpTol);
            let cData = getHybridBezierPath(pruned, true, cornerAngle);
            if (!cData) {
                cData = fitCurve(editor, pruned, fitTol);
            }
            cData = cData.trim();
            if (cData && !cData.endsWith('Z')) cData += ' Z';
            if (cData) pathData += cData + " ";
        }

        if (!pathData) return false;

        // Trace strategy can ingest either text or non-text sources via
        // the orchestrator's fall-through. Detect which to inform the
        // commit helper which sentinel attr to write on first expand.
        const isText = el.type === 'text' || !!el.attr('data-original-text-svg');
        const expanded = commitExpandedPath(editor, el, pathData, { commit, isText });
        return !!expanded;
    } catch (err) {
        console.error("[EXPAND] Trace failure:", err);
        return false;
    }
}

/**
 * Marching-squares-style boundary extraction. Walks the alpha mask and
 * for each filled pixel, emits unit segments along edges where the
 * neighbor is empty. Then walks the resulting graph to assemble closed
 * loops.
 *
 * Returns a list of loops in user/model coords (mapped from canvas px
 * back through the bbox + viewBox + canvas-size relationship).
 */
function extractLoops(mask, canvasW, canvasH, bbox, pad, wIn, hIn) {
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
    return loops;
}
