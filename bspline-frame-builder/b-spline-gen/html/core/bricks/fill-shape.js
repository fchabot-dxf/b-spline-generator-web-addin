/**
 * core/bricks/fill-shape.js — PORTABLE (see rng.js). Core primitive #2 of 2:
 *
 *   bricksFillShape(polygon, holes, opts) -> { bricks: [{id, polygon, pieceId, sampleId, flip,
 *                                                         heightOffset}] }
 *
 * A bond-wall fill clipped to `polygon` (optionally minus `holes`) -- the board itself, a filled
 * rectangle/shape editor element, anything that wants a solid brick fill rather than a line of
 * bricks along its own outline (that's bricksAlongPath). P1: layout 'bond' only (library.js's own
 * layout table on `opts.set.layout` -- a future P2 'grid' set just needs its own layout function
 * added there, nothing here changes).
 *
 * `opts.zones` (advisor, ref_brick_bond_zones.jpg: "patterns of different width") passes straight
 * through to the 'bond' layout's own zone resolution (layouts/bond.js) -- a list of horizontal
 * bands, each its own bond kind (running/stack/soldier) and size; omitted = a single running zone
 * covering the whole shape, i.e. the original pre-zones behaviour.
 */
import { bondLayout } from './layouts/bond.js';
import { fieldstoneLayout } from './layouts/fieldstone.js';
import { herringboneLayout } from './layouts/herringbone.js';
import { basketweaveLayout } from './layouts/basketweave.js';
import { coursedRubbleLayout } from './layouts/coursed-rubble.js';
import { stackedHorizontalLayout, chevronLayout, stackedVariationLayout, basketweaveVariationLayout, basketweaveStackedLayout } from './layouts/sheet-patterns.js';
import { squareGridLayout, octagonDotLayout, hexagonLayout, lozengeLayout, framedSquareLayout } from './layouts/tiles.js';
import { assignPieces } from './pieces.js';
import { computeSuppressedCells } from './suppression.js';
import { assignSamples } from './samples.js';
import { pointInPolygon, polygonDifference, polygonCentroid, signedArea, offsetPathInward, inwardSignFor } from './geometry.js';
import { PIECE_CATALOGUE, enabledPieces, scaledSet, MIN_PIECE_FRACTION, BRICK_PATTERNS } from './library.js';

// F35 item 7: herringbone/basketweave are 'tile2d' BRICK_PATTERNS (library.js) promoted to full
// `set.layout` choices, same tier as 'bond'/'fieldstone' -- not zone-mixable with course-kind
// patterns this round (an honest, named scope line; see library.js's own BRICK_PATTERNS header).
const LAYOUTS = Object.freeze({
  bond: bondLayout, fieldstone: fieldstoneLayout, herringbone: herringboneLayout, basketweave: basketweaveLayout,
  coursed_rubble: coursedRubbleLayout, // T86 item 25
  // F35 item 13: Fred's sheet (layouts/sheet-patterns.js)
  stacked_horizontal: stackedHorizontalLayout, chevron: chevronLayout, stacked_variation: stackedVariationLayout,
  basketweave_variation: basketweaveVariationLayout, basketweave_stacked: basketweaveStackedLayout,
  // F35 item 14: the tiles / pavers (Fred's sheet 3, layouts/tiles.js); two sheet drawings share octagonDotLayout
  square_grid: squareGridLayout, square_diamond: octagonDotLayout, octagon_square: octagonDotLayout,
  hexagon: hexagonLayout, lozenge: lozengeLayout, framed_square: framedSquareLayout,
});

/**
 * @param {{x:number,y:number}[]} polygon — closed outer polygon, board inches
 * @param {{x:number,y:number}[][]} [holes] — closed polygons to exclude (e.g. an inset window)
 * @param {object} opts
 * @param {object} opts.set — a library.BRICK_SETS entry
 * @param {number} [opts.suppression=0]
 * @param {number} [opts.topBias=0.8]
 * @param {number} [opts.clumping=0.3]
 * @param {{bond?:'running'|'stack'|'soldier', rows?:number, heightIn?:number}[]} [opts.zones]
 * @param {number} [opts.scale=1] — uniform multiplier on the set's own brick length/height (grout unaffected)
 * @param {number} opts.seed
 * @param {number} [opts.largeStones] — T86 item 17: fieldstoneLayout-only (ignored by every other
 *   layout here, same as `opts.zones` is bond-only); see its own header for the declared range.
 * @param {number} [opts.rotationDeg=0] -- T86 item 29: the pattern turned by this angle (rotatedFill)
 * @param {{polygon:{x:number,y:number}[]}[]} [opts.exclusions] -- T86 item 13: brush-stroke footprints the wall
 *   flows around (cutExclusions below)
 * @param {{x:number,y:number}[][]} [opts.fences] -- fieldstone only: closed lines that bound the stones exactly
 *   (fieldstone.js fencePoints); a band ring passes its outer and inner edges
 * @returns {{ bricks: Array }}
 */
/**
 * T86 item 13 (Fred: "brush over wall = the wall flows around"): every exclusion (a brush brick's polygon, sent by
 * editor-brick-tool.js's brushExclusions) grown by one grout width is a HOLE in the wall fill. Each cell is cut by
 * every exclusion it overlaps (geometry.js polygonDifference); a cut that leaves several pieces makes several
 * cells (fresh ids, no neighbours: pieces.js then treats each as a lone 'single'); pieces under
 * library.js MIN_PIECE_FRACTION of a brick (brickLengthIn x brickHeightIn) drop; a cell with an exclusion wholly inside it is covered by the
 * stroke and drops. Neighbour links to a cut cell are cleared so no piece chain reaches a cell that is gone.
 */
