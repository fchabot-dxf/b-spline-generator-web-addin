/**
 * editor-sketch-manifest.js — T61 (SE15-CONSTRAINED-SKETCH-DESIGN.md §1-4,
 * §6 — dispatch bundled §8's own Slice 1 + Slice 2 into one turn: "box
 * lattice... a Shape Lattice hourglass and bottle... widths as offsets
 * with round caps... the >60-piece plain fallback flag"). The pure SKETCH
 * MANIFEST producer — no DOM, no editor object, no Fusion API, same
 * contract `computePattern`/`generateSilhouette` already set (this
 * module's own two producers below CALL those, unchanged, rather than
 * re-deriving lattice or silhouette math a third time — "declare over
 * hand-roll", not a parallel copy).
 *
 * Ground truth #1 (design doc): today's Fusion export is a flat, DPI-baked
 * SVG stamp, never a real sketch entity. This module turns a layer's own
 * PATTERN into the declared manifest shape §1 describes — entities/
 * constraints/parameters/dimensions an add-in build routine (Slice 3,
 * NOT built this turn — NO FUSION) can feed through fb_engine's own
 * geom_step/constraint_step/dimension_step/offset_step dispatch.
 *
 * Two disclosed refinements over the design doc's own first draft, found
 * while actually implementing this (see WORK-LOG-lane-b.md, T61):
 * - H/V constraint choice is read directly off each entity's own computed
 *   endpoints (a.x===b.x -> Vertical, a.y===b.y -> Horizontal) rather than
 *   threading PATTERN.orientation through — equivalent for every rail/tie
 *   (orient() only ever produces an axis-aligned segment either way, see
 *   editor-lattice.js's own orient()), simpler, and self-verifying (a
 *   genuinely diagonal segment — which should never occur — gets no H/V
 *   constraint at all instead of a wrong one).
 * - The round-cap arcs' own "tangent to its own offset pair" relationship
 *   (§4) is NOT declared here as a manifest constraint at all — the
 *   offset curves it would reference don't exist as named entities until
 *   the add-in creates them live in Fusion (§5's own build sequence, a
 *   Pulse before an offset's own result curve can be referenced at all).
 *   This module emits the cap's own GEOMETRY (center/radius/sweep) plus a
 *   Radial dimension driving that radius from the same width parameter;
 *   the tangent-to-offset wiring is Slice 3's own runtime job, using
 *   object references it holds directly, not a manifest-declared id pair.
 *
 * T64 fix (advisor's own real end-to-end Fusion run, `_import_all_svg_
 * layers` fed a real two-layer payload): every producer above builds in
 * RAW board-inches space (region-relative, origin at the board's own
 * top-left) — the SAME space `computePattern`/`generateSilhouette`
 * themselves already use. That is NOT where the plain-SVG carve path
 * lands: `bakeSvgForCarving`/`carveMatrix` (editor-coords.js) center the
 * board on the origin, and Fusion's own SVG importer (empirically
 * measured by the advisor, not re-derived here — `carveMatrix`'s own
 * matrix has NO Y term despite its neighboring `bakeSvgForCarving`
 * comment claiming one, so the flip demonstrably happens somewhere in
 * Fusion's own SVG-import step, not in this codebase's JS) ends up
 * flipping Y on top of that. `build_constrained_sketch` builds geometry
 * DIRECTLY (no SVG, no importer), so it never gets that implicit flip for
 * free — this module must bake the SAME NET transform in itself, applied
 * as ONE final pass (`applyCarvePlacement`, below) over the already-built
 * `entities[]`, so every OTHER producer above keeps working in the
 * simpler natural board-space it was already written and tested in.
 */
import { computePattern, PATTERN_DEFAULTS, hasGeneratedSilhouette, usesContourCenterline } from './editor-lattice-pattern.js';
import { toLattice, fromLattice, MIN_PIECE_LENGTH_IN } from './editor-lattice.js';
import {
  primitivesBBox, insetGeneratedPresetPathDToPrimitives, insetRegionForContour,
} from './editor-lattice-boundary.js';
import { generateSilhouette, primitivesToPathD, PRESETS } from './editor-shape-lattice-generator.js';
import { mirrorSegmentIndex, primitiveSegmentMap } from './editor-shape-lattice-interaction.js';

/** §6: below this many rails+ties+nodes, every piece gets its own H/V +
 *  tie-on-rail Coincident constraints; at/above it, entities only (still
 *  real, selectable Line/Circle geometry, just unconstrained beyond what
 *  the entity itself implies) — the width/offset/cap mechanism (§4) runs
 *  identically either way (§6: "not a separate code path, the SAME one,
 *  just with the per-piece relationship constraints skipped").
 *  T72 (SE15c, advisor's own live Fusion measurement, superseding the
 *  original 60): 16 rails / 97 pieces — plain (the pre-T72 default) 61s,
 *  0.139in drift at stroke 0.5, rails visibly tilted; constrained 90s, 0
 *  constraint failures, exact parity, 0.030in drift. A 14-rail hourglass
 *  (101 pieces, 170 constraints) also built with 0 constraint failures at
 *  the constrained path. The ORIGINAL value (SE15-CONSTRAINED-SKETCH-
 *  DESIGN.md, "Answers" §3: "100 rails x 2 offsets = 20.6s... threshold
 *  default: 60 pieces constrained; above -> plain geometry") measured
 *  timing alone, before this project ever built the plain-geometry path's
 *  own real drift/tilt cost — 300 is the new declared value, not guessed
 *  here either — a declared constant, not a magic number inline (§6's own
 *  bar).
 */
export const SKETCH_PIECE_THRESHOLD = 300;

/** T64 (5 mid-turn amendments, final state): every rail/tie piece becomes
 *  a Fusion-native SLOT (`addCenterToCenterSlot`), for BOTH a plain box
 *  Lattice layer AND a Shape Lattice layer's own fill — Fred's own final
 *  call ("box lattice needs to be slots too"), after first asking only
 *  to remove the OLD offset+cap mechanism (now deleted entirely, not
 *  kept as a dead third option) from the box tool. Kept as a declared
 *  per-LAYER-TYPE table, not a single hardcoded string, because
 *  `'centerline'` (a bare, undimensioned line) is EXPLICITLY named as
 *  still a real, available value for later — just not the default for
 *  either type any more. `buildSketchManifest` picks the mode from the
 *  SAME `hasShape` discriminator it already computes; declared here so
 *  both that call site and any direct `manifestFromLattice` caller share
 *  the identical constants.
 *
 *  T66 (Fred's own rule, "never use Fix", after the advisor's own live
 *  Fusion run: ALL 63 relationship constraints on a real box fixture
 *  failed VCS_SKETCH_OVER_CONSTRAINTS because T64's own anchoring made
 *  the slot centerline's own two end points Fixed): the slot is NO
 *  LONGER anchored at all, on either the API call's own 4th argument or
 *  via a post-hoc `isFixed`. Relationship constraints ALONE (Horizontal/
 *  Vertical + Coincident) now carry the FULL job of pinning each piece in
 *  place — the advisor's own measured minimal example (2 rails + 1 tie,
 *  all slots, NO Fix: rails Horizontal, tie Vertical, tie ends Coincident
 *  to their rail's own centerline) produced ZERO failures and a stable,
 *  reversible width-parameter round-trip (0.07in -> 0.2in moved
 *  centerlines only 0.005in; 0.2in -> 0.07in returned EXACTLY). */
export const SKETCH_WIDTH_MODE = { boxLattice: 'slot', shapeLattice: 'slot' };

