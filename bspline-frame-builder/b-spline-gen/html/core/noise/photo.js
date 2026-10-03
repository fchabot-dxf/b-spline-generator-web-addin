/**
 * Photo (F34 item 1): the terrain's height source is a real photo instead
 * of procedural noise. "Light = high" by default (dispatch's own wording) --
 * the processed greyscale image IS the 0..1 value this fn returns, sampled
 * at (su, sv) exactly like every other filter samples noise there.
 *
 * SYMMETRY (Fred, dispatch): "the photo is the SOURCE, the existing
 * Symmetry setting ... still applies on top ... the photo does NOT
 * override it." This needs ZERO special-casing here: terrain.js folds
 * (su, sv) for Mirror X/Y/quadrant BEFORE calling this fn (terrain.js's own
 * `if (symmetry === 'x' ...) su = Math.abs(zu - mx) * 2` etc.) -- by the
 * time this function ever sees su/sv, the fold has already happened. This
 * fn just samples the processed photo at whatever (su, sv) it is given.
 *
 * Out-of-[0,1] su/sv (from mapZoom/seedOffset, applied upstream the same
 * way for every filter) are CLAMPED to the image edge, not tiled/mirrored --
 * a photo repeating at its own border reads as an obvious seam, unlike
 * tileable procedural noise.
 */
import { getProcessedPhotoImage } from '../photo/state.js';

export const id = 'photo';
export const label = 'Photo';
// A conventional mid-range value (matches 'simplex', the other "smooth,
// non-fractal-weird" filter) -- cMultiplier only scales the FILTER-
// INDEPENDENT coarse-redistribution pass (terrain.js Pass 2), not this
// function's own output, so there is no photo-specific reason to differ.
export const cMultiplier = 2.5;
export const tweaks = [];

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const fn = (su, sv, aspect, params) => {
  const img = getProcessedPhotoImage(params);
  if (!img || !img.w || !img.h) return 0.5; // no photo loaded (or still decoding): flat, neutral
  const x = Math.min(img.w - 1, Math.max(0, Math.floor(clamp01(su) * img.w)));
  const y = Math.min(img.h - 1, Math.max(0, Math.floor(clamp01(sv) * img.h)));
  return img.data[y * img.w + x];
};
