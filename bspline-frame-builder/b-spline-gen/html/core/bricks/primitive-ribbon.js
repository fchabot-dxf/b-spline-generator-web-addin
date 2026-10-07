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
import { curveIntersection, lineLineIntersection, lineCircleIntersections } from './curve-intersect.js';
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

const MIN_LINE_RUN_IN = 0.02; // T86 item 9 (reusing item 4b's own floor): a declared floor, same
// role as arc-voussoir.js's own MIN_RADIUS_IN -- below this, a straight primitive's own effective
// run (after BOTH neighbours' own mitre consumption at this depth) is too degenerate to host even
// a sliver; drop the whole primitive, the same "an honest gap, not a garbage render" treatment
// MIN_RADIUS_IN already gives an over-deep convex arc.

/** T86 item 9 (WORK-LOG's own "T86 item 4 continued" diagnosis, turn 309): a LINE never disappears
 *  from its OWN offset the way a circle's radius can -- unlike an arc, a line's degeneracy is
 *  purely about its own TWO ENDS: once BOTH neighbours' own mitre consumption at this depth
 *  exceeds the primitive's own total length, there is no room left for even one real piece.
 *  Mirrors `linePieces`' own effective-run projection (same `project`/min-max-of-o-or-q reasoning)
 *  against this primitive's own TRUE immediate neighbours in the full, undropped primitive list --
 *  never the live-filtered one: a primitive's own corner consumption with whatever is physically
 *  adjacent to it at depth 0 is a LOCAL fact, unaffected by what else drops elsewhere on the same
 *  row. */
function lineLiveAtDepth(primitives, idx, depth, closed) {
  const prim = primitives[idx];
  const n = primitives.length;
  // T86 item 9 bug (found testing the brush's own OPEN primitive lists against this NEW check,
  // added after item 7): the modular wraparound below is only valid for a CLOSED loop -- on an
  // OPEN path, primitive 0's own "previous" and the LAST primitive's own "next" are NOT real
  // neighbours at all (MEASURED: treating them as such on a 2-line bent brush stroke produced a
  // bogus joint at the wrong place and dropped BOTH primitives, zero pieces). An open path's own
  // true end has no neighbour to measure consumption against -- same "can't judge, assume live"
  // fallback as a missing joint.
  const hasPrev = closed || idx > 0;
  const hasNext = closed || idx < n - 1;
  const jointWithPrev = hasPrev ? jointPointAt(primitives, (idx - 1 + n) % n, idx, depth) : null;
  const jointWithNext = hasNext ? jointPointAt(primitives, idx, (idx + 1) % n, depth) : null;
  if (!jointWithPrev || !jointWithNext) return true; // no joint to measure against -- same "can't judge, assume live" as every other defensive null-check in this file
  const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y, totalLen = Math.hypot(dx, dy) || 1;
  const tx = dx / totalLen, ty = dy / totalLen;
  const project = (pt) => (pt.x - prim.p0.x) * tx + (pt.y - prim.p0.y) * ty;
  return project(jointWithNext) - project(jointWithPrev) > MIN_LINE_RUN_IN;
}

/** T86 item 30: whether a row whose inner edge is at `depth` loses a LINE that lies between two lines -- a feature
 *  narrower than about two rows (both its corners' mitres consume more than its length), the one drop that strands the
 *  band (MEASURED: T9 with 1.82 in flanges at 1 in, the flange ends laid nothing but fans at the board corners). A line
 *  dropping beside an arc is NOT this: the arc's fan covers that corner and the row lays fine (T5 / T8 / T18 / T19). */
export function lineBetweenLinesDropsAt(primitives, depth) {
  const n = primitives.length;
  return primitives.some((p, i) => p.type === 'line' && primitives[(i - 1 + n) % n].type === 'line'
    && primitives[(i + 1) % n].type === 'line' && !lineLiveAtDepth(primitives, i, depth, true));
}

function primitiveLiveAtDepth(primitives, idx, depth, closed = true) {
  const prim = primitives[idx];
  // isArcFeasible(r, radialSign, halfWidth) checks `r - radialSign*halfWidth > floor` -- passing
  // `depth` in the `halfWidth` slot gives exactly `r - radialSign*depth`, this primitive's own
  // radius at its row's deepest edge, the SAME quantity the advisor's own "r-d1 <= grout" check
  // describes.
  return prim.type === 'line' ? lineLiveAtDepth(primitives, idx, depth, closed) : isArcFeasible(prim.r, prim.radialSign, depth);
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
/** T86 item 5 (crossings.js): an open ribbon's END on a declared CUT line { point, dirX, dirY } -- a straight cut along
 *  the edge it stops on (it is a joint off that edge already: no half-joint shift, like a butt), read by linePieces /
 *  voussoirPieces like any corner joint, so the run is planned from the fill set up to it. `o` / `q` are where the cut
 *  meets this row's two edges (depth d0 / d1); the keep references sit just inside the run. null when the cut misses. */
function cutJoint(prim, cut, d0, d1, which) {
  const dir = { x: cut.dirX, y: cut.dirY };
  let at, tangent;
  if (prim.type === 'line') {
    const l = Math.hypot(prim.p1.x - prim.p0.x, prim.p1.y - prim.p0.y) || 1, t = { x: (prim.p1.x - prim.p0.x) / l, y: (prim.p1.y - prim.p0.y) / l };
    at = (d) => lineLineIntersection({ x: prim.p0.x + prim.nx * d, y: prim.p0.y + prim.ny * d }, t, cut.point, dir);
    tangent = t;
  } else {
    const nearest = (pts) => pts.reduce((b, p) => (!b || Math.hypot(p.x - cut.point.x, p.y - cut.point.y) < Math.hypot(b.x - cut.point.x, b.y - cut.point.y) ? p : b), null);
    at = (d) => nearest(lineCircleIntersections(cut.point, dir, { x: prim.cx, y: prim.cy }, prim.r - prim.radialSign * d));
    const th = which === 'start' ? prim.theta1 : prim.theta2, sgn = Math.sign(prim.theta2 - prim.theta1) || 1;
    tangent = { x: -Math.sin(th) * sgn, y: Math.cos(th) * sgn };
  }
  const o = at(d0), q = at(d1);
  if (!o || !q) return null;
  const into = which === 'start' ? 1 : -1, mid = { x: (o.x + q.x) / 2, y: (o.y + q.y) / 2 };
  const keep = stepFrom(mid, tangent, into * KEEP_REF_STEP_IN);
  return { point: o, q, dirX: dir.x, dirY: dir.y, keepRefAsStart: keep, keepRefAsEnd: keep, trustO: true, isCut: true };
}

function stepFrom(point, tangent, signedStep) {
  return { x: point.x + tangent.x * signedStep, y: point.y + tangent.y * signedStep };
}

const BUTT_PARALLEL_DOT = 0.999; // H23 item 76 cont. (butt corner): tangents this close to parallel
// (|dot| >= this) aren't a genuine corner at all -- a straight run split across two primitives, or a
// smooth continuation -- so there's no "through" vs "butt" side to pick; falls back to the ordinary
// mitre, which degenerates harmlessly to a near-straight seam on its own at this angle anyway.

/** T86 item 21b (Fred's T11 double_course: "is this one getting fixed?"): the butt construction below is exact
 *  only for a SQUARE corner -- the through band's last piece ends square at the outer corner and the butt band is
 *  cut where the through band's inner edge crosses it, which together tile a right angle and nothing else. MEASURED
 *  on T11 (a 45 deg turn, vertical into the V): the cut landed 1.77 in up a 1.95 in vertical (d1 / sin 45), the
 *  vertical got no piece at all and a triangle beside the diagonal's square end went bare (1.39 sq in per side at
 *  1.25 in). Declared: butt / lapped / block serve corners within BUTT_SQUARE_WINDOW_DEG of square (block: convex ones
 *  too, see buildBlockJoint); any other corner falls back to the mitre, as arc-involved corners already do. */
const BUTT_SQUARE_WINDOW_DEG = 15;
const SQUARE_CORNER_DOT = 1e-9; // |cos| below this: a true right angle, built exactly as before 21b (byte-identical)
/** Where the line through `point` along `dir` crosses `prim`'s own offset line at depth `d` (a line primitive). */
function crossAtDepth(prim, d, point, dir) {
  const off = offsetPrimitive(prim, d);
  return lineLineIntersection({ x: off.p0.x, y: off.p0.y }, { x: off.p1.x - off.p0.x, y: off.p1.y - off.p0.y }, point, dir);
}
const BUTT_SQUARE_MAX_DOT = Math.sin((BUTT_SQUARE_WINDOW_DEG * Math.PI) / 180);

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
 * Returns `null` when there's no well-defined square cut (the two tangents are parallel, the
 * through/butt lines don't meet, or `cut0` lands outside the butt primitive's own true span -- see
 * its own header below, a GENUINE concave-corner case, not merely a convex one computed imprecisely)
 * -- the caller falls back to the ordinary symmetric mitre, same as the already-declared
 * "arc-involved corners fall back to mitre" rule (this function is only ever tried for a line-line
 * corner to begin with; see its own caller).
 */
