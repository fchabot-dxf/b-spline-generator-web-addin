/**
 * core/bricks/band-course.js — PORTABLE (see rng.js). F35 item 8: the per-band pattern picker's own
 * brick generator. `bricksContourBands` (f3's file, contour-bands.js, deliberately UNTOUCHED here)
 * only ever lays out a binary soldier/stretcher switch; this is the separate engine that lays out any
 * `BRICK_PATTERNS` entry of kind 'course' or 'course-alternating' (stretcher/stack/soldier/header/
 * flemish) along a REAL curved band, using f3's own exported `bandFrameAt(primitives)` (u,v) hook.
 * 'tile2d' patterns (herringbone/basketweave) are NOT handled here (library.js's own BRICK_PATTERNS
 * header: "a tile2d CELL's own shape distorting around curvature is a separate, harder question,
 * still open") -- the UI greys them out for Frame bands rather than silently mishandling them.
 *
 * REBUILT TWICE per advisor review. First version sampled a brick's own OUTER edge at several (u,v)
 * points and treated the result as that brick's true shape: "bricks must never bend" -- a piece
 * spanning multiple sample points along a curve is a curved STRIP, not a brick, with no notion of the
 * declared FILL_FRACTIONS piece set, so straight-run piece lengths varied arbitrarily (confirmed: 1/4
 * to ~4 brick lengths in one row) with sliver triangles at every mitre. Second version classified
 * each corner-bounded RUN as a straight line or a TRUE ARC (a 3-point circle fit) and handed an arc
 * run to `arc-voussoir.js`'s own `voussoirPieces` directly -- correct in principle, but MEASURED to
 * fail on T1's own real geometry: a tangent-based corner scan cannot tell "a true sharp corner" from
 * "the natural, continuous curvature of a tight true arc" without very careful threshold tuning
 * (T1's own shoulder fillets are r=0.623in -- tight enough that a scan step's own natural tangent
 * rotation is real, not a corner, but easy to mistune either direction), and a 3-point circle fit on
 * a SHORT span is numerically fragile near a primitive junction. Both failure modes chopped T1's own
 * real fillets into dozens of wrong, tiny, independently-mitred fragments.
 *
 * THIS VERSION never classifies a run's own SHAPE at all, and never fits a circle to more than one
 * piece's own two endpoints. Each ROW is still found the same way (`findRowCorners`, a dense
 * `bandFrameAt` scan recovering every TRUE SHARP corner's exact position, mitre point and tangents,
 * tuned to ignore a true arc's own natural curvature -- see `CORNER_TANGENT_COS_MIN`'s own header).
 * Corners split the row into runs; `planCornerRun` (piece-plan.js, the SAME declared fill-fraction
 * planner the legacy path's own `linePieces`/`voussoirPieces` use) plans each run's own piece lengths
 * along `u` (arc length, exact regardless of whether the underlying geometry is straight, one arc, or
 * several tangent-continuous ones in a row -- `bandFrameAt` already solves that). Each PIECE is then
 * built directly from its own two outer-edge SAMPLES (`bandFrameAt` again, exact, no subdivision --
 * never "bending") plus each sample's own local normal for its inner corners (exact on a straight
 * run; for an arc, exact in the limit and accurate whenever a brick's own length is small relative to
 * the arc's own radius, true for every brick-scale band in this app) -- no run-wide circle needed.
 * Only the run's own TRUE first/last piece is clipped against its own corner's real mitre line
 * (`buildJoint` + `clipToHalfPlane`, the same build-then-clip convention the legacy path already
 * uses), applied to every piece near either end (not just the very first/last) since a row deeper
 * than its own pitch (e.g. `soldier`) can have several consecutive pieces within a corner's own true
 * reach -- clipping a piece that never reaches the mitre line is always a safe no-op.
 */
