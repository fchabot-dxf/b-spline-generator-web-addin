/**
 * core/bricks/along-path.js — PORTABLE (see rng.js). Core primitive #1 of 2 (the advisor's own
 * framing: "bricks are a STYLE any editor element can wear" -- a path/freehand stroke, a lattice
 * rail/tie, or one band of a closed contour frame ALL reduce to this one function):
 *
 *   bricksAlongPath(polyline, opts) -> { bricks: [{id, polygon, pieceId, sampleId, flip,
 *                                                   heightOffset, samples?}] }
 *
 * Declared PROFILE (Fred's own brush option; the advisor's post-gate vocabulary, chosen so P2's
 * ribbon/spine/intersection-graph engine -- its own named next item, NOT built here, see the
 * worker/advisor gate at H23 item 72 -- can slot in later behind this SAME opts shape):
 *   'bricks'     (default) — individual bricks, one per pitch slot, with a real joint between
 *                 each (this is the masonry look -- every brick its own polygon). Named "stripe
 *                 tool"-style ("stripped") in this file's own earlier draft; renamed to match the
 *                 declared profile vocabulary (profile:'bricks'|'continuous'|'ridge').
 *   'continuous' — ONE unbroken band polygon per corner-bounded run (no joints, no per-brick
 *                 geometry): the band's own surface is tagged with a `samples` list (seeded
 *                 sample ids laid end to end along the band's own length, each a fraction of the
 *                 total, "blended at the seams") for a renderer to composite -- the CORE only
 *                 declares the texture plan, it does not rasterize/blend pixels itself. The
 *                 band's own WIDTH is still the brick's natural cross dimension (never stretched
 *                 across it), only the LENGTH axis has no brick-sized subdivision.
 *   'ridge'      — P2's MathieuConnery chiselled-ridge profile (the ribbon engine's own hip/pyramid
 *                 shading). DECLARED, NOT IMPLEMENTED: throws a clear error rather than silently
 *                 falling back to 'bricks' -- no half-wired path.
 *
 * `opts.caps` ('square' default | 'notch'): the stroke END treatment. 'square' is today's
 * behaviour (the path's own ends, no special cap geometry). 'notch' is P2's ribbon-engine
 * V-notch dead-end cap -- DECLARED, NOT IMPLEMENTED, throws rather than silently ignoring it.
 *
 * Bricks/bands are CENTRED on `polyline` -- 'stretcher': length runs along the path (pitch =
 * brickLengthIn, half-width = brickHeightIn/2); 'soldier': length runs ACROSS the path (pitch =
 * brickHeightIn, half-width = brickLengthIn/2).
 *
 * Mitring + corner-snapping ('bricks' profile), H23 item 73(a) design (supersedes an earlier
 * separate-filler-triangle attempt -- see git history / WORK-LOG for why that one still left
 * visible gaps): every REGULAR brick's own quad uses PLAIN, DIRECTIONALLY-EXPLICIT perpendiculars
 * (plainPointAt, 'out' at its own start, 'in' at its own end) -- always a simple, honest, never-
 * stretched rectangle. The path is walked in CORNER-BOUNDED RUNS; the brick at the START and/or
 * END of a run, when that boundary is a real declared corner, is NOT built from the run's own
 * clamped arc-length -- its near/far edge is EXTRAPOLATED, via extrapolatedPointAt, straight along
 * that run's OWN fixed local tangent, a safe distance PAST the corner (not following the path's
 * own bend there, which would twist the quad) -- giving a plain, oversized, still-perfectly-SIMPLE
 * rectangle that's GUARANTEED to reach past the TRUE mitre point on both the inner and outer side,
 * regardless of how short that end brick's own natural pitch slot is. EVERY brick (regular or
 * extended) is then clipped against every nearby corner's own TRUE mitre line (clipToHalfPlane) --
 * a half-plane clip of a simple polygon is ALWAYS simple (this is what makes the construction
 * robust: clipping only ever trims, and the raw material, once deliberately over-sized, always has
 * enough to trim down to the exact right shape). Two adjacent runs' own end bricks, clipped by the
 * SAME corner's own line from opposite sides, meet EXACTLY along it -- Fred's own "two end bricks
 * cut along the diagonal" -- with no separate filler piece needed at all. The general CROSSING/
 * branching case (P2's own ribbon/intersection-graph engine) is deliberately not built here, per
 * the worker/advisor gate on item 72.
 */
