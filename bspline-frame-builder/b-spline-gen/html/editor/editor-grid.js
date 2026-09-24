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

/**
 * SE7a: snap is a per-tool DECLARATION, not a blanket call. Before this,
 * `_snap` applied unconditionally in handleStart/handleMove for every
 * mode, which quantised the pen's freehand stroke and the eraser — wrong.
 * One row per mode:
 *   'point'   — snap always (select/node/line/rect/text): both the click
 *               and any drag continuation land on the grid.
 *   'anchors' — snap on the START of a gesture (pen anchor clicks) but
 *               never once a freehand drag is under way (draw).
 *   'center'  — snap on START only; a drag that follows (setting a
 *               circle's radius) must stay unsnapped or the smallest
 *               circle would be one grid cell (circle).
 *   'always'  — snap even when grid.snap is off, and ignore Alt — the
 *               lattice tool IS the grid, there's no "off-grid" mode
 *               for it (lattice).
 *   'none'    — identity always (erase, expand: freehand tools that
 *               should never quantise).
 */
export const SNAP_POLICY = {
  select: 'point', node: 'point', draw: 'anchors', line: 'point', rect: 'point',
  circle: 'center', text: 'point', erase: 'none', expand: 'none', lattice: 'always',
};

/** The one place `_snap` derives its behaviour from SNAP_POLICY + phase
 *  ('start' | 'move'). `bypass` is Alt-held; ignored entirely for
 *  'always' (lattice can't be drawn off-grid) and for 'none' (nothing to
 *  bypass). */
export function snapFor(pt, grid, mode, phase, bypass = false) {
  const policy = SNAP_POLICY[mode] || 'point';
  if (policy === 'none') return pt;
  if (policy === 'always') return snapToGrid(pt, { ...grid, snap: true }, false);
  if ((policy === 'anchors' || policy === 'center') && phase === 'move') return pt;
  return snapToGrid(pt, grid, bypass);
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

/** Remove the hover snap-cursor marker, if one exists. Called on mode
 *  change (setMode), reopen (editor-io.js's open()), and mouseleave —
 *  the three ways it could otherwise ghost onto a state it no longer
 *  describes. */
export function clearSnapCursor(editor) {
  if (editor._snapCursor) { editor._snapCursor.remove(); editor._snapCursor = null; }
}

/**
 * SE7a hover feedback: while the pointer moves, show a small ring at
 * where the NEXT click would land after snapping — so the user sees the
 * grid intent before committing to it. Called from editor-interaction.js's
 * handleMove on every move (drawing or not — in lattice mode the marker
 * doubles as the rail/tie start indicator once a gesture is under way).
 *
 * Kept on editor._snapCursor inside _handleLayer (the same layer as the
 * transform handles — never part of the saved sketch) and moved via
 * .center()/.radius() rather than recreated each call. Hidden whenever
 * the point wouldn't actually move: policy 'none', Alt held, or the
 * point already sits on the snap target.
 */
export function updateSnapCursor(editor, e) {
  const layer = editor._handleLayer;
  if (!layer) return;
  const bypass = !!(e && e.altKey);
  const policy = SNAP_POLICY[editor._currentMode] || 'point';
  let moved = false;
  let snapped = null;
  if (policy !== 'none' && !bypass) {
    const pt = editor._getMousePoint(e);
    snapped = snapFor(pt, editor._grid, editor._currentMode, 'start', bypass);
    moved = snapped.x !== pt.x || snapped.y !== pt.y;
  }

  if (!moved) {
    clearSnapCursor(editor);
    return;
  }
  const r = editor._getDynamicTolerance ? editor._getDynamicTolerance(4) : 0.05;
  // _handleLayer is shared with the transform handles: updateHandles()
  // clears the WHOLE layer unconditionally on nearly every mode switch,
  // selection change, and drag — which silently detaches our circle from
  // the DOM without telling us. Reusing a detached svg.js wrapper is
  // undefined behaviour, so check connectivity rather than trusting the
  // reference alone.
  if (!editor._snapCursor || !editor._snapCursor.node || !editor._snapCursor.node.isConnected) {
    editor._snapCursor = layer.circle(0)
      .fill('none')
      .attr({ 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
  }
  editor._snapCursor
    .stroke({ color: '#ff6a00', width: 1 })
    .radius(r)
    .center(snapped.x, snapped.y);
}
