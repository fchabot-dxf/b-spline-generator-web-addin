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
import { assignPieces } from './pieces.js';
import { computeSuppressedCells } from './suppression.js';
import { assignSamples } from './samples.js';
import { pointInPolygon } from './geometry.js';
import { PIECE_CATALOGUE, enabledPieces, scaledSet } from './library.js';

// F35 item 7: herringbone/basketweave are 'tile2d' BRICK_PATTERNS (library.js) promoted to full
// `set.layout` choices, same tier as 'bond'/'fieldstone' -- not zone-mixable with course-kind
// patterns this round (an honest, named scope line; see library.js's own BRICK_PATTERNS header).
const LAYOUTS = Object.freeze({
  bond: bondLayout, fieldstone: fieldstoneLayout, herringbone: herringboneLayout, basketweave: basketweaveLayout,
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
 * @param {{x:number,y:number}[][]} [opts.fences] -- fieldstone only: closed lines that bound the stones exactly
 *   (fieldstone.js fencePoints); a band ring passes its outer and inner edges
 * @returns {{ bricks: Array }}
 */
export function bricksFillShape(polygon, holes, opts) {
  const { seed } = opts;
  const set = scaledSet(opts.set, opts.scale);
  const suppression = opts.suppression ?? 0;
  const topBias = opts.topBias ?? 0.8;
  const clumping = opts.clumping ?? 0.3;

  const layoutFn = LAYOUTS[set.layout];
  if (!layoutFn) return { bricks: [] };
  const { cells: allCells } = layoutFn(polygon, set, opts.zones, seed, opts.largeStones, opts.fences);
  const cells = (holes && holes.length)
    ? allCells.filter((c) => !holes.some((h) => pointInPolygon(c.cx, c.cy, h)))
    : allCells;

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