import { cumulativeLengths, pointAtArcLength, clipToHalfPlane } from './geometry.js';
import { mulberry32, seedFor } from './rng.js';
import { valueNoise2 } from './noise2d.js';
import { scaledSet, FILL_FRACTIONS } from './library.js';
import { pickSample, planPieceLengths } from './piece-plan.js';
import { voussoirPieces } from './arc-voussoir.js';

function closeLoop(path) { return path.concat([path[0]]); }

/** The point offset by `dist` along the LOCAL MITRED perpendicular to `polyline` at arc-length
 *  `s` (see this file's own header for why a plain single-sided perpendicular under-shoots at a
 *  sharp corner). At an OPEN path's own start/end, only one of incoming/outgoing exists -- that
 *  side's own plain perpendicular is used directly (no bisector, no correction: there is no real
 *  corner there, just the path's own end) rather than letting a degenerate zero-length "missing"
 *  side corrupt the bisector (MEASURED: this produced a 5x-too-wide brick at a path's own start
 *  before this guard existed). For a CLOSED path, s=0 is itself the seam between the last and
 *  first edge -- a real corner, not an end -- so the probe is NOT clamped to [0,total] there; it
 *  goes negative / past total and relies on pointAtArcLength's own modulo wraparound (clamping it
 *  the same way as an open path silently turned this real corner into a fake "no incoming edge"
 *  case, reproducing the SAME under-shoot bug one level up -- MEASURED via a rendered contour-
 *  bands preview showing a 0.375in-wide uncovered wedge at every outer corner before this fix). */
function sidePoint(path, cum, s, total, closed, dist) {
  const eps = Math.min(0.01, total * 0.001) || 0.001;
  const p = pointAtArcLength(path, cum, s, closed);
  const a = pointAtArcLength(path, cum, closed ? s - eps : Math.max(0, s - eps), closed);
  const b = pointAtArcLength(path, cum, closed ? s + eps : Math.min(total, s + eps), closed);
  const tInX = p.x - a.x, tInY = p.y - a.y, lenIn = Math.hypot(tInX, tInY);
  const tOutX = b.x - p.x, tOutY = b.y - p.y, lenOut = Math.hypot(tOutX, tOutY);
  const hasIn = lenIn > 1e-9, hasOut = lenOut > 1e-9;
  let nx, ny;
  if (hasIn && hasOut) {
    const nInX = -tInY / lenIn, nInY = tInX / lenIn;
    const nOutX = -tOutY / lenOut, nOutY = tOutX / lenOut;
    let bx = nInX + nOutX, by = nInY + nOutY;
    const blen = Math.hypot(bx, by);
    if (blen < 1e-9) { bx = nInX; by = nInY; } else { bx /= blen; by /= blen; }
    const cos = Math.max(0.2, bx * nInX + by * nInY); // floored, same as offsetPathInward, to avoid blow-up near a reflex turn
    nx = bx / cos; ny = by / cos;
  } else if (hasOut) {
    nx = -tOutY / lenOut; ny = tOutX / lenOut;
  } else if (hasIn) {
    nx = -tInY / lenIn; ny = tInX / lenIn;
  } else {
    nx = 0; ny = 0; // a fully degenerate (zero-length) path -- no sensible direction
  }
  return { x: p.x + nx * dist, y: p.y + ny * dist };
}

/** The position + unit tangent at arc-length `s`, explicitly in the 'in' (incoming segment's own
 *  tangent) or 'out' (outgoing segment's own tangent) direction -- explicit direction (rather than
 *  trusting pointAtArcLength's own tangent at an exact segment boundary, which always resolves to
 *  the OUTGOING segment) matters at a run's own end/seam: MEASURED, using the wrong (outgoing)
 *  tangent for an 'in'-direction query produced a garbage polygon wrapping a closed path's own
 *  seam. Shared by plainPointAt (position = `s` itself) and extrapolatedPointAt (position pushed
 *  further along this SAME fixed tangent, not following the path). */
