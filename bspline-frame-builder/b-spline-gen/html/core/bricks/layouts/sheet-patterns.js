/**
 * core/bricks/layouts/sheet-patterns.js — PORTABLE (see rng.js). F35 item 13: the new Wall patterns DRAWN on Fred's
 * sheet (shots/fred/ref_brick_pattern_sheet.jpg), named as the sheet names them, each CLOSED-FORM (no packing), the
 * same contract as basketweave.js: board inches, every brick the set's own L x W (never stretched), every joint the
 * set's grout g, clipped to the real outline at the end; `courseIndex` = the piece's row (the accent rules read it).
 *
 * The sheet draws bricks at L = 2W; a UNIT here is the basketweave's L x L square holding n = round(L / (W + g))
 * bricks of one orientation (n = 2 on the sheet, 3 for Set 1), exactly as basketweave.js packs it.
 *
 *   stacked horizontal    a soldier course (bricks standing side by side, L high), then a stretcher course; repeat.
 *   chevron               columns L/sqrt2 wide of parallelograms with +-45 deg long edges (L along the slope, W
 *                         across it); neighbouring columns mirrored, so the rows read as V's.
 *   stacked variation     a row of units alternating standing / lying, then ONE stretcher course; the next unit row
 *                         starts on the other orientation.
 *   basketweave variation along a row: a lying unit (L x L), then ONE standing brick (W x L); period L + W; each row
 *                         shifted by W against the last.
 *   basketweave + stacked a column of stacked stretchers (L wide), then a pinwheel column (4 bricks round a centre
 *                         square of L - W, period L + W); repeat.
 */
import { clipPolygonToBoard, rectPolygon } from '../geometry.js';

const bbox = (outline) => {
  const xs = outline.map((p) => p.x), ys = outline.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};
/** Clip `poly` to the board and add it as a cell (skipped when nothing is left). */
function pushCell(cells, outline, poly, courseIndex) {
  const c = poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }), { x: 0, y: 0 });
  const clipped = clipPolygonToBoard(poly, outline, c);
  if (clipped.length < 3) return;
  cells.push({ id: cells.length, polygon: clipped, courseIndex, cx: c.x, cy: c.y, neighbors: {} });
}
const rect = (x0, y0, w, h) => rectPolygon(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 1, 0);
/** The basketweave unit's packing: n bricks across an L x L square, each `cross` wide, `pitch` apart. */
const unitOf = (L, W, g) => {
  const n = Math.max(1, Math.round(L / (W + g)));
  return { n, pitch: L / n, cross: Math.max(0, L / n - g) };
};
/** One L x L unit at (x0, y0): n bricks lying (stacked in y) or standing (side by side in x). */
function pushUnit(cells, outline, x0, y0, L, u, lying, course) {
  for (let k = 0; k < u.n; k++) {
    pushCell(cells, outline, lying ? rect(x0, y0 + k * u.pitch, L, u.cross) : rect(x0 + k * u.pitch, y0, u.cross, L), course);
  }
}

export function stackedHorizontalLayout(outline, set) {
  const L = set.brickLengthIn, W = set.brickHeightIn, g = set.grout.widthIn;
  const { minX, maxX, minY, maxY } = bbox(outline);
  const cells = [];
  for (let y = minY, course = 0; y < maxY; course++) {
    const soldiers = course % 2 === 0;
    const w = soldiers ? W : L, h = soldiers ? L : W;
    for (let x = minX; x < maxX; x += w + g) pushCell(cells, outline, rect(x, y, w, h), course);
    y += h + g;
  }
  return { cells };
}

export function chevronLayout(outline, set) {
  const L = set.brickLengthIn, W = set.brickHeightIn, g = set.grout.widthIn;
  const { minX, maxX, minY, maxY } = bbox(outline);
  const cw = L / Math.SQRT2; // a column's width: the brick's L along the 45 deg slope
  const t = W * Math.SQRT2; // a piece's vertical thickness (W across the slope)
  const pitch = (W + g) * Math.SQRT2; // one row to the next, vertically
  const cells = [];
  for (let col = 0, x0 = minX; x0 < maxX; col++, x0 += cw + g) {
    const up = col % 2 === 0; // +45 then -45: neighbouring columns mirrored -> V's
    const rise = up ? -cw : cw; // y grows downward on the board: "up" rises to the right
    const yStart = minY - cw - pitch + (up ? cw : 0); // mirrored columns meet the previous one's edge
    for (let k = 0, y = yStart; y < maxY + cw; k++, y += pitch) {
      pushCell(cells, outline, [
        { x: x0, y }, { x: x0 + cw, y: y + rise }, { x: x0 + cw, y: y + rise + t }, { x: x0, y: y + t },
      ], k);
    }
  }
  return { cells };
}

export function stackedVariationLayout(outline, set) {
  const L = set.brickLengthIn, W = set.brickHeightIn, g = set.grout.widthIn;
  const u = unitOf(L, W, g);
  const { minX, maxX, minY, maxY } = bbox(outline);
  const cells = [];
  let course = 0;
  for (let y = minY, unitRow = 0; y < maxY; unitRow++) {
    for (let i = 0, x = minX; x < maxX; i++, x += L) pushUnit(cells, outline, x, y, L, u, (i + unitRow) % 2 === 1, course);
    y += L;
    course++;
    for (let x = minX; x < maxX; x += L + g) pushCell(cells, outline, rect(x, y + g, L, W), course); // the stretcher course
    y += W + 2 * g;
    course++;
  }
  return { cells };
}

export function basketweaveVariationLayout(outline, set) {
  const L = set.brickLengthIn, W = set.brickHeightIn, g = set.grout.widthIn;
  const u = unitOf(L, W, g);
  const P = L + g + W + g; // a lying unit + one standing brick
  const { minX, maxX, minY, maxY } = bbox(outline);
  const cells = [];
  for (let row = 0, y = minY; y < maxY; row++, y += L + g) {
    const shift = (row % 2) * (W + g); // each row shifted by W against the last
    for (let x = minX - P + shift; x < maxX; x += P) {
      pushUnit(cells, outline, x, y, L, u, true, row);
      pushCell(cells, outline, rect(x + L + g, y, W, L), row);
    }
  }
  return { cells };
}

export function basketweaveStackedLayout(outline, set) {
  const L = set.brickLengthIn, W = set.brickHeightIn, g = set.grout.widthIn;
  const Pw = L + g + W; // the pinwheel's period
  const c = Math.max(0, L - W - g); // its centre square's side
  const { minX, maxX, minY, maxY } = bbox(outline);
  const cells = [];
  for (let x = minX; x < maxX;) {
    // a column of stacked stretchers
    for (let row = 0, y = minY; y < maxY; row++, y += W + g) pushCell(cells, outline, rect(x, y, L, W), row);
    x += L + g;
    // a pinwheel column
    for (let j = 0, y0 = minY; y0 < maxY; j++, y0 += Pw + g) {
      pushCell(cells, outline, rect(x, y0, L, W), j); // top, lying
      pushCell(cells, outline, rect(x + L + g, y0, W, L), j); // right, standing
      pushCell(cells, outline, rect(x + W + g, y0 + L + g, L, W), j); // bottom, lying
      pushCell(cells, outline, rect(x, y0 + W + g, W, L), j); // left, standing
      if (c > 0) pushCell(cells, outline, rect(x + W + g, y0 + W + g, c, c), j); // the centre square
    }
    x += Pw + g;
  }
  return { cells };
}
