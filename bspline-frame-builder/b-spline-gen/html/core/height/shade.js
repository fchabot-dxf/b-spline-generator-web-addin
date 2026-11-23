/**
 * height/shade.js -- HEIGHT-PAINTER: the hill-shaded picture of a height patch for the editor canvas (pure). Light from
 * the upper left; raised paint warm, lowered paint cool; an unpainted (0) pixel is fully transparent (0 = no effect on the
 * board), so the drawing / photo / bricks under the patch stay visible. Image row 0 is the patch's TOP (raster rows run
 * up: core/height/layer.js).
 */

import { heightToGrey } from './compose.js';

export const HEIGHT_SHADE = Object.freeze({
  light: Object.freeze([-1, 1, 1.2]),   // toward the light: left, up the board, above
  exaggeration: 4,                      // slopes x this (a 0.05 in bump reads on screen)
  raised: Object.freeze([222, 184, 140]),
  lowered: Object.freeze([140, 176, 222]),
  alpha: 235,
});

/**
 * The canvas LOOKS (slice 5, Fred 2026-11-23: "I thought I selected the value in a palette"): 'lit' = the hill-shade above
 * (the default, unchanged); 'grey' = a classic heightmap -- each pixel's height as grey through the patch's grey mapping
 * (core/height/compose.js heightToGrey: black = the mapping's low end, white = its high end, kept in 0..1), opaque. A 0 pixel
 * (unpainted, or erased: compose.js's transparent 0 -- the two are the same thing) is the mapping's zero grey under a faint
 * checker (`checkerPx` cells lifted `checker` of the way toward white), so "no effect here" shows.
 */
export const HEIGHT_LOOKS = Object.freeze({
  lit: Object.freeze({ label: 'Lit', title: 'Hill-shaded: raised warm, lowered cool; unpainted see-through' }),
  grey: Object.freeze({ label: 'Greyscale', title: 'A heightmap: the height as grey through the patch\'s grey mapping', checkerPx: 6, checker: Object.freeze([0.04, 0.12]) }),
});
/** The display size of a cols x rows raster: at most `maxPx` on its longer side, never larger than the raster. */
export function shadeSize(cols, rows, maxPx) {
  const k = Math.min(1, maxPx / Math.max(cols, rows));
  return { w: Math.max(1, Math.round(cols * k)), h: Math.max(1, Math.round(rows * k)) };
}

/**
 * RGBA pixels (w x h) of raster `data` (cols x rows, inches), `pxPerInX / Y` its density (the slope's scale), sampled
 * nearest. Only output rows y0..y1 (inclusive, image rows) are written when given (a stroke's box); `out` is reused.
 */
export function shadeRaster(data, cols, rows, w, h, pxPerInX, pxPerInY, out = new Uint8ClampedArray(w * h * 4), y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1, { look = 'lit', mapping = null } = {}) {
  if (look === 'grey') return greyRaster(data, cols, rows, w, h, out, y0, y1, x0, x1, mapping);
  const S = HEIGHT_SHADE;
  const L = S.light, ln = Math.hypot(L[0], L[1], L[2]);
  const lx = L[0] / ln, ly = L[1] / ln, lz = L[2] / ln;
  const at = (c, r) => data[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    const r = Math.min(rows - 1, Math.floor(((h - 1 - y) + 0.5) * rows / h));
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      const c = Math.min(cols - 1, Math.floor((x + 0.5) * cols / w));
      const v = at(c, r);
      const o = (y * w + x) * 4;
      if (v === 0 || !Number.isFinite(v)) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; continue; }
      const gx = (at(c + 1, r) - at(c - 1, r)) * 0.5 * pxPerInX * S.exaggeration;
      const gy = (at(c, r + 1) - at(c, r - 1)) * 0.5 * pxPerInY * S.exaggeration;
      const nl = Math.hypot(gx, gy, 1);
      const lambert = Math.max(0, (-gx * lx - gy * ly + lz) / nl);
      const tint = v > 0 ? S.raised : S.lowered;
      const k = 0.35 + 0.65 * lambert;
      out[o] = tint[0] * k; out[o + 1] = tint[1] * k; out[o + 2] = tint[2] * k; out[o + 3] = S.alpha;
    }
  }
  return out;
}

/** The 'grey' look (HEIGHT_LOOKS.grey) of shadeRaster: the same sampling, the height through `mapping` as an opaque grey. */
function greyRaster(data, cols, rows, w, h, out, y0, y1, x0, x1, mapping) {
  const G = HEIGHT_LOOKS.grey;
  const zero = Math.round(255 * Math.min(1, Math.max(0, heightToGrey(0, mapping))));
  const cell = [zero + (255 - zero) * G.checker[0], zero + (255 - zero) * G.checker[1]];
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    const r = Math.min(rows - 1, Math.floor(((h - 1 - y) + 0.5) * rows / h));
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      const c = Math.min(cols - 1, Math.floor((x + 0.5) * cols / w));
      const v = data[r * cols + c];
      const o = (y * w + x) * 4;
      const g = v === 0 || !Number.isFinite(v)
        ? cell[(Math.floor(x / G.checkerPx) + Math.floor(y / G.checkerPx)) % 2] // 0: no effect (the zero grey, checkered)
        : 255 * Math.min(1, Math.max(0, heightToGrey(v, mapping)));
      out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255;
    }
  }
  return out;
}