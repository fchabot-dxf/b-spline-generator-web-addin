/**
 * Dunes (Wind-Sculpted Sand) 🏜️🌬️
 * Long parallel sand crests with smooth windward face and steeper lee
 * face, fine cross-ripples on the flanks, and per-region wind
 * direction so the dunes curve across the field.
 *
 * Composition:
 *   1. Anisotropic wave   — sin of compressed coordinate gives long
 *                           parallel crests (V-axis 5× compressed).
 *   2. Asymmetric profile — pow + lee-face softening produces the
 *                           characteristic dune cross-section.
 *   3. Cross-ripples      — high-freq sin perpendicular to the wind.
 *   4. Wind-blown grain   — fine FBM micro-texture.
 */
export const id = 'dunes';
export const label = 'Wind Dunes';
export const cMultiplier = 2.0;

export const tweaks = [
  { key: 'crestSharpness',  label: 'Crest Sharpness',  default: 1.8, min: 0.8, max: 4.0, step: 0.1, desc: 'Higher = pointier dune crests' },
  { key: 'windCurve',       label: 'Wind Curve',       default: 0.6, min: 0.0, max: 1.5, step: 0.05, desc: 'Per-region wind angle range; 0 = parallel dunes' },
  { key: 'rippleStrength',  label: 'Ripple Strength',  default: 0.04, min: 0.00, max: 0.20, step: 0.01, desc: 'Cross-ripple amplitude on dune flanks' },
];

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

  // ── 1. CREST WAVE ──────────────────────────────────────────────────
  const phase = u + noiseFine.fbm(u * 0.3, v * 0.3, 3) * 1.6;
  const wave = (Math.sin(phase) + 1) * 0.5;
  const sharpened = Math.pow(wave, crestSharpness);

  // ── 2. ASYMMETRIC LEE FACE ─────────────────────────────────────────
  const slope = Math.cos(phase + 0.3);
  const lee = slope > 0 ? 1.0 : Math.max(0, 1.0 + slope * 0.5);
  const dunes = sharpened * lee * 0.45;

  // ── 3. CROSS-RIPPLES ───────────────────────────────────────────────
  const rippleF = scale * 24.0;
  const ripples = Math.pow(Math.abs(Math.sin(v * rippleF + noiseFine.noise2(u, v) * 1.2)), 2.0) * rippleStrength * sharpened;

  // ── 4. WIND-BLOWN SAND GRAIN ───────────────────────────────────────
  const grain = (noiseFine.fbm(u * 8.0, v * 8.0, 3) + 1) * 0.5 * 0.04;

  return dunes + ripples + grain;
};
