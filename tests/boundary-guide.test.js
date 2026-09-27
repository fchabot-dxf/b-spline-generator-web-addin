/**
 * BOUNDARY-GUIDE (L1, Fred 2026-09-26): the lattice boundary box is a GUIDE
 * record (`role: 'guide'`) — editor-guides.js draws it into its own
 * `#guide-layer` sibling (never the sketch layer every exporter/3D reader
 * walks), always, for every generated + visible lattice pattern.
 * Mock svg.js (no real svg.js in node), same approach as the emit tests.
 */
import { describe, it, expect } from 'vitest';
import {
  GUIDE_ROLE, latticeBoundaryGuide, sizedBoardRegion,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js';
import {
  editorGuides, refreshGuides, GUIDE_ATTR, GUIDE_LAYER_ID,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-guides.js';
import { OWNERSHIP_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

function mockNode(attrs) {
  return { getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs };
}

/** A drawn svg.js-ish rect that records what the renderer set on it. */
function mockRect(w, h, sink) {
  const r = { w, h, x: 0, y: 0, attrs: {}, strokeArg: null, fillArg: null };
  r.move = (x, y) => { r.x = x; r.y = y; return r; };
  r.fill = (v) => { r.fillArg = v; return r; };
  r.stroke = (v) => { r.strokeArg = v; return r; };
  r.attr = (o) => { Object.assign(r.attrs, o); return r; };
  sink.push(r);
  return r;
}

function mockGroup() {
  const g = { rects: [], attrs: {} };
  g.id = (v) => { g.attrs.id = v; return g; };
  g.attr = (k, v) => { g.attrs[k] = v; return g; };
  g.clear = () => { g.rects = []; return g; };
  g.rect = (w, h) => mockRect(w, h, g.rects);
  return g;
}

/** `layers`: [{id, pattern?, visible?}]; `owned`: layer ids holding a generated piece. */
function mockEditor(layers, owned) {
  const sketchChildren = owned.map((id) => ({ node: mockNode({ 'data-layer': id, [OWNERSHIP_ATTR]: 'p1' }) }));
  const placed = [];
  const editor = {
    _mW: 12, _mH: 8,
    _layers: layers,
    _sketchLayer: {
      children: () => { const a = sketchChildren.slice(); a.toArray = () => a; return a; },
      after: (g) => placed.push(g),
    },
    _draw: { group: () => mockGroup() },
  };
  return { editor, placed };
}

const BOARD = { x: 0, y: 0, w: 12, h: 8 };

describe('BOUNDARY-GUIDE: the declared guide record', () => {
  it('is the Size box (sizedBoardRegion) with role guide', () => {
    const pattern = { size: { width: 6, height: 4 } };
    const g = latticeBoundaryGuide(pattern, BOARD);
    expect(g.role).toBe(GUIDE_ROLE);
    expect(g.rect).toEqual(sizedBoardRegion(BOARD, pattern.size));
    expect(g.rect).toEqual({ x: 3, y: 2, w: 6, h: 4 });
  });

  it('auto Size (null axes) falls back to board minus the 1in margin', () => {
    expect(latticeBoundaryGuide({ size: { width: null, height: null } }, BOARD).rect)
      .toEqual({ x: 0.5, y: 0.5, w: 11, h: 7 });
    expect(latticeBoundaryGuide({}, BOARD).rect).toEqual({ x: 0.5, y: 0.5, w: 11, h: 7 });
  });
});

describe('BOUNDARY-GUIDE: which patterns get a guide', () => {
  it('a generated, visible pattern gets exactly one guide', () => {
    const { editor } = mockEditor([{ id: 'a', pattern: { size: { width: 6, height: 4 } } }], ['a']);
    const guides = editorGuides(editor);
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ role: GUIDE_ROLE, layerId: 'a', rect: { x: 3, y: 2, w: 6, h: 4 } });
  });

  it('a pattern never generated (no owned pieces) gets none', () => {
    const { editor } = mockEditor([{ id: 'a', pattern: {} }], []);
    expect(editorGuides(editor)).toEqual([]);
  });

  it('a layer without a pattern gets none', () => {
    const { editor } = mockEditor([{ id: 'a' }], ['a']);
    expect(editorGuides(editor)).toEqual([]);
  });

  it('a T76 kind-split pattern: pieces on the kind-layers count, one guide per pattern', () => {
    const layers = [
      { id: 'r', pattern: { layers: { rails: 'r', ties: 't', nodes: 'n' } } },
      { id: 't', patternOwner: 'r' },
      { id: 'n', patternOwner: 'r' },
    ];
    const { editor } = mockEditor(layers, ['t']);
    expect(editorGuides(editor)).toHaveLength(1);
  });

  it('all of the pattern\'s layers hidden -> no guide; one visible -> guide', () => {
    const layers = [
      { id: 'r', visible: false, pattern: { layers: { rails: 'r', ties: 't' } } },
      { id: 't', visible: false, patternOwner: 'r' },
    ];
    const { editor } = mockEditor(layers, ['r']);
    expect(editorGuides(editor)).toEqual([]);
    layers[1].visible = true;
    expect(editorGuides(editor)).toHaveLength(1);
  });
});

describe('BOUNDARY-GUIDE: the editor renderer', () => {
  it('draws a dashed, unfilled rect marked data-role=guide into #guide-layer, beside the sketch layer', () => {
    const { editor, placed } = mockEditor([{ id: 'a', pattern: { size: { width: 6, height: 4 } } }], ['a']);
    refreshGuides(editor);
    expect(placed).toHaveLength(1);
    const g = placed[0];
    expect(g.attrs.id).toBe(GUIDE_LAYER_ID);
    expect(g.attrs['pointer-events']).toBe('none');
    expect(g.rects).toHaveLength(1);
    const r = g.rects[0];
    expect([r.x, r.y, r.w, r.h]).toEqual([3, 2, 6, 4]);
    expect(r.fillArg).toBe('none');
    expect(r.strokeArg.dasharray).toBeTruthy();
    expect(r.strokeArg.color).toBe('#000000'); // Fred: dashed black
    expect(r.attrs[GUIDE_ATTR]).toBe(GUIDE_ROLE);
    expect(r.attrs['data-guide-layer']).toBe('a');
  });

  it('redraws from scratch (no duplicates) and reuses the one guide layer', () => {
    const { editor, placed } = mockEditor([{ id: 'a', pattern: {} }], ['a']);
    refreshGuides(editor);
    refreshGuides(editor);
    expect(placed).toHaveLength(1);
    expect(placed[0].rects).toHaveLength(1);
  });

  it('follows a Size change on the next refresh', () => {
    const layers = [{ id: 'a', pattern: { size: { width: 6, height: 4 } } }];
    const { editor, placed } = mockEditor(layers, ['a']);
    refreshGuides(editor);
    layers[0].pattern.size = { width: 10, height: 6 };
    refreshGuides(editor);
    expect([placed[0].rects[0].w, placed[0].rects[0].h]).toEqual([10, 6]);
  });
});

// ---------------------------------------------------------------------------
// Fusion side: the SAME record becomes 4 construction Lines in the manifest
// ---------------------------------------------------------------------------
import {
  buildSketchManifest, splitManifestByKind,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

const REGION = { x: 0, y: 0, w: 7, h: 9 };
const BOX = {
  ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42, id: 'bg-box', size: { width: 5, height: 6 },
  rails: { mode: 'every', every: 2, offset: 0 },
};
const SHAPE = {
  ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42, id: 'bg-shape', size: { width: 5, height: 6 },
  extent: { mode: 'boundary' },
  shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
};
const bnd = (m) => m.entities.filter((e) => e.id.startsWith('bnd'));
const bbox = (lines) => {
  const xs = lines.flatMap((l) => [l.p1[0], l.p2[0]]), ys = lines.flatMap((l) => [l.p1[1], l.p2[1]]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

describe('BOUNDARY-GUIDE: Fusion manifest', () => {
  for (const [name, pattern] of [['Box Lattice', BOX], ['Shape Lattice', SHAPE],
    ['Shape Lattice, contour off', { ...SHAPE, contour: { ...PATTERN_DEFAULTS.contour, show: false } }]]) {
    it(`${name}: the Size box is 4 closed construction Lines at the declared Size`, () => {
      const m = buildSketchManifest(pattern, REGION, {});
      const lines = bnd(m);
      expect(lines.map((e) => e.id)).toEqual(['bnd0', 'bnd1', 'bnd2', 'bnd3']);
      expect(lines.every((e) => e.type === 'Line' && e.isConstruction === true)).toBe(true);
      const b = bbox(lines);
      expect(b.w).toBeCloseTo(5, 9);
      expect(b.h).toBeCloseTo(6, 9);
      const closing = m.constraints.filter((c) => c.type === 'Coincident' && c.targets[0].startsWith('bnd'));
      expect(closing).toHaveLength(4);
      // nothing else in the manifest is construction
      expect(m.entities.filter((e) => e.isConstruction).length).toBe(4);
    });

    it(`${name}: split per kind, the box is its OWN first sketch (Frame Builder's Bounding Box protocol)`, () => {
      const split = splitManifestByKind(pattern, REGION, {});
      for (const [kind, km] of Object.entries(split)) {
        expect(bnd(km).length).toBe(kind === 'boundary' ? 4 : 0);
      }
      expect(split.boundary.entities.every((e) => e.id.startsWith('bnd'))).toBe(true);
      expect(split.boundary.buildOrder).toBe(0);
      for (const [kind, km] of Object.entries(split)) if (kind !== 'boundary') expect(km.buildOrder).toBeGreaterThan(0);
      expect(split.boundary.constraints).toHaveLength(8); // 4 corner Coincidents + 2 Horizontal + 2 Vertical
      expect(split.boundary.patternId).toBe(pattern.id);
    });
  }
});
