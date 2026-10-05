/**
 * core/bricks/layouts/tiles.js — PORTABLE (see rng.js). F35 item 14: the TILE / PAVER patterns DRAWN on Fred's sheet 3
 * (shots/fred/ref_paver_tile_sheet.jpg), each CLOSED-FORM (no packing), the basketweave.js contract: board inches,
 * every joint the set's grout g, clipped to the real outline at the end. The UNIT size U = the set's brick length
 * (the brick size slider scales it); each unit is one cell, so it gets its own sample, centre-cropped, never stretched.
 *
 *   square grid            U x U squares on a U + g grid.
 *   octagon + dot          octagons (a U x U square, corners cut) with a small square "dot" where four meet. The
 *                          dot's diagonal / U is DATA (`ratio`, TILE_PARAMS); `rotationDeg` turns the whole lattice:
 *                          0 = flats horizontal, dots as diamonds (the sheet's "square with small diamond inserts");
 *                          45 = the sheet's "octagon + small square" (octagons on a diagonal lattice, dots square).
 *   hexagon                regular pointy-top hexagons, U across the flats, g between neighbours.
 *   lozenge                tall diamonds, U wide x TILE_PARAMS.lozenge.aspect U high, offset rows, g between edges.
 *   framed square          a U x U square, a W-wide bar on its right and below, a W x W square where the bars cross.
 *
 * `set.layoutParams` = the pattern's resolved params (main side: the declared defaults + the user's pick).
 */
import { clipPolygonToBoard, rectPolygon } from '../geometry.js';

/** The tile patterns' declared parameters: the options the sheet shows, one default each. */
export const TILE_PARAMS = Object.freeze({
  // the dot's diagonal / U, read off the sheet's three drawings of each (small, medium, large dot)
  octagonDot: Object.freeze({ ratio: Object.freeze({ label: 'Dot size', options: Object.freeze([0.15, 0.3, 0.58]), default: 0.3 }) }),
  squareDiamond: Object.freeze({ ratio: Object.freeze({ label: 'Diamond size', options: Object.freeze([0.15, 0.3, 0.58]), default: 0.15 }) }),
  lozenge: Object.freeze({ aspect: 1.6 }), // height / width of the sheet's lozenge
});

const bbox = (outline) => {
  const xs = outline.map((p) => p.x), ys = outline.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};
function pushCell(cells, outline, poly, courseIndex) {
  const c = poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }), { x: 0, y: 0 });
  const clipped = clipPolygonToBoard(poly, outline, c);
  if (clipped.length < 3) return;
  cells.push({ id: cells.length, polygon: clipped, courseIndex, cx: c.x, cy: c.y, neighbors: {} });
}
const rect = (x0, y0, w, h) => rectPolygon(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 1, 0);

export function squareGridLayout(outline, set) {
  const U = set.brickLengthIn, g = set.grout.widthIn;
  const { minX, maxX, minY, maxY } = bbox(outline);
  const cells = [];
  for (let j = 0, y = minY; y < maxY; j++, y += U + g) for (let x = minX; x < maxX; x += U + g) pushCell(cells, outline, rect(x, y, U, U), j);
  return { cells };
}

