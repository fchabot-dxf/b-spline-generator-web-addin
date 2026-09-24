/**
 * editor-lattice.js — SE7a: the Lattice tool. Drag along a row for a rail,
 * along a column for a tie; nodes are auto-placed at ends and crossings
 * (or dropped manually with the Circle tool — see SNAP_POLICY's `circle:
 * 'center'` row and editor-interaction.js's circleHandler). A bare click
 * in lattice mode does nothing (Fred: "isn't Circle enough?").
 *
 * Pure lattice math (toLattice/fromLattice/classifyDrag/constrain/
 * latticeCrossings) has no svg.js/DOM dependency and is unit-tested
 * directly, matching editor-view.js's/editor-grid.js's own split. The emit
 * helpers below that line DO touch the DOM/svg.js — same leaf-module shape
 * as editor-grid.js's applyGrid.
 */
import { ensureActiveLayer } from './layers.js';
import { GRID_DEFAULTS } from './editor-grid.js';
import { worldPoint } from './editor-coords.js';

export const LATTICE_DEFAULTS = { autoNodes: true };

/**
 * SE7c: declared line-width/radius PROPORTIONS for lattice geometry, as a
 * fraction of the grid spacing — replaces `emitSegment` reading
 * `editor._strokeWidth` (the general drawing-tool stroke setting, wrong
 * here: a live browser test found a 0.5" board-wide stroke on a 0.5" rail
 * pitch, so neighbouring rails touch and the whole pattern reads as one
 * mass) and the old `LATTICE_DEFAULTS.nodeRadiusFactor` (now superseded —
 * one source for all three proportions instead of two). Applies equally
 * to the hand-drawn Lattice tool and the generator (both call the SAME
 * emitSegment/emitNode below), so they can't drift apart. Nodes are
 * visibly LARGER than the lines they sit on, matching the reference
 * photo the pattern is meant to resemble — not "10x thinner," the live
 * test's other finding.
 */
export const LATTICE_STYLE = {
  rail: { widthFactor: 0.28 },
  tie:  { widthFactor: 0.22 },
  node: { radiusFactor: 0.30 },
};

/** data-lattice attribute values: 'rail' | 'tie' | 'node'. */
export const LATTICE_ATTR = 'data-lattice';

/** Node radius (inches) when no grid is active to derive one from — the
 *  Circle tool's click-to-dot still needs a sane size off-grid. */
export const DEFAULT_NODE_RADIUS_IN = 0.09;

/** Model-space point -> integer lattice coordinates (nearest cell). */
export function toLattice(pt, spacing) {
  return { i: Math.round(pt.x / spacing), j: Math.round(pt.y / spacing) };
}

/** Integer lattice coordinates -> model-space point. */
export function fromLattice(ij, spacing) {
  return { x: ij.i * spacing, y: ij.j * spacing };
}

/** Both args are lattice coords. 'node' when they're the same cell (no
 *  movement — a bare click); otherwise 'rail' when the horizontal step
 *  dominates, 'tie' when the vertical step does. */
export function classifyDrag(a, b) {
  if (a.i === b.i && a.j === b.j) return 'node';
  return Math.abs(b.i - a.i) >= Math.abs(b.j - a.j) ? 'rail' : 'tie';
}

/** Both args are lattice coords. Projects b onto whichever axis dominates
 *  the drag from a, so a rail comes out exactly horizontal and a tie
 *  exactly vertical. Returns lattice coords. */
export function constrain(a, b) {
  return Math.abs(b.i - a.i) >= Math.abs(b.j - a.j)
    ? { i: b.i, j: a.j }
    : { i: a.i, j: b.j };
}

/** T30: the nearest rail ROW to `j`, within `within` lattice rows — or
 *  `null` if none is close enough (or `within<=0` / no rails exist at
 *  all). Ties broken toward the SMALLER row (arbitrary but deterministic
 *  — `<` not `<=` in the distance comparison, so the first-seen closer
 *  row wins and an exact tie keeps whichever `railRows` lists first).
 *  Declared once here, shared by the generator's 'free'-anchor tie
 *  snapping (editor-lattice-pattern.js) and the hand-drawn tool's live
 *  tie-drag preview (editor-interaction.js), so "how close is close
 *  enough" can't drift between the two surfaces. */
export function nearestRailRow(j, railRows, within) {
  if (!within || within <= 0 || !railRows || !railRows.length) return null;
  let best = null, bestDist = Infinity;
  for (const r of railRows) {
    const d = Math.abs(r - j);
    if (d <= within && d < bestDist) { best = r; bestDist = d; }
  }
  return best;
}

