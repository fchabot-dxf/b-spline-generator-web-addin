/**
 * core/bricks/layouts/fieldstone.js — PORTABLE (see rng.js). The 'fieldstone' layout (H23 item
 * 74c, advisor: "Poisson-disc seeds -> Voronoi clipped, shrunk by half grout, slightly rounded
 * corners") -- irregular, organically-shaped stone cells, in contrast to bond.js's own rectangular
 * grid.
 *
 * Unlike bond.js, this layout's own GEOMETRY is itself random (stone placement), not just the
 * downstream piece/suppression/sample choices -- so, uniquely among the layouts here, it needs its
 * own `seed`. The point generator (Bridson's Poisson-disc algorithm) is an inherently SEQUENTIAL
 * process -- the point SET is built incrementally, each draw depending on what's already placed --
 * so it deliberately uses ONE continuous mulberry32 stream for the whole pass, unlike every other
 * per-cell decision in this engine (pieces/suppression/samples), which always mints an independent
 * stream per (purpose, cellId) specifically so results never depend on draw order/count. That
 * independence doesn't apply here (there's no "cellId" yet, the draws ARE what builds the cells),
 * but it's still fully deterministic: same seed + same shape + same spacing -> the same point set.
 *
 * `set.brickLengthIn` is reused as the Poisson-disc TARGET SPACING (not a literal brick length --
 * keeping the declared vocabulary uniform across every set/layout rather than adding a parallel
 * field for one layout); `set.brickHeightIn` is unused by this layout. A stone's own Voronoi cell
 * size emerges organically from local point density, which is why only ONE spacing number is
 * needed (no separate "stone width/height").
 *
 * Cells have NO multi-stone "piece" grouping (real fieldstone has no equivalent of a brick
 * "course") -- `neighbors` is left EMPTY on every cell so pieces.js's own adjacency-chain walk
 * (`cell.neighbors.below`) can never grow past 1 cell, naturally reducing every piece to a lone
 * 'single' (pieces.js, suppression.js, samples.js are otherwise fully reused UNCHANGED -- they
 * only ever needed `.id`/`.cx`/`.cy`/`.courseIndex`/`.neighbors`, never rectangle geometry).
 * `courseIndex` is a coarse ROW ESTIMATE (Y-position quantised by the target spacing) purely so
 * suppression's own top-biased scoring still means something for an irregular wall.
 *
 * Shape-boundary handling matches bond.js's own documented approach (see bond.js's header and
 * geometry.js's `clipPolygonToBoard`): an EXACT cut always, convex or concave `boardOutline` alike
 * (H23 item 76 cont.).
 *
 * T86 item 6 (Fred: "fieldstone should also have a lot of smaller stones to fit in voids", then
 * "shouldn't the spacing be irregular, so medium stones can be in the centre too"): the original
 * single-size version left big grey gaps, esp. near the frame's own inner edge and at the waist.
 * Rejected and reworked twice before this version (advisor review):
 *
 * 1. A multi-pass attempt (coarse pass, then finer "void-fill" passes layered on top, each pass's
 *    cells FROZEN once built) produced real overlap between big and small stones -- a frozen cell's
 *    own raw Voronoi reach, in a direction with no OTHER same-pass neighbour, can extend well past
 *    where a LATER, finer pass's point gets bisector-clipped against it, so "stay outside the frozen
 *    point's own bisector" is NOT the same thing as "stay outside the frozen point's own actual
 *    territory" whenever that territory is unusually large (exactly the sparse, void-prone regions
 *    this item is trying to fill). Multiple passes, however carefully bisector-clipped, cannot avoid
 *    this without an actual polygon-subtraction step this codebase doesn't have.
 * 2. A single variable-density Poisson-disc pass (one seed stream, each seed's own target radius
 *    drawn from the noise field as it's generated) sidesteps the freezing problem, but Bridson's own
 *    "grow candidates from an active point at a distance based on ITS OWN radius" step turned out
 *    numerically unstable once radius varies seed-to-seed (a small-radius active point proposes
 *    candidates far too close to where a same-size neighbour would need to sit) -- small parameter
 *    changes swung coverage anywhere from 0% to 92% with no stable middle ground found.
 *
 * This version keeps the SHAPE guarantee that made (2) worth pursuing -- a single POWER DIAGRAM
 * (`powerCell`, a weighted generalisation of the plain Voronoi diagram `voronoiCell` already used:
 * weight = seed's own target radius squared, so a seed's own cell naturally grows or shrinks with
 * its own declared size) built over EVERY seed TOGETHER, in one shot, so no cell is ever frozen
 * before a later seed can be weighed against it -- while sidestepping (2)'s own instability by
 * generating seeds with PER-TIER fixed-radius Bridson passes (`poissonDiscSample`, largest tier
 * first) instead of one single variable-radius stream: each pass's own growth distance matches its
 * OWN tier's radius exactly, the well-tested case, and a `gate(x,y)` callback restricts each pass to
 * where a shared low-frequency noise field (`tierAt`) says that tier belongs, so large/medium/small
 * still mix across the whole board by POSITION (any tier can seed anywhere its own gate allows) even
 * though each tier's own seeds are placed in their own dedicated pass. A power diagram's own bisector
 * between two sites is STILL a straight line (just offset from the midpoint by the sites' own weight
 * difference, not necessarily centred) -- the textbook result that makes this a small, precise
 * generalisation of the SAME `clipToHalfPlane` sequential half-plane clip every other cell-boundary
 * construction in this file already uses, not a new geometry algorithm. Being a true tessellation
 * (exactly like a plain Voronoi diagram, just weighted), a power diagram has NO OVERLAP BY
 * CONSTRUCTION -- but getting there also needed two more fixes, each found by measuring actual
 * overlap/coverage rather than trusting the construction alone (see `poissonDiscSample`'s own
 * "disconnected blob" comment and `fieldstoneLayout`'s own `neighborRadius` comment), plus a third
 * fix for the size-tier noise field's own non-uniform statistics (see `uniformizeNoise`). All three
 * are measured, reproducible bugs this file's own test suite (`tests/bricks-fieldstone.test.js`)
 * now guards against directly -- not merely "should be fine by construction."
 *
 * SECOND advisor review, after the overlap fix above landed: (a) the grout SHRINK step
 * (`offsetPathInward`, applied to the WHOLE finished cell including whatever edge had just been cut
 * flush against the board's own true outline) could flip a short edge near a concave feature (the
 * waist) into a bowtie instead of collapsing it, and the cell was DROPPED rather than fixed -- a
 * real, visible void, not a grout-ceiling. Fixed by baking the shrink into `powerCell`'s own
 * bisector (a plain line shift, can never self-intersect) instead of a separate post-hoc offset, and
 * by never actually dropping a surviving seed's TERRITORY: an undersized/degenerate cell's own seed
 * is removed and the power diagram rebuilt over what's left, so neighbouring seeds naturally absorb
 * the vacated space (a true tessellation always sums to the full region) -- "merge into the
 * neighbour" without an actual polygon-union operation. (b) Gating each tier to its OWN spatial
 * noise-blob produced visible size ZONING (all-small in the middle, all-large at the edges) once the
 * noise frequency was raised to mix sizes more -- a blob at "1-2 large-stone diameters" is barely
 * bigger than a large stone itself, so a large seed's own full packing clearance routinely reached
 * past its own blob into a neighbouring one, starving it regardless of the nominal space split.
 * Fixed per the advisor's own alternative suggestion: `tierAt` now blends the smooth spatial field
 * with a FRESH per-candidate random draw (`NOISE_BIAS`, mostly random, gently noise-biased), so a
 * tier's own candidates are not confined to hard spatial regions at all -- any tier can succeed
 * anywhere real geometric room exists, with only a gentle large-scale tendency left over.
 */
