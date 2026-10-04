/**
 * core/bricks/arc-voussoir.js — PORTABLE (see rng.js). H23 item 76 (advisor's own exact spec,
 * after item 75's extend-then-clip arc fix proved unstable on the tightest curves -- "Stop
 * extending and clipping rectangles on arcs; that's why each refinement surfaces a new
 * self-intersection. Build arc pieces BY CONSTRUCTION, as voussoirs"):
 *
 *   voussoirPieces(cx, cy, r, theta1, theta2, halfWidth, radialSign, pitch, nominalJoint, set,
 *                   seed, pieceId, startId) -> { pieces, nextId }
 *
 * Builds one TRUE circular arc segment's own bricks directly from the arc's own EXACT centre and
 * radius (never a tessellated-polyline approximation) -- each piece bounded by the band's own
 * EXACT outer/inner offset arcs (same centre, radius ± halfWidth) and two RADIAL joint lines at
 * piece stations along the centreline, with the along-arc gap between consecutive pieces' own
 * angular span standing in for the grout joint (identical in spirit to along-path.js's own
 * `s = sEnd + jointWidth` straight-run convention, just in angle instead of arc-length). No
 * straight-line extrapolation, no clip needed to make a piece reach the true edge -- it's built
 * exactly right the first time, so it CANNOT self-intersect or fall short of the outer contour
 * (along-path.js's own three straight-line-based attempts at this each fixed one failure mode and
 * surfaced another -- MEASURED, see WORK-LOG's own H23 item 75 entry -- because a straight-line
 * approximation fundamentally diverges from a true circle the tighter that circle gets; this file
 * sidesteps the whole problem by never approximating the curve at all).
 *
 * `radialSign` (+1 or -1): whether along-path.js's own 'out' direction convention (the same one
 * `plainPointAt`/`extrapolatedPointAt` use, so a straight run's own last joint and this arc's own
 * first radial line agree) INCREASES or DECREASES radius at this arc -- the caller determines this
 * once (by comparing the tessellated path's own local tangent to the true circle's tangent at one
 * sample point) since it depends on the path's own overall winding direction, not on anything this
 * file computes. The caller is also responsible for `r` already reflecting whatever cumulative
 * band-row depth applies (bricksContourBands' own job) -- this file only ever sees ONE already-
 * correct circle.
 */
import { mulberry32, seedFor } from './rng.js';
import { FILL_FRACTIONS } from './library.js';
import { planCornerRun, mergeSlivers, pickSample } from './piece-plan.js';
import { clipToHalfPlane, signedArea } from './geometry.js';

const MAX_SEGMENT_ANGLE = (5 * Math.PI) / 180; // H23 item 76: an outer/inner arc edge is sampled
// densely enough that no single straight sub-segment spans more than ~5deg -- a declared smoothness
// floor (not a correctness requirement: EVERY piece boundary here is already geometrically exact
// at its own two radial joints and its own outer/inner radius; this constant only controls how
// closely the drawn polygon's own straight edges hug the true circular arc between those joints).
const MIN_RADIUS_IN = 0.01; // a declared floor (same "don't blow up" pattern as along-path.js's own
// cos floor): a brick's own cross-width can genuinely exceed the available radius at an extremely
// tight bend (a real physical constraint -- a wide brick doesn't fit around a narrow enough curve),
// clamped here to a tiny positive sliver rather than letting the inner radius go to zero or negative.
const MAX_EXTEND_ANGLE = Math.PI / 6; // H23 item 76: a declared cap (30deg) on how far an end piece's
// own OVERSIZED sampling range (the small finishing-clip epsilon, see `voussoirPieces`' own
// CLIP_EPS_ANGLE) is allowed to push past its true edge, converted to angle -- a half-plane clip is
// only guaranteed to keep a polygon simple when the polygon's own boundary crosses the clip line at
// most twice: past ~45deg of extension on T12's own waist arc, the oversized outer+inner annular
// sector curves back far enough to cross the SAME joint line a 2nd time, and clipToHalfPlane's
// single-pass Sutherland-Hodgman produces a self-intersecting "bowtie" instead (CONFIRMED directly:
// 45deg and below stayed simple on that exact case, 60deg did not) -- 30deg keeps real margin below
// that measured threshold. The epsilon itself is now tiny (float precision only, now that the piece
// is already planned to reach the true corner), so this cap is a safety backstop, not a live limit.