function cutExclusions(cells, exclusions, set) {
  const J = set.grout.widthIn;
  const minArea = MIN_PIECE_FRACTION * set.brickLengthIn * set.brickHeightIn;
  const bbox = (poly) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return { x0, y0, x1, y1 };
  };
  const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const holes = exclusions.filter((e) => e && e.polygon && e.polygon.length >= 3).map((e) => {
    const grown = offsetPathInward(e.polygon, J, -inwardSignFor(e.polygon));
    return { polygon: grown, box: bbox(grown) };
  });
  let nextId = cells.reduce((m, c) => Math.max(m, typeof c.id === 'number' ? c.id : 0), 0) + 1;
  const out = [];
  const gone = new Set();
  for (const cell of cells) {
    let pieces = [cell.polygon];
    let covered = false;
    const box = bbox(cell.polygon);
    for (const h of holes) {
      if (!overlaps(box, h.box)) continue;
      const next = [];
      for (const piece of pieces) {
        const cut = polygonDifference(piece, h.polygon);
        if (cut.holeIgnored) { covered = true; break; }
        next.push(...cut);
      }
      if (covered) break;
      pieces = next;
    }
    if (pieces.length === 1 && pieces[0] === cell.polygon) { out.push(cell); continue; }
    gone.add(cell);
    if (covered) continue;
    for (const polygon of pieces) {
      if (Math.abs(signedArea(polygon)) < minArea) continue;
      const c = polygonCentroid(polygon);
      out.push({ ...cell, id: nextId++, polygon, cx: c.x, cy: c.y, neighbors: {} });
    }
  }
  if (gone.size) for (const cell of out) {
    if (!cell.neighbors) continue;
    for (const k of Object.keys(cell.neighbors)) if (gone.has(cell.neighbors[k])) cell.neighbors[k] = null;
  }
  return out;
}

/**
 * T86 item 29 (advisor: not a pattern but an angle every wall pattern gets; "running bond at 45" = stretcher +
 * rotation 45): `opts.rotationDeg` turns the whole pattern about the outline's bounding-box centre. The outline (and
 * holes, exclusions, fences) is turned by -rotationDeg, laid exactly as at 0 (same seed, every layout's own exact
 * clip against the turned outline), and every brick is turned back by +rotationDeg. Absent or 0: the plain path.
 */
function rotatedFill(polygon, holes, opts) {
  const t = (opts.rotationDeg * Math.PI) / 180;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polygon) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const turn = (a) => { const c = Math.cos(a), s = Math.sin(a); return (p) => ({ x: cx + (p.x - cx) * c - (p.y - cy) * s, y: cy + (p.x - cx) * s + (p.y - cy) * c }); };
  const into = turn(-t), back = turn(t);
  const res = bricksFillShape(polygon.map(into), holes && holes.map((h) => h.map(into)), {
    ...opts, rotationDeg: 0,
    ...(opts.exclusions ? { exclusions: opts.exclusions.map((e) => ({ ...e, polygon: e.polygon.map(into) })) } : {}),
    ...(opts.fences ? { fences: opts.fences.map((f) => f.map(into)) } : {}),
  });
  return { ...res, bricks: res.bricks.map((b) => ({ ...b, polygon: b.polygon.map(back) })) };
}

export function bricksFillShape(polygon, holes, opts) {
  if (opts.rotationDeg) return rotatedFill(polygon, holes, opts);
  const { seed } = opts;
  const set = scaledSet(opts.set, opts.scale);
  const suppression = opts.suppression ?? 0;
  const topBias = opts.topBias ?? 0.8;
  const clumping = opts.clumping ?? 0.3;

  const layoutFn = LAYOUTS[set.layout];
  if (!layoutFn) return { bricks: [] };
  // F35 item 14: a pattern's declared layout params (BRICK_PATTERNS[id].params defaults, the caller's picks in
  // set.layoutParams, the entry's pinned `fixed` ones) -- resolved here, so every caller lays the same pattern
  const def = BRICK_PATTERNS[set.layout];
  const layoutSet = def && (def.params || def.fixed) ? { ...set, layoutParams: {
    ...Object.fromEntries(Object.entries(def.params || {}).filter(([, p]) => p && 'default' in p).map(([k, p]) => [k, p.default])),
    ...(set.layoutParams || {}), ...(def.fixed || {}) } } : set;
  const { cells: allCells } = layoutFn(polygon, layoutSet, opts.zones, seed, opts.largeStones, opts.fences);
  let cells = (holes && holes.length)
    ? allCells.filter((c) => !holes.some((h) => pointInPolygon(c.cx, c.cy, h)))
    : allCells;
  if (opts.exclusions && opts.exclusions.length) cells = cutExclusions(cells, opts.exclusions, set);

  const catalogue = enabledPieces(PIECE_CATALOGUE);
  const pieceOf = assignPieces(cells, catalogue, seed);
  const suppressed = computeSuppressedCells(pieceOf, cells, { suppression, topBias, clumping }, seed);
  const sampleInfo = assignSamples(cells, set, seed);

  const bricks = [];
  for (const cell of cells) {
    if (suppressed.has(cell.id)) continue;
    const info = pieceOf.get(cell.id);
    const sample = sampleInfo.get(cell.id);
    bricks.push({
      id: cell.id,
      polygon: cell.polygon,
      pieceId: info ? info.pieceId : 'single',
      sampleId: sample ? sample.sampleId : null,
      flip: sample ? sample.flip : false,
      heightOffset: sample ? sample.heightOffset : 0,
    });
  }
  return { bricks };
}
