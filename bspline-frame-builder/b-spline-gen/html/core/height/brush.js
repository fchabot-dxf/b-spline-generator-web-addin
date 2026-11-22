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

/**
 * The TIP shapes (slice 3; Fred 2026-11-22: "a brush shape tool too, square, circle, bevel brush, angle adjustment"). A tip
 * has its own frame: u along its long axis (the `angle`), v across it; `roundness` k squashes it along v. `dist(u, v, R, k)`
 * (inches) is the distance the falloff / hardness read (core/falloff.js brushFalloff, against the radius R; Infinity =
 * outside); `box` is the footprint for the touched box and the on-canvas cursor ('ellipse' or 'rect', half-sizes R and kR).
 *  - round:  radial (an ellipse when squashed) -- with k = 1 the slice-1 dab, byte for byte (createStroke keeps its code);
 *  - square: Chebyshev in the tip frame -- square + Linear = a crisp chamfer (a bevel), square + Plateau = a flat top;
 *  - chisel: a flat blade -- the falloff across its thickness (kR) only, full strength along it, square ends.
 * `seedRoundness`: picking the tip while the roundness is still 1 starts it there (the panel's alsoSet; never a rule).
 */
export const BRUSH_TIPS = Object.freeze({
  round: Object.freeze({ label: 'Round', title: 'A circle (an ellipse when squashed)', box: 'ellipse', dist: (u, v, R, k) => Math.hypot(u, v / k) }),
  square: Object.freeze({ label: 'Square', title: 'A square: with a Linear falloff, a chamfer (bevel)', box: 'rect', dist: (u, v, R, k) => Math.max(Math.abs(u), Math.abs(v) / k) }),
  chisel: Object.freeze({ label: 'Chisel', title: 'A flat blade: the falloff across its thickness only, square ends', box: 'rect', seedRoundness: 0.25,
    dist: (u, v, R, k) => (Math.abs(u) <= R ? Math.abs(v) / k : Infinity) }),
});

/**
 * The BRUSH PRESETS (slice 3b; Fred 2026-11-22: "a simple brush tool with the different brushes inside of it in the right
 * panel, with the falloff and the different chisel and bevel tools or profiles"): the picker's tiles, in order. A preset
 * sets the TIP and its PROFILE only (tip, roundness, angle, followStroke, falloff, hardness, buildUp) -- never the size, opacity,
 * flow or amount. 'custom' keeps the brush's own custom curve (it is edited below the picker). The session's first brush
 * (BRUSH_DEFAULTS) is 'softRound'. The Brush and the Eraser share them.
 */
