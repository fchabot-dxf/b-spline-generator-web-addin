/**
 * core/bricks/suppression.js — PORTABLE (see rng.js). Shape-agnostic: operates on the PIECE list
 * (pieces.js's own output, each already a group of 1-3 cell ids) + each member cell's own centre,
 * never raw layout-specific geometry.
 *
 * Fred's own rules, each a direct requirement here:
 *  - "suppression removes whole pieces" -> the unit scored/removed is a PIECE, not a cell.
 *  - "weighted to the top" -> each piece's own score blends a top-of-wall position term with a
 *    spatial noise term, mixed by `topBias`.
 *  - "exact % regardless of clumping" -> EXACT count removed = round(suppression * pieceCount),
 *    by ranking every piece's own score and taking the top-scoring slice -- never an independent
 *    per-piece probability (whose actual removed count would only be an EXPECTED value, with
 *    variance clumping could also shift).
 *  - "clumping = noise scale of the removal score" -> the spatial term's own NOISE FREQUENCY is
 *    what `clumping` controls (low clumping = fine/scattered-looking noise, high = coarse,
 *    producing visibly clustered removals) -- not the count, not the top-bias.
 *
 * Top-of-wall convention: "top" = the layout's own course index 0 (bondLayout.js starts its
 * course loop at the board outline's own minY) -- i.e. this assumes a Y-DOWN board convention
 * (smaller Y = higher on the wall), matching this app's own editor/SVG coordinate convention
 * elsewhere. A layout using a different convention would need its own course-index meaning here.
 */
import { valueNoise2 } from './noise2d.js';
import { polygonCentroid } from './geometry.js';
import { seedFor } from './rng.js';

/**
 * @param {Map} pieceOf — cellId -> {pieceId, cellIds} (pieces.assignPieces's own output)
 * @param {Array} cells — the layout's own cells (for each member's courseIndex/cx/cy)
 * @param {{suppression:number, topBias:number, clumping:number}} settings — all 0..1 except suppression (0..1 fraction)
 * @param {number} seed
 * @returns {Set<number>} the set of cellIds that are suppressed (removed)
 */
export function computeSuppressedCells(pieceOf, cells, settings, seed) {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const maxCourse = Math.max(1, ...cells.map((c) => c.courseIndex));

  // Group cells by their own piece (one score per piece, not per cell).
  const pieceGroups = new Map(); // pieceKey (first cellId) -> { cellIds, topWeight, cx, cy }
  const seen = new Set();
  for (const cell of cells) {
    const info = pieceOf.get(cell.id);
    if (!info || seen.has(info.cellIds[0])) continue;
    seen.add(info.cellIds[0]);
    const members = info.cellIds.map((id) => byId.get(id)).filter(Boolean);
    const avgCourse = members.reduce((s, c) => s + c.courseIndex, 0) / members.length;
    const cx = members.reduce((s, c) => s + c.cx, 0) / members.length;
    const cy = members.reduce((s, c) => s + c.cy, 0) / members.length;
    pieceGroups.set(info.cellIds[0], { cellIds: info.cellIds, topWeight: 1 - avgCourse / maxCourse, cx, cy });
  }

  const topBias = Math.max(0, Math.min(1, settings.topBias ?? 0.8));
  const clumping = Math.max(0, Math.min(1, settings.clumping ?? 0.3));
  const suppression = Math.max(0, Math.min(1, settings.suppression ?? 0));
  // clumping in [0,1] -> noise frequency: low clumping = higher frequency (fine/scattered),
  // high clumping = lower frequency (coarse/clustered). Declared mapping, documented.
  const freq = 1 / (0.3 + clumping * 3.0);

  const scored = [...pieceGroups.values()].map((g) => {
    const noise = valueNoise2(seed ^ 0x51ed270b, g.cx * freq, g.cy * freq);
    return { ...g, score: topBias * g.topWeight + (1 - topBias) * noise };
  });
  scored.sort((a, b) => b.score - a.score);

  const removeCount = Math.round(suppression * scored.length);
  const suppressed = new Set();
  for (let i = 0; i < removeCount; i++) {
    for (const id of scored[i].cellIds) suppressed.add(id);
  }
  return suppressed;
}

/** T86 item 29: the SAME crumble rule (computeSuppressedCells: whole pieces, weighted to the top, exact count, clumping
 *  = noise scale) for a laid brick list that has no layout cells -- the frame bands. Each brick is its own one-cell
 *  piece at its centroid; its course = the brick-height row its centroid falls in, counted from the topmost brick (so
 *  "the top" means what it means for the wall). `purpose` salts the seed, so the frame's noise is not the wall's.
 *  Returns the KEPT bricks, in their original order. */
export function suppressBricks(bricks, settings, seed, courseIn, purpose = 'frame-suppression') {
  if (!bricks.length || !((settings.suppression ?? 0) > 0)) return bricks;
  const centres = bricks.map((b) => polygonCentroid(b.polygon));
  const minY = Math.min(...centres.map((c) => c.y));
  const cells = centres.map((c, i) => ({ id: i, cx: c.x, cy: c.y, courseIndex: Math.floor((c.y - minY) / (courseIn > 0 ? courseIn : 1)) }));
  const pieceOf = new Map(cells.map((c) => [c.id, { pieceId: 'single', cellIds: [c.id] }]));
  const gone = computeSuppressedCells(pieceOf, cells, settings, seedFor(seed, purpose, 0));
  return bricks.filter((_, i) => !gone.has(i));
}
