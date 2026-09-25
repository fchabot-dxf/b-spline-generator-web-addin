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
 */
import { computePattern, PATTERN_DEFAULTS } from './editor-lattice-pattern.js';
import { toLattice, fromLattice } from './editor-lattice.js';
import { primitivesBBox } from './editor-lattice-boundary.js';
import { generateSilhouette } from './editor-shape-lattice-generator.js';
import { mirrorSegmentIndex, primitiveSegmentMap } from './editor-shape-lattice-interaction.js';

/** §6: below this many rails+ties+nodes, every piece gets its own H/V +
 *  tie-on-rail Coincident constraints; at/above it, entities only (still
 *  real, selectable Line/Circle geometry, just unconstrained beyond what
 *  the entity itself implies) — the width/offset/cap mechanism (§4) runs
 *  identically either way (§6: "not a separate code path, the SAME one,
 *  just with the per-piece relationship constraints skipped"). Value per
 *  the advisor's own live Fusion measurement (SE15-CONSTRAINED-SKETCH-
 *  DESIGN.md, "Answers" §3: "100 rails x 2 offsets = 20.6s... threshold
 *  default: 60 pieces constrained; above -> plain geometry"), not guessed
 *  here — a declared constant, not a magic number inline (§6's own bar).
 */
export const SKETCH_PIECE_THRESHOLD = 60;

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

/** §4: one round cap centered at `center` (a piece's own endpoint),
 *  bulging AWAY from `otherEnd` (the piece's own OTHER end) — sweep
 *  exactly 180 degrees, matching a `linecap:'round'` stroke end (the SAME
 *  visual convention `emitSegment`, editor-lattice.js, already draws by
 *  hand). Derivation (verified by hand against a horizontal test case,
 *  WORK-LOG-lane-b.md T61): with d = otherEnd-center and thetaD =
 *  atan2(d.y,d.x), starting the arc at thetaD+90deg and sweeping +180deg
 *  always passes through thetaD+180deg — the direction exactly opposite
 *  the piece body — reusing the SAME "a chord of length===diameter is a
 *  diameter, its center is the chord's own midpoint" fact editor-shape-
 *  lattice-generator.js's own _arcPrimitive/_bulgeFromRadius (T55) already
 *  use for a different piece of geometry (a silhouette bulge, not a line
 *  cap), ported here rather than re-derived from scratch. */
function capArc(id, center, otherEnd, radius) {
  const thetaD = Math.atan2(otherEnd.y - center.y, otherEnd.x - center.x);
  const startAngleDeg = ((thetaD + Math.PI / 2) * 180) / Math.PI;
  return { id, type: 'ArcCenter', center: [center.x, center.y], radius, startAngleDeg, sweepDeg: 180 };
}

/** §4: width offsets — TWO per centerline group (one `+width/2`, one
 *  `-width/2`), per the advisor's own live-Fusion measurement that a
 *  single open line needs one `sketch.offset` call PER SIDE ("Answers"
 *  §1+2: "ONE side per call -> two calls per centerline") — plus one pair
 *  of round-cap ArcCenter entities PER PIECE (always emitted, regardless
 *  of the §6 threshold — see this module's own header). `pieces` is
 *  `[{id, p1, p2}]` (model-inch Line endpoints); mutates `entities`/
 *  `dimensions` in place (both are plain arrays the caller already owns —
 *  same "small pure helper over shared arrays" shape `computePattern`'s
 *  own `addNode` closure already uses). */
