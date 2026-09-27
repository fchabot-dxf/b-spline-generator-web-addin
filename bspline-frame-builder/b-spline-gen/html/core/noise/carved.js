/**
 * Hand-Carved (T79 item 1): gentle hills finished with shallow scalloped
 * gouge facets, like hand-tooled wood. Built from Fred's approved prototype
 * (proto-filters/protoCarved.js, "N5"); at seed 42 and default settings it
 * reproduces the approved look, apart from the fixes below.
 *
 * The gouges are cells stretched along a grain direction that turns slowly
 * across the board. Fixes vs the prototype: the cell lattice follows the
 * seed (cells.js latticeSalt), and the mirror line is flat (mirror-seam.js).
 */
import { cells, latticeSalt } from './cells.js';
import { mirrorSeam } from './mirror-seam.js';

export const id = 'carved';
export const label = 'Hand-Carved';
export const cMultiplier = 2.5;

const APPROVED_SALT = 4;
const MIRROR_BAND = 0.04; // su

export const tweaks = [
  { key: 'gougeSize',  label: 'Gouge Size',  default: 1.0,  min: 0.4, max: 2.5, step: 0.05, desc: 'Size of each gouge (larger = fewer, bigger scoops)' },
  { key: 'gougeDepth', label: 'Gouge Depth', default: 0.09, min: 0.0, max: 0.25, step: 0.01, desc: 'How deep the scoops cut into the hills' },
  { key: 'grainTurn',  label: 'Grain Turn',  default: 1.2,  min: 0.0, max: 3.0, step: 0.1,  desc: 'How much the gouge direction turns across the board' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, roughness, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const gougeSize = t.gougeSize ?? 1.0;
  const gougeDepth = t.gougeDepth ?? 0.09;
  const grainTurn = t.grainTurn ?? 1.2;
  const salt = latticeSalt(APPROVED_SALT, params.seed);

  const sample = (s) => {
    const f = scale * 1.1, x = s * f * aspect, z = sv * f;
    const base = (noiseFine.fbm(x * 0.7, z * 0.7, 3, 2.0, roughness) + 1) * 0.5;
    // Elongated gouges: cells stretched along a slowly turning grain.
    const ang = 0.6 + grainTurn * noiseWarp.noise2(x * 0.2 + 3, z * 0.2 + 5) * warpIntensity;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const gx = (x * ca + z * sa) * 2.2 / gougeSize, gz = (-x * sa + z * ca) * 5.0 / gougeSize;
    const c = cells(gx, gz, salt, 0.9);
    const dish = Math.pow(Math.min(1, c.f1 / 0.75), 2); // concave scoop, crisp shallow ridge where scoops meet
    return base * 0.8 + dish * gougeDepth;
  };
  return mirrorSeam(sample, su, MIRROR_BAND);
};
