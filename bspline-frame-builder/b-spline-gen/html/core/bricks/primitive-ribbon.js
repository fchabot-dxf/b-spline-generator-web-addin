/**
 * core/bricks/primitive-ribbon.js — PORTABLE (see rng.js). H23 item 76 (advisor, 4th architecture
 * after THREE reverted attempts at patching bricksAlongPath's own centreline/corner machinery to
 * handle an infeasible fillet -- see WORK-LOG's own "collapse-infeasible-fillet-to-corner, THREE
 * attempts, all reverted" entry): build EACH ROW's own bricks directly from the ORIGINAL template
 * primitives (lines + true circular arcs) plus that row's own [d0,d1] depth range -- never by
 * compounding `offsetPathInward`/`bricksAlongPath` through a PREVIOUSLY offset polyline. "No band
 * depends on the previous band's polyline, only on the original primitives + d" (advisor). This is
 * what finally sidesteps the compounding-error-through-a-degenerate-region class of bug that broke
 * all three prior attempts -- every row is independent and exact, derived straight from the
 * template's own declared geometry.
 *
 *   ribbonPieces(primitives, d0, d1, set, orientation, pitch, nominalJoint, seed, pieceId, startId) -> { pieces, nextId }
 *
 * `primitives`: the CLOSED loop's own ordered list, each either
 *   `{ type: 'line', p0, p1, nx, ny }` (nx,ny = the TRUE inward unit normal, precomputed once by the
 *   caller from the whole path's own global inward sign -- same convention `radialSignAt` uses) or
 *   `{ type: 'arc', cx, cy, r, theta1, theta2, radialSign }` (depth-0 centre/radius/angles, same
 *   shape arc-voussoir.js's own callers already build).
 *
 * Per primitive, offset ANALYTICALLY: a line shifts along its own fixed `nx,ny` by `d`; a circle's
 * radius becomes `r - radialSign*d` (same convention as radialSignAt -- offsetting a circle never
 * moves its centre, only its radius). A convex arc whose radius at `d1` (this row's own deepest
 * edge) has shrunk past feasible DROPS OUT of this row entirely (isArcFeasible, reused from
 * arc-voussoir.js, never duplicated). Every JOINT between two consecutive LIVE primitives -- a
 * genuine template corner, OR one newly exposed because something between them dropped out -- gets
 * a TRUE mitre line: `o` = the two neighbours' own d0-offset curves intersected, `q` = the same at
 * d1 (curve-intersect.js's own closed-form line/circle intersections, nearest-root-to-the-original-
 * junction). End pieces on either side are built OVERSIZED then clipped to the (o,q) line -- the
 * SAME half-plane mitre technique along-path.js already uses for declared corners, applied
 * generally to every live-live joint instead of only pre-declared ones.
 *
 * H23 item 76 cont. (advisor review, "trimmed only by the real board outline"): at a joint where a
 * primitive dropped out, `o` (computed by skipping straight to the far neighbour) is FICTITIOUS
 * whenever the dropped primitive is still feasible at d0 (`trustO:false` on that joint) -- both
 * `linePieces` and `voussoirPieces` then plan and build that run PLAIN, `q`-based only, same as an
 * ordinary corner (see their own headers for why reaching further themselves, toward the dropped
 * primitive's own true tangent point, isn't safe in general). The real board outline there -- the
 * dropped primitive's own TRUE arc, plus the flat/curved strip on each neighbour's own d0 edge out to
 * its own tangent point with that arc -- is `buildPatch`'s own separate, independently-sized piece(s),
 * collected into `pieces` right after whichever primitive owns that joint as its own `jointEnd`
 * (preserving build-order == walk-order, which other code relies on).
 */
import { curveIntersection, lineLineIntersection } from './curve-intersect.js';
import { clipToHalfPlane, signedArea } from './geometry.js';
import { planCornerRun, mergeSlivers, pickSample } from './piece-plan.js';
import { isArcFeasible, voussoirPieces } from './arc-voussoir.js';
import { FILL_FRACTIONS, brickSetById } from './library.js';
import { mulberry32, seedFor } from './rng.js';

function offsetPrimitive(prim, d) {
  if (prim.type === 'line') {
    return {
      type: 'line',
      p0: { x: prim.p0.x + prim.nx * d, y: prim.p0.y + prim.ny * d },
      p1: { x: prim.p1.x + prim.nx * d, y: prim.p1.y + prim.ny * d },
    };
  }
  return { type: 'arc', cx: prim.cx, cy: prim.cy, r: prim.r - prim.radialSign * d, theta1: prim.theta1, theta2: prim.theta2 };
}

function toCurve(offsetPrim) {
  if (offsetPrim.type === 'line') {
    const dx = offsetPrim.p1.x - offsetPrim.p0.x, dy = offsetPrim.p1.y - offsetPrim.p0.y, len = Math.hypot(dx, dy) || 1;
    return { type: 'line', p0: offsetPrim.p0, dir: { x: dx / len, y: dy / len } };
  }
  return { type: 'circle', c: { x: offsetPrim.cx, y: offsetPrim.cy }, r: offsetPrim.r };
}

function primitiveLiveAtDepth(prim, d1) {
  // isArcFeasible(r, radialSign, halfWidth) checks `r - radialSign*halfWidth > floor` -- passing
  // `d1` in the `halfWidth` slot gives exactly `r - radialSign*d1`, this primitive's own radius at
  // its row's deepest edge, the SAME quantity the advisor's own "r-d1 <= grout" check describes.
  return prim.type === 'line' || isArcFeasible(prim.r, prim.radialSign, d1);
}

function originalJunctionPoint(prim) {
  return prim.type === 'line' ? prim.p1 : { x: prim.cx + prim.r * Math.cos(prim.theta2), y: prim.cy + prim.r * Math.sin(prim.theta2) };
}

/** The TRUE (mitred) joint point between two consecutive LIVE primitives, at a given depth -- their
 *  own offset-at-`depth` curves intersected, nearest the original (depth-0) junction. Shared by
 *  `ribbonPieces` (needs it at both a row's own d0 and d1, to build the mitre LINE between them) and
 *  `boundaryAtDepth` (needs it at one depth, to build the TRUE offset boundary polyline) -- the same
 *  computation either way, never duplicated. */
