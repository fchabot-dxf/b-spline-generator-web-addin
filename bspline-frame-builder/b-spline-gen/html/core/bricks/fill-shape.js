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
import { coursedAshlarLayout } from './layouts/coursed-ashlar.js';
import { stackedHorizontalLayout, chevronLayout, stackedVariationLayout, basketweaveVariationLayout, basketweaveStackedLayout } from './layouts/sheet-patterns.js';
import { squareGridLayout, octagonDotLayout, hexagonLayout, lozengeLayout, framedSquareLayout } from './layouts/tiles.js';
import { assignPieces } from './pieces.js';
import { computeSuppressedCells } from './suppression.js';
import { assignSamples } from './samples.js';
import { pointInPolygon, polygonIntersection, polygonDifference, polygonCentroid, signedArea, offsetPathInward, inwardSignFor, clipToHalfPlane } from './geometry.js';
import { PIECE_CATALOGUE, enabledPieces, scaledSet, BRICK_PATTERNS, RUSTIC } from './library.js';
import { WALL_REGION_PICK } from './region.js';
import { minPieceAreaOf } from './piece-floor.js';
import { hashedRandom } from './rng.js';

// F35 item 7: herringbone/basketweave are 'tile2d' BRICK_PATTERNS (library.js) promoted to full
// `set.layout` choices, same tier as 'bond'/'fieldstone' -- not zone-mixable with course-kind
// patterns this round (an honest, named scope line; see library.js's own BRICK_PATTERNS header).
const LAYOUTS = Object.freeze({
  bond: bondLayout, fieldstone: fieldstoneLayout, herringbone: herringboneLayout, basketweave: basketweaveLayout,
  coursed_rubble: coursedRubbleLayout, // T86 item 25
  coursed_ashlar: coursedAshlarLayout, // Rough ashlar (Fred picked mock E, 2026-10-10)
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
 * @param {{outer:{x:number,y:number}[], holes?:{x:number,y:number}[][]}[]} [opts.region] -- T86 item 18: the wall lays only
 *   inside these (clipCellsToRegion); absent = the whole outline
 * @param {{unit:number, tile:{rows:number, cols:number, cells:boolean[][]}}} [opts.accentCuts] -- T86 item 26: bond
 *   layouts split bricks on the accent tile's sub-brick grid and mark each piece (layouts/bond.js applyAccentCuts)
 * @param {{courses:{pieces:number[], offset:number}[]}} [opts.customBond] -- T86 item 27: a bond layout lays this tile's
 *   courses instead of its pattern's (layouts/bond.js customRow)
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
 * the layout's own floor (piece-floor.js minPieceAreaOf) drop; a cell with an exclusion wholly inside it is split round it
 * by a joint-wide seam (splitRound). Neighbour links to a cut cell are cleared so no piece chain reaches a cell that is gone.
 */
const bboxOf = (poly) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1 };
};
const boxesOverlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Shared by the exclusion cut (item 13) and the region clip (item 18): `cut(polygon)` returns null (the cell stays
 *  as laid) or the pieces left of it ([] = gone). A cut cell becomes one cell per piece (fresh ids, no neighbours:
 *  pieces.js then treats each as a lone 'single'); a piece under the layout's own floor (piece-floor.js) drops;
 *  neighbour links to a cut cell are cleared so no piece chain reaches a cell that is gone. */