const ROUND_TIP = Object.freeze({ tip: 'round', roundness: 1, angle: 0, followStroke: false });
// buildUp: the two plain rounds paint as slice 1 (dabs build up); every PROFILE preset keeps its cross-section along a stroke
const preset = (label, title, brush) => Object.freeze({ label, title, brush: Object.freeze(brush) });
export const BRUSH_PRESETS = Object.freeze({
  softRound: preset('Soft round', 'A round brush with a soft, smooth edge', { ...ROUND_TIP, falloff: 'smooth', hardness: 0.5, buildUp: true }),
  hardRound: preset('Hard round', 'A round brush with a crisp edge', { ...ROUND_TIP, falloff: 'smooth', hardness: 0.9, buildUp: true }),
  dome: preset('Dome', 'Round shoulders and a steep rim (a ball)', { ...ROUND_TIP, falloff: 'dome', hardness: 0, buildUp: false }),
  spike: preset('Spike', 'Drops fast from a point at the centre', { ...ROUND_TIP, falloff: 'spike', hardness: 0, buildUp: false }),
  plateau: preset('Plateau', 'A flat top and a steep rim', { ...ROUND_TIP, falloff: 'plateau', hardness: 0.2, buildUp: false }),
  square: preset('Square', 'A flat-topped square', { tip: 'square', roundness: 1, angle: 0, followStroke: false, falloff: 'plateau', hardness: 0.5, buildUp: false }),
  bevel: preset('Bevel', 'A square tip with straight (linear) sides: a chamfered, bevelled edge', { tip: 'square', roundness: 1, angle: 0, followStroke: false, falloff: 'linear', hardness: 0.3, buildUp: false }),
  chisel: preset('Chisel', 'A flat blade along the stroke with straight sides: a crisp V ridge (Lower / Alt: a V groove)', { tip: 'chisel', roundness: 0.25, angle: 0, followStroke: true, falloff: 'linear', hardness: 0, buildUp: false }),
  custom: preset('Custom', 'A round brush with your own falloff curve (edit it below)', { ...ROUND_TIP, falloff: 'custom', hardness: 0, buildUp: false }),
});
/** The preset brush `b` is exactly (every key the preset sets; an absent brush key reads as BRUSH_DEFAULTS), or null. */
export function brushPresetOf(b) {
  for (const [id, p] of Object.entries(BRUSH_PRESETS)) {
    if (Object.entries(p.brush).every(([k, v]) => (b[k] === undefined ? BRUSH_DEFAULTS[k] : b[k]) === v)) return id;
  }
  return null;
}
/** Alt held while painting with the Brush (slice 3b, Fred 2026-11-22): that stroke's mode (Photoshop's Alt). */
export const BRUSH_ALT_MODE = Object.freeze({ raise: 'lower', lower: 'raise' });

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
  // slice 3, the tip (an absent key reads as these: the slice-1 round dab)
  tip: 'round',        // BRUSH_TIPS
  roundness: 1,        // 1 = a full circle / square; lower = squashed across the tip
  angle: 0,            // degrees, counter-clockwise on the board (with followStroke: from the drag direction)
  followStroke: false, // the tip turns with the drag direction
  // slice 3b: true (absent) = each dab builds on the stroke's coverage (slice 1); false = the stroke keeps the tip's PROFILE
  // (a pixel's coverage is the highest single dab's), so a bevel / chisel / dome stroke has the profile's cross-section
  buildUp: true,
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
 * `mask` (slice 2, core/height/selection.js: Float32 0..1 per pixel, or null = everywhere) multiplies the effect: a pixel
 * the mask leaves at 0 is never written.
 * The TIP (slice 3, BRUSH_TIPS: b.tip, b.roundness, b.angle, b.followStroke; absent = round, 1, 0, off): `rotationDeg` is
 * the patch's own turn, so the angle stays on the BOARD. With followStroke the tip's angle is b.angle from the drag
 * direction, and the first dab waits for that direction (the next point; finish() lays it at b.angle when the stroke never
 * moved). A round tip of roundness 1 runs the slice-1 code, byte for byte (tests/height-brush-tip-pin.test.js).
 */
