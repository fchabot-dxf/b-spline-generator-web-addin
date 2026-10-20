/**
 * The plain 'Source - Lx' TWIN (seat D 2026-10-20, Fred: "stop the Send creating the plain twins"): a lattice layer that earns a
 * [constrained] sketch (its manifest) was ALSO sent as a second, plain sketch of the same pieces. Cause, measured on a real
 * Shape Lattice board: export-flow asked the LAYER OBJECT for the pattern to strip (`editorLayerFor(l).pattern`), but only the
 * primary (rails) layer holds `.pattern` -- its sibling kind-layers (ties, nodes, contour) carry a `patternOwner` pointer -- so
 * for them nothing was stripped and their whole owned content went out twice (real board: ties 1874 chars, nodes 3400 chars;
 * Fred's file: plain L1 ties, L3 contour, L4 nodes; L2 rails had none). The fix: strip the pattern the MANIFEST resolved
 * (resolvePatternLayer), `_fusionLayerPlainSvg`. What a user genuinely drew or detached on the layer still goes out; a layer
 * WITHOUT a manifest (plain art, L5) is unchanged; nothing in the editor or the project is touched.
 */
import { describe, it, expect } from 'vitest';
import { _fusionLayerPlainSvg, _fusionLayerManifest } from '../bspline-frame-builder/b-spline-gen/html/main/export-flow.js';
import { drawnFromPattern, ownedStores } from './helpers/drawn-lattice.js';

const BOARD = { x: 0, y: 0, w: 7, h: 9 };

const PATTERN = {
  id: 'p',
  spacing: 0.25,
  rails: { mode: 'every', every: 2, offset: 0 },
  ties: { mode: 'density', density: 1, anchor: 'free', spanMin: 1, spanMax: 2, railSnapRows: 0 },
  nodes: { ends: true, crossings: true, railEnds: false },
  widths: { rails: 0.07, ties: 0.05, nodeDiameter: 0.15, linkRailsTies: false },
  layers: { rails: 'railsL', ties: 'tiesL', nodes: 'nodesL' },
};

/** The real editor shape the export reads: `_layers` (the primary layer holds `.pattern`, siblings a `patternOwner`), the sketch
 *  layer's serialized children (what getLayerSvg parses) and its owned-element list (what latticeOwnedElementsOnLayer walks). */
function makeEditor() {
  const owned = ownedStores(drawnFromPattern(PATTERN, BOARD), { gen: 'p', layers: PATTERN.layers });
  const all = [...owned.rails, ...owned.ties, ...owned.nodes];
  const elements = all.map((store) => ({ node: { getAttribute: (k) => (store[k] !== undefined ? store[k] : null), hasAttribute: (k) => store[k] !== undefined } }));
  const html = [
    // the owned pieces of each kind, as the editor serialises them
    '<line data-layer="railsL" data-lattice="rail" data-lattice-gen="p" x1="0" y1="1" x2="5" y2="1" stroke-width="0.07"/>',
    '<line data-layer="tiesL" data-lattice="tie" data-lattice-gen="p" x1="1" y1="1" x2="1" y2="2" stroke-width="0.05"/>',
    '<circle data-layer="nodesL" data-lattice="node" data-lattice-gen="p" cx="1" cy="1" r="0.075"/>',
    // what the user drew by hand / detached: no ownership mark
    '<path data-layer="tiesL" d="M5 5 L6 6"/>',
  ].join('');
  return {
    _draw: {}, _mW: 7, _mH: 9, _activeLayer: null,
    _sketchLayer: { node: { innerHTML: html }, children: () => { const a = elements.slice(); a.toArray = () => a; return a; } },
    _layers: [
      { id: 'railsL', pattern: PATTERN, fusionGeometry: 'centerline' },
      { id: 'tiesL', pattern: null, patternOwner: 'railsL', fusionGeometry: 'centerline' },
      { id: 'nodesL', pattern: null, patternOwner: 'railsL', fusionGeometry: 'centerline' },
      { id: 'artL', pattern: null, fusionGeometry: 'centerline', carve: true },
    ],
  };
}

describe('_fusionLayerPlainSvg: a layer that has a manifest never sends its own owned content a second time', () => {
  it('the layers really are the real kind-split shape: only the rails layer holds .pattern, and each earns a manifest', () => {
    const ed = makeEditor();
    expect(ed._layers.map((l) => !!l.pattern)).toEqual([true, false, false, false]);
    for (const id of ['railsL', 'tiesL', 'nodesL']) expect(_fusionLayerManifest(ed, { id })).not.toBeNull();
  });

  it('the primary (rails) layer: its owned rails are stripped, nothing is left (as before)', async () => {
    const ed = makeEditor();
    const r = await _fusionLayerPlainSvg(ed, { id: 'railsL' }, _fusionLayerManifest(ed, { id: 'railsL' }));
    expect(r.svg).toBe('');
  });

  it('a TIES layer (a sibling kind-layer): the owned tie is NOT sent again; the piece drawn by hand still is', async () => {
    const ed = makeEditor();
    const r = await _fusionLayerPlainSvg(ed, { id: 'tiesL' }, _fusionLayerManifest(ed, { id: 'tiesL' }));
    expect(r.svg).not.toContain('data-lattice-gen');
    expect(r.svg).not.toContain('data-lattice="tie"');
    expect(r.svg).toContain('M5 5 L6 6');
  });

  it('a NODES layer (a sibling kind-layer) with only owned nodes sends no plain svg at all', async () => {
    const ed = makeEditor();
    const r = await _fusionLayerPlainSvg(ed, { id: 'nodesL' }, _fusionLayerManifest(ed, { id: 'nodesL' }));
    expect(r.svg).toBe('');
  });

  it('a generated contour on a sibling layer: its segments (data-boundary-ref) are stripped too, a hand-drawn sibling stays', async () => {
    const ed = makeEditor();
    ed._layers[0].pattern = { ...PATTERN, shape: { source: 'generated' }, extent: { mode: 'boundary' }, boundary: { shapeId: 'shape-1' } };
    ed._sketchLayer.node.innerHTML += '<path data-layer="tiesL" data-boundary-ref="shape-1" d="M0 0 L1 0"/>';
    const r = await _fusionLayerPlainSvg(ed, { id: 'tiesL' }, _fusionLayerManifest(ed, { id: 'tiesL' }) || { kind: 'contour' });
    expect(r.svg).not.toContain('shape-1');
    expect(r.svg).toContain('M5 5 L6 6');
  });

  it('a layer WITHOUT a manifest (a plain art layer, L5) is unchanged: its whole svg goes out', async () => {
    const ed = makeEditor();
    ed._sketchLayer.node.innerHTML += '<path data-layer="artL" d="M1 1 L2 2"/>';
    const r = await _fusionLayerPlainSvg(ed, { id: 'artL', svg: '<svg/>' }, null);
    expect(r.svg).toContain('M1 1 L2 2');
  });

  it('nothing in the editor (layers, drawn content) is changed by it: the project is untouched', async () => {
    const ed = makeEditor();
    const before = JSON.stringify({ layers: ed._layers, html: ed._sketchLayer.node.innerHTML });
    for (const id of ['railsL', 'tiesL', 'nodesL']) await _fusionLayerPlainSvg(ed, { id }, _fusionLayerManifest(ed, { id }));
    expect(JSON.stringify({ layers: ed._layers, html: ed._sketchLayer.node.innerHTML })).toBe(before);
  });
});