import {
  pointInPolygon, clipToHalfPlane, clipPolygonToBoard, roundPolygonCorners, signedArea, polygonDifference, isSimplePolygon,
} from '../geometry.js';
import { mulberry32, seedFor, hashedRandom } from '../rng.js';
import { MIN_PIECE_FRACTION } from '../library.js';

const POISSON_ATTEMPTS = 60; // raised from Bridson's own typical 30 (MEASURED): a noise-gated tier's
// own candidates fail more often near a region boundary than an ungated pass's would, so more tries
// per active point meaningfully improves fill density within each tier's own gated blob.
const MAX_POINTS = 4000; // a safety cap on runaway input (spacing far too small for the shape), not a feature
const NEIGHBOR_RADIUS_FACTOR = 3; // a Voronoi cell's true neighbours are typically within ~2x the Poisson spacing;
// 3x is a generous, declared safety margin (matches the "cos floor"/MITRE_REACH style of bounded-not-exact headroom
// already used elsewhere in this engine) so no real neighbour is ever missed -- MEASURED: sweeping
// this factor from 2 to 8 on a 9x12 board produced IDENTICAL coverage/overlap every time (the true
// Voronoi neighbour set was already fully captured at the low end), so 3 is kept for a safety
// margin without the wasted O(n) candidate-filtering a larger factor costs for no geometric gain.
const CORNER_RADIUS_FACTOR = 0.12; // "slightly rounded" -- a declared layout-internal constant (not a per-set
// tunable; the task only called out grout/Poisson/Voronoi/shrink as set-level concerns)

// T86 item 6 rework (advisor, after the overlap finding + Fred: "shouldn't the spacing be irregular,
// so medium stones can be in the centre too"): three declared SIZE TIERS, each a fraction of the
// main `brickLengthIn` spacing and a TARGET share of the covered area -- "large 50% / medium 35% /
// small 15%" per the advisor's own example. `areaShare` is read as the low-frequency noise field's
// own bucket width (see `tierAt`), not a hard-enforced output quota: the power diagram's actual area
// split also depends on each seed's local neighbour configuration, so the real split is MEASURED
// (see the "cell-size histogram" test) rather than forced. A future 4th tier is one more array entry.
const SIZE_TIERS = Object.freeze([
  { name: 'large', fraction: 1, areaShare: 0.5 },
  { name: 'medium', fraction: 0.5, areaShare: 0.35 },
  { name: 'small', fraction: 0.25, areaShare: 0.15 },
]);
// `tierAt`'s own candidate-draw shares, distinct from `SIZE_TIERS[i].areaShare` above (the declared
// OUTPUT target the histogram test checks against). These are CANDIDATE/POINT-COUNT shares, not area
// shares, and the two are very different by design: a power-diagram cell's own area scales with its
// seed's `radius^2` (see `powerCell`'s own header), so for EQUAL point counts, large alone would
// already claim ~76% of the area (radius ratios 1 : 0.5 : 0.25 square to 1 : 0.25 : 0.0625) --
// hitting a 50/35/15% AREA split needs roughly the INVERSE point-count weighting, then nudged by
// measurement (large also benefits from going first in `fieldstoneLayout`'s own per-tier pass
// order, so its own realised share runs a bit ahead of its raw point-count share).
//
// RECALIBRATED (seat 88, T86 item 17 prep): the FIRST calibration was tuned against only 3
// templates (1/2/5, all 7x9) -- too narrow a set, and `tests/bricks-fieldstone.test.js`'s own
// pooled check happened to pass anyway only because its T9 fixture used a narrow-flange variant
// that skews medium-heavy, masking the miscalibration on ordinary shapes (seat 88's own finding:
// medium ran 11-13 points low, large 5-8 points high on T1/T12/T9-wide-flange). Redone against a
// BROADER 6-template set (1/2/5/9/12/15, mixed board sizes) this time, specifically to avoid
// repeating the same narrow-generalisation mistake -- re-verified directly against seat 88's own
// exact reported combos (T1 7x9, T12 7x9, T9 9x12) afterward: medium moved from 22-24% to 32-33%,
// large from 55-58% to 47-49%, both now comfortably inside the declared +/-10 points for every
// case checked, not just the ones this file's own pooled test happens to sample. This is the
// VERIFIED ANCHOR `gateAreaSharesFor` (below) is built from -- `largeStones` defaults to 0.5, which
// reproduces this exact array, unchanged.
const DEFAULT_GATE_AREA_SHARES = Object.freeze([0.13, 0.55, 0.32]);

