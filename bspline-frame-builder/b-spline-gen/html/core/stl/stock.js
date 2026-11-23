/**
 * stl/stock.js -- STL-RELIEF (STL-RELIEF-DESIGN.md section 13, Fred 2026-11-22): an STL against the STOCK.
 *
 * The stock's bounds are the sculpt check's own (core/sculpt.js checkPreBounds): a height z is OVER when z > carveZ (the stock
 * top, P.carveZ = Board > Carve Depth) and UNDER when z < 0 (the stock bottom). Nothing here changes, blocks or clamps anything:
 *   - stlStockOvershoot / stlStockReport: DETECTION only -- the points an STL covers where the FINAL heights leave the stock
 *     (core/engine/rebuild.js buildHeights computes it from the heights and passes it already has; the panel shows one line);
 *   - fitStlDepth: the 'Fit to carve depth' rule -- the Depth (zScale) at which the stamp just fits; the panel writes it only
 *     when the user presses the button (or adds an STL with P.stlFitOnInsert on).
 */
import { sampleGridAt } from './ghost.js';

/** Over the points `covered` marks: how many leave the stock, and the worst overshoot above the top / below the bottom (inches). */
export function stlStockOvershoot(heights, covered, carveZ) {
  let count = 0, maxOver = 0, maxUnder = 0;
  for (let k = 0, n = heights.length; k < n; k++) {
    if (!covered[k]) continue;
    const z = heights[k];
    if (z > carveZ) { count++; maxOver = Math.max(maxOver, z - carveZ); } // checkPreBounds' rule, point for point
    if (z < 0) { count++; maxUnder = Math.max(maxUnder, -z); }
  }
  return { count, maxOver, maxUnder };
}

/** One entry per STL pass (kind 'stl', id 'stl:<record id>'), keyed by the record id: { count, maxOver, maxUnder, carveZ }. */
export function stlStockReport(passes, heights, carveZ) {
  const out = {};
  for (const p of passes || []) {
    if (!p || p.kind !== 'stl' || typeof p.id !== 'string' || !p.mask || !p.mask.isStamped) continue;
    out[p.id.slice('stl:'.length)] = { ...stlStockOvershoot(heights, p.mask.isStamped, carveZ), carveZ };
  }
  return out;
}

// The last build's report (core/engine/rebuild.js sets it after each heights build; main/stl-panel.js reads it). Setting it
// announces 'stlStockChanged' on the document, the panel's cue to redraw its line.
let _report = {};
export function getStlStockReport() { return _report; }
export function setStlStockReport(report) {
  _report = report || {};
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('stlStockChanged'));
}

const inches = (v) => `${v.toFixed(2)} in`;
/** The panel's one line for an entry ('' when it stays inside the stock). */
export function stlStockMessage(e) {
  if (!e || !(e.count > 0)) return '';
  const bits = [];
  if (e.maxOver > 0) bits.push(`rises ${inches(e.maxOver)} above the stock top`);
  if (e.maxUnder > 0) bits.push(`cuts ${inches(e.maxUnder)} below the stock bottom`);
  return `⚠ This STL ${bits.join(' and ')} (Carve Depth ${inches(e.carveZ)}) at ${e.count} point${e.count === 1 ? '' : 's'}.`;
}

/** How far inside the bound the fit aims (inches): the heights are Float32, so a stamp aimed exactly AT the bound can round a
 *  hair past it and trip the (exact) warning. Numerics, not a rule: 0.00001 in is far below any cutter. */
export const STL_FIT_MARGIN_IN = 1e-5;

/**
 * THE 'Fit to carve depth' rule. The Depth (zScale) that puts the STL's stamp exactly at the stock bound:
 *   Raised: its highest point (the terrain under it + Z offset + its height) at the stock top (carveZ);
 *   Carved: its deepest cut (the terrain under it - Z offset - its depth) at the stock bottom (0).
 * Per covered point k, with b = the pass's body (0..1), H = `hUnit` (its relief height at Depth 1, inches), s = the Depth,
 * z0 = the Z offset, sign = +1 Raised / -1 Carved, base = the terrain under the point (Follow) or the level base -- the terrain
 * bilinear under its pivot, as applyStampLayers' 'level' branch reads it (Level):
 *   surface(s) = base + sign * (z0 + b * H * s)
 *   Add: the stamp IS surface(s); Max: the stamp is the terrain or surface(s), whichever is further out (sign-wise).
 * Each is monotone in s, so the fit is s = min over the points with b > 0 of (sign * (L - base) - z0) / (b * H), L the bound
 * (aimed STL_FIT_MARGIN_IN inside it).
 * No room -- the stamp at Depth 0 already reaches the bound at some covered point -- returns { reason }: 'terrain' (the terrain
 * under it, or the level base, reaches it) or 'zOffset' (the Z offset takes it there); 'flat' (no height to scale), 'empty'
 * (it covers no point). `terrain` is the clean terrain the passes are stamped on (lastResult.cleanHeights): other stamps under
 * the STL are not counted. Pure: nothing is read or written outside the arguments.
 * @returns {{ zScale: number } | { reason: 'terrain' | 'zOffset' | 'flat' | 'empty' }} zScale > 0, for a pass built at Depth > 0
 */