function jointPointAt(primitives, prevIdx, curIdx, depth) {
  const ref = originalJunctionPoint(primitives[prevIdx]);
  return curveIntersection(
    toCurve(offsetPrimitive(primitives[prevIdx], depth)),
    toCurve(offsetPrimitive(primitives[curIdx], depth)),
    ref,
  );
}

function mitreLine(o, q, keepRefAsStart, keepRefAsEnd) {
  const dx = q.x - o.x, dy = q.y - o.y, len = Math.hypot(dx, dy);
  if (len < 1e-9) return null; // o and q coincide (a degenerate zero-depth row) -- no meaningful mitre direction, so no clip
  // `q` (the joint's own point at this row's DEEPEST edge, d1) is kept on the returned object, not
  // just folded into dirX/dirY -- H23 item 76 (advisor review): `linePieces`/`voussoirPieces` both
  // need `q` ITSELF (not just the mitre line's direction) to measure this run's own TRUE reach to
  // the corner (see `planCornerRun`'s own header for why: the deep edge is this row's own worst-case
  // reach, the same measure the mitreReach fix already established).
  return { point: o, q, dirX: dx / len, dirY: dy / len, keepRefAsStart, keepRefAsEnd };
}

const KEEP_REF_STEP_IN = 0.01; // H23 item 76: how far past `o` (this joint's own point at depth d0)
// the clip-side reference point sits, walking along a primitive's OWN tangent AT `o` -- NOT a fixed
// step from that primitive's own UNOFFSET start/end point. MEASURED: those only coincide with `o`
// when d0=0 (the original, un-offset depth) -- for a DEEPER row (d0>0), each primitive's own p0/p1
// shifts by its OWN normal*d0 independently, landing somewhere DIFFERENT from where the two offset
// lines actually cross (`o` itself); a reference point "near the primitive's own old start" is then
// nowhere near the joint any more and can land on the wrong side (CONFIRMED: broke every row except
// the outermost, d0=0, one). Stepping from `o` itself along each primitive's own local tangent
// there stays correct at any depth, since `o` IS always the joint's own point at this exact depth.
function tangentAt(prim, point) {
  if (prim.type === 'line') {
    const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y, len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }
  const theta = Math.atan2(point.y - prim.cy, point.x - prim.cx);
  const direction = Math.sign(prim.theta2 - prim.theta1) || 1;
  return { x: -Math.sin(theta) * direction, y: Math.cos(theta) * direction };
}
function stepFrom(point, tangent, signedStep) {
  return { x: point.x + tangent.x * signedStep, y: point.y + tangent.y * signedStep };
}

const BUTT_PARALLEL_DOT = 0.999; // H23 item 76 cont. (butt corner): tangents this close to parallel
// (|dot| >= this) aren't a genuine corner at all -- a straight run split across two primitives, or a
// smooth continuation -- so there's no "through" vs "butt" side to pick; falls back to the ordinary
// mitre, which degenerates harmlessly to a near-straight seam on its own at this angle anyway.

/**
 * T86 item 1 (Fred's sketch, shots/fred/fred_sketch_butt_corner.jpg): the BUTT corner style, built
 * per the architecture plan this item inherited (WORK-LOG's own "H23 item 76 cont. -- butt corner"
 * entry) -- a line-line corner is NOT symmetric like a mitre: the "through" primitive (whichever of
 * the two is MORE horizontal at the corner, `|tangent.x|` closer to 1 -- "through=horizontal" per the
 * sketch, or the OPPOSITE when `flipThrough` is set -- see below) runs uninterrupted to its own
 * natural endpoint; the "butt" primitive (the other one) gets a SQUARE cut (perpendicular to ITS OWN
 * tangent, never the mitre bisector) against the through band's own d1 (inner) edge, with one grout
 * gap between the butt band's cut end and that inner face.
 *
 * T86 item 1, LAPPED (advisor's own decision, turn 291): LAPPED is this exact SAME construction with
 * one difference -- which side is "through" ALTERNATES by band index (band 0 horizontal-through, band
 * 1 vertical-through, band 2 horizontal-through, ...), so a multi-band frame's own bands interlock at
 * each corner like courses in a real lapped corner (a single-band lapped frame is identical to BUTT,
 * by construction -- `flipThrough` false on band 0 either way). `flipThrough` is the caller's own
 * `bandIndex % 2 === 1`, decided in `ribbonPieces`, never guessed here.
 *
 * Returns `null` when there's no well-defined square cut (the two tangents are parallel, or the
 * through/butt lines don't meet) -- the caller falls back to the ordinary symmetric mitre, same as
 * the already-declared "arc-involved corners fall back to mitre" rule (this function is only ever
 * tried for a line-line corner to begin with; see its own caller).
 */
function buildButtJoint(primitives, prevIdx, curIdx, o, d1, nominalJoint, flipThrough) {
  const tPrev = tangentAt(primitives[prevIdx], o);
  const tCur = tangentAt(primitives[curIdx], o);
  if (Math.abs(tPrev.x * tCur.x + tPrev.y * tCur.y) >= BUTT_PARALLEL_DOT) return null; // not a genuine corner
  const prevMoreHorizontal = Math.abs(tPrev.x) >= Math.abs(tCur.x);
  const throughIdx = (prevMoreHorizontal !== !!flipThrough) ? prevIdx : curIdx;
  const buttIdx = throughIdx === prevIdx ? curIdx : prevIdx;
  const through = primitives[throughIdx], butt = primitives[buttIdx];
  const buttTangent = tangentAt(butt, o); // depth-independent for a line primitive
  const throughD1 = offsetPrimitive(through, d1); // through's own INNER edge, this row's own d1
  const cut0 = lineLineIntersection(
    { x: throughD1.p0.x, y: throughD1.p0.y }, { x: throughD1.p1.x - throughD1.p0.x, y: throughD1.p1.y - throughD1.p0.y },
    o, buttTangent,
  );
  if (!cut0) return null; // the through band's own d1 edge runs parallel to the butt primitive -- degenerate, fall back to mitre
  // one grout gap, stepping AWAY from the corner along the butt primitive's own tangent (whichever
  // sign that is -- `cut0` can land either side of `o` depending on the corner's own geometry).
  const awaySign = Math.sign((cut0.x - o.x) * buttTangent.x + (cut0.y - o.y) * buttTangent.y) || 1;
  const cutPoint = stepFrom(cut0, buttTangent, nominalJoint * awaySign);
  const keepRef = stepFrom(cutPoint, buttTangent, awaySign); // further into the butt band's own run
  const square = { point: cutPoint, q: cutPoint, dirX: butt.nx, dirY: butt.ny, keepRefAsStart: keepRef, keepRefAsEnd: keepRef, trustO: true };
  // `forThrough` is NOT literal `null`: `linePieces`' own CLIP_EPS_IN safety-margin extension fires
  // whenever a side has no joint at all (the genuinely-open-path-end case, assumed harmless there --
  // MEASURED here that it is NOT harmless for a real closed-contour corner: it pushed the through
  // band's own end 0.02in past the true board edge, since there is no mitre to clip back to). A
  // `trustO:false` sentinel whose own `q` is `o` itself (this joint's own d0 point, which for the
  // THROUGH primitive genuinely IS one of its own unoffset endpoints) reuses the EXISTING
  // dropped-primitive "skip the extension AND the clip, the patch/outline owns this edge" path
  // instead -- `project(o)` is exactly 0 or totalLen either way (perpendicular offsetting never
  // changes a point's own tangential projection), so `sStart`/`sEnd` land exactly on the primitive's
  // own true endpoint, not past it.
  const throughSentinel = { point: o, q: o, dirX: 0, dirY: 0, keepRefAsStart: o, keepRefAsEnd: o, trustO: false };
  return { throughIdx, forThrough: throughSentinel, forButt: square, isButt: true };
}