function addWidthOffsetsAndCaps(entities, dimensions, pieces, kindPrefix, paramName, widthValue) {
  if (!pieces.length) return;
  const ids = pieces.map((p) => p.id);
  dimensions.push({ type: 'Offset', targets: ids, expression: `${paramName} / 2`, id: `${kindPrefix}_offset_pos` });
  dimensions.push({ type: 'Offset', targets: ids, expression: `-(${paramName} / 2)`, id: `${kindPrefix}_offset_neg` });
  const capRadius = widthValue / 2;
  for (const { id, p1, p2 } of pieces) {
    const capA = capArc(`${id}_capA`, p1, p2, capRadius);
    const capB = capArc(`${id}_capB`, p2, p1, capRadius);
    entities.push(capA, capB);
    dimensions.push({ type: 'Radial', target: capA.id, expression: `${paramName} / 2` });
    dimensions.push({ type: 'Radial', target: capB.id, expression: `${paramName} / 2` });
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
export function manifestFromLattice(pattern, extent) {
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

  const railPieces = [];
  railsCanon.forEach((seg, idx) => {
    const id = toEntityId('rail', idx);
    const p1 = fromLattice(seg.a, spacing), p2 = fromLattice(seg.b, spacing);
    entities.push({ id, type: 'Line', p1: [p1.x, p1.y], p2: [p2.x, p2.y] });
    groups.rails.push(id);
    railPieces.push({ id, p1, p2 });
    if (constrained) {
      const axis = axisConstraintType(p1, p2);
      if (axis) constraints.push({ type: axis, targets: [id] });
    }
  });

  const tiePieces = [];
  tiesCanon.forEach((seg, idx) => {
    const id = toEntityId('tie', idx);
    const p1 = fromLattice(seg.a, spacing), p2 = fromLattice(seg.b, spacing);
    entities.push({ id, type: 'Line', p1: [p1.x, p1.y], p2: [p2.x, p2.y] });
    groups.ties.push(id);
    tiePieces.push({ id, p1, p2 });
    if (constrained) {
      const axis = axisConstraintType(p1, p2);
      if (axis) constraints.push({ type: axis, targets: [id] });
      // "tie-end-on-rail" (ROADMAP.md:765) — a plain equality check on the
      // already-computed lattice coordinates, §3's own doc comment; no
      // geometric search needed.
      ['a', 'b'].forEach((end) => {
        const railIdx = railsCanon.findIndex((r) => pointOnLatticeSegment(seg[end], r));
        if (railIdx >= 0) {
          const suffix = end === 'a' ? 'S' : 'E';
          constraints.push({ type: 'Coincident', targets: [`${id}:${suffix}`, toEntityId('rail', railIdx)] });
        }
      });
    }
  });

  nodePoints.forEach((pt, idx) => {
    const id = toEntityId('node', idx);
    const p = fromLattice(pt, spacing);
    entities.push({ id, type: 'Circle', center: [p.x, p.y], radius: widths.nodeRadius });
    groups.nodes.push(id);
  });

  if (railPieces.length) {
    parameters.push({ name: 'rail_width', value: widths.rails, unit: 'in' });
    addWidthOffsetsAndCaps(entities, dimensions, railPieces, 'rail', 'rail_width', widths.rails);
  }
  if (tiePieces.length) {
    parameters.push({ name: 'tie_width', value: widths.ties, unit: 'in' });
    addWidthOffsetsAndCaps(entities, dimensions, tiePieces, 'tie', 'tie_width', widths.ties);
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

/**
 * §3's own `_manifestFromShape` — `shape` (a layer's own
 * `PATTERN.shape` object, `generateSilhouette`'s own 2nd arg) + `region`
 * (`{x,y,w,h}`, model inches, `generateSilhouette`'s own 1st arg) ->
 * `{entities, constraints, parameters, dimensions, groups}`. Pure: calls
 * `generateSilhouette` (unchanged) then walks its own `primitives` list —
 * the SAME flat list `primitivesToPathD` already walks — building one
 * manifest entity per primitive.
 */
export function manifestFromShape(shape, region) {
  const result = generateSilhouette(region, shape);
  const { preset, segments, primitives, params } = result;
  const n = segments.length;
  const segMap = primitiveSegmentMap(segments);

  const entities = [];
  const constraints = [];
  const groups = { silhouette: [] };

  const idsByPrimIndex = primitives.map((prim, i) => {
    const id = toEntityId('seg', i);
    if (prim.type === 'L') {
      entities.push({ id, type: 'Line', p1: [prim.p0.x, prim.p0.y], p2: [prim.p1.x, prim.p1.y] });
      const axis = axisConstraintType(prim.p0, prim.p1);
      if (axis) constraints.push({ type: axis, targets: [id] });
    } else {
      // rx===ry, phi===0 always — T58's own established, tested invariant
      // (this module's own header + editor-shape-lattice-generator.js's
      // own primitivesToPathD doc comment).
      entities.push({
        id, type: 'ArcCenter', center: [prim.cx, prim.cy], radius: prim.rx,
        startAngleDeg: (prim.theta1 * 180) / Math.PI, sweepDeg: (prim.dTheta * 180) / Math.PI,
      });
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
  const m = primitives.length;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const idA = idsByPrimIndex[i], idB = idsByPrimIndex[j];
    constraints.push({ type: 'Coincident', targets: [`${idA}:E`, `${idB}:S`] });
    const isKinkJoint = segments[segMap[i]].style === 'kink' || segments[segMap[j]].style === 'kink';
    const eitherArc = primitives[i].type === 'A' || primitives[j].type === 'A';
    if (eitherArc && !isKinkJoint) constraints.push({ type: 'Tangent', targets: [idA, idB] });
  }

  // Mirror-Equal (§2's own "every right-side entity <-> its LEFT mirror"):
  // ONLY between segments that produce exactly ONE primitive each — a
  // disclosed scope-narrowing (WORK-LOG-lane-b.md T61): a kink's own
  // 2-primitive mirror pairing (which of its 2 lines pairs with which of
  // its mirror's 2 lines) isn't verified this turn, so it's skipped
  // rather than guessed. Reuses `mirrorSegmentIndex` (T59) directly, not
  // a second mirror-index formula.
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const mi = mirrorSegmentIndex(i, n);
    if (mi === i || seen.has(i) || seen.has(mi)) continue;
    seen.add(i); seen.add(mi);
    const primIdxI = segMap.indexOf(i), primIdxMi = segMap.indexOf(mi);
    const countI = segMap.filter((s) => s === i).length;
    const countMi = segMap.filter((s) => s === mi).length;
    if (countI !== 1 || countMi !== 1) continue;
    constraints.push({ type: 'Equal', targets: [idsByPrimIndex[primIdxI], idsByPrimIndex[primIdxMi]] });
  }

  const nameTable = PARAM_FUSION_NAMES[preset] || {};
  const parameters = Object.entries(params).map(([key, value]) => ({
    name: nameTable[key] || key, value, unit: null,
  }));
  parameters.push({ name: 'half_width', value: region.w / 2, unit: 'in' });

  const dimensions = [];
  // Hourglass-only, §4's own "a FEW driving dimensions" example (§1):
  // the shoulder arc's own radius, driven by corner_radius * half_width —
  // ONLY when segment 1 is still a real arc (not overridden away from
  // 'curve'), since a kink/straight override has no "radius" to drive.
  // The shoulder<->hip Equal declared above (mirror pass ties 1<->9,
  // 3<->7) is completed into ONE group by this same gate adding 1<->3.
  if (preset === 'hourglass' && segments[1]?.style === 'curve' && segments[3]?.style === 'curve') {
    const idx1 = segMap.indexOf(1), idx3 = segMap.indexOf(3);
    constraints.push({ type: 'Equal', targets: [idsByPrimIndex[idx1], idsByPrimIndex[idx3]] });
    dimensions.push({ type: 'Radial', target: idsByPrimIndex[idx1], expression: 'corner_radius * half_width' });
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

// Mirrors `_resolveExtent`'s own 'boundary' branch, fed the silhouette's
// OWN primitives directly (already pure, from `generateSilhouette`) rather
// than a live DOM element's — "two tools sharing one engine" (T58 design)
// without the DOM lookup `_resolveBoundaryPrimitives` needs for a
// HAND-PICKED boundary shape. Disclosed scope-narrowing (WORK-LOG-lane-b.md
// T61): this clips the lattice fill to the silhouette's own RAW centerline,
// not the Border-enabled inner-stroke inset `_resolveBoundaryPrimitives`
// applies for a live layer — full border-aware clipping here is a real,
// named follow-up, not built this turn.
function resolveShapeBoundaryExtent(pattern, region) {
  const spacing = pattern.spacing || PATTERN_DEFAULTS.spacing;
  const { primitives } = generateSilhouette(region, pattern.shape);
  const scaled = primitives.map((p) => scalePrimitiveToLattice(p, spacing));
  const bbox = primitivesBBox(scaled);
  if (!bbox) return { iMin: 0, jMin: 0, iMax: -1, jMax: -1, mode: 'boundary', primitives: [] };
  return {
    iMin: Math.floor(bbox.xMin), jMin: Math.floor(bbox.yMin),
    iMax: Math.ceil(bbox.xMax), jMax: Math.ceil(bbox.yMax),
    mode: 'boundary', primitives: scaled,
  };
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
 */
export function buildSketchManifest(pattern, region, opts = {}) {
  // PATTERN_DEFAULTS.shape.source defaults to 'generated' UNCONDITIONALLY
  // (editor-lattice-pattern.js) — every pattern carries a `.shape`
  // sub-object, even a plain box Lattice layer that has never touched the
  // Shape Lattice tool, so `.shape.source` ALONE can't distinguish "this
  // is really a Shape Lattice layer" from "this field's own default is
  // sitting there unused". The real app's own discriminator (per that
  // file's own comment) is `PATTERN.extent.mode === 'boundary'` — set ONLY
  // when the Shape Lattice tool's own Generate has actually run and linked
  // a silhouette — reused here rather than inventing a second flag.
  const hasShape = !!(pattern.shape && pattern.shape.source === 'generated' && pattern.extent && pattern.extent.mode === 'boundary');
  const extent = hasShape ? resolveShapeBoundaryExtent(pattern, region) : resolveBoardExtent(pattern, region);
  const lattice = manifestFromLattice(pattern, extent);
  const shape = hasShape
    ? manifestFromShape(pattern.shape, region)
    : { entities: [], constraints: [], parameters: [], dimensions: [], groups: {} };

  return {
    version: 1,
    layerId: opts.layerId ?? null,
    sketchName: opts.sketchName || 'Sketch',
    units: 'in',
    region: { x: region.x, y: region.y, w: region.w, h: region.h },
    entities: [...shape.entities, ...lattice.entities],
    constraints: [...shape.constraints, ...lattice.constraints],
    parameters: [...shape.parameters, ...lattice.parameters],
    dimensions: [...shape.dimensions, ...lattice.dimensions],
    groups: { ...shape.groups, ...lattice.groups },
    latticePieceCount: lattice.pieceCount,
    latticeConstrained: lattice.constrained,
  };
}