function recutCells(cells, set, cut) {
  const minArea = minPieceAreaOf(set); // the layout's own floor (piece-floor.js: a fieldstone wall's is its smallest stone's)
  let nextId = cells.reduce((m, c) => Math.max(m, typeof c.id === 'number' ? c.id : 0), 0) + 1;
  const out = [];
  const gone = new Set();
  for (const cell of cells) {
    const pieces = cut(cell.polygon);
    if (!pieces) { out.push(cell); continue; }
    gone.add(cell);
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

/** T86 item 18c (advisor ruling, option C): an exclusion marked `drop: true` never CUTS a wall brick -- a brick it
 *  touches (its footprint grown by the grout, overlap above this area) is DROPPED whole, and the gap stays grout. The
 *  app passes a newer wall area's laid bricks this way to the older area's lay, so two areas with different patterns
 *  never overlap and no brick is cut (Fred: newest wins, complete bricks). Brush strokes keep cutting (item 13). */
const DROP_TOUCH_SQIN = 1e-6;

/** The exclusions as holes, each grown by the set's joint (so a brick keeps one joint off it). */
function exclusionHoles(exclusions, set) {
  const J = set.grout.widthIn;
  return exclusions.filter((e) => e && e.polygon && e.polygon.length >= 3).map((e) => {
    const grown = offsetPathInward(e.polygon, J, -inwardSignFor(e.polygon));
    return { polygon: grown, box: bboxOf(grown), drop: e.drop === true };
  });
}
/** The 18c test: does this brick touch one of the drop holes (overlap above DROP_TOUCH_SQIN)? */
const touchesDrop = (polygon, box, drops) =>
  drops.some((h) => boxesOverlap(box, h.box) && Math.abs(signedArea(polygonIntersection(polygon, h.polygon))) > DROP_TOUCH_SQIN);

/** A hole wholly inside a piece (a simple polygon cannot hold it): the piece is split by a joint-wide seam along the
 *  hole's long axis, then each half is cut round the hole -- the piece wraps the hole and the seam reads as a joint.
 *  MEASURED (seat E, 2026-10-08): the rule had been "drop the piece, the stroke covers it", true for a bond brick but not
 *  for a fieldstone stone, which wholly holds a stroke brick -- the whole stone went (a stone-sized hole by the stroke). */
function splitRound(piece, hole, joint) {
  let best = null;
  hole.forEach((a, i) => { const b = hole[(i + 1) % hole.length], l = Math.hypot(b.x - a.x, b.y - a.y); if (!best || l > best.l) best = { l, d: { x: (b.x - a.x) / l, y: (b.y - a.y) / l } }; });
  const c = polygonCentroid(hole), n = { x: -best.d.y, y: best.d.x }, half = joint / 2;
  const sideOf = (sgn) => clipToHalfPlane(piece, { point: { x: c.x + n.x * half * sgn, y: c.y + n.y * half * sgn }, dirX: best.d.x, dirY: best.d.y }, { x: c.x + n.x * sgn, y: c.y + n.y * sgn });
  return [sideOf(1), sideOf(-1)].filter((q) => q.length >= 3).flatMap((q) => { const left = polygonDifference(q, hole); return left.holeIgnored ? [] : left; });
}
/** The cut holes taken out of one polygon: its pieces, or [polygon] untouched. */
function cutPieces(polygon, box, cuts, joint) {
  let pieces = [polygon];
  for (const h of cuts) {
    if (!boxesOverlap(box, h.box)) continue;
    const next = [];
    for (const piece of pieces) {
      const cut = polygonDifference(piece, h.polygon);
      next.push(...(cut.holeIgnored ? splitRound(piece, h.polygon, joint) : cut));
    }
    pieces = next;
  }
  return pieces;
}

function cutExclusions(cells, exclusions, set) {
  const holes = exclusionHoles(exclusions, set);
  const drops = holes.filter((h) => h.drop), cuts = holes.filter((h) => !h.drop);
  return recutCells(cells, set, (polygon) => {
    const box = bboxOf(polygon);
    if (touchesDrop(polygon, box, drops)) return [];
    const pieces = cutPieces(polygon, box, cuts, set.grout.widthIn);
    return pieces.length === 1 && pieces[0] === polygon ? null : pieces;
  });
}

/** F35 item 60 (seat A's e2e: a raised brush stroke over the frame's stones, the raise added onto the stone): the wall's
 *  exclusion rules for bricks laid OUTSIDE the wall fill (a Brush / Raised stroke) -- the same tests cutExclusions
 *  applies. An exclusion (grown by the joint) marked `drop: true` drops a brick touching it whole (18c); any other one
 *  CUTS it, each piece keeping the brick's other fields (a Continuous run is one long piece, not a brick). */
export function bricksClearOf(bricks, exclusions, set) {
  const holes = exclusionHoles(exclusions, set);
  if (!holes.length) return bricks;
  const drops = holes.filter((h) => h.drop), cuts = holes.filter((h) => !h.drop);
  return bricks.flatMap((b) => {
    const box = bboxOf(b.polygon);
    if (touchesDrop(b.polygon, box, drops)) return [];
    const pieces = cutPieces(b.polygon, box, cuts, set.grout.widthIn);
    return pieces.length === 1 && pieces[0] === b.polygon ? [b] : pieces.map((polygon, k) => ({ ...b, id: `${b.id}~${k}`, polygon }));
  });
}

/**
 * T86 item 18 (Fred: "once any area is painted, ONLY the painted areas get bricks"): the wall laid as usual, then
 * every cell clipped to the region (region.js strokesToRegion: [{ outer, holes }]) -- the bond stays aligned to the
 * board across areas. A cell inside one outer and clear of its holes stays exactly as laid; one across an outer's
 * edge keeps its part inside (geometry polygonIntersection -- the largest part, should a cell straddle a narrow
 * notch); a hole is cut out (polygonDifference; a hole wholly inside one brick drops that brick); a cell outside
 * every outer goes.
 */
/** T86 item 18b (WALL_REGION_PICK 'centroid'): the cells whose centroid lies in the region (inside an outer, outside
 *  its holes), each kept whole -- nothing is cut at the region's edge. */
function pickCellsInRegion(cells, region) {
  const parts = region.filter((r) => r && r.outer && r.outer.length >= 3);
  const kept = new Set(cells.filter((cell) => {
    const c = polygonCentroid(cell.polygon);
    return parts.some((r) => pointInPolygon(c.x, c.y, r.outer) && !(r.holes || []).some((h) => h.length >= 3 && pointInPolygon(c.x, c.y, h)));
  }));
  // neighbour links to a dropped cell are cleared (as recutCells does), so no piece chain reaches a cell that is gone
  for (const cell of kept) {
    if (!cell.neighbors) continue;
    for (const k of Object.keys(cell.neighbors)) if (cell.neighbors[k] && !kept.has(cell.neighbors[k])) cell.neighbors[k] = null;
  }
  return cells.filter((c) => kept.has(c));
}

function clipCellsToRegion(cells, region, set) {
  const parts = region.filter((r) => r && r.outer && r.outer.length >= 3)
    .map((r) => ({ outer: r.outer, box: bboxOf(r.outer), holes: (r.holes || []).filter((h) => h.length >= 3).map((h) => ({ polygon: h, box: bboxOf(h) })) }));
  return recutCells(cells, set, (polygon) => {
    const box = bboxOf(polygon), area = Math.abs(signedArea(polygon));
    const pieces = [];
    for (const r of parts) {
      if (!boxesOverlap(box, r.box)) continue;
      const inter = polygonIntersection(polygon, r.outer);
      if (inter.length < 3) continue;
      let kept = [Math.abs(area - Math.abs(signedArea(inter))) < 1e-9 ? polygon : inter];
      for (const h of r.holes) {
        if (!boxesOverlap(box, h.box)) continue;
        const next = [];
        for (const piece of kept) {
          const cut = polygonDifference(piece, h.polygon);
          if (!cut.holeIgnored) next.push(...cut);
        }
        kept = next;
      }
      pieces.push(...kept);
    }
    return pieces.length === 1 && pieces[0] === polygon ? null : pieces;
  });
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
    ...(opts.region ? { region: opts.region.map((r) => ({ outer: r.outer.map(into), holes: (r.holes || []).map((h) => h.map(into)) })) } : {}),
  });
  return { ...res, bricks: res.bricks.map((b) => ({ ...b, polygon: b.polygon.map(back) })) };
}