/** T69 (SE15b, Fred: "want the shape contour to be made of slots") — the
 *  Shape Lattice silhouette's own CONTOUR gets the SAME 'slot'-vs-
 *  'centerline' choice SKETCH_WIDTH_MODE already declares for rails/ties,
 *  as its OWN separate declared constant (never the SAME field —
 *  SKETCH_WIDTH_MODE/`manifest.widthMode` is already established,
 *  including in this module's own tests, as scoped to the LATTICE FILL
 *  only; overloading it to also mean "and the contour" would be a silent
 *  meaning-change on an existing field, not a new declaration). 'slot' is
 *  the default (a contour Line becomes a Fusion-native center-to-center
 *  slot via `addCenterToCenterSlot`, EXACTLY the same entity/dimension
 *  shape a rail/tie slot already uses; a contour Arc3Point becomes a
 *  three-point ARC slot via `addThreePointArcSlot` — a genuinely new
 *  Fusion API surface, unverified this turn, NO FUSION); 'centerline' (a
 *  bare, undimensioned Line/ArcCenter, today's pre-T69 shape) stays a
 *  real, available alternative, matching SKETCH_WIDTH_MODE's own
 *  'centerline' — never removed, just no longer the default. */
export const SKETCH_CONTOUR_WIDTH_MODE = 'slot';

const EPS = 1e-9;

function toEntityId(kind, index) {
  return `${kind}${index}`;
}

/** §2's own closed-form fact, read directly off the ALREADY-COMPUTED
 *  model-space endpoints rather than threaded PATTERN.orientation: an
 *  axis-aligned Line's two ends share exactly one coordinate — 'Vertical'
 *  if x matches (Fusion's own sense: the line runs along Y), 'Horizontal'
 *  if y matches — or null for a genuinely diagonal Line (a kink's own
 *  apex-to-endpoint legs), which gets no H/V constraint. Works
 *  identically for a lattice rail/tie (either PATTERN.orientation — see
 *  this module's own header) and a shape-preset horn/edge Line. */
function axisConstraintType(p1, p2) {
  if (Math.abs(p1.x - p2.x) < EPS) return 'Vertical';
  if (Math.abs(p1.y - p2.y) < EPS) return 'Horizontal';
  return null;
}

/** Is lattice point `pt` coincident with lattice segment `seg` ({a,b}) —
 *  on its own fixed axis AND within its running-axis range? Generic over
 *  rail/tie and either orientation (checks the SEGMENT's own fixed
 *  coordinate directly, never assumes which axis is fixed) — §3's own "a
 *  plain equality check on the ALREADY-COMPUTED {i,j} pairs... a tie's
 *  own endpoint coordinate IS the rail's own coordinate whenever they're
 *  meant to connect, by construction". */
function pointOnLatticeSegment(pt, seg) {
  if (Math.abs(seg.a.i - seg.b.i) < EPS) {
    if (Math.abs(pt.i - seg.a.i) > EPS) return false;
    const jMin = Math.min(seg.a.j, seg.b.j), jMax = Math.max(seg.a.j, seg.b.j);
    return pt.j >= jMin - EPS && pt.j <= jMax + EPS;
  }
  if (Math.abs(seg.a.j - seg.b.j) < EPS) {
    if (Math.abs(pt.j - seg.a.j) > EPS) return false;
    const iMin = Math.min(seg.a.i, seg.b.i), iMax = Math.max(seg.a.i, seg.b.i);
    return pt.i >= iMin - EPS && pt.i <= iMax + EPS;
  }
  return false;
}

/** T66 (advisor's own live Fusion run + Fred's own rule, "never use Fix"):
 *  a Coincident targeting a piece exactly at one of its own two ENDS must
 *  be POINT-TO-POINT (`id:S`/`id:E`), not point-on-curve against the bare
 *  id — the advisor's own measured working scheme (2 rails + 1 tie, ZERO
 *  failures) uses point-to-point at each tie end specifically. Previously
 *  only `nodePieceCoincidences` (below) made this 3-way end/mid-span/none
 *  distinction; the tie-on-rail wiring used a cruder 2-way check (on-
 *  segment-anywhere -> always bare id) that happened to still work when
 *  every piece's own centerline ends were Fixed (over-constraint from the
 *  redundant curve-vs-point ambiguity was masked by the SAME Fix that
 *  caused the 63 reported failures) — now that Fix is gone entirely, this
 *  precision is worth having consistently on BOTH call sites rather than
 *  leaving one cruder than the other. Returns the target STRING (`id`,
 *  `id:S`, or `id:E`) or null if `pt` isn't on `seg` at all. */
function pieceEndOrCurveTarget(pt, seg, id) {
  if (pt.i === seg.a.i && pt.j === seg.a.j) return `${id}:S`;
  if (pt.i === seg.b.i && pt.j === seg.b.j) return `${id}:E`;
  if (pointOnLatticeSegment(pt, seg)) return id;
  return null;
}

/** T64 CHANGE (Fred, via the advisor: "box lattice needs to be slots too"
 *  — the FINAL design after 5 mid-turn amendments superseded the offset+
 *  cap mechanism above entirely): every rail/tie piece becomes a
 *  `type:'Slot'` entity, built in Fusion via the NATIVE
 *  `sketch.addCenterToCenterSlot(p1, p2, width, isFixed)` (T65: lives on
 *  Sketch, not SketchLines; T66: `isFixed` is now always False — see
 *  SKETCH_WIDTH_MODE's own doc comment above for why) — ONE call
 *  produces the whole rounded-rect body (2 side lines + 2 end arcs + an
 *  internal construction centerline + ONE width dimension) as a single,
 *  already-correct, already-symmetric unit. No JS-side offset math, no
 *  cap-arc construction, no cap-to-offset coincidence wiring — Fusion's
 *  own primitive already does all of that. A `SlotWidth` dimension entry
 *  drives that one dimension's own expression (sketch_manifest_builder.py
 *  resolves it after creation, same "seed value, then re-drive by
 *  expression" pattern this module already uses for every other
 *  dimensioned quantity). */
function addSlotPieces(entities, dimensions, pieces, paramName, widthValue) {
  for (const { id, p1, p2, railGroup } of pieces) {
    const entity = { id, type: 'Slot', p1: [p1.x, p1.y], p2: [p2.x, p2.y], width: widthValue };
    // T73 AMEND 3c (Fred: "rails can have colinearity"): a piece's OWN
    // railGroup (only rail/tie pieces carry one — the contour's own
    // single-piece call site below never passes it) is plain DATA here,
    // not just an internal bookkeeping key — declared once, so a future
    // consumer never needs to re-derive "which pieces were originally one
    // rail" from the Collinear constraints below.
    if (railGroup !== undefined) entity.railGroup = railGroup;
    entities.push(entity);
    dimensions.push({ type: 'SlotWidth', target: id, expression: paramName });
  }
}

/**
 * §3's own `_manifestFromLattice` — `pattern` (a layer's own PATTERN
 * object, PATTERN_DEFAULTS-mergeable, same shape `computePattern` itself
 * reads) + an ALREADY-RESOLVED lattice `extent` (board/rect:
 * `{iMin,jMin,iMax,jMax}`, or boundary: `{...,mode:'boundary',
 * primitives}` — computePattern's own existing `opts.extent` contract,
 * unchanged) -> `{entities, constraints, parameters, dimensions, groups,
 * pieceCount, constrained}`. Pure: calls `computePattern` (the SAME
 * function `generatePattern` itself calls) then `fromLattice` on every
 * point, exactly the pipeline `generatePattern`'s own DOM-emit loop
 * already runs, building manifest entities instead of calling
 * `emitSegment`/`emitNode`.
 */
