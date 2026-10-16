/**
 * core/job-timeline-baselines.js -- job-timeline step 3 slice 3 (Fred via the advisor 2026-10-16): the weighted Δ
 * readout. Generalizes Back's own capture/drop (slice 2) to 'top'/'frame', and the re-anchoring behaviour unique
 * to them -- several kinds share `cuts: 'top'`, so crossing a LATER one re-captures the baseline at that newer
 * moment (Fred cuts colour layers one at a time).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P, setLastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import {
  captureTopBaseline, dropTopBaseline, captureFrameBaseline, dropFrameBaseline,
  computeBackDelta, computeTopDelta, computeFrameDelta, computeWeightedDelta, syncCutBaselines,
} from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline-baselines.js';
import { captureBackSnapshot } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline-snapshot.js';

const GRID_NX = 3, GRID_NZ = 3;
function liveResultFixture(topFill = 1, backFill = -0.25) {
  const heights = new Float32Array(GRID_NX * GRID_NZ).fill(topFill);
  const offsetPts = new Float32Array(GRID_NX * GRID_NZ * 3);
  for (let k = 0; k < GRID_NX * GRID_NZ; k++) offsetPts[k * 3 + 2] = backFill;
  return { heights, thickenData: { offsetPts }, nx: GRID_NX, nz: GRID_NZ };
}

beforeEach(() => {
  P.jobTimeline = null;
  P.frame = null;
  setLastResult(null);
});

describe('captureTopBaseline / dropTopBaseline', () => {
  it('a no-op (false) with nothing built yet', () => {
    expect(captureTopBaseline()).toBe(false);
    expect(P.jobTimeline?.snapshots?.top).toBeUndefined();
  });

  it('captures the live top heights, leaving sibling snapshot keys untouched', () => {
    setLastResult(liveResultFixture());
    P.jobTimeline = { order: [], head: 0, snapshots: { frame: { fixture: true } } };
    expect(captureTopBaseline()).toBe(true);
    expect(P.jobTimeline.snapshots.top.nx).toBe(GRID_NX);
    expect(P.jobTimeline.snapshots.frame).toEqual({ fixture: true });
  });

  it('dropTopBaseline removes only top', () => {
    P.jobTimeline = { order: [], head: 0, snapshots: { top: { data: [1], nx: 1, nz: 1, minZ: 0, maxZ: 0 }, back: { fixture: true } } };
    expect(dropTopBaseline()).toBe(true);
    expect(P.jobTimeline.snapshots.top).toBeUndefined();
    expect(P.jobTimeline.snapshots.back).toEqual({ fixture: true });
    expect(dropTopBaseline()).toBe(false); // nothing left to drop
  });
});

describe('captureFrameBaseline / dropFrameBaseline', () => {
  it('a no-op (false) without a frame on the board', () => {
    expect(captureFrameBaseline()).toBe(false);
  });

  it('captures the real frame record\'s numeric footprint (template_1, a real template) -- not the whole record', () => {
    P.frame = normalizeFrameRecord({ templateId: 'template_1', params: { boundingboxoffset: 0.3 } });
    expect(captureFrameBaseline()).toBe(true);
    const fp = P.jobTimeline.snapshots.frame.footprint;
    expect(fp['params.boundingboxoffset']).toBeCloseTo(0.3, 6);
    expect(typeof fp.frameBottomZ).toBe('number'); // every template's own default, not just the one param set above
    expect(fp.templateId).toBeUndefined(); // categorical fields never enter the footprint
  });

  it('dropFrameBaseline removes only frame', () => {
    P.jobTimeline = { order: [], head: 0, snapshots: { frame: { footprint: {} }, top: { fixture: true } } };
    expect(dropFrameBaseline()).toBe(true);
    expect(P.jobTimeline.snapshots.frame).toBeUndefined();
    expect(P.jobTimeline.snapshots.top).toEqual({ fixture: true });
  });
});

describe('computeBackDelta / computeTopDelta / computeFrameDelta: 0 with no baseline, the real Δ once one exists', () => {
  it('all three are 0 with nothing captured', () => {
    setLastResult(liveResultFixture());
    expect(computeBackDelta()).toBe(0);
    expect(computeTopDelta()).toBe(0);
    expect(computeFrameDelta()).toBe(0);
  });

  it('computeBackDelta / computeTopDelta read the SAME baselines job-timeline-snapshot.js\'s own capture writes', () => {
    setLastResult(liveResultFixture(1, -0.25));
    P.jobTimeline = { order: [], head: 0 };
    captureBackSnapshot();
    captureTopBaseline();
    expect(computeBackDelta()).toBeCloseTo(0, 4);
    expect(computeTopDelta()).toBeCloseTo(0, 4);

    setLastResult(liveResultFixture(1.1, -0.4)); // the board moved on since capture
    expect(computeBackDelta()).toBeCloseTo(0.15, 3); // |-0.4 - (-0.25)|
    expect(computeTopDelta()).toBeCloseTo(0.1, 3);   // |1.1 - 1|
  });

  it('computeFrameDelta: the largest |current - baseline| across shared numeric fields; an unmatched field is ignored, not a crash', () => {
    P.frame = normalizeFrameRecord({ templateId: 'template_1', params: { boundingboxoffset: 0.25 } });
    captureFrameBaseline();
    P.frame = normalizeFrameRecord({ templateId: 'template_1', params: { boundingboxoffset: 0.6 } });
    expect(computeFrameDelta()).toBeCloseTo(0.35, 6);

    // a template swap: boundingboxoffset may not exist under the new template's own declared params
    P.jobTimeline.snapshots.frame.footprint = { 'params.aFieldGoneNow': 9, frameBottomZ: -1 };
    P.frame = normalizeFrameRecord({ templateId: 'template_1' });
    expect(() => computeFrameDelta()).not.toThrow();
    expect(computeFrameDelta()).toBeCloseTo(0, 6); // frameBottomZ unchanged, the gone field is skipped
  });
});

describe('computeWeightedDelta: score = Σ weight[surface]·Δ[surface] (JOB_DELTA_WEIGHTS: back 1, frame 1, top 0.25)', () => {
  it('combines all three with their declared weights', () => {
    setLastResult(liveResultFixture(1, -0.25));
    P.jobTimeline = { order: [], head: 0 };
    captureBackSnapshot();
    captureTopBaseline();
    P.frame = normalizeFrameRecord({ templateId: 'template_1', params: { boundingboxoffset: 0.25 } });
    captureFrameBaseline();

    setLastResult(liveResultFixture(2, -1.25)); // top Δ = 1, back Δ = 1
    P.frame = normalizeFrameRecord({ templateId: 'template_1', params: { boundingboxoffset: 0.65 } }); // frame Δ = 0.4

    const { deltas, score } = computeWeightedDelta();
    expect(deltas.back).toBeCloseTo(1, 4);
    expect(deltas.top).toBeCloseTo(1, 4);
    expect(deltas.frame).toBeCloseTo(0.4, 4);
    expect(score).toBeCloseTo(1 * 1 + 1 * 0.4 + 0.25 * 1, 4); // 1.65
  });
});

describe('syncCutBaselines: re-anchors \'top\' to the LATEST crossed top-cutting step, the same rule as Back generalized', () => {
  // a synthetic roster using REAL kind names so JOB_STEP_KINDS[kind].cuts resolves for real: stock (none),
  // sculptTop ('top'), back ('back'), latticeRails + latticeNodes (both 'top'), frame ('frame')
  const steps = [
    { id: 's1', kind: 'stock' },
    { id: 's2', kind: 'sculptTop' },
    { id: 's3', kind: 'back' },
    { id: 's4', kind: 'latticeRails' },
    { id: 's5', kind: 'latticeNodes' },
    { id: 's6', kind: 'frame' },
  ];
  const order = steps.map((s) => s.id);

  beforeEach(() => {
    setLastResult(liveResultFixture(1, -0.25));
    P.frame = normalizeFrameRecord({ templateId: 'template_1', params: { boundingboxoffset: 0.25 } });
  });

  it('captures top at sculptTop, back at Back, re-captures top at the later latticeNodes, captures frame last, then drops all three moving back to 0', () => {
    // head 0 -> 2: crosses s1 (stock, no cuts) + s2 (sculptTop, 'top') -- top newly locked
    syncCutBaselines(order, 0, order, 2, steps);
    expect(P.jobTimeline.snapshots.top).toBeDefined();
    expect(P.jobTimeline.snapshots.back).toBeUndefined();

    // head 2 -> 3: crosses s3 (back) -- back newly locked; top untouched (still anchored at s2)
    const topAfterFirstCapture = P.jobTimeline.snapshots.top;
    syncCutBaselines(order, 2, order, 3, steps);
    expect(P.jobTimeline.snapshots.back).toBeDefined();
    expect(P.jobTimeline.snapshots.top).toBe(topAfterFirstCapture); // the SAME object -- not re-captured

    // the board moves on (a colour layer gets cut) before the head follows it
    setLastResult(liveResultFixture(9, -0.25));

    // head 3 -> 5: crosses s4 + s5 (both 'top') -- the LATEST ('latticeNodes', index 4) re-anchors top to the NEW heights
    syncCutBaselines(order, 3, order, 5, steps);
    expect(P.jobTimeline.snapshots.top).not.toBe(topAfterFirstCapture);
    expect(computeTopDelta()).toBeCloseTo(0, 4); // re-anchored to the current (9) heights -- no drift right after

    // head 5 -> 6: crosses s6 (frame)
    syncCutBaselines(order, 5, order, 6, steps);
    expect(P.jobTimeline.snapshots.frame).toBeDefined();

    // head 6 -> 0: drops everything
    syncCutBaselines(order, 6, order, 0, steps);
    expect(P.jobTimeline.snapshots.top).toBeUndefined();
    expect(P.jobTimeline.snapshots.back).toBeUndefined();
    expect(P.jobTimeline.snapshots.frame).toBeUndefined();
  });

  it('a reorder/head-move that stays within the SAME latest cuts-step for every surface is a true no-op (no re-capture)', () => {
    syncCutBaselines(order, 0, order, 3, steps); // locks top (at s2) and back (at s3)
    const top = P.jobTimeline.snapshots.top, back = P.jobTimeline.snapshots.back;
    setLastResult(liveResultFixture(42, -9)); // the board changes, but the head doesn't cross anything new
    syncCutBaselines(order, 3, order, 3, steps); // head unchanged
    expect(P.jobTimeline.snapshots.top).toBe(top);
    expect(P.jobTimeline.snapshots.back).toBe(back);
  });
});
