/**
 * Hit-testing helpers used by the editor's interaction layer:
 *   - getDynamicTolerance: pixel→model conversion so click slop scales
 *     with the canvas zoom.
 *   - getNodes: extracts the editable control points from a selected
 *     element, with the element's own transform baked in (so the points
 *     come back in user/model space, matching click coords).
 *   - getNearbyElement: finds the closest element under a click point,
 *     filtered to the active layer.
 */
import { isEditableByLayer } from './layers.js';
import { worldPoint } from './editor-coords.js';
import { viewScale } from './editor-view.js';
import { PATH_LAYOUT, endPoint } from './path-layout.js';

export function getDynamicTolerance(editor, px = 5) {
    if (!editor._draw) return 0.1;
    const view = editor._draw.viewbox();
    const svgEl = document.getElementById('editorSVGContainer');
    if (!svgEl) return 0.1;
    const screenWidth = svgEl.clientWidth || 800;
    const screenHeight = svgEl.clientHeight || 800;
    // Uniform scale (preserveAspectRatio="meet"), not width-only: width-only
    // is wrong whenever the container is proportionally taller than the
    // board (letterboxed on width) — e.g. the docked palette.
    return px / viewScale(view, screenWidth, screenHeight);
}

/**
 * SE7n: each node is `{ x, y, set(localPt) }` — x,y in WORLD space (as
 * always, via worldPoint), `set` closing over the REAL mutation for that
 * node. `dragNode` (editor-interaction.js) maps the world pointer into
 * local space once (via el.matrix().inverse()) and calls `set` — no
 * per-shape branching left at the drag site, and the node's own index
 * bookkeeping (path segments especially — see below) can never disagree
 * with what set() actually writes, because both come from this one loop.
 */
export function getNodes(el) {
    // { local: {x,y}, set(localPt) } before the worldPoint map at the end —
    // keeps every branch below symmetric (build local, capture a setter).
    const raw = [];

    if (el.type === 'line') {
        raw.push({ local: { x: el.attr('x1'), y: el.attr('y1') }, set: (p) => el.attr({ x1: p.x, y1: p.y }) });
        raw.push({ local: { x: el.attr('x2'), y: el.attr('y2') }, set: (p) => el.attr({ x2: p.x, y2: p.y }) });
    } else if (el.type === 'polyline' || el.type === 'polygon') {
        el.array().forEach((pt, i) => {
            raw.push({
                local: { x: pt[0], y: pt[1] },
                set: (p) => { const a = el.array(); a[i] = [p.x, p.y]; el.plot(a); },
            });
        });
    } else if (el.type === 'path') {
        // Build the node list AND each node's REAL segment index in the
        // SAME loop over el.array() — the old code pushed a point only for
        // M/L/C/Q into a SEPARATE array, so after the first Z (or any
        // other skipped command) that array's indices silently diverged
        // from el.array()'s, and dragging edited the wrong segment.
        // H/V/A/S/T are now covered too (every segment END is a node).
        // H/V carry only one coordinate; the other is inherited from the
        // running cursor position, tracked here exactly as SVG itself
        // defines path continuation. SE8a: offsets now come from the ONE
        // declared PATH_LAYOUT (path-layout.js) instead of per-branch
        // literals — the same table _bakeMatrixIntoPath now reads too, so
        // the two can't drift apart again the way getNodes/dragNode did
        // pre-SE7n.
        let curX = 0, curY = 0;
        el.array().forEach((seg, segIdx) => {
            const type = seg[0];
            const layout = PATH_LAYOUT[type];
            if (!layout) return; // unrecognized command — defensive, shouldn't occur
            if (layout.pts) {
                const end = endPoint(seg);
                curX = end.x; curY = end.y;
                const [xi, yi] = layout.pts[layout.pts.length - 1];
                raw.push({
                    local: { x: curX, y: curY },
                    set: (p) => { const a = el.array(); a[segIdx][xi] = p.x; a[segIdx][yi] = p.y; el.plot(a); },
                });
            } else if (layout.x !== undefined) { // H — y inherited, a 1-DOF node
                curX = seg[layout.x];
                raw.push({ local: { x: curX, y: curY }, set: (p) => { const a = el.array(); a[segIdx][layout.x] = p.x; el.plot(a); } });
            } else if (layout.y !== undefined) { // V — x inherited, a 1-DOF node
                curY = seg[layout.y];
                raw.push({ local: { x: curX, y: curY }, set: (p) => { const a = el.array(); a[segIdx][layout.y] = p.y; el.plot(a); } });
            } else if (layout.arc) {
                const end = endPoint(seg);
                curX = end.x; curY = end.y;
                const [xi, yi] = layout.end;
                raw.push({
                    local: { x: curX, y: curY },
                    set: (p) => { const a = el.array(); a[segIdx][xi] = p.x; a[segIdx][yi] = p.y; el.plot(a); },
                });
            }
            // 'Z' (layout = {}) has no coords of its own and is not a node.
        });
    } else if (el.type === 'rect') {
        const x = el.attr('x'), y = el.attr('y'), w = el.attr('width'), h = el.attr('height');
        // Each corner's OPPOSITE corner is captured now, at node-list build
        // time (drag start) — not re-derived from the rect's current attrs
        // on every move, which would chase the corner that's shrinking
        // rather than staying pinned to where it started.
        const corners = [
            { local: { x, y },         opposite: { x: x + w, y: y + h } },
            { local: { x: x + w, y },  opposite: { x, y: y + h } },
            { local: { x: x + w, y: y + h }, opposite: { x, y } },
            { local: { x, y: y + h },  opposite: { x: x + w, y } },
        ];
        corners.forEach((c) => {
            raw.push({
                local: c.local,
                set: (p) => {
                    const nx = Math.min(p.x, c.opposite.x);
                    const ny = Math.min(p.y, c.opposite.y);
                    const nw = Math.abs(p.x - c.opposite.x);
                    const nh = Math.abs(p.y - c.opposite.y);
                    el.attr({ x: nx, y: ny, width: nw, height: nh });
                },
            });
        });
    } else if (el.type === 'circle' || el.type === 'ellipse') {
        // Centre only — radius editing is SE7s, not this turn.
        raw.push({ local: { x: el.attr('cx'), y: el.attr('cy') }, set: (p) => el.attr({ cx: p.x, cy: p.y }) });
    }

    return raw.map((n) => {
        const world = worldPoint(el, n.local);
        return { x: world.x, y: world.y, set: n.set };
    });
}

export function getNearbyElement(editor, pt, tol = 0.1) {
    if (!editor._sketchLayer) return null;
    let bestEl = null;
    let bestDistSq = Infinity;

    editor._sketchLayer.children().toArray().forEach(el => {
        if (!isEditableByLayer(editor, el)) return;

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
