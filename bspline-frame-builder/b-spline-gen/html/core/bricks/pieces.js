/**
 * core/bricks/pieces.js — PORTABLE (see rng.js). Shape-agnostic piece ASSIGNMENT: groups cells
 * (from ANY layout) into 1-3 cell clusters for suppression to act on as one correlated unit, via
 * whatever adjacency the layout already attached to each cell (`cell.neighbors.below`, present on
 * every layout's own cells regardless of geometry) -- never raw coordinate math, so a future
 * non-rect layout (P2/P3) needs no change here.
 *
 * P1 SCOPE DECISION (documented, not an oversight): a piece's own declared `offsets` (library.js)
 * are NOT used to reposition cells here -- the layout already fixed every cell's own position on
 * its regular grid, and moving a piece's member cells off that grid risks overlapping its
 * non-piece neighbours. `offsets` stay declared, correct, matching the reference catalogue
 * (shots/advisor/brick_piece_catalog.png) exactly, ready for a later piece-aware placement pass;
 * for now, piece SELECTION only consumes `piece.bricks` (the group size), chosen at random
 * (seeded) among enabled pieces of each size actually reachable from a given anchor cell.
 */
import { mulberry32, seedFor } from './rng.js';

/**
 * @param {Array} cells — from a layout's own `{cells}` (each needs `.id` and `.neighbors.below`)
 * @param {Array} catalogue — enabled pieces (library.enabledPieces())
 * @param {number} seed
 * @returns {Map<number, {pieceId:string, cellIds:number[]}>} cellId -> the piece it belongs to
 */
export function assignPieces(cells, catalogue, seed) {
  const bySize = { 1: [], 2: [], 3: [] };
  for (const p of catalogue) if (bySize[p.bricks]) bySize[p.bricks].push(p);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const assigned = new Set();
  const pieceOf = new Map();
  // Deterministic order (by id) so the result never depends on Map/array iteration quirks.
  const ordered = [...cells].sort((a, b) => a.id - b.id);

  for (const cell of ordered) {
    if (assigned.has(cell.id)) continue;
    // Walk downward via adjacency to see how large a group is actually reachable from here.
    const chain = [cell];
    let cur = cell;
    while (chain.length < 3 && cur.neighbors.below && !assigned.has(cur.neighbors.below.id)) {
      cur = cur.neighbors.below;
      chain.push(cur);
    }
    const maxReachable = chain.length;
    const sizesAvailable = [1, 2, 3].filter((n) => n <= maxReachable && bySize[n].length > 0);
    const sizeRng = mulberry32(seedFor(seed, 'piece-size', cell.id));
    const size = sizesAvailable[Math.floor(sizeRng() * sizesAvailable.length)];
    const options = bySize[size];
    const pieceRng = mulberry32(seedFor(seed, 'piece-id', cell.id));
    const piece = options[Math.floor(pieceRng() * options.length)];
    const cellIds = chain.slice(0, size).map((c) => c.id);
    for (const id of cellIds) { assigned.add(id); pieceOf.set(id, { pieceId: piece.id, cellIds }); }
  }
  return pieceOf;
}
