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
  snapToGrid,
  mergeGridPrefs,
  loadGridPrefs,
  applyGrid,
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
