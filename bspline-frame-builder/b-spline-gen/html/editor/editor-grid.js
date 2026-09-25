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
import { screenToModelDelta } from './editor-view.js';
import { inputProfileFor } from './editor-input.js';

/** Board is in inches — spacing/coords here are all in the same model
 *  units as editor._mW/_mH (see editor-view.js's own note on this). */
export const GRID_DEFAULTS = { visible: true, snap: true, spacing: 0.25 }; // grid shown + snap ON by default (Fred 2026-09-24/25)

/** The customisable spacing choices (inches). The toolbar select derives
 *  its options from this list — no hand-written <option>s to drift. */
export const GRID_SPACINGS = [0.0625, 0.125, 0.25, 0.5, 1];

const GRID_PREFS_KEY = 'bsg.editorGrid';

// SE8c / SA-DECL-3: render radius of the hover snap-cursor ring — visual
// size, not gated per pointer type this turn (see editor-input.js's
// clickThresholdPx doc comment for the same reasoning on a sibling
// literal).
const SNAP_CURSOR_RADIUS_PX = 4;

// T31 (SE6c): grid hover feedback — the row + column through the nearest
// grid node, and the node itself, light up under the pointer. One
// declared stroke pair (light core over a dark outline) so the row/column
// guide lines and the node ring can't drift into two different looks —
// "readable on any terrain" per the dispatch, since a single mid-tone
// stroke would vanish against a similarly-toned part of the relief
// preview underneath.
const GRID_HOVER_OUTLINE = { color: '#000', opacity: 0.6, width: 3.5 };
const GRID_HOVER_CORE = { color: '#fff', opacity: 1, width: 2 };
const GRID_HOVER_NODE_RADIUS_PX = 5;

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

/** T31 (SE6c): the nearest grid intersection to a model-space point, as
 *  integer lattice coords {i,j} — the SAME one-line rounding formula
 *  editor-lattice.js's toLattice uses, deliberately NOT imported from
 *  there: that module already imports GRID_DEFAULTS from THIS file, and
 *  importing back would make the two modules circular. */
export function nearestGridNode(pt, spacing) {
  return { i: Math.round(pt.x / spacing), j: Math.round(pt.y / spacing) };
}

/** T31: the full-board row/column line extents through grid node {i,j} —
 *  pure (board width/height passed as plain numbers, no editor object)
 *  so the geometry is testable without a DOM. */