export function manifestFromLattice(pattern, extent, widthMode = SKETCH_WIDTH_MODE.shapeLattice) {
  const spacing = pattern.spacing || PATTERN_DEFAULTS.spacing;
  const widths = { ...PATTERN_DEFAULTS.widths, ...(pattern.widths || {}) };
  const { segments, nodePoints } = computePattern(pattern, { extent, occupied: null });

  const railsCanon = segments.filter((s) => s.kind === 'rail');
  const tiesCanon = segments.filter((s) => s.kind === 'tie');
  const pieceCount = railsCanon.length + tiesCanon.length + nodePoints.length;
  const constrained = pieceCount < SKETCH_PIECE_THRESHOLD;

  const entities = [];
  const constraints = [];
  const parameters = [];
  const dimensions = [];
  const groups = { rails: [], ties: [], nodes: [] };

  // T64 CHANGE: 'centerline' (a bare, undimensioned line — legacy/
  // available but no longer the default for either layer type per
  // Fred's own "box lattice needs to be slots too") vs 'slot' (the new
  // default for BOTH: a Fusion-native center-to-center slot, see
  // addSlotPieces above). Entity TYPE is decided per-piece here; T66:
  // NO anchoring/isFixed at all any more (see SKETCH_WIDTH_MODE's own
  // doc comment) — pinning each piece in place is now entirely the
  // relationship constraints' own job (below), not the Python builder's.
  const isSlotMode = widthMode !== 'centerline';

  // T66 (advisor's own live Fusion run: one tie's own Slot failed with
  // "InternalValidationError : isSuccessful", root cause DIAGNOSED here —
  // NOT independently confirmed against real Fusion this turn, per NO
  // FUSION — as a boundary-clip landing a tie's own two ends at the SAME
  // lattice point, an exactly-zero-length centerline. `addCenterToCenterSlot`/
  // `addByTwoPoints` both need a real, non-degenerate direction to build
  // from; a zero-length piece has none. Reproduced directly against a
  // DEFAULT hourglass fixture (no exotic params needed) via a real run of
  // this module — see WORK-LOG-lane-b.md T66. Filtered out here, at the
  // SOURCE, rather than left for the Python builder to catch — a piece
  // this short was never going to be a real, buildable slot/line for
  // EITHER width mode, so there's no id worth reserving for it at all.
  // T72: this threshold is now `MIN_PIECE_LENGTH_IN` (editor-lattice.js),
  // shared with `generatePattern`'s own IDENTICAL filter — a T72 AMEND 5
  // sweep found the app drawing a zero-length piece THIS module already
  // correctly excluded, an app/manifest count mismatch from two
  // independently-maintained copies of the same threshold.
  const pieceLength = (p1, p2) => Math.hypot(p2.x - p1.x, p2.y - p1.y);

  // T73 AMEND 3 (Fred: "I need rails to coincide to contour"): a rail/tie
  // end `computePattern` attributed to a specific contour primitive
  // (`usesContourCenterline` mode only — `seg.?ContourHit` is `undefined`
  // otherwise, same "absent field, not a branch" convention every other
  // optional per-piece signal in this module already uses) gets a
  // Coincident to that primitive's own `seg{index}` entity — point-to-
  // point (`:S`/`:E`) when the crossing landed AT that primitive's own
  // end (a JOINT between two contour segments: `primitiveHitAt` already
  // returns the FIRST matching primitive with its S/E flag, so this is
  // ALREADY "one segment only, point-to-point," never a second point-on-
  // curve to the neighboring segment — AMEND 3b's own over-constraint
  // concern, satisfied by construction, not a separate dedup pass), else
  // bare `seg{index}` (point-on-curve, mid-primitive).
  const contourHitConstraint = (pieceId, suffix, hit) => {
    if (!hit) return;
    const segId = toEntityId('seg', hit.index);
    constraints.push({ type: 'Coincident', targets: [`${pieceId}:${suffix}`, hit.end ? `${segId}:${hit.end}` : segId] });
  };

  // T73 AMEND 3c (Fred: "rails can have colinearity"): when a boundary
  // crossing mid-row/column splits one original rail/tie into several
  // pieces (`railGroup`, computePattern's own row/column key), giving
  // EVERY piece its own Horizontal/Vertical constraint over-constrains —
  // an H/V on the first piece plus a Collinear to the next already fixes
  // the second piece's own direction. `emitAxisOncePerGroup` (below)
  // tracks which groups already got theirs; `collinearForGroup` (after
  // both loops) links each group's own consecutive pieces, in the SAME
  // order they were pushed (already position-sorted — `_clipToSpans`
  // iterates spans ascending, so pieces of one row/column emit in that
  // order already, never re-sorted here).
  function emitAxisOncePerGroup(seenGroups, railGroup, axis, id) {
    if (railGroup != null && seenGroups.has(railGroup)) return;
    if (!axis) return; // never mark a group "seen" on a no-op -- a genuinely
    // diagonal piece (shouldn't happen for a rail/tie, but never assumed)
    // leaves the group's direction UNconstrained, so the next piece must
    // still get its own attempt rather than being silently skipped too.
    if (railGroup != null) seenGroups.add(railGroup);
    constraints.push({ type: axis, targets: [id] });
  }
  function collinearForGroups(pieces) {
    const byGroup = new Map();
    for (const p of pieces) {
      if (p.railGroup == null) continue;
      if (!byGroup.has(p.railGroup)) byGroup.set(p.railGroup, []);
      byGroup.get(p.railGroup).push(p.id);
    }
    for (const ids of byGroup.values()) {
      for (let k = 1; k < ids.length; k++) constraints.push({ type: 'Collinear', targets: [ids[k - 1], ids[k]] });
    }
  }

  const railAxisGroupsSeen = new Set();
  const railPieces = [];
  railsCanon.forEach((seg, idx) => {
    const id = toEntityId('rail', idx);
    const p1 = fromLattice(seg.a, spacing), p2 = fromLattice(seg.b, spacing);
    if (pieceLength(p1, p2) < MIN_PIECE_LENGTH_IN) return;
    if (!isSlotMode) entities.push({ id, type: 'Line', p1: [p1.x, p1.y], p2: [p2.x, p2.y], railGroup: seg.railGroup });
    groups.rails.push(id);
    railPieces.push({ id, p1, p2, railGroup: seg.railGroup });
    if (constrained) {
      emitAxisOncePerGroup(railAxisGroupsSeen, seg.railGroup, axisConstraintType(p1, p2), id);
      contourHitConstraint(id, 'S', seg.aContourHit);
      contourHitConstraint(id, 'E', seg.bContourHit);
    }
  });
  if (constrained) collinearForGroups(railPieces);

  // T67 (advisor's own real Fusion run — a box-lattice shape run hit a
  // "node24:C + tie12:S over-constrained" failure mid-run, not seen again
  // in the FINAL run, so not a guaranteed reproduction, but a real,
  // explicable one): a node whose own point sits at a tie's own end that
  // is ALSO tie-on-rail-wired to a rail gets THREE separate Coincident
  // constraints among the same 3 mutually-linked entities (node-to-tie-
  // end, node-to-rail, tie-end-to-rail) — the third is transitively
  // IMPLIED by the other two (`computePattern`'s own `addNode` calls
  // confirm nodePoints structurally overlaps every tie's own two ends, so
  // this triangle is a real, recurring shape, not a rare edge case).
  // Tracked here (tie-end target string -> the rail target it's already
  // wired to) so `nodePieceCoincidences` (below) can drop its OWN
  // redundant leg of the same triangle rather than declaring all three.
  const tieEndToRailTarget = {};

  const tieAxisGroupsSeen = new Set();
  const tiePieces = [];
  tiesCanon.forEach((seg, idx) => {
    const id = toEntityId('tie', idx);
    const p1 = fromLattice(seg.a, spacing), p2 = fromLattice(seg.b, spacing);
    if (pieceLength(p1, p2) < MIN_PIECE_LENGTH_IN) return;
    if (!isSlotMode) entities.push({ id, type: 'Line', p1: [p1.x, p1.y], p2: [p2.x, p2.y], railGroup: seg.railGroup });
    groups.ties.push(id);
    tiePieces.push({ id, p1, p2, railGroup: seg.railGroup });
    if (constrained) {
      emitAxisOncePerGroup(tieAxisGroupsSeen, seg.railGroup, axisConstraintType(p1, p2), id);
      // "tie-end-on-rail" (ROADMAP.md:765) — a plain equality check on the
      // already-computed lattice coordinates, §3's own doc comment; no
      // geometric search needed. T66: now uses the SAME 3-way end/mid-
      // span/none distinction `nodePieceCoincidences` already used
      // (`pieceEndOrCurveTarget`) — point-to-point when the tie's own end
      // lands EXACTLY on the rail's own end, point-on-curve only for a
      // genuine mid-span landing — matching the advisor's own measured
      // working scheme precisely (previously always used the bare id,
      // which happened to still validate while every centerline end was
      // Fixed; T66 removes Fix entirely, so this precision is now worth
      // having on both call sites, not just the node one).
      ['a', 'b'].forEach((end) => {
        const railIdx = railsCanon.findIndex((r) => pointOnLatticeSegment(seg[end], r));
        if (railIdx >= 0) {
          const suffix = end === 'a' ? 'S' : 'E';
          const railTarget = pieceEndOrCurveTarget(seg[end], railsCanon[railIdx], toEntityId('rail', railIdx));
          if (railTarget) {
            constraints.push({ type: 'Coincident', targets: [`${id}:${suffix}`, railTarget] });
            tieEndToRailTarget[`${id}:${suffix}`] = railTarget;
          }
        }
      });
      contourHitConstraint(id, 'S', seg.aContourHit);
      contourHitConstraint(id, 'E', seg.bContourHit);
    }
  });
  if (constrained) collinearForGroups(tiePieces);

  // T64 CHANGE (amendment #1's own "NODES: node circle CENTER coincident
  // to the slot centerline END point... crossing nodes: center
  // coincident to the tie centerline end + point-on-curve of the rail
  // centerline"): a real, previously-undeclared relation — T61 only ever
  // placed the node's own Circle numerically at the right coordinate,
  // with no explicit constraint tying it to the piece(s) it sits on.
  // Reuses `pointOnLatticeSegment` (the SAME closed-form check tie-on-
  // rail already uses) against BOTH rails and ties: an EXACT end match
  // -> Coincident to that piece's own `:S`/`:E` point; a match elsewhere
  // along the piece's own span -> Coincident to the piece's own BARE id
  // (point-on-curve — Fusion's own addCoincident(point, curve) overload,
  // already how a bare-id Coincident target resolves via
  // fb_engine's own resolve_entity). A node can coincide with MULTIPLE
  // pieces (a genuine crossing) — every match gets its own constraint,
  // per Fred's own "separate points + one explicit Coincident per joint,
  // never merged" rule (T64's own FINAL RULE amendment).
  function nodePieceCoincidences(pt) {
    const out = [];
    const check = (canonList, kindPrefix) => {
      canonList.forEach((seg, i) => {
        const target = pieceEndOrCurveTarget(pt, seg, toEntityId(kindPrefix, i));
        if (target) out.push(target);
      });
    };
    check(railsCanon, 'rail');
    check(tiesCanon, 'tie');
    // T67: drop any target that's already transitively implied by a
    // tie-end this SAME node also coincides with (see tieEndToRailTarget's
    // own doc comment above) — e.g. a node at tie0:S, where tie0:S is
    // already wired to rail0, does NOT also need node-to-rail0 declared
    // separately; node-to-tie0:S plus tie0:S-to-rail0 already implies it.
    const redundant = new Set();
    for (const t of out) {
      const railViaTie = tieEndToRailTarget[t];
      if (railViaTie && out.includes(railViaTie)) redundant.add(railViaTie);
    }
    return out.filter((t) => !redundant.has(t));
  }

  nodePoints.forEach((pt, idx) => {
    const id = toEntityId('node', idx);
    const p = fromLattice(pt, spacing);
    entities.push({ id, type: 'Circle', center: [p.x, p.y], radius: widths.nodeRadius });
    groups.nodes.push(id);
    if (constrained) {
      for (const target of nodePieceCoincidences(pt)) {
        // T67 (advisor's own real Fusion run: "argument 2 of type
        // SketchPoint"): a BARE circle id resolves to the Circle entity
        // itself, not a point — addCoincident's own first argument must
        // be a real SketchPoint. `:C` (the circle's own centre point,
        // fb_engine's existing suffix convention) is what actually
        // resolves to one; this was declared wrong at the SOURCE, not a
        // Python-side special case to patch around.
        constraints.push({ type: 'Coincident', targets: [`${id}:C`, target] });
      }
    }
  });

  // T63 ADD-ON (Fred: "I would prefer a unique stroke width param"): when
  // rails and ties are linked (PATTERN.widths.linkRailsTies, the DEFAULT
  // since T58) they share ONE Fusion user parameter, `stroke_width`,
  // rather than two separately-named ones that happen to carry the same
  // value — a person editing the sketch in Fusion sees ONE control for
  // "how thick is the lattice", matching what the panel's own linked
  // stepper already presents. Only a genuinely UNLINKED layer whose
  // rails/ties widths actually differ keeps the separate `rail_width`/
  // `tie_width` names (the pre-existing behavior, still real and
  // supported) — `linked` is true whenever EITHER the link flag is on OR
  // the two widths just happen to already match, so "separate names"
  // is reserved for the one case that actually NEEDS two numbers.
  // node_radius is untouched either way (never linked to rail/tie width).
  const strokeWidthLinked = widths.linkRailsTies !== false || widths.rails === widths.ties;
  if (strokeWidthLinked) {
    if (railPieces.length || tiePieces.length) {
      parameters.push({ name: 'stroke_width', value: widths.rails, unit: 'in' });
    }
    if (isSlotMode && railPieces.length) addSlotPieces(entities, dimensions, railPieces, 'stroke_width', widths.rails);
    if (isSlotMode && tiePieces.length) addSlotPieces(entities, dimensions, tiePieces, 'stroke_width', widths.ties);
  } else {
    if (railPieces.length) {
      parameters.push({ name: 'rail_width', value: widths.rails, unit: 'in' });
      if (isSlotMode) addSlotPieces(entities, dimensions, railPieces, 'rail_width', widths.rails);
    }
    if (tiePieces.length) {
      parameters.push({ name: 'tie_width', value: widths.ties, unit: 'in' });
      if (isSlotMode) addSlotPieces(entities, dimensions, tiePieces, 'tie_width', widths.ties);
    }
  }
  if (nodePoints.length) {
    parameters.push({ name: 'node_radius', value: widths.nodeRadius, unit: 'in' });
    groups.nodes.forEach((id) => dimensions.push({ type: 'Radial', target: id, expression: 'node_radius' }));
  }

  return { entities, constraints, parameters, dimensions, groups, pieceCount, constrained };
}

