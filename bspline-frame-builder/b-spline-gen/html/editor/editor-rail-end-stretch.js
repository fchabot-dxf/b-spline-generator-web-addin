/**
 * editor-rail-end-stretch.js — T81 item 7 (Fred: "I'd like to be able to
 * adjust length of rails in lattice tool, by grabbing the ends").
 *
 * The STRETCH itself is not new and is not re-implemented here: SE7k AMEND
 * 4/5's end-stretch (editor-interaction.js `_beginLatticeMove` ->
 * `mode:'stretch'` -> `_updateLatticeStretch`/`stretchRailEnd`) already
 * fires for a grab inside a rail end's own end-grab zone, from BOTH lattice
 * handlers (latticeHandler.start's existing-piece branch runs BEFORE its
 * drawKind branch, so [Select] reaches it exactly like [Rail]/[Tie]/[Node];
 * shapeLatticeHandler.start replicates that branch, UI5 AMEND 2). What it
 * lacked, and what this module adds as a few hooks on that ONE path (kept
 * out of editor-interaction.js itself for the same reason
 * editor-multiselect-gesture.js is: that file is shared and concurrently
 * extended -- the hooks there stay one-liners):
 *
 *   1. DISCOVERABILITY: hovering a rail END shows an end handle, drawn with
 *      T81 item 1's ONE declared handle look (`handleHoverVisual`,
 *      editor-transform-handles.js) and the shared grab/grabbing cursor
 *      (`setHandleCursor`), held in its "active" look for the whole drag
 *      (Touch has no hover, same rule as item 1).
 *   2. THE LATTICE BOUNDARY: the stretched end can't pass it. The limit is
 *      resolved ONCE at grab (attachments/limits are frozen at drag start,
 *      SE7i's own rule) along the rail's own row, from the SAME source each
 *      tool already bounds its rails with:
 *        - board / rect extent (rect Lattice): `_resolveExtent`, the extent
 *          Generate and the Rail click-spawn (`_spawnRailFullRow`) use;
 *        - boundary extent (Shape Lattice, or a rect Lattice with a picked
 *          boundary): `clipHandRailToBoundary` (T80 item 2) -- the SAME row
 *          clip, span union and end rule a hand-DRAWN rail on this row gets,
 *          so a stretched end stops exactly where a drawn rail would. That
 *          resolve is async (a picked text boundary awaits a font), so the
 *          span lands on the move a microtask later; until then the existing
 *          synchronous T73 `_clampStretchToContour` still applies, and
 *          finish() awaits it before committing (`whenRailLimitReady`).
 *   3. SNAPS: GRID is the lattice itself (toLattice, unchanged); GEOM keeps
 *      `_geometryAxisSnap` (other pieces' ends/crossings) and ADDS the
 *      boundary crossing on the rail's own row -- the contour's curve is not
 *      in `geometrySnapTargets` (only its segment ends/midpoints are), so
 *      "snap to the contour" needs this row-specific target.
 *   3b. SHORTEST LENGTH (Fred's ruling: "The only distance it should use
 *      is the stroke width."): the rail can shrink to its own stroke width,
 *      not one lattice cell (`stretchRailEnd`'s `minLen`).
 *   4. WHAT RIDES ON THE RAIL: ties/nodes still on the rail's new span keep
 *      their joints untouched (SE7k AMEND 4: "attached ties stay where they
 *      are" on a stretch). A tie whose END sat on this rail and is now past
 *      the new end is REMOVED on release, with its end node(s)
 *      (`tieEndNodes`, T80 item 3's declared "a tie's owned children") unless
 *      a node is still a joint of something that stays (`_stillJoined`: on a
 *      remaining tie, or at a remaining rail's end); a node that sat on the
 *      rail and is now past its end goes by the same test. The status hint
 *      says how many. Same undo step as the stretch itself (removal runs
 *      before `_finishLatticeMove`'s one pushState).
 *
 * Regenerate: a stretched GENERATED rail keeps its OWNERSHIP_ATTR (the
 * stretch never touches it, `_finishLatticeMove`'s own doc comment), so it
 * follows SE7i's rule for every hand edit of a generated piece: Regenerate
 * clears every owned piece "including pieces moved by hand since" and
 * re-emits it from the pattern; Detach (the panel action) is how a hand
 * override survives Regenerate. Nothing new is declared for it here.
 */