export function gridHoverExtents(i, j, spacing, boardW, boardH) {
  const x = i * spacing, y = j * spacing;
  return {
    row: { x1: 0, y1: y, x2: boardW, y2: y },
    col: { x1: x, y1: 0, x2: x, y2: boardH },
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

/** Remove the hover snap-cursor marker (+ its touch leader line, if any).
 *  Called on mode change (setMode), reopen (editor-io.js's open()), and
 *  pointerleave — the ways it could otherwise ghost onto a state it no
 *  longer describes. */
export function clearSnapCursor(editor) {
  if (editor._snapCursor) { editor._snapCursor.remove(); editor._snapCursor = null; }
  if (editor._snapCursorLeader) { editor._snapCursorLeader.remove(); editor._snapCursorLeader = null; }
}

/** Model-space vertical shift for INPUT_PROFILE's markerOffsetPx, at the
 *  current view/container size. 0 for mouse/pen (markerOffsetPx: 0) or
 *  when the container isn't laid out yet. */
function _touchMarkerModelOffset(editor) {
  const offsetPx = inputProfileFor(editor._pointerType).markerOffsetPx;
  if (!offsetPx || !editor._draw) return 0;
  const vb = editor._draw.viewbox();
  const svgEl = document.getElementById('editorSVGContainer');
  const clientWidth = (svgEl && svgEl.clientWidth) || 1;
  const clientHeight = (svgEl && svgEl.clientHeight) || 1;
  return screenToModelDelta(vb, clientWidth, clientHeight, 0, offsetPx).dy;
}

/** Shift a raw pointer point UP by the touch marker offset (model space;
 *  screen "up" = model -Y, no Y-flip at this level, per editor-coords.js's
 *  own convention) — a no-op for mouse/pen (INPUT_PROFILE's
 *  markerOffsetPx: 0). Exported so editor-interaction.js's
 *  handleStart/handleMove apply the EXACT same shift to the actual
 *  gesture point that updateSnapCursor below draws the marker at — "the
 *  gesture commits at the MARKER position" (SE7m design §…) means both
 *  reads must agree on one function, not two independent offset guesses. */
export function applyTouchMarkerOffset(editor, pt) {
  const dy = _touchMarkerModelOffset(editor);
  return dy ? { x: pt.x, y: pt.y - dy } : pt;
}

/**
 * SE7a hover feedback: while the pointer moves, show a small ring at
 * where the NEXT click would land after snapping — so the user sees the
 * grid intent before committing to it. Called from editor-interaction.js's
 * handleMove on every move (drawing or not — in lattice mode the marker
 * doubles as the rail/tie start indicator once a gesture is under way).
 *
 * SE7m: for touch, the marker ALWAYS shows (not gated on "moved due to
 * snapping") and is drawn `markerOffsetPx` ABOVE the raw finger position
 * with a 1px leader line back down to it — a fingertip covers the real
 * target, so the marker's job for touch is "show where this commits,"
 * not just "show grid intent." Mouse/pen keep the exact pre-SE7m
 * behavior (only shown when snapping actually moves the point, no
 * offset, no leader) — markerOffsetPx is 0 for both in INPUT_PROFILE, so
 * `touchMarkerModelOffset` naturally returns 0 for them too; the
 * `isTouch` branch below only changes the ALWAYS-SHOW rule.
 *
 * Kept on editor._snapCursor inside _handleLayer (the same layer as the
 * transform handles — never part of the saved sketch) and moved via
 * .center()/.radius() rather than recreated each call.
 */
export function updateSnapCursor(editor, e) {
  const layer = editor._handleLayer;
  if (!layer) return;
  const bypass = !!(e && e.altKey);
  const policy = SNAP_POLICY[editor._currentMode] || 'point';
  const isTouch = editor._pointerType === 'touch';
  let show = false;
  let snapped = null;
  let rawPt = null;
  if (policy !== 'none' && !bypass) {
    rawPt = editor._getMousePoint(e);
    // SE7m: the offset is applied BEFORE snapping — the marker and the
    // actual gesture point (handleStart/handleMove, editor-interaction.js)
    // both snap the SAME already-shifted point via applyTouchMarkerOffset,
    // so the ring's position and the commit position can never disagree.
    const adjusted = applyTouchMarkerOffset(editor, rawPt);
    snapped = snapFor(adjusted, editor._grid, editor._currentMode, 'start', bypass);
    show = isTouch || snapped.x !== adjusted.x || snapped.y !== adjusted.y;
  }

  if (!show) {
    clearSnapCursor(editor);
    return;
  }
  const r = editor._getDynamicTolerance ? editor._getDynamicTolerance(SNAP_CURSOR_RADIUS_PX) : 0.05;

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

  if (!isTouch) {
    if (editor._snapCursorLeader) { editor._snapCursorLeader.remove(); editor._snapCursorLeader = null; }
    return;
  }
  // 1px leader from the raw finger position down to the marker — "the
  // thumb no longer hides the target" only reads clearly with a visible
  // link between where the finger actually is and where the mark is.
  if (!editor._snapCursorLeader || !editor._snapCursorLeader.node || !editor._snapCursorLeader.node.isConnected) {
    editor._snapCursorLeader = layer.line(0, 0, 0, 0)
      .attr({ 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
  }
  editor._snapCursorLeader
    .stroke({ color: '#ff6a00', width: 1, opacity: 0.6 })
    .plot(snapped.x, snapped.y, rawPt.x, rawPt.y);
}

/** T31 (SE6c): remove the grid hover highlight (row/column guides + node
 *  ring). Called on pointer leave, mode change, and reopen — the same
 *  moments clearSnapCursor already resets for, since a stale highlight
 *  reading the OLD mode's policy or a since-closed document is exactly
 *  the ghosting clearSnapCursor's own doc comment describes. */
export function clearGridHover(editor) {
  if (!editor._gridHover) return;
  for (const key of ['rowOutline', 'rowCore', 'colOutline', 'colCore', 'nodeOutline', 'nodeCore']) {
    const el = editor._gridHover[key];
    if (el) { el.remove(); editor._gridHover[key] = null; }
  }
}

function _connected(el) {
  return !!(el && el.node && el.node.isConnected);
}

/**
 * T31 (SE6c): while the pointer moves, highlight the row + column through
 * the nearest grid node, and the node itself — general grid awareness,
 * independent of whether THIS gesture would actually snap there (unlike
 * updateSnapCursor, which only lights up when a click right now would
 * land somewhere different). Shown only when the grid is visible and the
 * current mode's SNAP_POLICY isn't 'none' (erase/expand — free-hand tools
 * with no grid relationship at all); also hidden while Alt (bypass) is
 * held, matching updateSnapCursor's own "the user explicitly wants off-
 * grid right now" read of that modifier, even though this feature isn't
 * itself a snap preview.
 *
 * "If both are shown, the node ring IS the snap ring" (dispatch): the
 * orange snap cursor (updateSnapCursor, called immediately before this in
 * handleMove) and this function's own node ring always land on the SAME
 * {i,j} whenever the snap cursor shows at all — both derive from the
 * identical adjusted point via the identical round-to-spacing formula
 * (nearestGridNode / snapToGrid). So a connected, visible snap cursor
 * already marks the node; this function skips drawing a second ring on
 * top of it rather than reimplementing updateSnapCursor's own show/hide
 * decision a second time.
 *
 * All 6 elements (row/column each get a dark-outline + light-core pair,
 * so does the node ring) live in editor._handleLayer, created once and
 * repositioned — never recreated — on every move, same discipline as
 * updateSnapCursor's own circle. `.front()` on every element in a FIXED
 * order at the end makes the final stacking (node ring topmost, over both
 * guide lines) correct regardless of which elements _handleLayer's own
 * wholesale clear() happened to detach and force a fresh create for.
 */
export function updateGridHover(editor, e) {
  const layer = editor._handleLayer;
  if (!layer) return;
  const grid = editor._grid;
  const policy = SNAP_POLICY[editor._currentMode] || 'point';
  const bypass = !!(e && e.altKey);

  if (!grid || !grid.visible || policy === 'none' || bypass) {
    clearGridHover(editor);
    return;
  }

  const spacing = grid.spacing || GRID_DEFAULTS.spacing;
  const rawPt = editor._getMousePoint(e);
  const adjusted = applyTouchMarkerOffset(editor, rawPt);
  const node = nearestGridNode(adjusted, spacing);
  const { row, col } = gridHoverExtents(node.i, node.j, spacing, editor._mW, editor._mH);

  if (!editor._gridHover) editor._gridHover = {};
  const gh = editor._gridHover;

  if (!_connected(gh.rowOutline)) gh.rowOutline = layer.line(0, 0, 0, 0).attr({ 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
  if (!_connected(gh.rowCore))    gh.rowCore    = layer.line(0, 0, 0, 0).attr({ 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
  if (!_connected(gh.colOutline)) gh.colOutline = layer.line(0, 0, 0, 0).attr({ 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
  if (!_connected(gh.colCore))    gh.colCore    = layer.line(0, 0, 0, 0).attr({ 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });

  gh.rowOutline.stroke(GRID_HOVER_OUTLINE).plot(row.x1, row.y1, row.x2, row.y2);
  gh.rowCore.stroke(GRID_HOVER_CORE).plot(row.x1, row.y1, row.x2, row.y2);
  gh.colOutline.stroke(GRID_HOVER_OUTLINE).plot(col.x1, col.y1, col.x2, col.y2);
  gh.colCore.stroke(GRID_HOVER_CORE).plot(col.x1, col.y1, col.x2, col.y2);

  const snapCursorShowingHere = _connected(editor._snapCursor);
  if (snapCursorShowingHere) {
    if (gh.nodeOutline) { gh.nodeOutline.remove(); gh.nodeOutline = null; }
    if (gh.nodeCore) { gh.nodeCore.remove(); gh.nodeCore = null; }
  } else {
    const r = editor._getDynamicTolerance ? editor._getDynamicTolerance(GRID_HOVER_NODE_RADIUS_PX) : 0.06;
    if (!_connected(gh.nodeOutline)) gh.nodeOutline = layer.circle(0).fill('none').attr({ 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
    if (!_connected(gh.nodeCore))    gh.nodeCore    = layer.circle(0).fill('none').attr({ 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' });
    gh.nodeOutline.stroke(GRID_HOVER_OUTLINE).radius(r).center(node.i * spacing, node.j * spacing);
    gh.nodeCore.stroke(GRID_HOVER_CORE).radius(r).center(node.i * spacing, node.j * spacing);
  }

  // Fixed stacking order, applied every call regardless of creation
  // history: each pair's core above its own outline, the node ring above
  // both guide lines.
  gh.rowOutline.front(); gh.rowCore.front();
  gh.colOutline.front(); gh.colCore.front();
  if (gh.nodeOutline) gh.nodeOutline.front();
  if (gh.nodeCore) gh.nodeCore.front();
}
