/**
 * core/bricks/grout-cut.js -- T86 item 10 (Fred, the Raised brush's mode 2 "grout mode": cuts through bricks to add
 * grout joints wherever it is drawn). Portable, pure polygon ops, board inches.
 *
 * bricksGroutCut(bricks, polyline, { widthIn, minPieceArea }) -> bricks
 *   The polyline swept by a round brush of `widthIn` (the global grout width) is subtracted from every brick it
 *   crosses (geometry.js polygonDifference: the whole stroke as one swept band -- sweptBand below -- or, for a dab or a
 *   stroke that crosses itself, one capsule per segment). A brick it does not touch comes back as it was
 *   (the same object). A cut brick becomes its pieces, each keeping the brick's own fields (sample, flip, texture
 *   offset, heightOffset ...) with ids `<id>.<k>`; a piece under `minPieceArea` (the caller passes the layout's own
 *   floor, piece-floor.js minPieceAreaOf) drops into the joint. What the cut removes simply has no brick,
 *   so the height map shows grout there. A cut that never reaches a brick's edge (a dab inside one brick) cannot
 *   open a joint in it: that brick stays whole. Applied AFTER a lay, so the app keeps each cut as its own element and
 *   re-applies the list after any rebuild.
 */
import { polygonDifference, signedArea, isSimplePolygon } from './geometry.js';
import { scaledSet } from './library.js';
import { minPieceAreaOf } from './piece-floor.js';

/** T86 item 10: the declared grout cuts -- each { polyline: [{x, y}, ...], widthIn? } with at least one point. */
export const groutCutsOf = (list) => (Array.isArray(list) ? list.filter((c) => c && Array.isArray(c.polyline) && c.polyline.length) : []);

/** T86 item 10, THE cut step every element runs (the Wall / Frame / window surround in generateBricks, each Brush stroke
 *  in the app): `pieces` laid with `set` at `scale` are cut by every cut in turn, at the set's own joint unless the cut
 *  declares a width; a piece under the floor of the layout that laid it (`laidBy`, default the set's own; piece-floor.js
 *  minPieceAreaOf of the scaled set: a quarter brick, or a fieldstone wall's / stone ring's smallest stone) drops into the joint. No cut, or no pieces = `pieces` itself. */
export function applyGroutCuts(pieces, cuts, set, scale = 1, laidBy = set.layout) {
  const list = groutCutsOf(cuts);
  if (!list.length || !pieces || !pieces.length) return pieces;
  const eff = scaledSet(set, scale);
  const minPieceArea = minPieceAreaOf(eff, laidBy); // the laying layout's own floor (piece-floor.js: fieldstone's smallest stone's)
  return list.reduce((acc, c) => bricksGroutCut(acc, c.polyline, { widthIn: c.widthIn ?? eff.grout.widthIn, minPieceArea }), pieces);
}

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
/** Item 10 (seat D, measured in the brush matrix: a cut drawn down a tall Soldier brush piece left it whole -- 6 of 36
 *  samples of the cut still under a piece): one capsule per SEGMENT never splits a piece that no single segment
 *  crosses edge to edge (each capsule wholly inside it is ignored as a dab). So the cut is the WHOLE polyline swept by
 *  the disc: its two sides offset by r (a mitred join, bevelled past BAND_MITER_LIMIT) and a round cap at each end, as
 *  one polygon. null for a single point or a band that crosses itself (a looping stroke): the caller then falls back
 *  to the per-segment capsules. */
const BAND_MITER_LIMIT = 4;
function sweptBand(points, r) {
  const p = points.filter((q, i) => i === 0 || Math.hypot(q.x - points[i - 1].x, q.y - points[i - 1].y) > 1e-9);
  if (p.length < 2) return null;
  const n = p.length, dir = [];
  for (let i = 0; i < n - 1; i++) { const dx = p[i + 1].x - p[i].x, dy = p[i + 1].y - p[i].y, l = Math.hypot(dx, dy); dir.push({ x: dx / l, y: dy / l }); }
  const side = (s) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const d0 = dir[Math.max(0, i - 1)], d1 = dir[Math.min(n - 2, i)];
      const n0 = { x: -d0.y * s, y: d0.x * s }, n1 = { x: -d1.y * s, y: d1.x * s };
      if (i === 0 || i === n - 1) { const nn = i === 0 ? n1 : n0; out.push({ x: p[i].x + nn.x * r, y: p[i].y + nn.y * r }); continue; }
      const mx = n0.x + n1.x, my = n0.y + n1.y, ml = Math.hypot(mx, my), cosHalf = ml / 2;
      if (ml < 1e-9 || 1 / cosHalf > BAND_MITER_LIMIT) {
        out.push({ x: p[i].x + n0.x * r, y: p[i].y + n0.y * r }, { x: p[i].x + n1.x * r, y: p[i].y + n1.y * r });
      } else out.push({ x: p[i].x + (mx / ml) * (r / cosHalf), y: p[i].y + (my / ml) * (r / cosHalf) });
    }
    return out;
  };
  const cap = (c, from, steps = CAP_STEPS) => Array.from({ length: steps - 1 }, (_, k) => {
    const t = from + (Math.PI * (k + 1)) / steps; return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) };
  });
  const endBase = Math.atan2(dir[n - 2].y, dir[n - 2].x), startBase = Math.atan2(dir[0].y, dir[0].x);
  const band = [...side(-1), ...cap(p[n - 1], endBase - Math.PI / 2), ...side(1).reverse(), ...cap(p[0], startBase + Math.PI / 2)];
  return isSimplePolygon(band) ? band : null;
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
  // the whole stroke as one swept band (sweptBand); a dab or a self-crossing stroke: one capsule per segment, as before
  const band = sweptBand(pts, r);
  const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((p, i) => [pts[i], p]);
  const cuts = (band ? [band] : segs.map(([a, b]) => capsule(a, b, r))).map((polygon) => ({ polygon, box: boxOf(polygon) }));
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