/** Resolve a `jointBefore` entry to the object a specific primitive (`idx`) should actually clip
 *  against. An ordinary (mitre) joint is returned as-is, read identically by both its neighbours
 *  (today's established symmetric convention). A butt joint (`.isButt`) is asymmetric: the through
 *  primitive gets its own `trustO:false` sentinel (no clip, no CLIP_EPS_IN extension either -- runs
 *  to its own exact natural endpoint, see `buildButtJoint`'s own header), the butt primitive gets
 *  the square-cut line -- same object either way regardless of whether `idx` is this joint's own
 *  `prevIdx` or `curIdx`, since `buildButtJoint` already set both `keepRefAsStart`/`keepRefAsEnd` to
 *  the one physically-correct reference point for that single primitive. A block joint (`.isBlock`,
 *  `buildBlockJoint` below) is a DIFFERENT kind of asymmetric: unlike butt, BOTH sides get their own
 *  independent square cut (there's no "through" side), so it carries `forPrev`/`forCur` directly
 *  instead of a through/butt pair -- `idx` picks whichever this joint's own `prevIdx`/`curIdx` it is. */
function jointFor(joint, idx) {
  if (!joint) return joint;
  if (joint.isButt) return idx === joint.throughIdx ? joint.forThrough : joint.forButt;
  if (joint.isBlock) return idx === joint.prevIdx ? joint.forPrev : joint.forCur;
  return joint;
}

const QUOIN_SET = brickSetById(3); // "White rocks" (library.js:181) -- already declared for exactly
// this purpose (its own comment: "this item's own earlier Set-3 comment already earmarked THIS slot
// for exactly this ashlar/stone follow-up"). `ribbonPieces`/`contour-bands.js` never read
// `set.shape`/`set.layout` (grepped: no hits) -- only `brickLengthIn`/grout/samples/heightProfile,
// which this pipeline already knows how to use for a plain piece, so the quoin block is built the
// SAME way every other piece here is, no fieldstone/Voronoi engine needed.

/**
 * T86 item 1, BLOCK (dispatch: "one solid corner unit from the White rocks set; each band butts
 * square into its faces (quoin look)"): unlike BUTT/LAPPED (one through, one butt), BOTH primitives
 * get the SAME treatment -- a square cut (perpendicular to EACH primitive's own tangent) one full
 * `blockSize` back from the true corner (`blockSize` = the White rocks set's own declared
 * `brickLengthIn`, its own unit size, independent of whichever set the surrounding band itself
 * uses). The resulting `blockSize x blockSize` square pocket, anchored at the TRUE outer corner (a
 * real quoin unit's own natural depth equals its own face size, not the surrounding row's `d1-d0` --
 * see WORK-LOG's own "one real open question" entry, resolved this way as the simpler, more literal
 * "solid corner unit" reading), is the block's own piece, built directly here and collected the same
 * way a `kiteFan` already is.
 *
 * Returns `null` for the same reason `buildButtJoint` does (parallel tangents, no genuine corner).
 * Returns the block's own PLAIN POLYGON only -- no id/sample assigned here (this runs inside the
 * `jointBefore` map, before the main per-primitive loop's own `nextId` counter exists; the main loop
 * builds the actual piece from `blockPolygon`, the exact same deferred pattern `kiteFan` already
 * uses, for the exact same reason: an id assigned here could collide with one the main loop hands
 * out later).
 */
function buildBlockJoint(primitives, prevIdx, curIdx, o, nominalJoint) {
  const tPrev = tangentAt(primitives[prevIdx], o);
  const tCur = tangentAt(primitives[curIdx], o);
  if (Math.abs(tPrev.x * tCur.x + tPrev.y * tCur.y) >= BUTT_PARALLEL_DOT) return null;
  const blockSize = QUOIN_SET.brickLengthIn;
  const prevPrim = primitives[prevIdx], curPrim = primitives[curIdx];
  // The block's OWN face sits exactly `blockSize` from the corner (a quoin unit's own declared size,
  // unaffected by grout). The SURROUNDING band's own cut stops `nominalJoint` further out still,
  // leaving a real mortar-width gap between the block's own face and the band's own first piece --
  // same convention `buildButtJoint`'s own grout gap already established.
  const blockPrevPoint = stepFrom(o, tPrev, -blockSize); // prevIdx ENDS at o -- step backward, away from it
  const blockCurPoint = stepFrom(o, tCur, blockSize); // curIdx STARTS at o -- step forward, away from it
  const cutPrevPoint = stepFrom(blockPrevPoint, tPrev, -nominalJoint);
  const cutCurPoint = stepFrom(blockCurPoint, tCur, nominalJoint);
  const keepRefPrev = stepFrom(cutPrevPoint, tPrev, -1); // further into prevIdx's own run
  const keepRefCur = stepFrom(cutCurPoint, tCur, 1); // further into curIdx's own run
  const forPrev = { point: cutPrevPoint, q: cutPrevPoint, dirX: prevPrim.nx, dirY: prevPrim.ny, keepRefAsStart: keepRefPrev, keepRefAsEnd: keepRefPrev, trustO: true };
  const forCur = { point: cutCurPoint, q: cutCurPoint, dirX: curPrim.nx, dirY: curPrim.ny, keepRefAsStart: keepRefCur, keepRefAsEnd: keepRefCur, trustO: true };

  // The block's own square: o (the true corner) -> blockPrevPoint -> inner -> blockCurPoint -> back
  // to o. `inner` is `blockPrevPoint` stepped along curIdx's own tangent by `blockSize` -- exact at a
  // 90deg corner (the common case); a reasonable approximation at any other angle, matching how
  // `buildButtJoint`'s own square cut already isn't exact off-90deg either.
  const inner = stepFrom(blockPrevPoint, tCur, blockSize);
  const blockPolygon = [o, blockPrevPoint, inner, blockCurPoint];

  return { isBlock: true, prevIdx, curIdx, forPrev, forCur, blockPolygon };
}

