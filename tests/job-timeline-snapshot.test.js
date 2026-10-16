/**
 * core/job-timeline-snapshot.js -- job-timeline step 3 slice 2 (Fred via advisor 2026-10-16): the quantize/
 * dequantize round-trip, isBackLocked, and the capture/drop transition against the real state.js bindings
 * (P.jobTimeline, lastResult). Also the advisor's byte-size pin on a realistic large board.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P, setLastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { resampleDelta } from '../bspline-frame-builder/b-spline-gen/html/core/sculpt.js';
import {
  quantizeHeights, dequantizeHeights, isBackLocked, captureBackSnapshot, dropBackSnapshot,
} from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline-snapshot.js';

beforeEach(() => {
  P.jobTimeline = null;
  setLastResult(null);
});

describe('quantizeHeights / dequantizeHeights: a round-trip through the 16-bit quantized form', () => {
  it('a varied height field survives the round-trip to within quantization error', () => {
    const nx = 5, nz = 4;
    const zs = [0, 0.1, 0.25, 0.5, 1.0, -0.3, 0.75, 0.333, 0.9, 0.001, 0.6, 0.2, 0.15, 0.45, 0.8, 0.95, 0.05, 0.7, 0.4, 0.6];
    const snap = quantizeHeights(zs, nx, nz);
    const real = dequantizeHeights(snap);
    for (let k = 0; k < zs.length; k++) {
      expect(real[k]).toBeCloseTo(zs[k], 3); // 16-bit over a ~1.3in span: far finer than 0.001in
    }
  });

  it('a dead-flat field (zero span) quantizes/dequantizes without NaN or divide-by-zero', () => {
    const zs = new Array(9).fill(0.25);
    const snap = quantizeHeights(zs, 3, 3);
    expect(snap.data.every((v) => v === 0)).toBe(true); // span is 0 -- every cell lands in the same bucket
    for (const z of dequantizeHeights(snap)) expect(z).toBeCloseTo(0.25, 6);
  });

  it('resampling to a different grid size (bilinear, same as preDelta/postDelta) stays within the original span', () => {
    const zs = [0, 0.5, 1, 0, 0.5, 1, 0, 0.5, 1];
    const snap = quantizeHeights(zs, 3, 3);
    const resized = dequantizeHeights(snap, 5, 5);
    expect(resized).toHaveLength(25);
    for (const z of resized) { expect(z).toBeGreaterThanOrEqual(-1e-6); expect(z).toBeLessThanOrEqual(1 + 1e-6); }
  });

  it('matches core/sculpt.js resampleDelta exactly -- the SAME resize mechanism preDelta/postDelta already use on a resolution change, not a second one', () => {
    const zs = [0, 0.2, 0.9, 0.1, 0.5, 0.4, 0.6, 0.3, 0.8];
    const snap = quantizeHeights(zs, 3, 3);
    const viaSnapshot = dequantizeHeights(snap, 7, 6);
    const nativeReal = dequantizeHeights(snap); // the quantized-and-back native values, same lossy input resampleDelta would get
    const viaResampleDelta = Array.from(resampleDelta(Float32Array.from(nativeReal), 3, 3, 7, 6));
    expect(viaSnapshot).toHaveLength(42);
    for (let k = 0; k < 42; k++) expect(viaSnapshot[k]).toBeCloseTo(viaResampleDelta[k], 6);
  });

  it('advisor check: a resolution/board-size change while Back is locked (a physically-impossible resize, Fred\'s call -- never blocked here) resamples cleanly, not break, and PRESERVES the same frozen baseline regardless of the target grid', () => {
    // the advisor: "the exported solid must use the SAME frozen underside as the preview" -- Export rebuilds at
    // its OWN (usually finer) resolution (main/export-flow.js withExportResolution -> the same rebuild()), so the
    // real guarantee is: two DIFFERENT target grids sampling the SAME snapshot agree at every COINCIDENT physical
    // point. A 5x5 "preview" grid and a 9x9 "export" grid over the same board share every even export index
    // (export i = preview i * 2) at the exact same physical fraction -- bilinear resample reads the identical
    // fraction for both, so they must agree exactly, not just approximately.
    const zs = [0.05, 0.4, 0.15, 0.6, 0.9, 0.25, 0.1, 0.5, 0.3]; // capture-time grid: 3x3 (Standard), varied/asymmetric
    const snap = quantizeHeights(zs, 3, 3);

    const preview = dequantizeHeights(snap, 5, 5); // a resolution change while locked -- the live Display grid
    const exportG = dequantizeHeights(snap, 9, 9); // Export's own (finer) grid, same board, same locked snapshot

    for (let jp = 0; jp < 5; jp++) {
      for (let ip = 0; ip < 5; ip++) {
        const je = jp * 2, ie = ip * 2; // the coincident export index at the same physical position
        expect(exportG[je * 9 + ie]).toBeCloseTo(preview[jp * 5 + ip], 9);
      }
    }
  });
});

describe('isBackLocked', () => {
  it('true when \'back\' sits left of the head', () => {
    expect(isBackLocked({ order: ['stock', 'back', 'frame'], head: 2 })).toBe(true);
  });

  it('false when the head hasn\'t reached it yet', () => {
    expect(isBackLocked({ order: ['stock', 'back', 'frame'], head: 1 })).toBe(false);
  });

  it('false for a missing/empty jobTimeline', () => {
    expect(isBackLocked(null)).toBe(false);
    expect(isBackLocked({ order: [], head: 0 })).toBe(false);
  });
});

describe('captureBackSnapshot / dropBackSnapshot: against the real state.js bindings', () => {
  it('a no-op (false, nothing written) when there is no thickenData to freeze', () => {
    setLastResult({ thickenData: null, nx: 3, nz: 3 });
    expect(captureBackSnapshot()).toBe(false);
    expect(P.jobTimeline?.snapshots?.back).toBeUndefined();
  });

  it('captures the live underside into P.jobTimeline.snapshots.back', () => {
    const nx = 3, nz = 3;
    const offsetPts = new Float32Array(nx * nz * 3);
    for (let k = 0; k < nx * nz; k++) offsetPts[k * 3 + 2] = k * 0.1; // a distinct z per cell
    setLastResult({ thickenData: { offsetPts }, nx, nz });
    P.jobTimeline = { order: ['back'], head: 1 };

    expect(captureBackSnapshot()).toBe(true);
    const snap = P.jobTimeline.snapshots.back;
    expect(snap.nx).toBe(nx);
    expect(snap.nz).toBe(nz);
    expect(snap.data).toHaveLength(nx * nz);
    expect(typeof snap.capturedAt).toBe('number');

    const real = dequantizeHeights(snap);
    for (let k = 0; k < nx * nz; k++) expect(real[k]).toBeCloseTo(k * 0.1, 3);
  });

  it('capturing never disturbs an unrelated sibling key already in jobTimeline.snapshots', () => {
    const nx = 2, nz = 2;
    setLastResult({ thickenData: { offsetPts: new Float32Array(nx * nz * 3) }, nx, nz });
    P.jobTimeline = { order: ['back'], head: 1, snapshots: { frame: { fixture: true } } };
    captureBackSnapshot();
    expect(P.jobTimeline.snapshots.frame).toEqual({ fixture: true });
    expect(P.jobTimeline.snapshots.back).toBeDefined();
  });

  it('dropBackSnapshot removes only \'back\', leaving sibling snapshot keys untouched', () => {
    P.jobTimeline = { order: [], head: 0, snapshots: {
      back: { data: [1], nx: 1, nz: 1, minZ: 0, maxZ: 0 }, frame: { fixture: true },
    } };
    expect(dropBackSnapshot()).toBe(true);
    expect(P.jobTimeline.snapshots.back).toBeUndefined();
    expect(P.jobTimeline.snapshots.frame).toEqual({ fixture: true });
  });

  it('dropBackSnapshot is a no-op (false) when there was nothing to drop', () => {
    P.jobTimeline = { order: [], head: 0 };
    expect(dropBackSnapshot()).toBe(false);
  });
});

describe('byte-size pin (the advisor: "pin its byte size, ~50KB")', () => {
  it('an 81x107 grid (12x16in at the "Ultra" 0.15in spacing) serializes well under 60KB', () => {
    const nx = 81, nz = 107;
    const count = nx * nz;
    const zs = new Array(count);
    for (let k = 0; k < count; k++) zs[k] = k / (count - 1); // deterministic, fully-varied -- no run-length shortcut
    const snap = quantizeHeights(zs, nx, nz);
    const bytes = JSON.stringify({ ...snap, capturedAt: 1760000000000 }).length;
    expect(snap.data).toHaveLength(count);
    expect(bytes).toBeLessThan(60000); // headroom above the ~50KB estimate; catches an accidental format bloat
  });
});
