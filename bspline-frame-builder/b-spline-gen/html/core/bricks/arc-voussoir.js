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
import { planPieceLengths, pickSample } from './piece-plan.js';
import { clipToHalfPlane } from './geometry.js';

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
// own OVERSIZED sampling range (extendStartIn/extendEndIn, see below) is allowed to push past its
// true edge, converted to angle -- MEASURED to matter on a small-radius arc, where a joint-reach
// linear distance tuned for ordinary declared corners can translate to well over 90deg. 30deg (not a
// looser bound) is itself MEASURED, not guessed: a half-plane clip is only guaranteed to keep a
// polygon simple when the polygon's own boundary crosses the clip line at most twice: past ~45deg of
// extension on T12's own waist arc, the oversized outer+inner annular sector curves back far enough
// to cross the SAME joint line a 2nd time, and clipToHalfPlane's single-pass Sutherland-Hodgman
// produces a self-intersecting "bowtie" instead (CONFIRMED directly: 45deg and below stayed simple
// on that exact case, 60deg did not) -- 30deg keeps real margin below that measured threshold.

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
 * @param {number} [extendStartIn=0] @param {number} [extendEndIn=0] — H23 item 76 (primitive-ribbon.js):
 *   push the FIRST/LAST piece's own geometric sampling range (never the underlying theta walk/length
 *   planning) this many inches further out, so a caller doing its own mitre-clip against a true joint
 *   (see `jointStart`/`jointEnd` below) always has enough raw material to reach it -- the SAME
 *   "extend oversized, then clip" technique along-path.js's own `extrapolatedPointAt` uses for a
 *   straight run's own end piece, just expressed in angle instead of a linear tangent push. 0 (the
 *   default) reproduces the exact prior behaviour for every EXISTING caller (along-path.js's own arc
 *   dispatch, which handles its own corners externally and never wants this).
 * @param {{point:{x,y},dirX:number,dirY:number,keepRefAsStart:{x,y},keepRefAsEnd:{x,y}}|null} [jointStart=null]
 * @param {object|null} [jointEnd=null] — H23 item 76 (primitive-ribbon.js): a true mitre line to clip
 *   this arc's own first/last piece against, plus any piece within `mitreReach` of it (two pieces
 *   approaching the SAME joint from different primitives can overlap directly near it -- the EXISTING
 *   along-path.js technique for declared corners, reused here unchanged). The SAME joint object is
 *   shared by both of the two primitives that meet there, one calling it `jointStart` (the primitive
 *   that STARTS there -- uses `keepRefAsStart`) and the other `jointEnd` (ENDS there -- uses
 *   `keepRefAsEnd`); the two keepRefs are on OPPOSITE sides of the line by construction (each
 *   primitive keeps only its own half of the mitre cut) -- see primitive-ribbon.js's own
 *   `KEEP_REF_STEP_IN` header for why they can't be derived locally here. `null` (the default)
 *   applies NO clipping, identical to every existing caller's prior behaviour.
 * @param {number} [mitreReach=0]
 * @returns {{ pieces: Array, nextId: number }}
 */
export function voussoirPieces(
  cx, cy, r, theta1, theta2, halfWidth, radialSign, pitch, nominalJoint, set, seed, pieceId, startId,
  extendStartIn = 0, extendEndIn = 0, jointStart = null, jointEnd = null, mitreReach = 0,
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
  const { lengths, jointWidth } = planPieceLengths(totalArcLength, pitch, nominalJoint, FILL_FRACTIONS);

  const pieces = [];
  let theta = theta1, nextId = startId, sAlong = 0;
  for (let i = 0; i < lengths.length; i++) {
    const dTheta = (lengths[i] / r) * direction;
    const thetaEnd = theta + dTheta;
    const isFirst = i === 0, isLast = i === lengths.length - 1;
    const sEnd = sAlong + lengths[i];
    // the extension is in ANGLE here (so it moves uniformly in arc-LENGTH regardless of radius),
    // converted from the caller's own linear inches the same way `dTheta` converts piece length --
    // CAPPED at MAX_EXTEND_ANGLE (H23 item 76, primitive-ribbon.js): a joint newly exposed by a
    // DROPPED neighbour (not a declared template corner) can land unusually far from this piece's
    // own nominal edge, and `extendStartIn`/`extendEndIn` are a single linear distance shared by
    // every primitive regardless of radius -- on a SMALL-radius arc that same linear distance can
    // convert to well over 90deg of extension (MEASURED: 1.925in / 1.055in radius = 104.6deg),
    // sweeping the oversized sampling range back past the arc's own start, long before the clip
    // below ever runs. The cap keeps the OVERSIZED-then-clipped technique sane; a joint that
    // genuinely needs more reach than this is a template-geometry case worth a fresh look, not
    // something to paper over with an ever-larger extension.
    const extendAngle = (in_) => Math.min(in_ / r, MAX_EXTEND_ANGLE);
    const sampleThetaStart = isFirst ? theta - extendAngle(extendStartIn) * direction : theta;
    const sampleThetaEnd = isLast ? thetaEnd + extendAngle(extendEndIn) * direction : thetaEnd;
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
    if (jointStart && (isFirst || sAlong < mitreReach)) polygon = clipToHalfPlane(polygon, jointStart, jointStart.keepRefAsStart);
    if (jointEnd && (isLast || totalArcLength - sEnd < mitreReach)) polygon = clipToHalfPlane(polygon, jointEnd, jointEnd.keepRefAsEnd);
    const { sampleId, flip } = pickSample(set, seed, 'bricks', nextId);
    const heightOffset = (mulberry32(seedFor(seed, 'bricks-jitter', nextId))() * 2 - 1) * (set.heightJitterIn || 0);
    pieces.push({ id: `${pieceId}-${nextId}`, polygon, pieceId, sampleId, flip, heightOffset });
    nextId++;

    sAlong = sEnd + jointWidth;
    theta = thetaEnd + (jointWidth / r) * direction;
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
