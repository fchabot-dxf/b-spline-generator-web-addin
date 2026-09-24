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
import { describe, it, expect, afterEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  takeSnapshot, globalHistoryLog, restoreLayerTooling,
} from '../bspline-frame-builder/b-spline-gen/html/core/history.js';

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

/**
 * UX-UNDO/SE5c — `takeSnapshot` also captures editor._layers TOOLING
 * (not content: no `_mask`, no SVG-element data) so a per-layer sidebar
 * slider (depth/profile/angle/carve/showColor/...) is undoable through
 * the SAME global mechanism as everything else. `restoreLayerTooling` is
 * the other half, exported standalone from applySnapshot's own body so
 * it's testable without that function's rebuild/remask pipeline.
 */
describe('SE5c: layerTooling capture (takeSnapshot) and restore (restoreLayerTooling)', () => {
  afterEach(() => { delete window.svgEditor; });

  it('captures TOOLING fields from window.svgEditor._layers, keyed by id — never the mask/content cache', () => {
    window.svgEditor = {
      _layers: [{
        id: 'layer0', depth: 0.4, profile: 'ballnose', carve: true,
        showColor: false, visible: true, _mask: new Float32Array([1, 2, 3]),
      }],
    };
    takeSnapshot('test tooling capture');
    const snap = globalHistoryLog[globalHistoryLog.length - 1];
    expect(snap.layerTooling).toHaveLength(1);
    const t = snap.layerTooling[0];
    expect(t.id).toBe('layer0');
    expect(t.depth).toBe(0.4);
    expect(t.profile).toBe('ballnose');
    expect(t.carve).toBe(true);
    expect(t.showColor).toBe(false);
    expect(t.visible).toBe(true);
    expect(t._mask).toBeUndefined();
  });

  it('non-vacuous: a DIFFERENT depth is what gets captured, not a hardcoded value', () => {
    window.svgEditor = { _layers: [{ id: 'layer0', depth: 0.91 }] };
    takeSnapshot('t');
    expect(globalHistoryLog[globalHistoryLog.length - 1].layerTooling[0].depth).toBe(0.91);
  });

  it('no window.svgEditor (e.g. very early init): captures an empty list, does not throw', () => {
    delete window.svgEditor;
    expect(() => takeSnapshot('no editor yet')).not.toThrow();
    expect(globalHistoryLog[globalHistoryLog.length - 1].layerTooling).toEqual([]);
  });

  it('restoreLayerTooling writes tooling fields back onto a live layers array, matched by id', () => {
    const layers = [{ id: 'layer0', depth: 0.1, carve: false }, { id: 'layer1', depth: 0.2 }];
    restoreLayerTooling(layers, [{ id: 'layer0', depth: 0.77, carve: true }]);
    expect(layers[0].depth).toBe(0.77);
    expect(layers[0].carve).toBe(true);
    // Non-vacuous: layer1 wasn't named in the saved set, so it must stay
    // untouched — proves restore matches by id, not "overwrite everything".
    expect(layers[1].depth).toBe(0.2);
  });

  it('restoreLayerTooling skips a saved id that no longer exists (layer added/removed since the snapshot) — no crash, no stray write', () => {
    const layers = [{ id: 'layer0', depth: 0.1 }];
    restoreLayerTooling(layers, [{ id: 'layer-deleted', depth: 0.99 }]);
    expect(layers[0].depth).toBe(0.1);
    expect(layers).toHaveLength(1);
  });

  it('round trip: capture via takeSnapshot, restore onto a DIFFERENT (structurally identical) layers array, reproduces the tooling', () => {
    window.svgEditor = {
      _layers: [{
        id: 'layer0', depth: 0.6, profile: 'flat', angle: 45,
        carve: false, showColor: true, visible: true,
      }],
    };
    takeSnapshot('round trip');
    const saved = globalHistoryLog[globalHistoryLog.length - 1].layerTooling;
    const freshLayers = [{
      id: 'layer0', depth: 0, profile: 'vbit', angle: 90,
      carve: true, showColor: true, visible: true,
    }];
    restoreLayerTooling(freshLayers, saved);
    expect(freshLayers[0].depth).toBe(0.6);
    expect(freshLayers[0].profile).toBe('flat');
    expect(freshLayers[0].angle).toBe(45);
    expect(freshLayers[0].carve).toBe(false);
  });
});