// T86 item 17 (Fred, White rocks v3 preview: "Wow" / "slider for more or less large ones"):
// `largeStones` in 0..1 moves the large tier's own target AREA share along this declared range
// (default 0.5 -> 0.5, i.e. today's split, unchanged); medium/small rescale in their CURRENT
// proportion (35:15, i.e. 7:3) to fill whatever's left.
const LARGE_SHARE_RANGE = Object.freeze([0.2, 0.8]);
function targetAreaSharesFor(largeStones) {
  const s = Number.isFinite(largeStones) ? Math.min(1, Math.max(0, largeStones)) : 0.5;
  const large = LARGE_SHARE_RANGE[0] + (LARGE_SHARE_RANGE[1] - LARGE_SHARE_RANGE[0]) * s;
  const remaining = 1 - large;
  const mediumFracOfRemaining = SIZE_TIERS[1].areaShare / (SIZE_TIERS[1].areaShare + SIZE_TIERS[2].areaShare);
  return [large, remaining * mediumFracOfRemaining, remaining * (1 - mediumFracOfRemaining)];
}

// Re-derives `tierAt`'s own point-count shares for ANY target area-share vector by the SAME
// radius^2 rule documented above (raw_i = target_i / fraction_i^2, normalized) -- but the raw rule
// ALONE does not land on the measured-correct DEFAULT_GATE_AREA_SHARES at largeStones=0.5 (MEASURED:
// the raw rule alone gives [0.116,0.326,0.558] there, not [0.13,0.55,0.32] -- Poisson-disc's own
// point density also scales with each tier's own spacing, and large's own pass-order precedence
// compounds on top, neither of which a closed r^-2 form alone predicts). Rather than a SEPARATE
// hand-tuned table per slider value (ruled out by the dispatch itself), `GATE_CORRECTION` is derived
// ONCE -- "how far off the raw rule was at the one point this project has actually measured and
// verified against real templates" -- and applied as a constant per-tier multiplier at every other
// target. By construction this reproduces `DEFAULT_GATE_AREA_SHARES` EXACTLY at largeStones=0.5.
const GATE_CORRECTION = Object.freeze((() => {
  const targets = targetAreaSharesFor(0.5); // === SIZE_TIERS[i].areaShare
  const fractionsSq = SIZE_TIERS.map((t) => t.fraction * t.fraction);
  const raw = targets.map((a, i) => a / fractionsSq[i]);
  const rawSum = raw.reduce((s, v) => s + v, 0);
  return raw.map((r, i) => DEFAULT_GATE_AREA_SHARES[i] / (r / rawSum));
})());
function gateAreaSharesFor(largeStones) {
  const targets = targetAreaSharesFor(largeStones);
  const fractionsSq = SIZE_TIERS.map((t) => t.fraction * t.fraction);
  const corrected = targets.map((a, i) => (a / fractionsSq[i]) * GATE_CORRECTION[i]);
  const sum = corrected.reduce((s, v) => s + v, 0);
  return corrected.map((v) => v / sum);
}
const NOISE_CELL_FACTOR = 1.5; // TEMP for tuning sweep (was 4) -- advisor/Fred: "sizes form zones...
// raise the noise frequency to about 1-2 large-stone diameters" so medium/small mix THROUGHOUT the
// board, not segregated into their own large all-one-size regions.
const PACKING_FACTOR = 1; // same-tier pairs: required = spacing*1 = spacing, exactly matching the
// original single-size algorithm's own [minDist,2minDist) growth/accept relationship.
const CROSS_TIER_PACKING_FACTOR = 1; // MEASURED: loosening this (tried 0.4) reintroduced real
// overlap (6-27% of stone area) -- `powerCell`'s own bisector SHIFT (see its header) assumes the
// shift distance stays small relative to the point-to-point distance; two very-differently-weighted
// seeds placed too close together break that assumption and can flip the shifted bisector to a
// geometrically wrong position. Kept at the safe, proven value; the clustering problem this was
// trying to solve is fixed differently below (a probabilistic, not spatial-blob, tier gate).
const GROUT_CLEARANCE_FACTOR = 2; // MEASURED (T86 item 6): White rocks' own heavier declared grout
// (0.12in vs Set 1's 0.034in) means a small-tier seed's own spacing can be barely wider than the
// grout itself, shrinking the stone away to nothing. Each tier's own spacing is floored at this many
// times the FULL grout width (a no-op for Set 1, whose own grout is small enough that even the
// smallest tier's fraction never needs it).
const MIN_PIECE_FLOOR_FRACTION = MIN_PIECE_FRACTION; // library.js's shared quarter-brick floor (T86 item 28): "never smaller than ~1/4 of the grout-free minimum piece" --
// the SAME declared floor concept this codebase's own FILL_FRACTIONS/mergeSlivers already use for
// rectangular pieces (library.js), applied here to the SMALLEST tier's own nominal stone area (its
// own target spacing squared, before grout shrink -- "grout-free") since that is the smallest unit
// this layout ever deliberately asks for.

