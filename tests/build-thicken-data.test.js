/**
 * core/engine/build-thicken-data.js -- job-timeline step 3 slice 2 (Fred via advisor 2026-10-16): Back LOCKED
 * freezes the underside (opts.backHeights, core/job-timeline-snapshot.js's own dequantized array) -- the bottom
 * offset point at each cell becomes the CURRENT top point's (x, y) straight down to the frozen z, bypassing the
 * normal safe-map/thin-fill/smoothing pipeline entirely. No prior test file existed for this module -- the
 * "unlocked" tests here are the pin: buildThickenData's existing (legacy) path, called exactly as every caller
 * already did before this slice, with no behavioural change.
 */
import { describe, it, expect } from 'vitest';
import { buildThickenData } from '../bspline-frame-builder/b-spline-gen/html/core/engine/build-thicken-data.js';
import { quantizeHeights, dequantizeHeights } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline-snapshot.js';

const BASE_PARAMS = Object.freeze({
  widthIn: 2, heightIn: 2, thickness: 0.25, thickenEnabled: true,
  thickenMode: 'uniform', thickenDir: 'down', extraThickenThin: 0,
  extraThickenThinFalloff: 0.05, thickenYellowOffset: 0.05,
});
// a flat 3x3 grid (nx=nz=3): no curvature anywhere, so the UNLOCKED path's safe-map/thin-fill/smoothing all settle
// on the simplest case -- straight thickness below every point. This is the "byte-identical to main" pin.
const FLAT_HEIGHTS = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe('buildThickenData: the UNLOCKED (legacy) path is unchanged by the backHeights option existing', () => {
  it('a flat board, thicken on, no backHeights: offset Z is straight thickness below the top, every cell', () => {
    const thicken = buildThickenData(FLAT_HEIGHTS, 3, 3, BASE_PARAMS, {});
    expect(thicken.data).not.toBeNull();
    for (let k = 0; k < 9; k++) {
      expect(thicken.data.offsetPts[k * 3 + 2]).toBeCloseTo(-0.25, 4);
    }
    // clampMap holds the REAL analytical safe-thickness reading on this path (not the backHeights fallback fill)
    expect(thicken.counts).toEqual({ self: 0, topBot: 0, thin: 0 });
  });

  it('thicken disabled: still null data, same as always -- backHeights is simply never reached', () => {
    const thicken = buildThickenData(FLAT_HEIGHTS, 3, 3, { ...BASE_PARAMS, thickenEnabled: false }, { backHeights: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    expect(thicken.data).toBeNull();
  });
});

describe('buildThickenData: Back locked (opts.backHeights present)', () => {
  const FROZEN = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]; // deliberately NOT what the live computation would give

  it('the offset Z at every cell is EXACTLY the frozen value, not the live-computed one', () => {
    const thicken = buildThickenData(FLAT_HEIGHTS, 3, 3, BASE_PARAMS, { backHeights: FROZEN });
    for (let k = 0; k < 9; k++) {
      // offsetPts is a Float32Array -- the frozen float64 literal rounds to its nearest float32 representation
      expect(thicken.data.offsetPts[k * 3 + 2]).toBeCloseTo(FROZEN[k], 4);
    }
  });

  it('the offset X/Y at every cell is the CURRENT top grid\'s own position (the grid doesn\'t move, only the terrain on it does)', () => {
    const thicken = buildThickenData(FLAT_HEIGHTS, 3, 3, BASE_PARAMS, { backHeights: FROZEN });
    // a 3x3 grid over 2x2 inches: x/y steps of 1 in, centred at 0
    const expectedXY = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [0, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ];
    for (let k = 0; k < 9; k++) {
      expect(thicken.data.offsetPts[k * 3 + 0]).toBeCloseTo(expectedXY[k][0], 4);
      expect(thicken.data.offsetPts[k * 3 + 1]).toBeCloseTo(expectedXY[k][1], 4);
    }
  });

  it('changing the TOP surface (a front edit) never changes the frozen offset Z -- only the analysis against it', () => {
    // the front is carved down until it meets the already-cut underside at the centre cell (same z -> zero
    // physical thickness there) -- analyseThickness reads this from the CURRENT top vs the FROZEN bottom;
    // the frozen data itself (asserted below) never moves
    const editedTop = new Float32Array([0, 0, 0, 0, FROZEN[4], 0, 0, 0, 0]);
    const thicken = buildThickenData(editedTop, 3, 3, BASE_PARAMS, { backHeights: FROZEN });
    for (let k = 0; k < 9; k++) expect(thicken.data.offsetPts[k * 3 + 2]).toBeCloseTo(FROZEN[k], 4);
    // the top now exactly meets the frozen underside at the centre cell -- a top/bottom intersection
    expect(thicken.counts.topBot).toBeGreaterThan(0);
  });

  it('no live offset computation ran: raw === smoothed (nothing to smooth, it was already finished at capture time)', () => {
    const thicken = buildThickenData(FLAT_HEIGHTS, 3, 3, BASE_PARAMS, { backHeights: FROZEN });
    expect(thicken.data.rawOffsetPts).toEqual(thicken.data.offsetPts);
  });
});

describe('advisor check: Export rebuilds at its own (usually finer) resolution -- it must land on the SAME frozen underside the preview shows', () => {
  it('a 5x5 "preview" grid and a 9x9 "export" grid, same locked snapshot, agree exactly at every coincident point', () => {
    // captured once at a 3x3 grid (core/job-timeline-snapshot.js, the real module -- not a hand-rolled stand-in);
    // Display and Export then each dequantize it to their OWN grid (main/export-flow.js withExportResolution runs
    // the same rebuild() at a different P.spacing) and buildThickenData runs independently for each
    const snap = quantizeHeights([0.05, 0.4, 0.15, 0.6, 0.9, 0.25, 0.1, 0.5, 0.3], 3, 3);
    const previewBack = dequantizeHeights(snap, 5, 5);
    const exportBack  = dequantizeHeights(snap, 9, 9);

    const previewTop = new Float32Array(25); // flat top at both resolutions -- isolates the backHeights path
    const exportTop  = new Float32Array(81);
    const preview = buildThickenData(previewTop, 5, 5, BASE_PARAMS, { backHeights: previewBack });
    const exportT = buildThickenData(exportTop,  9, 9, BASE_PARAMS, { backHeights: exportBack });

    for (let jp = 0; jp < 5; jp++) {
      for (let ip = 0; ip < 5; ip++) {
        const pK = jp * 5 + ip;
        const eK = (jp * 2) * 9 + (ip * 2); // the coincident export cell at the same physical position
        expect(exportT.data.offsetPts[eK * 3 + 2]).toBeCloseTo(preview.data.offsetPts[pK * 3 + 2], 4);
      }
    }
  });
});
