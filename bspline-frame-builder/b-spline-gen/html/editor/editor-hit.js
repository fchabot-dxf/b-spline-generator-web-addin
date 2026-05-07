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

export function getDynamicTolerance(editor, px = 5) {
    if (!editor._draw) return 0.1;
    const view = editor._draw.viewbox();
    const svgEl = document.getElementById('editorSVGContainer');
    if (!svgEl) return 0.1;
    const screenWidth = svgEl.clientWidth || 800;
    return (px * view.width) / screenWidth;
}

/**
 * Apply only the element's own transform attribute to a local-space
 * point. Earlier versions used `el.node.getCTM()`, which returns the
 * cumulative matrix all the way to the SVG viewport (i.e., screen
 * pixels) — that scaled node positions to ~600× the click coords and
 * broke the node hit-test on every path. SVG.js's `matrix()` returns
 * just the element's transform attribute, which is what we want: the
 * sketch group itself has no transform, so the element's matrix maps
 * local space directly into the user/model space the click point uses.
 */
function _transformPoint(el, pt) {
    if (!el || typeof el.matrix !== 'function') return pt;
    try {
        const m = el.matrix();
        if (!m) return pt;
        return {
            x: m.a * pt.x + m.c * pt.y + m.e,
            y: m.b * pt.x + m.d * pt.y + m.f,
        };
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
        pts.push({ x: x, y: y });
        pts.push({ x: x + w, y: y });
        pts.push({ x: x + w, y: y + h });
        pts.push({ x: x, y: y + h });
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