function buildButtJoint(primitives, prevIdx, curIdx, o, d1, nominalJoint, flipThrough) {
  const tPrev = tangentAt(primitives[prevIdx], o);
  const tCur = tangentAt(primitives[curIdx], o);
  const dot = Math.abs(tPrev.x * tCur.x + tPrev.y * tCur.y);
  if (dot >= BUTT_PARALLEL_DOT) return null; // not a genuine corner
  if (dot > BUTT_SQUARE_MAX_DOT) return null; // not near square: the mitre (21b)
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
  // T86 item 4 (a genuine CONCAVE corner, found stress-testing every template -- a GENERAL geometric
  // case, not specific to any one shape): `cut0` is only ever a sensible butt-cut location when it
  // falls WITHIN the butt primitive's own true [0, length] span -- for a CONVEX corner (the only case
  // this was built and tested against) it always does, since the through band's own d1 edge is
  // adjacent to the butt band's own material there. MEASURED (an I-beam template's own reflex waist
  // corner): `cut0` landed 0.75in BEFORE the butt primitive's own start (its own projected length
  // -0.75, well outside [0, 5.1]) -- the through band's own material sits on the OPPOSITE side of a
  // concave corner from the butt band's own run, so the same construction that works for convex
  // corners has no valid cut location to find here at all. Detected directly (not inferred from the
  // sign of an unrelated intersection, which this item's own investigation confirmed can read the
  // SAME sign for both a working convex corner and a broken concave one): project `cut0` onto the
  // butt primitive's own declared p0->p1 axis and require it to land within the primitive's own real
  // extent (a small tolerance for a cut arriving essentially AT one true end). Concave corners get a
  // proper butt cut later (T86 item 5, the general crossing-strokes rule); for now they fall back to
  // the always-correct mitre, never a degenerate or empty piece.
  const buttLen = Math.hypot(butt.p1.x - butt.p0.x, butt.p1.y - butt.p0.y);
  const cut0Param = (cut0.x - butt.p0.x) * buttTangent.x + (cut0.y - butt.p0.y) * buttTangent.y;
  if (cut0Param < -1e-6 || cut0Param > buttLen + 1e-6) return null;
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
  if (dot < SQUARE_CORNER_DOT) return { throughIdx, forThrough: throughSentinel, forButt: square, isButt: true };
  // 21b, a corner inside the window but not square (T12's ~81 deg bottom corners: two wedge voids, 0.061 sq in each):
  // the faces must meet the faces they butt, not the runs' own normals. The butt run is cut PARALLEL to the through
  // band's inner edge, one joint inside it; the through run reaches the outline (the butt primitive's own line) and is
  // cut along it -- at a square corner both reduce to the construction above.
  const tThrough = tangentAt(through, o);
  // one joint square to the through band's inner edge, i.e. joint / sin(corner) along the butt run's own outer line;
  // the cut's two ends on the butt run's outer and inner lines bound the run's last piece (a clip only trims)
  const sinCorner = Math.sqrt(Math.max(1 - dot * dot, 1e-12));
  const buttCut = stepFrom(cut0, buttTangent, (nominalJoint / sinCorner) * awaySign);
  const buttCutInner = crossAtDepth(butt, d1, buttCut, tThrough) || buttCut;
  const buttKeep = stepFrom(buttCut, buttTangent, awaySign);
  const forButt = { point: buttCut, q: buttCutInner, dirX: tThrough.x, dirY: tThrough.y, keepRefAsStart: buttKeep, keepRefAsEnd: buttKeep, trustO: true };
  const reach = lineLineIntersection({ x: throughD1.p0.x, y: throughD1.p0.y }, { x: throughD1.p1.x - throughD1.p0.x, y: throughD1.p1.y - throughD1.p0.y }, o, buttTangent);
  const intoThrough = stepFrom(o, tThrough, throughIdx === prevIdx ? -1 : 1);
  const forThrough = { point: o, q: reach || o, dirX: buttTangent.x, dirY: buttTangent.y, keepRefAsStart: intoThrough, keepRefAsEnd: intoThrough, trustO: true };
  return { throughIdx, forThrough, forButt, isButt: true };
}

/** T86 item 21b: an ordinary mitre joint (both runs clip to ONE line) resolved for one run -- the line shifted `half` a
 *  joint toward that run's own side, so the two runs meet with a full joint between them instead of abutting (a
 *  0-gap seam: a zero-area sliver profile in Fusion, seat A's e2e). Butt / block / notch joints carry their own gaps,
 *  and a `trustO:false` joint (a fan's corner) is the fan's to keep clear of; those come back unchanged. */
function mitreJointSide(raw, joint, keepKey, half, onConvexArc = false) {
  if (!raw || !joint || raw.isButt || raw.isBlock || !(half > 0)) return joint;
  // T86 item 35: a CONVEX arc run (its radius shrinks with depth) keeps the fan's own corner -- moved back along its
  // tangent, a voussoir's radial end swung through j / R radians at the small inner radius (T8 9x12 1.5 in: R 0.11 in,
  // 15 deg, a wedge 0.03 in at q and 0.42 in at the rim, 0.24 sq in bare). Its end stays the radial through `q`; the
  // fan yields it a constant joint (contour-bands yieldAtMedialLine: a fan yields a run all it covers plus a joint).
  // A concave arc's inner radius is its LARGER one -- the move narrows toward the rim, no wedge: unchanged.
  if (joint.trustO === false) return onConvexArc ? joint : fanJointSide(raw, joint, keepKey, half);
  const nx = -joint.dirY, ny = joint.dirX, ref = joint[keepKey];
  const side = Math.sign((ref.x - joint.point.x) * nx + (ref.y - joint.point.y) * ny) || 1;
  // slide along THIS run (its direction at the corner: toward its keep reference) until the line is half a joint away,
  // so the corner points stay ON the run's own d0 / d1 edges -- the run plans its pieces from them (MEASURED: moved
  // straight off the mitre instead, a staggered row's half-brick came out 0.363 in, the start read 0.012 in early)
  const tx = ref.x - joint.point.x, ty = ref.y - joint.point.y, tl = Math.hypot(tx, ty) || 1;
  const across = ((tx / tl) * nx + (ty / tl) * ny) * side; // > 0: the run leaves the line toward its own side
  const u = half / Math.max(across, 0.05);
  const shift = (p) => ({ x: p.x + (tx / tl) * u, y: p.y + (ty / tl) * u });
  // the reference point moves WITH the line (it sits only KEEP_REF_STEP_IN from the corner, less than half a joint)
  return { ...joint, point: shift(joint.point), q: shift(joint.q), [keepKey]: shift(ref) };
}

/** T86 item 21b: at a fan's corner (`trustO:false`) both runs stop at the same inner corner `q` and touched there at
 *  one point. Each run's end moves back along its own line by j / (2 sin(alpha / 2)) -- alpha the angle the two runs make
 *  at `q` -- so their two corners are exactly one joint apart (0.71 of a joint each at a square corner). The fan already
 *  stands a joint off each run (buildPatch). Needs the joint's own two tangents at `q` (`tPrev`, `tCur`). */
function fanJointSide(raw, joint, keepKey, half) {
  if (!raw.tPrev || !raw.tCur) return joint;
  return { ...joint, q: fanRunCorner(joint.q, raw.tPrev, raw.tCur, keepKey === 'keepRefAsEnd' ? 'prev' : 'cur', half) };
}
/** T86 item 21b's move, declared ONCE (T86 item 16d): where a run beside a fan's corner ends -- its inner corner `q`
 *  moved back along its own line by j / (2 sin(alpha / 2)) (capped at 2 j). The run's end (fanJointSide) AND the fan's
 *  own boundary next to it (buildPatch) read this, so the fan lays from the run's RESOLVED end: the seam between the
 *  fan and the run is one joint. Before, the fan was laid from the unmoved `q` and every move widened that seam by
 *  the move (MEASURED: T18 7x9 1.25 in, 3 joints = 1 + the 2-joint move; 227 seams over 1.5 joints in 47 of 76 lays).
 *  `side` 'prev' = the run ending at the corner (moved against tPrev), 'cur' = the run starting there (along tCur). */
function fanRunCorner(q, tPrev, tCur, side, half) {
  const cosAlpha = -(tPrev.x * tCur.x + tPrev.y * tCur.y);
  const sinHalf = Math.sqrt(Math.max((1 - cosAlpha) / 2, 1e-6));
  const back = Math.min(half / sinHalf, 4 * half);
  const t = side === 'prev' ? { x: -tPrev.x, y: -tPrev.y } : tCur; // away from q, into the run
  return { x: q.x + t.x * back, y: q.y + t.y * back };
}
/** Where each run beside a fan's corner ends (fanRunCorner), or `q` itself for a CONVEX arc run (item 35: it keeps the
 *  fan's own corner) -- the same rule mitreJointSide applies to the runs. */