import { handleHoverVisual, setHandleCursor } from './editor-transform-handles.js';
import { viewScale } from './editor-view.js';
import { inputProfileFor } from './editor-input.js';
import { worldPoint } from './editor-coords.js';
import { LATTICE_ATTR, orient, toLatticeFractional } from './editor-lattice.js';
import { PATTERN_DEFAULTS, getLayerPattern, _resolveExtent, clipHandRailToBoundary } from './editor-lattice-pattern.js';
import { tieEndNodes } from './editor-lattice-chains.js';
import { setEditorStatusHint } from './editor-ui.js';

const EPS = 1e-6;


function _lineEnds(el) {
  const n = (k) => parseFloat(el.node.getAttribute(k));
  const a = worldPoint(el, { x: n('x1'), y: n('y1') });
  const b = worldPoint(el, { x: n('x2'), y: n('y2') });
  return { a, b };
}

function _canon(p, spacing, orientation) {
  return orient(toLatticeFractional(p, spacing), orientation);
}

/** The drag axis of a rail end handle, for its cursor (Fred: "Use updown for
 *  one and left right the other ... Changing cursor on hover", agreed for the
 *  rail end too): 'x' for a rail running left-right (ew-resize), 'y' for one
 *  running up-down (ns-resize). `hit` = `{el, end}` or null. */
export function railEndAxis(hit) {
  if (!hit || !hit.el || !hit.el.node) return null;
  const { a, b } = _lineEnds(hit.el);
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'x' : 'y';
}

/** Hover state writer: `hit` = `{el, end}` (a rail and which of its ends)
 *  or null. Re-renders the handle layer only when it actually changed. */
export function setRailEndHover(editor, hit) {
  const prev = editor._railEndHover;
  const same = (!prev && !hit) || (prev && hit && prev.el === hit.el && prev.end === hit.end);
  if (same) return;
  editor._railEndHover = hit || null;
  if (typeof editor._updateHandles === 'function') editor._updateHandles();
}

/** Draws the rail end handle (hovered, or held for the drag in progress)
 *  into `editor._handleLayer` -- called from updateHandles for both lattice
 *  modes, so `_handleLayer.clear()` there wipes it every render like every
 *  other handle. Positioned from the rail's LIVE attrs, so it tracks the end
 *  as it's stretched. Sized like the Shape Lattice param handles
 *  (renderShapeLatticeHandles: INPUT_PROFILE handlePx in screen px). */
export function renderRailEndHandle(editor) {
  // A drag abandoned by another gesture (H5 multi-select hold / H6 context-
  // menu hold both drop `_latticeMove` without a finish) must not leave the
  // held look stuck: no live move -> no drag state.
  if (editor._railEndDrag && !editor._latticeMove) {
    editor._railEndDrag = null;
    setHandleCursor(editor._railEndHover ? 'hover' : null, railEndAxis(editor._railEndHover));
  }
  const target = editor._railEndDrag || editor._railEndHover;
  if (!target || !editor._handleLayer || !target.el || !target.el.node) return;
  const { a, b } = _lineEnds(target.el);
  const p = target.end === 'a' ? a : b;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  const view = (editor._draw && editor._draw.viewbox) ? editor._draw.viewbox() : null;
  const svgEl = typeof document !== 'undefined' ? document.getElementById('editorSVGContainer') : null;
  const clientWidth = (svgEl && svgEl.clientWidth) || 800;
  const clientHeight = (svgEl && svgEl.clientHeight) || 800;
  const pxPerModelUnit = view && view.width ? viewScale(view, clientWidth, clientHeight) : 100;
  const handlePx = inputProfileFor(editor._pointerType).handlePx;
  const sz = Math.max(handlePx / pxPerModelUnit, 0.05); // same floor as renderShapeLatticeHandles
  const strokeW = sz * (0.0025 / 0.012); // renderTransformHandles' own ratio, as renderShapeLatticeHandles
  // Always "active": the handle only exists while the end is hovered or
  // held -- the idle state is "no handle" (a rail end with nothing drawn).
  const railColor = target.el.node.getAttribute('stroke') || PATTERN_DEFAULTS.colors.rails;
  const vis = handleHoverVisual(sz, '#ffffff', railColor, true);
  editor._handleLayer.circle(vis.radius * 2)
    .center(p.x, p.y)
    .fill(vis.fill)
    .stroke({ color: vis.stroke, width: strokeW })
    .attr('pointer-events', 'none')
    .attr('data-rail-end-handle', target.end);
}

