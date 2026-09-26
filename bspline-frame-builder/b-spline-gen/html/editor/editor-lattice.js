/**
 * editor-lattice.js — SE7a: the Lattice tool. SE7k: which of Rail/Tie/Node
 * a drag or click produces is an EXPLICIT choice (the panel's Add:
 * segmented control, LATTICE_DRAW_KINDS below) — Rail/Tie drag, Node
 * places on a plain click, no drag needed. Auto-nodes are still placed at
 * ends and crossings for a drawn rail/tie (or dropped manually with the
 * Circle tool too — see SNAP_POLICY's `circle: 'center'` row and editor-
 * interaction.js's circleHandler; both it and Add: Node call the same
 * emitNode). A click that lands on empty space with neither Add: Node nor
 * Circle active still does nothing.
 *
 * Pure lattice math (toLattice/fromLattice/constrainToKind/
 * latticeCrossings) has no svg.js/DOM dependency and is unit-tested
 * directly, matching editor-view.js's/editor-grid.js's own split. The emit
 * helpers below that line DO touch the DOM/svg.js — same leaf-module shape
 * as editor-grid.js's applyGrid.
 */
import { ensureActiveLayer } from './layers.js';
import { GRID_DEFAULTS } from './editor-grid.js';
import { worldPoint } from './editor-coords.js';

// SE7k (Fred: "needs an add rail and add tie, add node button"): drawKind
// is the EXPLICIT choice driving the hand-drawn tool's start/update/finish
// (editor-interaction.js) — session-only UI state, same scope as
// autoNodes (not persisted, not per-layer). 'rail' is the default —
// today's most common gesture stays a single click-drag away.
export const LATTICE_DEFAULTS = { autoNodes: true, drawKind: 'rail' };

/**
 * SE7k: the three explicit kinds the Lattice tool can draw, declared once
 * so the panel's "Add: [Rail] [Tie] [Node]" segmented control renders
 * from this table (properties-lattice.js) rather than three hand-listed
 * buttons whose labels/hints could drift from what the tool actually
 * does — same "declared table, not hand-typed" shape as layers.js's own
 * FUSION_GEOMETRY. Replaces the old direction-guessed kind (classifyDrag
 * on the drag vector) — the kind is now always exactly one of these
 * three, chosen before the drag starts, never inferred from it.
 *
 * `clickSpawn` (AMEND 1, Fred: "spawn or drag, what's best?" — advisor
 * ruling: BOTH, standard click-vs-drag): what a CLICK (no drag past the
 * slop) spawns, since dragging is what draws a constrained rail/tie —
 * 'fullRow' (a rail spanning the whole board extent on that row, same as
 * Generate), 'betweenRails' (a tie bridging the nearest existing rails
 * above/below, or a default-length span if fewer than two exist), 'point'
 * (a node — click was already how Node placed, unchanged). Declared here
 * rather than a hand-rolled if/else per kind in editor-interaction.js, so
 * a future 4th kind's click behavior is one table edit.
 */
export const LATTICE_DRAW_KINDS = Object.freeze([
  { value: 'rail', label: 'Rail', hint: 'Drag along the rail axis.', clickSpawn: 'fullRow' },
  { value: 'tie', label: 'Tie', hint: 'Drag across the rails — snaps to them.', clickSpawn: 'betweenRails' },
  { value: 'node', label: 'Node', hint: 'Click to place a node.', clickSpawn: 'point' },
]);

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
 * constrainToKind/latticeCrossings/the generator's row-column math
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

/** T66/T72: a rail/tie piece shorter than this (model-space inches, after
 *  `fromLattice`) is a genuine ZERO-LENGTH degenerate — a boundary clip
 *  landing both of a piece's own ends at the same lattice point (T66's
 *  own original finding, a tie at an hourglass waist), or a scan-line
 *  tangent to a deeply-pinched boundary curve producing a vanishingly
 *  short "inside" span (T72 AMEND 5's own sweep, an EXTREME waistReach).
 *  `editor-sketch-manifest.js`'s own `manifestFromLattice` already
 *  filtered this at its own level (T66); `generatePattern` below needed
 *  the IDENTICAL filter — declared once, here, in the lowest-level module
 *  both already import from, rather than as two independently-maintained
 *  copies of the same threshold (a real T72 parity bug: the app used to
 *  draw a zero-length `data-lattice="rail"` element the manifest quietly
 *  never declared, an app/manifest COUNT mismatch, not just cosmetic). */
export const MIN_PIECE_LENGTH_IN = 1e-6;

/** Model-space point -> integer lattice coordinates (nearest cell). */
export function toLattice(pt, spacing) {
  return { i: Math.round(pt.x / spacing), j: Math.round(pt.y / spacing) };
}

/** Integer lattice coordinates -> model-space point. */
export function fromLattice(ij, spacing) {
  return { x: ij.i * spacing, y: ij.j * spacing };
}