export function createStroke(raster, b, { pxPerInX, pxPerInY, mask = null, rotationDeg = 0 }) {
  const { cols, rows, data } = raster;
  const base = Float32Array.from(data);
  const cov = new Float64Array(cols * rows);
  const R0 = b.sizeIn / 2;
  const step = b.spacing * b.sizeIn;
  const mode = b.mode;
  const customFn = b.falloff === 'custom' ? curveFromPoints(b.customCurve || BRUSH_DEFAULTS.customCurve) : null; // once per stroke
  const tip = BRUSH_TIPS[b.tip] || BRUSH_TIPS.round;
  const kTip = Number.isFinite(b.roundness) ? b.roundness : BRUSH_DEFAULTS.roundness;
  const plain = tip === BRUSH_TIPS.round && kTip === 1; // a circle turns into itself: the slice-1 dab
  const follow = !!b.followStroke;
  const buildUp = b.buildUp !== false; // absent = slice 1
  const angle0 = (((Number.isFinite(b.angle) ? b.angle : 0) - (follow ? 0 : rotationDeg)) * Math.PI) / 180; // in the raster frame
  let sat = null, kSmooth = 0;
  let last = null;       // { x, y, p }
  let toNext = 0;        // inches still to go along the path before the next dab
  let waiting = false;   // followStroke: the first dab waits for the drag direction
  const s = { dabs: 0, bbox: null };

  const blurAt = (c, r) => {
    if (!sat) { sat = summedArea(base, cols, rows); kSmooth = Math.max(1, Math.round(SMOOTH_KERNEL_FRACTION * R0 * Math.max(pxPerInX, pxPerInY))); }
    const c0 = Math.max(0, c - kSmooth), c1 = Math.min(cols - 1, c + kSmooth), r0 = Math.max(0, r - kSmooth), r1 = Math.min(rows - 1, r + kSmooth);
    const W = cols + 1;
    const sum = sat[(r1 + 1) * W + c1 + 1] - sat[r0 * W + c1 + 1] - sat[(r1 + 1) * W + c0] + sat[r0 * W + c0];
    return sum / ((c1 - c0 + 1) * (r1 - r0 + 1));
  };

  function dab(x, y, p, phi = angle0) {
    s.dabs++;
    const R = b.pressureSize ? R0 * p : R0;
    const cap = b.pressureOpacity ? b.opacity * p : b.opacity;
    if (!(R > 0) || !(cap > 0)) return;
    // the footprint's half-extents in inches (a turned / squashed tip; the plain round dab keeps its R)
    const cs = Math.cos(phi), sn = Math.sin(phi), ka = Math.abs(kTip);
    const ex = plain ? R : tip.box === 'rect' ? R * (Math.abs(cs) + ka * Math.abs(sn)) : R * Math.hypot(cs, ka * sn);
    const ey = plain ? R : tip.box === 'rect' ? R * (Math.abs(sn) + ka * Math.abs(cs)) : R * Math.hypot(sn, ka * cs);
    const c0 = Math.max(0, Math.floor(x - ex * pxPerInX)), c1 = Math.min(cols - 1, Math.ceil(x + ex * pxPerInX));
    const r0 = Math.max(0, Math.floor(y - ey * pxPerInY)), r1 = Math.min(rows - 1, Math.ceil(y + ey * pxPerInY));
    if (c0 > c1 || r0 > r1) return;
    // a pixel's distance in the TIP frame (u along the tip, v across it)
    const tipDist = (c, r) => { const dx = (c - x) / pxPerInX, dy = (r - y) / pxPerInY; return tip.dist(cs * dx + sn * dy, cs * dy - sn * dx, R, kTip); };
    let touched = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const f = brushFalloff(plain ? Math.hypot((c - x) / pxPerInX, (r - y) / pxPerInY) : tipDist(c, r), R, b.hardness, b.falloff, customFn);
        if (!(f > 0)) continue;
        const k = r * cols + c;
        const m = mask ? mask[k] : 1;
        if (!(m > 0)) continue;
        const a0 = cov[k];
        if (!(a0 < cap)) continue;
        const a1 = buildUp ? a0 + (cap - a0) * (b.flow * f) : Math.max(a0, cap * b.flow * f);
        cov[k] = a1;
        const a = mask ? a1 * m : a1; // the selection scales the effect, never the coverage
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
    if (!last) { if (follow) waiting = true; else dab(x, y, p); last = { x, y, p }; toNext = step; return; }
    const len = Math.hypot((x - last.x) / pxPerInX, (y - last.y) / pxPerInY);
    let phi = angle0;
    if (follow) {
      if (!(len > 0)) return; // no direction yet
      phi = angle0 + Math.atan2((y - last.y) / pxPerInY, (x - last.x) / pxPerInX);
      if (waiting) { waiting = false; dab(last.x, last.y, last.p, phi); }
    }
    if (!(step > 0)) { dab(x, y, p, phi); last = { x, y, p }; return; } // no spacing: a dab at every pointer sample
    let at = toNext;
    while (at <= len + EPS) {
      const t = len > 0 ? Math.min(1, at / len) : 1;
      dab(last.x + (x - last.x) * t, last.y + (y - last.y) * t, last.p + (p - last.p) * t, phi);
      at += step;
    }
    toNext = Math.max(0, at - len);
    last = { x, y, p };
  };
  /** The stroke's end: a followStroke tap that never moved still lays its one dab (at the set angle). */
  s.finish = () => { if (waiting && last) { waiting = false; dab(last.x, last.y, last.p, angle0); } };
  s.cancel = () => {
    const bb = s.bbox;
    if (!bb) return;
    for (let r = bb.r0; r <= bb.r1; r++) for (let c = bb.c0; c <= bb.c1; c++) data[r * cols + c] = base[r * cols + c];
  };
  return s;
}
