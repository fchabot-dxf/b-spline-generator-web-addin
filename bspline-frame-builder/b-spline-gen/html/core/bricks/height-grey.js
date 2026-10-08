/**
 * core/bricks/height-grey.js — PORTABLE (no DOM). Fred, 2026-10-08 ("Yes, grey only", on seat D's mock
 * shots/seatD/agrey/grey_by_height_mock.png): bricks read in GREYS from their carve height, never in a set colour --
 * lighter = higher (a raised accent, a Raised-brush piece), darker = lower (the joint recess). ONE ramp, used by:
 *   - the 2D editor: per point, from the height mask the 3D carves (editor/brick-height-grey.js);
 *   - the SVG download: one flat grey per brick, its face height (editor/svg-export.js).
 * The ramp is in board INCHES of carve height (the mask's body x its layer depth). MEASURED on the mock's T1 scene
 * (Raised, 3/4 in): joints -0.05, plain faces ~0.12, raised accents / Raised-brush tops 0.19-0.21.
 * `neutralIn`: the grey a brick shows before its height is known (no mask yet after a lay) -- a plain face.
 */
export const HEIGHT_GREY_RAMP = Object.freeze({ lowIn: -0.06, highIn: 0.22, dark: 40, light: 235, neutralIn: 0.12 });

/** The grey level 0..255 of a carve height (inches), clamped to the ramp. */
export function greyLevel(heightIn, ramp = HEIGHT_GREY_RAMP) {
  const t = (Number(heightIn) - ramp.lowIn) / (ramp.highIn - ramp.lowIn);
  const c = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  return Math.round(ramp.dark + c * (ramp.light - ramp.dark));
}

const _hex = (v) => v.toString(16).padStart(2, '0');
/** The grey of a carve height as a CSS colour (#rrggbb). */
export function greyOfHeight(heightIn, ramp = HEIGHT_GREY_RAMP) {
  const v = greyLevel(heightIn, ramp);
  return `#${_hex(v)}${_hex(v)}${_hex(v)}`;
}

/** A brick before its height is known. */
export const NEUTRAL_BRICK_GREY = greyOfHeight(HEIGHT_GREY_RAMP.neutralIn);
/** A joint before its height is known (Fred 2026-10-08: "the SVG has different greys for grout and brick"): the ramp's
 *  low end -- a joint sits below the faces. */
export const NEUTRAL_GROUT_GREY = greyOfHeight(HEIGHT_GREY_RAMP.lowIn);

/** A height mask (body[j*nx + i], row 0 = the board BOTTOM; 0 = no brick / joint there) as RGBA pixels, row 0 = the
 *  board TOP (an image's own order): each point's grey of body x `scaleIn` (the layer depth); transparent where 0. */
export function heightGreyPixels(body, scaleIn, nx, nz, ramp = HEIGHT_GREY_RAMP) {
  const out = new Uint8ClampedArray(nx * nz * 4);
  for (let j = 0; j < nz; j++) {
    const o0 = (nz - 1 - j) * nx;
    for (let i = 0; i < nx; i++) {
      const v = body[j * nx + i];
      if (v === 0) continue;
      const g = greyLevel(v * scaleIn, ramp), o = (o0 + i) * 4;
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
    }
  }
  return out;
}
