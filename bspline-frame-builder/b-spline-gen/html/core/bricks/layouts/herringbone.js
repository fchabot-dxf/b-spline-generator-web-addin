/**
 * core/bricks/layouts/herringbone.js — PORTABLE (see rng.js). F35 item 7, REBUILT a second time per
 * advisor correction: the textbook 90-degree chevron DOES tile exactly for ANY brickLengthIn:
 * brickHeightIn ratio, not only 2:1 — this file's own prior header claimed otherwise, from a
 * narrower single-brick-per-step search; that claim was WRONG and is retracted here. The advisor's
 * own exact construction, independently verified (zero overlap; coverage == the exact
 * (L/(L+g)) * (W/(W+g)) grout ceiling, at Set 1's real 3.75:1 — the same ceiling every correctly-
 * grouted rectangular pattern is bounded by, so this construction wastes NO area beyond the grout
 * itself):
 *
 *   w = brickHeightIn + grout, l = brickLengthIn + grout
 *   H_i = horizontal brick (L x W), bottom-left corner at (i*w, i*w)
 *   V_i = vertical brick (W x L), bottom-left corner at ((i-1)*w, i*w)
 *   the whole {H_i, V_i} staircase repeats by k*(-l, l) for every integer k — a single staircase is
 *   only one diagonal thread; the k-replication is what actually fills the plane.
 *   the whole pattern is then rotated 45 degrees for the classic chevron look (the bricks themselves
 *   run diagonally, the look the dispatch asked for) — verified at 0 degrees too (the "straight"/
 *   90-degree herringbone, bricks axis-aligned), but only 45 is wired up since nothing asked for the
 *   other variant.
 *
 * No extra grout "shrink" is applied on top of this — measured directly against specific neighbor
 * pairs, the construction above already leaves exactly `grout` between every adjacent brick; an
 * extra shrink would double the joint.
 */
import { clipPolygonToBoard, rectPolygon } from '../geometry.js';

const ROTATION_DEG = 45; // the "classic" chevron look; see this file's own header

/**
 * @param {{x:number,y:number}[]} boardOutline — closed polygon, board inches
 * @param {{brickLengthIn:number, brickHeightIn:number, grout:{widthIn:number}}} set
 * @param {Array} [_zones] — unused (same call-signature-parity precedent as fieldstone.js)
 * @returns {{cells: Array}}
 */
export function herringboneLayout(boardOutline, set, _zones) {
  const L = set.brickLengthIn, W = set.brickHeightIn, g = set.grout.widthIn;
  const w = W + g, l = L + g;
  const theta = (ROTATION_DEG * Math.PI) / 180;
  const ct = Math.cos(theta), st = Math.sin(theta);

  const xs = boardOutline.map((p) => p.x), ys = boardOutline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const margin = 2 * L;
  const corners = [
    [minX - margin, minY - margin], [maxX + margin, minY - margin],
    [minX - margin, maxY + margin], [maxX + margin, maxY + margin],
  ];
  // Inverse-rotate the (expanded) board bbox into pattern space to find which i/k range actually
  // reaches it: u = x+y advances by 2w per i, z = y-x advances by 2l per k (see header formula).
  let uMin = Infinity, uMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const [wx, wy] of corners) {
    const lx = ct * wx + st * wy, ly = -st * wx + ct * wy;
    const u = lx + ly, z = ly - lx;
    if (u < uMin) uMin = u; if (u > uMax) uMax = u;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }
  const iLo = Math.floor(uMin / (2 * w)) - 2, iHi = Math.ceil(uMax / (2 * w)) + 2;
  const kLo = Math.floor(zMin / (2 * l)) - 2, kHi = Math.ceil(zMax / (2 * l)) + 2;

  const cells = [];
  let nextId = 0;
  for (let k = kLo; k <= kHi; k++) {
    const originX = k * -l, originY = k * l;
    for (let i = iLo; i <= iHi; i++) {
      const hcx = originX + i * w + L / 2, hcy = originY + i * w + W / 2;
      const vcx = originX + (i - 1) * w + W / 2, vcy = originY + i * w + L / 2;
      for (const [cx, cy, dx, dy] of [[hcx, hcy, 1, 0], [vcx, vcy, 0, 1]]) {
        const wcx = ct * cx - st * cy, wcy = st * cx + ct * cy;
        const wdx = ct * dx - st * dy, wdy = st * dx + ct * dy;
        const poly = rectPolygon(wcx, wcy, L / 2, W / 2, wdx, wdy);
        const clipped = clipPolygonToBoard(poly, boardOutline, { x: wcx, y: wcy });
        if (clipped.length >= 3) cells.push({ id: nextId++, polygon: clipped, courseIndex: k, cx: wcx, cy: wcy, neighbors: {} });
      }
    }
  }
  return { cells };
}
