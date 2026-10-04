/**
 * core/bricks/layouts/basketweave.js — PORTABLE (see rng.js). F35 item 7, REBUILT per advisor
 * review (a greedy-packed first version read as "irregular clusters of 2-4 bricks with holes, not
 * a checkerboard of squares" at 1:1 -- a greedy pack cannot produce a REGULAR weave, confirmed by
 * that review): a plain CLOSED-FORM grid, the advisor's own exact spec --
 *
 *   unit square side = brickLengthIn (L); n = round(L / (brickHeightIn + grout)) bricks per
 *   square (Set 1 at 3.75:1 -> n=3, "a 3-brick basketweave"); squares tile an L x L grid and
 *   alternate horizontal/vertical orientation by (i+j) checkerboard parity; clip to the real
 *   outline at the end.
 *
 * Within one square, `n` bricks of the square's own orientation are packed edge-to-edge (full L
 * long, each `pitch = L/n` apart) so they fill the square EXACTLY -- the per-brick cross-width is
 * `pitch - grout`, snapped to fit this square's own side the same way contour-bands.js already
 * snaps a Frame band's own width to a whole number of brick rows (never stretched, the fit absorbs
 * into a slightly adjusted effective joint instead). Adjacent squares' own outermost bricks meet
 * FLUSH (no additional inter-square gap) -- the square grid itself has zero gap, exactly the
 * advisor's own "unit square side = L" spec, not L+grout.
 */
import { clipPolygonToBoard, rectPolygon } from '../geometry.js';

/**
 * @param {{x:number,y:number}[]} boardOutline — closed polygon, board inches
 * @param {{brickLengthIn:number, brickHeightIn:number, grout:{widthIn:number}}} set
 * @param {Array} [_zones] — unused (same call-signature-parity precedent as fieldstone.js)
 * @returns {{cells: Array}}
 */
export function basketweaveLayout(boardOutline, set, _zones) {
  const L = set.brickLengthIn, W = set.brickHeightIn, g = set.grout.widthIn;
  const n = Math.max(1, Math.round(L / (W + g)));
  const pitch = L / n;
  const crossWidth = Math.max(0, pitch - g);

  const xs = boardOutline.map((p) => p.x), ys = boardOutline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const iCount = Math.ceil((maxX - minX) / L) + 1;
  const jCount = Math.ceil((maxY - minY) / L) + 1;

  const cells = [];
  let nextId = 0;
  for (let i = -1; i <= iCount; i++) {
    for (let j = -1; j <= jCount; j++) {
      const sqX0 = minX + i * L, sqY0 = minY + j * L;
      const horizontal = (i + j) % 2 === 0;
      for (let k = 0; k < n; k++) {
        let cx, cy, halfLen, halfHt, dirX, dirY;
        if (horizontal) {
          // n rows stacked in Y, each brick full L long (along X), crossWidth tall.
          cx = sqX0 + L / 2;
          cy = sqY0 + k * pitch + crossWidth / 2;
          halfLen = L / 2; halfHt = crossWidth / 2; dirX = 1; dirY = 0;
        } else {
          // n columns stacked in X, each brick full L tall (along Y), crossWidth wide.
          cx = sqX0 + k * pitch + crossWidth / 2;
          cy = sqY0 + L / 2;
          halfLen = L / 2; halfHt = crossWidth / 2; dirX = 0; dirY = 1;
        }
        const poly = rectPolygon(cx, cy, halfLen, halfHt, dirX, dirY);
        const clipped = clipPolygonToBoard(poly, boardOutline, { x: cx, y: cy });
        if (clipped.length < 3) continue;
        cells.push({ id: nextId++, polygon: clipped, courseIndex: j, cx, cy, neighbors: {} });
      }
    }
  }
  return { cells };
}
