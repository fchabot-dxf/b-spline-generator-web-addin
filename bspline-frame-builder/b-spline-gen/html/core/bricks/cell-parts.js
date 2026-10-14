/**
 * core/bricks/cell-parts.js -- PORTABLE (see rng.js). Fred 2026-10-14 (pick A, the pattern gaps): a wall cell that a frame
 * corner or tip jutting into the region cuts in TWO lays EVERY part -- the clip used to keep the larger, and the other was
 * never laid (T9 7x9 1 in double_herringbone: a 0.06 sq in triangle, a 0.26-face hole). Every tile2d layout and the bond.
 *
 * Saved boards: today's pieces stay EXACTLY as laid -- the cell keeps today's clip (its largest part) and its id, so its
 * samples, flip, height and piece chain (all seeded by the cell id, rng.js seedFor) are unchanged. Each other part is a
 * NEW cell appended after every cell of the lay, its id `partCellId(parent, k)` in a range of its own: seeded by its
 * parent cell's id and its part index, never shifting another cell's id. tests/bricks-cell-parts.test.js pins both.
 */
import { clipPolygonToRegion, clipPolygonToRegionParts, clipPolygonToBoard, polygonIntersectionParts, signedArea, isConvex } from './geometry.js';

export const CELL_PART = Object.freeze({
  idOffset: 1 << 24, // part ids start here: above any cell count a lay reaches
  perCell: 8, // ids per parent: part k (1..perCell-1) of cell id p is idOffset + p * perCell + k
  minSqIn: 0.002, // a part no larger than a grout-wide fleck is not laid (band-motif.js MOTIF_FLECK_SQIN: a small piece beats a hole)
  // a bond cell today's clip lost WHOLE (a region bridged at a narrow tip: the board clip is not lobe-aware -- MEASURED T16 7x9
  // 1.5 in english, a course-4 stretcher across the V clipped to nothing, a 0.07-face hole): its parts take the place of a
  // parent with this id, keyed by its course and column (orphanParentId), below every real part id
  orphanBase: 1 << 23,
});
export const orphanParentId = (courseIndex, colIndex) => CELL_PART.orphanBase + courseIndex * 4096 + colIndex;
export const partCellId = (parentId, k) => CELL_PART.idOffset + parentId * CELL_PART.perCell + k;
export const isPartCellId = (id) => typeof id === 'number' && id >= CELL_PART.idOffset;

const centroidOf = (p) => p.reduce((a, q) => ({ x: a.x + q.x / p.length, y: a.y + q.y / p.length }), { x: 0, y: 0 });
function partsBeside(main, parts) {
  if (main.length < 3 || parts.length < 2) return [];
  const area = (p) => Math.abs(signedArea(p));
  const largest = parts.reduce((b, p) => (area(p) > area(b) ? p : b), parts[0]);
  return parts.filter((p) => p !== largest && area(p) > CELL_PART.minSqIn).slice(0, CELL_PART.perCell - 1);
}
/** The tile2d clip: `main` = clipPolygonToRegion's own answer (today's piece), `extra` = the cell's other parts. */
export function clipRegionCellParts(poly, region, ref) {
  const main = clipPolygonToRegion(poly, region, ref);
  return { main, extra: partsBeside(main, clipPolygonToRegionParts(poly, region, ref)) };
}
/** The bond's clip (clipPolygonToBoard): the same split; a cell it loses whole has every lobe's part in `extra`. */
export function clipBoardCellParts(poly, board, ref) {
  const main = clipPolygonToBoard(poly, board, ref);
  if (isConvex(board)) return { main, extra: [] };
  if (main.length < 3) return { main, extra: clipPolygonToRegionParts(poly, board, ref).filter((p) => Math.abs(signedArea(p)) > CELL_PART.minSqIn).slice(0, CELL_PART.perCell - 1) };
  return { main, extra: partsBeside(main, polygonIntersectionParts(poly, board)) };
}
/** Appends each parent's other parts as new cells (after every cell of the lay): `pending` = [{ parent, extra }]. */
export function appendPartCells(cells, pending) {
  for (const { parent, extra } of pending) {
    extra.forEach((polygon, i) => {
      const c = centroidOf(polygon);
      cells.push({ ...parent, id: partCellId(parent.id, i + 1), polygon, cx: c.x, cy: c.y, neighbors: {}, partOf: parent.id });
    });
  }
  return cells;
}
/** The layouts record a cell's other parts against their `cells` array as they clip (recordCellParts); fill-shape.js appends
 *  them after the whole lay (takeCellParts + appendPartCells) -- one place, whatever the layout. */
const PENDING = new WeakMap();
export function recordCellParts(cells, parent, extra) {
  if (!extra.length) return;
  if (!PENDING.has(cells)) PENDING.set(cells, []);
  PENDING.get(cells).push({ parent, extra });
}
export function takeCellParts(cells) {
  const pending = PENDING.get(cells) || [];
  PENDING.delete(cells);
  return pending;
}
