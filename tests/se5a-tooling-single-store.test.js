/**
 * SE5 slice (a) — regression guard: per-layer tooling writes/reads go
 * through editor._layers unconditionally, with no P.stampLayers gate.
 *
 * Before this fix:
 *  - updateP's layerSpecific mirror only wrote editor._layers[idx] when
 *    P.stampLayers[idx] ALSO existed (core/state.js) — P.stampLayers has
 *    a fixed 3 entries, so a depth-slider edit on layer 4+ was a no-op
 *    placebo (SE5-TOOLING-STORE-DESIGN.md §1, SA-LAYER-2).
 *  - isFilletActive() read P.stampLayers unconditionally, never trying
 *    editor._layers first — same 3-layer ceiling (SA-LAYER-3).
 *
 * These assertions exercise both fixes at layer index 3 (the 4th layer),
 * specifically because P.stampLayers[3] is undefined by construction —
 * a bug in either fix would either throw on the missing P.stampLayers[3]
 * read, or silently no-op instead of writing/reading editor._layers[3].
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P, updateP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { createStampCtx } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/_shared.js';

describe('SE5a: updateP writes editor._layers unconditionally', () => {
  beforeEach(() => {
    window.svgEditor = {
      _layers: [
        { id: '0', depth: 0.25 },
        { id: '1', depth: 0.25 },
        { id: '2', depth: 0.25 },
        { id: '3', depth: 0.25 }, // 4th layer — P.stampLayers[3] does not exist
      ],
    };
    P.activeLayerIdx = 3;
  });

  it('updates editor._layers[3].depth via a depth-slider change, even though P.stampLayers[3] is absent', () => {
    expect(P.stampLayers[3]).toBeUndefined(); // the precondition the old gate broke on

    updateP('stampDepth', 0.6);

    expect(window.svgEditor._layers[3].depth).toBe(0.6);
  });

  it('does not throw when P.stampLayers is present but shorter than activeLayerIdx', () => {
    expect(() => updateP('stampFilletPower', 3.1)).not.toThrow();
    expect(window.svgEditor._layers[3].filletPower).toBe(3.1);
  });
});

describe('SE5a: isFilletActive() reads editor._layers, past the old 3-layer ceiling', () => {
  beforeEach(() => {
    P.stampEdgeFilletRadius = 0; // global override off, so only the per-layer check matters
  });

  it('is true when only the 4th editor layer has a fillet and is visible', () => {
    window.svgEditor = {
      _layers: [
        { id: '0', edgeFilletRadius: 0, visible: true },
        { id: '1', edgeFilletRadius: 0, visible: true },
        { id: '2', edgeFilletRadius: 0, visible: true },
        { id: '3', edgeFilletRadius: 0.05, visible: true },
      ],
    };
    const ctx = createStampCtx({});
    expect(ctx.isFilletActive()).toBe(true);
  });

  it('is false when that same 4th layer is hidden', () => {
    window.svgEditor = {
      _layers: [
        { id: '0', edgeFilletRadius: 0, visible: true },
        { id: '1', edgeFilletRadius: 0, visible: true },
        { id: '2', edgeFilletRadius: 0, visible: true },
        { id: '3', edgeFilletRadius: 0.05, visible: false },
      ],
    };
    const ctx = createStampCtx({});
    expect(ctx.isFilletActive()).toBe(false);
  });

  it('falls back to P.stampLayers when the editor has not loaded yet', () => {
    window.svgEditor = null;
    P.stampLayers = [{ id: 'layer0', edgeFilletRadius: 0.05, enabled: true }];
    const ctx = createStampCtx({});
    expect(ctx.isFilletActive()).toBe(true);
  });
});
