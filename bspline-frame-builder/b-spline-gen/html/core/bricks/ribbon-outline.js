/**
 * core/bricks/ribbon-outline.js -- F35 item 55 follow-up (seat E, advisor): the OUTLINE of an open, centred brick
 * ribbon (a Brush stroke laid by bricksContourBands with closed:false, centered:true), so the stroke gets a grout shape
 * like a Wall or a Frame (grout-shape.js groutShapeOf: region minus faces). PORTABLE, board inches.
 *
 *   openRibbonOutline(enriched, depthA, depthB) -> {x,y}[]  (one closed loop, empty when it cannot be built)
 *
 * `enriched`: contour-bands.js's enrichPrimitives output (a line's unit normal nx/ny; an arc's radialSign), the SAME
 * primitives the bricks were laid from. Each edge is every primitive offset to that depth -- a line by its normal, an
 * arc by r - radialSign x depth (primitive-ribbon.js offsetPrimitive's convention) -- consecutive primitives meeting at
 * their offset curves' intersection nearest the original junction (curve-intersect.js, the bricks' own mitre rule), a
 * bevel where the offsets do not meet. The ends are closed square (the edges' first and last points joined), as the
 * ribbon's end bricks are cut square.
 */
import { curveIntersection } from './curve-intersect.js';

export const RIBBON_ARC_STEP_RAD = Math.PI / 36; // an offset arc is drawn in 5 degree chords

function offset(prim, d) {
  if (prim.type === 'line') {
    return { type: 'line', p0: { x: prim.p0.x + prim.nx * d, y: prim.p0.y + prim.ny * d }, p1: { x: prim.p1.x + prim.nx * d, y: prim.p1.y + prim.ny * d } };
  }
  return { type: 'arc', cx: prim.cx, cy: prim.cy, r: prim.r - prim.radialSign * d, theta1: prim.theta1, theta2: prim.theta2 };
}
const startOf = (o) => (o.type === 'line' ? o.p0 : { x: o.cx + o.r * Math.cos(o.theta1), y: o.cy + o.r * Math.sin(o.theta1) });
const endOf = (o) => (o.type === 'line' ? o.p1 : { x: o.cx + o.r * Math.cos(o.theta2), y: o.cy + o.r * Math.sin(o.theta2) });
const curveOf = (o) => (o.type === 'line'
  ? { type: 'line', p0: o.p0, dir: { x: o.p1.x - o.p0.x, y: o.p1.y - o.p0.y } }
  : { type: 'circle', c: { x: o.cx, y: o.cy }, r: o.r });
function arcInterior(o) {
  const out = [], sweep = o.theta2 - o.theta1, n = Math.max(1, Math.ceil(Math.abs(sweep) / RIBBON_ARC_STEP_RAD));
  for (let k = 1; k < n; k++) { const t = o.theta1 + (sweep * k) / n; out.push({ x: o.cx + o.r * Math.cos(t), y: o.cy + o.r * Math.sin(t) }); }
  return out;
}

/** One edge of the ribbon at `depth`, start to end. */
export function ribbonEdge(enriched, depth) {
  const offs = (enriched || []).map((p) => offset(p, depth));
  if (!offs.length || offs.some((o) => o.type === 'arc' && !(o.r > 0))) return [];
  const pts = [startOf(offs[0])];
  offs.forEach((o, i) => {
    if (o.type === 'arc') pts.push(...arcInterior(o));
    if (i === offs.length - 1) { pts.push(endOf(o)); return; }
    const next = offs[i + 1];
    const ref = endOf(offset(enriched[i], 0));
    const j = curveIntersection(curveOf(o), curveOf(next), ref);
    if (j && Number.isFinite(j.x) && Number.isFinite(j.y)) pts.push(j);
    else pts.push(endOf(o), startOf(next)); // no meeting point: a bevel
  });
  return pts;
}

export function openRibbonOutline(enriched, depthA, depthB) {
  if (!(depthB > depthA)) return [];
  const a = ribbonEdge(enriched, depthA), b = ribbonEdge(enriched, depthB);
  if (a.length < 2 || b.length < 2) return [];
  return [...a, ...b.reverse()];
}
