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

/** SE7h (Fred: "invert rails and ties so rails are vertical"): the two
 *  declared lattice orientations. 'horizontal' (default) is the frame
 *  every algorithm below is written in — rails constant-j (spanning i),
 *  ties constant-i (spanning j). 'vertical' is that SAME frame with i/j
 *  swapped at the edges (orient(), below) — no second copy of the rails/
 *  ties math exists anywhere for it. */
export const ORIENTATIONS = ['horizontal', 'vertical'];

/**
 * The one orientation mapping every lattice consumer conjugates through:
 * transpose a point INTO the canonical (horizontal) frame before running
 * classifyDrag/constrain/latticeCrossings/the generator's row-column math
 * unchanged, then transpose the RESULT back out. Self-inverse (swapping
 * i/j twice is the identity), so the same call does both directions —
 * callers don't need a separate "un-orient". 'horizontal' is the
 * identity: every existing caller that never passes an orientation
 * keeps its current behavior exactly.
 */
export function orient(p, orientation) {
  return orientation === 'vertical' ? { i: p.j, j: p.i } : { i: p.i, j: p.j };
}

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

/**
 * SE7i (connected editing): is a MODEL-space point sitting EXACTLY on a
 * lattice grid point — both coordinates within `tol` lattice units of an
 * integer — not just "close enough to snap"? Distinguishes a genuine
 * on-grid attachment from an off-grid nudge (Alt-drag, a Select-tool
 * micro-move): Fred, "attach should mean snapped to grid on the same
 * point." The default tolerance (1e-6) absorbs floating-point noise from
 * a repeated transform bake, nothing more generous — an end even a
 * hundredth of an inch off-grid must NOT read as attached.
 */
export function isLatticePoint(p, spacing, tol = 1e-6) {
  const i = p.x / spacing, j = p.y / spacing;
  return Math.abs(i - Math.round(i)) < tol && Math.abs(j - Math.round(j)) < tol;
}

/**
 * SE7i: the rail (canonical {a,b}) among `railsCanon` whose row `p` sits
 * exactly on, within that rail's own i-range — the same on-grid-row-and-
 * range test `moveRailAlongAxis` (below) uses for a whole rail's worth of
 * candidates, exposed standalone for a single point (a tie-end or node's
 * own "am I attached to a rail at all" check). A grid point on a rail's
 * row but beyond its two ends does NOT attach (Fred's own example).
 * Returns the first match (rails don't overlap at a shared row in this
 * model, so ties are not expected).
 */
export function findAttachingRail(p, railsCanon) {
  for (const rail of railsCanon) {
    const iMin = Math.min(rail.a.i, rail.b.i);
    const iMax = Math.max(rail.a.i, rail.b.i);
    if (p.j === rail.a.j && p.i >= iMin && p.i <= iMax) return rail;
  }
  return null;
}

/**
 * SE7i: move a rail (canonical {a,b}) to `newRow` (its own axis is the
 * canonical row/j — "a rail never slides along its own length," so its
 * i-range is carried over unchanged) and compute the resulting new
 * positions for every attached tie-end and node, derived fresh against
 * the rail's ORIGINAL (start-of-drag) row/range — callers must pass the
 * SAME `railCanon`/`tiesCanon`/`nodesCanon` snapshot on every call during
 * one drag (never re-collected mid-gesture), which is what "attachments
 * are fixed at drag start; a dragged rail never picks up ties it crosses
 * mid-drag" means in practice: the derivation and the move share one
 * function, but the CALLER'S discipline (reuse one snapshot, vary only
 * `newRow`) is what keeps attachment itself fixed while the geometry
 * livens.
 *
 * @param {{a:{i,j},b:{i,j}}} railCanon  the rail's OWN start-of-drag
 *   canonical geometry (not updated between calls).
 * @param {number} newRow  the rail's new canonical j.
 * @param {{a:{i,j},b:{i,j}}[]} tiesCanon  every candidate tie, ALREADY
 *   confirmed on-grid (isLatticePoint) by the caller — extra fields
 *   (e.g. an `el` reference) pass through untouched via `tieUpdates[].tie`.
 * @param {({i,j}|{point:{i,j}})[]} nodesCanon  every candidate node,
 *   likewise pre-confirmed on-grid; either a bare point or a wrapper
 *   carrying one under `.point` (whichever the caller finds convenient —
 *   both shapes are accepted so a DOM-touching caller can pass its own
 *   `{el, point}` records directly).
 * @returns {{rail:{a,b}, tieUpdates:{tie,end:'a'|'b',point:{i,j}}[],
 *            nodeUpdates:{node,point:{i,j}}[]}}
 */
