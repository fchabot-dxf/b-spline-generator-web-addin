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
 * T86 item 6 (Fred: "fieldstone should also have a lot of smaller stones to fit in voids" -- the
 * single-pass version above left big grey gaps, esp. near the frame's own inner edge and at the
 * waist, wherever a degenerate near-boundary cell got dropped entirely). TWO more Poisson-disc
 * passes at `VOID_FILL_FRACTIONS` of the main spacing (1/3, then 1/6), each one seeded against
 * EVERY point already placed (`poissonDiscSample`'s own `existingPoints` argument) so a finer
 * pass's own new points can only ever land in whatever gap its own smaller `minDist` still allows
 * between them.
 *
 * Each pass's own cells are built ONCE and then FROZEN -- a later, finer pass's own points are
 * Voronoi'd only AMONG THEMSELVES, then bisector-clipped against every nearby EARLIER pass's own
 * point (same `clipToHalfPlane` trick `voronoiCell` already does for same-pass neighbours, just
 * fed a mixed neighbour list) -- but an earlier pass's own already-built polygon is never
 * recomputed. This was NOT the first attempt (MEASURED, T86 item 6): rebuilding ONE shared Voronoi
 * diagram over every pass's points together seems simpler, but it recomputes EVERY point's cell
 * every time, including coarse ones that were already fine -- a finer pass's own point, even one
 * that only ever lands in a genuine leftover gap, still shifts its neighbours' bisectors when the
 * whole diagram is rebuilt, which measurably shrank an already-good cell's reach at T1/T12's own
 * concave waist (worse, not better, than the single-pass baseline). Freezing each pass the moment
 * it's built removes that risk structurally: an earlier pass's own cell is the SAME object, byte for
 * byte, regardless of how many finer passes run after it, so the near-boundary behaviour this file's
 * own existing tests already measured against (H23 item 76 cont.) cannot regress from void-filling
 * at all. A finer cell can still only ever occupy the real leftover void (grout gaps, or a dropped
 * cell's own hole) because the bisector clip against each nearby earlier point stops it exactly
 * where that point's own raw Voronoi reach would have stopped it anyway -- never a general polygon
 * union/difference (this codebase has none, and still does not need one). Each point remembers its
 * OWN pass's own spacing (`point.spacing`) so a small stone's own rounded corners stay proportionally
 * small too, never the big pass's own absolute radius.
 */
import { pointInPolygon, clipToHalfPlane, clipPolygonToBoard, offsetPathInward, inwardSignFor, roundPolygonCorners, isSimplePolygon, signedArea } from '../geometry.js';
import { mulberry32, seedFor } from '../rng.js';

const POISSON_ATTEMPTS = 30; // Bridson's own typical constant -- candidates tried per active point before giving up on it
const MAX_POINTS = 4000; // a safety cap on runaway input (spacing far too small for the shape), not a feature
const NEIGHBOR_RADIUS_FACTOR = 3; // a Voronoi cell's true neighbours are typically within ~2x the Poisson spacing;
// 3x is a generous, declared safety margin (matches the "cos floor"/MITRE_REACH style of bounded-not-exact headroom
// already used elsewhere in this engine) so no real neighbour is ever missed -- MEASURED: sweeping
// this factor from 2 to 8 on a 9x12 board produced IDENTICAL coverage/overlap every time (the true
// Voronoi neighbour set was already fully captured at the low end), so 3 is kept for a safety
// margin without the wasted O(n) candidate-filtering a larger factor costs for no geometric gain.
const CORNER_RADIUS_FACTOR = 0.12; // "slightly rounded" -- a declared layout-internal constant (not a per-set
// tunable; the task only called out grout/Poisson/Voronoi/shrink as set-level concerns)
// T86 item 6 (Fred: "fieldstone should also have a lot of smaller stones to fit in voids" -- today's
// field shows big grey voids, esp. along the frame's inner edge and at the waist): a SECOND and
// THIRD Poisson-disc pass at these fractions of the main spacing, each seeded against every point
// already placed (main pass, then pass 2) so new points can ONLY land in whatever gap the now-finer
// `minDist` still allows between them -- see `poissonDiscSample`'s own `existingPoints` parameter.
// Declared as a plain array (not two named constants) so a future 4th pass is one more entry, not a
// new code path.
const VOID_FILL_FRACTIONS = [1 / 3, 1 / 6];
const GROUT_CLEARANCE_FACTOR = 2; // MEASURED (T86 item 6): White rocks' own heavier declared grout
// (0.12in vs Set 1's 0.034in) means its finer fractional passes shrink away almost entirely without
// this floor (coverage barely moved past the single-pass baseline at factor 1, and factor 4 ends up
// skipping the second pass outright -- see `fieldstoneLayout`'s own comment on this constant). 2 was
// the best of {1,2,4} tried: it floors ONLY the finer (1/6) pass for a heavy-grout set like White
// rocks, leaving the coarser (1/3) pass's own fraction untouched, and is a no-op for Set 1 (its own
// grout is small enough that neither pass's fraction ever needs flooring).
const MIN_PIECE_FLOOR_FRACTION = 0.25; // "never smaller than ~1/4 of the grout-free minimum piece" --
// the SAME declared floor concept this codebase's own FILL_FRACTIONS/mergeSlivers already use for
// rectangular pieces (library.js), applied here to the SMALLEST pass's own nominal stone area (its
// own target spacing squared, before grout shrink -- "grout-free") since that is the smallest unit
// this layout ever deliberately asks for.

/** Bridson's Poisson-disc sampling, restricted to the interior of `polygon`: every returned point
 *  is >= minDist from every other (INCLUDING every one of `existingPoints`, if given) -- see
 *  `fieldstoneLayout`'s own header for why that one extra ability (seeding the "already placed"
 *  obstacle set from a PRIOR, coarser pass) is the whole mechanism behind the void-filling passes
 *  below. Grid-accelerated (cell size minDist/sqrt(2)) so the "far enough from every existing
 *  point" check stays cheap even with hundreds of points.
 *  Returns only the NEWLY placed points (never re-returns `existingPoints`) -- the caller already
 *  has those from the pass that found them. */
function poissonDiscSample(polygon, minDist, seed, existingPoints = []) {
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  if (w < 1e-6 || h < 1e-6 || minDist < 1e-6) return [];

  const rng = mulberry32(seedFor(seed, 'fieldstone-poisson', 0));
  const cellSize = minDist / Math.SQRT2;
  const gw = Math.max(1, Math.ceil(w / cellSize)), gh = Math.max(1, Math.ceil(h / cellSize));
  const grid = new Array(gw * gh).fill(-1);
  // `points` holds BOTH the seeded `existingPoints` (so new candidates correctly reject near them
  // too) AND every newly-placed one, in that order -- `newCount` is simply where the new ones start.
  const points = [];
  const gridIndexOf = (p) => {
    const gx = Math.min(gw - 1, Math.max(0, Math.floor((p.x - minX) / cellSize)));
    const gy = Math.min(gh - 1, Math.max(0, Math.floor((p.y - minY) / cellSize)));
    return { gx, gy };
  };
  const farEnough = (p) => {
    const { gx, gy } = gridIndexOf(p);
    const r = 2; // neighbouring grid cells within this radius can possibly violate minDist
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
        const idx = grid[ny * gw + nx];
        if (idx < 0) continue;
        const q = points[idx];
        if (Math.hypot(p.x - q.x, p.y - q.y) < minDist) return false;
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
    if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue; // outside this grid's own bbox -- cannot collide with anything placed inside it anyway
    place(p);
  }
  const newCount = points.length;
  const active = [];

  if (existingPoints.length) {
    // every seeded point is a candidate to expand FROM (Bridson's own "sample from an existing
    // point set" variant) -- this is what makes new points appear specifically in the GAPS a finer
    // `minDist` now allows between them, not at one arbitrary fresh start.
    for (let i = 0; i < newCount; i++) active.push(i);
  } else {
    // first pass, nothing to seed from yet -- reject-sample the bbox for one fresh start, same as
    // this function's own original (single-pass) behaviour.
    let first = null;
    for (let tries = 0; tries < 200 && !first; tries++) {
      const cand = { x: minX + rng() * w, y: minY + rng() * h };
      if (pointInPolygon(cand.x, cand.y, polygon)) first = cand;
    }
    if (!first) return []; // pathological (near-zero-area) shape -- no stones, not a crash
    place(first);
    active.push(points.length - 1);
  }

  while (active.length && points.length < MAX_POINTS) {
    const ai = Math.floor(rng() * active.length);
    const p = points[active[ai]];
    let found = false;
    for (let k = 0; k < POISSON_ATTEMPTS; k++) {
      const r = minDist * (1 + rng()); // [minDist, 2*minDist)
      const angle = rng() * Math.PI * 2;
      const cand = { x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r };
      if (cand.x < minX || cand.x > maxX || cand.y < minY || cand.y > maxY) continue;
      if (!pointInPolygon(cand.x, cand.y, polygon)) continue;
      if (!farEnough(cand)) continue;
      place(cand);
      active.push(points.length - 1);
      found = true;
      break;
    }
    if (!found) active.splice(ai, 1);
  }
  return points.slice(newCount);
}

/** One point's own Voronoi cell: start from a generous bounding box (big enough that no real
 *  neighbour's bisector could possibly be clipped away by it first) and clip inward by every
 *  nearby point's own perpendicular bisector. */
function voronoiCell(point, allPoints, boxPoly) {
  let poly = boxPoly;
  for (const other of allPoints) {
    if (other === point || poly.length < 3) continue;
    const mid = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
    const dx = other.x - point.x, dy = other.y - point.y;
    const len = Math.hypot(dx, dy) || 1;
    const line = { point: mid, dirX: -dy / len, dirY: dx / len };
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
  const shrink = (set.grout?.widthIn ?? 0) / 2; // a GLOBAL mortar-joint width, same for every
  // stone regardless of pass -- unlike cornerRadius below, grout does not shrink with stone size.

  const xs = boardOutline.map((p) => p.x), ys = boardOutline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  // the LARGEST (main) pass's own spacing sizes the bounding box margin / neighbour-search radius --
  // always a safe (if sometimes generous) upper bound for every smaller pass's own true neighbour
  // reach too, so no real neighbour (big or small) is ever missed.
  const margin = spacing * NEIGHBOR_RADIUS_FACTOR;
  const box = [
    { x: minX - margin, y: minY - margin }, { x: maxX + margin, y: minY - margin },
    { x: maxX + margin, y: maxY + margin }, { x: minX - margin, y: maxY + margin },
  ];
  const neighborRadius = spacing * NEIGHBOR_RADIUS_FACTOR;
  const minPieceArea = MIN_PIECE_FLOOR_FRACTION * (spacing * VOID_FILL_FRACTIONS[VOID_FILL_FRACTIONS.length - 1]) ** 2;

  // Builds ONE pass's own FINAL cells (voronoi -> board clip -> grout shrink -> round -> floor
  // check): each point in `passPoints` is Voronoi'd against its OWN pass's other points PLUS every
  // nearby `priorPoints` (bisector-clipped the same way, via `voronoiCell`'s shared neighbour list)
  // -- but `priorPoints`' own already-built cells are never touched by this call, so an earlier
  // pass's own result is frozen the moment it's returned, not just in practice but by construction
  // (see this file's own header for why that matters here specifically).
  const buildPassCells = (passPoints, priorPoints) => {
    const built = [];
    for (const point of passPoints) {
      const neighbours = [...passPoints, ...priorPoints].filter(
        (q) => q !== point && Math.hypot(q.x - point.x, q.y - point.y) <= neighborRadius,
      );
      let poly = voronoiCell(point, neighbours, box);
      if (poly.length < 3) continue;
      // H23 item 74 (de): the SAME shared clip bond.js's own rectangular cells now use (geometry.js's
      // clipPolygonToBoard) -- exact for a convex board, bond.js's own prior keep-whole-or-drop
      // fallback for a concave one. The Poisson sample point is always a safe refPoint (guaranteed
      // inside boardOutline by poissonDiscSample's own interior-only sampling).
      poly = clipPolygonToBoard(poly, boardOutline, point);
      if (poly.length < 3) continue;

      if (shrink > 1e-9) {
        poly = offsetPathInward(poly, shrink, inwardSignFor(poly));
        // H23 item 76 cont.: `clipPolygonToBoard`'s now-exact concave clip can leave a real edge
        // shorter than `shrink` right at the board's true boundary (MEASURED on T1's waist) --
        // offsetPathInward's own documented P1 limitation (see its header) flips that edge into a
        // bowtie rather than collapsing it. Drop the cell, same as every other degenerate-result
        // bail-out in this loop, rather than ship a self-intersecting stone.
        if (poly.length < 3 || !isSimplePolygon(poly)) continue;
      }
      poly = roundPolygonCorners(poly, point.spacing * CORNER_RADIUS_FACTOR);
      if (poly.length < 3) continue;
      // T86 item 6: the declared floor -- a stone (any pass) that shrank/clipped down to a true
      // sliver is dropped (stays void/grout), same "an honest gap, not a garbage render" treatment
      // every other degenerate-result bail-out in this loop already gives.
      if (Math.abs(signedArea(poly)) < minPieceArea) continue;
      built.push({ point, polygon: poly });
    }
    return built;
  };

  // Pass 1: the main stones -- the board's own base tessellation, exactly as the single-pass
  // version always built it. Passes `seed` straight through (not re-hashed via `seedFor`) so this
  // pass's own point set is BIT-IDENTICAL to the pre-item-6 baseline's only pass, and `buildPassCells`
  // is called with an EMPTY prior-points list, so the Voronoi computation itself is identical too --
  // the near-boundary behaviour the existing H23 item 76 test already measured against cannot regress.
  const pass1Points = poissonDiscSample(boardOutline, spacing, seed ?? 0).map((p) => ({ ...p, spacing }));
  if (!pass1Points.length) return { cells: [] };

  let priorPoints = pass1Points;
  let allBuilt = buildPassCells(pass1Points, []);

  // T86 item 6: each void-fill pass's own points are seeded (for its own finer minDist) against
  // every point already placed, so a new point can only ever land in whatever gap its own smaller
  // `minDist` still allows between them -- then its own cell is bisector-clipped against those same
  // prior points (via `buildPassCells`'s shared neighbour list) without ever rebuilding THEIR cells.
  //
  // `fraction * spacing` alone is not a safe floor for every set (MEASURED, T86 item 6: White rocks'
  // own grout is 0.12in, vs Set 1's 0.034in -- at Set 1's scale a 1/6-spacing stone's shrink is
  // negligible, but at White rocks' own 1.1in spacing, 1/6 is only 0.183in across, and shrinking that
  // by HALF the 0.12in grout on every side left almost nothing -- coverage barely moved past the
  // single-pass baseline). A stone needs real width left over after the grout shrink to be worth
  // placing at all, so each pass's own fill spacing is floored at `GROUT_CLEARANCE_FACTOR` times the
  // FULL grout width -- below that, a stone this size would mostly shrink/round/floor itself away
  // rather than add coverage, so there is no point even trying to place it.
  let prevSpacing = spacing;
  for (let i = 0; i < VOID_FILL_FRACTIONS.length; i++) {
    const fillSpacing = Math.min(prevSpacing, Math.max(spacing * VOID_FILL_FRACTIONS[i], GROUT_CLEARANCE_FACTOR * (set.grout?.widthIn ?? 0)));
    if (fillSpacing >= prevSpacing) break; // the grout floor already swallowed every finer step -- stop, don't repeat the same pass
    const passPoints = poissonDiscSample(boardOutline, fillSpacing, seedFor(seed ?? 0, 'fieldstone-pass', i + 1), priorPoints).map(
      (p) => ({ ...p, spacing: fillSpacing }),
    );
    prevSpacing = fillSpacing;
    if (!passPoints.length) continue;
    allBuilt = [...allBuilt, ...buildPassCells(passPoints, priorPoints)];
    priorPoints = [...priorPoints, ...passPoints];
  }

  const cells = allBuilt.map(({ point, polygon }, idx) => ({
    id: idx,
    polygon,
    courseIndex: Math.max(0, Math.round((point.y - minY) / spacing)),
    cx: point.x,
    cy: point.y,
    neighbors: {},
  }));
  return { cells };
}
