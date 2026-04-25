/**
 * Woven (Textile) 🧵🪡
 * Explicit warp-and-weft cloth weave with checkerboard over/under.
 * The only filter in the set with deliberately ORTHOGONAL grid bias.
 *
 * Composition:
 *   1. Round-rod thread cross-sections (sin² profile).
 *   2. Per-cell checkerboard mask: at each crossing one thread is on
 *      top, the other dips beneath. Alternates over the surface.
 *   3. Slubs — slow FBM thickness variation along threads.
 *   4. Fiber roughness — micro-FBM over the threads.
 *
 * Slight domain warp keeps it from looking laser-cut: the cloth has
 * a hand-loomed wobble.
 *
 * Mill note: the checkerboard pattern is height-modulated (not just
 * shaded), so the over-thread sticks slightly proud of the under
 * one — the carved result will actually feel woven under fingers.
 */
export const id = 'woven';
export const label = 'Woven Textile';
export const cMultiplier = 3.5;

export const tweaks = [
  { key: 'threadDensity', label: 'Thread Density',  default: 13.0, min: 5.0, max: 30.0, step: 0.5, desc: 'Threads per unit; higher = finer weave' },
  { key: 'underContrast', label: 'Under Contrast',  default: 0.55, min: 0.20, max: 0.95, step: 0.05, desc: 'Height of dipped threads (1.0 = flat weave)' },
  { key: 'slubAmount',    label: 'Slub Amount',     default: 0.12, min: 0.00, max: 0.30, step: 0.01, desc: 'Hand-loomed thickness variation' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const threadDensity = t.threadDensity ?? 13.0;
  const underContrast = t.underContrast ?? 0.55;
  const slubAmount    = t.slubAmount    ?? 0.12;

  const threadF = scale * threadDensity;

  // Subtle handmade-cloth wobble
  const wx = noiseWarp.fbm(su * 1.2, sv * 1.2, 2) * (warpIntensity * 0.30);
  const wy = noiseWarp.fbm(su * 1.2 + 4, sv * 1.2 + 6, 2) * (warpIntensity * 0.30);

  const u = (su + wx) * threadF * aspect;
  const v = (sv + wy) * threadF;

  // Round thread cross-sections (warp = vertical, weft = horizontal)
  const warpProf = Math.pow(Math.sin(u * Math.PI), 2);
  const weftProf = Math.pow(Math.sin(v * Math.PI), 2);

  // Checkerboard over/under
  const cellU = Math.floor(u);
  const cellV = Math.floor(v);
  const warpOver = ((cellU + cellV) & 1) === 0;

  const warpH = warpProf * (warpOver ? 1.0 : underContrast);
  const weftH = weftProf * (warpOver ? underContrast : 1.0);
  const cloth = Math.max(warpH, weftH) * 0.42;

  // Slub thickness variation along thread length
  const slubRaw = (noiseFine.fbm(u * 0.3, v * 0.3, 3) + 1) * 0.5;
  const slub = (slubRaw - 0.5) * slubAmount;

  // Micro fiber grain on threads
  const fiber = noiseFine.fbm(u * 4.0, v * 4.0, 3) * 0.04;

  return cloth + slub + fiber;
};
