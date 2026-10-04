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
 */
import { curveIntersection } from './curve-intersect.js';
import { clipToHalfPlane } from './geometry.js';
import { planPieceLengths, pickSample } from './piece-plan.js';
import { isArcFeasible, voussoirPieces } from './arc-voussoir.js';
import { FILL_FRACTIONS } from './library.js';
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
  return { point: o, dirX: dx / len, dirY: dy / len, keepRefAsStart, keepRefAsEnd };
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

/** A straight primitive's own pieces between its d0/d1 offset lines, end pieces extended + mitre-
 *  clipped against `jointStart`/`jointEnd` (either may be `null` at a genuinely open path's own free
 *  end -- never happens for this codebase's always-closed frame contours, but handled honestly
 *  rather than assumed away). */
function linePieces(prim, d0, d1, jointStart, jointEnd, extendBy, mitreReach, pitch, nominalJoint, set, seed, pieceId, startId) {
  const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y;
  const totalLen = Math.hypot(dx, dy);
  if (totalLen < 1e-6) return { pieces: [], nextId: startId };
  const tx = dx / totalLen, ty = dy / totalLen;
  const worldAt = (sVal, depth) => ({ x: prim.p0.x + tx * sVal + prim.nx * depth, y: prim.p0.y + ty * sVal + prim.ny * depth });

  const { lengths, jointWidth } = planPieceLengths(totalLen, pitch, nominalJoint, FILL_FRACTIONS);
  const pieces = [];
  let s = 0, nextId = startId;
  for (let i = 0; i < lengths.length; i++) {
    const sEnd = s + lengths[i];
    const isFirst = i === 0, isLast = i === lengths.length - 1;
    const sStart = isFirst ? s - extendBy : s;
    const sFinish = isLast ? sEnd + extendBy : sEnd;
    let polygon = [worldAt(sStart, d0), worldAt(sFinish, d0), worldAt(sFinish, d1), worldAt(sStart, d1)];
    if (jointStart && (isFirst || s < mitreReach)) polygon = clipToHalfPlane(polygon, jointStart, jointStart.keepRefAsStart);
    if (jointEnd && (isLast || totalLen - sEnd < mitreReach)) polygon = clipToHalfPlane(polygon, jointEnd, jointEnd.keepRefAsEnd);
    const { sampleId, flip } = pickSample(set, seed, 'bricks', nextId);
    const heightOffset = (mulberry32(seedFor(seed, 'bricks-jitter', nextId))() * 2 - 1) * (set.heightJitterIn || 0);
    pieces.push({ id: `${pieceId}-${nextId}`, polygon, pieceId, sampleId, flip, heightOffset });
    nextId++;
    s = sEnd + jointWidth;
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
 * @returns {{ pieces: Array, nextId: number }}
 */
export function ribbonPieces(primitives, d0, d1, set, orientation, pitch, nominalJoint, seed, pieceId, startId) {
  const n = primitives.length;
  const liveIndices = [];
  for (let i = 0; i < n; i++) if (primitiveLiveAtDepth(primitives[i], d1)) liveIndices.push(i);
  if (liveIndices.length === 0) return { pieces: [], nextId: startId };
  const m = liveIndices.length;

  const halfWidth = (d1 - d0) / 2;
  // H23 item 76 (MEASURED, three_band's own cross-row/cross-primitive overlap the advisor flagged):
  // along-path.js's own MITRE_REACH = halfWidth*5 is a PIECE-SCALE reach, correct THERE because that
  // architecture's own row centreline is ALREADY a true mitred offset polygon (offsetPathInward's
  // own per-vertex bisector, exact at any depth) -- MITRE_REACH only had to cover the last few
  // pieces nearest a corner, not the corner's own reach itself. This architecture has no such
  // pre-mitred centreline: EVERY row is independent, and the ONLY thing that keeps a piece from
  // reaching past a corner's own TRUE mitre line is whichever of mitreReach/isFirst/isLast actually
  // triggers the clip -- so mitreReach itself must cover the corner's own full reach, not just a
  // piece-width margin. For a 90deg corner that reach IS exactly `d1` (CONFIRMED: the mitre crosses
  // at s=depth there) -- MEASURED directly: a stretcher row0 piece (halfWidth=0.1, so the OLD
  // halfWidth*5=0.5in reach) sat 0.821in from a real 90deg corner and was never clipped at all,
  // overlapping a DIFFERENT row's own piece on the ADJACENT (differently-oriented) edge, 0.5in
  // short of where it needed to reach. `Math.max(..., d1)` keeps the existing halfWidth*5 margin for
  // shallow rows (already comfortably larger there) and grows it for deep ones, where it matters.
  const mitreReach = Math.max(halfWidth * 5, d1);
  const extendBy = mitreReach + 0.05; // matches along-path.js's own EXTEND_BY formula exactly

  const jointBefore = liveIndices.map((curIdx, k) => {
    const prevIdx = liveIndices[(k - 1 + m) % m];
    const o = jointPointAt(primitives, prevIdx, curIdx, d0);
    const q = jointPointAt(primitives, prevIdx, curIdx, d1);
    if (!o || !q) return null;
    // the SAME joint, approached by its own two DIFFERENT primitives, must keep OPPOSITE sides of
    // its own mitre line (each keeps only its own half of the cut) -- `keepRefAsStart` (stepping
    // FORWARD along `curIdx`'s own tangent at `o`) is for whichever primitive STARTS here;
    // `keepRefAsEnd` (stepping BACKWARD along `prevIdx`'s own tangent at `o`) is for whichever
    // primitive ENDS here.
    const keepRefAsStart = stepFrom(o, tangentAt(primitives[curIdx], o), KEEP_REF_STEP_IN);
    const keepRefAsEnd = stepFrom(o, tangentAt(primitives[prevIdx], o), -KEEP_REF_STEP_IN);
    return mitreLine(o, q, keepRefAsStart, keepRefAsEnd);
  });

  const pieces = [];
  let nextId = startId;
  for (let k = 0; k < m; k++) {
    const idx = liveIndices[k];
    const prim = primitives[idx];
    const jointStart = jointBefore[k];
    const jointEnd = jointBefore[(k + 1) % m];
    const built = prim.type === 'line'
      ? linePieces(prim, d0, d1, jointStart, jointEnd, extendBy, mitreReach, pitch, nominalJoint, set, seed, pieceId, nextId)
      : (() => {
        const centerlineR = prim.r - prim.radialSign * ((d0 + d1) / 2);
        return voussoirPieces(
          prim.cx, prim.cy, centerlineR, prim.theta1, prim.theta2, halfWidth, prim.radialSign,
          pitch, nominalJoint, set, seed, pieceId, nextId, extendBy, extendBy, jointStart, jointEnd, mitreReach,
        );
      })();
    pieces.push(...built.pieces);
    nextId = built.nextId;
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