const EXTENSION_ARC_STEPS = 10; // a smoothness floor for the dropped-arc extension points below, same
// role as BOUNDARY_ARC_STEPS/MAX_SEGMENT_ANGLE elsewhere in this file -- never a correctness
// requirement, just how closely the drawn boundary hugs the TRUE arc between A/M/B.

/** Points tracing a DROPPED primitive's own TRUE arc (at `depth`, the row's own outer edge where the
 *  dropped primitive is still feasible) from angle `thetaFrom` to `thetaTo`, inclusive of both ends.
 *  H23 item 76 cont. (advisor review, "only the real board outline trims them" -- see this file's
 *  own header for the full "kite" shape this feeds into). */
function tessellateArcSpan(arc, depth, thetaFrom, thetaTo) {
  const off = offsetPrimitive(arc, depth);
  const points = [];
  for (let k = 0; k <= EXTENSION_ARC_STEPS; k++) {
    const t = thetaFrom + ((thetaTo - thetaFrom) * k) / EXTENSION_ARC_STEPS;
    points.push({ x: off.cx + off.r * Math.cos(t), y: off.cy + off.r * Math.sin(t) });
  }
  return points;
}

const MAX_KITE_SLICES = 20; // a generous ceiling on how far `buildPatch` will keep subdividing --
// real fillets never need anywhere near this many; it's a loop-safety bound, not a design target.

/** The point on `prim`'s own d0-offset edge at the SAME tangential coordinate as `q`'s own
 *  projection onto `prim` -- i.e. exactly where `prim`'s own NORMAL (unextended, `q`-based) last/
 *  first piece's own d0-corner already naturally sits. `prim` may be either shape. */
function pointOnD0AtQ(prim, d0, q) {
  if (prim.type === 'line') {
    const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y, len = Math.hypot(dx, dy) || 1;
    const tx = dx / len, ty = dy / len;
    const s = (q.x - prim.p0.x) * tx + (q.y - prim.p0.y) * ty;
    return { x: prim.p0.x + tx * s + prim.nx * d0, y: prim.p0.y + ty * s + prim.ny * d0 };
  }
  const theta = Math.atan2(q.y - prim.cy, q.x - prim.cx);
  const off = offsetPrimitive(prim, d0);
  return { x: off.cx + off.r * Math.cos(theta), y: off.cy + off.r * Math.sin(theta) };
}

/** The flat (or, if `prim` is itself an arc, curved) strip of `prim`'s own d0 edge from its own
 *  `q`-based natural stop (see `pointOnD0AtQ`) out to `tangentPoint` (where `prim` is tangent to the
 *  dropped primitive) -- ordered near-Q first, `tangentPoint` last. H23 item 76 cont. (MEASURED, not
 *  assumed): `prim`'s own NORMAL run must end EXACTLY flat at `q` for this to meet cleanly -- no
 *  float-safety epsilon past it (`linePieces`/`voussoirPieces` both skip their own usual
 *  CLIP_EPS_IN/CLIP_EPS_ANGLE extension specifically on a `trustO:false` side, see their own headers
 *  for why: there's no valid mitre there to clip against any more, the patch owns everything beyond
 *  `q`, so any extra "safety" material only re-creates the overlap this architecture exists to avoid
 *  -- MEASURED directly: with the epsilon still in place, 93% of one patch slice's own tiny area was
 *  inside the neighbouring normal piece, on TWO different circles that happen to pass close to the
 *  same tangent point). `q`'s own tangential position can be either side of `tangentPoint`'s, so this
 *  strip can have positive OR effectively zero/negative length; a degenerate (near-zero) strip is
 *  harmless (two near-identical points), never assumed away. */
function flatStripToTangent(prim, d0, q, tangentPoint) {
  if (prim.type === 'line') return [pointOnD0AtQ(prim, d0, q), tangentPoint];
  const thetaTangent = Math.atan2(tangentPoint.y - prim.cy, tangentPoint.x - prim.cx);
  // unwrap `q`'s own angle to the representation NEAREST `thetaTangent` (never past pi away) --
  // this run's own `q`-based stop and its true tangent point are always close together (both are, in
  // effect, this primitive's own natural end, reached two different ways), so the nearest
  // representation IS the short, correct path; no `direction` needed here (unlike `buildPatch`'s own
  // thetaA/thetaB unwrap, which spans the dropped primitive's OWN full declared arc and must stay on
  // ITS OWN branch, in ITS OWN direction, instead).
  let thetaQ = Math.atan2(q.y - prim.cy, q.x - prim.cx);
  while (thetaQ - thetaTangent > Math.PI) thetaQ -= 2 * Math.PI;
  while (thetaQ - thetaTangent < -Math.PI) thetaQ += 2 * Math.PI;
  return tessellateArcSpan(prim, d0, thetaQ, thetaTangent);
}

/** The patch filling the WHOLE outer excess around a dropped primitive, down to the single point `q`
 *  (the row's own TRUE d1 corner there -- neither flanking neighbour's own run reaches this far, see
 *  `linePieces`'/`voussoirPieces`' own header for why they deliberately stay `q`-based and plain).
 *  The patch's own OUTER boundary runs, in order: `prevPrim`'s own flat/curved strip from ITS OWN
 *  `q`-based stop out to `A` (the true tangent point with the dropped primitive) -- the dropped
 *  primitive's own TRUE arc from `A` to `B` -- `curPrim`'s own strip from `B` back to ITS OWN
 *  `q`-based stop. Every consecutive pair of boundary points, together with `q`, is a candidate
 *  wedge; grouped into as many roughly-equal pieces as needed to keep each at or below the declared
 *  1.2x ceiling (MEASURED: a single piece spanning the whole boundary reached 2.33x nominal on a
 *  real template). A patch too small to need splitting stays one piece, even under the 1/4 floor --
 *  there's no smaller, better-fitting option for the TRUE board outline than the whole patch itself. */