import { bandFrameAt } from './contour-bands.js';
import { BRICK_PATTERNS, FILL_FRACTIONS } from './library.js';
import { pickSample, planCornerRun } from './piece-plan.js';
import { clipToHalfPlane, isSimplePolygon } from './geometry.js';
import { mulberry32, seedFor } from './rng.js';
import { axisLen } from './layouts/bond.js';

export function rawPerimeter(primitives) {
  let total = 0;
  for (const prim of primitives) {
    total += prim.type === 'arc'
      ? prim.r * Math.abs(prim.theta2 - prim.theta1)
      : Math.hypot(prim.p1.x - prim.p0.x, prim.p1.y - prim.p0.y);
  }
  return total;
}

function dist(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }

/** The true closed-loop perimeter at depth `v`, found empirically via `sample`'s own arc-length `u`
 *  parameter: `bandFrameAt`'s own `u` IS arc length (hand-verified in contour-bands.test.js's own
 *  bandFrameAt block), so the wrap point is simply the smallest u>0 where `sample(u,v)` returns to
 *  `sample(0,v)` -- found by a coarse scan (the primitives' own RAW depth-0 perimeter, computed
 *  directly from their declared line lengths / r*angle, sizes a generous search bound) then a
 *  ternary-search refinement. Uses ONLY `bandFrameAt`'s public sampler -- never contour-bands.js's
 *  own private `enrichPrimitives`/`boundaryAtDepth`. */
export function perimeterAt(sample, v, guess) {
  const p0 = sample(0, v);
  const hi = Math.max(guess * 1.6, 1);
  const steps = 500;
  let bestU = hi, bestD = Infinity;
  for (let i = 1; i <= steps; i++) {
    const u = (hi * i) / steps;
    const d = dist(sample(u, v), p0);
    if (d < bestD) { bestD = d; bestU = u; }
  }
  let lo = Math.max(1e-6, bestU - hi / steps), hiR = bestU + hi / steps;
  for (let iter = 0; iter < 60; iter++) {
    const m1 = lo + (hiR - lo) / 3, m2 = hiR - (hiR - lo) / 3;
    if (dist(sample(m1, v), p0) < dist(sample(m2, v), p0)) hiR = m2; else lo = m1;
  }
  return (lo + hiR) / 2;
}

function lineIntersect(p1, t1, p2, t2) {
  const denom = t1.x * t2.y - t1.y * t2.x;
  if (Math.abs(denom) < 1e-9) return null; // tangent-continuous here -- no real corner
  const s = ((p2.x - p1.x) * t2.y - (p2.y - p1.y) * t2.x) / denom;
  return { x: p1.x + s * t1.x, y: p1.y + s * t1.y };
}

const MITRE_SCALE_CAP = 4; // a near-reversal corner (a sharp hairpin, confirmed to occur on T1's own
// tight waist transitions) sends 1/cos(half-angle) towards infinity -- capping it falls back to a
// plain (un-mitred) normal offset past this point rather than projecting a point wildly far away.

/** The TRUE mitred inner point at a corner, `dv` inward of it -- the bisector of the two flanking
 *  normals, scaled by `1/cos(half the turn angle)` (standard mitre-offset construction). */
function mitreOffset(corner, n1, n2, dv) {
  let bx = n1.nx + n2.nx, by = n1.ny + n2.ny;
  const blen = Math.hypot(bx, by) || 1;
  bx /= blen; by /= blen;
  const cosHalf = bx * n1.nx + by * n1.ny;
  if (Math.abs(cosHalf) < 1 / MITRE_SCALE_CAP) return { x: corner.x + n1.nx * dv, y: corner.y + n1.ny * dv };
  return { x: corner.x + (bx / cosHalf) * dv, y: corner.y + (by / cosHalf) * dv };
}

const CORNER_SCAN_MIN_STEPS = 400;
const CORNER_SCAN_STEP_IN = 0.02; // fine enough that a corner's own recovered `u` is accurate to well
// under a grout width, regardless of how many real corners a template has.