/** Whether a row's own arc at true radius `r` (already adjusted for this row's own depth, same
 *  convention as `voussoirPieces`' own `r`) can fit a piece of cross-width `2*halfWidth` at all --
 *  the check `voussoirPieces` makes internally before returning `{pieces:[]}`, exported as its own
 *  declared concept so any future caller that needs to know this BEFORE calling voussoirPieces (a
 *  deep convex band whose own row has shrunk past its arc's radius currently just gets an honest
 *  gap there -- skipped cleanly, not a garbage render, but still a gap) always agrees with
 *  voussoirPieces about exactly where the line falls, rather than hand-rolling a second copy of the
 *  same threshold. */
export function isArcFeasible(r, radialSign, halfWidth) {
  return r - radialSign * halfWidth > MIN_RADIUS_IN;
}

/**
 * @param {number} cx @param {number} cy @param {number} r — this ROW's own true centre + radius
 * @param {number} theta1 @param {number} theta2 — start/end angle (radians); direction is sign(theta2-theta1)
 * @param {number} halfWidth — the brick's own cross-dimension / 2
 * @param {number} radialSign — +1 if the 'out' direction increases radius here, -1 if it decreases it
 * @param {number} pitch — one WHOLE piece's own length (brickLengthIn or brickHeightIn, by orientation)
 * @param {number} nominalJoint — the set's own declared grout.widthIn
 * @param {object} set
 * @param {number} seed
 * @param {string} pieceId
 * @param {number} startId — first piece id to use (the caller's own running brick-id counter)
 * @param {{point:{x,y},q:{x,y},dirX:number,dirY:number,keepRefAsStart:{x,y},keepRefAsEnd:{x,y}}|null} [jointStart=null]
 * @param {object|null} [jointEnd=null] — H23 item 76 (primitive-ribbon.js): a true mitre line to clip
 *   this arc's own first/last piece against. The SAME joint object is shared by both of the two
 *   primitives that meet there, one calling it `jointStart` (the primitive that STARTS there -- uses
 *   `keepRefAsStart`) and the other `jointEnd` (ENDS there -- uses `keepRefAsEnd`); the two keepRefs
 *   are on OPPOSITE sides of the line by construction (each primitive keeps only its own half of the
 *   mitre cut) -- see primitive-ribbon.js's own `KEEP_REF_STEP_IN` header for why they can't be
 *   derived locally here. `null` (the default) applies NO clipping, identical to every existing
 *   caller's prior behaviour (along-path.js's own arc dispatch, which handles its own corners
 *   externally and never wants this).
 * @param {number[]} [sequence] — T86 item 2: passed straight through to `planCornerRun` (see its own
 *   header) in the SAME length units as `pitch` itself (inches, never angle) -- `pitch` is already
 *   passed to `planCornerRun` unconverted here (only `effectiveArcLength`, the run's own total, is
 *   ever converted from angle via `r * |dtheta|`), so `sequence` needs no conversion either.
 * @param {number} [forcedFStart] — T86 item 2: ditto, passed straight through (a plain fraction).
 * @returns {{ pieces: Array, nextId: number }}
 */