function fanRunEnds(primitives, prevIdx, curIdx, q, nominalJoint) {
  const tPrev = tangentAt(primitives[prevIdx], q), tCur = tangentAt(primitives[curIdx], q), half = nominalJoint / 2;
  const convex = (prim) => prim.type === 'arc' && prim.radialSign > 0;
  return {
    qPrev: convex(primitives[prevIdx]) ? q : fanRunCorner(q, tPrev, tCur, 'prev', half),
    qCur: convex(primitives[curIdx]) ? q : fanRunCorner(q, tPrev, tCur, 'cur', half),
  };
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
  if (joint.isBlock || joint.isNotch) return idx === joint.prevIdx ? joint.forPrev : joint.forCur;
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
function buildBlockJoint(primitives, prevIdx, curIdx, o, nominalJoint, d1) {
  const tPrev = tangentAt(primitives[prevIdx], o);
  const tCur = tangentAt(primitives[curIdx], o);
  const dot = Math.abs(tPrev.x * tCur.x + tPrev.y * tCur.y);
  if (dot >= BUTT_PARALLEL_DOT) return null;
  // 21b: the block square is stepped along both tangents from the OUTER corner, so it fits only a convex, near-square
  // corner. MEASURED: at T9's / T6's reflex corners it lands outside the board and the two runs still give up a block
  // length each (T9 1.25 in: the I-beam web bare, 3.69 sq in per side); at T11's 45 deg turn the vertical goes bare.
  // Convex = the next run turns toward the inside: tCur along the previous line's inward normal.
  const convex = tCur.x * primitives[prevIdx].nx + tCur.y * primitives[prevIdx].ny > 0;
  if (dot > BUTT_SQUARE_MAX_DOT || !convex) return null; // the mitre
  const blockSize = QUOIN_SET.brickLengthIn;
  const prevPrim = primitives[prevIdx], curPrim = primitives[curIdx];
  // 21b: each run must be longer than the block plus a joint, or its cut lands past its own end and its pieces
  // lie under the block (T5 quoin 0.75 in: a 0.139 sq in overlap at each bottom corner, the bottom line shorter
  // than the 1.1 in block) -- such a corner takes the mitre
  const lenOf = (p) => Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y);
  if (Math.min(lenOf(prevPrim), lenOf(curPrim)) < blockSize + nominalJoint + MIN_LINE_RUN_IN) return null;
  // The block's OWN face sits exactly `blockSize` from the corner (a quoin unit's own declared size,
  // unaffected by grout). The SURROUNDING band's own cut stops `nominalJoint` further out still,
  // leaving a real mortar-width gap between the block's own face and the band's own first piece --
  // same convention `buildButtJoint`'s own grout gap already established.
  const blockPrevPoint = stepFrom(o, tPrev, -blockSize); // prevIdx ENDS at o -- step backward, away from it
  const blockCurPoint = stepFrom(o, tCur, blockSize); // curIdx STARTS at o -- step forward, away from it
  // 21b: each run is cut parallel to the block face it meets (prev meets the face along tCur, cur the face along
  // tPrev), one joint off it measured square to that face; at a right angle that is the run's own normal, as before
  const sinCorner = Math.sqrt(Math.max(1 - dot * dot, 1e-12));
  const gapAlong = dot < SQUARE_CORNER_DOT ? nominalJoint : nominalJoint / sinCorner;
  const cutPrevPoint = stepFrom(blockPrevPoint, tPrev, -gapAlong);
  const cutCurPoint = stepFrom(blockCurPoint, tCur, gapAlong);
  const keepRefPrev = stepFrom(cutPrevPoint, tPrev, -1); // further into prevIdx's own run
  const keepRefCur = stepFrom(cutCurPoint, tCur, 1); // further into curIdx's own run
  const square = dot < SQUARE_CORNER_DOT;
  const forPrev = square
    ? { point: cutPrevPoint, q: cutPrevPoint, dirX: prevPrim.nx, dirY: prevPrim.ny, keepRefAsStart: keepRefPrev, keepRefAsEnd: keepRefPrev, trustO: true }
    : { point: cutPrevPoint, q: crossAtDepth(prevPrim, d1, cutPrevPoint, tCur) || cutPrevPoint, dirX: tCur.x, dirY: tCur.y, keepRefAsStart: keepRefPrev, keepRefAsEnd: keepRefPrev, trustO: true };
  const forCur = square
    ? { point: cutCurPoint, q: cutCurPoint, dirX: curPrim.nx, dirY: curPrim.ny, keepRefAsStart: keepRefCur, keepRefAsEnd: keepRefCur, trustO: true }
    : { point: cutCurPoint, q: crossAtDepth(curPrim, d1, cutCurPoint, tPrev) || cutCurPoint, dirX: tPrev.x, dirY: tPrev.y, keepRefAsStart: keepRefCur, keepRefAsEnd: keepRefCur, trustO: true };

  // The block's own square: o (the true corner) -> blockPrevPoint -> inner -> blockCurPoint -> back
  // to o. `inner` is `blockPrevPoint` stepped along curIdx's own tangent by `blockSize` -- exact at a
  // 90deg corner (the common case); a reasonable approximation at any other angle, matching how
  // `buildButtJoint`'s own square cut already isn't exact off-90deg either.
  const inner = stepFrom(blockPrevPoint, tCur, blockSize);
  const blockPolygon = [o, blockPrevPoint, inner, blockCurPoint];

  return { isBlock: true, prevIdx, curIdx, forPrev, forCur, blockPolygon };
}

/** A monotonically-increasing position along `prim` (line: tangential projection from `p0`; arc:
 *  unwrapped angle from `theta1` in its own declared direction, the SAME unwrap `buildPatch` below
 *  already uses) -- lets two points be ordered "near/far" along a primitive regardless of which
 *  flanking neighbour happened to compute each one. */
function tangentialProjection(prim, pt) {
  if (prim.type === 'line') {
    const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y, len = Math.hypot(dx, dy) || 1;
    return ((pt.x - prim.p0.x) * dx + (pt.y - prim.p0.y) * dy) / len;
  }
  const direction = Math.sign(prim.theta2 - prim.theta1) || 1;
  let t = (Math.atan2(pt.y - prim.cy, pt.x - prim.cx) - prim.theta1) * direction;
  while (t < 0) t += 2 * Math.PI;
  return t;
}

/** T86 item 9 (WORK-LOG's own "dropped-line architecture attempted and REVERTED" entry, and the
 * advisor's own follow-up ruling): a dropped primitive that bridges a NOTCH -- its own two
 * flanking neighbours are PARALLEL to each other (e.g. two sides of a rectangular step, like
 * `template_9`'s own "I Shape" waist) -- has no single corner point hiding behind it the way a
 * dropped ARC's rounded fillet does: extending two NON-parallel sides through where a fillet used
 * to be always meets at one point, but two PARALLEL sides never meet at all, at any depth. The
 * ordinary `o`/`q` this file's own `jointBefore` map tries first (`jointPointAt(prevIdx, curIdx,
 * depth)`, skipping straight past the dropped primitive) comes back `null` in exactly this case.
 *
 * MEASURED (the reverted attempt's own finding): giving each flanking primitive its OWN
 * independent, non-fictitious corner with the dropped primitive (`trustO:true`) reproduces the
 * exact pre-fix 92% overlap byte-identical -- the two flanking rows have themselves PHYSICALLY
 * CONVERGED at a deep enough row (their own offset bands, from opposite sides of the gap, start to
 * occupy the same space), so sizing each side off its OWN corner lets both reach almost all the
 * way across independently. The general fix (the advisor's own ruling): compute the MEDIAL LINE
 * between the two flanking primitives ONCE (the line parallel to both, exactly halfway across
 * their own TRUE, depth-0 gap -- `medialDepth = D/2`, `D` the perpendicular gap) and truncate BOTH
 * sides at that SAME shared line whenever a row's own depth would otherwise cross it -- the same
 * "clip two sides against one identical line, so they meet exactly instead of overlapping"
 * guarantee an ordinary mitre joint already relies on, just with the clip line now being a
 * constant medial line instead of a per-depth corner intersection.
 *
 * Three cases per row, by comparing `d0`/`d1` against `medialDepth`:
 *  - `d1 <= medialDepth`: this row's own deepest edge hasn't reached the pinch at all -- ordinary,
 *    independent corners (`trustO:true`) are exactly correct here (MEASURED: this is the case that
 *    already worked, in isolation, in the reverted attempt), with a `kiteFan` QUAD reaching out to
 *    each side's own true tangent point, same as a dropped ARC's own kite.
 *  - `d0 >= medialDepth`: the row's own OUTER edge has ALREADY passed the pinch -- there is no real
 *    material left near this joint for EITHER side at this depth; clipping each side against the
 *    medial line (below) naturally removes their ENTIRE candidate piece here (the whole candidate
 *    sits on the far side of a line both exceed), and the `kiteFan` triangle degenerates to zero/
 *    negative area, which the caller (`ribbonPieces`) only ever used as plain fill geometry -- so
 *    this case needs no separate branch, only a guard to skip emitting a degenerate triangle.
 *  - otherwise (`d0 < medialDepth < d1`, the row straddles the pinch): each side's own candidate
 *    piece is clipped against the SAME medial line instead of its own independent corner -- they
 *    now meet EXACTLY at that line, nothing left over for either to overlap into. The dropped
 *    primitive's own residual sliver is a TRIANGLE (`oA`, `oB`, the medial point) -- the quad's own
 *    "deep" edge (`qA`/`qB`, past the pinch) has no counterpart any more, since the medial point IS
 *    where both would-be `qA`/`qB` positions coincide.
 */