// §2's own hourglass/bottle resolved-param key -> the Fusion-facing
// (snake_case) user-parameter name — a small declared table, not a
// runtime camelCase->snake_case conversion, so the mapping is inspectable
// and each preset's own params are named deliberately, not mechanically.
const PARAM_FUSION_NAMES = {
  hourglass: { waistReach: 'waist_reach', cornerRadius: 'corner_radius', waistCenterY: 'waist_center_y' },
  bottle: { neckWidth: 'neck_width', bodyWidth: 'body_width', skeletonX: 'skeleton_x', neckLength: 'neck_length' },
};

// T74 AMEND 0: `PRESETS[preset].widthExpr` (editor-shape-lattice-
// generator.js — declared once, alongside the params that determine it)
// is written in THIS module's own camelCase param names; translate each
// token to its Fusion name via the SAME `nameTable` `parameters` itself
// already uses below, so the two never drift apart. A token that isn't a
// resolved param (`contour_width` itself) passes through unchanged.
function resolveWidthExpr(preset, nameTable) {
  const raw = (PRESETS[preset] && PRESETS[preset].widthExpr) || 'contour_width';
  return raw.split('*').map((tok) => {
    const name = tok.trim();
    return nameTable[name] || name;
  }).join(' * ');
}

/**
 * §3's own `_manifestFromShape` — `shape` (a layer's own
 * `PATTERN.shape` object, `generateSilhouette`'s own 2nd arg) + `region`
 * (`{x,y,w,h}`, model inches, `generateSilhouette`'s own 1st arg) ->
 * `{entities, constraints, parameters, dimensions, groups}`. Pure: calls
 * `generateSilhouette` (unchanged) then walks its own `primitives` list —
 * the SAME flat list `primitivesToPathD` already walks — building one
 * manifest entity per primitive.
 *
 * T69: `opts.widthMode` (default `SKETCH_CONTOUR_WIDTH_MODE`, i.e. 'slot')
 * decides whether each primitive becomes a Fusion-native SLOT (`Slot` for
 * a Line, reusing the EXACT `addSlotPieces` helper rails/ties already use
 * — a contour Line-slot IS a rail/tie slot, same shape, same mechanism;
 * `ArcCenterSlot` for an arc, a pre-carve sibling of `ArcCenter` that
 * `applyCarvePlacement` below turns into `Arc3PointSlot` post-placement,
 * the arc-shaped sibling of a Line's `Slot`) or the plain pre-T69
 * `Line`/`ArcCenter` ('centerline' mode, still real and available, just
 * no longer the default). `opts.strokeWidth` (default
 * `PATTERN_DEFAULTS.widths.rails`, since no caller-supplied `pattern`
 * object reaches this function) is the slot's own SEED width in inches;
 * `buildSketchManifest` always passes the layer's own real
 * `pattern.widths.rails` so the contour ends up the SAME stock thickness
 * as the rails/ties it's built alongside, per the dispatch's own "same
 * param as rails/ties" instruction — Fusion re-drives it via the
 * 'stroke_width' expression afterward either way, so this seed number is
 * a real starting value, never the final one.
 */