// MEASURED (T1's own real primitives, dumped directly rather than guessed): a TRUE arc's own tangent
// continuously rotates along its length -- that is what "curved" means -- so even a tight-but-genuine
// fillet (T1's own shoulder fillets measure r=0.623in) rotates ~1.8deg over one scan step, nowhere
// close to a real corner. `MIN_FEATURE_RADIUS_IN` sets `CORNER_TANGENT_COS_MIN` so that rotation alone
// never crosses it; a true corner's own tangent jump (tens of degrees, often a near-reversal)
// comfortably does.
//
// MEASURED a 2nd time, after the 0.2in margin above was already shipped: the tangent-continuous
// JUNCTION between T1's own two shoulder-fillet arcs (r=0.623 and r=0.68, where contour-bands.js's own
// boundary-at-depth construction stitches them together) showed an isolated tangent jump of ~9.5deg
// over one scan step -- an IMPLIED local radius of ~0.12in, tighter than the 0.2in margin anticipated,
// so it crossed the threshold and was wrongly scored as a real corner. Unlike the already-documented
// cluster artifact below, this one was a LONE false positive (its nearest neighbour was 0.56in away,
// just outside `CORNER_MERGE_IN`) with nothing to merge into -- it survived as a real (wrong) run
// boundary, clipping a visible, confirmed gap into both flanking runs at that point. Re-measured this
// junction's own effective radius directly rather than re-guessing a margin: 0.1in sits comfortably
// below it (and below every other junction checked on T1) while staying far above a true 90-degree
// corner's own near-zero tangent dot product, so lowering the margin here costs nothing on the
// corners that must still be caught.
const MIN_FEATURE_RADIUS_IN = 0.1;
const CORNER_TANGENT_COS_MIN = Math.cos((CORNER_SCAN_STEP_IN / MIN_FEATURE_RADIUS_IN) * 1.5);

// MEASURED, even after the tuning above: `bandFrameAt`'s own boundary-at-depth construction can still
// show a brief, LOCALISED irregularity in the tessellated polyline right at a primitive junction (a
// `jointPointAt` artifact, not a real corner) -- on T1 this produced a TIGHT CLUSTER of several
// false "corners" within about a quarter-inch of a genuine tangent-continuous fillet/waist boundary,
// each independently (and wrongly) mitred. True corners in this app's own templates are never packed
// this close together, so any cluster within `CORNER_MERGE_IN` collapses to its own single
// representative (`oneLapCorners` below) -- a safe, declared floor, not a silent approximation.
const CORNER_MERGE_IN = 0.5;

/** Row-wide corner detection, done ONCE per row: a single dense scan along this row's own outer
 *  boundary (`v0`), finding every tangent discontinuity, each resolved to its exact (x,y) via
 *  `lineIntersect`, its own mitre point/reach (`mitreOffset`), and the two flanking samples' own
 *  tangent/normal (needed to build the joint at that corner, see `buildJoint` below). Each corner is
 *  listed at three equivalent `u` positions (shifted by -perimeter/0/+perimeter) so a RUN's own
 *  [u0,u1] span -- which can itself be negative or exceed `perimeter` -- is compared against it with
 *  a single, exact numeric range check. */
export function findRowCorners(sample, v0, dv, perimeter) {
  const steps = Math.max(CORNER_SCAN_MIN_STEPS, Math.ceil(perimeter / CORNER_SCAN_STEP_IN));
  const step = perimeter / steps;
  const raw = [];
  let prev = sample(0, v0);
  for (let i = 1; i <= steps; i++) {
    // MEASURED bug: at i===steps, `i*step` is a FLOATING-POINT RECONSTRUCTION of `perimeter` that can
    // land a few ULPs SHORT of the true value, silently skipping the row's own closing-seam corner.
    // Forcing the last comparison to close against `sample(0, v0)` exactly sidesteps that.
    const cur = i === steps ? sample(0, v0) : sample(i * step, v0);
    if (prev.tx * cur.tx + prev.ty * cur.ty < CORNER_TANGENT_COS_MIN) {
      const corner = lineIntersect(prev, { x: prev.tx, y: prev.ty }, cur, { x: cur.tx, y: cur.ty });
      if (corner) {
        const mitre = mitreOffset(corner, prev, cur, dv);
        raw.push({
          u: (i - 0.5) * step, point: corner, mitre,
          reach: Math.hypot(mitre.x - corner.x, mitre.y - corner.y),
          tBefore: { tx: prev.tx, ty: prev.ty }, nBefore: { nx: prev.nx, ny: prev.ny },
          tAfter: { tx: cur.tx, ty: cur.ty }, nAfter: { nx: cur.nx, ny: cur.ny },
        });
      }
    }
    prev = cur;
  }
  const corners = [];
  for (const c of raw) for (const shift of [-perimeter, 0, perimeter]) corners.push({ ...c, u: c.u + shift });
  corners.sort((a, b) => a.u - b.u);
  return corners;
}