/** A smooth, deterministic "value noise" field in [0,1): bilinearly-interpolated random values at
 *  the corners of a `cellSize`-spaced grid, smoothstepped so there is no visible grid-cell seam --
 *  the standard, simplest construction for "organic-looking but reproducible" spatial variation,
 *  reused here (rather than editor/editor-lattice-pattern.js's own PerlinNoise) only because this
 *  whole directory is PORTABLE and owns no outside imports (see this file's own header / rng.js). */
function valueNoiseAt(x, y, cellSize, seed) {
  const gx = Math.floor(x / cellSize), gy = Math.floor(y / cellSize);
  const fx = x / cellSize - gx, fy = y / cellSize - gy;
  const corner = (cx, cy) => hashedRandom(seed, 'fieldstone-noise', ((cx * 73856093) ^ (cy * 19349663)) | 0);
  const v00 = corner(gx, gy), v10 = corner(gx + 1, gy), v01 = corner(gx, gy + 1), v11 = corner(gx + 1, gy + 1);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); // smoothstep, not a linear lerp --
  // a linear interpolation's own derivative jumps at each grid line, which reads as a faint seam.
  const top = v00 + sx * (v10 - v00), bottom = v01 + sx * (v11 - v01);
  return top + sy * (bottom - top);
}

// `valueNoiseAt`'s own raw output is NOT uniform in [0,1) (MEASURED, T86 item 6) -- bilinearly
// interpolating 4 independent uniform corners concentrates the result toward 0.5 (4 corners landing
// near 0 or near 1 simultaneously is astronomically unlikely), so a naive cumulative-areaShare
// bucket against the RAW value badly starves the high end: measured tier split came out large=8.8%
// medium=90.4% small=0.8% against a declared 50/35/15% target, because the "small" bucket's own
// threshold (n>=0.85) is almost never reached by the raw noise at all. These are `valueNoiseAt`'s
// own empirically-measured QUANTILES (21 points, 5th-percentile steps, sampled across many
// independent noise cells/seeds so the estimate isn't biased by any one cell's own 4 random
// corners) -- `uniformizeNoise` inverts them, turning a raw sample back into an approximately
// UNIFORM [0,1) value BEFORE `tierAt`'s own bucket lookup, so the declared `areaShare`s are what
// the noise field actually produces, not just what the bucket math assumes.
const NOISE_QUANTILES = Object.freeze([
  0.0086, 0.1745, 0.2474, 0.2999, 0.3453, 0.3846, 0.4193, 0.4527, 0.4868, 0.5186, 0.5467,
  0.5764, 0.6052, 0.6359, 0.6662, 0.6975, 0.7307, 0.7647, 0.8050, 0.8669, 0.9933,
]);
function uniformizeNoise(n) {
  const steps = NOISE_QUANTILES.length - 1;
  for (let i = 0; i < steps; i++) {
    const lo = NOISE_QUANTILES[i], hi = NOISE_QUANTILES[i + 1];
    if (n <= hi || i === steps - 1) {
      const t = hi > lo ? Math.min(1, Math.max(0, (n - lo) / (hi - lo))) : 0;
      return (i + t) / steps;
    }
  }
  return 1;
}

const NOISE_BIAS = 0.25; // T86 item 6 (advisor review, "sizes form zones... Fred wants medium/small
// mixed THROUGHOUT; raise the noise frequency... or mostly random per seed with only a gentle noise
// bias"): raising the frequency alone (tried NOISE_CELL_FACTOR down to 1.5) didn't work -- a noise
// blob that size is barely bigger than a LARGE stone itself, so a large seed's own full packing
// clearance routinely reaches past its own blob into a neighbouring medium/small blob, starving
// them regardless of how the space is nominally partitioned (MEASURED: medium fell to ~14% of total
// area against a 35% target). Went with the advisor's own alternative instead: `tierAt` blends the
// smooth spatial noise value with a FRESH per-candidate random draw, weighted mostly toward the
// random draw (this constant), so a tier's own candidates are no longer confined to hard spatial
// blobs at all -- medium/small can succeed ANYWHERE geometric room exists, with only a gentle
// large-scale tendency left over from the noise field (visible clustering, not hard zoning).

/** The SIZE_TIERS entry assigned at `(x,y)` for ONE candidate draw -- a cumulative-share bucket
 *  lookup against a blend of the smooth spatial noise field and (when `rng` is given) a fresh
 *  per-candidate random draw, so results are NOT purely a function of position: two different
 *  candidates at the very same spot can draw different tiers. `rng` omitted falls back to the pure
 *  spatial field (used only by callers that need a position-only read, e.g. diagnostics).
 *  `gateShares` (T86 item 17): `gateAreaSharesFor(largeStones)`'s own output, threaded through
 *  rather than read from the old module-level constant, so each `fieldstoneLayout` call can move it. */
function tierAt(x, y, cellSize, seed, rng, gateShares) {
  const n = uniformizeNoise(valueNoiseAt(x, y, cellSize, seed));
  const blended = rng ? NOISE_BIAS * n + (1 - NOISE_BIAS) * rng() : n;
  let cum = 0;
  for (let i = 0; i < SIZE_TIERS.length; i++) {
    cum += gateShares[i];
    if (blended < cum) return SIZE_TIERS[i];
  }
  return SIZE_TIERS[SIZE_TIERS.length - 1];
}

/** Bridson's Poisson-disc sampling at a FIXED target `spacing` for THIS call -- new candidates grow
 *  from an active point at the SAME `[spacing, 2*spacing)` distance the original single-size version
 *  always used (the well-behaved, well-tested case: an active point only ever exists in THIS call's
 *  own list, so every growth step is same-tier by construction, never the mismatched-scale growth a
 *  single variable-density pass would need). Two generalisations on top of the plain version: (1)
 *  `existingPoints` (from EARLIER, already-placed tiers) are also obstacles, each respected at ITS
 *  OWN `.radius` rather than this call's `spacing` (a big existing stone needs more clearance than a
 *  small new one would on its own); (2) `gate(x,y)`, when given, rejects a candidate outright when
 *  this spot doesn't belong to this call's own size tier (the low-frequency noise field decides
 *  WHERE each tier may seed -- see `fieldstoneLayout`'s own header) -- large/medium/small all draw
 *  from the SAME spatial field, so their regions tile the board without needing to coordinate with
 *  each other directly. Grid-accelerated at THIS call's own spacing; a widened search reach covers a
 *  larger EARLIER tier's own bigger clearance radius too. */
