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
    // T40: OUTLINE_KINDS reads stroke-linecap via el.node.getAttribute
    // (not el.attr — see _capOf's own header for why), so the mock's
    // .node needs the SAME "genuinely absent -> null" contract the real
    // DOM has, not svg.js's own attr()-level default-filling behavior.
    node: { getAttribute: (a) => (a in state ? state[a] : null) },
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
  it('a visible layer picked outline: its round-cap line gets a halo+line preview pair', async () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    for (const s of editor._outlinePreviewLayer._shapes) expect(s._d).toMatch(/^M /);
  });

  it('both centerline (default) and a missing layer entirely produce NO preview', async () => {
    const line1 = mockLineEl(LINE_ATTRS);
    const line2 = mockLineEl({ ...LINE_ATTRS, 'data-layer': '99' }); // no matching layer object at all
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'centerline' }], children: [line1, line2] });
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });

  it('"both" also gets a preview (not just "outline")', async () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'both' }], children: [line] });
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
  });

  it('a HIDDEN layer gets no preview even when picked outline — the master visible gate wins, same as isCarved/showsColor', async () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: false, fusionGeometry: 'outline' }], children: [line] });
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });

  it('a kind with no OUTLINE_KINDS entry (e.g. an unbuilt future kind) is skipped silently, no error', async () => {
    const el = { type: 'unbuiltFutureKind', attr: (a) => ({ 'data-layer': '1' }[a]) };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
    await refreshOutlinePreview(editor); // a rejection here would fail this test on its own
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });

  it('rebuilds from scratch on every call — .clear() removes the previous run\'s shapes, not just appends', async () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    await refreshOutlinePreview(editor);
    await refreshOutlinePreview(editor);
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE); // not 6
  });

  it('picking Centerline empties a layer\'s preview on the next call — the "counts as a commit" property, proven by construction (no cache to go stale)', async () => {
    const line = mockLineEl(LINE_ATTRS);
    const layer = { id: '1', visible: true, fusionGeometry: 'outline' };
    const editor = mockEditor({ layers: [layer], children: [line] });
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    layer.fusionGeometry = 'centerline';
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });
});