function _segmentCrossing(rail, tie) {
  const railJ = rail.a.j; // constant on a rail
  const tieI = tie.a.i;   // constant on a tie
  const railIMin = Math.min(rail.a.i, rail.b.i), railIMax = Math.max(rail.a.i, rail.b.i);
  const tieJMin = Math.min(tie.a.j, tie.b.j), tieJMax = Math.max(tie.a.j, tie.b.j);
  if (tieI < railIMin || tieI > railIMax) return null;
  if (railJ < tieJMin || railJ > tieJMax) return null;
  return { i: tieI, j: railJ };
}

/**
 * Lattice points where `seg` (an axis-aligned {kind, a, b} in lattice
 * coords) crosses others of the OTHER kind in `segs` (rail x tie only —
 * two rails or two ties never cross at a single lattice point in this
 * model), plus seg's own two endpoints. Deduplicated by {i,j}.
 */
export function latticeCrossings(seg, segs) {
  const otherKind = seg.kind === 'rail' ? 'tie' : 'rail';
  const points = [seg.a, seg.b];
  for (const other of segs) {
    if (other.kind !== otherKind) continue;
    const crossing = seg.kind === 'rail' ? _segmentCrossing(seg, other) : _segmentCrossing(other, seg);
    if (crossing) points.push(crossing);
  }
  const seen = new Set();
  const result = [];
  for (const p of points) {
    const key = `${p.i},${p.j}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(p);
  }
  return result;
}

/** Does a node already sit at model-space point p (compared by lattice
 *  cell, not exact pixel match)? Used to dedupe auto-nodes against each
 *  other and against manually-placed dots (Circle tool). Returns the
 *  matching svg.js element, or null.
 *
 *  SE7n: compares the node's WORLD centre (worldPoint bakes the element's
 *  own transform in), not the raw cx/cy attribute — a node dragged with
 *  Select writes a `transform="translate(...)"` rather than touching
 *  cx/cy, so the raw attribute alone silently stopped matching its real
 *  position and a moved node was never deduped against. */
export function findNodeAt(editor, p) {
  if (!editor._sketchLayer) return null;
  const spacing = editor._grid?.spacing || GRID_DEFAULTS.spacing;
  const target = toLattice(p, spacing);
  const children = editor._sketchLayer.children().toArray();
  for (const ch of children) {
    if (!ch || !ch.node || ch.node.getAttribute(LATTICE_ATTR) !== 'node') continue;
    const cx = parseFloat(ch.node.getAttribute('cx'));
    const cy = parseFloat(ch.node.getAttribute('cy'));
    if (Number.isNaN(cx) || Number.isNaN(cy)) continue;
    const world = worldPoint(ch, { x: cx, y: cy });
    const lat = toLattice(world, spacing);
    if (lat.i === target.i && lat.j === target.j) return ch;
  }
  return null;
}

/** Emit a rail/tie segment between two MODEL-space points. Width comes
 *  from LATTICE_STYLE[kind] × grid spacing (SE7c) — NOT editor._strokeWidth
 *  (the general drawing-tool stroke setting; a live browser test found a
 *  0.5" board-wide stroke on a 0.5" rail pitch, so neighbouring rails
 *  merged into one mass). Color/data-layer via the same ensureActiveLayer
 *  path makeDrawingHandler uses in editor-interaction.js. */
export function emitSegment(editor, kind, a, b) {
  const layer = ensureActiveLayer(editor);
  const spacing = editor._grid?.spacing || GRID_DEFAULTS.spacing;
  const width = LATTICE_STYLE[kind].widthFactor * spacing;
  return editor._sketchLayer
    .line(a.x, a.y, b.x, b.y)
    .stroke({ color: editor._color, width, linecap: 'round' })
    .attr('data-layer', layer)
    .attr(LATTICE_ATTR, kind);
}

/** Emit a filled dot at a MODEL-space point — the lattice tool's
 *  auto-nodes AND the Circle tool's click-to-dot both call this, so a
 *  manual dot and an auto-node are identical elements. No-ops (returns
 *  null) if a node already sits at that lattice cell. Radius comes from
 *  LATTICE_STYLE.node.radiusFactor × grid spacing (SE7c) when the grid is
 *  on — off-grid (Circle tool with no grid active) falls back to the
 *  fixed DEFAULT_NODE_RADIUS_IN, unchanged from before. */
export function emitNode(editor, p) {
  if (findNodeAt(editor, p)) return null;
  const grid = editor._grid;
  const gridOn = !!(grid && grid.visible);
  const r = gridOn ? LATTICE_STYLE.node.radiusFactor * (grid.spacing || GRID_DEFAULTS.spacing) : DEFAULT_NODE_RADIUS_IN;
  const layer = ensureActiveLayer(editor);
  const fillColor = editor._color || '#000000';
  return editor._sketchLayer
    .circle(r * 2)
    .center(p.x, p.y)
    .fill(fillColor)
    .stroke({ color: 'none', width: 0 })
    .attr('data-layer', layer)
    .attr(LATTICE_ATTR, 'node');
}
