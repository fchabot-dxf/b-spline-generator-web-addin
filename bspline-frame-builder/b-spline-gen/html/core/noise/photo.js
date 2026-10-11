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
 * time this function ever sees su/sv, the fold has already happened. fn()
 * stays a PURE function of (su, sv, params) -- whatever extra sampling math
 * it does internally (below), two mirror-equivalent (su, sv) pairs are
 * IDENTICAL by construction once folded, so they always produce identical
 * output. Symmetry composition is a property of that purity, not of
 * anything this file has to track (tests/photo-symmetry.test.js proves it
 * through the real generateHeightmap, not just asserted here).
 *
 * EFFECT PARAMS (Fred, "add parameters" -- separate from the photo EDITOR's
 * own crop/rotate/flip/levels/etc., which prepare the image itself):
 * declared the same way every other filter declares its own knobs, the
 * generic `tweaks` schema (core/noise/tweaks-ui.js's own Edit-Filter panel),
 * not a bespoke UI. Depth/Scale/OffsetX/OffsetY/Rotation/Repeat all act at
 * SAMPLE TIME on the already-processed image, cheap to re-tune live without
 * re-running the (heavier) crop/levels/blur edit pipeline.
 *   depth    — relief-strength multiplier around mid-grey (1 = unchanged).
 *   scale    — zoom of the photo on the board (matches mapZoom's own "bigger
 *              value = bigger features" convention).
 *   offsetX/Y— pan the photo on the board, independent of the global
 *              seedOffsetX/Y (which pans the whole drawing, all filters).
 *              Range mirrors symOffsetX/Y's own declared -0.45..0.45 convention
 *              (core/state.js's own comment on those).
 *   rotation — rotate the SAMPLING coordinates (degrees) -- the photo
 *              appears rotated on the board without re-decoding it.
 *   repeat   — 0/1 toggle (the generic tweaks schema is numeric-only, so a
 *              step=1 0..1 slider IS the checkbox here): off clamps
 *              out-of-frame sampling to the image edge (a single placed
 *              photo); on tiles it, so a brick/pebble photo fills the board
 *              as a repeating pattern.
 *
 * NEVER STRETCH (Fred: "a brick must never look stretched, whatever the
 * board size or shape" -- map the image to the board with ONE uniform
 * scale, never separate x/y scales): su/sv alone are board-FRACTION
 * coordinates (0..1 over widthIn x heightIn), so sampling the image
 * directly at (su, sv) would squash it to the board's own aspect ratio.
 * Every other filter avoids exactly this for its own noise frequency via
 * `su * aspect` (e.g. simplex.js's own sfx/sfz) -- same fix applied here:
 * work in an ISOTROPIC board-unit space (1 unit = the same physical
 * distance in X and Y) for the rotate/scale/offset tweaks, then place the
 * image into that space with ONE "cover" scale (like CSS background-size:
 * cover -- the image fills the whole board, centred, cropping whichever
 * axis has excess) instead of two independent per-axis scales.
 */
import { getProcessedPhotoImage } from '../photo/state.js';

export const id = 'photo';
export const label = 'Photo';
// A conventional mid-range value (matches 'simplex', the other "smooth,
// non-fractal-weird" filter) -- cMultiplier only scales the FILTER-
// INDEPENDENT coarse-redistribution pass (terrain.js Pass 2), not this
// function's own output, so there is no photo-specific reason to differ.
export const cMultiplier = 2.5;
// 2026-10-10 (Fred: the photo as its own LAYER on top of the chosen filter): not a filter choice any more -- the board's
// filter (P.noiseType) stays selectable and the photo samples on top of it (core/terrain.js photoLayer). Registered here
// still: the layer samples this fn, and a save from before the layer (noiseType 'photo') is migrated (app-init.js).
export const layerOnly = true;

export const tweaks = [
  { key: 'depth', label: 'Depth', default: 1.0, min: 0.3, max: 2.0, step: 0.05, desc: 'Relief strength around mid-grey (1 = unchanged)' },
  { key: 'scale', label: 'Scale', default: 1.0, min: 0.3, max: 3.0, step: 0.05, desc: 'Zoom of the photo on the board (bigger = larger features)' },
  { key: 'offsetX', label: 'Offset X', default: 0, min: -0.45, max: 0.45, step: 0.01, desc: 'Pan the photo left/right on the board' },
  { key: 'offsetY', label: 'Offset Y', default: 0, min: -0.45, max: 0.45, step: 0.01, desc: 'Pan the photo up/down on the board' },
  { key: 'rotation', label: 'Rotation', default: 0, min: -180, max: 180, step: 1, desc: 'Rotate the photo on the board (degrees)' },
  { key: 'repeat', label: 'Repeat', default: 0, min: 0, max: 1, step: 1, desc: 'Tile the photo across the board (0 = off, 1 = on)' },
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const wrap01 = (v) => ((v % 1) + 1) % 1;

// The sample-independent values of one heightmap (one params object, one processed image, one aspect): read once,
// not per sample -- seat D 2026-10-08 (phone, Photo blur drag: this sampler was about half of each 384-wide backdrop
// heightmap). The same values in the same arithmetic, so the output is unchanged (tests/heightmap-golden.test.js).
let _k = null;
function constantsFor(params, img, aspect) {
  if (_k && _k.params === params && _k.img === img && _k.aspect === aspect) return _k;
  const t = params.tweaks ?? {};
  const rotation = (t.rotation ?? 0) * Math.PI / 180;
  _k = {
    params, img, aspect,
    depth: t.depth ?? 1.0,
    scale: t.scale || 1.0, // guard against 0 from a stray override (would divide by zero below)
    offsetX: t.offsetX ?? 0,
    offsetY: t.offsetY ?? 0,
    rotation,
    cs: Math.cos(-rotation), sn: Math.sin(-rotation),
    repeat: (t.repeat ?? 0) >= 0.5,
    // 2026-10-10 (seat A, MEASURED with a marker photo): the heightmap's row 0 is the board's FRONT (core/coords.js
    // COORD_SYSTEM: the bottom of the drawing; the art's masks and the 2D backdrop agree), but the image's row 0 is its
    // TOP -- so the photo sat upside-down on the board, in 2D, 3D and the STEP alike. 'upright' samples the board in a
    // y-down frame (sv -> 1 - sv); anything else (an older board, params without the key) is the legacy flip, its
    // heights byte-identical (core/state.js photoOrientation, main/app-init.js MIGRATIONS 'photo-orientation').
    upright: params.photoOrientation === 'upright',
    // COVER: the one uniform units-per-pixel scale that makes the image fill the whole board without separate x/y
    // stretch -- the larger of the two per-axis requirements wins (same logic as CSS background-size: cover).
    unitsPerPixel: Math.max(aspect / img.w, 1 / img.h),
  };
  return _k;
}

/**
 * 2026-10-10 (seat A + seat D: the on-board footprint gizmo and the preview's "not sampled" overlay): the ONE mapping
 * fn samples with, exported -- the pixel fn reads for sample point (su, sv), or -1 with no image. `params` as the
 * sampler gets them: P with `tweaks` = P.filterTweaks.photo (core/terrain.js photoParams). Cheap per call: the
 * per-heightmap constants are cached on (params, img, aspect), as for fn.
 */
export function photoPixelAt(su, sv, aspect, params, img) {
  if (!img || !img.w || !img.h) return -1;
  const { scale, offsetX, offsetY, rotation, cs, sn, repeat, unitsPerPixel, upright } = constantsFor(params, img, aspect);
  if (upright) sv = 1 - sv;

  // Isotropic board-unit space: the board spans [-aspect/2, aspect/2] x
  // [-0.5, 0.5] here, so one unit is the SAME physical distance in both
  // directions (su is widened by `aspect`, sv is not -- same convention
  // simplex.js's own sfx/sfz already use for its own frequency).
  let bx = (su - 0.5) * aspect, by = sv - 0.5;
  if (rotation !== 0) {
    // Rotate the SAMPLE point by -rotation around the board centre, so the
    // photo itself appears to turn by +rotation (standard "rotate the
    // lookup, not the content" trick -- same reasoning terrain.js's own
    // seedRotation uses for the coarse field, Pass 2).
    const rbx = bx * cs - by * sn;
    const rby = bx * sn + by * cs;
    bx = rbx; by = rby;
  }
  bx = bx / scale + offsetX * aspect;
  by = by / scale + offsetY;

  let u = 0.5 + bx / unitsPerPixel / img.w;
  let v = 0.5 + by / unitsPerPixel / img.h;
  u = repeat ? wrap01(u) : clamp01(u);
  v = repeat ? wrap01(v) : clamp01(v);

  const x = Math.min(img.w - 1, Math.max(0, Math.floor(u * img.w)));
  const y = Math.min(img.h - 1, Math.max(0, Math.floor(v * img.h)));
  return y * img.w + x;
}

/** The inverse of photoPixelAt's continuous part (before repeat / clamp): an IMAGE point (u, v), 0..1 over the
 *  processed (cropped) image, -> the sample point (su, sv) it lands on. The same constants, the steps undone in
 *  reverse order. For the on-board footprint (its corners: u, v in {0, 1}). */
export function photoSampleOf(u, v, aspect, params, img) {
  const { scale, offsetX, offsetY, rotation, cs, sn, unitsPerPixel, upright } = constantsFor(params, img, aspect);
  const rx = ((u - 0.5) * unitsPerPixel * img.w - offsetX * aspect) * scale;
  const ry = ((v - 0.5) * unitsPerPixel * img.h - offsetY) * scale;
  // the forward rotation is [cs -sn; sn cs] (cs = cos(-rotation), sn = sin(-rotation)); its inverse is the transpose
  const bx = rotation !== 0 ? rx * cs + ry * sn : rx;
  const by = rotation !== 0 ? -rx * sn + ry * cs : ry;
  return { su: 0.5 + bx / aspect, sv: upright ? 0.5 - by : 0.5 + by };
}

export const fn = (su, sv, aspect, params) => {
  const img = getProcessedPhotoImage(params);
  if (!img || !img.w || !img.h) return 0.5; // no photo loaded (or still decoding): flat, neutral
  const raw = img.data[photoPixelAt(su, sv, aspect, params, img)];
  return clamp01(0.5 + (raw - 0.5) * constantsFor(params, img, aspect).depth);
};
