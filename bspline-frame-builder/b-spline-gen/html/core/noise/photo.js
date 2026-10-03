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
 */
import { getProcessedPhotoImage } from '../photo/state.js';

export const id = 'photo';
export const label = 'Photo';
// A conventional mid-range value (matches 'simplex', the other "smooth,
// non-fractal-weird" filter) -- cMultiplier only scales the FILTER-
// INDEPENDENT coarse-redistribution pass (terrain.js Pass 2), not this
// function's own output, so there is no photo-specific reason to differ.
export const cMultiplier = 2.5;

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

export const fn = (su, sv, aspect, params) => {
  const img = getProcessedPhotoImage(params);
  if (!img || !img.w || !img.h) return 0.5; // no photo loaded (or still decoding): flat, neutral

  const t = params.tweaks ?? {};
  const depth = t.depth ?? 1.0;
  const scale = t.scale || 1.0; // guard against 0 from a stray override (would divide by zero below)
  const offsetX = t.offsetX ?? 0;
  const offsetY = t.offsetY ?? 0;
  const rotation = (t.rotation ?? 0) * Math.PI / 180;
  const repeat = (t.repeat ?? 0) >= 0.5;

  let du = su - 0.5, dv = sv - 0.5;
  if (rotation !== 0) {
    // Rotate the SAMPLE point by -rotation around the board centre, so the
    // photo itself appears to turn by +rotation (standard "rotate the
    // lookup, not the content" trick -- same reasoning terrain.js's own
    // seedRotation uses for the coarse field, Pass 2).
    const cs = Math.cos(-rotation), sn = Math.sin(-rotation);
    const rdu = du * cs - dv * sn;
    const rdv = du * sn + dv * cs;
    du = rdu; dv = rdv;
  }
  let u = 0.5 + du / scale + offsetX;
  let v = 0.5 + dv / scale + offsetY;
  u = repeat ? wrap01(u) : clamp01(u);
  v = repeat ? wrap01(v) : clamp01(v);

  const x = Math.min(img.w - 1, Math.max(0, Math.floor(u * img.w)));
  const y = Math.min(img.h - 1, Math.max(0, Math.floor(v * img.h)));
  const raw = img.data[y * img.w + x];
  return clamp01(0.5 + (raw - 0.5) * depth);
};