function buildPatch(prevPrim, curPrim, dropped, d0, A, B, q, pitch, width) {
  const off = offsetPrimitive(dropped, d0);
  const direction = Math.sign(dropped.theta2 - dropped.theta1) || 1;
  const thetaA = Math.atan2(A.y - off.cy, A.x - off.cx);
  let thetaB = Math.atan2(B.y - off.cy, B.x - off.cx);
  while ((thetaB - thetaA) * direction < 0) thetaB += direction * 2 * Math.PI;
  while ((thetaB - thetaA) * direction > 2 * Math.PI) thetaB -= direction * 2 * Math.PI;

  const boundary = [
    ...flatStripToTangent(prevPrim, d0, q, A),
    ...tessellateArcSpan(dropped, d0, thetaA, thetaB).slice(1, -1),
    ...flatStripToTangent(curPrim, d0, q, B).reverse(),
  ];
  const n = boundary.length - 1; // number of boundary EDGES (segments) to group into slices
  const nominalArea = pitch * width;
  const sliceArea = (i0, i1) => Math.abs(signedArea([...boundary.slice(i0, i1 + 1), q]));

  let K = 1;
  for (; K < MAX_KITE_SLICES && K < n; K++) {
    let maxArea = 0;
    for (let g = 0; g < K; g++) {
      const i0 = Math.round((n * g) / K), i1 = Math.round((n * (g + 1)) / K);
      if (i1 > i0) maxArea = Math.max(maxArea, sliceArea(i0, i1));
    }
    if (maxArea <= nominalArea * 1.2) break;
  }
  const spans = [];
  for (let g = 0; g < K; g++) {
    const i0 = Math.round((n * g) / K), i1 = Math.round((n * (g + 1)) / K);
    if (i1 > i0) spans.push({ sA: i0, sB: i1 });
  }
  // H23 item 76 cont. (advisor review, "each ≥ 1/4 brick; merge otherwise"): equal-INDEX grouping
  // above only bounds the CEILING -- the boundary's own point density is uneven (a flat strip's own 2
  // points vs the dropped arc's own densely-tessellated middle), so an equal split can still leave
  // one slice far smaller than another (MEASURED: as small as 0.0487x nominal). The SAME `mergeSlivers`
  // `linePieces`/`voussoirPieces` already use handles this identically -- spans here are boundary
  // INDEX ranges rather than inches/radians, but the merge operation (absorb span 0 into span 1, or
  // the reverse at the far end) is exactly the same integer-index arithmetic.
  mergeSlivers(spans, (i0, i1) => sliceArea(i0, i1), nominalArea);
  return spans.map(({ sA: i0, sB: i1 }) => [...boundary.slice(i0, i1 + 1), q]);
}

const CLIP_EPS_IN = 0.02; // a small safety margin on the piece touching a corner's own extreme edge
// (float precision only, plus the fact the piece's own flat end is tangent to, not crossing, the
// mitre line exactly AT its own sStart/sEnd by construction -- see this function's own header).

/** A straight primitive's own pieces between its d0/d1 offset lines, clipped against `jointStart`/
 *  `jointEnd` (either may be `null` at a genuinely open path's own free end -- never happens for this
 *  codebase's always-closed frame contours, but handled honestly rather than assumed away).
 *  T86 item 2: `sequence`/`forcedFStart` pass straight through to `planCornerRun` (see its own
 *  header) -- both default to `undefined` there, reproducing today's exact uniform-pitch behaviour. */