export function bricksFillShape(polygon, holes, opts) {
  // no region, no wall (seat E, 2026-10-08, MEASURED: T9 7x9 1.5 in -- the band covers the board, generateBricks hands an
  // EMPTY interiorOutline -- and the octagon-dot tiles read its bounding box as +-Infinity: an endless grid loop, the app
  // frozen; the bond laid 0 pieces from it by luck). Every layout reads a polygon of at least 3 points.
  if (!polygon || polygon.length < 3) return { bricks: [] };
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
  const { cells: allCells } = layoutFn(polygon, layoutSet, opts.zones, seed, opts.largeStones, opts.fences, { rustic: opts.rustic, accentCuts: opts.accentCuts, customBond: opts.customBond });
  let cells = (holes && holes.length)
    ? allCells.filter((c) => !holes.some((h) => pointInPolygon(c.cx, c.cy, h)))
    : allCells;
  if (opts.region) cells = WALL_REGION_PICK === 'clip' ? clipCellsToRegion(cells, opts.region, set) : pickCellsInRegion(cells, opts.region);
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
      heightOffset: (sample ? sample.heightOffset : 0)
        + (opts.rustic > 0 ? RUSTIC.levelIn * opts.rustic * (2 * hashedRandom(seed, 'rustic-level', cell.id) - 1) : 0), // T86 item 22
      ...(cell.accentMarked !== undefined ? { accentMarked: cell.accentMarked } : {}), // T86 item 26
    });
  }
  return { bricks };
}