/** One lap's worth of corners (u in [0,perimeter)), with any tight CLUSTER (within `CORNER_MERGE_IN`,
 *  see its own header) collapsed to one representative -- the run boundaries for a row. */
export function oneLapCorners(rowCorners, perimeter) {
  const lap = rowCorners.filter((c) => c.u >= -1e-6 && c.u < perimeter - 1e-6).sort((a, b) => a.u - b.u);
  const out = [];
  for (const c of lap) {
    if (out.length && c.u - out[out.length - 1].u < CORNER_MERGE_IN) continue;
    out.push(c);
  }
  // the cluster that wraps past u=perimeter back to the first entry needs the SAME merge, compared
  // circularly (the gap from the last kept corner, through the seam, to the first).
  if (out.length > 1 && (perimeter - out[out.length - 1].u) + out[0].u < CORNER_MERGE_IN) out.pop();
  return out;
}

/** A mitre-line joint object in exactly the shape `clipToHalfPlane` expects ({point, dirX, dirY}, plus
 *  the two `keepRef` points this file's own callers use to pick a side): `point` is the corner's own
 *  true OUTER vertex ("o"), the mitre LINE's own direction is simply o-to-its-own-mitre-point ("q",
 *  already computed by `findRowCorners`/`mitreOffset`). `keepRefAsStart`/`keepRefAsEnd` are a short
 *  step into each flanking run's own extent (the run that STARTS here uses its own forward tangent;
 *  the one that ENDS here steps backward), mirroring `primitive-ribbon.js`'s own identical
 *  convention. */
const KEEP_REF_STEP_IN = 0.05;
function buildJoint(corner) {
  const dx = corner.mitre.x - corner.point.x, dy = corner.mitre.y - corner.point.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    point: corner.point, dirX: dx / len, dirY: dy / len,
    keepRefAsStart: { x: corner.point.x + corner.tAfter.tx * KEEP_REF_STEP_IN, y: corner.point.y + corner.tAfter.ty * KEEP_REF_STEP_IN },
    keepRefAsEnd: { x: corner.point.x - corner.tBefore.tx * KEEP_REF_STEP_IN, y: corner.point.y - corner.tBefore.ty * KEEP_REF_STEP_IN },
  };
}

function makePiece(polygon, set, seed, idRef) {
  const { sampleId, flip } = pickSample(set, seed, 'bricks', idRef.id);
  const heightOffset = (mulberry32(seedFor(seed, 'bricks-jitter', idRef.id))() * 2 - 1) * (set.heightJitterIn || 0);
  const piece = { id: `frame-${idRef.id}`, polygon, pieceId: 'frame', sampleId, flip, heightOffset };
  idRef.id++;
  return piece;
}

