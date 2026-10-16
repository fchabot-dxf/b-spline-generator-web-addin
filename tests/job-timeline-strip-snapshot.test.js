/**
 * main/job-timeline-strip.js _commit -- job-timeline step 3 slice 2 (Fred via advisor 2026-10-16): the Back
 * snapshot is captured/dropped exactly on the head crossing Back's own lock boundary, riding along in the same
 * global undo step as the head move itself (core/history.js; P.jobTimeline isn't in UNDO_KEEPS). The advisor:
 * "pin that slice 2's snapshot respects the Settings switch, off = live underside, in both directions" -- the
 * OFF tests below set P.jobTimeline directly (bypassing renderJobStrips, which never writes P.jobTimeline while
 * the switch is off -- tests/job-timeline-strip.test.js's own convention) to exercise _commit's own gate
 * defensively, same as its doc comment says: unreachable from the UI while off, but gated anyway.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, bootRestore, setLastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { globalHistoryLog, globalRedoLog } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { renderJobStrips, moveHeadBefore } from '../bspline-frame-builder/b-spline-gen/html/main/job-timeline-strip.js';
import { setJobTimelineEnabled } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline-enabled.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');

const GRID_NX = 3, GRID_NZ = 3;
function liveThickenFixture() {
  const offsetPts = new Float32Array(GRID_NX * GRID_NZ * 3);
  for (let k = 0; k < GRID_NX * GRID_NZ; k++) offsetPts[k * 3 + 2] = -0.25 + k * 0.01;
  return { thickenData: { offsetPts }, nx: GRID_NX, nz: GRID_NZ };
}

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
  window.svgEditor = { _layers: [{ id: 'L1', name: 'Red petals' }] };
  P.frame = null;
  P.jobTimeline = null;
  bootRestore.complete = true;
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
  setLastResult(null);
});

describe('the switch ON: a head move that crosses Back\'s lock boundary captures/drops its snapshot', () => {
  it('moving the head past Back captures the live underside', () => {
    setJobTimelineEnabled(true);
    setLastResult(liveThickenFixture());
    renderJobStrips(document); // seeds P.jobTimeline's real default order, head 0
    const order = P.jobTimeline.order;
    const backAt = order.indexOf('back');
    expect(P.jobTimeline.snapshots?.back).toBeUndefined();

    moveHeadBefore(order[backAt + 1]); // the step right after Back -- the head now sits PAST it, locking it
    expect(P.jobTimeline.head).toBe(backAt + 1);
    expect(P.jobTimeline.snapshots.back).toBeDefined();
    expect(P.jobTimeline.snapshots.back.nx).toBe(GRID_NX);
  });

  it('moving the head back off Back drops the snapshot -- but the undo baseline just before the drop still has it', () => {
    setJobTimelineEnabled(true);
    setLastResult(liveThickenFixture());
    renderJobStrips(document);
    const order = P.jobTimeline.order;
    const backAt = order.indexOf('back');

    moveHeadBefore(order[backAt + 1]); // lock Back, capture
    expect(P.jobTimeline.snapshots.back).toBeDefined();

    moveHeadBefore('back'); // head lands ON Back's own index -- Back is no longer in slice(0, head)
    expect(P.jobTimeline.head).toBe(backAt);
    expect(P.jobTimeline.snapshots?.back).toBeUndefined(); // dropped from the LIVE project

    // what Undo would restore to: the global snapshot taken right after the lock+capture move, still holding it
    // (takeSnapshot deep-copies P -- core/history.js; jobTimeline round-trips whole since it isn't in UNDO_KEEPS)
    const lockedStep = globalHistoryLog.find((s) => s.label === 'Move the job timeline head' && s.P.jobTimeline.head === backAt + 1);
    expect(lockedStep).toBeDefined();
    expect(lockedStep.P.jobTimeline.snapshots.back).toBeDefined();
  });
});

describe('the switch OFF: _commit never touches the snapshot, in either direction (defensive -- unreachable from the UI while off)', () => {
  it('moving the head past Back while off never captures one', () => {
    setJobTimelineEnabled(true);
    renderJobStrips(document); // get the real order while on, to stay in sync with the real step roster
    const order = P.jobTimeline.order;
    const backAt = order.indexOf('back');

    setJobTimelineEnabled(false);
    setLastResult(liveThickenFixture());
    P.jobTimeline = { order, head: 0 }; // renderJobStrips itself never writes P.jobTimeline while off

    moveHeadBefore(order[backAt + 1]);
    expect(P.jobTimeline.head).toBe(backAt + 1); // the head move itself still runs -- only the snapshot is gated
    expect(P.jobTimeline.snapshots?.back).toBeUndefined();
  });

  it('moving the head back off Back while off never drops an existing snapshot', () => {
    setJobTimelineEnabled(true);
    renderJobStrips(document);
    const order = P.jobTimeline.order;
    const backAt = order.indexOf('back');

    setJobTimelineEnabled(false);
    const fixtureSnap = { data: [1, 2, 3], nx: GRID_NX, nz: GRID_NZ, minZ: 0, maxZ: 1, capturedAt: 1 };
    P.jobTimeline = { order, head: backAt + 1, snapshots: { back: fixtureSnap } };

    moveHeadBefore('back'); // crosses back off its own lock boundary -- would drop it if the switch were on
    expect(P.jobTimeline.head).toBe(backAt);
    expect(P.jobTimeline.snapshots.back).toEqual(fixtureSnap); // untouched -- the switch is off
  });
});