export function manifestFromShape(shape, region, opts = {}) {
  const widthMode = opts.widthMode ?? SKETCH_CONTOUR_WIDTH_MODE;
  const strokeWidth = opts.strokeWidth ?? PATTERN_DEFAULTS.widths.rails;
  const isSlotMode = widthMode !== 'centerline';
  const result = generateSilhouette(region, shape);
  const { preset, segments, primitives, params } = result;
  const n = segments.length;
  const segMap = primitiveSegmentMap(segments);

  const entities = [];
  const constraints = [];
  const dimensions = [];
  const groups = { silhouette: [] };

  const idsByPrimIndex = primitives.map((prim, i) => {
    const id = toEntityId('seg', i);
    if (prim.type === 'L') {
      if (isSlotMode) {
        addSlotPieces(entities, dimensions, [{ id, p1: prim.p0, p2: prim.p1 }], 'stroke_width', strokeWidth);
      } else {
        entities.push({ id, type: 'Line', p1: [prim.p0.x, prim.p0.y], p2: [prim.p1.x, prim.p1.y] });
      }
      const axis = axisConstraintType(prim.p0, prim.p1);
      if (axis) constraints.push({ type: axis, targets: [id] });
    } else {
      // rx===ry, phi===0 always — T58's own established, tested invariant
      // (this module's own header + editor-shape-lattice-generator.js's
      // own primitivesToPathD doc comment).
      if (isSlotMode) {
        entities.push({
          id, type: 'ArcCenterSlot', center: [prim.cx, prim.cy], radius: prim.rx,
          startAngleDeg: (prim.theta1 * 180) / Math.PI, sweepDeg: (prim.dTheta * 180) / Math.PI,
          width: strokeWidth,
        });
        dimensions.push({ type: 'SlotWidth', target: id, expression: 'stroke_width' });
      } else {
        entities.push({
          id, type: 'ArcCenter', center: [prim.cx, prim.cy], radius: prim.rx,
          startAngleDeg: (prim.theta1 * 180) / Math.PI, sweepDeg: (prim.dTheta * 180) / Math.PI,
        });
      }
    }
    groups.silhouette.push(id);
    return id;
  });

  // Coincident at EVERY adjacent primitive joint (wraparound) — including
  // a kink's own internal apex-joint (both its Lines were built FROM that
  // SAME apex coordinate, but the RELATIONSHIP is declared explicitly
  // anyway, per §2's own "not left merely close-enough by shared
  // floating-point value" ruling). Tangent additionally, ONLY when at
  // least one side is an arc (Line-Line "tangent" would force them
  // collinear, wrong at a genuine corner) AND neither side's own SEGMENT
  // is a 'kink' override (a kink is a deliberate sharp notch — declaring
  // Tangent at its own boundary would smooth over the very thing it
  // exists to produce; this is the corrected, self-consistent reading of
  // §2's own "kink: none beyond the shared point" row — see WORK-LOG-
  // lane-b.md T61 for the fuller derivation).
  // T71 (SE15 T69-fix-3, Fred: "dont use symmetry either" / "no radius dim
  // though, leave the sketch loose for now" — a near-total rollback of
  // T69-FIX's own AMEND 3/4/5, back to close to T69's ORIGINAL shape): the
  // mirror axis, the horizontal axis, every Symmetry constraint, and their
  // Coincident-to-origin anchors are ALL removed — Fred's own explicit
  // "loose contour" ruling (SE15-CONSTRAINED-SKETCH-DESIGN.md's own "LOOSE
  // CONTOUR"/"NO FIX" vocabulary): geometry is inserted symmetric (by
  // construction, from the manifest's own coordinates) and left LOOSE, not
  // explicitly re-constrained to stay so. The mirror-Tangent DEDUP (T70
  // AMEND 3, below) is REVERTED too: with Symmetry gone, "redundant given
  // the Symmetry pass" no longer holds, so every joint gets its own Tangent
  // again, undeduped (advisor-confirmed judgment call, T71 dispatch).
  const m = primitives.length;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const idA = idsByPrimIndex[i], idB = idsByPrimIndex[j];
    constraints.push({ type: 'Coincident', targets: [`${idA}:E`, `${idB}:S`] });
    const isKinkJoint = segments[segMap[i]].style === 'kink' || segments[segMap[j]].style === 'kink';
    const eitherArc = primitives[i].type === 'A' || primitives[j].type === 'A';
    if (eitherArc && !isKinkJoint) constraints.push({ type: 'Tangent', targets: [idA, idB] });
  }

  // Mirror-Equal (§2's own "every right-side entity <-> its LEFT mirror"),
  // restored to T69's own ORIGINAL, preset-agnostic shape — one plain
  // Equal per mirror pair, Line or Arc alike, no Symmetry/axis alongside
  // it. T71 also drops the shoulder-pair exception (T70 AMEND 4's own
  // "Equal(['seg1','seg9']) is OVER_CONSTRAINTS" — that reasoning depended
  // on the NOW-REMOVED Symmetry-on-center pinning the pair's position; gone,
  // the shoulder pair needs its own Equal again like every other pair,
  // advisor-confirmed judgment call, T71 dispatch). ONLY between segments
  // that produce exactly ONE primitive each — a disclosed scope-narrowing
  // (WORK-LOG-lane-b.md T61, unchanged by this turn): a kink's own
  // 2-primitive mirror pairing isn't verified this turn, so it's skipped
  // rather than guessed. Reuses `mirrorSegmentIndex` (T59) directly, not a
  // second mirror-index formula.
  // T71 (AMEND 6/12/13's own real-Fusion measurement: addDistanceDimension
  // only ever accepts 2 SketchPoints, never a curve — "Wrong number or
  // type of arguments"): the overall-size Distance dims (below) target
  // ONE POINT on each entity (`:S`) rather than the whole curve; which end
  // is picked doesn't affect the measured VALUE (a Horizontal/Vertical-
  // oriented Distance reads only the corresponding axis of the two
  // points), just which real SketchPoint anchors it.
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const mi = mirrorSegmentIndex(i, n);
    if (mi === i || seen.has(i) || seen.has(mi)) continue;
    seen.add(i); seen.add(mi);
    const primIdxI = segMap.indexOf(i), primIdxMi = segMap.indexOf(mi);
    const countI = segMap.filter((s) => s === i).length;
    const countMi = segMap.filter((s) => s === mi).length;
    if (countI !== 1 || countMi !== 1) continue;
    const primA = primitives[primIdxI], primB = primitives[primIdxMi];
    if (primA.type !== primB.type) continue; // never structurally mixed in these presets; skip rather than guess
    const idA = idsByPrimIndex[primIdxI], idB = idsByPrimIndex[primIdxMi];
    constraints.push({ type: 'Equal', targets: [idA, idB] });
  }

  // T73 AMEND 1 (advisor, measured live in Fusion on main 660f417): the
  // overall-size Distance dims used to anchor on whichever Line mirror
  // pair / self-mirroring horizontal pair the Equal loop above found
  // FIRST in primitive-iteration order — for the Bottle preset that's
  // seg0/seg8, the NECK sides, so Fusion's own solver forced the NECK to
  // contour_width (up to 3.07in off, live-measured); the hourglass only
  // ever passed by luck, because ITS first mirror pair already happens to
  // be the outer/widest sides. Fixed by choosing the anchor points BY
  // GEOMETRY instead: the contour's own actual corners at min-x/max-x
  // (width) and min-y/max-y (height), found directly from every LINE
  // primitive's own endpoints (never an arc's — an arc's full bounding
  // circle can overshoot its own visible sweep, e.g. a gently-curved arc
  // with a large radius). Every preset this module knows builds its
  // outline as top cap -> vertical "horn" -> arc -> ... -> bottom cap ->
  // vertical "horn" -> arc -> ..., with every arc tangent to (never past)
  // its neighboring horn/cap, so a Line's own endpoint is always the true
  // extreme, by construction, never an incidental one.
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const prim of primitives) {
    if (prim.type !== 'L') continue;
    for (const pt of [prim.p0, prim.p1]) {
      if (pt.x < xMin) xMin = pt.x;
      if (pt.x > xMax) xMax = pt.x;
      if (pt.y < yMin) yMin = pt.y;
      if (pt.y > yMax) yMax = pt.y;
    }
  }
  const firstLineIdAt = (axis, value) => {
    const idx = primitives.findIndex((prim) => prim.type === 'L'
      && Math.abs(prim.p0[axis] - value) < EPS && Math.abs(prim.p1[axis] - value) < EPS);
    return idx === -1 ? null : idsByPrimIndex[idx];
  };
  const leftId = firstLineIdAt('x', xMin), rightId = firstLineIdAt('x', xMax);
  const widthPairIds = (leftId && rightId) ? [leftId, rightId] : null;
  const topId = firstLineIdAt('y', yMin), bottomId = firstLineIdAt('y', yMax);
  const heightPairIds = (topId && bottomId) ? [topId, bottomId] : [];

  const nameTable = PARAM_FUSION_NAMES[preset] || {};
  const parameters = Object.entries(params).map(([key, value]) => ({
    name: nameTable[key] || key, value, unit: null,
  }));
  parameters.push({ name: 'half_width', value: region.w / 2, unit: 'in' });
  // T69: declared independently of manifestFromLattice's OWN 'stroke_width'
  // push (rails/ties, only when linked) — this function has no visibility
  // into that link state at all, so it always declares its own, by name;
  // Python's create-OR-UPDATE parameter sync (_sync_manifest_parameters)
  // harmlessly reconciles a duplicate declaration of the same name/value
  // in the common linked case, and is the ONLY source of it when unlinked.
  if (isSlotMode && entities.length) parameters.push({ name: 'stroke_width', value: strokeWidth, unit: 'in' });

  // T71: the contour's overall size — KEPT (Fred: "W and H is good"), but
  // now a point-to-point Distance (never a curve target) driven by a NEW,
  // INDEPENDENT parameter (`contour_width`/`contour_height`, plain numbers
  // — never an expression referencing widthIn/heightIn) rather than the
  // board's own pre-existing widthIn/heightIn. `region` here is ALREADY
  // the contour's own inset region (buildSketchManifest passes it in, see
  // that function's own doc comment) — CONTOUR_SIZE_INSET_IN's margin is
  // baked into `region.w`/`region.h` for free, no separate arithmetic here.
  if (widthPairIds) {
    parameters.push({ name: 'contour_width', value: region.w, unit: 'in' });
    dimensions.push({
      type: 'Distance', targets: [`${widthPairIds[0]}:S`, `${widthPairIds[1]}:S`],
      orientation: 'Horizontal', expression: resolveWidthExpr(preset, nameTable),
    });
  }
  if (heightPairIds.length === 2) {
    const [topId, bottomId] = heightPairIds;
    parameters.push({ name: 'contour_height', value: region.h, unit: 'in' });
    dimensions.push({
      type: 'Distance', targets: [`${topId}:S`, `${bottomId}:S`],
      orientation: 'Vertical', expression: 'contour_height',
    });
  }

  // T71 (Fred: "no radius dim though, leave the sketch loose for now"):
  // the shoulder's own Radial dim (corner_radius * half_width) and the
  // waist's own Radial dim (waist_radius, plus the parameter that only
  // ever existed to drive it) are BOTH removed — "no radius dims" means no
  // DIMENSION, not no RELATIONSHIP: the shoulder<->hip Equal stays (every
  // other mirror/same-side Equal in this function does too), just with
  // nothing left driving an actual radius VALUE. Hourglass-only, same
  // disclosed scope as before (bottle's own analogous "neck"/"waist" arcs
  // were never touched by either dim).
  if (preset === 'hourglass' && segments[1]?.style === 'curve' && segments[3]?.style === 'curve') {
    const idx1 = segMap.indexOf(1), idx3 = segMap.indexOf(3);
    constraints.push({ type: 'Equal', targets: [idsByPrimIndex[idx1], idsByPrimIndex[idx3]] });
  }

  return { entities, constraints, parameters, dimensions, groups };
}

