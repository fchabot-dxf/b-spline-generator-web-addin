/**
 * height/brush.js -- HEIGHT-PAINTER (HEIGHT-PAINTER-DESIGN.md section 4): the dab engine of the height brush. Pure.
 *
 * Photoshop semantics (Fred 2026-11-22: "opacity 50% and value % are similar until they cross over each other"):
 *  - a DAB's falloff: 1 inside hardness * R, then a roll-off to 0 at R shaped by the brush's PROFILE (BRUSH_FALLOFFS;
 *    'smooth' = a smoothstep) (hardness 1 = a hard edge, 0 = all roll-off);
 *  - a STROKE keeps a coverage buffer: each dab moves a pixel's coverage toward the dab's cap (the opacity, x the pen
 *    pressure when "pressure -> opacity" is on) by flow x falloff. So one stroke never passes the opacity at a pixel,
 *    however often it scrubs over it;
 *  - the pixel's value is its height at the stroke's START, moved by that coverage `a`:
 *      raise  base + a * amount          lower  base - a * amount
 *      set    base (1 - a) + target a    erase  base (1 - a)          (0 = transparent: no effect on the board)
 *      smooth base (1 - a) + blur a      (blur = the box mean of the stroke-start heights around the pixel)
 *    so a SECOND stroke starts from what is there: set moves toward the value by the opacity again, raise / lower stack.
 * Units: sizes in inches; pixel (c, r) has its centre at (c, r); `pxPerInX` / `pxPerInY` say how many pixels an inch is
 * (a stretched patch has two). Only the pixels under a dab are read or written.
 */
// the falloff curves live in core/falloff.js (shared with the STL crop-edge falloff); re-exported so importers are unchanged
import { DEFAULT_CUSTOM_CURVE, BRUSH_FALLOFFS, curveFromPoints, curvePointsFromProfile, brushFalloff } from '../falloff.js';
export { BRUSH_FALLOFFS, curveFromPoints, curvePointsFromProfile, brushFalloff };

export const BRUSH_MODES = Object.freeze(['raise', 'lower', 'set', 'smooth', 'erase']);

/** The brush a new session starts with (UI state; main/height-panel.js HEIGHT_CONTROLS edits it). */
export const BRUSH_DEFAULTS = Object.freeze({
  mode: 'raise',
  sizeIn: 0.5,       // the dab's diameter
  hardness: 0.5,
  falloff: 'smooth', // BRUSH_FALLOFFS: the roll-off's shape outside the hard core
  opacity: 1,
  flow: 1,
  spacing: 0.1,      // between dabs, as a fraction of the size
  amountIn: 0.05,    // raise / lower: the height a full-coverage stroke adds / takes
  targetIn: 0.1,     // set: the height it moves toward
  pressureSize: false,
  pressureOpacity: false,
  customCurve: DEFAULT_CUSTOM_CURVE, // the 'custom' falloff's points [t, value]: t 0 = hardness edge, 1 = rim
});

/** The smooth mode's box half-width, as a fraction of the dab radius (at least one pixel). */
export const SMOOTH_KERNEL_FRACTION = 0.25;

/** A summed-area table of `src` (cols x rows) for box means. */
function summedArea(src, cols, rows) {
  const W = cols + 1;
  const s = new Float64Array(W * (rows + 1));
  for (let r = 0; r < rows; r++) {
    let run = 0;
    for (let c = 0; c < cols; c++) { run += src[r * cols + c]; s[(r + 1) * W + c + 1] = s[r * W + c + 1] + run; }
  }
  return s;
}

/**
 * A stroke on `raster` ({ cols, rows, data: Float32Array }, written in place) with brush `b` (BRUSH_DEFAULTS' shape).
 * addPoint(x, y, pressure) lays dabs along the path every spacing x size (the first at the first point); cancel() puts
 * the touched pixels back. `dabs` = how many were laid, `bbox` = { c0, r0, c1, r1 } (inclusive) of the touched pixels or null.
 */
