/**
 * editor-grid.js — SE6: a faint, customisable reference grid + snap-to-grid
 * for the SVG editor. Declared once here so the toolbar, editor.js, and
 * editor-interaction.js all derive from the same shape instead of each
 * hand-rolling their own notion of "the grid."
 *
 * The pure parts (snapToGrid, mergeGridPrefs) have no svg.js/DOM dependency
 * and are unit-tested directly (tests/editor-grid.test.js), matching
 * editor-view.js's own split between pure math and DOM-touching code.
 */

/** Board is in inches — spacing/coords here are all in the same model
 *  units as editor._mW/_mH (see editor-view.js's own note on this). */
export const GRID_DEFAULTS = { visible: false, snap: false, spacing: 0.25 };

/** The customisable spacing choices (inches). The toolbar select derives
 *  its options from this list — no hand-written <option>s to drift. */
export const GRID_SPACINGS = [0.0625, 0.125, 0.25, 0.5, 1];

const GRID_PREFS_KEY = 'bsg.editorGrid';

/** pt unchanged when the grid isn't snapping or bypass is set (Alt held);
 *  otherwise each coordinate rounds to the nearest multiple of spacing. */
export function snapToGrid(pt, grid, bypass = false) {
  if (!pt || !grid || !grid.snap || bypass) return pt;
  const spacing = grid.spacing || GRID_DEFAULTS.spacing;
  return {
    x: Math.round(pt.x / spacing) * spacing,
    y: Math.round(pt.y / spacing) * spacing,
  };
}

/** Pure merge over GRID_DEFAULTS — exported so the shape-safety net (a
 *  stale/partial stored object never yields a half-shaped grid) is
 *  testable without mocking localStorage. */
export function mergeGridPrefs(stored) {
  return { ...GRID_DEFAULTS, ...((stored && typeof stored === 'object') ? stored : {}) };
}

export function loadGridPrefs() {
  try {
    const raw = localStorage.getItem(GRID_PREFS_KEY);
    return mergeGridPrefs(raw ? JSON.parse(raw) : null);
  } catch (_) {
    return { ...GRID_DEFAULTS };
  }
}

export function saveGridPrefs(grid) {
  try { localStorage.setItem(GRID_PREFS_KEY, JSON.stringify(grid)); } catch (_) {}
}

/** Redraw editor._gridLayer from editor._grid. Called on board-size change
 *  (setModelMetrics) and every setGrid() toggle. Clears first regardless —
 *  when !visible that's the whole job. Major (whole-inch) lines draw
 *  brighter than minor ones; one loop per axis decides via modulo rather
 *  than a separate major-line pass, so there's exactly one place that
 *  knows what a grid line looks like. */
export function applyGrid(editor) {
  const layer = editor._gridLayer;
  if (!layer) return;
  layer.clear();

  const grid = editor._grid;
  if (!grid || !grid.visible) return;

  const spacing = grid.spacing || GRID_DEFAULTS.spacing;
  const w = editor._mW, h = editor._mH;
  const EPS = 1e-6;

  const drawLine = (x1, y1, x2, y2, isMajor) => {
    layer.line(x1, y1, x2, y2)
      .stroke({ color: '#000', width: 1 })
      .attr({
        'vector-effect': 'non-scaling-stroke',
        'pointer-events': 'none',
        opacity: isMajor ? 0.22 : 0.10,
      });
  };

  // i*spacing (not an accumulating x += spacing) so float error can't
  // drift the "is this a whole inch" check at small spacings over a wide
  // board.
  for (let i = 0; i * spacing <= w + EPS; i++) {
    const x = i * spacing;
    drawLine(x, 0, x, h, Math.abs(x - Math.round(x)) < EPS);
  }
  for (let i = 0; i * spacing <= h + EPS; i++) {
    const y = i * spacing;
    drawLine(0, y, w, y, Math.abs(y - Math.round(y)) < EPS);
  }
}