describe('OUTLINE_KINDS — table-driven, not a hardcoded <line> check (T37 amendment)', () => {
  it('has exactly the kinds built so far: line (T37), circle/rect (T38), ellipse (T38 amend, biarc-fit), polyline/polygon/path (T39, general engine), text (T40 part 2, glyph outlines)', async () => {
    expect(Object.keys(OUTLINE_KINDS).sort()).toEqual(['circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect', 'text']);
  });

  it('adding a kind is a TABLE entry, not a refreshOutlinePreview change — proven by adding one temporarily (an unbuilt future kind) and confirming it fires with zero edits to the function under test', async () => {
    const el = { type: 'unbuiltFutureKind', attr: (a) => ({ 'data-layer': '1' }[a]) };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });

    // Before the entry exists: skipped (matches the "no OUTLINE_KINDS
    // entry" test above — restated here as the BEFORE half of the same
    // before/after comparison).
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);

    // Add a throwaway entry (not one of the real kinds — overwriting-then-
    // deleting one of those would corrupt the shared module-level table
    // for every test that runs after this one) — this is only to prove
    // the table IS what refreshOutlinePreview consults, not a hardcoded
    // type check reintroduced by mistake.
    OUTLINE_KINDS.unbuiltFutureKind = () => ({ d: 'M 0 0 L 1 0 L 1 1 Z', unsupported: null });
    try {
      await refreshOutlinePreview(editor);
      expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    } finally {
      delete OUTLINE_KINDS.unbuiltFutureKind; // leave the shared table exactly as found
    }
  });

  it('an entry returning { unsupported } still gets no preview, even though the kind IS in the table — the table only says HOW to try, not that every attempt succeeds. Ellipse/text are both real entries now, so this uses a throwaway table entry instead of relying on either to decline', async () => {
    OUTLINE_KINDS.unbuiltFutureKind = () => ({ d: null, unsupported: 'curve' });
    try {
      expect(OUTLINE_KINDS.unbuiltFutureKind()).toEqual({ d: null, unsupported: 'curve' });
      const el = { type: 'unbuiltFutureKind', attr: (a) => ({ 'data-layer': '1' }[a]) };
      const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
      await refreshOutlinePreview(editor);
      expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
    } finally {
      delete OUTLINE_KINDS.unbuiltFutureKind; // leave the shared table exactly as found
    }
  });

  it('ellipse (T38 amend) produces a real biarc-fit preview through refreshOutlinePreview, not a decline', async () => {
    const el = {
      type: 'ellipse',
      attr: (a) => ({ 'data-layer': '1', cx: '5', cy: '3', rx: '3', ry: '1', 'stroke-width': '0.1' }[a]),
    };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    const line = editor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));
    expect(line._d).toMatch(/^M /);
    expect(line._d).not.toContain('unsupported');
  });

  it('polygon (T39, general engine) produces a real preview through refreshOutlinePreview, reading points via .array() the same way editor-transform-handles.js already does', async () => {
    const el = {
      type: 'polygon',
      attr: (a) => ({ 'data-layer': '1', 'stroke-width': '0.2' }[a]),
      array: () => [[0, 0], [10, 0], [10, 10], [0, 10]],
      node: { getAttribute: () => null },
    };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    const line = editor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));
    expect(line._d).toMatch(/^M /);
    expect(line._d).toContain('Z'); // polygon closes -- points-to-d wiring includes the Z
  });

  it('polyline (T39) produces a real preview through refreshOutlinePreview — an OPEN source polyline still traces a single closed CAPSULE outline (matching lineOutlinePathD\'s own convention), only one M', async () => {
    const el = {
      type: 'polyline',
      attr: (a) => ({ 'data-layer': '1', 'stroke-width': '0.2' }[a]),
      array: () => [[0, 0], [10, 0], [10, 10]],
      node: { getAttribute: () => null },
    };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    const line = editor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));
    expect(line._d).toMatch(/^M /);
    expect((line._d.match(/M/g) || []).length).toBe(1);
  });

  it('path (T39) reads its own d attribute and produces a real preview through refreshOutlinePreview', async () => {
    const el = {
      type: 'path',
      attr: (a) => ({ 'data-layer': '1', 'stroke-width': '0.2', d: 'M 0 0 L 10 0 L 10 10 L 0 10 Z' }[a]),
      node: { getAttribute: () => null },
    };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    const line = editor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));
    expect(line._d).toMatch(/^M /);
  });

  it('T44: path reads its own stroke-linejoin/stroke-miterlimit attributes (same el.node.getAttribute pattern as stroke-linecap) — a miter join produces a DIFFERENT `d` than the round-join default for the identical source shape', async () => {
    const mockPathEl = (extraAttrs) => {
      // stroke-linecap:'butt' isolates the join under test from the two
      // open ends' own caps, which default to round regardless of
      // linejoin and would otherwise ALSO contribute an 'A'.
      const state = { 'data-layer': '1', 'stroke-width': '2', 'stroke-linecap': 'butt', d: 'M 0 0 L 10 0 L 10 -10', ...extraAttrs };
      return {
        type: 'path',
        attr: (a) => state[a],
        node: { getAttribute: (a) => (a in state ? state[a] : null) },
      };
    };
    const layers = [{ id: '1', visible: true, fusionGeometry: 'outline' }];

    const roundEditor = mockEditor({ layers, children: [mockPathEl({})] });
    await refreshOutlinePreview(roundEditor);
    const roundLine = roundEditor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));

    const miterEditor = mockEditor({ layers, children: [mockPathEl({ 'stroke-linejoin': 'miter' })] });
    await refreshOutlinePreview(miterEditor);
    const miterLine = miterEditor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));

    expect(roundLine._d).toContain('A'); // default round join -- an arc at the outer corner
    expect(miterLine._d).not.toContain('A'); // miter join -- a sharp point instead, no arc
    expect(miterLine._d).not.toBe(roundLine._d);
  });

  it('T44: a custom stroke-miterlimit is read and actually changes the output — a strict limit forces bevel where the default (4) would keep the miter, for the SAME miter-requesting source', async () => {
    const mockPathEl = (extraAttrs) => {
      // Right-angle turn: miter ratio ~1.41, under the default limit (4)
      // but over a strict limit (1).
      const state = { 'data-layer': '1', 'stroke-width': '2', d: 'M 0 0 L 10 0 L 10 -10', 'stroke-linejoin': 'miter', ...extraAttrs };
      return {
        type: 'path',
        attr: (a) => state[a],
        node: { getAttribute: (a) => (a in state ? state[a] : null) },
      };
    };
    const layers = [{ id: '1', visible: true, fusionGeometry: 'outline' }];

    const defaultEditor = mockEditor({ layers, children: [mockPathEl({})] });
    await refreshOutlinePreview(defaultEditor);
    const defaultLine = defaultEditor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));

    const strictEditor = mockEditor({ layers, children: [mockPathEl({ 'stroke-miterlimit': '1' })] });
    await refreshOutlinePreview(strictEditor);
    const strictLine = strictEditor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));

    expect(defaultLine._d).not.toBe(strictLine._d); // the miterlimit attribute genuinely reached pathOutlinePathD
  });
});

