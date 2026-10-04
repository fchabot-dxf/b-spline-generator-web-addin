/**
 * core/bricks/layouts/bond.js — PORTABLE (see rng.js). The 'bond' layout: rectangular bricks in
 * horizontal courses, clipped to `boardOutline`.
 *
 * H23 item 72 (advisor, "patterns of different width" / ref_brick_bond_zones.jpg): the wall can be
 * split into horizontal ZONES, top -> bottom, each with its own BOND KIND:
 *   'running' — half-brick stagger (the original/default behaviour)
 *   'stack'   — same orientation as running, no stagger (joints line up vertically)
 *   'soldier' — bricks stood on end: length/height SWAPPED, no stagger
 * Each zone is `{ bond, rows }` or `{ bond, heightIn }`; a zone with neither is a FILL zone that
 * absorbs whatever height the sized zones don't claim (if several zones are unsized, they split
 * the leftover height evenly). Default (no zones given) = a single running zone covering the
 * whole board, i.e. byte-identical to the pre-zones behaviour.
 *
 * Produces CELLS only (geometry + adjacency) -- no pieces, no suppression, no samples. Those are
 * shape-agnostic and live in pieces.js/suppression.js/samples.js, operating on whatever a layout
 * hands back here (Fred/the advisor: "nothing in suppression/clumping/frame/pieces assumes
 * rectangles beyond the bond layout itself").
 *
 * Edge treatment, H23 item 74 (de, F35 item 1 review: "a brick crossing the edge should be CUT,
 * not dropped or left hanging"): every cell is clipped to `boardOutline` via geometry.js's own
 * clipPolygonToBoard -- an EXACT cut for a convex board (every real board so far), never
 * stretched (a cut-down brick's own remaining shape is still its true physical size, just
 * trimmed, same as a real last-brick-in-a-row cut to fit a wall) -- with `boardOutline`'s own
 * documented concave fallback (keep WHOLE or drop, the prior behaviour) when it isn't convex.
 * Adjacency/course assignment below still uses each cell's own UNCLIPPED grid centre (cx/cy) --
 * clipping only trims the stored polygon, never the logical grid position neighbours/suppression
 * reason about.
 */
import { rectPolygon, clipPolygonToBoard } from '../geometry.js';

const BOND_KINDS = {
  running: { stagger: true, rotated: false },
  stack: { stagger: false, rotated: false },
  soldier: { stagger: false, rotated: true },
};

function bondKind(name) {
  return BOND_KINDS[name] || BOND_KINDS.running;
}

/** Resolve a declared zone list into a concrete per-zone row count, given the board's total
 *  height -- an unsized zone (no `rows`/`heightIn`) fills whatever's left over. */
function resolveZones(set, zones, totalHeight) {
  const list = (zones && zones.length) ? zones : [{ bond: 'running' }];
  const J = set.grout.widthIn;
  const pitchFor = (bond) => (bondKind(bond).rotated ? set.brickLengthIn : set.brickHeightIn) + J;

  const sized = list.map((z) => {
    const bond = z.bond || 'running';
    const pitch = pitchFor(bond);
    if (z.rows != null) return { bond, pitch, rows: z.rows };
    if (z.heightIn != null) return { bond, pitch, rows: Math.max(1, Math.round(z.heightIn / pitch)) };
    return { bond, pitch, rows: null };
  });

  const fixedHeight = sized.filter((z) => z.rows != null).reduce((s, z) => s + z.rows * z.pitch, 0);
  const unsized = sized.filter((z) => z.rows == null);
  if (unsized.length) {
    const share = Math.max(0, totalHeight - fixedHeight) / unsized.length;
    for (const z of unsized) z.rows = Math.max(1, Math.ceil(share / z.pitch));
  }
  return sized;
}

/**
 * @param {{x:number,y:number}[]} boardOutline — closed polygon, board inches
 * @param {{brickLengthIn:number, brickHeightIn:number, grout:{widthIn:number}}} set — the active brick set
 * @param {{bond?:'running'|'stack'|'soldier', rows?:number, heightIn?:number}[]} [zones] — top -> bottom
 * @returns {{cells: Array}} cells[i] = { id, polygon, courseIndex, colIndex, neighbors:{left,right,above,below} }
 */