/** Octagons + dots; `ratio` = the dot's diagonal / U, `rotationDeg` turns the lattice about the board's centre. */
export function octagonDotLayout(outline, set) {
  const U = set.brickLengthIn, g = set.grout.widthIn;
  const lp = set.layoutParams || {};
  const ratio = Number.isFinite(lp.ratio) ? lp.ratio : TILE_PARAMS.octagonDot.ratio.default;
  const h = (ratio * U) / 2; // the dot's half-diagonal
  const c = Math.min(U / 2, h + g * (Math.SQRT2 - 1)); // the octagon's corner cut: its diagonal edge sits g off the dot's
  const a = ((lp.rotationDeg || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const { minX, maxX, minY, maxY } = bbox(outline);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const rot = (p) => ({ x: cx + (p.x - cx) * ca - (p.y - cy) * sa, y: cy + (p.x - cx) * sa + (p.y - cy) * ca });
  const P = U + g, R = Math.hypot(maxX - minX, maxY - minY) / 2 + P; // covers the board at any turn
  const n = Math.ceil(R / P) + 1;
  const cells = [];
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const x0 = cx + i * P - U / 2, y0 = cy + j * P - U / 2;
      pushCell(cells, outline, [
        { x: x0 + c, y: y0 }, { x: x0 + U - c, y: y0 }, { x: x0 + U, y: y0 + c }, { x: x0 + U, y: y0 + U - c },
        { x: x0 + U - c, y: y0 + U }, { x: x0 + c, y: y0 + U }, { x: x0, y: y0 + U - c }, { x: x0, y: y0 + c },
      ].map(rot), j);
      if (h > 0) { // the dot where four octagons meet
        const kx = x0 + U + g / 2, ky = y0 + U + g / 2;
        pushCell(cells, outline, [{ x: kx, y: ky - h }, { x: kx + h, y: ky }, { x: kx, y: ky + h }, { x: kx - h, y: ky }].map(rot), j);
      }
    }
  }
  return { cells };
}

export function hexagonLayout(outline, set) {
  const U = set.brickLengthIn, g = set.grout.widthIn;
  const r = U / Math.sqrt(3); // circumradius of a pointy-top hexagon U across the flats
  const dx = U + g, dy = (U + g) * (Math.sqrt(3) / 2);
  const { minX, maxX, minY, maxY } = bbox(outline);
  const cells = [];
  for (let j = 0, y = minY; y < maxY + r; j++, y += dy) {
    for (let x = minX + (j % 2) * dx / 2; x < maxX + dx; x += dx) {
      const poly = [];
      for (let k = 0; k < 6; k++) { const t = Math.PI / 2 + (k * Math.PI) / 3; poly.push({ x: x + r * Math.cos(t), y: y + r * Math.sin(t) }); }
      pushCell(cells, outline, poly, j);
    }
  }
  return { cells };
}

export function lozengeLayout(outline, set) {
  const U = set.brickLengthIn, g = set.grout.widthIn;
  const A = TILE_PARAMS.lozenge.aspect;
  const w = U, hgt = A * U; // the tiling diamond (joint included) ...
  const d = (w / 2 * hgt / 2) / Math.hypot(w / 2, hgt / 2); // ... its centre-to-edge distance
  const s = Math.max(0, (d - g / 2) / d); // shrunk so the gap across every edge is g
  const { minX, maxX, minY, maxY } = bbox(outline);
  const cells = [];
  for (let j = 0, y = minY - hgt / 2; y < maxY + hgt / 2; j++, y += hgt / 2) {
    for (let x = minX + (j % 2) * w / 2; x < maxX + w; x += w) {
      pushCell(cells, outline, [
        { x, y: y - s * hgt / 2 }, { x: x + s * w / 2, y }, { x, y: y + s * hgt / 2 }, { x: x - s * w / 2, y },
      ], j);
    }
  }
  return { cells };
}

export function framedSquareLayout(outline, set) {
  const U = set.brickLengthIn, W = set.brickHeightIn, g = set.grout.widthIn;
  const P = U + g + W + g;
  const { minX, maxX, minY, maxY } = bbox(outline);
  const cells = [];
  for (let j = 0, y = minY; y < maxY; j++, y += P) {
    for (let x = minX; x < maxX; x += P) {
      pushCell(cells, outline, rect(x, y, U, U), j); // the square
      pushCell(cells, outline, rect(x + U + g, y, W, U), j); // its bar on the right
      pushCell(cells, outline, rect(x, y + U + g, U, W), j); // its bar below
      pushCell(cells, outline, rect(x + U + g, y + U + g, W, W), j); // where the bars cross
    }
  }
  return { cells };
}