function scalePrimitiveToLattice(prim, spacing) {
  const pt = (p) => ({ x: p.x / spacing, y: p.y / spacing });
  if (prim.type === 'L') return { type: 'L', p0: pt(prim.p0), p1: pt(prim.p1) };
  if (prim.type === 'A') {
    return {
      type: 'A', cx: prim.cx / spacing, cy: prim.cy / spacing,
      rx: prim.rx / spacing, ry: prim.ry / spacing, phi: prim.phi, theta1: prim.theta1, dTheta: prim.dTheta,
    };
  }
  return prim;
}

// Mirrors `_resolveExtent`'s own 'board' branch (editor-lattice-pattern.js)
// exactly (same margin/toLattice math), parameterized by an already-
// resolved `region` instead of `editor._mW/_mH` — this module's own "no
// DOM, no editor object" contract (header comment) means it can't call
// the DOM-touching original directly, so the SAME formula is reused here
// rather than a divergent one (not a new algorithm, just its one DOM
// dependency swapped for a plain argument).
function resolveBoardExtent(pattern, region) {
  const spacing = pattern.spacing || PATTERN_DEFAULTS.spacing;
  const margin = pattern.margin ?? PATTERN_DEFAULTS.margin;
  const topLeft = toLattice({ x: region.x, y: region.y }, spacing);
  const bottomRight = toLattice({ x: region.x + region.w, y: region.y + region.h }, spacing);
  return {
    iMin: topLeft.i + margin, jMin: topLeft.j + margin,
    iMax: bottomRight.i - margin, jMax: bottomRight.j - margin,
  };
}