function poissonDiscSample(polygon, spacing, seed, existingPoints, gate) {
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  if (w < 1e-6 || h < 1e-6 || spacing < 1e-6) return [];

  const myRadius = spacing / 2;
  const rng = mulberry32(seedFor(seed, 'fieldstone-poisson', 0));
  const cellSize = spacing / Math.SQRT2;
  const gw = Math.max(1, Math.ceil(w / cellSize)), gh = Math.max(1, Math.ceil(h / cellSize));
  const grid = new Array(gw * gh).fill(-1);
  // `points` holds BOTH the seeded `existingPoints` (so new candidates correctly reject near them
  // too) AND every newly-placed one, in that order -- `newCount` is simply where the new ones start.
  const points = [];
  const gridIndexOf = (p) => ({
    gx: Math.min(gw - 1, Math.max(0, Math.floor((p.x - minX) / cellSize))),
    gy: Math.min(gh - 1, Math.max(0, Math.floor((p.y - minY) / cellSize))),
  });
  const maxExistingRadius = existingPoints.reduce((m, p) => Math.max(m, p.radius), 0);
  const searchReach = Math.max(2, Math.ceil(((myRadius + maxExistingRadius) * PACKING_FACTOR) / cellSize));
  // T86 item 6 (MEASURED): using the SAME packing factor for a cross-tier pair as for a same-tier one
  // wastes real board area -- the power diagram can correctly give a small seed its own honest cell
  // immediately next to a much bigger one (that's the whole point of weighting by radius^2), so
  // requiring the SAME physical clearance as between two same-size circles only starves the result of
  // seeds for no geometric reason. A looser `CROSS_TIER_PACKING_FACTOR` lets different tiers nest
  // close together; same-tier pairs (the common case within one tier's own pass) keep the proven,
  // full `PACKING_FACTOR` separation.
  const farEnough = (p, radius) => {
    const { gx, gy } = gridIndexOf(p);
    for (let dy = -searchReach; dy <= searchReach; dy++) {
      for (let dx = -searchReach; dx <= searchReach; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
        const idx = grid[ny * gw + nx];
        if (idx < 0) continue;
        const q = points[idx];
        const factor = Math.abs(q.radius - radius) < 1e-9 ? PACKING_FACTOR : CROSS_TIER_PACKING_FACTOR;
        const required = (radius + q.radius) * factor;
        if (Math.hypot(p.x - q.x, p.y - q.y) < required) return false;
      }
    }
    return true;
  };
  const place = (p) => {
    const { gx, gy } = gridIndexOf(p);
    grid[gy * gw + gx] = points.length;
    points.push(p);
  };

  for (const p of existingPoints) {
    if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
    place(p);
  }
  const newCount = points.length;

  // T86 item 6 (MEASURED): Bridson's algorithm, as usually implemented (ONE first seed, grow only
  // from the active list), only ever discovers ONE connected blob of valid space -- fine for the
  // original single-density pass (the whole board IS one blob), but a `gate`-restricted tier's own
  // region is frequently SEVERAL disconnected noise-field blobs scattered across the board, and
  // growth never jumps between them. Measured directly: large's own area share came out at 13.5% of
  // total stone area against a declared 50% target, because whole separate "large" patches were
  // getting ZERO seeds of ANY tier (large's own single first-seed search found only one patch; the
  // gate then blocked medium/small from filling the other patches too, since the noise field there
  // still said "large"). Fix: once the active list empties, search for ANOTHER fresh first seed
  // (same rules) and keep growing from it -- repeat until MANY consecutive searches fail, which is
  // what actually means "every reachable blob of this tier's own gated space is now full."
  let active = [];
  let consecutiveMisses = 0;
  while (consecutiveMisses < 30 && points.length < MAX_POINTS) {
    let first = null;
    for (let tries = 0; tries < 400 && !first; tries++) {
      const cand = { x: minX + rng() * w, y: minY + rng() * h };
      if (!pointInPolygon(cand.x, cand.y, polygon)) continue;
      if (gate && !gate(cand.x, cand.y, rng)) continue;
      if (!farEnough(cand, myRadius)) continue;
      first = cand;
    }
    if (!first) { consecutiveMisses++; continue; }
    consecutiveMisses = 0;
    place({ ...first, radius: myRadius });
    active.push(points.length - 1);

    while (active.length && points.length < MAX_POINTS) {
      const ai = Math.floor(rng() * active.length);
      const p = points[active[ai]];
      let found = false;
      for (let k = 0; k < POISSON_ATTEMPTS; k++) {
        const r = spacing * (1 + rng()); // [spacing, 2*spacing) -- same-tier growth, the proven formula
        const angle = rng() * Math.PI * 2;
        const cand = { x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r };
        if (cand.x < minX || cand.x > maxX || cand.y < minY || cand.y > maxY) continue;
        if (!pointInPolygon(cand.x, cand.y, polygon)) continue;
        if (gate && !gate(cand.x, cand.y, rng)) continue;
        if (!farEnough(cand, myRadius)) continue;
        place({ ...cand, radius: myRadius });
        active.push(points.length - 1);
        found = true;
        break;
      }
      if (!found) active.splice(ai, 1);
    }
  }
  return points.slice(newCount);
}