export function voussoirPieces(
  cx, cy, r, theta1, theta2, halfWidth, radialSign, pitch, nominalJoint, set, seed, pieceId, startId,
  jointStart = null, jointEnd = null, sequence, forcedFStart,
) {
  const direction = Math.sign(theta2 - theta1) || 1;
  const totalArcLength = r * Math.abs(theta2 - theta1);
  if (totalArcLength < 1e-6) return { pieces: [], nextId: startId };

  const rOuter = r + radialSign * halfWidth;
  const rInner = r - radialSign * halfWidth;
  // H23 item 76: a REAL physical constraint, not a construction bug (confirmed correct only AFTER
  // the radialSignAt sign fix below -- the original version of this finding, written against the
  // pre-fix inverted sign, wrongly blamed T12's CONCAVE waist; a concave arc's radius only GROWS
  // with depth and can never trip this floor -- it's a CONVEX arc, like a corner fillet, whose
  // radius shrinks with depth and genuinely can run out of room at a tight enough fillet / deep
  // enough band -- MEASURED on T1/T12's own ~0.62in fillets, even at a single 0.75in band's own
  // depth). Forcing a degenerate near-zero radius floor (an earlier version of this clamp) produced
  // every piece in the segment converging to a single point -- a "pinwheel", worse than simply
  // having no piece there. This declared band genuinely does not fit this curve; skip the WHOLE
  // segment (an honest gap) rather than force a nonsensical shape. Collapsing that gap into a true
  // mitred corner instead (so the two flanking runs meet with no gap at all) was ATTEMPTED and
  // REVERTED this same turn -- it requires knowing, at the collapse point, whether EACH flanking
  // neighbour is a straight run (use its own edge direction) or another true arc like the waist
  // (use that arc's own analytic tangent at the boundary, not a tessellation-chord approximation);
  // treating every neighbour as a straight edge produced a REGRESSION (a ~90% brick overlap on
  // T12's own single_soldier case, where the fillet sits immediately against the waist arc with no
  // straight run between them at all) -- tracked as remaining item 76 scope, not shipped broken.
  if (!isArcFeasible(r, radialSign, halfWidth)) return { pieces: [], nextId: startId };

  // H23 item 76 (advisor review, "the waist's first voussoir should meet on the mitre line"): plan
  // this arc across its TRUE corner-to-corner reach in ANGLE-space, the same "take whichever of a
  // joint's own `o`(d0)/`q`(d1) is the MORE EXTREME" treatment primitive-ribbon.js's own `linePieces`
  // applies to straight runs (see that function's own header, and `planCornerRun`'s in piece-plan.js,
  // for why: an ordinary declared corner's `o`/`q` are close together, but a corner exposed by a
  // DROPPED neighbour -- an infeasible fillet, exactly this item's own "waist" case -- can need `o`
  // far more reach than `q` or vice versa; using only one left the whole excess for one piece to
  // absorb). Convert each to an angle relative to this arc's own centre (never a tangent -- an arc
  // has no single fixed one), unwrapped onto THIS arc's own branch (atan2's own [-pi,pi] wrap could
  // otherwise land a point's angle a full turn away from theta1/theta2).
  const thetaAt = (pt) => Math.atan2(pt.y - cy, pt.x - cx);
  const unwrap = (theta, ref) => {
    let t = theta;
    while (t - ref > Math.PI) t -= 2 * Math.PI;
    while (t - ref < -Math.PI) t += 2 * Math.PI;
    return t;
  };
  // `progress` is a monotonically-increasing (in this arc's own declared direction) scalar, so "more
  // extreme" reduces to a plain min/max regardless of whether direction is +1 or -1 -- same trick
  // `linePieces` uses via its own tangent projection.
  const progress = (pt, ref) => (unwrap(thetaAt(pt), ref) - ref) * direction;
  // `trustO` (computed once per joint in primitive-ribbon.js's own ribbonPieces, see its header):
  // false when `o` is a FICTITIOUS point (a primitive dropped between this joint's own two
  // neighbours is still feasible at d0) -- fall back to `q` alone for that side's own sizing. H23
  // item 76 cont. (advisor review, "they must not stop at the fillet's tangent points"): this run's
  // own piece sequence stays `q`-based ONLY, same as `linePieces`' own identical choice -- see that
  // function's own header for why reaching the true tangent point itself is `ribbonPieces`' own
  // separate `kiteFan` job, never this run's own construction.
  const startProgO = jointStart && jointStart.trustO ? progress(jointStart.point, theta1) : null;
  const startProgQ = jointStart ? progress(jointStart.q, theta1) : 0;
  const endProgO = jointEnd && jointEnd.trustO ? progress(jointEnd.point, theta2) : null;
  const endProgQ = jointEnd ? progress(jointEnd.q, theta2) : 0;
  const thetaStart = theta1 + (startProgO === null ? startProgQ : Math.min(startProgO, startProgQ)) * direction;
  const hiTheta = theta1 + (startProgO === null ? startProgQ : Math.max(startProgO, startProgQ)) * direction; // jointStart's own farthest-forward reach -- past this, no piece can ever be clipped
  const thetaEnd = theta2 + (endProgO === null ? endProgQ : Math.max(endProgO, endProgQ)) * direction;
  const loTheta = theta2 + (endProgO === null ? endProgQ : Math.min(endProgO, endProgQ)) * direction; // jointEnd's own farthest-backward reach
  const effectiveArcLength = r * Math.abs(thetaEnd - thetaStart);
  const { lengths, jointWidth } = effectiveArcLength > 1e-6
    ? planCornerRun(effectiveArcLength, pitch, nominalJoint, FILL_FRACTIONS, sequence, forcedFStart)
    : { lengths: [], jointWidth: nominalJoint };
  const CLIP_EPS_ANGLE = Math.min(0.02 / r, MAX_EXTEND_ANGLE); // see primitive-ribbon.js's own CLIP_EPS_IN

  // build ONE piece's own clipped polygon for an arbitrary [thetaA,thetaB] span -- shared by the
  // normal per-piece build below AND the merge-slivers pass that follows it.
  // H23 item 76 cont. (MEASURED, not assumed -- see primitive-ribbon.js's own `linePieces` header):
  // on a `trustO:false` side, skip the usual float-safety CLIP_EPS_ANGLE extension (and its matching
  // clip) entirely -- there's no valid mitre there any more, and the patch's own strip starts EXACTLY
  // at `q`, not at some clipped approximation of it.
  const buildPiece = (thetaA, thetaB, isVeryFirst, isVeryLast) => {
    const skipStartExt = isVeryFirst && jointStart && !jointStart.trustO;
    const skipEndExt = isVeryLast && jointEnd && !jointEnd.trustO;
    const sampleThetaStart = isVeryFirst && !skipStartExt ? thetaA - CLIP_EPS_ANGLE * direction : thetaA;
    const sampleThetaEnd = isVeryLast && !skipEndExt ? thetaB + CLIP_EPS_ANGLE * direction : thetaB;
    const nSeg = Math.max(1, Math.ceil(Math.abs(sampleThetaEnd - sampleThetaStart) / MAX_SEGMENT_ANGLE));
    const outerPts = [];
    for (let k = 0; k <= nSeg; k++) {
      const t = sampleThetaStart + ((sampleThetaEnd - sampleThetaStart) * k) / nSeg;
      outerPts.push({ x: cx + rOuter * Math.cos(t), y: cy + rOuter * Math.sin(t) });
    }
    const innerPts = [];
    for (let k = nSeg; k >= 0; k--) {
      const t = sampleThetaStart + ((sampleThetaEnd - sampleThetaStart) * k) / nSeg;
      innerPts.push({ x: cx + rInner * Math.cos(t), y: cy + rInner * Math.sin(t) });
    }
    let polygon = [...outerPts, ...innerPts];
    // keepRefAsStart/keepRefAsEnd (computed by the caller, primitive-ribbon.js, from the joint's own
    // point `o` plus a tangent step AT this arc's own radius there) -- not derived locally, since a
    // fixed step from theta1/theta2 only matches `o` when d0=0 (see primitive-ribbon.js's own
    // KEEP_REF_STEP_IN header for the measured reason that breaks on any deeper row).
    // clip-eligibility mirrors `linePieces`' own `s < hiStart` / `sEndPiece > loEnd`: a piece can only
    // ever be touched by a joint's own mitre line while it hasn't yet passed that joint's own farthest
    // reach (`hiTheta`/`loTheta`, the OTHER of its o/q pair) -- comparing PROGRESS (raw angle times
    // `direction`, same monotonic measure used above) keeps this correct regardless of `direction`.
    // `+ 1e-9`: see primitive-ribbon.js's own identical epsilon -- guarantees the very first/last
    // piece is always checked even when a `trustO:false` fallback made hiTheta/loTheta coincide with
    // thetaStart/thetaEnd exactly.
    if (jointStart && !skipStartExt && thetaA * direction < hiTheta * direction + 1e-9) polygon = clipToHalfPlane(polygon, jointStart, jointStart.keepRefAsStart);
    if (jointEnd && !skipEndExt && thetaB * direction > loTheta * direction - 1e-9) polygon = clipToHalfPlane(polygon, jointEnd, jointEnd.keepRefAsEnd);
    return polygon;
  };

  const spans = [];
  let theta = thetaStart;
  for (let i = 0; i < lengths.length; i++) {
    const dTheta = (lengths[i] / r) * direction;
    const pieceThetaEnd = theta + dTheta;
    spans.push({ sA: theta, sB: pieceThetaEnd });
    theta = pieceThetaEnd + (jointWidth / r) * direction;
  }
  mergeSlivers(
    spans,
    (thetaA, thetaB) => Math.abs(signedArea(buildPiece(thetaA, thetaB, thetaA === thetaStart, thetaB === thetaEnd))),
    pitch * halfWidth * 2,
  );

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
 * H23 item 76 FIX (advisor review, after shoulder-fillet bricks on T1/T12 rendered OUTSIDE the
 * board and the waist arc rendered almost empty): the first version of this function decided the
 * sign from the arc's own LOCAL centre-vs-tangent relationship alone, which is the wrong question
 * -- it conflated "is this arc convex or concave" (a LOCAL, per-arc fact) with "which way is
 * inward" (a GLOBAL fact about the whole path's own winding, the same one `inwardSignFor`
 * computes). Those two happen to agree on a path that is convex everywhere (e.g. a plain circle)
 * and DISAGREE on a concave arc -- exactly the waist, and exactly why the old version was inverted
 * there. MEASURED (not re-derived by reasoning a second time): built a CCW circular board and a
 * concave-notch board, offset each inward via the real `offsetPathInward`/`inwardSignFor`, and
 * confirmed this formula's answer against the actual measured before/after distance-to-centre on
 * both -- see tests/bricks-arc-voussoir.test.js's own radialSignAt tests for the equivalent check.
 *
 * `inwardSign`: the path's OWN global inward sign (`inwardSignFor(path)`, computed ONCE for the
 * whole path by the caller) -- never re-derived per arc. Combined with the local tangent, it gives
 * the TRUE "into the material" direction at this sample; `towardCenter > 0` there means moving
 * inward moves TOWARD this arc's own centre, so its radius SHRINKS as depth increases (convex,
 * +1) -- away means the radius GROWS as depth increases (concave, -1). This is also exactly what
 * `rowR = seg.r - seg.radialSign * rowDepth` (contour-bands.js) and `rOuter/rInner = r ±
 * radialSign*halfWidth` (voussoirPieces, above) both assume: `radialSign` is "does more depth-into-
 * material mean a SMALLER true radius".
 */
export function radialSignAt(tangent, sampleX, sampleY, cx, cy, inwardSign) {
  const inX = -tangent.ty * inwardSign, inY = tangent.tx * inwardSign; // the TRUE inward direction here
  const toCenterX = cx - sampleX, toCenterY = cy - sampleY;
  const towardCenter = inX * toCenterX + inY * toCenterY;
  return towardCenter > 0 ? 1 : -1;
}