function linePieces(prim, d0, d1, jointStart, jointEnd, pitch, nominalJoint, set, seed, pieceId, startId, sequence, forcedFStart) {
  const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y;
  const totalLen = Math.hypot(dx, dy);
  if (totalLen < 1e-6) return { pieces: [], nextId: startId };
  const tx = dx / totalLen, ty = dy / totalLen;
  const worldAt = (sVal, depth) => ({ x: prim.p0.x + tx * sVal + prim.nx * depth, y: prim.p0.y + ty * sVal + prim.ny * depth });
  // project a world point onto THIS line's own fixed tangent -- valid at any depth, since offsetting
  // a line only shifts it perpendicular (never changes its own tangent).
  const project = (pt) => (pt.x - prim.p0.x) * tx + (pt.y - prim.p0.y) * ty;

  // H23 item 76 (advisor review): plan this run across its TRUE corner-to-corner reach, not its own
  // nominal [0,totalLen] span. A joint's own mitre LINE runs from `o` (its point at this row's OUTER
  // edge, d0) to `q` (at the DEEPEST edge, d1) -- MEASURED (not assumed): for an ordinary 90deg corner
  // these two project to nearly the same s (o close to 0, q shifted by ~d1), but for a corner whose
  // OWN neighbour dropped out (the fillet case this item exists to fix) `o` can land FAR further back
  // than `q` -- using `q` alone (an earlier version of this fix) left that whole outer-edge excess for
  // ONE piece alone to absorb (MEASURED: a 2.95x-nominal trapezoid). Taking whichever of `o`/`q` is
  // the MORE EXTREME (the one requiring MORE material) as this run's own true boundary means the
  // piece SEQUENCE itself (not just the one corner piece) covers the full wedge, each piece's own
  // share naturally bounded by `planCornerRun`'s own declared fractions -- the same diagonal-staircase
  // effect a mitre clip already produces at an ordinary corner, now correctly anchored for every
  // corner, oblique or not. `hiStart`/`loEnd` (the OTHER of each pair) is the mitre line's own
  // opposite extreme -- the farthest a clip could ever reach forward/backward -- used below to decide
  // which pieces actually need clipping at all (never past that point, by construction). Falls back
  // to the primitive's own nominal endpoint when a joint is absent (a degenerate zero-depth row, see
  // `mitreLine`'s own header -- never happens for a real row, handled honestly rather than assumed
  // away).
  // `trustO` (computed once per joint in `ribbonPieces`, see its own header): false when `o` is a
  // FICTITIOUS point (a primitive dropped between this joint's own two neighbours is still feasible
  // at d0, so `o` doesn't reflect the TRUE outer-edge boundary) -- fall back to `q` alone for that
  // side's own sizing. H23 item 76 cont. (advisor review, "they must not stop at the fillet's
  // tangent points"): this run's own piece sequence stays `q`-based ONLY -- it never tries to reach
  // the dropped primitive's own true tangent point itself. MEASURED (not assumed) why: the row's own
  // TRUE d1 boundary genuinely ENDS at `q` (that's what "dropped" means -- nothing of the fillet
  // survives at d1), but its own true d0 boundary can need to reach EITHER more OR less than `q`'s
  // own tangential position depending on the specific geometry (confirmed on two different real
  // joints, one each way) -- a single flat quad literally cannot represent both at once without
  // risking a bowtie whenever they disagree. `ribbonPieces`' own `kiteFan` covers the WHOLE outer
  // excess instead (the flat strip from this run's own natural stop to the true tangent point, AND
  // the dropped primitive's own true curve, down to the SAME point `q` this run's own last piece
  // already ends at) -- this run's own construction is plain, ordinary, exactly like a declared
  // corner, nothing extended.
  const startO = jointStart && jointStart.trustO ? project(jointStart.point) : null;
  const startQ = jointStart ? project(jointStart.q) : 0;
  const endO = jointEnd && jointEnd.trustO ? project(jointEnd.point) : null;
  const endQ = jointEnd ? project(jointEnd.q) : totalLen;
  const sStart = jointStart ? (startO === null ? startQ : Math.min(startO, startQ)) : 0;
  const hiStart = jointStart ? (startO === null ? startQ : Math.max(startO, startQ)) : 0;
  const sEnd = jointEnd ? (endO === null ? endQ : Math.max(endO, endQ)) : totalLen;
  const loEnd = jointEnd ? (endO === null ? endQ : Math.min(endO, endQ)) : totalLen;
  const effectiveLen = sEnd - sStart;
  const { lengths, jointWidth } = effectiveLen > 1e-6
    ? planCornerRun(effectiveLen, pitch, nominalJoint, FILL_FRACTIONS, sequence, forcedFStart)
    : { lengths: [], jointWidth: nominalJoint };

  // build ONE piece's own clipped polygon for an arbitrary [sA,sB] span -- shared by the normal
  // per-piece build below AND the merge pass that follows it (a merged span is built exactly the
  // same way, just wider).
  // H23 item 76 cont. (MEASURED, not assumed): on a `trustO:false` side, skip the usual float-safety
  // CLIP_EPS_IN extension (and its matching clip) entirely -- there's no valid mitre there to clip
  // against any more (the patch owns everything beyond `q`), so "extend a little for safety, then
  // clip back" only re-creates overlap with the patch's own strip, which starts EXACTLY at `q`, not
  // at some clipped approximation of it (MEASURED: with the epsilon left in, 93% of one patch slice's
  // own tiny area read as inside this run's own piece).
  const buildPiece = (sA, sB, isVeryFirst, isVeryLast) => {
    const skipStartExt = isVeryFirst && jointStart && !jointStart.trustO;
    const skipEndExt = isVeryLast && jointEnd && !jointEnd.trustO;
    const sStartPiece = isVeryFirst && !skipStartExt ? sA - CLIP_EPS_IN : sA;
    const sFinishPiece = isVeryLast && !skipEndExt ? sB + CLIP_EPS_IN : sB;
    let polygon = [worldAt(sStartPiece, d0), worldAt(sFinishPiece, d0), worldAt(sFinishPiece, d1), worldAt(sStartPiece, d1)];
    if (jointStart && !skipStartExt && sA < hiStart + 1e-9) polygon = clipToHalfPlane(polygon, jointStart, jointStart.keepRefAsStart);
    if (jointEnd && !skipEndExt && sB > loEnd - 1e-9) polygon = clipToHalfPlane(polygon, jointEnd, jointEnd.keepRefAsEnd);
    return polygon;
  };

  const spans = [];
  let s = sStart;
  for (let i = 0; i < lengths.length; i++) {
    spans.push({ sA: s, sB: s + lengths[i] });
    s = s + lengths[i] + jointWidth;
  }
  mergeSlivers(spans, (sA, sB) => Math.abs(signedArea(buildPiece(sA, sB, sA <= sStart, sB >= sEnd))), pitch * (d1 - d0));

  const pieces = [];
  let nextId = startId;
  for (let i = 0; i < spans.length; i++) {
    const { sA, sB } = spans[i];
    const polygon = buildPiece(sA, sB, i === 0, i === spans.length - 1);
    const { sampleId, flip } = pickSample(set, seed, 'bricks', nextId);
    const heightOffset = (mulberry32(seedFor(seed, 'bricks-jitter', nextId))() * 2 - 1) * (set.heightJitterIn || 0);
    pieces.push({ id: `${pieceId}-${nextId}`, polygon, pieceId, sampleId, flip, heightOffset });
    nextId++;
  }
  return { pieces, nextId };
}

/**
 * @param {Array} primitives — the CLOSED contour's own ordered lines+arcs (depth-0), see this file's
 *   own header for the two shapes.
 * @param {number} d0 @param {number} d1 — this ROW's own outer/inner depth from the original contour
 * @param {object} set @param {'soldier'|'stretcher'} orientation
 * @param {number} pitch — one whole piece's own along-run length
 * @param {number} nominalJoint — the set's own declared grout.widthIn
 * @param {number} seed @param {string} pieceId @param {number} startId
 * @param {'mitre'|'butt'|'lapped'|'block'} [cornerStyle='mitre'] — T86 item 1: 'butt'/'lapped' try
 *   the asymmetric through/butt square-cut joint (see `buildButtJoint`'s own header) at every
 *   genuine line-line corner with no dropped primitive between its two neighbours; every other
 *   corner (arc-involved, a dropped primitive, or a near-parallel non-corner) still gets the
 *   ordinary mitre, same as today. 'lapped' is the exact same construction with the through side
 *   flipped on every other `bandIndex` (the advisor's own decision, turn 291: "band 0 horizontal-
 *   through, band 1 vertical-through, ..." -- a single-band lapped frame is identical to 'butt' by
 *   construction). 'block' inserts a solid White-rocks quoin unit at the same corners instead (see
 *   `buildBlockJoint`'s own header) -- both bands square-cut into ITS faces, neither is "through".
 * @param {number} [bandIndex=0] — only read when `cornerStyle==='lapped'`; the caller's own band
 *   index (`contour-bands.js`'s own `bandIndex`, NOT `row` -- the alternation is band-to-band, per
 *   the advisor's own decision, not row-to-row within one band).
 * @param {number[]} [sequence] — T86 item 2: passed straight through to `planCornerRun` on every
 *   primitive's own run (see its own header) -- the caller (`contour-bands.js`) already applies any
 *   per-ROW rotation (flemish's own alternate-course swap) before calling, so `ribbonPieces` itself
 *   never needs to know about row index for this.
 * @param {number} [forcedFStart] — T86 item 2: ditto, passed straight through to `planCornerRun` --
 *   the caller already resolved whether THIS row is staggered (odd row, `staggerFrac>0`) into a
 *   concrete fraction (or `undefined` for an unstaggered row) before calling.
 * @returns {{ pieces: Array, nextId: number }}
 */