/** T86 item 9: the dropped primitive's own residual sliver (`buildNotchJoint`'s own triangle, fanning
 *  a 2-point `[d0Near,d0Far]` outer edge to a single apex) is NOT automatically pitch-sized the way
 *  an ordinary row's own pieces are -- MEASURED (template_15's own wide neck, a 2.925in gap): a
 *  single un-split kite patch reached 3.38x nominal, the SAME "irregular patch, never split" defect
 *  T86 item 3 already fixed for the dropped-ARC case. Mirrors that fix's own shape exactly (plan the
 *  boundary's own true length with the band's own declared sequence/fill rule, slice via
 *  `patchSlicePolygon`, merge slivers) over a trivial 2-point boundary (a straight line needs no
 *  flat-strip/tessellated-arc construction at all -- the kite's own outer edge already IS straight). */
/** T86 item 21b, the JOINT RULE for a run cut into slices that share no single axis (a corner's fan, a notch's patch):
 *  every divider is a strip one joint wide centred on its line (not a wedge meeting at the apex -- seat A's Fusion
 *  baseline found the sliver profiles clustered at zero-wide apex joints), and the first / last slice stands a FULL
 *  joint off the run it meets (the patch is the filler and yields, the rule contour-bands.js yieldAtMedialLine
 *  declares). `raw(sA, sB)` builds a slice's polygon over [sA, sB] with no joint; `divider(s)` gives the two points of
 *  the dividing line at s (for a fan: the boundary point and the apex). */
function jointedSlices(spans, totalLen, jointWidth, nominalJoint, nominalArea, raw, divider) {
  const half = jointWidth / 2;
  const slice = (sA, sB, first, last) => {
    let poly = raw(first ? sA : sA - half, last ? sB : sB + half);
    if (poly.length < 3) return poly;
    const [m0, m1] = divider((sA + sB) / 2);
    const keep = { x: m0.x + (m1.x - m0.x) * 0.25, y: m0.y + (m1.y - m0.y) * 0.25 };
    const side = (sv, offset) => {
      const [p, t] = divider(sv), dx = t.x - p.x, dy = t.y - p.y, len = Math.hypot(dx, dy);
      if (len < 1e-9) return null;
      const nx = -dy / len, ny = dx / len, sgn = Math.sign((keep.x - p.x) * nx + (keep.y - p.y) * ny) || 1;
      return { point: { x: p.x + nx * sgn * offset, y: p.y + ny * sgn * offset }, dirX: dx / len, dirY: dy / len };
    };
    for (const line of [side(first ? 0 : sA - half, first ? nominalJoint : half), side(last ? totalLen : sB + half, last ? nominalJoint : half)]) {
      if (line && poly.length >= 3) poly = clipToHalfPlane(poly, line, keep);
    }
    return poly;
  };
  mergeSlivers(spans, (sA, sB) => Math.abs(signedArea(slice(sA, sB, sA <= 1e-9, sB >= totalLen - 1e-9))), nominalArea);
  return spans.map(({ sA, sB }, i) => slice(sA, sB, i === 0, i === spans.length - 1));
}

function buildNotchPatch(d0Near, d0Far, apex, pitch, nominalJoint, width, sequence, forcedFStart) {
  const boundary = [d0Near, d0Far];
  const cum = cumulativeLengths(boundary);
  const totalLen = cum[cum.length - 1];
  const nominalArea = pitch * width;
  if (totalLen < 1e-6) return [[...boundary, apex]];
  const { lengths, jointWidth } = planCornerRun(totalLen, pitch, nominalJoint, FILL_FRACTIONS, sequence, forcedFStart);
  const spans = [];
  let s = 0;
  for (let i = 0; i < lengths.length; i++) { spans.push({ sA: s, sB: s + lengths[i] }); s += lengths[i] + jointWidth; }
  return jointedSlices(spans, totalLen, jointWidth, nominalJoint, nominalArea,
    (sA, sB) => patchSlicePolygon(boundary, cum, sA, sB, apex), (sv) => [pointAtLength(boundary, cum, sv), apex]);
}

/** T86 item 9: `buildNotchJoint`'s own NO-PINCH quad (`[d0Near,d0Far,d1Far,d1Near]`, the case this
 *  row never reaches the medial line at all) needs the SAME pitch-sizing as the triangle above, for
 *  the identical reason (MEASURED: template_9 at 9x12, a wider board whose own notch gap scales up
 *  with it -- a single un-split quad reached 3.76x nominal). A plain RULED-SURFACE slice (the SAME
 *  "interpolate between two parallel edges" shape `linePieces`' own `buildPiece` already uses for an
 *  ordinary straight run, generalized to two edges of possibly different length -- `oA`-to-`oB` and
 *  `qA`-to-`qB` need not match exactly once one side's own corner is more "extreme" than the
 *  other's, see this file's own `trustO` header): pieces are planned along whichever edge is LONGER
 *  (the shorter edge's own matching slice is then a fraction of its own length, naturally tapering
 *  rather than overshooting it), each slice a quad interpolated at the SAME fractional position on
 *  both edges. */
function buildNotchQuadPatch(d0Near, d0Far, d1Near, d1Far, pitch, nominalJoint, width, sequence, forcedFStart) {
  const len0 = Math.hypot(d0Far.x - d0Near.x, d0Far.y - d0Near.y);
  const len1 = Math.hypot(d1Far.x - d1Near.x, d1Far.y - d1Near.y);
  const totalLen = Math.max(len0, len1);
  if (totalLen < 1e-6) return [[d0Near, d0Far, d1Far, d1Near]];
  const pointAtFrac = (near, far, frac) => ({ x: near.x + (far.x - near.x) * frac, y: near.y + (far.y - near.y) * frac });
  const sliceAt = (sA, sB) => {
    const fA = sA / totalLen, fB = sB / totalLen;
    return [pointAtFrac(d0Near, d0Far, fA), pointAtFrac(d0Near, d0Far, fB), pointAtFrac(d1Near, d1Far, fB), pointAtFrac(d1Near, d1Far, fA)];
  };
  const { lengths, jointWidth } = planCornerRun(totalLen, pitch, nominalJoint, FILL_FRACTIONS, sequence, forcedFStart);
  const spans = [];
  let s = 0;
  for (let i = 0; i < lengths.length; i++) { spans.push({ sA: s, sB: s + lengths[i] }); s += lengths[i] + jointWidth; }
  const clampS = (sv) => Math.max(0, Math.min(totalLen, sv));
  return jointedSlices(spans, totalLen, jointWidth, nominalJoint, pitch * width,
    (sA, sB) => sliceAt(clampS(sA), clampS(sB)), (sv) => [pointAtFrac(d0Near, d0Far, clampS(sv) / totalLen), pointAtFrac(d1Near, d1Far, clampS(sv) / totalLen)]);
}

