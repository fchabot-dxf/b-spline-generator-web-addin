/**
 * core/stamp/soften.js -- the ONE footprint softening ("Soften edges", inches): a Gaussian blur of a stamp's body, its
 * coverage grown to where the blur reaches. Born as the STL's edge softness (core/stl/layer.js passBody, rec.softness);
 * shared since Fred 2026-11-27 with the height patches (rec.softness) and the bricks (P.brickSettings.softness), so every
 * soften is this function. A Draw / Lattice layer's card row edits its own Edge fillet (the rasterizer's edge roll-off), not this.
 */
import { gaussianSmooth } from '../gaussian.js';

/** `body` blurred by `softnessIn` (sigma in inches; the grid spacing = widthIn / (nx - 1)) and `covered` grown to where the
 *  blurred body is above 1e-4. softnessIn <= 0: the SAME arrays back (nothing is computed). Inputs are never written. */
export function softenBody(body, covered, softnessIn, { nx, nz, widthIn }) {
  if (!(softnessIn > 0)) return { body, covered };
  const sigma = softnessIn / (widthIn / (nx - 1));
  const out = gaussianSmooth(body, nx, nz, sigma);
  return { body: out, covered: Uint8Array.from(covered, (c, k) => (c || out[k] > 1e-4 ? 1 : 0)) };
}