/** One seed's own POWER (Laguerre/weighted-Voronoi) cell: start from a generous bounding box and
 *  clip inward by every nearby seed's own WEIGHTED bisector. Weight = `radius^2`; the bisector
 *  between sites `a` (radius r_a) and `b` (radius r_b), `d` apart, crosses their connecting segment
 *  at fraction `t = 0.5 + (r_a^2 - r_b^2) / (2 d^2)` from `a` -- the textbook power-diagram result
 *  (reduces to the ordinary Voronoi midpoint, t=0.5, when r_a=r_b): BIGGER radius pulls the bisector
 *  TOWARD the smaller site, growing the bigger site's own cell, while the bisector itself stays a
 *  straight line perpendicular to the a-b segment, same as plain Voronoi -- so this is still just a
 *  sequence of `clipToHalfPlane` calls, only the bisector's own point moved off the midpoint.
 *
 *  T86 item 6 (advisor review, "never drop a cell... clip concave regions properly (the same
 *  concave clip as the wall)"): the grout gap is baked directly into THIS clip, by shifting each
 *  bisector line `pointShrink` further toward `point` before clipping, rather than clipping to the
 *  bare bisector and shrinking the FINISHED polygon afterward with a separate inward-offset pass.
 *  The old order called `offsetPathInward` on the whole cell, including whatever edge
 *  `clipPolygonToBoard` had just cut flush against the board's own true (possibly concave) outline
 *  -- a short edge there is exactly the case `offsetPathInward`'s own documented P1 limitation
 *  flips into a bowtie instead of collapsing, which is what was silently dropping cells across the
 *  waist. Shifting the bisector is a plain line translation: `clipToHalfPlane` cannot self-
 *  intersect a simple input no matter how short the resulting edge is, so this removes the failure
 *  mode outright rather than papering over it. It also means a stone's edge along the board's own
 *  TRUE outline is never separately shrunk -- flush with the frame's own inner edge, exactly how
 *  bond.js/basketweave.js/herringbone.js already treat the board boundary (grout is the gap BETWEEN
 *  stones, never a setback from the board edge itself). Two neighbours each shift their own shared
 *  bisector toward themselves by their OWN `pointShrink`, so the final gap between two finished
 *  cells is `shrinkA + shrinkB` -- symmetric for two same-tier neighbours, tapering for a cross-tier
 *  pair, exactly the "thinner mortar near small stones" intent `tierShrinks` already declares. */
/** T86 (seat 37's trace, 2026-10-04: "a self-crossing rock-frame stone covers the wall"): a fieldstone band
 *  ring has NO seeds in its hole, so the cells along the ring's inner edge reach across the hole; clipped to
 *  the slit ring, such a cell becomes a piece wrapping along the inner boundary through the slit -- MEASURED on
 *  White Rocks three_band, every visible template: bands 1 and 2 grew self-crossing stones of 2.8-27 sq in
 *  (median 0.15-0.34) from cells of 25-29 sq in, one covering T1's whole wall -- and an inner ring's OUTER edge
 *  is just as open (the band outside it is laid separately). Fix: MIRROR seeds -- every real seed within
 *  FENCE_REACH_FACTOR x the largest spacing of a fence (the ring's outer edge, its inner edge -- each its own
 *  closed line, never the slit polygon: a seed whose nearest ring point is the zero-width bridge got no outer
 *  twin, MEASURED a 19.5 sq in cell reaching the box corner) gets a phantom twin reflected across its nearest
 *  point on that fence (same radius), kept only where the twin lands OUTSIDE the region being filled. A seed and its mirror are equidistant from the edge, so their bisector IS the edge
 *  there (stretched past it, see FENCE_STRETCH): no stone can reach across a hole or past the outer edge. Phantoms
 *  bound the cells and never become stones. (A first try, phantoms at a FIXED depth inside the hole, MEASURED
 *  no effect: in a narrow hole most of them fell outside it and were skipped -- 2 phantoms for a whole ring.)
 *  T86 item 33: a phantom bounds ONLY its own twin's cell (buildCells) -- it fences that seed; real neighbours bound each
 *  other. MEASURED, bounding every cell: at a concave ring corner a phantom took ground from a neighbour's stone and no
 *  stone got it (6.7 sq in bare over 57 White rocks rings, mostly at 1.25 in). */
const FENCE_REACH_FACTOR = 2;
// The twin sits FENCE_STRETCH x the seed's distance beyond the edge (5 = the bisector two seed-distances OUTSIDE
// the edge), not at the exact mirror image: an exact mirror makes the cell's edge the boundary's TANGENT, which
// cuts the sliver off wherever the boundary curves into the region (MEASURED: ring coverage 0.83-0.84 < 0.85
// on T18 and at the bridge corner). The fence only has to stop runaway cells; the stone still meets the true
// edge through the usual clip, flush, as before. MEASURED window: 3 still lost coverage (T18 1 in band 0.845),
// 8 let wrap-around stones back on T6 / T12 / T18; 5 passes both (bricks-fieldstone-band + rock-ring-stones).
const FENCE_STRETCH = 5;
function fencePoints(fences, points, reach, region) {
  // one twin per boundary SEGMENT whose perpendicular foot lies inside it (within `reach`): at a corner a seed
  // gets a twin across each side, which bounds its cell exactly like the corner. (Mirroring only across the
  // single NEAREST boundary point MEASURED a coverage loss at corners: the nearest point there is the corner
  // vertex, and the twin through it cut the corner off diagonally -- T18 band 1 in 0.835, corner box 0.84.)
  const out = [];
  for (const fence of fences || []) {
    if (!fence || fence.length < 3) continue;
    for (const p of points) {
      for (let i = 0; i < fence.length; i++) {
        const a = fence[i], b = fence[(i + 1) % fence.length];
        const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
        if (L2 < 1e-18) continue;
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
        if (t <= 0 || t >= 1) continue;
        const qx = a.x + t * dx, qy = a.y + t * dy, d = Math.hypot(p.x - qx, p.y - qy);
        if (d > reach || d < 1e-9) continue;
        const m = { x: qx + FENCE_STRETCH * (qx - p.x), y: qy + FENCE_STRETCH * (qy - p.y) };
        if (!pointInPolygon(m.x, m.y, region)) out.push({ ...m, radius: p.radius, tierIndex: p.tierIndex, phantom: true, twin: p });
      }
    }
  }
  return out;
}