// T68 AMEND 1 (advisor, measured live on the DEFAULT Shape Lattice layer
// — this WORK-LOG's own T61 entry had already disclosed this exact gap
// as "a real, named follow-up, not built this turn"; now built): the
// SAME half-inset the app's own drawing applies before clipping the
// lattice fill (`_effectiveBorderWidth` + `boundary.edge`, editor-
// lattice-pattern.js's own `_resolveBoundaryPrimitives`) — DOM-free here,
// since a GENERATED shape's own drawn boundary element(s) are ALWAYS
// stroked at `widths.rails` (T73: `regenerateSilhouette`'s per-segment
// contour width, "auto = lattice stroke width" per T72 item 6) regardless
// of whether the separate Border FEATURE is enabled; the only way this
// differs from what a live element's own stroke-width would report is an
// EXPLICIT `boundary.border.width` override, which is plain DATA already
// available here, no DOM read needed for it either.
function shapeHalfInset(pattern) {
  // T73 AMEND 3 (Fred: "I need rails to coincide to contour"): a shown
  // contour clips the lattice fill to the contour's own RAW centerline —
  // see usesContourCenterline's own doc comment (editor-lattice-
  // pattern.js) for why this is unconditional (never Border-width-gated)
  // and why "contour hidden" alone keeps today's inset behavior below.
  if (usesContourCenterline(pattern)) return 0;
  const boundary = { ...PATTERN_DEFAULTS.boundary, ...(pattern.boundary || {}) };
  const edge = boundary.edge || PATTERN_DEFAULTS.boundary.edge;
  if (edge === 'centerline') return 0;
  const widths = { ...PATTERN_DEFAULTS.widths, ...(pattern.widths || {}) };
  const borderWidth = (boundary.border && boundary.border.enabled && boundary.border.width != null)
    ? boundary.border.width
    : widths.rails;
  return borderWidth / 2;
}

// Mirrors `_resolveExtent`'s own 'boundary' branch, fed the silhouette's
// OWN primitives directly (already pure, from `generateSilhouette`) rather
// than a live DOM element's — "two tools sharing one engine" (T58 design)
// without the DOM lookup `_resolveBoundaryPrimitives` needs for a
// HAND-PICKED boundary shape. T68: now applies the SAME inward inset
// (editor-lattice-boundary.js, shared with the app's own drawing — "one
// function, never two computations", the advisor's own fix instruction)
// BEFORE scaling to lattice units, so the lattice fill clips against the
// SAME effective boundary the app itself draws against, not the
// silhouette's own raw, un-inset centerline. T72: this function is ONLY
// ever called for a GENERATED preset silhouette (buildSketchManifest's own
// `hasShape` gate) — never a hand-picked boundary — so it uses the
// generated-preset-only `insetGeneratedPresetPathDToPrimitives` (falls
// back to the raw boundary if the inset collapses) rather than the plain
// `insetPathDToPrimitives` a hand-picked shape still uses unchanged.
function resolveShapeBoundaryExtent(pattern, region) {
  const spacing = pattern.spacing || PATTERN_DEFAULTS.spacing;
  const { primitives } = generateSilhouette(region, pattern.shape);
  const halfInset = shapeHalfInset(pattern);
  // T73 AMEND 3: ALWAYS round-trip through the d-string (even at
  // halfInset===0, insetGeneratedPresetPathDToPrimitives's own
  // strokeHalfWidth<=0 branch already reparses from the string rather than
  // returning `primitives` untouched) — the app's OWN equivalent zero-
  // inset path (_resolveBoundaryPrimitives -> insetGeneratedPresetPathDTo-
  // Primitives against the DOM segments' own already-string-rounded `d`
  // attributes) has NO way to reach full floating-point precision either,
  // so skipping this round-trip here ONLY at halfInset===0 would silently
  // reintroduce a real, if tiny, coordinate mismatch between the app and
  // the manifest right at the razor's-edge params (e.g. a deep hourglass
  // waist) where a 0.001in rounding difference decides whether a rail/tie
  // piece exists at all — caught live by the T72 AMEND 5 param sweep.
  const insetPrimitives = insetGeneratedPresetPathDToPrimitives(primitivesToPathD(primitives), halfInset);
  const scaled = insetPrimitives.map((p) => scalePrimitiveToLattice(p, spacing));
  const bbox = primitivesBBox(scaled);
  if (!bbox) return { iMin: 0, jMin: 0, iMax: -1, jMax: -1, mode: 'boundary', primitives: [] };
  return {
    iMin: Math.floor(bbox.xMin), jMin: Math.floor(bbox.yMin),
    iMax: Math.ceil(bbox.xMax), jMax: Math.ceil(bbox.yMax),
    mode: 'boundary', primitives: scaled,
  };
}

/** T64: board-inches (x,y) -> carve-space (x,y) — center the board on the
 *  origin AND flip Y, matching the NET placement the plain-SVG path ends
 *  up with (this module's own header comment explains why the flip has
 *  to be applied explicitly here even though `carveMatrix` itself has no
 *  Y term). `region.w`/`region.h` are the FULL board dimensions
 *  (`boardRegion`'s own `{x:0,y:0,w,h}` contract — region.x/y are always
 *  0 in this codebase, so, matching `carveMatrix`'s own formula, they're
 *  not subtracted here either). */
function toCarvePoint(pt, region) {
  return { x: pt.x - region.w / 2, y: region.h / 2 - pt.y };
}

/** T65 (advisor's own real Fusion run): an ArcCenter's arc, rebuilt AFTER
 *  transform from a NEGATED startAngleDeg/sweepDeg around the transformed
 *  center, measured live as WRONG — centers landed outside the board,
 *  left/right silhouette halves didn't mirror, arc ends didn't meet their
 *  neighbouring line's own end. The angle-negation math itself checks out
 *  by hand for a pure reflection (see T64's own now-superseded comment,
 *  kept in WORK-LOG-lane-b.md T65 for the record) — but re-deriving an
 *  angle representation is an extra step that a subtle sign/convention
 *  mismatch (Fusion's own addByCenterStartSweep sweep-sign convention,
 *  unverified this turn either) can silently break. The advisor's own
 *  fix, applied here: never transform the angles at all. Compute the
 *  arc's own three DEFINING POINTS (start, mid-sweep, end) in the SAME
 *  natural board-space the silhouette generator already built and tested
 *  them in, run each one through the IDENTICAL `toCarvePoint` map lines
 *  and circles already use, and hand the transformed points straight to
 *  Fusion's own addByThreePoints (Python side) — no angle math survives
 *  the flip to get wrong. Mutates the entity's own `type` from
 *  'ArcCenter' to 'Arc3Point' as part of this pass (a real representation
 *  change, not a cosmetic rename): `startAngleDeg`/`sweepDeg`/`radius`
 *  are not carryable through a reflection without risking exactly this
 *  bug, so post-placement the entity is HONESTLY a different shape,
 *  matching fb_engine's own pre-existing "Arc3Point" naming/convention
 *  (geometry.py's _create_arc3) rather than inventing a new name. */
function toCarveArc3Point(e, region) {
  const startRad = (e.startAngleDeg * Math.PI) / 180;
  const midRad = ((e.startAngleDeg + e.sweepDeg / 2) * Math.PI) / 180;
  const endRad = ((e.startAngleDeg + e.sweepDeg) * Math.PI) / 180;
  const [cx, cy] = e.center;
  const raw = (rad) => ({ x: cx + e.radius * Math.cos(rad), y: cy + e.radius * Math.sin(rad) });
  const p1 = toCarvePoint(raw(startRad), region);
  const pMid = toCarvePoint(raw(midRad), region);
  const p2 = toCarvePoint(raw(endRad), region);
  return { id: e.id, type: 'Arc3Point', p1: [p1.x, p1.y], pMid: [pMid.x, pMid.y], p2: [p2.x, p2.y] };
}

/** T64/T65: the ONE final pass that converts an already-built manifest's
 *  own `entities[]` from natural board-inches space into carve-space —
 *  every producer above (`manifestFromLattice`/`manifestFromShape`) keeps
 *  computing in the simpler, natural space it was already written and
 *  tested in; only the FINAL coordinates change. `constraints[]`/
 *  `dimensions[]`/`parameters[]`/`groups` reference entities BY ID, never
 *  by raw coordinate, so none of them need touching — an ArcCenter's own
 *  `:C` (center) suffix still resolves correctly post-mutation, since the
 *  Python builder's own Arc3Point dispatch still tags `arc.centerSketchPoint`
 *  under the same id (see sketch_manifest_builder.py's _create_arc3_entity).
 *  H/V constraint CHOICE for Line/Slot entities (computed earlier, from
 *  natural-space coordinates, by `axisConstraintType`) is unaffected either
 *  way — a reflection that only ever remaps y as a function of y alone
 *  can't turn a horizontal segment into a vertical one or vice versa, so
 *  those constraints stay correct without recomputation. */