export function ribbonPieces(primitives, d0, d1, set, orientation, pitch, nominalJoint, seed, pieceId, startId, cornerStyle = 'mitre', bandIndex = 0, sequence, forcedFStart) {
  const n = primitives.length;
  const liveIndices = [];
  for (let i = 0; i < n; i++) if (primitiveLiveAtDepth(primitives[i], d1)) liveIndices.push(i);
  if (liveIndices.length === 0) return { pieces: [], nextId: startId };
  const m = liveIndices.length;

  const halfWidth = (d1 - d0) / 2;

  const jointBefore = liveIndices.map((curIdx, k) => {
    const prevIdx = liveIndices[(k - 1 + m) % m];
    const o = jointPointAt(primitives, prevIdx, curIdx, d0);
    const q = jointPointAt(primitives, prevIdx, curIdx, d1);
    if (!o || !q) return null;
    // H23 item 76 (advisor review -- MEASURED OOB regression, see WORK-LOG): `o` (this joint's own
    // point at the row's OUTER edge, d0) is computed by intersecting `prevIdx`/`curIdx` DIRECTLY,
    // skipping whatever dropped out between them -- correct IF every skipped primitive is ALSO
    // infeasible at d0 (it was never really there at this depth either). WRONG when a skipped
    // primitive is still feasible AT d0 and only drops before d1 (a "transitional" primitive within
    // THIS row): `o` then intersects two primitives that, at the TRUE outer edge, are not actually
    // adjacent at all (the transitional one is still physically between them) -- a fictitious point
    // that can land past the board's own true boundary. MEASURED directly: a shoulder fillet
    // feasible at d0=0 but not d1=0.75 produced an `o` 0.68in past the true edge, and `linePieces`
    // (trusting `o` for sizing, see its own header) built a piece reaching past the board. `trustO`
    // is false whenever this applies -- the one case `linePieces`/`voussoirPieces` fall back to `q`
    // alone for that side's own sizing (the "ordinary corner" / "d0-also-infeasible" cases, the vast
    // majority, keep trusting `o`, which is what the original fillet-collapse fix above needed).
    let trustO = true, droppedIdx = null;
    for (let idx = (prevIdx + 1) % n; idx !== curIdx; idx = (idx + 1) % n) {
      if (primitiveLiveAtDepth(primitives[idx], d0)) { trustO = false; droppedIdx = idx; break; }
    }
    // T86 item 1: a butt/lapped/block corner only ever applies at a genuine, undropped, line-line
    // joint -- a dropped primitive between the neighbours (almost always a fillet/arc) and any
    // arc-involved corner both declare straight to the ordinary mitre below (the architecture plan's
    // own "arc-involved corners fall back to mitre"). `buildButtJoint`/`buildBlockJoint` themselves
    // also return null (same fallback) for a near-parallel non-corner or a degenerate cut.
    if ((cornerStyle === 'butt' || cornerStyle === 'lapped') && droppedIdx === null
        && primitives[prevIdx].type === 'line' && primitives[curIdx].type === 'line') {
      const flipThrough = cornerStyle === 'lapped' && bandIndex % 2 === 1;
      const butt = buildButtJoint(primitives, prevIdx, curIdx, o, d1, nominalJoint, flipThrough);
      if (butt) return butt;
    }
    if (cornerStyle === 'block' && droppedIdx === null
        && primitives[prevIdx].type === 'line' && primitives[curIdx].type === 'line') {
      const block = buildBlockJoint(primitives, prevIdx, curIdx, o, nominalJoint);
      if (block) return block;
    }
    // the SAME joint, approached by its own two DIFFERENT primitives, must keep OPPOSITE sides of
    // its own mitre line (each keeps only its own half of the cut) -- `keepRefAsStart` (stepping
    // FORWARD along `curIdx`'s own tangent at `o`) is for whichever primitive STARTS here;
    // `keepRefAsEnd` (stepping BACKWARD along `prevIdx`'s own tangent at `o`) is for whichever
    // primitive ENDS here.
    const keepRefAsStart = stepFrom(o, tangentAt(primitives[curIdx], o), KEEP_REF_STEP_IN);
    const keepRefAsEnd = stepFrom(o, tangentAt(primitives[prevIdx], o), -KEEP_REF_STEP_IN);
    const joint = mitreLine(o, q, keepRefAsStart, keepRefAsEnd);
    if (!joint) return null;
    if (trustO || droppedIdx === null) return { ...joint, trustO };
    // H23 item 76 cont. (advisor review: "the neighbouring runs extend UP TO THE MITRE LINE through
    // that zone, and only the real board outline (the fillet arc itself) trims them; they must not
    // stop at the fillet's tangent points"): `linePieces`/`voussoirPieces` both stay `q`-based and
    // PLAIN for this joint (see their own header for why: the true tangent point is NOT always the
    // more extreme of the two, and letting either run reach for it directly risked a self-
    // intersecting piece -- MEASURED on a real template -- whenever `q` was actually the more extreme
    // one instead). The WHOLE outer excess -- from each neighbour's own `q`-based natural stop, out
    // to the dropped primitive's own TRUE tangent points (`A`/`B`), around its own TRUE arc, and back
    // down to `q` -- is `buildPatch`'s own job instead, entirely independent of either neighbour's
    // own piece sizing.
    const dropped = primitives[droppedIdx];
    const A = jointPointAt(primitives, prevIdx, droppedIdx, d0);
    const B = jointPointAt(primitives, droppedIdx, curIdx, d0);
    if (!A || !B) return { ...joint, trustO }; // defensive: no patch rather than a bad one
    const kiteFan = buildPatch(primitives[prevIdx], primitives[curIdx], dropped, d0, A, B, q, pitch, d1 - d0);
    return { ...joint, trustO, kiteFan };
  });

  const pieces = [];
  let nextId = startId;
  for (let k = 0; k < m; k++) {
    const idx = liveIndices[k];
    const prim = primitives[idx];
    // T86 item 1: `jointFor` resolves a butt/block joint to the SIDE this specific primitive owns
    // (`null`/a square cut for butt, one of two independent square cuts for block); an ordinary
    // mitre joint is returned unchanged, read identically by both neighbours exactly as before this
    // item. `rawJointEnd` (NOT run through `jointFor`) is kept alongside for reading `.kiteFan`/
    // `.blockPolygon` below -- both are properties of the JOINT itself (shared context, not a
    // per-side clip object), so they must be read from the raw joint, not its per-side resolution
    // (a block joint's own resolved `forPrev`/`forCur` carry no such field at all).
    const jointStart = jointFor(jointBefore[k], idx);
    const rawJointEnd = jointBefore[(k + 1) % m];
    const jointEnd = jointFor(rawJointEnd, idx);
    const built = prim.type === 'line'
      ? linePieces(prim, d0, d1, jointStart, jointEnd, pitch, nominalJoint, set, seed, pieceId, nextId, sequence, forcedFStart)
      : (() => {
        const centerlineR = prim.r - prim.radialSign * ((d0 + d1) / 2);
        return voussoirPieces(
          prim.cx, prim.cy, centerlineR, prim.theta1, prim.theta2, halfWidth, prim.radialSign,
          pitch, nominalJoint, set, seed, pieceId, nextId, jointStart, jointEnd, sequence, forcedFStart,
        );
      })();
    pieces.push(...built.pieces);
    nextId = built.nextId;

    // kite-fan pieces (see the jointBefore map's own header above) belong HERE in build order --
    // physically between THIS primitive's own last piece and the next primitive's own first piece --
    // not appended afterward: other code (and tests) walk `pieces` by BUILD order expecting it to
    // match geometric/walk order (MEASURED: a "gap between consecutive bricks" test read a worst gap
    // of 5in -- comparing two utterly unrelated bricks -- when kite pieces were collected in a
    // separate pass at the end instead). Each joint is exactly one primitive's own `jointEnd`, so this
    // fires exactly once per joint, never duplicated, including the wrap-around one.
    if (rawJointEnd && rawJointEnd.kiteFan) {
      for (const polygon of rawJointEnd.kiteFan) {
        const { sampleId, flip } = pickSample(set, seed, 'bricks', nextId);
        const heightOffset = (mulberry32(seedFor(seed, 'bricks-jitter', nextId))() * 2 - 1) * (set.heightJitterIn || 0);
        pieces.push({ id: `${pieceId}-${nextId}`, polygon, pieceId, sampleId, flip, heightOffset });
        nextId++;
      }
    }
    // T86 item 1, BLOCK: the quoin corner piece, same deferred-build pattern as `kiteFan` above (see
    // `buildBlockJoint`'s own header for why it can't assign its own id/sample earlier) -- built from
    // the White rocks set (`QUOIN_SET`), never the surrounding band's own `set`.
    if (rawJointEnd && rawJointEnd.isBlock && rawJointEnd.blockPolygon) {
      const { sampleId, flip } = pickSample(QUOIN_SET, seed, 'bricks-block', nextId);
      const heightOffset = (mulberry32(seedFor(seed, 'bricks-block-jitter', nextId))() * 2 - 1) * (QUOIN_SET.heightJitterIn || 0);
      pieces.push({ id: `${pieceId}-${nextId}`, polygon: rawJointEnd.blockPolygon, pieceId, sampleId, flip, heightOffset });
      nextId++;
    }
  }
  return { pieces, nextId };
}