function buildNotchJoint(primitives, prevIdx, droppedIdx, curIdx, d0, d1, pitch, nominalJoint, width, sequence, forcedFStart) {
  const oA = jointPointAt(primitives, prevIdx, droppedIdx, d0);
  const qA = jointPointAt(primitives, prevIdx, droppedIdx, d1);
  const oB = jointPointAt(primitives, droppedIdx, curIdx, d0);
  const qB = jointPointAt(primitives, droppedIdx, curIdx, d1);
  if (!oA || !qA || !oB || !qB) return null;
  const prevPrim = primitives[prevIdx], curPrim = primitives[curIdx];
  // same KEEP_REF_STEP_IN convention as every ordinary joint above -- prevIdx only ever reads
  // `keepRefAsEnd` (it ENDS at this corner), curIdx only ever reads `keepRefAsStart` (it STARTS
  // here), so the other half of each pair is never consulted; passing the same value for both
  // keeps `mitreLine`'s own shape without a 5th parameter.
  const keepRefA = stepFrom(oA, tangentAt(prevPrim, oA), -KEEP_REF_STEP_IN);
  const keepRefB = stepFrom(oB, tangentAt(curPrim, oB), KEEP_REF_STEP_IN);

  // T86 item 9: the medial line between prevPrim/curPrim, computed ONCE from their own TRUE
  // (depth-0) positions -- `D` is the perpendicular gap (prevPrim's own normal, which by this
  // file's own declared convention already points TOWARD the material/the opposite side, dotted
  // against the vector from prevPrim's own true endpoint to curPrim's own true start). Only
  // meaningful when prevPrim/curPrim genuinely FACE each other (D > 0); a non-positive D means this
  // isn't a facing gap at all (defensive -- falls through to the ordinary, unclamped construction
  // below, same as item 4b's own reverted version, rather than risk a wrong clip on a case this
  // formula was never derived for).
  // T86 item 9 bug (found via the SCALE matrix, a crash at scale=2 -- `curPrim.p0` doesn't exist
  // on an ARC primitive at all; MEASURED directly that this formula is only ever meaningful for a
  // line/line notch anyway, same as `D`'s own existing type guard, just one statement too late).
  const bothLines = prevPrim.type === 'line' && curPrim.type === 'line';
  const junctionA = bothLines ? originalJunctionPoint(prevPrim) : null;
  const junctionB = bothLines ? { x: curPrim.p0.x, y: curPrim.p0.y } : null;
  const D = bothLines ? (junctionB.x - junctionA.x) * prevPrim.nx + (junctionB.y - junctionA.y) * prevPrim.ny : -1;
  const medialDepth = D / 2;

  const dropped = primitives[droppedIdx];
  const [d0Near, d0Far] = tangentialProjection(dropped, oA) <= tangentialProjection(dropped, oB) ? [oA, oB] : [oB, oA];

  if (!(D > 0) || d1 <= medialDepth) {
    // no pinch reached this row -- each side's own TRUE, independent corner is exactly correct
    // (MEASURED: this is the sub-case the reverted attempt already got right in isolation).
    const forPrev = mitreLine(oA, qA, keepRefA, keepRefA);
    const forCur = mitreLine(oB, qB, keepRefB, keepRefB);
    if (!forPrev || !forCur) return null;
    const [d1Near, d1Far] = tangentialProjection(dropped, qA) <= tangentialProjection(dropped, qB) ? [qA, qB] : [qB, qA];
    const kiteFan = buildNotchQuadPatch(d0Near, d0Far, d1Near, d1Far, pitch, nominalJoint, width, sequence, forcedFStart);
    return { isNotch: true, prevIdx, curIdx, forPrev: { ...forPrev, trustO: true }, forCur: { ...forCur, trustO: true }, kiteFan };
  }

  // T86 item 9: the row's own depth has reached (or straddles) the pinch -- truncate BOTH sides at
  // the SAME medial line instead of their own independent corners. MEASURED (not assumed, and a
  // real bug caught this way): the true pinch point is NOT prevPrim's own depth-0 junction shifted
  // by its own normal -- that ignores the DROPPED primitive's own offset motion entirely and lands
  // `medialDepth` further out than reality (CONFIRMED: produced a triangle reaching all the way
  // back to the primitives' own shared depth-0 corner, overlapping 50% with a SHALLOWER band's own
  // ordinary brick that already legitimately occupies that territory, since the dropped primitive
  // is still live there). The true pinch is where `oA(d)` and `oB(d)` -- each primitive's own joint
  // with the DROPPED one, evaluated at a COMMON depth `d` -- coincide; `jointPointAt` already
  // computes exactly `oA(d)`/`oB(d)` for d0/d1, so evaluating it ONCE MORE at `medialDepth` itself
  // (reusing the identical declared function, not a second formula) gives that point directly.
  const medialPoint = jointPointAt(primitives, prevIdx, droppedIdx, medialDepth);
  if (!medialPoint) return null; // defensive: no joint rather than a bad one, same convention as every other null-check in this file
  const medialTangent = tangentAt(prevPrim, medialPoint);
  const medialLineDir = { dirX: medialTangent.x, dirY: medialTangent.y };
  // MEASURED (not assumed): clipping only the ONE piece nearest the joint (using `medialPoint`
  // itself as the reach-bounding point, same as an ordinary corner) is NOT enough -- the two
  // flanking primitives are PARALLEL for their own ENTIRE facing extent, not just at the joint, so
  // EVERY piece whose own tangential span falls anywhere within that facing range needs the SAME
  // clip, not only the boundary one (CONFIRMED: a piece 3 positions back from the joint, still
  // within primB's own facing range, built at the row's own FULL unclamped depth and overlapped
  // the dropped primitive's own clipped territory by 90%). `pointOnD0AtQ` (already declared, used
  // identically by `flatStripToTangent` above) gives the medial-line point at the OTHER side's own
  // far endpoint's tangential position -- extending each side's own clip REACH (`loEnd`/`hiStart`
  // in `linePieces`) to cover the TRUE overlap of the two primitives' own projections, symmetric
  // either way: for the LONGER primitive this is the real facing-range boundary; for the SHORTER
  // one (entirely within the facing range already) it naturally lands past its own far end, which
  // just as correctly makes the clip apply to its own full length.
  const reachA = pointOnD0AtQ(prevPrim, medialDepth, curPrim.p1);
  const reachB = pointOnD0AtQ(curPrim, medialDepth, prevPrim.p0);
  const forPrev = { point: reachA, q: reachA, ...medialLineDir, keepRefAsStart: prevPrim.p0, keepRefAsEnd: prevPrim.p0, trustO: true };
  const forCur = { point: reachB, q: reachB, ...medialLineDir, keepRefAsStart: curPrim.p1, keepRefAsEnd: curPrim.p1, trustO: true };
  // the dropped primitive's own residual sliver, truncated at the SAME medial line and pitch-sized
  // (`buildNotchPatch`, same reasoning as item 3's own arc-patch fix -- see that function's own
  // header) when the row's own outer edge (d0) still has real material (d0 < medialDepth); past
  // that (d0 >= medialDepth) the triangle has degenerated to zero/negative area (oA/oB themselves
  // are already on the far side of the medial line) -- an empty kiteFan is the honest answer
  // there, not a sliver triangle nobody asked for.
  const kiteFan = d0 < medialDepth ? buildNotchPatch(d0Near, d0Far, medialPoint, pitch, nominalJoint, width, sequence, forcedFStart) : [];
  return { isNotch: true, prevIdx, curIdx, forPrev, forCur, kiteFan };
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

/** Cumulative arc length at each `boundary` point, `cum[0]=0`, `cum[last]=` the boundary's own total
 *  length -- the SAME "walk a polyline by length" need `linePieces` gets for free from a straight
 *  line's own single tangent and `voussoirPieces` gets for free from a circle's own constant radius,
 *  but `buildPatch`'s own boundary mixes two flat strips with a densely-tessellated arc, so there is
 *  no single formula; this walks the real (possibly curved) polyline segment by segment. */
function cumulativeLengths(boundary) {
  const cum = [0];
  for (let i = 1; i < boundary.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(boundary[i].x - boundary[i - 1].x, boundary[i].y - boundary[i - 1].y));
  }
  return cum;
}

/** The point at arc length `L` along `boundary` (clamped to its own ends), linearly interpolated
 *  within whichever segment `cum` says contains it -- exact at an existing boundary point, a genuine
 *  new point otherwise (a piece boundary rarely lands exactly on one of the dropped arc's own
 *  tessellation points). */
function pointAtLength(boundary, cum, L) {
  const total = cum[cum.length - 1];
  const clamped = Math.max(0, Math.min(total, L));
  for (let i = 1; i < cum.length; i++) {
    if (clamped <= cum[i] + 1e-9) {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen > 1e-9 ? (clamped - cum[i - 1]) / segLen : 0;
      return { x: boundary[i - 1].x + (boundary[i].x - boundary[i - 1].x) * t, y: boundary[i - 1].y + (boundary[i].y - boundary[i - 1].y) * t };
    }
  }
  return boundary[boundary.length - 1];
}

/** One patch slice's own polygon for the length range `[sA,sB]`: the interpolated cut point at `sA`,
 *  every ORIGINAL boundary point strictly inside the range (preserving the dropped arc's own
 *  tessellated curvature -- using only the two interpolated ends would flatten it to a straight
 *  chord), the interpolated cut point at `sB`, then the shared apex `q` closing the fan. */
function patchSlicePolygon(boundary, cum, sA, sB, q) {
  const pts = [pointAtLength(boundary, cum, sA)];
  for (let i = 0; i < boundary.length; i++) if (cum[i] > sA + 1e-9 && cum[i] < sB - 1e-9) pts.push(boundary[i]);
  pts.push(pointAtLength(boundary, cum, sB));
  pts.push(q);
  return pts;
}

/** The patch filling the WHOLE outer excess around a dropped primitive, down to the single point `q`
 *  (the row's own TRUE d1 corner there -- neither flanking neighbour's own run reaches this far, see
 *  `linePieces`'/`voussoirPieces`' own header for why they deliberately stay `q`-based and plain).
 *  The patch's own OUTER boundary runs, in order: `prevPrim`'s own flat/curved strip from ITS OWN
 *  `q`-based stop out to `A` (the true tangent point with the dropped primitive) -- the dropped
 *  primitive's own TRUE arc from `A` to `B` -- `curPrim`'s own strip from `B` back to ITS OWN
 *  `q`-based stop.
 *
 *  T86 item 3 (advisor review, "the kite-fan pieces ignore pitch -- irregular 0.3-0.8in pieces + thin
 *  fan slivers on the inner soldier band at every T1 shoulder"): previously grouped the boundary's own
 *  POINTS into K roughly-equal-INDEX slices, chosen only to keep each slice's own AREA at or below the
 *  1.2x ceiling -- correct on the ceiling, but blind to the boundary's own wildly uneven point density
 *  (a flat strip contributes 2 points regardless of its own length; the densely-tessellated dropped arc
 *  contributes `EXTENSION_ARC_STEPS`+1 points over whatever its own, often much shorter, true length
 *  is), so equal-INDEX slicing produced equal-POINT-COUNT, not equal-LENGTH, pieces -- MEASURED (not
 *  assumed): 0.263x0.263 next to 0.709x0.566 on the same patch. Now plans the boundary's own TRUE ARC
 *  LENGTH exactly like a normal row -- `planCornerRun` with the SAME declared `sequence`/
 *  `forcedFStart` the straight/arc runs either side of this patch already use (an unbroken L/W/etc.
 *  cycle THROUGH the transition, not a separate un-pitched scheme only here) -- then walks the
 *  boundary's own true polyline (`pointAtLength`/`patchSlicePolygon`) to cut each planned piece at its
 *  own EXACT length, preserving the dropped arc's own real tessellated points wherever a cut doesn't
 *  land on one. `mergeSlivers` still runs afterward on the resulting LENGTH-based spans (same 1/4
 *  floor, 1.2x ceiling as everywhere else) -- a piece near the shared apex `q` is a genuine wedge, and
 *  a short one can still clip to a real sliver regardless of how evenly its own along-boundary length
 *  was planned; this is what "apex fan slivers merged" means, not a second, different defect. */