function applyCarvePlacement(manifest, region) {
  manifest.entities = manifest.entities.map((e) => {
    if (e.type === 'Line' || e.type === 'Slot') {
      const p1 = toCarvePoint({ x: e.p1[0], y: e.p1[1] }, region);
      const p2 = toCarvePoint({ x: e.p2[0], y: e.p2[1] }, region);
      return { ...e, p1: [p1.x, p1.y], p2: [p2.x, p2.y] };
    } else if (e.type === 'Circle') {
      const c = toCarvePoint({ x: e.center[0], y: e.center[1] }, region);
      return { ...e, center: [c.x, c.y] };
    } else if (e.type === 'ArcCenter') {
      return toCarveArc3Point(e, region);
    } else if (e.type === 'ArcCenterSlot') {
      // T69: the arc-shaped sibling of the Line/Slot branch above — the
      // SAME point-based reflection (never an angle-negation, per T65's
      // own doc comment on toCarveArc3Point), just tagged as a slot
      // afterward, carrying its own `width` through untouched (a plain
      // number, never a coordinate — nothing to transform).
      const arc3 = toCarveArc3Point(e, region);
      return { ...arc3, type: 'Arc3PointSlot', width: e.width };
    }
    return e;
  });
  return manifest;
}

/** T72: drop every parameter entry whose own `name` already appeared
 *  earlier in the list — order-preserving, first occurrence wins. See
 *  `buildSketchManifest`'s own call site for why a genuine duplicate can
 *  occur at all (never a value CHOICE between two disagreeing numbers,
 *  since the one real collision, `stroke_width`, is always declared with
 *  the identical value on both sides). */
function dedupeParametersByName(parameters) {
  const seen = new Set();
  return parameters.filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
}

/**
 * §1's own top-level `buildSketchManifest(pattern, region, opts)` —
 * composes the two producers above exactly like a real Shape Lattice
 * layer does today ("two tools sharing one engine"): when
 * `pattern.shape.source === 'generated'`, the lattice fill clips to the
 * silhouette's own boundary (via `resolveShapeBoundaryExtent`) AND the
 * silhouette's own entities are included; otherwise (a plain "box"
 * Lattice layer) the lattice fill runs board-wide. `opts.layerId`/
 * `opts.sketchName` are diagnostic-only passthroughs (§1's own schema).
 * T64: the returned manifest's own `entities[]` are in CARVE space (see
 * `applyCarvePlacement`), not the natural board-inches space the two
 * producers above compute in internally.
 */
export function buildSketchManifest(pattern, region, opts = {}) {
  // PATTERN_DEFAULTS.shape.source defaults to 'generated' UNCONDITIONALLY
  // (editor-lattice-pattern.js) — every pattern carries a `.shape`
  // sub-object, even a plain box Lattice layer that has never touched the
  // Shape Lattice tool, so `.shape.source` ALONE can't distinguish "this
  // is really a Shape Lattice layer" from "this field's own default is
  // sitting there unused". T72: this exact two-part check (source ===
  // 'generated' AND extent.mode === 'boundary', set ONLY once Generate has
  // actually run) is now the shared `hasGeneratedSilhouette`
  // (editor-lattice-pattern.js) — properties-shape-lattice.js's own
  // `paramHandleRecords` needed the identical signal (AMEND 2's own
  // floating-handles bug), so it's declared once rather than kept as two
  // copies of the same condition.
  const hasShape = hasGeneratedSilhouette(pattern);
  const widthMode = hasShape ? SKETCH_WIDTH_MODE.shapeLattice : SKETCH_WIDTH_MODE.boxLattice;
  // T71: the contour's own region is the board region INSET by the
  // declared contour-size margin (editor-lattice-boundary.js's own
  // `insetRegionForContour`, the SAME helper `regenerateSilhouette` uses
  // on the app side) — both the lattice-fill's own clip boundary
  // (`resolveShapeBoundaryExtent`) AND the contour's own entities
  // (`manifestFromShape`) build from this ONE inset region, so the fill
  // never pokes past the new, smaller contour, and the contour's own
  // `contour_width`/`contour_height` parameter values (region.w/region.h,
  // read inside `manifestFromShape`) land at board-minus-margin for free.
  // `manifest.region` below and `applyCarvePlacement` both keep using the
  // ORIGINAL, un-inset `region` — carve placement centers the WHOLE BOARD,
  // not just the contour.
  const contourRegion = hasShape ? insetRegionForContour(region) : region;
  const extent = hasShape ? resolveShapeBoundaryExtent(pattern, contourRegion) : resolveBoardExtent(pattern, region);
  const lattice = manifestFromLattice(pattern, extent, widthMode);
  // T69: the contour's own slot width matches the layer's own REAL
  // rails/ties width (`pattern.widths.rails`, merged over
  // PATTERN_DEFAULTS.widths the SAME way manifestFromLattice's own
  // `widths` local already does) — "same param as rails/ties" (the
  // dispatch's own instruction), not manifestFromShape's own no-pattern-
  // visibility fallback default.
  const widths = { ...PATTERN_DEFAULTS.widths, ...(pattern.widths || {}) };
  // T72 (SE14c, Fred: "sometimes don't want the contour profile"): OFF
  // (`pattern.contour.show === false`) suppresses ONLY the contour's own
  // manifest entities/constraints/dimensions/parameters (no contour slots,
  // no contour_width/height) — `extent`/`lattice` above are computed
  // UNCONDITIONALLY, so rails/ties still clip/fit to the SAME boundary
  // either way. A saved pattern with no `contour` key reads `show: true`
  // via the same merge every other field already uses.
  const contourVisible = hasShape && ({ ...PATTERN_DEFAULTS.contour, ...(pattern.contour || {}) }).show !== false;
  const contourWidthMode = contourVisible ? SKETCH_CONTOUR_WIDTH_MODE : null;
  const shape = contourVisible
    ? manifestFromShape(pattern.shape, contourRegion, { widthMode: contourWidthMode, strokeWidth: widths.rails })
    : { entities: [], constraints: [], parameters: [], dimensions: [], groups: {} };

  const manifest = {
    version: 1,
    widthMode,
    contourWidthMode,
    layerId: opts.layerId ?? null,
    sketchName: opts.sketchName || 'Sketch',
    units: 'in',
    region: { x: region.x, y: region.y, w: region.w, h: region.h },
    entities: [...shape.entities, ...lattice.entities],
    constraints: [...shape.constraints, ...lattice.constraints],
    // T72 (advisor, measured on 8566623): `stroke_width` was declared
    // TWICE when a shape's own contour and its lattice fill are BOTH
    // linked to the SAME name — `manifestFromShape` always declares its
    // own (T69's own doc comment: "this function has no visibility into
    // [the lattice's link] state at all, so it always declares its own,
    // by name"), and `manifestFromLattice` ALSO declares it whenever
    // rails/ties are linked. Both sides always carry the identical
    // value (the SAME `widths.rails` this function just merged above), so
    // "keep the first occurrence, by name" is a safe, declared dedup —
    // never a value CHOICE between two disagreeing numbers.
    parameters: dedupeParametersByName([...shape.parameters, ...lattice.parameters]),
    dimensions: [...shape.dimensions, ...lattice.dimensions],
    groups: { ...shape.groups, ...lattice.groups },
    latticePieceCount: lattice.pieceCount,
    latticeConstrained: lattice.constrained,
  };
  return applyCarvePlacement(manifest, region);
}