/** One piece's own quad, built DIRECTLY from its own two outer-edge samples (exact, no subdivision --
 *  a piece never "bends": its own 4 corners are exactly these, nothing more) plus each sample's own
 *  local normal for the inner corners (exact on a line; accurate on an arc whenever the piece's own
 *  length is small relative to the arc's radius, true for every brick-scale band here).
 *
 *  MEASURED (F35 item 8, advisor round 3): on a CONCAVE arc whose own radius is smaller than `dv`
 *  (T1's own waist fillet, r=0.68in, vs `soldier`'s own row depth, 0.75in -- a real, not contrived,
 *  combination: `soldier` is this app's own DEFAULT single-band preset), projecting each end sample
 *  inward by its own LOCAL normal pushes PAST the arc's own centre of curvature, and the two inner
 *  points cross -- a genuine self-intersecting (bowtie) quad, not just an inaccuracy. This is the
 *  classic inset-offset-past-the-radius problem (the legacy path's own `isArcFeasible`/
 *  `primitiveLiveAtDepth` exists for exactly this), confirmed directly here (`isSimplePolygon` false,
 *  and a visible, measured defect at 1:1). Rather than porting that machinery, this piece's own INNER
 *  depth is capped at the largest value (found by bisection on the one monotonic failure mode a smooth
 *  normal field produces here: the quad is simple up to some critical depth and self-intersecting
 *  beyond it) that keeps it simple -- the piece gracefully stops short of the band's nominal depth in
 *  just this narrow danger zone instead of twisting into a bowtie; everywhere else (dv comfortably
 *  under the local radius) this is a no-op, exactly reproducing the original construction. */
function pieceQuad(sample, uA, uB, v0, dv) {
  const pA = sample(uA, v0), pB = sample(uB, v0);
  const outerA = { x: pA.x, y: pA.y }, outerB = { x: pB.x, y: pB.y };
  const innerAt = (d) => [
    { x: pA.x + pA.nx * d, y: pA.y + pA.ny * d },
    { x: pB.x + pB.nx * d, y: pB.y + pB.ny * d },
  ];
  let [innerA, innerB] = innerAt(dv);
  if (!isSimplePolygon([outerA, outerB, innerB, innerA])) {
    let lo = 0, hi = dv;
    for (let iter = 0; iter < 30; iter++) {
      const mid = (lo + hi) / 2;
      const [testA, testB] = innerAt(mid);
      if (isSimplePolygon([outerA, outerB, testB, testA])) lo = mid; else hi = mid;
    }
    [innerA, innerB] = innerAt(lo);
  }
  return [outerA, outerB, innerB, innerA];
}

/** A corner-bounded run's own pieces: `planCornerRun` (piece-plan.js, the SAME declared fill-fraction
 *  planner the legacy path's own `linePieces`/`voussoirPieces` use) plans the lengths along `u` (exact
 *  arc length, regardless of what the underlying geometry actually is); each piece is then a plain
 *  quad (`pieceQuad`, exact at every interior boundary), clipped against BOTH of the run's own end
 *  corners' mitre lines (`buildJoint` + `clipToHalfPlane`, the same build-then-clip convention the
 *  legacy path already uses) -- every piece, not just the very first/last: MEASURED on a `soldier` row
 *  (depth = a full brickLengthIn, 0.75in, far deeper than that pattern's own 0.2in pitch) that several
 *  consecutive pieces near a corner each reach into the corner's own true mitre reach, not just the
 *  one piece immediately at it; a piece that never reaches a mitre line is simply returned unchanged. */