describe('refreshOutlinePreview — visibility fix (T38): fixed dark-over-white halo, not the element\'s own color', () => {
  it('every preview element gets exactly one .outline-preview-halo shape and one .outline-preview-line shape, halo first (drawn underneath)', async () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    await refreshOutlinePreview(editor);
    const [halo, dark] = editor._outlinePreviewLayer._shapes;
    expect(halo._classes).toContain('outline-preview-halo');
    expect(dark._classes).toContain('outline-preview-line');
  });

  it('showColor(layer) no longer affects the preview at all — same halo+line pair whether the layer shows its own color or not (there is no per-element color choice left to gate)', async () => {
    const lineA = mockLineEl(LINE_ATTRS);
    const editorShowColor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline', showColor: true }], children: [lineA] });
    await refreshOutlinePreview(editorShowColor);
    const withColor = editorShowColor._outlinePreviewLayer._shapes.map((s) => s._classes);

    const lineB = mockLineEl(LINE_ATTRS);
    const editorNoColor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline', showColor: false }], children: [lineB] });
    await refreshOutlinePreview(editorNoColor);
    const withoutColor = editorNoColor._outlinePreviewLayer._shapes.map((s) => s._classes);

    expect(withColor).toEqual(withoutColor);
    expect(withColor.flat()).not.toContain('layer-no-color'); // the OLD mechanism, fully retired
  });

  it('non-vacuous: no .fill()/.stroke() calls at all — color/width live entirely in CSS now, not per-element attrs', async () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    await refreshOutlinePreview(editor);
    for (const s of editor._outlinePreviewLayer._shapes) {
      expect(s._fill).toBeNull();
      expect(s._stroke).toBeNull();
    }
  });
});

describe('refreshOutlinePreview — geometry: local frame, own transform carried over, not baked', () => {
  it('BOTH the halo and line shapes get the SAME transform attribute the source line carries', async () => {
    const line = mockLineEl({ ...LINE_ATTRS, transform: 'matrix(1,0,0,1,5,5)' });
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    await refreshOutlinePreview(editor);
    for (const s of editor._outlinePreviewLayer._shapes) expect(s._transform).toBe('matrix(1,0,0,1,5,5)');
  });

  it('no transform on the source: none written to either preview shape (not "identity" busywork)', async () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    await refreshOutlinePreview(editor);
    for (const s of editor._outlinePreviewLayer._shapes) expect(s._transform).toBeNull();
  });
});

