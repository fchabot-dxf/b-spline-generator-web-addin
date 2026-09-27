/**
 * F17 (P1, SE16 prerequisite; Fred's standing rule "make sure the drawing in the add-in matches the one we insert
 * in Fusion"): the lattice manifest is built from the pieces AS DRAWN (the owned rails/ties/nodes on the canvas),
 * not re-derived from the pattern's params. Before F17 a hand-moved rail reached Fusion at its GENERATED position
 * and a deleted one was still sent; the width overrides were matched by DOM position.
 */
import { describe, it, expect } from 'vitest';
import { PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { buildSketchManifest, splitManifestByKind } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { _fusionLayerManifest } from '../bspline-frame-builder/b-spline-gen/html/main/export-flow.js';
import { drawnFromPattern, ownedStores } from './helpers/drawn-lattice.js';

const REGION = { x: 0, y: 0, w: 7, h: 9 };
const BOX = {
  id: 'p', spacing: 0.25,
  rails: { mode: 'every', every: 4, offset: 0 },
  ties: { mode: 'density', density: 1, anchor: 'free', spanMin: 1, spanMax: 2, railSnapRows: 0 },
  nodes: { ends: true, crossings: true, railEnds: false },
  widths: { rails: 0.07, ties: 0.05, nodeDiameter: 0.15, linkRailsTies: false },
};
const SHAPE = {
  ...PATTERN_DEFAULTS, id: 's', spacing: 0.25, seed: 42,
  rails: { mode: 'count', count: [6, 6] },
  extent: { mode: 'boundary' },
  shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
};

/** export-flow's owned-element mock (the same shape export-flow.test.js uses), one kind per layer. */
function editorWith(pattern, drawn) {
  const layers = { rails: 'railsL', ties: 'tiesL', nodes: 'nodesL' };
  const stores = ownedStores(drawn, { gen: pattern.id, layers });
  const elements = [...stores.rails, ...stores.ties, ...stores.nodes].map((store) => ({
    node: { getAttribute: (k) => (store[k] !== undefined ? store[k] : null), hasAttribute: (k) => store[k] !== undefined },
  }));
  const withLayers = { ...pattern, layers };
  return {
    _draw: {}, _mW: REGION.w, _mH: REGION.h,
    _sketchLayer: { node: { innerHTML: '' }, children: () => { const a = elements.slice(); a.toArray = () => a; return a; } },
    _layers: [
      { id: 'railsL', pattern: withLayers, visible: true },
      { id: 'tiesL', patternOwner: 'railsL', visible: true },
      { id: 'nodesL', patternOwner: 'railsL', visible: true },
    ],
  };
}
const slot = (m, id) => m.entities.find((e) => e.id === id);

describe('F17 P1: a lattice is sent AS DRAWN', () => {
  it('a hand-moved rail\'s Slot sits where it was drawn (RED before F17: sent at its generated position)', () => {
    const drawn = drawnFromPattern(BOX, REGION);
    expect(drawn.rails.length).toBeGreaterThan(2);
    const before = _fusionLayerManifest(editorWith(BOX, drawn), { id: 'railsL' });
    const moved = JSON.parse(JSON.stringify(drawn));
    moved.rails[1].p1.y += 0.5; moved.rails[1].p2.y += 0.5;   // a lattice drag writes the DOM only
    const after = _fusionLayerManifest(editorWith(BOX, moved), { id: 'railsL' });
    const [b, a] = [slot(before, 'rail1'), slot(after, 'rail1')];
    expect(a.p1[0]).toBeCloseTo(b.p1[0], 12);
    expect(a.p1[1]).toBeCloseTo(b.p1[1] - 0.5, 12);             // carve placement flips y
    expect(a.p2[1]).toBeCloseTo(b.p2[1] - 0.5, 12);
    for (const id of ['rail0', 'rail2']) expect(slot(after, id)).toEqual(slot(before, id)); // only that rail moved
  });

  it('a deleted rail is not sent, and the ties that touched only it lose their coincidents to it', () => {
    const drawn = drawnFromPattern(BOX, REGION);
    const full = buildSketchManifest({ ...BOX }, REGION, { drawn });
    const fewer = { ...drawn, rails: drawn.rails.slice(1) };
    const cut = buildSketchManifest({ ...BOX }, REGION, { drawn: fewer });
    const rails = (m) => m.entities.filter((e) => /^rail\d+$/.test(e.id)).length;
    expect(rails(cut)).toBe(rails(full) - 1);
  });

  it.each([['box lattice', BOX], ['Shape Lattice (hourglass, contour coincidents)', SHAPE]])(
    '%s: pieces drawn where the generator put them reproduce the generated manifest EXACTLY', (_n, pattern) => {
      const drawn = drawnFromPattern(pattern, REGION);
      expect(buildSketchManifest(pattern, REGION, { drawn })).toEqual(buildSketchManifest(pattern, REGION));
      expect(splitManifestByKind(pattern, REGION, { drawn })).toEqual(splitManifestByKind(pattern, REGION));
    });

  it('the Shape Lattice keeps its contour coincidents for ends that did not move, and drops them for a moved rail', () => {
    const drawn = drawnFromPattern(SHAPE, REGION);
    const contourTargets = (m, id) => m.constraints.filter((c) => c.type === 'Coincident' && c.targets[0].startsWith(`${id}:`)
      && c.targets[1].startsWith('seg')).length;
    const base = buildSketchManifest(SHAPE, REGION, { drawn });
    expect(contourTargets(base, 'rail0')).toBeGreaterThan(0);
    const moved = JSON.parse(JSON.stringify(drawn));
    moved.rails[0].p1.y += 0.25; moved.rails[0].p2.y += 0.25;
    const after = buildSketchManifest(SHAPE, REGION, { drawn: moved });
    expect(contourTargets(after, 'rail0')).toBe(0);                  // it left the contour
    expect(contourTargets(after, 'rail1')).toBe(contourTargets(base, 'rail1'));
  });
});

describe('F17 P1: width overrides ride on their own piece (T75 OVR-FUSION, no positional matching)', () => {
  const dim = (m, type, id) => m.dimensions.find((d) => d.type === type && d.target === id);

  it('an overridden rail gets a hardcoded "<n> in" SlotWidth; siblings keep the shared parameter', () => {
    const drawn = drawnFromPattern(BOX, REGION);
    drawn.rails[1].overrideWidth = 0.375;
    const m = buildSketchManifest(BOX, REGION, { drawn });
    const plain = buildSketchManifest(BOX, REGION);
    expect(dim(m, 'SlotWidth', 'rail1').expression).toBe('0.375 in');
    expect(slot(m, 'rail1').width).toBe(0.375);
    for (const id of ['rail0', 'rail2']) expect(dim(m, 'SlotWidth', id)).toEqual(dim(plain, 'SlotWidth', id));
    expect(m.parameters.some((p) => p.name === 'rail_width')).toBe(true);
  });

  it('a tie and a node override behave the same way', () => {
    const drawn = drawnFromPattern(BOX, REGION);
    drawn.ties[1].overrideWidth = 0.2;
    drawn.nodes[1].overrideWidth = 0.3;
    const m = buildSketchManifest(BOX, REGION, { drawn });
    expect(dim(m, 'SlotWidth', 'tie1').expression).toBe('0.2 in');
    expect(dim(m, 'SlotWidth', 'tie0').expression).toBe('tie_width');
    expect(dim(m, 'Diameter', 'node1').expression).toBe('0.3 in');
    expect(slot(m, 'node1').radius).toBeCloseTo(0.15, 9);
  });

  it('the override follows ITS piece when an earlier piece is deleted (the old DOM-order matching could not)', () => {
    const drawn = drawnFromPattern(BOX, REGION);
    drawn.rails[2].overrideWidth = 0.5;
    const m = buildSketchManifest(BOX, REGION, { drawn: { ...drawn, rails: drawn.rails.slice(1) } });
    expect(dim(m, 'SlotWidth', 'rail1').expression).toBe('0.5 in');   // was rail2, now the 2nd piece
    expect(dim(m, 'SlotWidth', 'rail0').expression).toBe('rail_width');
  });

  it('export-flow reads the override from the element (data-override-width)', () => {
    const drawn = drawnFromPattern(BOX, REGION);
    drawn.rails[0].overrideWidth = 0.5;
    const m = _fusionLayerManifest(editorWith(BOX, drawn), { id: 'railsL' });
    expect(dim(m, 'SlotWidth', 'rail0').expression).toBe('0.5 in');
    expect(dim(m, 'SlotWidth', 'rail1').expression).toBe('rail_width');
  });
});

describe('F17 P1: relations are derived from the drawn geometry, robustly', () => {
  it('one row drawn as 3 collinear pieces in ANY canvas order: Collinear links spatial neighbours (what a cut will produce)', () => {
    const drawn = drawnFromPattern(BOX, REGION);
    const r = drawn.rails[1];
    const x = (t) => r.p1.x + (r.p2.x - r.p1.x) * t;
    const piece = (t0, t1) => ({ p1: { x: x(t0), y: r.p1.y }, p2: { x: x(t1), y: r.p1.y }, overrideWidth: null });
    const [left, mid, right] = [piece(0, 0.3), piece(0.3, 0.6), piece(0.6, 1)];
    const rails = [drawn.rails[0], mid, right, left, ...drawn.rails.slice(2)];   // canvas order != position
    const m = buildSketchManifest(BOX, REGION, { drawn: { ...drawn, rails } });
    const xs = (id) => { const e = slot(m, id); return Math.min(e.p1[0], e.p2[0]); };
    const row = m.constraints.filter((c) => c.type === 'Collinear' && ['rail1', 'rail2', 'rail3'].includes(c.targets[0]));
    expect(row).toHaveLength(2);
    for (const c of row) {               // each link joins two pieces with nothing of the row between them
      const [a, b] = c.targets.map(xs).sort((p, q) => p - q);
      expect(['rail1', 'rail2', 'rail3'].map(xs).filter((v) => v > a + 1e-9 && v < b - 1e-9)).toEqual([]);
    }
  });

  it('coordinates read back with float noise (1e-12 in) keep exactly the same constraints', () => {
    const drawn = drawnFromPattern(BOX, REGION);
    const noisy = JSON.parse(JSON.stringify(drawn));
    for (const n of noisy.nodes) { n.c.x += 1e-12; n.c.y -= 1e-12; }
    const a = buildSketchManifest(BOX, REGION, { drawn });
    const b = buildSketchManifest(BOX, REGION, { drawn: noisy });
    expect(a.constraints.filter((c) => c.type === 'Coincident').length).toBeGreaterThan(0);
    expect(b.constraints).toEqual(a.constraints);
  });
});