/**
 * SE7k AMEND 5: toLattice's own pre-round intermediate — model-space
 * point -> FRACTIONAL lattice coordinates, no snapping. A proximity test
 * against a pixel-scale tolerance (nearestEndWithin, below) needs the
 * CONTINUOUS distance to a piece's endpoint; rounding first would
 * collapse a small tolerance into all-or-nothing whole-cell jumps.
 */
export function toLatticeFractional(pt, spacing) {
  return { i: pt.x / spacing, j: pt.y / spacing };
}

/**
 * SE7k: both args are lattice coords (canonical frame). Projects b onto
 * the axis `kind` requires from a — a rail is always horizontal in this
 * frame (locks j to a's row, i free), a tie always vertical (locks i to
 * a's column, j free). `kind` is the tool's EXPLICIT choice (the Add:
 * segmented control), never guessed from the drag's own direction —
 * replaces the old classifyDrag+constrain pair, which picked whichever
 * axis the drag happened to move along more. A "bare click" (a === b)
 * still needs no special case here: the caller checks for that itself
 * before deciding whether to emit anything (constrainToKind just
 * returns a's own row/column, same as the no-movement case always
 * would).
 */
export function constrainToKind(a, b, kind) {
  return kind === 'rail' ? { i: b.i, j: a.j } : { i: a.i, j: b.j };
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

/**
 * SE7k AMEND 5 (Fred: "it's not about nodes, it's the feature's END that
 * can stretch it"): is `ptCanon` within `tol` (canonical/lattice units,
 * already converted from a pixel tolerance by the caller) of `pieceCanon`
 * {a,b}'s NEARER end? Returns 'a', 'b', or null (neither close enough —
 * a body grab). Shared by rails and ties alike; a piece's own two ends
 * are just points, so this needs no rail/tie-specific math at all.
 */
export function nearestEndWithin(pieceCanon, ptCanon, tol) {
  const da = Math.hypot(ptCanon.i - pieceCanon.a.i, ptCanon.j - pieceCanon.a.j);
  const db = Math.hypot(ptCanon.i - pieceCanon.b.i, ptCanon.j - pieceCanon.b.j);
  if (da <= tol && da <= db) return 'a';
  if (db <= tol) return 'b';
  return null;
}

/**
 * SE7k AMEND 4/5: stretch a rail's `whichEnd` to `newI` (canonical frame —
 * a rail's own axis is i, its row/j never changes here, unlike a MOVE).
 * Clamped so it can never pass the OTHER end (minimum length 1 lattice
 * step), preserving whichever side of the fixed end it started on — "the
 * end moves along the rail's own axis only... can't pass the other end."
 * The other end (and anything attached to it) is untouched — SE7k AMEND
 * 4: "attached ties stay where they are" when a rail is stretched, unlike
 * a MOVE (moveRailAlongAxis, above), which drags every attached tie-end
 * along. Returns the new {a,b}; the caller carries a rail-end NODE at
 * `whichEnd` along separately (this function only knows about the rail's
 * own two endpoints).
 */
export function stretchRailEnd(railCanon, whichEnd, newI) {
  const fixed = whichEnd === 'a' ? railCanon.b : railCanon.a;
  const original = railCanon[whichEnd];
  const sign = original.i >= fixed.i ? 1 : -1;
  const clampedI = sign > 0 ? Math.max(newI, fixed.i + 1) : Math.min(newI, fixed.i - 1);
  const moved = { i: clampedI, j: railCanon.a.j };
  return whichEnd === 'a' ? { a: moved, b: railCanon.b } : { a: railCanon.a, b: moved };
}

/**
 * SE7k AMEND 4/5: stretch a tie's `whichEnd` to `newJ` (canonical frame —
 * a tie's own axis is j, its column/i never changes here). Same clamp-
 * against-the-other-end rule as stretchRailEnd, mirrored onto the tie's
 * own axis. Snapping this end to the grid AND to nearby rail rows
 * (railSnapRows) is the CALLER's job (editor-interaction.js), the same
 * split constrainToKind/the T30 rail-row snap already use for a freshly-
 * drawn tie's end — this function only clamps the minimum-length rule.
 */
export function stretchTieEnd(tieCanon, whichEnd, newJ) {
  const fixed = whichEnd === 'a' ? tieCanon.b : tieCanon.a;
  const original = tieCanon[whichEnd];
  const sign = original.j >= fixed.j ? 1 : -1;
  const clampedJ = sign > 0 ? Math.max(newJ, fixed.j + 1) : Math.min(newJ, fixed.j - 1);
  const moved = { i: tieCanon.a.i, j: clampedJ };
  return whichEnd === 'a' ? { a: moved, b: tieCanon.b } : { a: tieCanon.a, b: moved };
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
 *  @param {number} [radiusOverride] SE7i: derived from the generator's
 *   own PATTERN.widths.nodeDiameter (NODE-D: stored/edited as a diameter,
 *   halved by each caller before reaching this always-a-radius param),
 *   same generator-only scope as emitSegment's widthOverride above. */
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
