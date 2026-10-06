/**
 * item 67 (test infra): the pairwise overlap check the fieldstone tests share, with a bounding-box prefilter -- two
 * polygons whose boxes do not overlap cannot intersect, so a skipped pair adds exactly the 0 it added before. The
 * unfiltered O(n^2) polygonIntersection was the whole cost of the slowest fieldstone tests (largeStones=1: 25 s alone
 * under the fleet's load). tests/bricks-fieldstone.test.js already filtered this way.
 */
import { polygonIntersection, signedArea } from '../../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

export function bboxOf(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return { x0, y0, x1, y1 };
}
export const boxesMeet = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
export const boxHas = (b, x, y) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

/** Total pairwise intersection area of `cells` ({ polygon }). */
export function totalOverlapArea(cells) {
  const boxes = cells.map((c) => bboxOf(c.polygon));
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (!boxesMeet(boxes[i], boxes[j])) continue;
      const inter = polygonIntersection(cells[i].polygon, cells[j].polygon);
      if (inter.length >= 3) total += Math.abs(signedArea(inter));
    }
  }
  return total;
}