function powerCell(point, allPoints, boxPoly, pointShrink) {
  let poly = boxPoly;
  for (const other of allPoints) {
    if (other === point || poly.length < 3) continue;
    const dx = other.x - point.x, dy = other.y - point.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-12) continue; // coincident seeds -- cannot happen post Poisson-disc rejection, guarded anyway
    const len = Math.sqrt(d2);
    // a joint is between two real stones: a fence phantom's bisector is the region's edge itself, no grout
    // shrink (MEASURED with it: ring stones stood half a joint off both ring edges, coverage 0.79-0.85 < 0.85)
    const t = 0.5 + (point.radius * point.radius - other.radius * other.radius) / (2 * d2) - (other.phantom ? 0 : pointShrink / len);
    const bisector = { x: point.x + t * dx, y: point.y + t * dy };
    const line = { point: bisector, dirX: -dy / len, dirY: dx / len };
    poly = clipToHalfPlane(poly, line, point);
  }
  return poly;
}

/**
 * @param {{x:number,y:number}[]} boardOutline — closed polygon, board inches
 * @param {object} set — {brickLengthIn (reused as target spacing), grout:{widthIn}}
 * @param {*} _zones — unused (fieldstone has no banding concept); kept for call-signature parity with bondLayout
 * @param {number} seed
 * @param {number} [largeStones=0.5] — T86 item 17: 0..1, moves the large tier's own target area
 *   share along `LARGE_SHARE_RANGE` (~0.2 at 0, ~0.8 at 1); 0.5 reproduces today's declared 50/35/15
 *   split exactly. Omitted/non-finite falls back to 0.5, same as every pre-item-17 caller.
 * @param {{x:number,y:number}[][]} [fences] -- closed lines that must bound the stones exactly; fences[0] is the outer
 *   line and every further fence a hole in it, and the stones are clipped to that ANNULUS (when every fence is a simple
 *   polygon), not to `boardOutline` (T86
 *   item 33: a ring's slit polygon cut the stone across its zero-width bridge in two -- the seed kept its piece, often
 *   under the floor and dropped; MEASURED the bridge void on 56 of 57 White rocks rings, 0.4-0.6 sq in) (a band ring passes
 *   its outer and inner edges). See fencePoints: mirrored phantom seeds.
 * @returns {{cells: Array}} cells[i] = { id, polygon, courseIndex, cx, cy, neighbors:{} }
 */
/** Each size tier's seed spacing for a (scaled) set: its fraction of the main spacing, floored at GROUT_CLEARANCE_FACTOR
 *  joints. Read by the layout and by fieldstoneMinPieceArea (the floor a cut may leave: piece-floor.js). */
export function fieldstoneTierSpacings(set) {
  const grout = set.grout?.widthIn ?? 0;
  return SIZE_TIERS.map((tier) => Math.max(set.brickLengthIn * tier.fraction, GROUT_CLEARANCE_FACTOR * grout));
}
/** The smallest piece this layout lays: MIN_PIECE_FLOOR_FRACTION of its smallest tier's grout-free stone. */
export const fieldstoneMinPieceArea = (set) => MIN_PIECE_FLOOR_FRACTION * Math.min(...fieldstoneTierSpacings(set)) ** 2;

