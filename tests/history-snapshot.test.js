/**
 * SE4c — regression guard for `takeSnapshot` (core/history.js) after the
 * mirror retirement (SE4-MIRROR-RETIREMENT-DESIGN.md).
 *
 * `takeSnapshot` used to take an optional `stampSvgText` second parameter
 * that no caller ever actually passed — it was always literally `null`,
 * never `undefined` — which made `applySnapshot`'s `snap.stampSvgText !==
 * undefined` check fire on every snapshot, unconditionally nulling
 * P.stampLayers[0].svg on every undo/redo regardless of what was actually
 * undone (the design doc's finding #1). SE4c removed the parameter and the
 * field entirely, per the advisor's product decision that global undo/redo
 * is for the heightfield, not the drawing (the editor has its own undo
 * stack). This guards that the field is really gone — not just unused —
 * and that the snapshot still captures a real, independent copy of
 * stampLayers' tooling (BG1's original concern, restated for the new shape).
 */
import { describe, it, expect } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { takeSnapshot, globalHistoryLog } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';

describe('takeSnapshot', () => {
  it('does not carry a stampSvgText field any more', () => {
    takeSnapshot('test action');
    const snap = globalHistoryLog[globalHistoryLog.length - 1];
    expect('stampSvgText' in snap).toBe(false);
  });

  it('captures an independent copy of stampLayers tooling in both P and layerConfigs', () => {
    const originalDepth = P.stampLayers[0].depth;
    P.stampLayers[0].depth = 0.987;
    try {
      takeSnapshot('test action');
      const snap = globalHistoryLog[globalHistoryLog.length - 1];
      expect(snap.P.stampLayers[0].depth).toBe(0.987);
      expect(snap.layerConfigs[0].depth).toBe(0.987);

      // Non-vacuity companion: mutate P AFTER the snapshot and confirm the
      // snapshot's copy doesn't follow — proves it's a real copy, not a
      // reference into the live P.stampLayers array.
      P.stampLayers[0].depth = 0.111;
      expect(snap.P.stampLayers[0].depth).toBe(0.987);
      expect(snap.layerConfigs[0].depth).toBe(0.987);
    } finally {
      P.stampLayers[0].depth = originalDepth;
    }
  });
});