/**
 * Called right after `_beginLatticeMove` (both lattice handlers). A no-op
 * unless the grab is a rail END stretch of a plain rail or a chain's TRUE
 * outer end (a chain JOINT slide, `mode:'joint'`, is SE16's own gesture).
 * Freezes the rail's riders (ties with an END on it, nodes on it) and
 * starts resolving the boundary limit for the rail's row.
 */
export function armRailEndStretch(editor, move) {
  if (!move || move.kind !== 'rail' || move.mode !== 'stretch') return;
  const { spacing, orientation } = move;
  const row = move.pieceCanon.a.j;
  const lo = Math.min(move.pieceCanon.a.i, move.pieceCanon.b.i);
  const hi = Math.max(move.pieceCanon.a.i, move.pieceCanon.b.i);
  const ties = [];
  const nodes = [];
  for (const ch of editor._sketchLayer.children().toArray()) {
    if (!ch || !ch.node || ch === move.el) continue;
    const kind = ch.node.getAttribute(LATTICE_ATTR);
    if (kind === 'tie') {
      const { a, b } = _lineEnds(ch);
      const ca = _canon(a, spacing, orientation), cb = _canon(b, spacing, orientation);
      const onRow = Math.abs(ca.j - row) < EPS || Math.abs(cb.j - row) < EPS;
      if (onRow && ca.i >= lo - EPS && ca.i <= hi + EPS) ties.push({ el: ch, i: ca.i });
    } else if (kind === 'node' && ch !== move.endNode) {
      const c = worldPoint(ch, { x: parseFloat(ch.node.getAttribute('cx')), y: parseFloat(ch.node.getAttribute('cy')) });
      const cc = _canon(c, spacing, orientation);
      if (Math.abs(cc.j - row) < EPS && cc.i >= lo - EPS && cc.i <= hi + EPS) nodes.push({ el: ch, i: cc.i });
    }
  }
  const fixedI = move.end === 'a' ? move.pieceCanon.b.i : move.pieceCanon.a.i;
  const pattern = getLayerPattern(editor) ?? PATTERN_DEFAULTS;
  // Fred's ruling on minimum lengths: "The only distance it should use is
  // the stroke width." -- the rail's OWN drawn stroke width (the pattern's
  // rail width as a fallback), in canonical cells.
  const sw = parseFloat(move.el.node.getAttribute('stroke-width'))
    || (pattern.widths && pattern.widths.rails) || PATTERN_DEFAULTS.widths.rails;
  const minLen = sw > 0 ? sw / spacing : 1;
  move.railEnd = { ties, nodes, span: null, ready: null, lastRaw: null, minLen };

  if (pattern.extent && pattern.extent.mode === 'boundary') {
    // Keep the piece that contains the FIXED end (a pinched silhouette's
    // row can have several inside pieces -- stay in the rail's own lobe),
    // same choice `_clampStretchToContour` makes.
    move.railEnd.ready = Promise.resolve()
      .then(() => clipHandRailToBoundary(editor, pattern, row, -Infinity, Infinity, spacing))
      .then((pieces) => {
        const list = (pieces || []).map((p) => [Math.min(p.a, p.b), Math.max(p.a, p.b)]);
        const own = list.find(([l, h]) => fixedI >= l - EPS && fixedI <= h + EPS);
        move.railEnd.span = own || null;
      })
      .catch(() => { move.railEnd.span = null; }) // never let a boundary lookup break a drag
      .then(() => { move.railEnd.settled = true; });
  } else {
    try {
      const ext = _resolveExtent(editor, pattern);
      const e0 = orient({ i: ext.iMin, j: ext.jMin }, orientation);
      const e1 = orient({ i: ext.iMax, j: ext.jMax }, orientation);
      const l = Math.min(e0.i, e1.i), h = Math.max(e0.i, e1.i);
      // Never shrink an extent the rail ALREADY sits outside (a rail drawn
      // before the Size changed): the limit only stops it growing further.
      if (Number.isFinite(l) && Number.isFinite(h) && h > l) move.railEnd.span = [Math.min(l, lo), Math.max(h, hi)];
    } catch (_) { /* no resolvable board -> no extra limit */ }
  }
  editor._railEndDrag = { el: move.el, end: move.end };
  setHandleCursor('active', railEndAxis(editor._railEndDrag));
  if (typeof editor._updateHandles === 'function') editor._updateHandles();
}

/** The stretched end's canonical i after the boundary limit + boundary
 *  snap: `raw` is the (grid or GEOM-snapped) pointer target, `tolCells` the
 *  GEOM snap tolerance in lattice cells, `geomOn` the GEOM toggle. Records
 *  `raw` so finish() can re-apply once an async limit lands. */
