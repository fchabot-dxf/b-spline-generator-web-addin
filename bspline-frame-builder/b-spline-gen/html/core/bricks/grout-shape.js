/**
 * core/bricks/grout-shape.js -- F35 item 55: the GROUT as a real shape, declared once. PORTABLE (no DOM), board inches.
 *
 *   groutShapeOf({ id, region, faces, insetIn }) -> { id, loops, d, fillRule: 'evenodd' }
 *
 * An element's grout = its REGION (where it lays: a wall's fill outline, a frame's band ring) minus its painted brick
 * FACES. A wall region minus its bricks is nothing but holes, which geometry.js polygonDifference cannot hold (a clip
 * wholly inside returns the subject whole, `holeIgnored`), so the shape is ONE path filled even-odd: the region's
 * outer + hole loops plus every face. Faces never overlap and lie inside the region (a face crossing the region edge is
 * first cut to it, polygonIntersection: the exclusions math), so even-odd is exactly region minus faces.
 *
 * A face is the brick polygon inset by `insetIn` (paint only: the visible joint = joint + 2 x inset); the brick's own
 * polygon -- the geometry the height mask, Send and CAM read -- is never touched. The editor (editor-brick-tool.js
 * drawElementGrout), the Brick tab's Select and the SVG download all read this one function.
 */
import { pointInPolygon, polygonIntersection, offsetPathInward, inwardSignFor, signedArea } from './geometry.js';

/** The grout node's id: `<element id>:grout`. */
export const GROUT_ID_SUFFIX = ':grout';
export const groutIdOf = (elementId) => `${elementId}${GROUT_ID_SUFFIX}`;

/** The painted face of a brick: its polygon inset by `insetIn` (>= 0). An inset that swallows the brick leaves no face:
 *  the whole brick reads as joint. Swallowed = an edge turned back on itself (an inset past the brick's middle reflects
 *  it through its centre, which keeps the area's sign: only the edge directions tell) or no area left. */
export function insetFace(polygon, insetIn) {
  const inset = Number(insetIn) || 0;
  if (!polygon || polygon.length < 3) return null;
  if (inset <= 0) return polygon.map((p) => ({ x: p.x, y: p.y }));
  const out = offsetPathInward(polygon, inset, inwardSignFor(polygon));
  const a0 = signedArea(polygon), a1 = signedArea(out);
  if (Math.sign(a1) !== Math.sign(a0) || Math.abs(a1) < 1e-6) return null;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dot = (out[j].x - out[i].x) * (polygon[j].x - polygon[i].x) + (out[j].y - out[i].y) * (polygon[j].y - polygon[i].y);
    if (dot < 0) return null;
  }
  return out;
}

/** Points along ribbon primitives ({type:'line', p0, p1} | {type:'arc', cx, cy, r, theta1, theta2}, the frame contour
 *  the bands follow) as one closed polyline; an arc is cut so its chord sags < ARC_SAG_IN. */
export const ARC_SAG_IN = 0.002;
export function primitivesOutline(primitives) {
  const pts = [];
  for (const prim of primitives || []) {
    if (prim.type === 'arc') {
      const sweep = prim.theta2 - prim.theta1;
      const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - ARC_SAG_IN / Math.max(prim.r, ARC_SAG_IN))));
      const n = Math.max(2, Math.ceil(Math.abs(sweep) / (step || 0.1)));
      for (let k = 0; k < n; k++) {
        const t = prim.theta1 + (sweep * k) / n;
        pts.push({ x: prim.cx + prim.r * Math.cos(t), y: prim.cy + prim.r * Math.sin(t) });
      }
    } else if (prim.p0) {
      pts.push({ x: prim.p0.x, y: prim.p0.y });
    }
  }
  return pts;
}

const _inRegion = (region, x, y) => region.some((r) => pointInPolygon(x, y, r.outer) && !(r.holes || []).some((h) => pointInPolygon(x, y, h)));

/** A face cut to the region: whole when every vertex is inside, else its intersection with each outer it meets. */
function _facesInRegion(face, region) {
  if (face.every((p) => _inRegion(region, p.x, p.y))) return [face];
  const out = [];
  for (const r of region) {
    const cut = polygonIntersection(face, r.outer);
    if (cut && cut.length >= 3) out.push(cut);
  }
  return out;
}

const _f = (v) => +v.toFixed(4);
const _loopD = (loop) => `M${loop.map((p) => `${_f(p.x)},${_f(p.y)}`).join('L')}Z`;

/**
 * @param {object} element
 * @param {string} element.id            -- the element's id (a record's, a wall area's)
 * @param {{outer:{x,y}[], holes?:{x,y}[][]}[]} element.region -- where the element lays
 * @param {{x,y}[][]} element.faces      -- its bricks' polygons, as laid
 * @param {number} [element.insetIn=0]   -- the paint inset (>= 0)
 * @param {{x,y}[][]} [element.cutouts] -- other elements' bricks lying in the region (Brush bricks over a wall): cut
 *   out as they are (no inset), never painted over
 * @returns {{ id: string, loops: {x,y}[][], d: string, fillRule: 'evenodd' } | null} null with no region
 */
export function groutShapeOf({ id, region, faces = [], cutouts = [], insetIn = 0 }) {
  const reg = (region || []).filter((r) => r && r.outer && r.outer.length >= 3);
  if (!reg.length) return null;
  const loops = [];
  for (const r of reg) {
    loops.push(r.outer);
    for (const h of r.holes || []) if (h && h.length >= 3) loops.push(h);
  }
  for (const poly of faces) {
    const face = insetFace(poly, insetIn);
    if (face) loops.push(..._facesInRegion(face, reg));
  }
  for (const poly of cutouts) if (poly && poly.length >= 3) loops.push(..._facesInRegion(poly, reg));
  return { id: groutIdOf(id), loops, d: loops.map(_loopD).join(''), fillRule: 'evenodd' };
}

/** Is (x, y) on the grout (inside an odd number of its loops)? The Brick tab's Select reads this. */
export function pointOnGrout(shape, x, y) {
  if (!shape || !shape.loops) return false;
  let n = 0;
  for (const loop of shape.loops) if (pointInPolygon(x, y, loop)) n++;
  return n % 2 === 1;
}
