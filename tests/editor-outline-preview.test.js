/**
 * SE12 T37 — refreshOutlinePreview, the commit-only rebuild of the
 * editor's faint outline preview layer.
 *
 * The "excluded from getSvgString/getLayerSvg/undo snapshots/the drape"
 * requirement (SE12-LIVE-EXPAND-DESIGN.md item 5) is architectural, not
 * something this function enforces itself: every one of those readers
 * (serializeEditor/save, pushState, hit-testing, selection, refreshDrape)
 * walks ONLY _sketchLayer.children() (confirmed by reading each this
 * session), and _outlinePreviewLayer is created as a SIBLING of
 * _sketchLayer (init.js), never a child. So the one property that
 * actually guarantees all five exclusions at once is "refreshOutlinePreview
 * never writes into _sketchLayer" — asserted directly below, rather than
 * re-mocking five separate consumers that would all reduce to checking
 * the same fact. The live CDP check (WORK-LOG) is the end-to-end proof
 * that save/undo/hit-testing genuinely behave this way in the real app.
 */
import { describe, it, expect } from 'vitest';
import { refreshOutlinePreview, OUTLINE_KINDS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-outline-preview.js';

function mockPreviewLayer() {
  const shapes = [];
  return {
    _shapes: shapes,
    clear() { shapes.length = 0; },
    path(d) {
      const shape = {
        _d: d, _fill: null, _stroke: null, _classes: [], _transform: null,
        fill(f) { shape._fill = f; return shape; },
        stroke(s) { shape._stroke = s; return shape; },
        addClass(c) { shape._classes.push(c); return shape; },
        attr(k, v) { if (v !== undefined) shape._transform = v; return shape; },
      };
      shapes.push(shape);
      return shape;
    },
  };
}

function mockLineEl(attrs) {
  const state = { ...attrs };
  const calls = [];
  return {
    type: 'line',
    attr(a, v) {
      if (v !== undefined) { state[a] = v; calls.push(['set', a, v]); return this; }
      calls.push(['get', a]);
      return state[a];
    },
    _state: state,
  };
}

function mockSketchLayer(children) {
  return { children: () => ({ toArray: () => children }) };
}

function mockEditor({ layers, children, activeColor = '#000' }) {
  return {
    _outlinePreviewLayer: mockPreviewLayer(),
    _sketchLayer: mockSketchLayer(children),
    _layers: layers,
    _color: activeColor,
  };
}

const LINE_ATTRS = { x1: 0, y1: 0, x2: 10, y2: 0, 'stroke-width': 2, 'stroke-linecap': 'round', 'data-layer': '1', stroke: '#3366ff', fill: 'none' };

// SE12 T38: every previewed element draws TWO shapes now (a wide white
// halo, then a thin dark line on top — the "visible at every zoom"
// fix), not one. Counted explicitly (HALO_AND_LINE = 2) everywhere below
// rather than a bare "2", so a reader isn't left guessing why.
const HALO_AND_LINE = 2;

describe('refreshOutlinePreview — which elements get a preview', () => {
  it('a visible layer picked outline: its round-cap line gets a halo+line preview pair', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    for (const s of editor._outlinePreviewLayer._shapes) expect(s._d).toMatch(/^M /);
  });

  it('both centerline (default) and a missing layer entirely produce NO preview', () => {
    const line1 = mockLineEl(LINE_ATTRS);
    const line2 = mockLineEl({ ...LINE_ATTRS, 'data-layer': '99' }); // no matching layer object at all
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'centerline' }], children: [line1, line2] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });

  it('"both" also gets a preview (not just "outline")', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'both' }], children: [line] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
  });

  it('a HIDDEN layer gets no preview even when picked outline — the master visible gate wins, same as isCarved/showsColor', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: false, fusionGeometry: 'outline' }], children: [line] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });

  it('a kind with no OUTLINE_KINDS entry (e.g. text — not built yet) is skipped silently, no error', () => {
    const text = { type: 'text', attr: (a) => ({ 'data-layer': '1' }[a]) };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [text] });
    expect(() => refreshOutlinePreview(editor)).not.toThrow();
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });

  it('rebuilds from scratch on every call — .clear() removes the previous run\'s shapes, not just appends', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    refreshOutlinePreview(editor);
    refreshOutlinePreview(editor);
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE); // not 6
  });

  it('picking Centerline empties a layer\'s preview on the next call — the "counts as a commit" property, proven by construction (no cache to go stale)', () => {
    const line = mockLineEl(LINE_ATTRS);
    const layer = { id: '1', visible: true, fusionGeometry: 'outline' };
    const editor = mockEditor({ layers: [layer], children: [line] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    layer.fusionGeometry = 'centerline';
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });
});