function mockShapeEl(type, attrs) {
  const state = { ...attrs };
  return { type, attr: (a) => state[a] };
}

describe('OUTLINE_KINDS.circle / .rect — wired end-to-end through refreshOutlinePreview, including fill-mode detection from the element\'s OWN attrs (T38)', () => {
  it('a stroke-only circle (fill="none") gets the stroke-mode annulus (halo+line PAIR for each of 2 subpaths = 4 shapes)', async () => {
    const circle = mockShapeEl('circle', { cx: '0', cy: '0', r: '5', 'stroke-width': '2', stroke: '#000', fill: 'none', 'data-layer': '1' });
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [circle] });
    await refreshOutlinePreview(editor);
    // stroke mode -> 2 subpaths (outer+inner) in ONE `d` string -> still
    // exactly one halo + one line PATH ELEMENT (the `d` carries both
    // subpaths together, matching circleOutlinePathD's own single-string
    // multi-subpath return) -> HALO_AND_LINE, not doubled.
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    expect(editor._outlinePreviewLayer._shapes[0]._d).toContain('M -6 0'); // outer ring (r+half=5+1=6) starts at cx-outerR
    expect(editor._outlinePreviewLayer._shapes[0]._d).toContain('M -4 0'); // inner ring (r-half=5-1=4)
  });

  it('a FILLED circle (fill set, stroke="none") gets mode:fill — its own exact edge, not the annulus', async () => {
    const circle = mockShapeEl('circle', { cx: '0', cy: '0', r: '5', 'stroke-width': '2', stroke: 'none', fill: '#f00', 'data-layer': '1' });
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [circle] });
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes[0]._d).toContain('M -5 0'); // exact edge (r=5), NOT r+half=6 or r-half=4
  });

  it('a circle with BOTH fill and stroke gets mode:both — outer ring only, no inner (non-vacuous: checked by ABSENCE of the inner ring, not just presence of the outer — a bare substring check on the outer ring alone can\'t tell "both" apart from "stroke", since both share the same outer-ring formula)', async () => {
    const circle = mockShapeEl('circle', { cx: '0', cy: '0', r: '5', 'stroke-width': '2', stroke: '#000', fill: '#f00', 'data-layer': '1' });
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [circle] });
    await refreshOutlinePreview(editor);
    const d = editor._outlinePreviewLayer._shapes[0]._d;
    expect(d).toContain('M -6 0'); // outer, r+half=6
    expect(d).not.toContain('M -4 0'); // the stroke-mode annulus's inner ring (r-half=4) must be ABSENT
    expect(d).not.toContain(' M '); // a second subpath would introduce a mid-string " M " separator
  });

  it('a stroke-only rect gets the stroke-mode outer+inner pair', async () => {
    const rect = mockShapeEl('rect', { x: '0', y: '0', width: '10', height: '6', 'stroke-width': '2', stroke: '#000', fill: 'none', 'data-layer': '1' });
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [rect] });
    await refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes[0]._d).toContain(' Z M '); // two subpaths present in one `d`
  });
});

describe('refreshOutlinePreview — the structural guarantee behind every "excluded from X" requirement', () => {
  it('never writes into _sketchLayer — only ever reads it. Confirmed by construction: the sketch layer\'s own children() array identity is unchanged before/after', async () => {
    const line = mockLineEl(LINE_ATTRS);
    const children = [line];
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children });
    const before = editor._sketchLayer.children().toArray();
    await refreshOutlinePreview(editor);
    const after = editor._sketchLayer.children().toArray();
    expect(after).toBe(before); // same array reference — nothing pushed/removed
    expect(after).toEqual([line]); // and the same single element, untouched
  });

  it('non-vacuous: a defensive no-op guard exists for a missing _outlinePreviewLayer/_sketchLayer, proving this function itself never assumes the editor is fully initialized', async () => {
    await refreshOutlinePreview({}); // a rejection on any of these three would fail this test on its own
    await refreshOutlinePreview(null);
    await refreshOutlinePreview({ _outlinePreviewLayer: mockPreviewLayer() });
  });
});

