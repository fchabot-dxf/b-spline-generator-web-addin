/**
 * Faceted Stone (T79 item 1): a field of cushioned stone facets over gentle
 * hills. Built from Fred's approved prototype (proto-filters/protoFaceted.js,
 * "N7"); at seed 42 and default settings it reproduces the approved look,
 * apart from the fixes below.
 *
 * Each facet rises from its seams toward its middle, and each gets its own
 * height from its cell id. Fixes vs the prototype:
 *   - dotted / stair-stepped seams: the seam was a V groove far narrower
 *     than the mesh (about 0.04" against 0.05" spacing at default settings),
 *     so the mesh caught it only where it crossed a vertex. The seam bottom
 *     is now a rounded U at least MIN_SEAM_CELLS mesh cells wide, worked out
 *     from the real board, so finer meshes keep crisper seams; beyond that
 *     width the facet is exactly the prototype's;
 *   - the cell lattice follows the seed (cells.js latticeSalt);
 *   - the mirror line is flat (mirror-seam.js).
 */
import { cells, latticeSalt, meshCellsInLattice } from './cells.js';
import { mirrorSeam } from './mirror-seam.js';

export const id = 'faceted';
export const label = 'Faceted Stone';
export const cMultiplier = 2.5;
// the photo layer's "Filter shows through" normalises this filter's output by its declared span (core/terrain.js):
// MEASURED 2026-10-10 (seat A), default tweaks, 8 seeds x 7x9 / 9x12 / 12x9 boards, the 0.5 / 99.5 percentiles.
export const nominalRange = [0.19, 0.62];

const APPROVED_SALT = 1;
const MIRROR_BAND = 0.04; // su
const MIN_SEAM_CELLS = 3;  // seam bottom width, in mesh cells

export const tweaks = [
  { key: 'facetSize',    label: 'Facet Size',    default: 1.0,  min: 0.4, max: 2.5,  step: 0.05, desc: 'Size of each stone facet' },
  { key: 'facetHeight',  label: 'Facet Height',  default: 0.28, min: 0.0, max: 0.5,  step: 0.01, desc: 'How far the facets rise above their seams' },
  { key: 'seamSoftness', label: 'Seam Softness', default: 0.0,  min: 0.0, max: 0.4,  step: 0.01, desc: 'Extra rounding at the bottom of the seams (they are always at least 3 mesh cells wide, so they render clean)' },
];

// The approved facet profile, edge^0.55 (edge = distance from the seam,
// 0..1), has an infinitely steep side at the seam; and since edge itself is
// V-shaped across the seam, any profile with a non-zero slope at 0 still
// leaves a V there. A V crossing the mesh grid at an angle is what drew the
// dotted, stair-stepped seams. Within the seam width (edge < x0) the profile
// is a cubic that reaches 0 at the seam (same depth) with ZERO slope -- a
// rounded U bottom -- and joins edge^0.55 in value and slope at x0; beyond
// x0 it is unchanged.
function cushionProfile(edge, x0) {
  if (x0 <= 0 || edge >= x0) return Math.pow(edge, 0.55);
  const t = edge / x0;
  return Math.pow(x0, 0.55) * t * t * (2.45 - 1.45 * t);
}
export const _cushionProfile = cushionProfile;

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, roughness, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const facetSize = t.facetSize ?? 1.0;
  const facetHeight = t.facetHeight ?? 0.28;
  // Seam bottom width in cell units: at least MIN_SEAM_CELLS mesh cells of
  // the real board, or the slider's extra rounding if that is wider.
  const unitsPerSu = (scale * 0.9 * aspect * 1.4) / facetSize;
  const soft = Math.max(meshCellsInLattice(params, unitsPerSu, MIN_SEAM_CELLS), t.seamSoftness ?? 0);
  const salt = latticeSalt(APPROVED_SALT, params.seed);

  const sample = (s) => {
    const f = scale * 0.9, x = s * f * aspect, z = sv * f;
    const base = (noiseFine.fbm(x * 0.5, z * 0.5, 2, 2.0, roughness) + 1) * 0.5;
    const w = 0.35 * warpIntensity;
    const wx = noiseWarp.noise2(x * 0.8 + 5, z * 0.8 + 1) * w, wz = noiseWarp.noise2(x * 0.8 + 2, z * 0.8 + 8) * w;
    const c = cells((x + wx) * 1.4 / facetSize, (z + wz) * 1.4 / facetSize, salt);
    const edge = Math.min(1, (c.f2 - c.f1) / 0.45);
    const cushion = cushionProfile(edge, soft / 0.45) * (0.7 + 0.3 * c.id);
    return base * 0.5 + cushion * facetHeight + (noiseFine.fbm(x * 5, z * 5, 2) + 1) * 0.008;
  };
  return mirrorSeam(sample, su, MIRROR_BAND);
};