function buildRun(sample, u0, startCorner, endCorner, v0, dv, pitch, J, set, seed, idRef, perimeter) {
  // MEASURED bug: `u1-u0` inherits each corner's own `u` ESTIMATE, accurate only to within about half
  // a corner-scan step -- tiny, but enough to leave a small gap/overlap at the run's own far end. The
  // two corner POINTS are each an exact line-intersection (independent of scan resolution); their own
  // Euclidean distance is the run's true length WHEN it's a single straight line, and a close-enough
  // approximation otherwise (the real arc-length-via-`u` value, `endCorner.u - u0`, is used for the
  // actual piece PLACEMENT below -- this distance is only the PLANNING input to `planCornerRun`).
  //
  // MEASURED bug (F35 item 8, advisor round 3): the LAST run of a lap wraps from the final corner back
  // to the first one, where `endCorner.u` (near 0) is numerically SMALLER than `startCorner.u` (near
  // `perimeter`) -- `endCorner.u - startCorner.u > 0` is false there, but the "else" branch
  // (`endCorner.u - u0`) is the SAME expression as `endCorner.u - startCorner.u` (`u0 === startCorner.u`
  // always, see the caller), so it produced the SAME negative value instead of the wrapped length. A
  // negative `runLength` reaching `buildFlemishRun` (no `Math.max` floor there, unlike this function)
  // produced a single piece spanning almost the entire wrong direction around the loop -- confirmed
  // directly: a "brick" with 1.03 sq in area (~7x a real one) stretching 6.57in diagonally across the
  // board. Fixed by adding `perimeter` in the wrap case, exactly what "wrapping past the seam" means.
  const trueSpan = endCorner.u - startCorner.u > 0 ? endCorner.u - startCorner.u : endCorner.u - startCorner.u + perimeter;
  const chordLength = Math.hypot(endCorner.point.x - startCorner.point.x, endCorner.point.y - startCorner.point.y);
  const trueU1 = u0 + trueSpan;
  const runLength = Math.max(chordLength, trueU1 - u0); // never SHORTER than the true arc length
  const { lengths, jointWidth } = planCornerRun(runLength, pitch, J, FILL_FRACTIONS);
  const jointStart = buildJoint(startCorner), jointEnd = buildJoint(endCorner);
  const pieces = [];
  let s = 0;
  for (let i = 0; i < lengths.length; i++) {
    const uA = u0 + s, uB = u0 + s + lengths[i];
    let polygon = pieceQuad(sample, uA, uB, v0, dv);
    polygon = clipToHalfPlane(polygon, jointStart, jointStart.keepRefAsStart);
    polygon = clipToHalfPlane(polygon, jointEnd, jointEnd.keepRefAsEnd);
    if (polygon.length >= 3) pieces.push(makePiece(polygon, set, seed, idRef));
    s += lengths[i] + jointWidth;
  }
  return pieces;
}

/** 'course-alternating' (flemish): bond.js's own `flemishRow` textbook unit sequence ([stretcher(L),
 *  header(H)], period L+J+H+J), snapped to a whole number of periods across the run's own true length
 *  (never stretching a BRICK itself, only the period's own small mismatch -- the same "snap to a whole
 *  number" convention used throughout this codebase) -- each sub-unit built the SAME way `buildRun`
 *  builds a course-kind piece (`pieceQuad`, clipped at both ends), since `planCornerRun` itself only
 *  ever plans a single uniform pitch and can't be reused directly for an alternating sequence. */
function buildFlemishRun(sample, u0, startCorner, endCorner, v0, dv, L, H, J, set, seed, idRef, perimeter) {
  // See buildRun's own header for the wraparound bug this fixes the SAME way.
  const trueSpan = endCorner.u - startCorner.u > 0 ? endCorner.u - startCorner.u : endCorner.u - startCorner.u + perimeter;
  const runLength = trueSpan;
  const period = L + J + H + J;
  const count = Math.max(1, Math.round(runLength / period));
  const scaledPeriod = runLength / count;
  const k = scaledPeriod / period;
  const jointStart = buildJoint(startCorner), jointEnd = buildJoint(endCorner);
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const base = u0 + i * scaledPeriod;
    for (const [sA, sB] of [[base, base + L * k], [base + (L + J) * k, base + (L + J) * k + H * k]]) {
      let polygon = pieceQuad(sample, sA, sB, v0, dv);
      polygon = clipToHalfPlane(polygon, jointStart, jointStart.keepRefAsStart);
      polygon = clipToHalfPlane(polygon, jointEnd, jointEnd.keepRefAsEnd);
      if (polygon.length >= 3) pieces.push(makePiece(polygon, set, seed, idRef));
    }
  }
  return pieces;
}

