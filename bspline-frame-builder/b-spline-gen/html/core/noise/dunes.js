/**
 * Dunes (Wind-Sculpted Sand) 🏜️🌬️
 * Long parallel sand crests with a REAL asymmetric cross-section — a
 * gentle windward (stoss) climb and a short, steep lee/slip-face drop
 * right past the sharp crest — fine cross-ripples on the flanks, and
 * per-region wind direction so the dunes curve across the field.
 *
 * T78 (Fred: the old profile read as "a low flat slab with fine ripples,
 * no real crests") REWORK: the previous version built its asymmetry by
 * ATTENUATING the AMPLITUDE on the lee side of a symmetric sine wave,
 * which actually made the lee side SHALLOWER, not steeper (multiplying a
 * smooth curve by a fraction <1 flattens it). Real dune asymmetry is a
 * SHAPE property, not an amplitude one: the same height change happens
 * over a much shorter horizontal run on the lee side. Rebuilt from a
 * triangle wave whose own peak sits at `stossFrac` through each
 * wavelength (not the midpoint) — the climb spans stossFrac of the
 * wavelength, the drop spans only the rest, so the lee slope really is
 * geometrically steeper for an identical height range.
 *
 * Composition:
 *   1. Asymmetric profile — an off-centre triangle wave (gentle stoss
 *                           climb, steep lee drop) sharpened at the peak
 *                           for a crisp crest.
 *   2. Cross-ripples      — high-freq sin perpendicular to the wind.
 *   3. Wind-blown grain   — fine FBM micro-texture.
 */
export const id = 'dunes';
export const label = 'Wind Dunes';
export const cMultiplier = 2.0;
// the photo layer's "Filter shows through" normalises this filter's output by its declared span (core/terrain.js):
// MEASURED 2026-10-10 (seat A), default tweaks, 8 seeds x 7x9 / 9x12 / 12x9 boards, the 0.5 / 99.5 percentiles.
export const nominalRange = [0.02, 0.66];

export const tweaks = [
  { key: 'crestSharpness',  label: 'Crest Sharpness',  default: 1.8, min: 0.8, max: 4.0, step: 0.1, desc: 'Higher = pointier dune crests' },
  { key: 'windCurve',       label: 'Wind Curve',       default: 0.6, min: 0.0, max: 1.5, step: 0.05, desc: 'Per-region wind angle range; 0 = parallel dunes' },
  { key: 'rippleStrength',  label: 'Ripple Strength',  default: 0.04, min: 0.00, max: 0.20, step: 0.01, desc: 'Cross-ripple amplitude on dune flanks' },
];

// 72% of each wavelength is the gentle windward (stoss) climb; the
// remaining 28% is the steep lee/slip-face drop right past the crest.
const STOSS_FRAC = 0.72;

/**
 * The core asymmetric dune cross-section, isolated from the wind-angle
 * rotation/warp so its own shape can be verified directly (a raw scan
 * across the full, rotated+warped `fn()` doesn't reliably show the
 * asymmetry at every cross-section -- the slowly-varying wind angle can
 * cut a scan line at a shallow angle to the crest, distorting the
 * apparent local slope ratio; this pure function is not subject to that).
 * `frac` is position within one wavelength, [0,1). Exported for direct
 * testing.
 */
export function _duneCrossSection(frac, crestSharpness) {
  const wrapped = frac - Math.floor(frac);
  const tri = wrapped < STOSS_FRAC
    ? wrapped / STOSS_FRAC // 0 -> 1, gentle climb
    : 1 - (wrapped - STOSS_FRAC) / (1 - STOSS_FRAC); // 1 -> 0, STEEP drop
  return Math.pow(Math.max(0, tri), crestSharpness);
}

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const crestSharpness = t.crestSharpness ?? 1.8;
  const windCurve      = t.windCurve      ?? 0.6;
  const rippleStrength = t.rippleStrength ?? 0.04;

  // Per-region wind direction (slow variation across surface)
  const angleN = noiseWarp.fbm(su * 0.4, sv * 0.4, 2);
  const ang = angleN * Math.PI * windCurve;
  const ca = Math.cos(ang), sa = Math.sin(ang);

  // Coordinate warp for organic dune undulation
  const wx = noiseWarp.fbm(su * 1.2, sv * 1.2, 3) * (warpIntensity * 1.5);
  const wy = noiseWarp.fbm(su * 1.2 + 5, sv * 1.2 + 9, 3) * (warpIntensity * 1.5);

  // Strong anisotropy: u carries the dune-perpendicular axis,
  // v is compressed 5× so dunes run far in their flow direction.
  const u = ((su + wx) * ca - (sv + wy) * sa) * scale * 1.6;
  const v = ((su + wx) * sa + (sv + wy) * ca) * scale * 0.30;

  // ── 1. ASYMMETRIC DUNE PROFILE (stoss climb, lee drop) ──────────────
  const phase = u + noiseFine.fbm(u * 0.3, v * 0.3, 3) * 1.6;
  const frac = phase / (Math.PI * 2);
  const sharpened = _duneCrossSection(frac, crestSharpness);
  const dunes = sharpened * 0.62; // "enough height to carve" (T78)

  // ── 2. CROSS-RIPPLES ───────────────────────────────────────────────
  const rippleF = scale * 24.0;
  const ripples = Math.pow(Math.abs(Math.sin(v * rippleF + noiseFine.noise2(u, v) * 1.2)), 2.0) * rippleStrength * sharpened;

  // ── 3. WIND-BLOWN SAND GRAIN ───────────────────────────────────────
  const grain = (noiseFine.fbm(u * 8.0, v * 8.0, 3) + 1) * 0.5 * 0.04;

  return dunes + ripples + grain;
};