export function fieldstoneLayout(boardOutline, set, _zones, seed, largeStones, fences) {
  const spacing = set.brickLengthIn;
  const shrink = (set.grout?.widthIn ?? 0) / 2;
  const grout = set.grout?.widthIn ?? 0;
  const seedBase = seed ?? 0;
  const gateShares = gateAreaSharesFor(largeStones);

  const tierSpacings = fieldstoneTierSpacings(set);
  const maxSpacing = Math.max(...tierSpacings);
  // T86 item 6 (MEASURED: with the main set's own FULL grout shrink applied uniformly, a quarter-
  // scale small stone loses ~38% of its own area to that one fixed-width joint, vs ~9% for a
  // full-size one -- disabling shrink entirely confirmed generation itself already reaches ~99%
  // coverage, so this joint-width mismatch was the ENTIRE shortfall, not a packing problem). Real
  // fieldstone chinking uses a thinner mortar bead between tiny stones than the main coursing does,
  // physically (you cannot fit the SAME trowel joint between pebbles that you can between big
  // blocks) -- each tier's own shrink scales down with its own spacing, proportionally, same ratio
  // as its own fraction. The LARGE tier keeps the set's own full declared grout width unchanged
  // (ratio 1), matching every other layout's own single-size behaviour exactly.
  const tierShrinks = tierSpacings.map((s) => shrink * (s / tierSpacings[0]));
  const noiseCellSize = spacing * NOISE_CELL_FACTOR;

  // One Poisson-disc pass PER TIER, largest first (so smaller tiers fill in around already-placed
  // big stones, same visual precedence a real wall's own "set the big ones, chink the rest" build
  // order has) -- each pass's own candidates are gated to where the noise field says THIS tier
  // belongs (see `poissonDiscSample`'s own header), and reject too-close to EVERY earlier tier's own
  // points. This only decides WHERE each seed goes; the power diagram below (built over every tier's
  // points TOGETHER, in one shot) is what actually guarantees no two cells can ever overlap.
  let points = [];
  for (let i = 0; i < SIZE_TIERS.length; i++) {
    const tier = SIZE_TIERS[i];
    const tierSpacing = tierSpacings[i];
    const gate = (x, y, rng) => tierAt(x, y, noiseCellSize, seedBase, rng, gateShares) === tier;
    const found = poissonDiscSample(boardOutline, tierSpacing, seedFor(seedBase, 'fieldstone-tier', i), points, gate);
    for (const p of found) points.push({ ...p, tierIndex: i });
  }
  if (!points.length) return { cells: [] };

  const xs = boardOutline.map((p) => p.x), ys = boardOutline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const margin = maxSpacing * NEIGHBOR_RADIUS_FACTOR;
  const box = [
    { x: minX - margin, y: minY - margin }, { x: maxX + margin, y: minY - margin },
    { x: maxX + margin, y: maxY + margin }, { x: minX - margin, y: maxY + margin },
  ];
  const minPieceArea = fieldstoneMinPieceArea(set);
  const phantoms = fencePoints(fences, points, maxSpacing * FENCE_REACH_FACTOR, boardOutline);
  // only over SIMPLE fences: a band deeper than a neck pinches its inner edge to zero width (MEASURED T18 / T19, a 1 in
  // ring at 0.75 in stones), and cutting that hole out made one stone run through the pinch over its neighbours
  // (0.15 sq in) -- such a ring keeps the slit-polygon clip
  const ringFences = fences && fences.length && fences[0] && fences[0].length >= 3 ? [fences[0], ...fences.slice(1).filter((f) => f && f.length >= 3)] : null;
  const annulus = ringFences && ringFences.every(isSimplePolygon) ? { outer: ringFences[0], holes: ringFences.slice(1) } : null;
  // the cell inside the outer line, each hole cut out: the piece holding the seed (else the largest)
  const clipToAnnulus = (poly, point) => {
    let pieces = [clipPolygonToBoard(poly, annulus.outer, point)];
    for (const hole of annulus.holes) pieces = pieces.flatMap((q) => (q.length >= 3 ? polygonDifference(q, hole) : []));
    pieces = pieces.filter((q) => q.length >= 3);
    return pieces.find((q) => pointInPolygon(point.x, point.y, q)) || pieces.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0] || [];
  };

  // T86 item 6 (MEASURED): a fixed `neighborRadius` cutoff is NOT a safe bound here the way it was
  // for the single-density original -- a tier-gated region can legitimately go sparse (few/no seeds
  // within the cutoff), and in that case a point's own power cell genuinely reaches further than any
  // fixed radius, because nothing closer exists to stop it. Found directly: two real stones 3.74in
  // apart (board width ~7in) both grew out to the SAME bounding-box corner because `neighborRadius`
  // (2.25in) excluded each from the other's own bisector clip -- a real, reproducible overlap, not a
  // rare fluke (seed=2 hit it on 5 of 6 templates tried). Every point is cheap enough at this point
  // count (a few hundred) to just clip against EVERY other one -- the only way to GUARANTEE no missed
  // neighbour regardless of how sparse a tier's own region gets, rather than trusting a cutoff tuned
  // for the single-density case to still happen to be generous enough here.
  //
  // Builds the FULL cell set for a given point list in one shot: `clipPolygonToBoard` is the SAME
  // exact (Greiner-Hormann, concave-safe) clip the Wall's other layouts already use for the board's
  // own true outline, and `powerCell`'s own bisector shift (not a separate offsetPathInward pass --
  // see its own header) is what keeps a short board-edge segment from ever becoming a bowtie. A
  // point entry here is null when its own cell came back degenerate (poly.length<3 at any stage) or
  // under the declared floor -- NOT dropped silently: `fieldstoneLayout` below removes that seed and
  // rebuilds, so the power diagram's own remaining seeds naturally absorb its territory (a true
  // tessellation always sums to the full clipped region, so one fewer seed just means its neighbours
  // each claim a little more, never a gap) -- "merge an undersized cell into its neighbour" without
  // an actual polygon-union operation this codebase doesn't have.
  const buildCells = (pts) => pts.map((point) => {
    const others = phantoms.length ? pts.filter((q) => q !== point).concat(phantoms.filter((ph) => ph.twin === point)) : pts.filter((q) => q !== point);
    const pointShrink = tierShrinks[point.tierIndex];
    let poly = powerCell(point, others, box, pointShrink);
    if (poly.length < 3) return null;
    poly = annulus ? clipToAnnulus(poly, point) : clipPolygonToBoard(poly, boardOutline, point);
    if (poly.length < 3) return null;
    poly = roundPolygonCorners(poly, point.radius * 2 * CORNER_RADIUS_FACTOR);
    if (poly.length < 3) return null;
    if (Math.abs(signedArea(poly)) < minPieceArea) return null;
    return poly;
  });

  let activePoints = points;
  let polys = buildCells(activePoints);
  for (let iter = 0; iter < 4 && activePoints.length; iter++) {
    const survivors = activePoints.filter((_, i) => polys[i]);
    if (survivors.length === activePoints.length) break; // nothing dropped this round -- stable
    activePoints = survivors;
    polys = buildCells(activePoints);
  }

  const cells = [];
  for (let i = 0; i < activePoints.length; i++) {
    if (!polys[i]) continue; // a handful of iterations wasn't enough to stabilise -- rare, and still
    // honest (void, not a garbage render) rather than looping indefinitely over a pathological input
    const point = activePoints[i];
    const courseIndex = Math.max(0, Math.round((point.y - minY) / spacing));
    // `tier` (the declared SIZE_TIERS name this stone drew) rides along for diagnostics/tests (the
    // size-histogram check) -- pieces.js/suppression.js/samples.js only ever read the fields this
    // file's own header already documents, so an extra field here is inert for every existing caller.
    cells.push({
      id: cells.length, polygon: polys[i], courseIndex, cx: point.x, cy: point.y, neighbors: {},
      tier: SIZE_TIERS[point.tierIndex].name,
    });
  }
  return { cells };
}