describe('OUTLINE_KINDS — table-driven, not a hardcoded <line> check (T37 amendment)', () => {
  it('has exactly the kinds built so far: line (T37), circle/rect (T38), ellipse (T38 amend, biarc-fit), polyline/polygon/path (T39, general engine) — text is later work', () => {
    expect(Object.keys(OUTLINE_KINDS).sort()).toEqual(['circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect']);
  });

  it('adding a kind is a TABLE entry, not a refreshOutlinePreview change — proven by adding one temporarily (text: genuinely not built yet) and confirming it fires with zero edits to the function under test', () => {
    const textEl = { type: 'text', attr: (a) => ({ 'data-layer': '1' }[a]) };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [textEl] });

    // Before the entry exists: skipped (matches the "no OUTLINE_KINDS
    // entry" test above — restated here as the BEFORE half of the same
    // before/after comparison).
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);

    // Add a throwaway 'text' entry (a LATER turn's actual job, not built
    // here — this is only to prove the table IS what refreshOutlinePreview
    // consults, not a hardcoded type check reintroduced by mistake). Not
    // one of the real kinds — overwriting-then-deleting one of those would
    // corrupt the shared module-level table for every test that runs
    // after this one.
    OUTLINE_KINDS.text = () => ({ d: 'M 0 0 L 1 0 L 1 1 Z', unsupported: null });
    try {
      refreshOutlinePreview(editor);
      expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    } finally {
      delete OUTLINE_KINDS.text; // leave the shared table exactly as found
    }
  });

  it('an entry returning { unsupported } still gets no preview, even though the kind IS in the table — the table only says HOW to try, not that every attempt succeeds. Ellipse became a real (biarc-fit) entry in the T38 amendment, so this uses a throwaway table entry instead of relying on ellipse to decline', () => {
    OUTLINE_KINDS.text = () => ({ d: null, unsupported: 'curve' });
    try {
      expect(OUTLINE_KINDS.text()).toEqual({ d: null, unsupported: 'curve' });
      const el = { type: 'text', attr: (a) => ({ 'data-layer': '1' }[a]) };
      const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
      refreshOutlinePreview(editor);
      expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
    } finally {
      delete OUTLINE_KINDS.text; // leave the shared table exactly as found
    }
  });

  it('ellipse (T38 amend) produces a real biarc-fit preview through refreshOutlinePreview, not a decline', () => {
    const el = {
      type: 'ellipse',
      attr: (a) => ({ 'data-layer': '1', cx: '5', cy: '3', rx: '3', ry: '1', 'stroke-width': '0.1' }[a]),
    };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    const line = editor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));
    expect(line._d).toMatch(/^M /);
    expect(line._d).not.toContain('unsupported');
  });

  it('polygon (T39, general engine) produces a real preview through refreshOutlinePreview, reading points via .array() the same way editor-transform-handles.js already does', () => {
    const el = {
      type: 'polygon',
      attr: (a) => ({ 'data-layer': '1', 'stroke-width': '0.2' }[a]),
      array: () => [[0, 0], [10, 0], [10, 10], [0, 10]],
    };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    const line = editor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));
    expect(line._d).toMatch(/^M /);
    expect(line._d).toContain('Z'); // polygon closes -- points-to-d wiring includes the Z
  });

  it('polyline (T39) produces a real preview through refreshOutlinePreview — an OPEN source polyline still traces a single closed CAPSULE outline (matching lineOutlinePathD\'s own convention), only one M', () => {
    const el = {
      type: 'polyline',
      attr: (a) => ({ 'data-layer': '1', 'stroke-width': '0.2' }[a]),
      array: () => [[0, 0], [10, 0], [10, 10]],
    };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    const line = editor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));
    expect(line._d).toMatch(/^M /);
    expect((line._d.match(/M/g) || []).length).toBe(1);
  });

  it('path (T39) reads its own d attribute and produces a real preview through refreshOutlinePreview', () => {
    const el = {
      type: 'path',
      attr: (a) => ({ 'data-layer': '1', 'stroke-width': '0.2', d: 'M 0 0 L 10 0 L 10 10 L 0 10 Z' }[a]),
    };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    const line = editor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));
    expect(line._d).toMatch(/^M /);
  });
});

describe('refreshOutlinePreview — visibility fix (T38): fixed dark-over-white halo, not the element\'s own color', () => {
  it('every preview element gets exactly one .outline-preview-halo shape and one .outline-preview-line shape, halo first (drawn underneath)', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    refreshOutlinePreview(editor);
    const [halo, dark] = editor._outlinePreviewLayer._shapes;
    expect(halo._classes).toContain('outline-preview-halo');
    expect(dark._classes).toContain('outline-preview-line');
  });

  it('showColor(layer) no longer affects the preview at all — same halo+line pair whether the layer shows its own color or not (there is no per-element color choice left to gate)', () => {
    const lineA = mockLineEl(LINE_ATTRS);
    const editorShowColor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline', showColor: true }], children: [lineA] });
    refreshOutlinePreview(editorShowColor);
    const withColor = editorShowColor._outlinePreviewLayer._shapes.map((s) => s._classes);

    const lineB = mockLineEl(LINE_ATTRS);
    const editorNoColor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline', showColor: false }], children: [lineB] });
    refreshOutlinePreview(editorNoColor);
    const withoutColor = editorNoColor._outlinePreviewLayer._shapes.map((s) => s._classes);

    expect(withColor).toEqual(withoutColor);
    expect(withColor.flat()).not.toContain('layer-no-color'); // the OLD mechanism, fully retired
  });

  it('non-vacuous: no .fill()/.stroke() calls at all — color/width live entirely in CSS now, not per-element attrs', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    refreshOutlinePreview(editor);
    for (const s of editor._outlinePreviewLayer._shapes) {
      expect(s._fill).toBeNull();
      expect(s._stroke).toBeNull();
    }
  });
});