function buildPatch(prevPrim, curPrim, chain, d0, q, pitch, nominalJoint, width, sequence, forcedFStart, runEnds = null) {
  // T86 item 16d: the runs' RESOLVED inner corners (fanRunEnds); absent = the corner `q` itself (as before)
  const qPrev = (runEnds && runEnds.qPrev) || q, qCur = (runEnds && runEnds.qCur) || q;
  // T86 item 9 (the BEVEL sub-case: a dropped LINE between two NON-parallel sides, where the
  // direct skip-intersection IS defined -- unlike a NOTCH, see `buildNotchJoint`'s own header):
  // the simpler of the two dropped-primitive shapes -- no curve to tessellate, since a straight
  // primitive offset by d0 is still exactly straight. The patch's own middle run is just the
  // segment from A to B directly, with the two flat strips already contributing A/B themselves as
  // their own endpoints (same as the arc case's `tessellateArcSpan(...).slice(1,-1)` dropping its
  // own first/last point for the identical reason -- here there is simply nothing left to drop).
  // T86 item 21b: `chain` = the dropped primitives in walk order, each with its own d0 span
  // `{ prim, from, to }` -- usually ONE (a fillet), and then the middle is exactly the one span above. T8's
  // right-bottom corner at 1.25 in drops TWO (a fillet whose radius 1.253 is the band depth, plus the 1.11 in
  // line after it); the middle then walks every span, joined at their own d0 joints.
  const A = chain[0].from, B = chain[chain.length - 1].to;
  const middle = [];
  chain.forEach(({ prim, from, to }, i) => {
    if (i > 0) middle.push(from); // the joint between this dropped primitive and the one before it
    if (prim.type === 'line') return;
    const off = offsetPrimitive(prim, d0);
    const direction = Math.sign(prim.theta2 - prim.theta1) || 1;
    const thetaA = Math.atan2(from.y - off.cy, from.x - off.cx);
    let thetaB = Math.atan2(to.y - off.cy, to.x - off.cx);
    while ((thetaB - thetaA) * direction < 0) thetaB += direction * 2 * Math.PI;
    while ((thetaB - thetaA) * direction > 2 * Math.PI) thetaB -= direction * 2 * Math.PI;
    middle.push(...tessellateArcSpan(prim, d0, thetaA, thetaB).slice(1, -1));
  });

  const boundary = [
    ...flatStripToTangent(prevPrim, d0, qPrev, A),
    ...middle,
    ...flatStripToTangent(curPrim, d0, qCur, B).reverse(),
  ];
  const cum = cumulativeLengths(boundary);
  const totalLen = cum[cum.length - 1];
  const nominalArea = pitch * width;
  if (totalLen < 1e-6) return [[...boundary, q]]; // degenerate (near-zero-length) patch: one piece, same as a too-small-to-split one below

  const { lengths, jointWidth } = planCornerRun(totalLen, pitch, nominalJoint, FILL_FRACTIONS, sequence, forcedFStart);
  const spans = [];
  let s = 0;
  for (let i = 0; i < lengths.length; i++) {
    spans.push({ sA: s, sB: s + lengths[i] });
    s += lengths[i] + jointWidth;
  }
  // H23 item 76 cont. (advisor review, "each ≥ 1/4 brick; merge otherwise"): a wedge slice sharing the
  // SAME apex `q` can still clip to a real sliver even with an evenly-planned along-boundary length
  // (the apex end of a wedge is inherently narrow) -- the SAME `mergeSlivers` `linePieces`/
  // `voussoirPieces` already use, now over LENGTH-based spans instead of boundary-INDEX ones.
  // T86 item 16d: the first / last dividing line is the run's own end (its d0 end to its resolved corner), so the slice
  // beside it is clipped one joint off that end, parallel to it, all the way in; the slices between still meet at `q`
  const divider = (sv) => [pointAtLength(boundary, cum, sv), sv <= 1e-9 ? qPrev : sv >= totalLen - 1e-9 ? qCur : q];
  return jointedSlices(spans, totalLen, jointWidth, nominalJoint, nominalArea,
    (sA, sB) => patchSlicePolygon(boundary, cum, sA, sB, q), divider);
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
    // 21b: the float-safety extension exists to be clipped back to a joint; an open stroke end has none, so it is not
    // extended (seat E measured the Brush's end bricks overhanging the stroke by exactly CLIP_EPS_IN, 0.02 in)
    const sStartPiece = isVeryFirst && !skipStartExt && jointStart ? sA - CLIP_EPS_IN : sA;
    const sFinishPiece = isVeryLast && !skipEndExt && jointEnd ? sB + CLIP_EPS_IN : sB;
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
    // T86 item 9 (found via the full matrix, template_5's own double_course/butt case): two
    // independent clips on the SAME piece (an ordinary corner's own mitre PLUS ... a notch-adjacent
    // piece's own medial-line clip, when both bound the same small span) can occasionally remove
    // the piece's own material entirely -- `clipToHalfPlane` then returns 0-2 points, a degenerate,
    // not-a-real-polygon result. along-path.js's own equivalent loop already guards on exactly this
    // (`if (polygon.length >= 3)`); this file's own `linePieces` push never did, silently pushing a
    // phantom zero-vertex "piece" that renders nothing but still counts toward areas/ratios
    // elsewhere. Same honest-gap treatment a dropped primitive already gets: no material here,
    // skip it, don't fabricate one.
    if (polygon.length >= 3) {
      const { sampleId, flip } = pickSample(set, seed, 'bricks', nextId);
      const heightOffset = (mulberry32(seedFor(seed, 'bricks-jitter', nextId))() * 2 - 1) * (set.heightJitterIn || 0);
      pieces.push({ id: `${pieceId}-${nextId}`, polygon, pieceId, sampleId, flip, heightOffset });
    }
    nextId++;
  }
  return { pieces, nextId };
}

/** Item 74b: one row's JOINTS alone -- the first, cheap half of `ribbonPieces` (moved here unchanged, so a lay is
 *  byte-identical), exported so a caller can ask which corner cuts a style takes without laying the row's pieces
 *  (contour-bands.js frameCornerEffect). `joints[k]` is the joint before `liveIndices[k]`: a butt/lapped corner's
 *  carries `isButt`, a block's `isBlock`; a mitre, a fan or no joint at all carries neither. */