/** A band's own `{pattern, kind, naturalWidth, rows}`, the SAME resolution `bandCourseBricks`' own
 *  loop needs -- exported so a caller doing its own depth bookkeeping across SEVERAL independent
 *  calls (editor-brick-tool.js's own per-band engine split, F35 item 8) never re-derives this
 *  formula, only ever reads it from here. */
export function resolveBandRows(band, L, H) {
  const patternName = band.pattern || 'stretcher';
  const def = BRICK_PATTERNS[patternName] || BRICK_PATTERNS.stretcher;
  const kind = (def.kind === 'course' || def.kind === 'course-alternating') ? def.kind : 'course';
  const pattern = kind === def.kind ? def : BRICK_PATTERNS.stretcher;
  const naturalWidth = kind === 'course-alternating' ? H : axisLen(pattern.crossAxis, L, H);
  const rows = Math.max(1, Math.round(band.widthIn / naturalWidth));
  return { pattern, kind, naturalWidth, rows };
}

/**
 * @param {Array} primitives — the SAME raw closed-contour primitives `bricksContourBands` takes.
 * @param {{widthIn:number, pattern:string}[]} bands — outer -> inner; `pattern` any BRICK_PATTERNS
 *   key of kind 'course'/'course-alternating' (a 'tile2d' entry falls back to 'stretcher' -- the UI
 *   never offers one here, this is just a defensive default, same fallback style `bond.js`'s own
 *   `patternFor` uses).
 * @param {object} set — a library.BRICK_SETS entry (already scale/grout-resolved by the caller, same
 *   convention `bricksContourBands` itself expects of its own `opts.set`).
 * @param {{seed:number, startDepth?:number}} opts — `startDepth` (default 0) offsets every band's own
 *   depth range, letting a caller place this call's own bands AFTER some OTHER already-accounted-for
 *   depth (editor-brick-tool.js's own per-band engine split calls this with the real cumulative depth
 *   of whatever bricksContourBands already rendered ahead of it) -- unlike `bricksContourBands`
 *   itself, which has no such parameter and always starts its own bands at depth 0.
 * @returns {{bricks: Array}} bricks shaped exactly like `ribbonPieces`' own output
 *   ({id, polygon, pieceId, sampleId, flip, heightOffset}) -- drop-in for `drawBricks`.
 */
export function bandCourseBricks(primitives, bands, set, opts) {
  const sample = bandFrameAt(primitives);
  const guess = rawPerimeter(primitives);
  const seed = opts.seed;
  const L = set.brickLengthIn, H = set.brickHeightIn, J = set.grout.widthIn;

  const bricks = [];
  const idRef = { id: 0 };
  let depthSoFar = opts.startDepth || 0;

  bands.forEach((band) => {
    const { pattern, kind, naturalWidth, rows } = resolveBandRows(band, L, H);
    const pitch = kind === 'course-alternating' ? null : axisLen(pattern.pitchAxis, L, H);

    for (let row = 0; row < rows; row++) {
      const v0 = depthSoFar + naturalWidth * row, v1 = v0 + naturalWidth;
      const dv = v1 - v0;
      const perimeter = perimeterAt(sample, v0, guess);
      const rowCorners = findRowCorners(sample, v0, naturalWidth, perimeter);
      const corners = oneLapCorners(rowCorners, perimeter);
      if (corners.length < 2) continue; // degenerate (no real corner found) -- nothing safe to build

      for (let i = 0; i < corners.length; i++) {
        const startCorner = corners[i], endCorner = corners[(i + 1) % corners.length];
        const u0 = startCorner.u;
        const pieces = kind === 'course-alternating'
          ? buildFlemishRun(sample, u0, startCorner, endCorner, v0, dv, L, H, J, set, seed, idRef, perimeter)
          : buildRun(sample, u0, startCorner, endCorner, v0, dv, pitch, J, set, seed, idRef, perimeter);
        bricks.push(...pieces);
      }
    }
    depthSoFar += naturalWidth * rows;
  });

  return { bricks };
}
