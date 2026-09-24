/**
 * SE6 — snap-to-grid + faint customisable grid (editor/editor-grid.js).
 *
 * snapToGrid and mergeGridPrefs are pure (no svg.js/DOM), same split as
 * editor-view.js's viewboxFor/zoomAbout — unit-tested directly here.
 * applyGrid needs a live layer to draw into; mocked below with a minimal
 * svg.js-shaped stub (clear/line/stroke/attr) so the major/minor and
 * line-count logic is still exercised without a real editor.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  GRID_DEFAULTS,
  GRID_SPACINGS,
  SNAP_POLICY,
  snapToGrid,
  snapFor,
  mergeGridPrefs,
  loadGridPrefs,
  applyGrid,
  nearestGridNode,
  gridHoverExtents,
  updateGridHover,
  clearGridHover,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-grid.js';

describe('snapToGrid', () => {
  const grid = { visible: true, snap: true, spacing: 0.25 };

  it('is identity when the grid is not snapping', () => {
    const pt = { x: 1.13, y: 2.37 };
    expect(snapToGrid(pt, { ...grid, snap: false })).toEqual(pt);
  });

  it('is identity when bypass is set, even with snap on', () => {
    const pt = { x: 1.13, y: 2.37 };
    expect(snapToGrid(pt, grid, true)).toEqual(pt);
  });

  it('rounds both axes to the nearest multiple of spacing when snapping', () => {
    expect(snapToGrid({ x: 1.13, y: 2.37 }, grid)).toEqual({ x: 1.25, y: 2.25 });
    expect(snapToGrid({ x: 0.87, y: 0.6 }, grid)).toEqual({ x: 0.75, y: 0.5 });
  });

  it('rounds a negative coordinate correctly', () => {
    expect(snapToGrid({ x: -1.13, y: -0.4 }, grid)).toEqual({ x: -1.25, y: -0.5 });
  });
});

describe('mergeGridPrefs', () => {
  it('returns GRID_DEFAULTS when there is nothing stored', () => {
    expect(mergeGridPrefs(null)).toEqual(GRID_DEFAULTS);
    expect(mergeGridPrefs(undefined)).toEqual(GRID_DEFAULTS);
  });

  it('merges a partial stored object over GRID_DEFAULTS rather than replacing it', () => {
    expect(mergeGridPrefs({ visible: true })).toEqual({ ...GRID_DEFAULTS, visible: true });
    expect(mergeGridPrefs({ spacing: 0.5 })).toEqual({ ...GRID_DEFAULTS, spacing: 0.5 });
  });

  it('falls back to GRID_DEFAULTS for a malformed (non-object) stored value', () => {
    expect(mergeGridPrefs('garbage')).toEqual(GRID_DEFAULTS);
    expect(mergeGridPrefs(42)).toEqual(GRID_DEFAULTS);
  });
});

describe('loadGridPrefs (localStorage integration)', () => {
  beforeEach(() => {
    try { localStorage.removeItem('bsg.editorGrid'); } catch (_) {}
  });

  it('returns GRID_DEFAULTS when nothing is stored', () => {
    expect(loadGridPrefs()).toEqual(GRID_DEFAULTS);
  });

  it('merges a stored partial object over GRID_DEFAULTS', () => {
    localStorage.setItem('bsg.editorGrid', JSON.stringify({ snap: true }));
    expect(loadGridPrefs()).toEqual({ ...GRID_DEFAULTS, snap: true });
  });

  it('does not throw and falls back to defaults on a corrupt stored value', () => {
    localStorage.setItem('bsg.editorGrid', 'not json');
    expect(loadGridPrefs()).toEqual(GRID_DEFAULTS);
  });
});

function mockGridLayer() {
  const layer = {
    cleared: 0,
    lines: [],
    clear() { layer.cleared++; layer.lines = []; },
    line(x1, y1, x2, y2) {
      const rec = { x1, y1, x2, y2, strokeOpts: null, attrs: null };
      const chain = {
        stroke(opts) { rec.strokeOpts = opts; return chain; },
        attr(opts) { rec.attrs = opts; return chain; },
      };
      layer.lines.push(rec);
      return chain;
    },
  };
  return layer;
}

describe('applyGrid', () => {
  it('clears and draws nothing when the grid is not visible', () => {
    const editor = { _gridLayer: mockGridLayer(), _grid: { ...GRID_DEFAULTS, visible: false }, _mW: 1, _mH: 1 };
    applyGrid(editor);
    expect(editor._gridLayer.cleared).toBe(1);
    expect(editor._gridLayer.lines).toHaveLength(0);
  });

  it('draws one line per axis per spacing step, classifying whole-inch lines as major', () => {
    const editor = { _gridLayer: mockGridLayer(), _grid: { visible: true, snap: false, spacing: 0.5 }, _mW: 1, _mH: 1 };
    applyGrid(editor);

    // 3 vertical (x=0,0.5,1) + 3 horizontal (y=0,0.5,1) on a 1x1 board.
    expect(editor._gridLayer.lines).toHaveLength(6);

    const majors = editor._gridLayer.lines.filter(l => l.attrs.opacity === 0.22);
    const minors = editor._gridLayer.lines.filter(l => l.attrs.opacity === 0.10);
    expect(majors).toHaveLength(4); // x=0, x=1, y=0, y=1
    expect(minors).toHaveLength(2); // x=0.5, y=0.5

    // Every line carries the zoom-stable / non-interactive attrs.
    for (const l of editor._gridLayer.lines) {
      expect(l.attrs['vector-effect']).toBe('non-scaling-stroke');
      expect(l.attrs['pointer-events']).toBe('none');
    }
  });

  it('redraws (clears first) on every call, not just the first', () => {
    const editor = { _gridLayer: mockGridLayer(), _grid: { visible: true, snap: false, spacing: 1 }, _mW: 2, _mH: 2 };
    applyGrid(editor);
    applyGrid(editor);
    expect(editor._gridLayer.cleared).toBe(2);
  });

  it('does nothing when there is no grid layer (editor not initialized yet)', () => {
    expect(() => applyGrid({ _gridLayer: null, _grid: GRID_DEFAULTS, _mW: 7, _mH: 9 })).not.toThrow();
  });
});

describe('GRID_SPACINGS', () => {
  it('is a non-empty list of positive numbers including the documented default', () => {
    expect(GRID_SPACINGS.length).toBeGreaterThan(0);
    expect(GRID_SPACINGS.every(s => typeof s === 'number' && s > 0)).toBe(true);
    expect(GRID_SPACINGS).toContain(GRID_DEFAULTS.spacing);
  });
});

describe('snapFor — per-tool snap policy (SE7a)', () => {
  const onGrid = { visible: true, snap: true, spacing: 0.25 };
  const pt = { x: 1.13, y: 2.37 };

  it('erase never snaps, even with grid.snap on and no bypass', () => {
    expect(snapFor(pt, onGrid, 'erase', 'start', false)).toEqual(pt);
    expect(snapFor(pt, onGrid, 'erase', 'move', false)).toEqual(pt);
  });

  it('expand never snaps either — same "none" policy', () => {
    expect(SNAP_POLICY.expand).toBe('none');
    expect(snapFor(pt, onGrid, 'expand', 'start', false)).toEqual(pt);
  });

  it('circle snaps on start (the center) but not on move (the radius drag)', () => {
    const snappedStart = snapFor(pt, onGrid, 'circle', 'start', false);
    expect(snappedStart).toEqual({ x: 1.25, y: 2.25 });
    expect(snapFor(pt, onGrid, 'circle', 'move', false)).toEqual(pt);
  });

  it('draw (pen) snaps the anchor click but not a freehand move', () => {
    expect(snapFor(pt, onGrid, 'draw', 'start', false)).toEqual({ x: 1.25, y: 2.25 });
    expect(snapFor(pt, onGrid, 'draw', 'move', false)).toEqual(pt);
  });

  it('lattice snaps even with grid.snap off, and even with Alt (bypass) held', () => {
    const gridOff = { visible: true, snap: false, spacing: 0.25 };
    expect(snapFor(pt, gridOff, 'lattice', 'start', false)).toEqual({ x: 1.25, y: 2.25 });
    expect(snapFor(pt, onGrid, 'lattice', 'start', true)).toEqual({ x: 1.25, y: 2.25 });
  });

  it('line honours Alt bypass like every other "point"-policy tool', () => {
    expect(snapFor(pt, onGrid, 'line', 'start', true)).toEqual(pt);
    expect(snapFor(pt, onGrid, 'line', 'start', false)).toEqual({ x: 1.25, y: 2.25 });
  });

  it('an unlisted mode falls back to "point" policy rather than throwing', () => {
    expect(snapFor(pt, onGrid, 'nonexistent-mode', 'start', false)).toEqual({ x: 1.25, y: 2.25 });
  });
});

describe('nearestGridNode (T31 / SE6c)', () => {
  it('rounds a point already on the lattice to itself', () => {
    expect(nearestGridNode({ x: 0.5, y: 0.75 }, 0.25)).toEqual({ i: 2, j: 3 });
  });

  it('rounds an off-lattice point to the nearest cell', () => {
    expect(nearestGridNode({ x: 0.61, y: -0.4 }, 0.25)).toEqual({ i: 2, j: -2 });
  });

  it('rounds .5-exactly-between cases up (Math.round\'s own convention, not re-implemented differently here)', () => {
    expect(nearestGridNode({ x: 0.375, y: 0 }, 0.25)).toEqual({ i: 2, j: 0 }); // 0.375/0.25 = 1.5 -> 2
  });

  it('scales with spacing', () => {
    expect(nearestGridNode({ x: 1.0, y: 1.0 }, 0.5)).toEqual({ i: 2, j: 2 });
    expect(nearestGridNode({ x: 1.0, y: 1.0 }, 1)).toEqual({ i: 1, j: 1 });
  });
});

describe('gridHoverExtents (T31 / SE6c)', () => {
  it('the row spans the FULL board width at the node\'s own y; the column spans the full height at its own x', () => {
    const { row, col } = gridHoverExtents(2, 3, 0.25, 7, 9);
    expect(row).toEqual({ x1: 0, y1: 0.75, x2: 7, y2: 0.75 });
    expect(col).toEqual({ x1: 0.5, y1: 0, x2: 0.5, y2: 9 });
  });

  it('node {0,0} still produces board-spanning lines, not degenerate zero-length ones', () => {
    const { row, col } = gridHoverExtents(0, 0, 0.25, 7, 9);
    expect(row).toEqual({ x1: 0, y1: 0, x2: 7, y2: 0 });
    expect(col).toEqual({ x1: 0, y1: 0, x2: 0, y2: 9 });
  });
});

// T31: updateGridHover/clearGridHover — mock _handleLayer shaped like
// applyGrid's own mockGridLayer above (same file, same convention), plus
// circle() and the chain methods (plot/radius/center/front/remove, and a
// .node.isConnected the source's own connectivity check reads) this
// feature actually calls. Covers exactly what the dispatch's own "Verify"
// asked for (hidden when grid hidden / policy none) plus the judgment
// calls this turn added (Alt bypass, reuse-not-recreate, node-ring
// suppression when the snap cursor already marks the same spot) — NOT an
// exhaustive pixel-level visual check, which is what the CDP screenshot
// verification is for instead (this file's own applyGrid tests draw the
// same line, per its header comment).
function mockHandleLayer() {
  const created = [];
  function makeShape(kind) {
    const node = { isConnected: true };
    const rec = { kind, attrs: {}, strokeOpts: null, plotArgs: null, radiusVal: null, centerArgs: null, frontCount: 0, node };
    const chain = {
      node,
      attr(opts) { Object.assign(rec.attrs, opts); return chain; },
      stroke(opts) { rec.strokeOpts = opts; return chain; },
      fill(f) { rec.fill = f; return chain; },
      plot(x1, y1, x2, y2) { rec.plotArgs = [x1, y1, x2, y2]; return chain; },
      radius(r) { rec.radiusVal = r; return chain; },
      center(x, y) { rec.centerArgs = [x, y]; return chain; },
      front() { rec.frontCount++; return chain; },
      remove() { node.isConnected = false; return chain; },
    };
    rec.el = chain;
    created.push(rec);
    return chain;
  }
  return { created, line: () => makeShape('line'), circle: () => makeShape('circle') };
}

function mockHoverEditor(overrides = {}) {
  return {
    _handleLayer: mockHandleLayer(),
    _grid: { visible: true, snap: false, spacing: 0.25 },
    _currentMode: 'select',
    _mW: 7, _mH: 9,
    _getMousePoint: () => ({ x: 1.1, y: 2.1 }), // -> nearest node {i:4, j:8}, i.e. (1.0, 2.0)
    _getDynamicTolerance: (px) => px * 0.01,
    ...overrides,
  };
}

describe('updateGridHover / clearGridHover (T31 / SE6c)', () => {
  it('draws nothing when the grid is not visible', () => {
    const editor = mockHoverEditor({ _grid: { visible: false, snap: false, spacing: 0.25 } });
    updateGridHover(editor, {});
    expect(editor._handleLayer.created).toHaveLength(0);
  });

  it('draws nothing in a mode whose SNAP_POLICY is "none" (erase/expand)', () => {
    const editor = mockHoverEditor({ _currentMode: 'erase' });
    updateGridHover(editor, {});
    expect(editor._handleLayer.created).toHaveLength(0);
  });

  it('draws nothing while Alt (bypass) is held', () => {
    const editor = mockHoverEditor();
    updateGridHover(editor, { altKey: true });
    expect(editor._handleLayer.created).toHaveLength(0);
  });

  it('draws the row+column guide pairs AND the node ring pair (6 elements) in the normal case', () => {
    const editor = mockHoverEditor();
    updateGridHover(editor, {});
    expect(editor._handleLayer.created).toHaveLength(6);
    const lines = editor._handleLayer.created.filter(r => r.kind === 'line');
    const circles = editor._handleLayer.created.filter(r => r.kind === 'circle');
    expect(lines).toHaveLength(4);
    expect(circles).toHaveLength(2);
  });

  it('positions the row/column lines through the nearest node, spanning the full board', () => {
    const editor = mockHoverEditor();
    updateGridHover(editor, {});
    const gh = editor._gridHover;
    expect(gh.rowCore.node && true).toBe(true); // sanity: refs were stored
    // node is {i:4, j:8} at spacing 0.25 -> (1.0, 2.0)
    const rowRec = editor._handleLayer.created.find(r => r.el === gh.rowCore);
    const colRec = editor._handleLayer.created.find(r => r.el === gh.colCore);
    expect(rowRec.plotArgs).toEqual([0, 2.0, 7, 2.0]);
    expect(colRec.plotArgs).toEqual([1.0, 0, 1.0, 9]);
  });

  it('centers the node ring on the nearest node, using a positive radius', () => {
    const editor = mockHoverEditor();
    updateGridHover(editor, {});
    const gh = editor._gridHover;
    const nodeRec = editor._handleLayer.created.find(r => r.el === gh.nodeCore);
    expect(nodeRec.centerArgs).toEqual([1.0, 2.0]);
    expect(nodeRec.radiusVal).toBeGreaterThan(0);
  });

  it('reuses the SAME elements across two calls — no create/destroy per frame', () => {
    const editor = mockHoverEditor();
    updateGridHover(editor, {});
    const first = { ...editor._gridHover };
    updateGridHover(editor, {});
    expect(editor._handleLayer.created).toHaveLength(6); // still 6, not 12
    expect(editor._gridHover.rowCore).toBe(first.rowCore);
    expect(editor._gridHover.nodeCore).toBe(first.nodeCore);
  });

  it('suppresses its OWN node ring when the snap cursor is already showing there — "the node ring IS the snap ring"', () => {
    const editor = mockHoverEditor({
      _snapCursor: { node: { isConnected: true } }, // simulates updateSnapCursor already having drawn its ring this move
    });
    updateGridHover(editor, {});
    const circles = editor._handleLayer.created.filter(r => r.kind === 'circle');
    expect(circles).toHaveLength(0); // no node ring of its own
    const lines = editor._handleLayer.created.filter(r => r.kind === 'line');
    expect(lines).toHaveLength(4); // the guide lines still draw regardless
  });

  it('a previously-drawn node ring is removed if the snap cursor appears on a LATER call', () => {
    const editor = mockHoverEditor();
    updateGridHover(editor, {}); // no snap cursor yet -> node ring drawn
    expect(editor._handleLayer.created.filter(r => r.kind === 'circle')).toHaveLength(2);
    editor._snapCursor = { node: { isConnected: true } };
    updateGridHover(editor, {});
    expect(editor._gridHover.nodeOutline).toBeNull();
    expect(editor._gridHover.nodeCore).toBeNull();
  });

  it('clearGridHover removes every element and nulls every ref', () => {
    const editor = mockHoverEditor();
    updateGridHover(editor, {});
    clearGridHover(editor);
    for (const key of ['rowOutline', 'rowCore', 'colOutline', 'colCore', 'nodeOutline', 'nodeCore']) {
      expect(editor._gridHover[key]).toBeNull();
    }
    for (const rec of editor._handleLayer.created) {
      expect(rec.node.isConnected).toBe(false);
    }
  });

  it('does nothing (no throw) when there is no _handleLayer yet', () => {
    const editor = mockHoverEditor({ _handleLayer: null });
    expect(() => updateGridHover(editor, {})).not.toThrow();
  });

  it('clearGridHover is a safe no-op when nothing has been drawn yet', () => {
    const editor = mockHoverEditor();
    expect(() => clearGridHover(editor)).not.toThrow();
  });
});
