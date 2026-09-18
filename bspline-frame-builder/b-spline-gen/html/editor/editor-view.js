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

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 16;

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
    editor._view = { zoom: 1, cx: editor._mW / 2, cy: editor._mH / 2 };
    applyView(editor);
}