export function bondLayout(boardOutline, set, zones) {
  const xs = boardOutline.map((p) => p.x), ys = boardOutline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);

  const L = set.brickLengthIn, H = set.brickHeightIn, J = set.grout.widthIn;
  const maxDim = Math.max(L, H);

  const resolvedZones = resolveZones(set, zones, maxY - minY);
  const courseBonds = [];
  for (const z of resolvedZones) for (let i = 0; i < z.rows; i++) courseBonds.push(z.bond);

  // course-by-course grid, keyed by [courseIndex] -> array of cells (so adjacency can look sideways
  // within a course directly by array index, and up/down by matching column-centre proximity --
  // adjacent courses can be staggered and/or a different bond kind, so "the cell above" is
  // whichever overlaps this one's own x-span the most, not a fixed column index).
  const courses = [];
  let cy = minY;
  for (let c = 0; c < courseBonds.length; c++) {
    const kind = bondKind(courseBonds[c]);
    const cL = kind.rotated ? H : L, cH = kind.rotated ? L : H;
    const coursePitch = cH + J, colPitch = cL + J;
    const courseCy = cy + cH / 2;
    const stagger = (kind.stagger && c % 2 === 1) ? colPitch / 2 : 0;
    const colCount = Math.ceil((maxX - minX + colPitch) / colPitch) + 1;
    const row = [];
    for (let i = -1; i < colCount; i++) {
      const cx = minX - stagger + i * colPitch + cL / 2;
      if (cx + cL / 2 < minX - 1e-6 || cx - cL / 2 > maxX + 1e-6) continue;
      const polygon = rectPolygon(cx, courseCy, cL / 2, cH / 2);
      row.push({ courseIndex: c, colIndex: row.length, cx, cy: courseCy, polygon });
    }
    courses.push(row);
    cy += coursePitch;
    if (cy > maxY + maxDim) break; // past the board -- later zones (if any) would be invisible anyway
  }

  const cells = [];
  let nextId = 0;
  const idGrid = courses.map(() => []);
  for (let c = 0; c < courses.length; c++) {
    for (let k = 0; k < courses[c].length; k++) {
      const cell = courses[c][k];
      const clipped = clipPolygonToBoard(cell.polygon, boardOutline, { x: cell.cx, y: cell.cy });
      if (clipped.length < 3) { idGrid[c].push(-1); continue; } // fully outside, or clipped to a degenerate sliver
      const id = nextId++;
      idGrid[c].push(id);
      cells.push({ id, polygon: clipped, courseIndex: c, colIndex: k, cx: cell.cx, cy: cell.cy, neighbors: {} });
    }
  }
  const byId = new Map(cells.map((c) => [c.id, c]));
  for (const cell of cells) {
    const row = idGrid[cell.courseIndex];
    const leftId = cell.colIndex > 0 ? row[cell.colIndex - 1] : -1;
    const rightId = cell.colIndex < row.length - 1 ? row[cell.colIndex + 1] : -1;
    cell.neighbors.left = leftId >= 0 ? byId.get(leftId) : null;
    cell.neighbors.right = rightId >= 0 ? byId.get(rightId) : null;
    // "above"/"below": the neighbouring course's own cell whose x-span overlaps this one's centre
    // most closely (courses can be staggered and/or a different bond kind, so there is no fixed
    // column correspondence).
    const findOverlap = (courseIdx) => {
      if (courseIdx < 0 || courseIdx >= idGrid.length) return null;
      let best = null, bestDist = Infinity;
      for (const otherId of idGrid[courseIdx]) {
        if (otherId < 0) continue;
        const other = byId.get(otherId);
        const d = Math.abs(other.cx - cell.cx);
        if (d < bestDist) { bestDist = d; best = other; }
      }
      return best && bestDist < maxDim ? best : null;
    };
    cell.neighbors.above = findOverlap(cell.courseIndex - 1);
    cell.neighbors.below = findOverlap(cell.courseIndex + 1);
  }
  return { cells, brickLengthIn: L, brickHeightIn: H };
}