export function fitStlDepth(pass, terrain, nx, nz, carveZ, hUnit) {
  const body = pass.mask.body, cov = pass.mask.isStamped;
  const sign = pass.carve ? -1 : 1;
  const L = pass.carve ? STL_FIT_MARGIN_IN : carveZ - STL_FIT_MARGIN_IN;
  const z0 = pass.zOffset || 0;
  const level = pass.surface === 'level';
  const levelBase = level ? sampleGridAt(terrain, nx, nz, pass.pivot[0], pass.pivot[1]) : 0;
  const max = pass.blend === 'max';
  const out = (v) => sign * (v - L) >= 0; // v at or past the bound
  let any = false, reason = null, s = Infinity;
  for (let k = 0; k < nx * nz; k++) {
    if (!cov[k]) continue;
    any = true;
    const T = terrain[k], base = level ? levelBase : T;
    const surf0 = base + sign * z0;
    const final0 = max ? (sign > 0 ? Math.max(T, surf0) : Math.min(T, surf0)) : surf0;
    if (out(final0)) { if (reason !== 'terrain') reason = out(base) || (max && out(T)) ? 'terrain' : 'zOffset'; continue; }
    const b = body[k];
    if (b > 0 && hUnit > 0) s = Math.min(s, (sign * (L - base) - z0) / (b * hUnit));
  }
  if (!any) return { reason: 'empty' };
  if (reason) return { reason };
  if (!Number.isFinite(s)) return { reason: 'flat' };
  return { zScale: s };
}

/** The solver's numerics (not a rule): a Depth whose own fitStlDepth step is within `relTol` of itself IS the fit (Float32
 *  heights: ~1e-7); at most `maxSteps` passes are built. */
export const STL_FIT_SOLVE = Object.freeze({ relTol: 1e-6, maxSteps: 60 });

/**
 * THE 'Fit to carve depth' solve, on the pass the build makes at each Depth. fitStlDepth is exact for ONE pass: it assumes the
 * body stays as it is while the Depth scales the height. That holds for the raster, the compress tone map and the softness blur
 * (all scale-free), but NOT for the crop-edge falloff's 'bottom' edge (core/stl/crop.js applyCropFalloff fades by the height in
 * INCHES): at Depth 1 a small relief sits inside the fade, its body is crushed, and the one-step fit overshot several times
 * (SMK KAS1996 cropped, falloff 0.6 in: Depth 26 = a 3.7 in wall on a 0.9 in stock, 2026-11-22).
 * Every Depth-dependent term only grows with the Depth (height x a fade rising with height), so the stamp is monotone in s and
 * the fit is the root of one monotone function. Its residual is e(s) = ln(fitStlDepth's step at s / s) (0 at the fit, > 0 = room
 * left): the first step is fitStlDepth's linear one, then a secant on e against ln s (a power-law stamp is a straight line
 * there), each kept inside the bracket the earlier passes proved (e > 0 = a lower bound, e < 0 = an upper bound), else the
 * bracket is halved. A linear stamp converges on the second pass and returns the first step's value unchanged.
 * `passAt(s)` = the record's pass at Depth s > 0 (core/stl/layer.js stlPass; null = it covers nothing).
 * @returns {{ zScale: number } | { reason }} as fitStlDepth
 */
export function solveStlDepth(passAt, s0, terrain, nx, nz, carveZ) {
  let s = s0 > 0 ? s0 : 1, lo = 0, hi = Infinity, prev = null;
  for (let step = 0; step < STL_FIT_SOLVE.maxSteps; step++) {
    const pass = passAt(s);
    if (!pass) return { reason: 'empty' };
    const f = fitStlDepth(pass, terrain, nx, nz, carveZ, Math.abs(pass.depth) / s);
    if (f.zScale === undefined) return f;
    const r = f.zScale / s;
    if (Math.abs(r - 1) <= STL_FIT_SOLVE.relTol) return { zScale: s };
    if (r > 1) lo = s; else hi = s;
    const ls = Math.log(s), e = Math.log(r);
    let next = prev && e !== prev.e ? Math.exp(ls - e * (ls - prev.ls) / (e - prev.e)) : f.zScale;
    prev = { ls, e };
    if (!(next > lo && next < hi)) next = !Number.isFinite(hi) ? 2 * s : lo > 0 ? Math.sqrt(lo * hi) : hi / 2;
    s = next;
  }
  return { zScale: lo > 0 ? lo : s }; // not converged: the largest Depth proved to fit
}
