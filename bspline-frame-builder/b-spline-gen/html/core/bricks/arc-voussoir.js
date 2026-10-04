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
  // H23 item 76: a REAL physical constraint, not a construction bug -- MEASURED directly on T12's
  // own waist arc (true radius 0.68in): a single_soldier band's own full 0.75in cross-width needs
  // an inner-edge radius of r-0.75, which goes NEGATIVE there (the band's own inner edge would have
  // to pass through the arc's own centre and out the other side). Forcing a degenerate near-zero
  // radius floor (the earlier version of this clamp) produced every piece in the segment converging
  // to a single point -- a "pinwheel", visually far worse than simply having no piece there. This
  // declared band genuinely does not fit this curve; skip the WHOLE segment (an honest gap, not a
  // garbage render) rather than force a nonsensical shape. A narrower band/orientation at the
  // tightest point of a template is the real fix, tracked separately -- not something any single
  // piece's own construction can paper over.
  if (rInner <= MIN_RADIUS_IN) return { pieces: [], nextId: startId };
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
 * Which way along.path.js's own 'out' perpendicular convention (plainPointAt/extrapolatedPointAt,
 * `{x: x - ty*dist, y: y + tx*dist}` for a FORWARD tangent (tx,ty)) moves relative to an arc's own
 * TRUE centre -- +1 if a positive `dist` INCREASES distance from (cx,cy) there, -1 if it decreases
 * it. Determined empirically from the tessellated path's own local tangent at one sample point
 * (matching `localTangent`'s own probe technique) rather than assumed from winding direction, so
 * this works regardless of how any given template's own primitives happen to be wound.
 */
export function radialSignAt(tangent, sampleX, sampleY, cx, cy) {
  const outX = -tangent.ty, outY = tangent.tx; // along-path.js's own 'out' perpendicular, dist=+1
  const toCenterX = cx - sampleX, toCenterY = cy - sampleY;
  const towardCenter = outX * toCenterX + outY * toCenterY; // >0 means 'out' points TOWARD the centre (radius decreases)
  return towardCenter > 0 ? -1 : 1;
}
