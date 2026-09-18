/**
 * BG1 — regression guard for `takeSnapshot` (core/history.js).
 *
 * Before A5a-1's fix, `takeSnapshot` cloned `P` via `JSON.parse(JSON.stringify(P))`
 * without stripping stamp-layer masks first — the one persistence site in the
 * codebase that skipped the strip every other site (saveLastSession,
 * buildSnapshot) already did. `takeSnapshot` now routes both `snapshot.P` and
 * `snapshot.layerConfigs` through the shared `persistableP()` serializer
 * (BG1). This guards that both routes actually strip the mask.
 */
import { describe, it, expect } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { takeSnapshot, globalHistoryLog } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';

describe('takeSnapshot', () => {
  it('strips the Float32Array mask from both snapshot.P and snapshot.layerConfigs', () => {
    const originalMask = P.stampLayers[0].mask;
    P.stampLayers[0].mask = new Float32Array([9, 9, 9]);
    try {
      takeSnapshot('test action');
      const snap = globalHistoryLog[globalHistoryLog.length - 1];

      expect(snap.P.stampLayers[0].mask).toBeNull();
      expect(snap.layerConfigs[0].mask).toBeNull();

      // Non-vacuity companion: the source data really was a Float32Array,
      // not already null — confirms the strip is doing real work here.
      expect(P.stampLayers[0].mask).toBeInstanceOf(Float32Array);
    } finally {
      P.stampLayers[0].mask = originalMask;
    }
  });
});
