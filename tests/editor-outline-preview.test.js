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

describe('refreshOutlinePreview — which elements get a preview', () => {
  it('a visible layer picked outline: its round-cap line gets a preview path', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(1);
    expect(editor._outlinePreviewLayer._shapes[0]._d).toMatch(/^M /);
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
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(1);
  });

  it('a HIDDEN layer gets no preview even when picked outline — the master visible gate wins, same as isCarved/showsColor', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: false, fusionGeometry: 'outline' }], children: [line] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });

  it('a kind with no OUTLINE_KINDS entry (e.g. circle — T38\'s job, not this turn\'s) is skipped silently, no error', () => {
    const circle = { type: 'circle', attr: (a) => ({ 'data-layer': '1' }[a]) };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [circle] });
    expect(() => refreshOutlinePreview(editor)).not.toThrow();
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });

  it('rebuilds from scratch on every call — .clear() removes the previous run\'s shapes, not just appends', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    refreshOutlinePreview(editor);
    refreshOutlinePreview(editor);
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(1); // not 3
  });

  it('picking Centerline empties a layer\'s preview on the next call — the "counts as a commit" property, proven by construction (no cache to go stale)', () => {
    const line = mockLineEl(LINE_ATTRS);
    const layer = { id: '1', visible: true, fusionGeometry: 'outline' };
    const editor = mockEditor({ layers: [layer], children: [line] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(1);
    layer.fusionGeometry = 'centerline';
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });
});

describe('OUTLINE_KINDS — table-driven, not a hardcoded <line> check (T37 amendment)', () => {
  it('has exactly one entry today: line', () => {
    expect(Object.keys(OUTLINE_KINDS)).toEqual(['line']);
  });

  it('adding a kind is a TABLE entry, not a refreshOutlinePreview change — proven by adding one temporarily and confirming it fires with zero edits to the function under test', () => {
    const circleEl = { type: 'circle', attr: (a) => ({ 'data-layer': '1', cx: '2', cy: '3', r: '1' }[a]) };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [circleEl] });

    // Before the entry exists: skipped (matches the "no OUTLINE_KINDS
    // entry" test above — restated here as the BEFORE half of the same
    // before/after comparison).
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);

    // Add a throwaway 'circle' entry (T38's actual job, not built here —
    // this is only to prove the table IS what refreshOutlinePreview
    // consults, not a hardcoded type check reintroduced by mistake).
    OUTLINE_KINDS.circle = (el) => ({ d: `M ${el.attr('cx')} ${el.attr('cy')} m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0`, unsupported: null });
    try {
      refreshOutlinePreview(editor);
      expect(editor._outlinePreviewLayer._shapes).toHaveLength(1);
    } finally {
      delete OUTLINE_KINDS.circle; // leave the shared table exactly as found
    }
  });

  it('an entry returning { unsupported } still gets no preview, even though the kind IS in the table — the table only says HOW to try, not that every attempt succeeds', () => {
    const el = { type: 'ellipse', attr: (a) => ({ 'data-layer': '1' }[a]) };
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [el] });
    OUTLINE_KINDS.ellipse = () => ({ d: null, unsupported: 'ellipse' });
    try {
      refreshOutlinePreview(editor);
      expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
    } finally {
      delete OUTLINE_KINDS.ellipse;
    }
  });
});

describe('refreshOutlinePreview — color follows showsColor, same rule as the element itself', () => {
  it('showColor on (default): preview stroke uses the element\'s OWN current color, no neutral-color class', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline', showColor: true }], children: [line] });
    refreshOutlinePreview(editor);
    const shape = editor._outlinePreviewLayer._shapes[0];
    expect(shape._stroke.color).toBe('#3366ff'); // the line's own stroke attr
    expect(shape._classes).not.toContain('layer-no-color');
  });

  it('showColor off: preview gets .layer-no-color — the SAME CSS override class applyLayerState already puts on the source element, not a second neutral-color constant', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline', showColor: false }], children: [line] });
    refreshOutlinePreview(editor);
    const shape = editor._outlinePreviewLayer._shapes[0];
    expect(shape._classes).toContain('layer-no-color');
  });
});

describe('refreshOutlinePreview — geometry: local frame, own transform carried over, not baked', () => {
  it('the preview path gets the SAME transform attribute the source line carries', () => {
    const line = mockLineEl({ ...LINE_ATTRS, transform: 'matrix(1,0,0,1,5,5)' });
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes[0]._transform).toBe('matrix(1,0,0,1,5,5)');
  });

  it('no transform on the source: none written to the preview either (not "identity" busywork)', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = mockEditor({ layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }], children: [line] });
    refreshOutlinePreview(editor);
    expect(editor._outlinePreviewLayer._shapes[0]._transform).toBeNull();
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