describe('refreshOutlinePreview — geometry: local frame, own transform carried over, not baked', () => {
  it('BOTH the halo and line shapes get the SAME transform attribute the source line carries', () => {
    const line = mockLineEl({ ...LINE_ATTRS, transform: 'matrix(1,0,0,1,5,5)' });
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    refreshOutlinePreview(editor);
    for (const s of editor._outlinePreviewLayer._shapes) expect(s._transform).toBe('matrix(1,0,0,1,5,5)');
  });

  it('no transform on the source: none written to either preview shape (not "identity" busywork)', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    refreshOutlinePreview(editor);
    for (const s of editor._outlinePreviewLayer._shapes) expect(s._transform).toBeNull();
  });
});

function mockShapeEl(type, attrs) {
  const state = { ...attrs };
  return { type, attr: (a) => state[a] };
}

describe('OUTLINE_KINDS.circle / .rect — wired end-to-end through refreshOutlinePreview, including fill-mode detection from the element\'s OWN attrs (T38)', () => {
  it('a stroke-only circle (fill="none") gets the stroke-mode annulus (halo+line PAIR for each of 2 subpaths = 4 shapes)', () => {
    const circle = mockShapeEl('circle', { cx: '0', cy: '0', r: '5', 'stroke-width': '2', stroke: '#000', fill: 'none', 'data-layer': '1' });
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [circle] });
    refreshOutlinePreview(editor);
    // stroke mode -> 2 subpaths (outer+inner) in ONE `d` string -> still
    // exactly one halo + one line PATH ELEMENT (the `d` carries both
    // subpaths together, matching circleOutlinePathD's own single-string
    // multi-subpath return) -> HALO_AND_LINE, not doubled.
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    expect(editor._outlinePreviewLayer._shapes[0]._d).toContain('M -6 0'); // outer ring (r+half=5+1=6) starts at cx-outerR
    expect(editor._outlinePreviewLayer._shapes[0]._d).toContain('M -4 0'); // inner ring (r-half=5-1=4)
  });

  it('a FILLED circle (fill set, stroke="none") gets mode:fill — its own exact edge, not the annulus', () => {
    const circle = mockShapeEl('circle', { cx: '0', cy: '0', r: '5', 'stroke-width': '2', stroke: 'none', fill: '#f00', 'data-layer': '1' });
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [circle] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes[0]._d).toContain('M -5 0'); // exact edge (r=5), NOT r+half=6 or r-half=4
  });

  it('a circle with BOTH fill and stroke gets mode:both — outer ring only, no inner (non-vacuous: checked by ABSENCE of the inner ring, not just presence of the outer — a bare substring check on the outer ring alone can\'t tell "both" apart from "stroke", since both share the same outer-ring formula)', () => {
    const circle = mockShapeEl('circle', { cx: '0', cy: '0', r: '5', 'stroke-width': '2', stroke: '#000', fill: '#f00', 'data-layer': '1' });
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [circle] });
    refreshOutlinePreview(editor);
    const d = editor._outlinePreviewLayer._shapes[0]._d;
    expect(d).toContain('M -6 0'); // outer, r+half=6
    expect(d).not.toContain('M -4 0'); // the stroke-mode annulus's inner ring (r-half=4) must be ABSENT
    expect(d).not.toContain(' M '); // a second subpath would introduce a mid-string " M " separator
  });

  it('a stroke-only rect gets the stroke-mode outer+inner pair', () => {
    const rect = mockShapeEl('rect', { x: '0', y: '0', width: '10', height: '6', 'stroke-width': '2', stroke: '#000', fill: 'none', 'data-layer': '1' });
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [rect] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes[0]._d).toContain(' Z M '); // two subpaths present in one `d`
  });
});

describe('refreshOutlinePreview — the structural guarantee behind every "excluded from X" requirement', () => {
  it('never writes into _sketchLayer — only ever reads it. Confirmed by construction: the sketch layer\'s own children() array identity is unchanged before/after', () => {
    const line = mockLineEl(LINE_ATTRS);
    const children = [line];
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children });
    const before = editor._sketchLayer.children().toArray();
    refreshOutlinePreview(editor);
    const after = editor._sketchLayer.children().toArray();
    expect(after).toBe(before); // same array reference — nothing pushed/removed
    expect(after).toEqual([line]); // and the same single element, untouched
  });

  it('non-vacuous: a defensive no-op guard exists for a missing _outlinePreviewLayer/_sketchLayer, proving this function itself never assumes the editor is fully initialized', () => {
    expect(() => refreshOutlinePreview({})).not.toThrow();
    expect(() => refreshOutlinePreview(null)).not.toThrow();
    expect(() => refreshOutlinePreview({ _outlinePreviewLayer: mockPreviewLayer() })).not.toThrow();
  });
});