export function ribbonJoints(primitives, d0, d1, pitch, nominalJoint, cornerStyle = 'mitre', bandIndex = 0, sequence, forcedFStart, closed = true) {
  const n = primitives.length;
  const liveIndices = [];
  for (let i = 0; i < n; i++) if (primitiveLiveAtDepth(primitives, i, d1, closed)) liveIndices.push(i);
  const m = liveIndices.length;

  const joints = liveIndices.map((curIdx, k) => {
    // T86 item 7 (brush -- an OPEN primitive list): the FIRST live primitive's own true start has
    // no wraparound joint to compute at all -- forcing this one slot `null` also, for free, makes
    // the LAST live primitive's own `jointEnd` (which reads this SAME slot via the `(k+1)%m` wrap
    // below) resolve to `null` too, giving BOTH open ends the plain, unmitred "no joint" treatment
    // `linePieces`/`voussoirPieces` already have for a genuinely open end (see their own headers) --
    // a square/butt cut, with no extra construction needed here.
    if (!closed && k === 0) return null;
    const prevIdx = liveIndices[(k - 1 + m) % m];
    // H23 item 76 (advisor review -- MEASURED OOB regression, see WORK-LOG): this joint's own point
    // at the row's OUTER edge is computed below by intersecting `prevIdx`/`curIdx` DIRECTLY, skipping
    // whatever dropped out between them -- correct IF every skipped primitive is ALSO infeasible at
    // d0 (it was never really there at this depth either). WRONG when a skipped primitive is still
    // feasible AT d0 and only drops before d1 (a "transitional" primitive within THIS row): the
    // direct intersection then joins two primitives that, at the TRUE outer edge, are not actually
    // adjacent at all (the transitional one is still physically between them) -- a fictitious point
    // that can land past the board's own true boundary. `trustO` is false whenever this applies --
    // the one case `linePieces`/`voussoirPieces` fall back to `q` alone for that side's own sizing
    // (the "ordinary corner" / "d0-also-infeasible" cases, the vast majority, keep trusting `o`,
    // which is what the original fillet-collapse fix above needed). Walked BEFORE the `o`/`q`
    // computation below (T86 item 9): a NOTCH's own direct skip-intersection doesn't merely need
    // `trustO:false` treatment, it's flat-out undefined (see `buildNotchJoint`'s own header), so
    // `droppedIdx` must already be known before deciding what to do about that.
    let trustO = true, droppedIdx = null;
    for (let idx = (prevIdx + 1) % n; idx !== curIdx; idx = (idx + 1) % n) {
      if (primitiveLiveAtDepth(primitives, idx, d0, closed)) { trustO = false; droppedIdx = idx; break; }
    }
    const o = jointPointAt(primitives, prevIdx, curIdx, d0);
    const q = jointPointAt(primitives, prevIdx, curIdx, d1);
    // T86 item 9: a NOTCH (the dropped primitive's own two flanking neighbours are PARALLEL to each
    // other -- see `buildNotchJoint`'s own header) makes the direct skip-intersection above come back
    // `null`, never merely fictitious -- try the notch construction FIRST, before falling back to
    // "no joint" for the ordinary (genuinely open end) case that null also covers.
    // T86 item 34: a notch is a dropped LINE; a dropped ARC (T18 / T19 6x9 at 1.25 in: an r 1.09 shoulder whose
    // neighbours' offsets never cross) took the notch's straight-chord fans and left the crescent between the chords
    // and the arc bare (0.7 sq in) -- it goes to the patch below, which follows the arc's own outline
    if (droppedIdx !== null && (!o || !q) && primitives[droppedIdx].type === 'line') {
      const notch = buildNotchJoint(primitives, prevIdx, droppedIdx, curIdx, d0, d1, pitch, nominalJoint, d1 - d0, sequence, forcedFStart);
      if (notch) return notch;
    }
    // T86 item 21b: two or more primitives dropped between the neighbours (T8 1.25 in: a fillet + the line after it)
    // can leave the neighbours' own d0 offsets with no crossing at all (`o` null), and returning null here left the
    // corner with no joint and no patch (the neighbour's last piece ran on, the fillet's sector went bare: 0.29 sq in).
    // The patch over the whole dropped chain fills it; the neighbours stay `q`-based, exactly as for one fillet.
    if (droppedIdx !== null && !o && q) {
      const chainIdx = [];
      for (let idx = (prevIdx + 1) % n; idx !== curIdx; idx = (idx + 1) % n) if (primitiveLiveAtDepth(primitives, idx, d0, closed)) chainIdx.push(idx);
      const ends = [prevIdx, ...chainIdx, curIdx];
      const at = ends.slice(1).map((idx, i) => jointPointAt(primitives, ends[i], idx, d0));
      if (at.every(Boolean)) {
        const chain = chainIdx.map((idx, i) => ({ prim: primitives[idx], from: at[i], to: at[i + 1] }));
        const kiteFan = buildPatch(primitives[prevIdx], primitives[curIdx], chain, d0, q, pitch, nominalJoint, d1 - d0, sequence, forcedFStart, fanRunEnds(primitives, prevIdx, curIdx, q, nominalJoint));
        return { point: q, q, dirX: 0, dirY: 0, keepRefAsStart: q, keepRefAsEnd: q, trustO: false, kiteFan, tPrev: tangentAt(primitives[prevIdx], q), tCur: tangentAt(primitives[curIdx], q) };
      }
    }
    if (!o || !q) return null;
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
      const block = buildBlockJoint(primitives, prevIdx, curIdx, o, nominalJoint, d1);
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
    // T86 item 34: the patch walks EVERY primitive dropped between the neighbours, not just the first (T7's roof at
    // 1.5 in drops both roof lines between the hooks; the first one's far tangent point with `curIdx` does not
    // exist, and the corner got no patch -- the whole gable bare, 4.9 sq in on 7x9). One dropped primitive: as before.
    const chainIdx = [];
    for (let idx = (prevIdx + 1) % n; idx !== curIdx; idx = (idx + 1) % n) if (primitiveLiveAtDepth(primitives, idx, d0, closed)) chainIdx.push(idx);
    const ends = [prevIdx, ...chainIdx, curIdx];
    const at = ends.slice(1).map((idx, i) => jointPointAt(primitives, ends[i], idx, d0));
    if (!at.every(Boolean)) return { ...joint, trustO }; // defensive: no patch rather than a bad one
    const chain = chainIdx.map((idx, i) => ({ prim: primitives[idx], from: at[i], to: at[i + 1] }));
    const kiteFan = buildPatch(primitives[prevIdx], primitives[curIdx], chain, d0, q, pitch, nominalJoint, d1 - d0, sequence, forcedFStart, fanRunEnds(primitives, prevIdx, curIdx, q, nominalJoint));
    return { ...joint, trustO, kiteFan, tPrev: tangentAt(primitives[prevIdx], q), tCur: tangentAt(primitives[curIdx], q) };
  });
  return { liveIndices, joints };
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
export function ribbonPieces(primitives, d0, d1, set, orientation, pitch, nominalJoint, seed, pieceId, startId, cornerStyle = 'mitre', bandIndex = 0, sequence, forcedFStart, closed = true, rowIndex = 0, cutEnds = null) {
  const { liveIndices, joints: jointBefore } = ribbonJoints(primitives, d0, d1, pitch, nominalJoint, cornerStyle, bandIndex, sequence, forcedFStart, closed);
  if (liveIndices.length === 0) return { pieces: [], nextId: startId };
  const m = liveIndices.length;

  const halfWidth = (d1 - d0) / 2;

  const pieces = [];
  const sources = []; // T86 16(c) part 2: per piece, the primitive it was offset from (-1: a joint's fan, -2: a quoin)
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
    const rawJointEnd = jointBefore[(k + 1) % m];
    // T86 item 21b, the JOINT RULE: an ordinary mitre is a joint too -- each run clips half a joint short of it
    const onConvexArc = primitives[idx].type === 'arc' && primitives[idx].radialSign > 0;
    // T86 item 5: an open ribbon's first / last run may end on a declared CUT (crossings.js) instead of its plain square end
    const cutStart = !closed && k === 0 && cutEnds && cutEnds.start ? cutJoint(prim, cutEnds.start, d0, d1, 'start') : null;
    const cutEnd = !closed && k === m - 1 && cutEnds && cutEnds.end ? cutJoint(prim, cutEnds.end, d0, d1, 'end') : null;
    const jointStart = cutStart || mitreJointSide(jointBefore[k], jointFor(jointBefore[k], idx), 'keepRefAsStart', nominalJoint / 2, onConvexArc);
    const jointEnd = cutEnd || mitreJointSide(rawJointEnd, jointFor(rawJointEnd, idx), 'keepRefAsEnd', nominalJoint / 2, onConvexArc);
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
    for (let s = 0; s < built.pieces.length; s++) sources.push(idx);
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
        // T86 item 9: same defensive guard as `linePieces`' own push above -- a degenerate
        // (near-zero-length) slice from `buildNotchPatch`/`buildNotchQuadPatch` is an honest "no
        // material here", never a phantom piece.
        if (polygon.length < 3) { nextId++; continue; }
        const { sampleId, flip } = pickSample(set, seed, 'bricks', nextId);
        const heightOffset = (mulberry32(seedFor(seed, 'bricks-jitter', nextId))() * 2 - 1) * (set.heightJitterIn || 0);
        // T86 item 16e: a corner fan's slice declares the apex its fan converges on (fan-centre.js groups by it; additive)
        pieces.push({ id: `${pieceId}-${nextId}`, polygon, pieceId, sampleId, flip, heightOffset, ...(rawJointEnd.q ? { fanApex: { x: rawJointEnd.q.x, y: rawJointEnd.q.y } } : {}) });
        sources.push(-1);
        nextId++;
      }
    }
    // T86 item 1, BLOCK: the quoin corner piece, same deferred-build pattern as `kiteFan` above (see
    // `buildBlockJoint`'s own header for why it can't assign its own id/sample earlier) -- built from
    // its SIZE from QUOIN_SET (geometry, buildBlockJoint), its TEXTURE from the band's own `set` (F35 item 33, seat 37:
    // the app looks a piece's sampleId up in the ELEMENT's set, so a White-rocks sample on a red frame found nothing
    // -- every quoin drew a flat colour with no height detail; Fred wants the quoins in their frame's texture).
    if (rawJointEnd && rawJointEnd.isBlock && rawJointEnd.blockPolygon) {
      const { sampleId, flip } = pickSample(set, seed, 'bricks-block', nextId);
      const heightOffset = (mulberry32(seedFor(seed, 'bricks-block-jitter', nextId))() * 2 - 1) * (set.heightJitterIn || 0);
      pieces.push({ id: `${pieceId}-${nextId}`, polygon: rawJointEnd.blockPolygon, pieceId, sampleId, flip, heightOffset });
      sources.push(-2);
      nextId++;
    }
  }
  // de's own ACCENT levels (proud/recessed motifs for Wall/Frame/Brush) key off per-piece
  // metadata -- field names pending agreement with de (DM), stamped now so every caller gets it
  // for free rather than needing a second pass later. `pieceIndex` is this row's own build-order
  // index (0-based, the SAME order `pieces` is already in -- stable for a given seed, since every
  // upstream choice that could reorder this array is itself seed-deterministic).
  // `sources` rides alongside (never on the pieces: the output shape is unchanged) for contour-bands.js
  // yieldAtMedialLine, which needs each piece's own depth field (or its kind: a fan, a quoin)
  return { pieces: pieces.map((p, pieceIndex) => ({ ...p, bandIndex, rowIndex, pieceIndex })), nextId, sources };
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
/** `prim`'s own SIMPLE (non-mitred) endpoint at `depth` -- just the offset curve's own endpoint,
 *  no intersection with a neighbour involved. Used only as `boundaryAtDepth`'s own fallback when
 *  the TRUE mitred joint can't be found (see its own header) -- a local, approximate corner there
 *  is far better than dropping real geometry over one bad joint. */
