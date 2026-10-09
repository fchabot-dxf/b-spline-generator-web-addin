/**
 * editor-view.js — the SVG editor's zoom/pan state, as one declared view
 * record { zoom, cx, cy } (model-space center) + a pure derivation into an
 * SVG viewBox. No other code should call `editor._draw.viewbox(...)`
 * directly as a setter — go through applyView() so there is exactly one
 * place translating the view record into svg.js's own viewbox shape.
 *
 * Pure math here (viewboxFor, zoomAbout, clampZoom) has no svg.js/DOM
 * dependency and is unit-tested directly in tests/editor-view.test.js.
 */

import { frameFitRegion } from './editor-frame-profile.js';

// Fred: zoom OUT past fit (board smaller than the view, room around it).
// zoom 1 = fit (the fit button still returns exactly here); 0.25 = the
// board at a quarter of the view.
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 16;

/** px-per-model-unit under the editor root's `preserveAspectRatio="xMidYMid
 *  meet"` (the SVG default — the root is created via `.size('100%','100%')`
 *  with no override, see editor/init.js). The board renders at ONE uniform
 *  scale on BOTH axes, letterboxed on whichever axis the container is
 *  proportionally larger on — it is NEVER `clientW/vb.w` and `clientH/vb.h`
 *  independently; that per-axis pair only agrees with this on the binding
 *  axis and is wrong (by the container/board aspect-ratio mismatch) on the
 *  letterboxed one. `vb` is `{w, h}` (a viewboxFor() result works directly). */
export function viewScale(vb, clientW, clientH) {
    return Math.min(clientW / vb.w, clientH / vb.h);
}

/** Screen-pixel delta -> model-space delta, using the ONE uniform scale
 *  (not a per-axis divide). Use for both panning (delta = drag distance)
 *  and hit-tolerance (delta = {dx: px, dy: 0} or similar — either axis
 *  gives the same answer since the scale is uniform). */
export function screenToModelDelta(vb, clientW, clientH, dxPx, dyPx) {
    const s = viewScale(vb, clientW, clientH);
    return { dx: dxPx / s, dy: dyPx / s };
}