export function moveRailAlongAxis(railCanon, newRow, tiesCanon, nodesCanon) {
  const railJ = railCanon.a.j;
  const iMin = Math.min(railCanon.a.i, railCanon.b.i);
  const iMax = Math.max(railCanon.a.i, railCanon.b.i);

  const tieUpdates = [];
  for (const tie of (tiesCanon || [])) {
    for (const end of ['a', 'b']) {
      const pt = tie[end];
      if (pt.j === railJ && pt.i >= iMin && pt.i <= iMax) {
        tieUpdates.push({ tie, end, point: { i: pt.i, j: newRow } });
      }
    }
  }

  const nodeUpdates = [];
  for (const node of (nodesCanon || [])) {
    const pt = node.point ?? node;
    if (pt.j === railJ && pt.i >= iMin && pt.i <= iMax) {
      nodeUpdates.push({ node, point: { i: pt.i, j: newRow } });
    }
  }

  return {
    rail: { a: { i: railCanon.a.i, j: newRow }, b: { i: railCanon.b.i, j: newRow } },
    tieUpdates,
    nodeUpdates,
  };
}

/** SE7i: rigid translation of a tie's both ends (canonical frame) by a
 *  {di, dj} delta — a tie "drags freely... NOT confined between rails"
 *  (Fred), so there is no row/attachment constraint here, just apply the
 *  same delta to both ends (and, by the caller applying the identical
 *  delta, to whichever nodes ride at its endpoints). */
export function translateTie(tieCanon, di, dj) {
  return {
    a: { i: tieCanon.a.i + di, j: tieCanon.a.j + dj },
    b: { i: tieCanon.b.i + di, j: tieCanon.b.j + dj },
  };
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
 *  path makeDrawingHandler uses in editor-interaction.js.
 *
 *  @param {number} [widthOverride] SE7i: the generator's own PATTERN.
 *   widths[kind] (inches), when given — the hand-drawn Lattice tool never
 *   passes this, so its own segments keep today's LATTICE_STYLE-derived
 *   sizing exactly (Widths, like Colors before it, is a generator-only
 *   setting; the hand tool has no per-piece width control). */
export function emitSegment(editor, kind, a, b, widthOverride) {
  const layer = ensureActiveLayer(editor);
  const spacing = editor._grid?.spacing || GRID_DEFAULTS.spacing;
  const width = widthOverride != null ? widthOverride : LATTICE_STYLE[kind].widthFactor * spacing;
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
 *  fixed DEFAULT_NODE_RADIUS_IN, unchanged from before.
 *
 *  @param {number} [radiusOverride] SE7i: the generator's own PATTERN.
 *   widths.nodeRadius (inches), same generator-only scope as
 *   emitSegment's widthOverride above. */
export function emitNode(editor, p, radiusOverride) {
  if (findNodeAt(editor, p)) return null;
  const grid = editor._grid;
  const gridOn = !!(grid && grid.visible);
  const r = radiusOverride != null
    ? radiusOverride
    : (gridOn ? LATTICE_STYLE.node.radiusFactor * (grid.spacing || GRID_DEFAULTS.spacing) : DEFAULT_NODE_RADIUS_IN);
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
