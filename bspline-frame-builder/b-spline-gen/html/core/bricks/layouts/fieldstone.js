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
 */
import { pointInPolygon, clipToHalfPlane, clipPolygonToBoard, offsetPathInward, inwardSignFor, roundPolygonCorners, isSimplePolygon } from '../geometry.js';
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

/** Bridson's Poisson-disc sampling, restricted to the interior of `polygon`: every returned point
 *  is >= minDist from every other, roughly evenly covering the shape, with no two stones ever
 *  landing on top of each other. Grid-accelerated (cell size minDist/sqrt(2)) so the "far enough
 *  from every existing point" check stays cheap even with hundreds of points. */
function poissonDiscSample(polygon, minDist, seed) {
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  if (w < 1e-6 || h < 1e-6 || minDist < 1e-6) return [];

  const rng = mulberry32(seedFor(seed, 'fieldstone-poisson', 0));
  const cellSize = minDist / Math.SQRT2;
  const gw = Math.max(1, Math.ceil(w / cellSize)), gh = Math.max(1, Math.ceil(h / cellSize));
  const grid = new Array(gw * gh).fill(-1);
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

  // seed point: reject-sample the bbox until a point lands inside the polygon
  let first = null;
  for (let tries = 0; tries < 200 && !first; tries++) {
    const cand = { x: minX + rng() * w, y: minY + rng() * h };
    if (pointInPolygon(cand.x, cand.y, polygon)) first = cand;
  }
  if (!first) return []; // pathological (near-zero-area) shape -- no stones, not a crash

  place(first);
  const active = [0];
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
  return points;
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
  const shrink = (set.grout?.widthIn ?? 0) / 2;
  const cornerRadius = spacing * CORNER_RADIUS_FACTOR;

  const points = poissonDiscSample(boardOutline, spacing, seed ?? 0);
  if (!points.length) return { cells: [] };

  const xs = boardOutline.map((p) => p.x), ys = boardOutline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const margin = spacing * NEIGHBOR_RADIUS_FACTOR;
  const box = [
    { x: minX - margin, y: minY - margin }, { x: maxX + margin, y: minY - margin },
    { x: maxX + margin, y: maxY + margin }, { x: minX - margin, y: maxY + margin },
  ];
  const neighborRadius = spacing * NEIGHBOR_RADIUS_FACTOR;

  const cells = [];
  let nextId = 0;
  for (const point of points) {
    const nearby = points.filter((q) => q !== point && Math.hypot(q.x - point.x, q.y - point.y) <= neighborRadius);
    let poly = voronoiCell(point, nearby, box);
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
    poly = roundPolygonCorners(poly, cornerRadius);
    if (poly.length < 3) continue;

    const courseIndex = Math.max(0, Math.round((point.y - minY) / spacing));
    cells.push({ id: nextId++, polygon: poly, courseIndex, cx: point.x, cy: point.y, neighbors: {} });
  }
  return { cells };
}
