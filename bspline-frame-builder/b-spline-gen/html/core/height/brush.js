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
  customCurve: Object.freeze([Object.freeze([0, 1]), Object.freeze([1, 0])]), // the 'custom' falloff's points [t, value]: t 0 = hardness edge, 1 = rim
});

/** The smooth mode's box half-width, as a fraction of the dab radius (at least one pixel). */
export const SMOOTH_KERNEL_FRACTION = 0.25;

/**
 * The falloff PROFILES (Fred 2026-11-22: "for a brush I'd also want to decide the falloff profile"). Hardness says WHERE the
 * roll-off starts (1 inside hardness x R); the profile is its SHAPE from there (t = 0) to the rim (t = 1): each `curve(t)` is
 * 1 at t = 0, 0 at t = 1 and never rises. 'smooth' is the slice-1 curve, so a brush without a profile paints as before.
 */
export const BRUSH_FALLOFFS = Object.freeze({
  smooth: Object.freeze({ label: 'Smooth', title: 'An S-curve: soft start, soft end', curve: (t) => 1 - t * t * (3 - 2 * t) }),
  linear: Object.freeze({ label: 'Linear', title: 'A straight slope (a cone)', curve: (t) => 1 - t }),
  dome: Object.freeze({ label: 'Dome', title: 'Round shoulders, a steep rim (a ball)', curve: (t) => Math.sqrt(Math.max(0, 1 - t * t)) }),
  soft: Object.freeze({ label: 'Soft', title: 'A long gaussian-like tail', curve: (t) => Math.exp(-4.5 * t * t) * Math.pow(1 - t, 0.25) }),
  spike: Object.freeze({ label: 'Spike', title: 'Drops fast, a point at the centre', curve: (t) => (1 - t) ** 3 }),
  plateau: Object.freeze({ label: 'Plateau', title: 'A flat top and a steep rim', curve: (t) => 1 - t ** 6 }),
  // no `curve` here: it is evaluated from the brush's own customCurve (curveFromPoints) -- a ring / crater may rise
  custom: Object.freeze({ label: 'Custom', title: 'Your own curve (edit it below)', custom: true }),
});

/**
 * A curve through `points` ([[t, value], ...]; sorted by t, a repeated t keeps the last): a MONOTONE cubic Hermite
 * (Fritsch-Carlson), so between two points the value never leaves [min, max] of those two (no overshoot). Across points it may
 * rise or fall freely (a ring). Before the first / after the last point the end value holds. Returns `(t) => value`.
 */
export function curveFromPoints(points) {
  const byT = new Map();
  for (const p of Array.isArray(points) ? points : []) if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) byT.set(p[0], p[1]);
  const xs = [...byT.keys()].sort((a, b) => a - b), ys = xs.map((x) => byT.get(x));
  const n = xs.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => ys[0];
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return (t) => {
    if (!(t > xs[0])) return ys[0];
    if (!(t < xs[n - 1])) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= t) lo = mid; else hi = mid; }
    const h = xs[hi] - xs[lo], u = (t - xs[lo]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[lo] + (u3 - 2 * u2 + u) * h * m[lo] + (-2 * u3 + 3 * u2) * ys[hi] + (u3 - u2) * h * m[hi];
  };
}

const DEFAULT_CUSTOM_CURVE_FN = curveFromPoints(BRUSH_DEFAULTS.customCurve);

/** Control points sampled from a built-in profile at `n` evenly spaced t (the custom curve's "start from"). */
export function curvePointsFromProfile(key, n = 6) {
  const p = BRUSH_FALLOFFS[key];
  if (!p || !p.curve) return BRUSH_DEFAULTS.customCurve.map((q) => [...q]);
  const out = [];
  for (let i = 0; i < n; i++) { const t = n > 1 ? i / (n - 1) : 0; out.push([t, p.curve(t)]); }
  return out;
}

/**
 * The falloff at distance `r` from a dab of radius `R`, `hardness` (0..1) and profile `falloff` (a BRUSH_FALLOFFS key).
 * 'custom' reads `customFn` (curveFromPoints of the brush's customCurve; the default curve when absent).
 */
export function brushFalloff(r, R, hardness, falloff = 'smooth', customFn = null) {
  const core = hardness * R;
  // inside the hard core: the curve's STARTING value -- 1 for every built-in; a custom ring holds its low centre (no step
  // at the core edge; advisor 2026-11-22)
  if (falloff === 'custom') {
    const f = customFn || DEFAULT_CUSTOM_CURVE_FN;
    if (r <= core) return f(0);
    if (r >= R) return 0;
    return f((r - core) / (R - core));
  }
  if (r <= core) return 1;
  if (r >= R) return 0;
  const t = (r - core) / (R - core);
  return (BRUSH_FALLOFFS[falloff] || BRUSH_FALLOFFS.smooth).curve(t);
}

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
