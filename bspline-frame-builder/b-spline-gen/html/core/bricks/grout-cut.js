/**
 * core/bricks/grout-cut.js -- T86 item 10 (Fred, the Raised brush's mode 2 "grout mode": cuts through bricks to add
 * grout joints wherever it is drawn). Portable, pure polygon ops, board inches.
 *
 * bricksGroutCut(bricks, polyline, { widthIn, minPieceArea }) -> bricks
 *   The polyline swept by a round brush of `widthIn` (the global grout width) is subtracted from every brick it
 *   crosses (geometry.js polygonDifference, one capsule per segment). A brick it does not touch comes back as it was
 *   (the same object). A cut brick becomes its pieces, each keeping the brick's own fields (sample, flip, texture
 *   offset, heightOffset ...) with ids `<id>.<k>`; a piece under `minPieceArea` (the caller passes the quarter-brick
 *   floor, library.js MIN_PIECE_FRACTION x one brick) drops into the joint. What the cut removes simply has no brick,
 *   so the height map shows grout there. A cut that never reaches a brick's edge (a dab inside one brick) cannot
 *   open a joint in it: that brick stays whole. Applied AFTER a lay, so the app keeps each cut as its own element and
 *   re-applies the list after any rebuild.
 */
import { polygonDifference, signedArea } from './geometry.js';

const CAP_STEPS = 8; // per half-circle: a cap's chord sags < 2% of the half-width

/** one segment swept by a disc of radius r, as a convex polygon (a dab when a === b) */
function capsule(a, b, r) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = len > 1e-12 ? (b.x - a.x) / len : 1, uy = len > 1e-12 ? (b.y - a.y) / len : 0;
  const base = Math.atan2(uy, ux);
  const pts = [];
  for (let k = 0; k <= CAP_STEPS; k++) { const t = base - Math.PI / 2 + (Math.PI * k) / CAP_STEPS; pts.push({ x: b.x + r * Math.cos(t), y: b.y + r * Math.sin(t) }); }
  for (let k = 0; k <= CAP_STEPS; k++) { const t = base + Math.PI / 2 + (Math.PI * k) / CAP_STEPS; pts.push({ x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) }); }
  return pts;
}
const boxOf = (poly) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1 };
};
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export function bricksGroutCut(bricks, polyline, { widthIn, minPieceArea = 0 } = {}) {
  const pts = polyline || [];
  if (!pts.length || !(widthIn > 0)) return bricks;
  const r = widthIn / 2;
  const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((p, i) => [pts[i], p]);
  const cuts = segs.map(([a, b]) => { const polygon = capsule(a, b, r); return { polygon, box: boxOf(polygon) }; });
  const out = [];
  for (const brick of bricks) {
    const box = boxOf(brick.polygon);
    let pieces = [brick.polygon], touched = false;
    for (const c of cuts) {
      if (!overlap(box, c.box)) continue;
      const next = [];
      for (const piece of pieces) {
        const left = polygonDifference(piece, c.polygon);
        if (left.holeIgnored) { next.push(piece); continue; } // wholly inside the piece: no edge reached, no joint
        // a cut that only touches comes back as one piece of the same area (a copy): not a cut
        if (left.length === 1 && Math.abs(Math.abs(signedArea(left[0])) - Math.abs(signedArea(piece))) < 1e-9) { next.push(piece); continue; }
        touched = true;
        next.push(...left);
      }
      pieces = next;
    }
    if (!touched) { out.push(brick); continue; }
    pieces.filter((p) => Math.abs(signedArea(p)) >= minPieceArea)
      .forEach((polygon, k) => out.push({ ...brick, id: `${brick.id}.${k}`, polygon }));
  }
  return out;
}