describe('OUTLINE_KINDS.text — T40 part 2, glyph outlines', () => {
  it('the REAL entry, against a mock text element, declines gracefully with unsupported:"font" in this test environment (dynamic import of an https: URL is a browser-only capability — Node\'s ESM loader rejects it, confirmed live: textGlyphPathD\'s own try/catch swallows that and returns null). Proves the failure path end-to-end without needing a real font fetch.', async () => {
    const el = {
      type: 'text',
      attr: (a) => ({ 'data-layer': '1', 'font-family': 'Arial', 'font-size': '3', x: '0', y: '0' }[a]),
      node: { childNodes: [], getAttribute: () => null },
      text: () => 'Hi',
    };
    const result = await OUTLINE_KINDS.text(el);
    expect(result.d).toBeNull();
    expect(result.unsupported).toBe('font');

    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
    await refreshOutlinePreview(editor); // must not throw despite the failed extraction
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });

  it('has exactly the kinds built so far includes text (own assertion, kept in sync with the shared list test above)', () => {
    expect(Object.keys(OUTLINE_KINDS)).toContain('text');
  });

  it('when glyph extraction SUCCEEDS, refreshOutlinePreview awaits the async entry and renders it — verified via a temporary controlled stand-in (the real entry can\'t succeed in this test env, see the test above), same "overwrite a real table entry, restore in finally" pattern the ellipse/circle end-to-end tests already use', async () => {
    const originalText = OUTLINE_KINDS.text;
    OUTLINE_KINDS.text = async () => ({ d: 'M 5 5 L 6 5 L 6 6 Z', unsupported: null });
    try {
      const el = { type: 'text', attr: (a) => ({ 'data-layer': '1' }[a]) };
      const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
      await refreshOutlinePreview(editor);
      expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
      const line = editor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));
      expect(line._d).toBe('M 5 5 L 6 5 L 6 6 Z');
    } finally {
      OUTLINE_KINDS.text = originalText;
    }
  });

  it('a superseded refresh (an older call still awaiting a slow text entry when a newer call starts and finishes first) does not write its own stale shapes afterward — the generation guard this turn added specifically because refreshOutlinePreview reruns on every commit and a real font fetch is genuinely slow', async () => {
    const originalText = OUTLINE_KINDS.text;
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    let callCount = 0;
    OUTLINE_KINDS.text = async () => {
      callCount += 1;
      if (callCount === 1) { await firstGate; return { d: 'M 0 0 L 1 0 L 1 1 Z', unsupported: null }; } // slow, superseded call
      return { d: 'M 9 9 L 9.5 9 L 9.5 9.5 Z', unsupported: null }; // fast, "current" call
    };
    try {
      const el = { type: 'text', attr: (a) => ({ 'data-layer': '1' }[a]) };
      const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });

      const firstCall = refreshOutlinePreview(editor); // starts, blocks inside OUTLINE_KINDS.text awaiting firstGate
      await refreshOutlinePreview(editor); // second call resolves immediately and finishes completely first
      expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
      let line = editor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));
      expect(line._d).toBe('M 9 9 L 9.5 9 L 9.5 9.5 Z'); // the newer call's own geometry

      releaseFirst(); // let the stale first call resume and finish
      await firstCall;
      // the stale call's own generation check must have caught it before it
      // touched the DOM -- still exactly the SECOND call's shapes, not
      // doubled and not overwritten by the first call's own stale geometry.
      expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
      line = editor._outlinePreviewLayer._shapes.find((s) => s._classes.includes('outline-preview-line'));
      expect(line._d).toBe('M 9 9 L 9.5 9 L 9.5 9.5 Z');
    } finally {
      OUTLINE_KINDS.text = originalText;
    }
  });
});