function localTangent(path, cum, s, total, closed, direction) {
  const p = pointAtArcLength(path, cum, s, closed);
  const eps = Math.min(0.01, total * 0.001) || 0.001;
  const probeS = direction === 'in'
    ? (closed ? s - eps : Math.max(0, s - eps))
    : (closed ? s + eps : Math.min(total, s + eps));
  const q = pointAtArcLength(path, cum, probeS, closed);
  let tx = direction === 'in' ? p.x - q.x : q.x - p.x;
  let ty = direction === 'in' ? p.y - q.y : q.y - p.y;
  const len = Math.hypot(tx, ty) || 1;
  return { x: p.x, y: p.y, tx: tx / len, ty: ty / len };
}

/** The point offset by `dist` along the PLAIN perpendicular at arc-length `s` -- never blended/
 *  corrected, so it can never "overshoot" a short brick's own near edge. */
function plainPointAt(path, cum, s, total, closed, dist, direction) {
  const { x, y, tx, ty } = localTangent(path, cum, s, total, closed, direction);
  return { x: x - ty * dist, y: y + tx * dist };
}

/** Like plainPointAt, but the POSITION is pushed `extendBy` further along `s`'s own fixed local
 *  tangent first (a straight-line extrapolation, NOT a walk along the path's own arc-length -- the
 *  path may bend at a corner just past `s`, and an end brick hasn't actually turned that corner).
 *  `extendBy` negative pushes backward. Used only to build an END BRICK's own raw (pre-clip) far
 *  edge, deliberately oversized so clipToHalfPlane always has enough material to reach the TRUE
 *  mitre point regardless of how short that brick's own natural pitch slot is. */
function extrapolatedPointAt(path, cum, s, total, closed, dist, direction, extendBy) {
  const { x, y, tx, ty } = localTangent(path, cum, s, total, closed, direction);
  const ex = x + tx * extendBy, ey = y + ty * extendBy;
  return { x: ex - ty * dist, y: ey + tx * dist };
}

/** The TRUE mitre LINE at a corner (a point on it, plus its own direction) -- null when `s` isn't
 *  a real two-sided corner. Used to clip a REGULAR brick that happens to reach close enough to a
 *  corner to cross into the perpendicular run's own territory: every regular brick spans the
 *  band's FULL cross-width, so two bricks approaching the SAME corner from different directions
 *  routinely overlap each other directly near it (MEASURED via a rendered preview AND the
 *  overlap-fraction test below -- not just the filler triangle, the regular bricks themselves). */
function mitreLineAt(path, cum, s, total, closed) {
  const eps = Math.min(0.01, total * 0.001) || 0.001;
  const p = pointAtArcLength(path, cum, s, closed);
  const a = pointAtArcLength(path, cum, closed ? s - eps : Math.max(0, s - eps), closed);
  const b = pointAtArcLength(path, cum, closed ? s + eps : Math.min(total, s + eps), closed);
  const tInX = p.x - a.x, tInY = p.y - a.y, lenIn = Math.hypot(tInX, tInY);
  const tOutX = b.x - p.x, tOutY = b.y - p.y, lenOut = Math.hypot(tOutX, tOutY);
  if (lenIn < 1e-9 || lenOut < 1e-9) return null;
  const nInX = -tInY / lenIn, nInY = tInX / lenIn;
  const nOutX = -tOutY / lenOut, nOutY = tOutX / lenOut;
  let dx = nInX + nOutX, dy = nInY + nOutY;
  const dlen = Math.hypot(dx, dy);
  if (dlen < 1e-9) return null;
  return { point: p, dirX: dx / dlen, dirY: dy / dlen };
}

