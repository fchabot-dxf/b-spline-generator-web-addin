/**
 * Pond Ripples (T79 item 2): calm soft ground with a few sets of concentric
 * ripples spreading and interfering. Built from Fred's approved prototype
 * (proto-filters/N6_protoRipple.js); at seed 42 and default settings it
 * reproduces the approved look, apart from the fixes below.
 *
 * Each drop is a cell point; its rings are a decaying cosine of the distance
 * to it. Fixes vs the prototype:
 *   - creases where rings from two drops met: each sample took its rings from
 *     the nearest drop only, so they met at an angle along the cell boundary.
 *     Near a boundary the two nearest drops' rings are now blended, 50/50 on
 *     the boundary itself, so the surface stays smooth across it; away from
 *     boundaries it is the prototype's value exactly;
 *   - the drop lattice follows the seed (cells.js latticeSalt);
 *   - the mirror line is flat (mirror-seam.js).
 */
import { cells, latticeSalt, meshCellsInLattice } from './cells.js';
import { mirrorSeam } from './mirror-seam.js';

export const id = 'ripples';
export const label = 'Pond Ripples';
export const cMultiplier = 2.5;
// the photo layer's "Filter shows through" normalises this filter's output by its declared span (core/terrain.js):
// MEASURED 2026-10-10 (seat A), default tweaks, 8 seeds x 7x9 / 9x12 / 12x9 boards, the 0.5 / 99.5 percentiles.
export const nominalRange = [0.24, 0.57];

const MIRROR_BAND = 0.04;     // su
const BOUNDARY_BLEND = 0.05;  // lattice units at the cell boundary...
const MIN_BLEND_CELLS = 3;    // ...but never narrower than this many mesh cells
// Two drop layers with different spacing: [lattice scale, approved salt].
const LAYERS = [[0.45, 2], [0.7, 7]];

export const tweaks = [
  { key: 'ringSpacing', label: 'Ring Spacing', default: 1.0,  min: 0.5, max: 2.5, step: 0.05, desc: 'Distance between neighbouring rings' },
  { key: 'ringDepth',   label: 'Ring Depth',   default: 0.09, min: 0.0, max: 0.2, step: 0.01, desc: 'Height of the ripples' },
  { key: 'dropCount',   label: 'Drop Count',   default: 1.0,  min: 0.4, max: 2.5, step: 0.05, desc: 'How many ripple centres (relative)' },
];

function smoothstep01(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, roughness, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const ringFreq = 20.0 / (t.ringSpacing ?? 1.0);
  const ringDepth = t.ringDepth ?? 0.09;
  const density = Math.sqrt(t.dropCount ?? 1.0);

  const sample = (s) => {
    const f = scale * 0.6, x = s * f * aspect, z = sv * f;
    const base = (noiseFine.fbm(x * 0.8, z * 0.8, 2, 2.0, roughness) + 1) * 0.5;
    let r = 0;
    for (const [k0, approvedSalt] of LAYERS) {
      const k = k0 * density;
      const c = cells(x * k, z * k, latticeSalt(approvedSalt, params.seed), 0.9);
      const wob = noiseWarp.noise2(x * 0.7 + approvedSalt, z * 0.7) * 0.25 * warpIntensity;
      const rings = (d, id) => Math.cos((d + wob) * ringFreq) * Math.exp(-d * 0.55) * (0.6 + 0.4 * id);
      const band = Math.max(BOUNDARY_BLEND, meshCellsInLattice(params, f * aspect * k, MIN_BLEND_CELLS));
      const second = 0.5 * (1 - smoothstep01(0, band, c.f2 - c.f1));
      r += (1 - second) * rings(c.f1 / k, c.id) + second * rings(c.f2 / k, c.id2);
    }
    return base * 0.4 + r * ringDepth + 0.2;
  };
  return mirrorSeam(sample, su, MIRROR_BAND);
};