const BOUNDARY_ARC_STEPS = 16; // a smoothness floor for the TESSELLATED polyline this returns, same
// role as arc-voussoir.js's own MAX_SEGMENT_ANGLE -- never a correctness requirement (every vertex
// at a JOINT is already the exact mitred intersection; this only controls how closely the drawn
// polyline's own straight segments hug the true arc BETWEEN two joints).

/**
 * The CLOSED contour's own true offset boundary at a given `depth`, as a plain {x,y}[] polyline --
 * every corner is the EXACT mitred joint intersection (the same `jointPointAt` `ribbonPieces` itself
 * uses to build piece geometry), not a naive per-primitive endpoint shift (MEASURED: that naive
 * version does not actually reach the true offset corner -- confirmed directly against `polygonArea`
 * on a simple square, off by a visible margin, not a rounding-level discrepancy). Used for
 * `bricksContourBands`' own `innerPath` (the Wall tool's own starting boundary) -- never fed back
 * into any ribbon construction itself, which always works from the ORIGINAL, depth-0 primitives.
 */
export function boundaryAtDepth(primitives, depth) {
  const n = primitives.length;
  const liveIndices = [];
  for (let i = 0; i < n; i++) if (primitiveLiveAtDepth(primitives[i], depth)) liveIndices.push(i);
  if (liveIndices.length === 0) return [];
  const m = liveIndices.length;
  const joints = liveIndices.map((curIdx, k) => jointPointAt(primitives, liveIndices[(k - 1 + m) % m], curIdx, depth));

  const points = [];
  for (let k = 0; k < m; k++) {
    const prim = primitives[liveIndices[k]];
    const startPt = joints[k];
    if (prim.type === 'line') {
      points.push(startPt);
    } else {
      const offPrim = offsetPrimitive(prim, depth);
      for (let s = 0; s < BOUNDARY_ARC_STEPS; s++) {
        if (s === 0) { points.push(startPt); continue; }
        const t = prim.theta1 + ((prim.theta2 - prim.theta1) * s) / BOUNDARY_ARC_STEPS;
        points.push({ x: offPrim.cx + offPrim.r * Math.cos(t), y: offPrim.cy + offPrim.r * Math.sin(t) });
      }
    }
  }
  return points;
}