export function railEndTarget(move, raw, tolCells, geomOn) {
  const r = move.railEnd;
  if (!r) return raw;
  r.lastRaw = raw;
  r.tolCells = tolCells;
  r.geomOn = geomOn;
  if (!r.span) return raw;
  const [l, h] = r.span;
  let t = Math.max(l, Math.min(h, raw));
  if (geomOn) {
    if (Math.abs(t - l) <= tolCells) t = l;
    else if (Math.abs(t - h) <= tolCells) t = h;
  }
  return t;
}

/** A promise when the boundary limit is still resolving at release (finish
 *  must wait for it before committing), else null. */
export function whenRailLimitReady(move) {
  return move && move.railEnd && move.railEnd.ready && !move.railEnd.settled ? move.railEnd.ready : null;
}

/** Is the node at world point `p` still a JOINT of something that stays?
 *  Yes when it sits on any remaining TIE (its end, or its body -- an "at
 *  crossings" node) or at a remaining RAIL's END. Merely lying on some
 *  other rail's BODY doesn't count: that is exactly where a removed tie's
 *  far-end node sits (the tie's joint with its other rail -- T80 item 3's
 *  "a tie's owned children"), and with the tie gone it joins nothing. */
function _stillJoined(editor, p, removed) {
  for (const ch of editor._sketchLayer.children().toArray()) {
    if (!ch || !ch.node || removed.has(ch)) continue;
    const kind = ch.node.getAttribute(LATTICE_ATTR);
    if (kind !== 'rail' && kind !== 'tie') continue;
    const { a, b } = _lineEnds(ch);
    if (kind === 'rail') {
      if (Math.hypot(p.x - a.x, p.y - a.y) < EPS || Math.hypot(p.x - b.x, p.y - b.y) < EPS) return true;
      continue;
    }
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    if (Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) < EPS) return true; // world inches, same 1e-6 as _sameWorldPoint
  }
  return false;
}

/**
 * On release of a rail end stretch that actually moved: removes every
 * frozen rider left past the rail's NEW end (see this file's header, 4).
 * Pure DOM -- the caller's one pushState covers it. Returns
 * `{ties, nodes}` removed counts and says so in the status hint.
 */
export function pruneAfterRailStretch(editor, move) {
  const r = move && move.railEnd;
  if (!r) return { ties: 0, nodes: 0 };
  const { spacing, orientation } = move;
  const { a, b } = _lineEnds(move.el);
  const ca = _canon(a, spacing, orientation), cb = _canon(b, spacing, orientation);
  const lo = Math.min(ca.i, cb.i) - EPS, hi = Math.max(ca.i, cb.i) + EPS;
  const off = (i) => i < lo || i > hi;
  const removed = new Set();
  const nodeCandidates = new Map();
  for (const t of r.ties) {
    if (!off(t.i)) continue;
    for (const n of tieEndNodes(editor, t.el)) nodeCandidates.set(n.el, n.world);
    removed.add(t.el);
  }
  for (const n of r.nodes) {
    if (!off(n.i)) continue;
    const c = worldPoint(n.el, { x: parseFloat(n.el.node.getAttribute('cx')), y: parseFloat(n.el.node.getAttribute('cy')) });
    nodeCandidates.set(n.el, c);
  }
  let tieCount = 0;
  for (const el of removed) { el.remove(); tieCount++; }
  let nodeCount = 0;
  for (const [el, world] of nodeCandidates) {
    if (el === move.endNode) continue;
    if (_stillJoined(editor, world, removed)) continue;
    el.remove();
    nodeCount++;
  }
  if (tieCount || nodeCount) {
    const parts = [];
    if (tieCount) parts.push(`${tieCount} tie${tieCount === 1 ? '' : 's'}`);
    if (nodeCount) parts.push(`${nodeCount} node${nodeCount === 1 ? '' : 's'}`);
    setEditorStatusHint(`Rail shortened: removed ${parts.join(' and ')} left past its new end (Undo brings them back).`);
  }
  return { ties: tieCount, nodes: nodeCount };
}

/** Clears the end-handle drag state (every release, moved or not): back to
 *  the hover look if the pointer is still on the end, else idle. */
export function endRailEndStretch(editor) {
  if (!editor._railEndDrag) return;
  editor._railEndDrag = null;
  setHandleCursor(editor._railEndHover ? 'hover' : null, railEndAxis(editor._railEndHover));
  if (typeof editor._updateHandles === 'function') editor._updateHandles();
}
