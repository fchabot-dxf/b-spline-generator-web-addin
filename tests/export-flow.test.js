/**
 * SE4a — export-flow's activeStampLayers/exportableStampLayers now read the
 * editor (the one real content store) instead of the P.stampLayers mirror.
 *
 * Before this change, both filters read layer.svg/.mask straight off
 * P.stampLayers[idx] — the mirror SE4-MIRROR-RETIREMENT-DESIGN.md's finding
 * #1 documents as going stale (undo/redo nulls .svg without touching the
 * editor). A layer with real content in the editor but a null mirror .svg
 * would silently drop out of Send-to-Fusion/Export-STEP. This guards that
 * scenario, plus the mirror-image case (hidden/empty editor layer must NOT
 * count even if the P.stampLayers tooling says enabled).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { activeStampLayers, exportableStampLayers } from '../bspline-frame-builder/b-spline-gen/html/main/export-flow.js';

function mockEditor(layers) {
  return {
    _draw: {},
    _mW: 7,
    _mH: 9,
    _sketchLayer: {
      node: { innerHTML: layers.map(l => l.content || '').join('') },
    },
    _layers: layers.map(l => ({ id: l.id, visible: l.visible, _mask: l.mask ?? null })),
  };
}

describe('export-flow: activeStampLayers / exportableStampLayers (editor-backed)', () => {
  beforeEach(() => {
    P.stampLayers = [];
    if (typeof window !== 'undefined') window.svgEditor = null;
  });

  it('counts a layer with real editor content even when its P.stampLayers mirror .svg is null (post-undo state)', () => {
    window.svgEditor = mockEditor([
      { id: '0', visible: true, content: '<rect data-layer="0"/>', mask: { body: new Float32Array(4) } },
    ]);
    P.stampLayers = [
      { enabled: true, depth: 0.2, profile: 'square', svg: null }, // stale mirror — the bug this guards
    ];

    const active = activeStampLayers();
    const exportable = exportableStampLayers();

    expect(active).toHaveLength(1);
    expect(exportable).toHaveLength(1);
    expect(active[0].depth).toBe(0.2);
    expect(active[0].profile).toBe('square');
    expect(active[0].svg).toContain('data-layer'); // fetched from the editor, not the null mirror
  });

  it('does not count a HIDDEN layer even though its P.stampLayers tooling says enabled', () => {
    window.svgEditor = mockEditor([
      { id: '0', visible: false, content: '<rect data-layer="0"/>', mask: { body: new Float32Array(4) } },
    ]);
    P.stampLayers = [{ enabled: true, depth: 0.2, profile: 'square', svg: null }];

    expect(activeStampLayers()).toHaveLength(0);
    expect(exportableStampLayers()).toHaveLength(0);
  });

  it('does not count an EMPTY layer (no content, no mask) even though its P.stampLayers tooling says enabled', () => {
    window.svgEditor = mockEditor([
      { id: '0', visible: true, content: '', mask: null },
    ]);
    P.stampLayers = [{ enabled: true, depth: 0.2, profile: 'square', svg: null }];

    expect(activeStampLayers()).toHaveLength(0);
    expect(exportableStampLayers()).toHaveLength(0);
  });

  it('exportableStampLayers is looser than activeStampLayers: svg without a baked mask ships but does not carve', () => {
    window.svgEditor = mockEditor([
      { id: '0', visible: true, content: '<rect data-layer="0"/>', mask: null }, // no mask yet
    ]);
    P.stampLayers = [{ enabled: true, depth: 0.2, profile: 'square', svg: null }];

    expect(activeStampLayers()).toHaveLength(0);     // no mask -> not carving
    expect(exportableStampLayers()).toHaveLength(1); // has svg -> still exportable
  });

  it('returns [] when the editor is not loaded', () => {
    window.svgEditor = null;
    P.stampLayers = [{ enabled: true, depth: 0.2, profile: 'square', svg: '<svg/>' }];

    expect(activeStampLayers()).toHaveLength(0);
    expect(exportableStampLayers()).toHaveLength(0);
  });
});
