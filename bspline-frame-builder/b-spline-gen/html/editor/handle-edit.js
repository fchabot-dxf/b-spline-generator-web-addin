/**
 * handle-edit.js — SE7s: the declared per-element-kind transform-handle
 * rule, plus the pure affine-matrix math editor-transform-handles.js
 * composes with it.
 *
 * Ground truth (ROADMAP "SE7s", 3 entries; Fred 2026-09-23): a handle drag
 * must never scale the STROKE (stroke-width is the carve width), and a
 * corner drag must scale along the anchor->handle direction, not whichever
 * screen axis the pointer happened to move more on. `HANDLE_EDIT` says what
 * "drag a handle" actually MEANS for a given element type; `cornerScale` is
 * the fixed corner-factor formula; the matrix helpers replace `new
 * SVG.Matrix()...` with plain-object affine math (no SVG.js dependency —
 * same rationale as editor-coords.js's transformPoint: testable headless,
 * and one less place a host build's SVG.js quirks can leak into).
 */

/** Per element type: what a handle drag edits.
 *  'endpoints' (line, every rail/tie) — the dragged handle moves whichever
 *    endpoint is nearest to it ALONG THE LINE'S OWN DIRECTION (length only,
 *    angle kept); the far endpoint is the anchor. Ignores sx/sy entirely.
 *  'radius' (circle) — radius only, centre fixed.
 *  'radii' (ellipse) — rx/ry independently (side handles unchanged; corner
 *    uses the same uniform factor for both).
 *  'geometry' (rect/path/polyline/polygon) — baked into raw coordinates on
 *    every move from the drag-start snapshot; `transform` never gains a
 *    scale component, so stroke-width is invariant.
 *  'scale' (text, and the fallback for any undeclared type) — today's
 *    behaviour: compose a scale into the `transform` attribute.
 */
export const HANDLE_EDIT = {
  line: 'endpoints',
  circle: 'radius',
  ellipse: 'radii',
  rect: 'geometry',
  path: 'geometry',
  polyline: 'geometry',
  polygon: 'geometry',
  text: 'scale',
};

/**
 * Corner-handle scale factor: the projection of the pointer vector `n`
 * (from the anchor) onto the ORIGINAL anchor->handle vector `o`, as a
 * fraction of |o| along that direction — (n·o)/(o·o). Replaces the old
 * "whichever axis the pointer moved more on" (`useX`) pick, which gave a
 * 0.02x3 tie dragged 0.3" sideways a x15 scale (projection: x1.00) and made
 * a near-square box's factor jump x1.49<->x1.52 as the dominant axis
 * flipped between adjacent pointer positions. Side handles are unaffected
 * (only one axis is ever controlled there — no direction to project onto).
 */
export function cornerScale(ox, oy, nx, ny) {
  const denom = ox * ox + oy * oy;
  if (denom < 1e-12) return 1;
  return (nx * ox + ny * oy) / denom;
}

/** m1 . m2 — m2 applied first, m1 applied on top (matches editor-transform-
 *  handles.js's own pre-existing "delta x m0" convention: delta.multiply(m0)
 *  meant m0 first, delta on top; the manual formula below reproduces that
 *  exactly with no SVG.Matrix dependency). */
export function multiplyMatrix(m1, m2) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function translateMatrix(tx, ty) {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

export function scaleMatrix(sx, sy) {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** Degrees, matching SVG.Matrix#rotate's own signature (angle, cx, cy). */
export function rotateMatrix(deg, cx = 0, cy = 0) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const r = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  if (!cx && !cy) return r;
  return multiplyMatrix(multiplyMatrix(translateMatrix(cx, cy), r), translateMatrix(-cx, -cy));
}

export function matrixToString(m) {
  return `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`;
}
