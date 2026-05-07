/**
 * Expand strategy 2: geometric stroke offset for vector shapes.
 *
 *   - Open shapes (path / polyline / line) get a stroke offset with
 *     round start/end caps. Result: one filled path tracing the stroke
 *     with rounded ends.
 *   - Closed shapes (rect / circle / ellipse / polygon, or a <path>
 *     whose d ends in Z) skip the caps and emit two concentric loops
 *     with even-odd fill — the natural ring representation of a
 *     stroked closed shape.
 *
 * Filled shapes (fill !== "none") fall through to the trace strategy,
 * which handles the silhouette correctly. The geometric offset here is
 * for stroke-to-fill conversion only.
 *
 * Returns true if it produced a path and replaced the original element,
 * false otherwise (orchestrator falls through to the trace strategy).
 */

const OPEN_SHAPES = ['path', 'polyline', 'line'];
const CLOSED_SHAPES = ['rect', 'circle', 'ellipse', 'polygon'];

export function expandShape(editor, el, { commit = true } = {}) {
    if (!OPEN_SHAPES.includes(el.type) && !CLOSED_SHAPES.includes(el.type)) return false;

    const fill = (el.attr('fill') || '').toLowerCase();
    const isFilled = fill && fill !== 'none' && fill !== 'transparent';
    if (isFilled) return false;

    const sw = parseFloat(el.attr('stroke-width')) || 0.5;
    const matrix = el.matrix();
    const isClosed = CLOSED_SHAPES.includes(el.type) ||
        (el.type === 'path' && /[zZ]\s*$/.test(el.attr('d') || ''));
    const geoD = expandGeometric(editor, el, sw, matrix, isClosed);
    if (!geoD) return false;

    const layer = el.attr('data-layer') || "0";
    const expanded = editor._sketchLayer.path(geoD)
        .fill('#000000')
        .stroke('none')
        .attr('fill-rule', 'evenodd')
        .attr('data-layer', layer);

    // Clear transform — it's now baked into geoD.
    expanded.attr('transform', null);
    expanded.attr('data-original-svg', el.svg());
    el.remove();
    editor._select(expanded);
    if (commit && editor.pushState) editor.pushState();
    return true;
}

/**
 * Geometric Offset (smart stroke-to-fill). Samples the element's
 * outline at high resolution via getPointAtLength, then builds parallel
 * offset banks at ±strokeWidth/2.
 *
 * For closed shapes, emits two concentric loops with even-odd fill —
 * fills the annular ring and leaves the inside as a hole. For open
 * shapes, assembles startCap → outer → endCap → inner reversed → close
 * into one filled path with rounded ends.
 *
 * Sampled points have the element's transform baked into them, so the
 * resulting `d` is in user/model space and the caller clears the
 * transform attribute on the new <path> after plotting.
 */
function expandGeometric(editor, el, strokeWidth, matrix, isClosed = false) {
    const pathNode = el.node;
    if (typeof pathNode.getTotalLength !== 'function') return null;
    const length = pathNode.getTotalLength();
    if (length <= 0) return null;

    // Sampling rate: high resolution (approx every 0.02 units).
    const step = 0.02;
    const numSamples = Math.max(2, Math.ceil(length / step));

    const pts = [];
    for (let i = 0; i <= numSamples; i++) {
        const t = (i / numSamples) * length;
        let pt = pathNode.getPointAtLength(t);
        if (matrix) {
            const worldPt = new editor._draw.point(pt.x, pt.y).transform(matrix);
            pt = { x: worldPt.x, y: worldPt.y };
        }
        pts.push(pt);
    }

    const halfWidth = strokeWidth / 2;

    if (isClosed) {
        // Closed shape: drop the trailing duplicate point if
        // getPointAtLength returned start==end, then compute normals
        // using circular neighbor lookup so the offset wraps cleanly.
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
            const nx = -dy / mag, ny = dx / mag;
            outer.push({ x: pts[i].x + nx * halfWidth, y: pts[i].y + ny * halfWidth });
            inner.push({ x: pts[i].x - nx * halfWidth, y: pts[i].y - ny * halfWidth });
        }

        let d = `M ${outer[0].x.toFixed(3)} ${outer[0].y.toFixed(3)}`;
        for (let i = 1; i < outer.length; i++) d += ` L ${outer[i].x.toFixed(3)} ${outer[i].y.toFixed(3)}`;
        d += ' Z';
        d += ` M ${inner[0].x.toFixed(3)} ${inner[0].y.toFixed(3)}`;
        for (let i = 1; i < inner.length; i++) d += ` L ${inner[i].x.toFixed(3)} ${inner[i].y.toFixed(3)}`;
        d += ' Z';
        return d;
    }

    // Open shape: outer bank + inner bank with round end caps at start/end.
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