function simpleEndpointAtDepth(prim, depth) {
  const off = offsetPrimitive(prim, depth);
  return prim.type === 'line' ? off.p1 : { x: off.cx + off.r * Math.cos(prim.theta2), y: off.cy + off.r * Math.sin(prim.theta2) };
}

// ---------------------------------------------------------------- T86 item 16(c): the band yields at a pinch
// Where a band is deeper than half the local gap (a neck, a waist), offset curves from OPPOSITE sides of the
// contour cross: the boundary at that depth loops back over itself, enclosing an inside-out region (the two
// bands overlapping) and possibly cutting the remaining interior into separate lobes. MEASURED on main: 50 of
// 76 (19 templates x 4 depths) inner boundaries self-intersecting; 18 still after the arc-span fix, all
// opposite-side collisions (T14/T18/T19 from 1 in, more at 1.25/1.5). Standard offset-curve cleanup:
// repeatedly cut off the SMALLEST self-crossing loop; a loop wound against the contour is band overlap and is
// dropped, a loop wound with it is a real pinched-off lobe and is kept. The surviving lobes are joined by
// zero-width bridges -- the same slit technique contour-bands.js ribbonSlitPolygon uses for the ring -- so
// callers still get ONE polygon and every lobe keeps its wall fill.
const PINCH_MIN_AREA = 1e-6; // sq in: a loop smaller than this is numerical noise, not a region

function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return a / 2; // positive = counter-clockwise in math axes
}

function properCrossing(a, b, c, d) {
  const d1x = b.x - a.x, d1y = b.y - a.y, d2x = d.x - c.x, d2y = d.y - c.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-15) return null;
  const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / den;
  const u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { x: a.x + t * d1x, y: a.y + t * d1y };
}

/** The self-crossing whose cut-off loop has the fewest vertices: { loop, rest }, or null when simple. */
function smallestCrossingLoop(p) {
  const n = p.length;
  let best = null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the wrap
      const x = properCrossing(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n]);
      if (!x) continue;
      const inner = j - i, outer = n - inner;
      const size = Math.min(inner, outer);
      if (best && best.size <= size) continue;
      const between = p.slice(i + 1, j + 1); // p[i+1..j]
      const around = [...p.slice(j + 1), ...p.slice(0, i + 1)]; // p[j+1..n-1], p[0..i]
      best = inner <= outer
        ? { size, loop: [x, ...between], rest: [x, ...around] }
        : { size, loop: [x, ...around], rest: [x, ...between] };
    }
  }
  return best;
}

function bridgeLobes(lobes) {
  const sorted = [...lobes].sort((a, b) => Math.abs(polyArea(b)) - Math.abs(polyArea(a)));
  let out = sorted[0];
  for (const lobe of sorted.slice(1)) {
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < out.length; i++) for (let j = 0; j < lobe.length; j++) {
      const d = Math.hypot(out[i].x - lobe[j].x, out[i].y - lobe[j].y);
      if (d < bd) { bd = d; bi = i; bj = j; }
    }
    const rotated = [...lobe.slice(bj), ...lobe.slice(0, bj)];
    out = [...out.slice(0, bi + 1), ...rotated, rotated[0], ...out.slice(bi)];
  }
  return out;
}

/** `points` (a closed polyline that may cross itself) -> one weakly-simple polygon of the regions wound like
 *  `sign` (+1 counter-clockwise, -1 clockwise), or [] when none is left. */
function untangleBoundary(points, sign) {
  let p = points.slice();
  const lobes = [];
  for (let guard = 0; guard < 4 * points.length && p.length >= 3; guard++) {
    const cut = smallestCrossingLoop(p);
    if (!cut) break;
    const a = polyArea(cut.loop);
    if (Math.sign(a) === sign && Math.abs(a) > PINCH_MIN_AREA) lobes.push(cut.loop);
    p = cut.rest;
  }
  const a = polyArea(p);
  if (p.length >= 3 && Math.sign(a) === sign && Math.abs(a) > PINCH_MIN_AREA) lobes.push(p);
  if (!lobes.length) return [];
  return lobes.length === 1 ? lobes[0] : bridgeLobes(lobes);
}

export function boundaryAtDepth(primitives, depth) {
  const points = rawBoundaryAtDepth(primitives, depth);
  if (points.length < 3 || !(depth > 0)) return points;
  // the contour's own winding (depth 0 never crosses itself) says which loops are real interior
  const sign = Math.sign(polyArea(rawBoundaryAtDepth(primitives, 0))) || 1;
  return untangleBoundary(points, sign);
}

function rawBoundaryAtDepth(primitives, depth) {
  const n = primitives.length;
  const liveIndices = [];
  for (let i = 0; i < n; i++) if (primitiveLiveAtDepth(primitives, i, depth)) liveIndices.push(i);
  if (liveIndices.length === 0) return [];
  const m = liveIndices.length;

  // T86 item 16 (advisor dispatch, Fred: "bigger bricks break the engine" -- a real, reproduced
  // crash: core/bricks/layouts/bond.js:141 <- fill-shape.js <- engine.js, on several real templates
  // at larger brick sizes). A primitive can be LIVE (primitiveLiveAtDepth, above) but still have no
  // valid MITRED joint with its own live neighbour at this depth -- `jointPointAt`'s own
  // `curveIntersection` can fail to find a crossing once the band is deep enough that the two
  // primitives' own offset-at-depth curves no longer actually meet near the true original junction
  // (MEASURED: happens when the band depth exceeds roughly half the local gap, at a narrow waist or
  // neck). This used to push that `null` straight into the returned boundary -- silently corrupting
  // `innerPath` many calls before the actual crash (`boardOutline.map(p=>p.x)` in bond.js), with
  // nothing at the crash site pointing back to where the bad data came from.
  //
  // FIRST fix tried here (reverted, logged): drop BOTH primitives flanking any failed joint and
  // rebuild, the same shape as fieldstone.js's own "never drop a cell" fix. MEASURED on the actual
  // repro (template_9, brickLengthIn 1/1.25/1.5): it cascades -- dropping two primitives routinely
  // exposes a NEW joint between their own former neighbours, which also fails, and so on until the
  // live set empties out entirely (an honest empty boundary, never a crash, but far more aggressive
  // than the advisor's own "the band yields WHERE it can't fit" wording asked for -- the whole Wall
  // fill disappearing is its own kind of "void", not a fix for one). Replaced with a LOCAL fallback
  // instead: when a joint fails, use that ONE corner's own simple (non-mitred) offset endpoint --
  // `simpleEndpointAtDepth`, just the offset curve's own end, no neighbour intersection involved --
  // rather than removing real geometry. Every primitive stays in the boundary; only the one corner
  // where the true mitre doesn't exist gets a locally-approximate (not perfectly mitred) point
  // instead of a crash.
  const joints = new Array(m);
  for (let k = 0; k < m; k++) {
    const prevIdx = liveIndices[(k - 1 + m) % m], curIdx = liveIndices[k];
    joints[k] = jointPointAt(primitives, prevIdx, curIdx, depth) || simpleEndpointAtDepth(primitives[prevIdx], depth);
  }

  const points = [];
  for (let k = 0; k < m; k++) {
    const prim = primitives[liveIndices[k]];
    const startPt = joints[k];
    points.push(startPt);
    if (prim.type === 'line') continue;
    // T86 item 16(c): an arc is sampled only BETWEEN its own two joints at this depth -- from the joint
    // with its previous neighbour to the joint with its next -- never across its full depth-0 angle
    // range. MEASURED on T18 (7x9, band 0.75/1 in): the neck's large bottom arc (r 2.633 -> 1.883 at
    // 0.75) meets the short vertical line beside it at a mitred joint well BEFORE its own theta2, and the
    // old full-range samples ran on past that joint and back across the line's offset -- the
    // self-intersecting inner boundary d3 located (WORK-LOG 8326c9f). If the two joints have crossed
    // (the arc is used up at this depth), it contributes no samples, only its start joint.
    const offPrim = offsetPrimitive(prim, depth);
    const endPt = joints[(k + 1) % m];
    const dir = prim.theta2 >= prim.theta1 ? 1 : -1;
    const span = Math.abs(prim.theta2 - prim.theta1);
    const wrap = (a) => { let v = a; while (v > Math.PI) v -= 2 * Math.PI; while (v <= -Math.PI) v += 2 * Math.PI; return v; };
    const angleOf = (pt) => Math.atan2(pt.y - offPrim.cy, pt.x - offPrim.cx);
    // the joints sit near the arc's own two ends, so each is measured LOCALLY from its own end
    const uStart = dir * wrap(angleOf(startPt) - prim.theta1);
    const uEnd = span + dir * wrap(angleOf(endPt) - prim.theta2);
    if (!(uEnd > uStart)) continue;
    for (let s = 1; s < BOUNDARY_ARC_STEPS; s++) {
      const t = prim.theta1 + dir * (uStart + ((uEnd - uStart) * s) / BOUNDARY_ARC_STEPS);
      points.push({ x: offPrim.cx + offPrim.r * Math.cos(t), y: offPrim.cy + offPrim.r * Math.sin(t) });
    }
  }
  return points;
}
