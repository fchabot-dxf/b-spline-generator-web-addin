/**
 * core/falloff.js -- the FALLOFF curves, shared by the height brush (core/height/brush.js, which re-exports them) and the STL
 * crop-edge falloff (core/stl/crop.js). Moved here verbatim from brush.js (advisor 2026-11-22) so the heights stage, which
 * reaches the crop falloff, imports only these curves and not the brush's own settings (its `spacing` is the dab spacing,
 * not P.spacing; tests/heights-inert-keys.test.js scans everything the heights stage imports for P key names). Pure.
 */

/** The 'custom' falloff's default points [t, value]: t 0 = the hardness edge, 1 = the rim (a straight fall). */
export const DEFAULT_CUSTOM_CURVE = Object.freeze([Object.freeze([0, 1]), Object.freeze([1, 0])]);

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

const DEFAULT_CUSTOM_CURVE_FN = curveFromPoints(DEFAULT_CUSTOM_CURVE);

/** Control points sampled from a built-in profile at `n` evenly spaced t (the custom curve's "start from"). */
export function curvePointsFromProfile(key, n = 6) {
  const p = BRUSH_FALLOFFS[key];
  if (!p || !p.curve) return DEFAULT_CUSTOM_CURVE.map((q) => [...q]);
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
