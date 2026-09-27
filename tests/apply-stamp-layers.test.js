/**
 * H22 item 2 (flagged during H22 item 1's layer-order trace): applyStampLayers
 * received `layers` = the ALREADY-FILTERED pass list from _collectStampPasses
 * (rebuild.js — only isCarved() layers survive that filter), but looked up
 * each pass's "matching editor layer" by POSITION (`editorLayers[layerIdx]`)
 * against window.svgEditor._layers, the FULL, UNFILTERED array. Once any
 * earlier-in-_layers layer was hidden/non-carved, every subsequent pass's
 * positional index pointed at the WRONG layer, silently borrowing its
 * depth/profile/suppression/smoothing/edgeFilletRadius instead of its own.
 *
 * Fix: each pass now carries its own `id` (rebuild.js's _collectStampPasses),
 * and applyStampLayers joins back to _layers BY ID via a Map, never by
 * array position — robust to filtering AND to _layers being reordered
 * (H22 item 1's own drag-to-reorder) relative to when the pass list was
 * built.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { applyStampLayers } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';

function mockMask(bodyArray) {
  return { body: Float32Array.from(bodyArray), fillet: null, isStamped: null };
}

describe('applyStampLayers', () => {
  afterEach(() => {
    delete window.svgEditor;
  });

  it('reads each pass\'s settings from its OWN editor layer by id — not from whichever layer happens to share its position in the filtered pass list', () => {
    // Full, unfiltered _layers: A is hidden (excluded from passes by
    // _collectStampPasses' isCarved gate), B and C are carved.
    // Depths use exact binary fractions (0.5/0.25/0.875) so Float32Array
    // round-tripping can't itself cause a spurious mismatch here.
    window.svgEditor = {
      _layers: [
        { id: 'a', name: 'A', visible: false, carve: true, depth: 0.875 },
        { id: 'b', name: 'B', visible: true, carve: true, depth: 0.5 },
        { id: 'c', name: 'C', visible: true, carve: true, depth: 0.25 },
      ],
    };

    // The pass list _collectStampPasses would build: A is filtered out, so
    // passes[0] is B's pass and passes[1] is C's — NOT _layers[0]/_layers[1].
    const passes = [
      { id: 'b', name: 'B', enabled: true, svg: '1', mask: mockMask([1, 0, 0]), depth: 0.5 },
      { id: 'c', name: 'C', enabled: true, svg: '1', mask: mockMask([0, 1, 0]), depth: 0.25 },
    ];

    const cleanHeights = new Float32Array([0, 0, 0]);
    const result = applyStampLayers(cleanHeights, passes, 1, 3);

    // Before the fix: passes[0] (B) was matched against _layers[0] (A,
    // depth 0.875) and passes[1] (C) against _layers[1] (B, depth 0.5) —
    // stampedHeights would come out [0.875, 0.5, 0] instead.
    expect(Array.from(result)).toEqual([0.5, 0.25, 0]);
  });

  it('still resolves the right layer by id even when _layers has since been REORDERED (e.g. by H22 item 1\'s drag-to-reorder) relative to when the pass list was built', () => {
    // _layers now in a different order than the first test, with the
    // hidden layer in the middle instead of first — a purely offset-based
    // "fix" (skip N hidden layers before this index) would still get this
    // wrong; only a true id join gets it right regardless of order.
    window.svgEditor = {
      _layers: [
        { id: 'c', name: 'C', visible: true, carve: true, depth: 0.25 },
        { id: 'a', name: 'A', visible: false, carve: true, depth: 0.875 },
        { id: 'b', name: 'B', visible: true, carve: true, depth: 0.5 },
      ],
    };

    const passes = [
      { id: 'c', name: 'C', enabled: true, svg: '1', mask: mockMask([1, 0, 0]), depth: 0.25 },
      { id: 'b', name: 'B', enabled: true, svg: '1', mask: mockMask([0, 1, 0]), depth: 0.5 },
    ];

    const cleanHeights = new Float32Array([0, 0, 0]);
    const result = applyStampLayers(cleanHeights, passes, 1, 3);

    expect(Array.from(result)).toEqual([0.25, 0.5, 0]);
  });

  it('falls back to the pass\'s own snapshotted depth when no editor layer shares its id (e.g. deleted after the mask was rasterized) — the pre-existing fallback chain still works under the id join', () => {
    window.svgEditor = { _layers: [{ id: 'other', name: 'Other', visible: true, carve: true, depth: 0.625 }] };

    const passes = [
      { id: 'gone', name: 'Gone', enabled: true, svg: '1', mask: mockMask([1]), depth: 0.125 },
    ];

    const result = applyStampLayers(new Float32Array([0]), passes, 1, 1);
    expect(Array.from(result)).toEqual([0.125]); // the pass's own depth, not 0.625 or the global default
  });

  it('works with no window.svgEditor at all — falls back entirely to each pass\'s own fields', () => {
    const passes = [
      { id: 'b', name: 'B', enabled: true, svg: '1', mask: mockMask([1, 0]), depth: 0.375 },
    ];
    const result = applyStampLayers(new Float32Array([0, 0]), passes, 1, 2);
    expect(Array.from(result)).toEqual([0.375, 0]);
  });
});
