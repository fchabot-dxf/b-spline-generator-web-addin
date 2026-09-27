/**
 * River Stones (T79 item 2): rounded stones of varied size nested in smooth
 * ground. Built from Fred's approved prototype (proto-filters/
 * N3_protoRiver.js); at seed 42 and default settings it reproduces the
 * approved look, apart from the fixes below.
 *
 * Fixes vs the prototype:
 *   - dotted/stepped stone rims, two causes: the dome profile sqrt(1 - r^2)
 *     meets the ground in a vertical wall far narrower than the mesh, and
 *     each stone's height (scaled by its cell's id) stepped where the
 *     nearest cell switched between two touching stones. The rim now ends in
 *     a fillet at least MIN_RIM_CELLS mesh cells wide, and the per-stone
 *     height uses the smoothly weighted id (cells.js smoothF1 idSmooth);
 *   - the cell lattice follows the seed (cells.js latticeSalt);
 *   - the mirror line is flat (mirror-seam.js).
 */
import { smoothF1, latticeSalt, meshCellsInLattice } from './cells.js';
import { mirrorSeam } from './mirror-seam.js';

export const id = 'river';
export const label = 'River Stones';
export const cMultiplier = 2.5;

const APPROVED_SALT = 1;
const MIRROR_BAND = 0.04; // su
const MIN_RIM_CELLS = 3;  // rim fillet width, in mesh cells
const ID_BLEND_CELLS = 3; // stone heights blend across a boundary over this many mesh cells

export const tweaks = [
  { key: 'stoneSize',      label: 'Stone Size',      default: 1.0, min: 0.5, max: 2.2, step: 0.05, desc: 'Size of the stones' },
  { key: 'stoneHeight',    label: 'Stone Height',    default: 0.3, min: 0.0, max: 0.6, step: 0.01, desc: 'How far the stones rise out of the ground' },
  { key: 'groundSoftness', label: 'Ground Softness', default: 0.0, min: 0.0, max: 0.4, step: 0.01, desc: 'Extra softening where stones meet the ground (the rim is always at least 3 mesh cells wide, so it renders clean)' },
];

// The approved dome, sqrt(1 - r^2) (r = 0 at the stone's middle, 1 at its
// rim), meets the ground in a vertical wall. Within `w` of the rim it is
// replaced by a cubic that reaches 0 at the rim with zero slope and joins
// the dome in value and slope at r = 1 - w; inside that, unchanged.
function rimProfile(r, w) {
  if (r >= 1) return 0;
  if (w <= 0 || r <= 1 - w) return Math.sqrt(1 - r * r);
  const r1 = 1 - w;
  const y1 = Math.sqrt(1 - r1 * r1);
  const g = (r1 * w) / y1; // the dome's slope at r1, per unit of t
  const t = (1 - r) / w;
  return (3 * y1 - g) * t * t + (g - 2 * y1) * t * t * t;
}
export const _rimProfile = rimProfile;

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, roughness, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const stoneSize = t.stoneSize ?? 1.0;
  const stoneHeight = t.stoneHeight ?? 0.3;
  const salt = latticeSalt(APPROVED_SALT, params.seed);
  // Rim fillet width in r units (r spans 0.75 lattice units): at least
  // MIN_RIM_CELLS mesh cells of the real board, or the slider's if wider.
  const unitsPerSu = (scale * 0.9 * aspect * 1.4) / stoneSize;
  const rim = Math.min(0.9, Math.max(meshCellsInLattice(params, unitsPerSu, MIN_RIM_CELLS) / 0.75, t.groundSoftness ?? 0));
  // Neighbouring weights fall to ~5% within 3/idK of the boundary, so this
  // keeps each stone's own height except in a band ID_BLEND_CELLS wide.
  const idK = 3 / meshCellsInLattice(params, unitsPerSu, ID_BLEND_CELLS);

  const sample = (s) => {
    const f = scale * 0.9, x = s * f * aspect, z = sv * f;
    const base = (noiseFine.fbm(x * 0.5, z * 0.5, 2, 2.0, roughness) + 1) * 0.5;
    const w = 0.3 * warpIntensity;
    const wx = noiseWarp.noise2(x * 0.8 + 5, z * 0.8 + 1) * w, wz = noiseWarp.noise2(x * 0.8 + 2, z * 0.8 + 8) * w;
    const c = smoothF1((x + wx) * 1.4 / stoneSize, (z + wz) * 1.4 / stoneSize, salt, 7, 0.85, idK);
    const r = Math.min(1, Math.max(0, (c.d + 0.25) / 0.75));
    const stone = rimProfile(r, rim) * (0.6 + 0.4 * c.idSmooth);
    return base * 0.45 + stone * stoneHeight;
  };
  return mirrorSeam(sample, su, MIRROR_BAND);
};
