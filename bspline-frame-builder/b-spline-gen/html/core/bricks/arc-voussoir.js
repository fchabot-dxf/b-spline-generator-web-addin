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

const MAX_SEGMENT_ANGLE = (5 * Math.PI) / 180; // H23 item 76: an outer/inner arc edge is sampled
// densely enough that no single straight sub-segment spans more than ~5deg -- a declared smoothness
// floor (not a correctness requirement: EVERY piece boundary here is already geometrically exact
// at its own two radial joints and its own outer/inner radius; this constant only controls how
// closely the drawn polygon's own straight edges hug the true circular arc between those joints).
const MIN_RADIUS_IN = 0.01; // a declared floor (same "don't blow up" pattern as along-path.js's own
// cos floor): a brick's own cross-width can genuinely exceed the available radius at an extremely
// tight bend (a real physical constraint -- a wide brick doesn't fit around a narrow enough curve),
// clamped here to a tiny positive sliver rather than letting the inner radius go to zero or negative.

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
 * @returns {{ pieces: Array, nextId: number }}
 */
export function voussoirPieces(cx, cy, r, theta1, theta2, halfWidth, radialSign, pitch, nominalJoint, set, seed, pieceId, startId) {
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
  let theta = theta1, nextId = startId;
  for (let i = 0; i < lengths.length; i++) {
    const dTheta = (lengths[i] / r) * direction;
    const thetaEnd = theta + dTheta;
    const nSeg = Math.max(1, Math.ceil(Math.abs(dTheta) / MAX_SEGMENT_ANGLE));

    const outerPts = [];
    for (let k = 0; k <= nSeg; k++) {
      const t = theta + (dTheta * k) / nSeg;
      outerPts.push({ x: cx + rOuter * Math.cos(t), y: cy + rOuter * Math.sin(t) });
    }
    const innerPts = [];
    for (let k = nSeg; k >= 0; k--) {
      const t = theta + (dTheta * k) / nSeg;
      innerPts.push({ x: cx + rInner * Math.cos(t), y: cy + rInner * Math.sin(t) });
    }

    const polygon = [...outerPts, ...innerPts];
    const { sampleId, flip } = pickSample(set, seed, 'bricks', nextId);
    const heightOffset = (mulberry32(seedFor(seed, 'bricks-jitter', nextId))() * 2 - 1) * (set.heightJitterIn || 0);
    pieces.push({ id: `${pieceId}-${nextId}`, polygon, pieceId, sampleId, flip, heightOffset });
    nextId++;

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