export function clampZoom(z) {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** {zoom, cx, cy} + the board's own model dimensions -> the SVG viewBox
 *  rectangle {x, y, w, h} that shows it. zoom 1 = the whole board;
 *  larger zoom = a smaller, more magnified slice centered on (cx, cy). */
export function viewboxFor(view, mW, mH) {
    const w = mW / view.zoom;
    const h = mH / view.zoom;
    return {
        x: view.cx - w / 2,
        y: view.cy - h / 2,
        w,
        h,
    };
}

/** Zoom by `factor` (>1 = in, <1 = out) about `modelPt` (a model-space
 *  point, e.g. the cursor position from the moment before this call) —
 *  returns a NEW view record with modelPt held fixed under that same
 *  point once the returned view is applied. Pure — takes/returns plain
 *  {zoom,cx,cy} objects, does not mutate `view`. */
export function zoomAbout(view, modelPt, factor) {
    const oldZoom = view.zoom;
    const newZoom = clampZoom(oldZoom * factor);
    const ratio = oldZoom / newZoom; // <1 when zooming in — pulls the center toward modelPt
    return {
        zoom: newZoom,
        cx: modelPt.x + (view.cx - modelPt.x) * ratio,
        cy: modelPt.y + (view.cy - modelPt.y) * ratio,
    };
}

/** The one place that pushes a view record onto the live svg.js viewbox. */
export function applyView(editor) {
    if (!editor._draw) return;
    const vb = viewboxFor(editor._view, editor._mW, editor._mH);
    editor._draw.viewbox(vb.x, vb.y, vb.w, vb.h);
}

/** Reset to the fitted view (zoom 1, centered on the whole board) and
 *  apply it immediately. */
export function fitView(editor) {
    editor._view = fittedView(editor);
    editor._fitSnapshot = { ...editor._view }; // what "still fitted" means (isFittedView), whatever the layout does next
    applyView(editor);
}

/** Fred 2026-10-09 (seat D's phone measure: at Fit the board ran 11 px past BOTH screen edges and 11 of 19 templates put a
 *  frame handle inside the OS edge-gesture zone, two of them 3 px from the edge): on a coarse pointer Fit keeps the board's
 *  left and right edges this far inside the visible canvas -- the zone where Android's back gesture and iOS Safari's swipes
 *  start. A mouse keeps today's Fit (0). Per primary pointer, like core/preview/view-cube.js VIEW_CUBE_PX. */
export const FIT_EDGE_MARGIN_PX = Object.freeze({ fine: 0, coarse: 28 });
const fitEdgeMarginPx = () => FIT_EDGE_MARGIN_PX[typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'];

/** Pure: the factor (<= 1) a fitted `base` view's zoom is scaled by so the fitted region's left / right edges (model x
 *  `xLo` / `xHi`: the frame's region, else the board) land at least `marginPx` inside `visible` ({left, right}, screen
 *  px) -- `el` is the svg element's box ({left, width, height}); the view is drawn under viewScale's uniform "meet"
 *  scale, centred in it, and a zoom scales it about that centre. */
export function edgeMarginZoom(base, mW, mH, el, visible, marginPx, xLo = 0, xHi = mW) {
    if (!(marginPx > 0) || !(el.width > 0) || !(el.height > 0)) return 1;
    const vb = viewboxFor(base, mW, mH);
    const s = viewScale(vb, el.width, el.height);
    const C = el.left + el.width / 2; // the screen x of the view's centre (cx)
    const dL = (xLo - base.cx) * s, dR = (xHi - base.cx) * s; // the region's left / right edge, relative to it
    let f = 1;
    if (dL < 0) f = Math.min(f, (C - visible.left - marginPx) / -dL);
    if (dR > 0) f = Math.min(f, (visible.right - marginPx - C) / dR);
    return Math.max(f, 0.05);
}

/** Pure: the view fitView would set now -- FB-APP F7: with a frame, its cut profile's region, else the whole board;
 *  on a coarse pointer zoomed out to FIT_EDGE_MARGIN_PX (the svg's own on-screen box, read here). */
export function fittedView(editor) {
    const r = frameFitRegion(editor);
    const base = r
        ? { zoom: Math.min(editor._mW / r.w, editor._mH / r.h), cx: r.x + r.w / 2, cy: r.y + r.h / 2 }
        : { zoom: 1, cx: editor._mW / 2, cy: editor._mH / 2 };
    const margin = fitEdgeMarginPx();
    const node = editor._draw && editor._draw.node;
    if (!(margin > 0) || !node || typeof node.getBoundingClientRect !== 'function' || typeof innerWidth !== 'number') return base;
    const b = node.getBoundingClientRect();
    const visible = { left: Math.max(b.left, 0), right: Math.min(b.right, innerWidth) };
    const f = edgeMarginZoom(base, editor._mW, editor._mH, { left: b.left, width: b.width, height: b.height }, visible, margin,
        r ? r.x : 0, r ? r.x + r.w : editor._mW);
    return f < 1 ? { ...base, zoom: base.zoom * f } : base;
}

/** Is the live view still the fitted one (the user has not zoomed or panned)? Seat D 2026-10-09: the coarse-pointer
 *  fit reads the svg's on-screen box (FIT_EDGE_MARGIN_PX), which moves while the layout settles (the drawer, a rotation)
 *  -- so the view fitView last set, unchanged since, IS fitted, even when a fit computed now would differ by a hair. */
export function isFittedView(editor, eps = 1e-6) {
    const v = editor && editor._view;
    if (!v) return true;
    const s = editor._fitSnapshot;
    if (s && v.zoom === s.zoom && v.cx === s.cx && v.cy === s.cy) return true;
    const f = fittedView(editor);
    return Math.abs(v.zoom - f.zoom) <= eps * Math.max(1, f.zoom) && Math.abs(v.cx - f.cx) <= eps * editor._mW
        && Math.abs(v.cy - f.cy) <= eps * editor._mH;
}