/**
 * H23 item 75 (advisor, T12's own shoulder/hip arcs): the LOCAL RADIUS OF CURVATURE at arc-length
 * `s`, estimated via the circumradius of 3 nearby points (standard R = abc/(4*area) formula) --
 * Infinity for a straight/collinear run (the common case, cheap to detect: the 3 points' own
 * triangle has ~zero area). Used ONLY to clamp how far an ORDINARY (non-corner) joint's own raw
 * material gets extended before clipping (see `extrapolatedPointAt`'s own header: a straight-line
 * extrapolation, by construction, diverges from the TRUE curve the tighter that curve is) -- NEVER
 * applied to a declared corner's own extension, where the local "radius" is near-zero BY DESIGN (a
 * real kink) and the big, uncapped reach is exactly what's needed to hit the true mitre point
 * (mitreLineAt's own exact clip, not this straight-line estimate, is what makes that correct).
 * MEASURED, directly on T12's own shoulder arc: offsetting the band's centerline inward by more
 * than half that arc's own true radius (0.375 of 0.623) leaves an effective radius of ~0.25in on
 * the offset centerline bricks actually walk -- a single brick's own ORDINARY pitch (0.2in) already
 * sweeps ~45deg of that tight curve, so the old FIXED (corner-sized) extension pushed the raw quad
 * several inches off the true path before any clip saw it, producing an empty/garbage clip result.
 */
function localRadiusAt(path, cum, s, total, closed) {
  const eps = Math.min(0.05, total * 0.01) || 0.05;
  const a = pointAtArcLength(path, cum, closed ? s - eps : Math.max(0, s - eps), closed);
  const b = pointAtArcLength(path, cum, s, closed);
  const c = pointAtArcLength(path, cum, closed ? s + eps : Math.min(total, s + eps), closed);
  const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
  const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)); // 2x triangle area
  if (area2 < 1e-9 || ab < 1e-9 || bc < 1e-9) return Infinity; // collinear (or degenerate) -- straight
  return (ab * bc * ca) / (2 * area2);
}

const SAFE_CURVE_FACTOR = 0.5; // the same "declared floor/clamp, not a blow-up" pattern this file's
// own cos-floor and MITRE_REACH already use -- an extension of up to half the local radius keeps
// the straight-line approximation's own sagitta error comfortably bounded relative to that radius.
//
// H23 item 75 (advisor: "each brick's outer face ON the band's outer edge along arcs"): a 2-point
// chord (just the brick's own start/end) cuts inside a tight curve (MEASURED directly on T12's own
// shoulder: the fanned bricks visibly float short of the true outer contour). A multi-point,
// curve-hugging edge (extra plainPointAt samples between s and sEnd) was ATTEMPTED here and
// reverted: even with a single shared inner-distance clamp per brick (not an independent one per
// sample point, which was the first failure mode), the inner edge still produced a non-monotonic
// zigzag that self-intersects on T12's own tightest curve -- MEASURED through three different
// clamp/extension strategies, each fixing the previous one's own symptom and surfacing a new one.
// Tracked as a known, NOT-YET-FIXED gap (the outer-edge-accuracy complaint specifically), separate
// from the two curvature bugs this item's own extension-clamp fix below DOES resolve cleanly (the
// empty-stretch and stray-shard failures) with zero regressions on the full pre-existing suite.

/**
 * @param {{x:number,y:number}[]} polyline — open or closed (per `opts.closed`) path, board inches
 * @param {object} opts
 * @param {object} opts.set — brickLengthIn/brickHeightIn/grout.widthIn/heightJitterIn/samples
 * @param {'stretcher'|'soldier'} [opts.orientation='stretcher']
 * @param {'bricks'|'continuous'|'ridge'} [opts.profile='bricks']
 * @param {'square'|'notch'} [opts.caps='square']
 * @param {boolean} [opts.closed=false]
 * @param {number[]} [opts.cornerIndices=[]] — indices into `polyline` that must be a boundary
 * @param {number} [opts.scale=1] — uniform multiplier on the set's own brick length/height (grout unaffected)
 * @param {number} opts.seed
 * @param {string} [opts.pieceId='path'] — tag carried onto every produced piece
 * @returns {{ bricks: Array }}
 */
