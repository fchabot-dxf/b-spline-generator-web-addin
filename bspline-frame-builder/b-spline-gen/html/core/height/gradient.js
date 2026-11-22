/**
 * height/gradient.js -- HEIGHT-PAINTER slice 2 (HEIGHT-PAINTER-DESIGN.md section 4 "Gradient"): a gradient over a layer's
 * heights. Pure.
 *  - linear: t = the pixel's position along start -> end (0 at the start stop, 1 at the end; past either end the stop
 *    holds); radial: t = its distance from the start / the start -> end distance (the end stop beyond).
 *  - the height at t = end + (start - end) x curve(t), the curve = a brush falloff PROFILE (core/height/brush.js
 *    BRUSH_FALLOFFS: 1 at t = 0, 0 at t = 1) or the custom curve (curveFromPoints), so the stops are EXACT.
 *  - applied with opacity a (x the selection mask m: a pixel m leaves at 0 is never written) by mode:
 *      normal  h (1 - a) + V a      add  h + V a      max  h + (max(h, V) - h) a
 * Distances are in inches (`pxPerInX / Y`: a stretched patch has two densities); pixel (c, r) has its centre at (c, r).
 */
import { BRUSH_FALLOFFS, BRUSH_DEFAULTS, curveFromPoints } from './brush.js';

export const GRADIENT_TYPES = Object.freeze(['linear', 'radial']);
export const GRADIENT_MODES = Object.freeze(['normal', 'add', 'max']);
/** The gradient tool at the start of a session (UI state; main/height-panel.js HEIGHT_TOOL_CONTROLS edit it). */
export const GRADIENT_DEFAULTS = Object.freeze({
  type: 'linear',
  startIn: 0.25,      // the height at the start stop (inches)
  endIn: 0,           // the height at the end stop
  falloff: 'linear',  // BRUSH_FALLOFFS key: the curve from the start stop (t = 0) to the end stop (t = 1)
  customCurve: BRUSH_DEFAULTS.customCurve,
  opacity: 1,
  mode: 'normal',
});

/** The curve of gradient `g` as (t) => weight of the start stop. */
export function gradientCurve(g) {
  if (g.falloff === 'custom') return curveFromPoints(g.customCurve || BRUSH_DEFAULTS.customCurve);
  return (BRUSH_FALLOFFS[g.falloff] || BRUSH_FALLOFFS.linear).curve;
}
/** The height of gradient `g` at t (0..1); `curve` = gradientCurve(g) when given (worked out once per apply). */
export function gradientValue(t, g, curve = gradientCurve(g)) {
  const w = curve(t);
  if (w === 1) return g.startIn;
  if (w === 0) return g.endIn;
  return g.endIn + (g.startIn - g.endIn) * w;
}

/**
 * Gradient `g` onto `data` (cols x rows, written in place) from `start` [c, r] to `end` [c, r] (pixel coordinates), inside
 * `mask` (Float32 0..1 per pixel, or null = everywhere). Returns how many pixels it wrote.
 */
export function applyGradient(data, cols, rows, g, { start, end, pxPerInX, pxPerInY, mask = null }) {
  const curve = gradientCurve(g);
  const ex = (end[0] - start[0]) / pxPerInX, ey = (end[1] - start[1]) / pxPerInY;
  const len2 = ex * ex + ey * ey;
  const radial = g.type === 'radial';
  const len = Math.sqrt(len2);
  const op = Number.isFinite(g.opacity) ? g.opacity : 1;
  let n = 0;
  for (let r = 0; r < rows; r++) {
    const dy = (r - start[1]) / pxPerInY;
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const m = mask ? mask[k] : 1;
      if (!(m > 0)) continue;
      const dx = (c - start[0]) / pxPerInX;
      let t;
      if (!(len2 > 0)) t = 0;
      else if (radial) t = Math.hypot(dx, dy) / len;
      else t = (dx * ex + dy * ey) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const V = gradientValue(t, g, curve);
      const a = op * m;
      const h = data[k];
      if (g.mode === 'add') data[k] = h + V * a;
      else if (g.mode === 'max') data[k] = h + (Math.max(h, V) - h) * a;
      else data[k] = a === 1 ? V : h * (1 - a) + V * a;
      n++;
    }
  }
  return n;
}