export function createStroke(raster, b, { pxPerInX, pxPerInY }) {
  const { cols, rows, data } = raster;
  const base = Float32Array.from(data);
  const cov = new Float64Array(cols * rows);
  const R0 = b.sizeIn / 2;
  const step = b.spacing * b.sizeIn;
  const mode = b.mode;
  const customFn = b.falloff === 'custom' ? curveFromPoints(b.customCurve || BRUSH_DEFAULTS.customCurve) : null; // once per stroke
  let sat = null, kSmooth = 0;
  let last = null;       // { x, y, p }
  let toNext = 0;        // inches still to go along the path before the next dab
  const s = { dabs: 0, bbox: null };

  const blurAt = (c, r) => {
    if (!sat) { sat = summedArea(base, cols, rows); kSmooth = Math.max(1, Math.round(SMOOTH_KERNEL_FRACTION * R0 * Math.max(pxPerInX, pxPerInY))); }
    const c0 = Math.max(0, c - kSmooth), c1 = Math.min(cols - 1, c + kSmooth), r0 = Math.max(0, r - kSmooth), r1 = Math.min(rows - 1, r + kSmooth);
    const W = cols + 1;
    const sum = sat[(r1 + 1) * W + c1 + 1] - sat[r0 * W + c1 + 1] - sat[(r1 + 1) * W + c0] + sat[r0 * W + c0];
    return sum / ((c1 - c0 + 1) * (r1 - r0 + 1));
  };

  function dab(x, y, p) {
    s.dabs++;
    const R = b.pressureSize ? R0 * p : R0;
    const cap = b.pressureOpacity ? b.opacity * p : b.opacity;
    if (!(R > 0) || !(cap > 0)) return;
    const c0 = Math.max(0, Math.floor(x - R * pxPerInX)), c1 = Math.min(cols - 1, Math.ceil(x + R * pxPerInX));
    const r0 = Math.max(0, Math.floor(y - R * pxPerInY)), r1 = Math.min(rows - 1, Math.ceil(y + R * pxPerInY));
    if (c0 > c1 || r0 > r1) return;
    let touched = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const f = brushFalloff(Math.hypot((c - x) / pxPerInX, (r - y) / pxPerInY), R, b.hardness, b.falloff, customFn);
        if (!(f > 0)) continue;
        const k = r * cols + c;
        const a0 = cov[k];
        if (!(a0 < cap)) continue;
        const a = a0 + (cap - a0) * (b.flow * f);
        cov[k] = a;
        const h = base[k];
        if (mode === 'raise') data[k] = h + a * b.amountIn;
        else if (mode === 'lower') data[k] = h - a * b.amountIn;
        else if (mode === 'set') data[k] = h * (1 - a) + b.targetIn * a;
        else if (mode === 'erase') data[k] = h * (1 - a);
        else if (mode === 'smooth') data[k] = h * (1 - a) + blurAt(c, r) * a;
        touched = true;
      }
    }
    if (!touched) return;
    const bb = s.bbox;
    s.bbox = bb ? { c0: Math.min(bb.c0, c0), r0: Math.min(bb.r0, r0), c1: Math.max(bb.c1, c1), r1: Math.max(bb.r1, r1) } : { c0, r0, c1, r1 };
  }

  const EPS = 1e-9; // inches: a dab that lands on a segment's end within rounding is laid there, not lost
  s.addPoint = (x, y, pressure = 1) => {
    const p = pressure;
    if (!last) { dab(x, y, p); last = { x, y, p }; toNext = step; return; }
    const len = Math.hypot((x - last.x) / pxPerInX, (y - last.y) / pxPerInY);
    if (!(step > 0)) { dab(x, y, p); last = { x, y, p }; return; } // no spacing: a dab at every pointer sample
    let at = toNext;
    while (at <= len + EPS) {
      const t = len > 0 ? Math.min(1, at / len) : 1;
      dab(last.x + (x - last.x) * t, last.y + (y - last.y) * t, last.p + (p - last.p) * t);
      at += step;
    }
    toNext = Math.max(0, at - len);
    last = { x, y, p };
  };
  s.cancel = () => {
    const bb = s.bbox;
    if (!bb) return;
    for (let r = bb.r0; r <= bb.r1; r++) for (let c = bb.c0; c <= bb.c1; c++) data[r * cols + c] = base[r * cols + c];
  };
  return s;
}