export function bricksAlongPath(polyline, opts) {
  const { seed } = opts;
  const set = scaledSet(opts.set, opts.scale);
  const orientation = opts.orientation || 'stretcher';
  const profile = opts.profile || 'bricks';
  const caps = opts.caps || 'square';
  if (profile === 'ridge') throw new Error('bricksAlongPath: profile "ridge" is declared for P2 (the ribbon/spine engine) and not yet implemented');
  if (caps === 'notch') throw new Error('bricksAlongPath: caps "notch" is declared for P2 (the ribbon/spine engine) and not yet implemented');
  const closed = !!opts.closed;
  const cornerIndices = opts.cornerIndices || [];
  const pieceId = opts.pieceId || 'path';
  const J = set.grout.widthIn;

  const path = closed ? closeLoop(polyline) : polyline;
  const cum = cumulativeLengths(path);
  const total = cum[cum.length - 1];
  if (total < 1e-6) return { bricks: [] };

  const pitch = orientation === 'soldier' ? set.brickHeightIn : set.brickLengthIn;
  const halfWidth = (orientation === 'soldier' ? set.brickLengthIn : set.brickHeightIn) / 2;

  const cornerS = cornerIndices.map((i) => cum[Math.min(i, cum.length - 1)])
    .filter((s) => s > 1e-6 && s < total - 1e-6).sort((a, b) => a - b);

  // H23 item 76 (advisor): `opts.arcSegments` -- declared TRUE circular arcs within this path (the
  // caller's own job to supply, from the real frame primitive data; see arc-voussoir.js's own
  // header). `startIndex`/`endIndex` are polyline point indices, same convention as cornerIndices;
  // `cx`/`cy`/`r`/`theta1`/`theta2` are this ROW's own already-correct exact circle (the caller,
  // e.g. bricksContourBands, has already adjusted `r` for this row's own cumulative band depth --
  // this function never re-derives geometry, it only WALKS what it's given).
  const arcSegments = (opts.arcSegments || []).map((seg) => ({
    ...seg, startS: cum[Math.min(seg.startIndex, cum.length - 1)], endS: cum[Math.min(seg.endIndex, cum.length - 1)],
  }));

  const bricks = [];
  let nextId = 0;

  if (profile === 'continuous') {
    // Fred: "must look NATURAL: no visible seams, no repeating tile." No joints, no per-brick
    // geometry -- but genuinely WOBBLY edges and an undulating height (both pure geometry/math,
    // built here for real) plus a declared BLEND PLAN per segment (crop window, overlap, flip) a
    // renderer composites later -- the actual pixel blending + its own gradient-energy check is a
    // raster/adapter concern (core/bricks/ has no canvas, see this file's own header).
    const EDGE_NOISE_FREQ = 1 / (pitch * 2); // a slow wobble, several pitches per cycle
    const UNDULATION_FREQ = 1 / (pitch * 4);
    const wobblyHalfWidth = (sArc) => {
      const n = valueNoise2(seedFor(seed, 'continuous-edge', 0), sArc * EDGE_NOISE_FREQ, 0) * 2 - 1; // [-1,1]
      return halfWidth * (1 + n * 0.05); // within +/-5% of the width, per the spec
    };
    const quadWobbly = (s, sEnd) => {
      const hwS = wobblyHalfWidth(s), hwE = wobblyHalfWidth(sEnd);
      return [
        sidePoint(path, cum, s, total, closed, hwS), sidePoint(path, cum, sEnd, total, closed, hwE),
        sidePoint(path, cum, sEnd, total, closed, -hwE), sidePoint(path, cum, s, total, closed, -hwS),
      ];
    };

    const bounds = [0, ...cornerS, total];
    const overlapIn = pitch; // "overlap neighbours by >= 1 brick length"
    for (let k = 0; k < bounds.length - 1; k++) {
      const runStart = bounds[k], runEnd = bounds[k + 1];
      if (runEnd - runStart < 1e-6) continue;
      let s = runStart, guard2 = 0;
      while (s < runEnd - 1e-6 && guard2++ < 10000) {
        const sEnd = Math.min(s + pitch, runEnd);
        const id = nextId++;
        const { sampleId, flip } = pickSample(set, seed, 'continuous', id);
        // a random CROP WINDOW -- never the whole sample (never stretched/repeated as a full tile)
        const cropRng = mulberry32(seedFor(seed, 'continuous-crop', id));
        const cw0 = cropRng() * 0.4, ch0 = cropRng() * 0.4; // crop origin in [0, 0.4)
        const cropWindow = { x0: cw0, y0: ch0, x1: cw0 + 0.5 + cropRng() * 0.1, y1: ch0 + 0.5 + cropRng() * 0.1 };
        const undulation = (valueNoise2(seedFor(seed, 'continuous-wave', 0), s * UNDULATION_FREQ, 0) * 2 - 1)
          * (set.heightJitterIn || 0) * 2; // a slow wave, bigger amplitude than per-brick jitter
        bricks.push({
          id: `${pieceId}-run${k}-${id}`,
          polygon: quadWobbly(s, sEnd),
          pieceId,
          sampleId, flip, cropWindow,
          overlapIn,
          heightOffset: undulation,
        });
        s = sEnd; // no joint gap -- the next segment starts exactly where this one ends
      }
    }
    return { bricks };
  }

  // Every declared corner (plus the closed-path seam at arc-length 0, if it's itself a real
  // corner) gets its own TRUE mitre line (mitreLineAt) -- used to trim any brick that reaches
  // close enough to cross into the perpendicular run's own territory, AND (see the run loop below)
  // to cut each run's own END brick exactly at the true cut. The line itself is INFINITE, so each
  // one is only applied to bricks within MITRE_REACH of ITS OWN corner (arc-length, wrapping for a
  // closed path) -- MEASURED, via a rendered preview on a non-square board, that applying it
  // unconditionally sliced bricks clean across a SHORT side, far from either corner, because the
  // far end of a 45deg line from one corner reached the middle of that side.
  const fillerCandidates = closed ? [0, ...cornerS] : cornerS;
  const mitreLines = fillerCandidates
    .map((cs) => ({ cs, line: mitreLineAt(path, cum, cs, total, closed) }))
    .filter((m) => m.line);
  const MITRE_REACH = halfWidth * 5; // matches clipToHalfPlane/sidePoint's own cos-floor worst case (cos>=0.2 -> reach<=dist/0.2)
  const EXTEND_BY = MITRE_REACH + 0.05; // an end brick's own raw material reaches comfortably past MITRE_REACH, so the clip below always has enough to work with
  const arcDistanceToCorner = (s, cs) => {
    const d = Math.abs(s - cs);
    return closed ? Math.min(d, total - d) : d;
  };

  // 'bricks' profile: individual bricks, one per pitch slot, each its own joint, walked in CORNER-
  // BOUNDED RUNS (a run boundary is a real corner unless it's an OPEN path's own true end -- a
  // DECLARED corner must always land exactly on a brick boundary, which is why the walk restarts
  // its own pitch phase at each one, never just pitches straight through).
  //
  // H23 item 74 (de, F35 item 1 review, two findings on T1's own concave waist): regular (non-
  // corner) joints used to be placed by PLAIN, INDEPENDENT local-perpendicular offsets at each
  // brick's own s/sEnd -- correct on a straight or gently-curved run, but on a TIGHT concave bend
  // this breaks two ways at once: (1) the band's own CENTRELINE pitch doesn't match how much
  // shorter the band's own INNER edge gets over that same span, so consecutive bricks' inner
  // corners progressively converge (overlap/self-intersect) while their outer corners diverge
  // (an ever-widening wedge gap, wider than the grout) -- REPRODUCED on the real T1 hourglass
  // frame band (3 self-intersecting bricks per run on the waist, ~0.3-0.9% overlap, ~24-26%
  // uncovered band area, MEASURED). (2) a brick whose own halfWidth exceeds the local radius of
  // curvature there can self-intersect entirely on its own.
  //
  // FIX: generalize item 73(a)'s own corner-mitre technique (proven: "a half-plane clip of a
  // simple polygon is always simple") to EVERY joint, not just declared corners. Every brick is
  // now built the SAME way regardless of what kind of joint bounds it: oversized (extrapolatedPointAt,
  // same as a corner's own end brick), then clipped to mitreLineAt's own line evaluated EXACTLY at
  // its own s (leading) and sEnd (trailing) -- which, for an ordinary smooth-curve point, IS simply
  // the local RADIAL line (perpendicular to the path's own local tangent there -- mitreLineAt's
  // general definition, declared corner or not), so two bricks sharing a joint always clip to the
  // IDENTICAL line and meet EXACTLY, with no gap and no possibility of crossing, however tight the
  // local curvature -- the same guarantee item 73(a) already proved for declared corners, now
  // covering every joint a curve can produce. On a dead-straight run this clip is a no-op (the
  // brick's own corners already sit exactly on that line), so this is a strict generalization, not
  // a behaviour change, for every shape the old code already handled correctly.
  // mitreLineAt returns null ONLY at a genuinely open path's own true start/end (no second side to
  // bisect against) -- there, nothing to clip against, so that one edge stays PLAIN (unextended),
  // same as the path's own raw end always has been.
  // The broader "any nearby DECLARED corner within MITRE_REACH" clip (below) is KEPT as a second,
  // now-redundant-in-theory safety net: with every joint already clipping a brick tight against its
  // own immediate neighbours, a brick several positions from a corner is already fully bounded by
  // that neighbour chain and can't reach the corner's own territory -- but the extra clip costs
  // little and is a no-op once a brick is already correctly bounded, so it stays as insurance
  // against anything this chain-bounding argument hasn't foreseen.
  //
  // H23 item 74 (Fred via advisor, "add half bricks in voids... no arbitrary cut sizes"): a run's
  // own length rarely divides evenly by `pitch` -- planPieceLengths (above) plans each run as whole
  // pieces plus exactly one final piece sized to the nearest declared FILL_FRACTIONS entry, residual
  // mismatch absorbed into that run's own joint width, rather than leaving the old "whatever's
  // left" arbitrary sliver as the final piece. The actual CUT at a non-square edge (an angled
  // corner, a curve) is still the mitre-line clip above/below -- "pick the piece that reaches the
  // edge, then clip it along the edge line" -- the fraction schedule only decides each piece's own
  // nominal size/position, never its final clipped shape.
  // H23 item 75: a run-BOUNDARY end (a real declared corner) still needs the full, uncapped
  // EXTEND_BY -- its own local "radius" is near-zero by design (a kink), and mitreLineAt's own
  // exact clip (not this straight-line estimate) is what correctly reaches the true mitre point
  // regardless of distance. Every OTHER joint in the run gets a curvature-clamped extension instead
  // (localRadiusAt/SAFE_CURVE_FACTOR, this file's own header above).
  // H23 item 76: an arc segment's own start/end are ADDITIONAL forced run boundaries (same
  // mechanical role as a declared corner for the purpose of splitting the walk -- but NOT a corner:
  // no extend+clip mitre there, since "the arc's first radial line IS the straight run's own last
  // joint" by construction, nothing needs reconciling between the two constructions).
  const rawBounds = [0, ...cornerS, ...arcSegments.flatMap((seg) => [seg.startS, seg.endS]).filter((s) => s > 1e-6 && s < total - 1e-6), total].sort((a, b) => a - b);
  const bounds = rawBounds.filter((b, i) => i === 0 || b - rawBounds[i - 1] > 1e-6);
  for (let k = 0; k < bounds.length - 1; k++) {
    const runStart = bounds[k], runEnd = bounds[k + 1];
    if (runEnd - runStart < 1e-6) continue;
    // An arc segment's own edge is NEVER treated as a corner (the advisor: "the arc's first radial
    // line IS the straight run's own last joint") -- same k>0/closed logic as always otherwise.
    const isArcBoundary = (sVal) => arcSegments.some((seg) => Math.abs(seg.startS - sVal) < 1e-6 || Math.abs(seg.endS - sVal) < 1e-6);
    const startIsCorner = (k > 0 || closed) && !isArcBoundary(runStart);
    const endIsCorner = (k < bounds.length - 2 || closed) && !isArcBoundary(runEnd);

    // H23 item 76: a run that exactly matches a declared arc segment is built as TRUE voussoirs
    // (arc-voussoir.js) -- never the straight-line extend+clip construction below, which is correct
    // for a declared corner or a gentle/straight run but diverges from a true circle the tighter it
    // gets (see WORK-LOG's own H23 item 75 entry for the three reverted attempts to patch that
    // instead of sidestepping it).
    const arcSeg = arcSegments.find((seg) => Math.abs(seg.startS - runStart) < 1e-6 && Math.abs(seg.endS - runEnd) < 1e-6);
    if (arcSeg) {
      const { pieces, nextId: afterId } = voussoirPieces(
        arcSeg.cx, arcSeg.cy, arcSeg.r, arcSeg.theta1, arcSeg.theta2, halfWidth, arcSeg.radialSign,
        pitch, J, set, seed, pieceId, nextId,
      );
      for (const p of pieces) bricks.push(p);
      nextId = afterId;
      continue;
    }

    const { lengths: pieceLengths, jointWidth } = planPieceLengths(runEnd - runStart, pitch, J, FILL_FRACTIONS);

    let s = runStart, guard = 0, pieceIdx = 0, isFirst = true;
    while (s < runEnd - 1e-6 && guard++ < 10000) {
      const pieceLength = pieceLengths[Math.min(pieceIdx, pieceLengths.length - 1)];
      const sEnd = Math.min(s + pieceLength, runEnd);
      const isLast = sEnd >= runEnd - 1e-6;

      const startLine = mitreLineAt(path, cum, s, total, closed);
      const endLine = mitreLineAt(path, cum, sEnd, total, closed);
      const startExtend = (isFirst && startIsCorner) ? EXTEND_BY
        : Math.min(EXTEND_BY, localRadiusAt(path, cum, s, total, closed) * SAFE_CURVE_FACTOR);
      const endExtend = (isLast && endIsCorner) ? EXTEND_BY
        : Math.min(EXTEND_BY, localRadiusAt(path, cum, sEnd, total, closed) * SAFE_CURVE_FACTOR);

      const leftStart = startLine
        ? extrapolatedPointAt(path, cum, s, total, closed, halfWidth, 'out', -startExtend)
        : plainPointAt(path, cum, s, total, closed, halfWidth, 'out');
      const rightStart = startLine
        ? extrapolatedPointAt(path, cum, s, total, closed, -halfWidth, 'out', -startExtend)
        : plainPointAt(path, cum, s, total, closed, -halfWidth, 'out');
      const leftEnd = endLine
        ? extrapolatedPointAt(path, cum, sEnd, total, closed, halfWidth, 'in', endExtend)
        : plainPointAt(path, cum, sEnd, total, closed, halfWidth, 'in');
      const rightEnd = endLine
        ? extrapolatedPointAt(path, cum, sEnd, total, closed, -halfWidth, 'in', endExtend)
        : plainPointAt(path, cum, sEnd, total, closed, -halfWidth, 'in');

      let polygon = [leftStart, leftEnd, rightEnd, rightStart];
      const mid = (s + sEnd) / 2;
      const refPoint = pointAtArcLength(path, cum, mid, closed);
      if (startLine && polygon.length >= 3) polygon = clipToHalfPlane(polygon, startLine, refPoint);
      if (endLine && polygon.length >= 3) polygon = clipToHalfPlane(polygon, endLine, refPoint);
      for (const { cs, line } of mitreLines) {
        if (polygon.length < 3) break;
        if (arcDistanceToCorner(mid, cs) > MITRE_REACH) continue;
        polygon = clipToHalfPlane(polygon, line, refPoint);
      }

      if (polygon.length >= 3) {
        const id = nextId++;
        const { sampleId, flip } = pickSample(set, seed, 'bricks', id);
        const heightOffset = (mulberry32(seedFor(seed, 'bricks-jitter', id))() * 2 - 1) * (set.heightJitterIn || 0);
        bricks.push({ id: `${pieceId}-${id}`, polygon, pieceId, sampleId, flip, heightOffset });
      }
      s = sEnd + jointWidth;
      pieceIdx++;
      isFirst = false;
    }
  }
  return { bricks };
}
