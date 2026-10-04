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
 */
import {
  pointInPolygon, clipToHalfPlane, clipPolygonToBoard, offsetPathInward, inwardSignFor,
  roundPolygonCorners, isSimplePolygon, signedArea,
} from '../geometry.js';
import { mulberry32, seedFor, hashedRandom } from '../rng.js';

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
// `tierAt`'s own noise-bucket input shares, distinct from `SIZE_TIERS[i].areaShare` above (the
// declared OUTPUT target the histogram test checks against). MEASURED: a coarser tier wastes more of
// its own gated noise-blob to edge effects than a finer one does (large stones barely fit 2-4 across
// a blob sized for the noise field's own low frequency, wasting a big share of it to boundary/corner
// rejection; a finer tier's own smaller stones tile the SAME blob far more completely) -- gating by
// the raw 50/35/15 target directly measured large=13.5%/medium=75.5%/small=11.0% of the FINAL stone
// area, nowhere near the declared split. These shares compensate for that measured efficiency gap so
// the OUTPUT lands near the declared target; `SIZE_TIERS` itself stays the single source of truth for
// stone SIZE (`fraction`) and for what the result is actually supposed to look like (`areaShare`).
const GATE_AREA_SHARES = Object.freeze([0.59, 0.22, 0.19]);
const NOISE_CELL_FACTOR = 4; // the low-frequency noise field's own grid cell size, as a multiple of
// the main spacing -- big enough that a seed's neighbours usually share its own tier (visible organic
// clustering of same-sized stones, matching how a real fieldstone wall reads), not a single-seed
// salt-and-pepper mix. Declared separately from SIZE_TIERS since it tunes the noise FIELD, not a tier.
const PACKING_FACTOR = 1; // same-tier pairs: required = spacing*1 = spacing, exactly matching the
// original single-size algorithm's own [minDist,2minDist) growth/accept relationship.
const CROSS_TIER_PACKING_FACTOR = 1; // MEASURED: looser cross-tier values (tried 0.4, 0.6) changed
// coverage by well under a percentage point either way once the real overlap cause (the fixed
// `neighborRadius` cutoff, see fieldstoneLayout's own comment) was fixed -- packing tightness was
// never the actual lever. Kept equal to same-tier `PACKING_FACTOR` as the simplest, least-arbitrary
// choice rather than a tuned-for-no-measured-benefit knob.
const GROUT_CLEARANCE_FACTOR = 2; // MEASURED (T86 item 6): White rocks' own heavier declared grout
// (0.12in vs Set 1's 0.034in) means a small-tier seed's own spacing can be barely wider than the
// grout itself, shrinking the stone away to nothing. Each tier's own spacing is floored at this many
// times the FULL grout width (a no-op for Set 1, whose own grout is small enough that even the
// smallest tier's fraction never needs it).
const MIN_PIECE_FLOOR_FRACTION = 0.25; // "never smaller than ~1/4 of the grout-free minimum piece" --
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

/** The SIZE_TIERS entry the noise field assigns at `(x,y)` -- a cumulative-share bucket lookup
 *  against ONE uniformized noise value, so tier boundaries shift smoothly across the board exactly
 *  where the noise field itself does (no separate per-tier noise call, which would let tiers
 *  overlap/gap independently of each other). */
function tierAt(x, y, cellSize, seed) {
  const n = uniformizeNoise(valueNoiseAt(x, y, cellSize, seed));
  let cum = 0;
  for (let i = 0; i < SIZE_TIERS.length; i++) {
    cum += GATE_AREA_SHARES[i];
    if (n < cum) return SIZE_TIERS[i];
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
      if (gate && !gate(cand.x, cand.y)) continue;
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
        if (gate && !gate(cand.x, cand.y)) continue;
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
 *  sequence of `clipToHalfPlane` calls, only the bisector's own point moved off the midpoint. */
function powerCell(point, allPoints, boxPoly) {
  let poly = boxPoly;
  for (const other of allPoints) {
    if (other === point || poly.length < 3) continue;
    const dx = other.x - point.x, dy = other.y - point.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-12) continue; // coincident seeds -- cannot happen post Poisson-disc rejection, guarded anyway
    const t = 0.5 + (point.radius * point.radius - other.radius * other.radius) / (2 * d2);
    const bisector = { x: point.x + t * dx, y: point.y + t * dy };
    const len = Math.sqrt(d2);
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
 * @returns {{cells: Array}} cells[i] = { id, polygon, courseIndex, cx, cy, neighbors:{} }
 */
export function fieldstoneLayout(boardOutline, set, _zones, seed) {
  const spacing = set.brickLengthIn;
  const shrink = (set.grout?.widthIn ?? 0) / 2;
  const grout = set.grout?.widthIn ?? 0;
  const seedBase = seed ?? 0;

  const tierSpacings = SIZE_TIERS.map((tier) => Math.max(spacing * tier.fraction, GROUT_CLEARANCE_FACTOR * grout));
  const maxSpacing = Math.max(...tierSpacings), minSpacing = Math.min(...tierSpacings);
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
    const gate = (x, y) => tierAt(x, y, noiseCellSize, seedBase) === tier;
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
  const minPieceArea = MIN_PIECE_FLOOR_FRACTION * minSpacing ** 2;

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
  const cells = [];
  let nextId = 0;
  for (const point of points) {
    const others = points.filter((q) => q !== point);
    let poly = powerCell(point, others, box);
    if (poly.length < 3) continue;
    // H23 item 74 (de): the SAME shared clip bond.js's own rectangular cells now use (geometry.js's
    // clipPolygonToBoard) -- exact for a convex board, bond.js's own prior keep-whole-or-drop
    // fallback for a concave one. The Poisson sample point is always a safe refPoint (guaranteed
    // inside boardOutline by poissonDiscSample's own interior-only sampling).
    poly = clipPolygonToBoard(poly, boardOutline, point);
    if (poly.length < 3) continue;

    const pointShrink = tierShrinks[point.tierIndex];
    if (pointShrink > 1e-9) {
      poly = offsetPathInward(poly, pointShrink, inwardSignFor(poly));
      // H23 item 76 cont.: `clipPolygonToBoard`'s now-exact concave clip can leave a real edge
      // shorter than `shrink` right at the board's true boundary (MEASURED on T1's waist) --
      // offsetPathInward's own documented P1 limitation (see its header) flips that edge into a
      // bowtie rather than collapsing it. Drop the cell, same as every other degenerate-result
      // bail-out in this loop, rather than ship a self-intersecting stone.
      if (poly.length < 3 || !isSimplePolygon(poly)) continue;
    }
    poly = roundPolygonCorners(poly, point.radius * 2 * CORNER_RADIUS_FACTOR);
    if (poly.length < 3) continue;
    // T86 item 6: the declared floor -- a stone that shrank/clipped down to a true sliver is dropped
    // (stays void/grout), same "an honest gap, not a garbage render" treatment every other
    // degenerate-result bail-out in this loop already gives.
    if (Math.abs(signedArea(poly)) < minPieceArea) continue;

    const courseIndex = Math.max(0, Math.round((point.y - minY) / spacing));
    // `tier` (the declared SIZE_TIERS name this stone drew) rides along for diagnostics/tests (the
    // size-histogram check) -- pieces.js/suppression.js/samples.js only ever read the fields this
    // file's own header already documents, so an extra field here is inert for every existing caller.
    cells.push({
      id: nextId++, polygon: poly, courseIndex, cx: point.x, cy: point.y, neighbors: {},
      tier: SIZE_TIERS[point.tierIndex].name,
    });
  }
  return { cells };
}
