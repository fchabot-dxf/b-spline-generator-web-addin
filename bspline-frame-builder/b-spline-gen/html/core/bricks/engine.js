/**
 * core/bricks/engine.js — PORTABLE (see rng.js). A convenience composer over the THREE core
 * primitives (along-path.js's bricksAlongPath = the Brush tool, fill-shape.js's bricksFillShape =
 * the Wall tool, contour-bands.js's bricksContourBands = the Frame tool) for the common
 * "whole board, optional contour frame" case -- the adapter can call the primitives directly per
 * editor-element type instead (see WORK-LOG's own element-type -> primitive table), this file
 * is just the one-call convenience this project's own preview script and tests use.
 *
 * Primary output is VECTOR SHAPES (Fred: "bricks are more like vectors"); the height-field
 * sampler below is a SECOND, DERIVED output built from that same brick list.
 */
import { bricksFillShape } from './fill-shape.js';
import { bricksContourBands } from './contour-bands.js';
import { pointInPolygon } from './geometry.js';
import { brickTopHeight } from './height-profile.js';

/**
 * @param {object} input
 * @param {{x:number,y:number}[]} input.boardOutline — closed polygon, board inches
 * @param {object} input.set — a library.BRICK_SETS entry
 * @param {object} [input.frame] — { primitives, bands, set } or omitted/null for no frame
 *   (H23 item 76: `primitives` is the frame contour's own RAW lines+arcs, passed through to
 *   bricksContourBands verbatim -- see that function's own header; `set`, F35 item 5 review: an
 *   OPTIONAL override used for the frame bands ONLY, defaulting to the top-level `input.set` when
 *   omitted -- Wall's own bricksFillShape call below always uses `input.set`, never this)
 * @param {number} [input.suppression=0]
 * @param {number} [input.topBias=0.8]
 * @param {number} [input.clumping=0.3]
 * @param {{bond?:'running'|'stack'|'soldier', rows?:number, heightIn?:number}[]} [input.zones]
 * @param {number} [input.scale=1] — uniform multiplier on the set's own brick length/height (grout unaffected)
 * @param {number} input.seed
 * @returns {{ bricks: Array, frameBricks: Array, seed: number }} `seed` is carried along so
 *   sampleHeight (below) can reach it without a breaking signature change -- height-profile chip
 *   placement is seeded.
 */
export function generateBricks(input) {
  const { boardOutline, set, frame, seed, scale } = input;

  let interiorOutline = boardOutline;
  let frameBricks = [];
  if (frame && frame.bands && frame.bands.length) {
    // F35 item 5 review: frame.set is an OPTIONAL Frame-only override (Fred's
    // own "frame thickness" = the brick LENGTH across a band) -- defaults to
    // the top-level `set` so every existing caller (nothing passed frame.set
    // before this) is unaffected; Wall's own bricksFillShape call below
    // always keeps the top-level `set`, never this override.
    const frameSet = frame.set || set;
    const res = bricksContourBands(frame.primitives, frame.bands, { set: frameSet, seed, scale });
    frameBricks = res.bricks;
    interiorOutline = res.innerPath;
  }

  const { bricks } = bricksFillShape(interiorOutline, null, {
    set, seed, scale,
    suppression: input.suppression ?? 0,
    topBias: input.topBias ?? 0.8,
    clumping: input.clumping ?? 0.3,
    zones: input.zones,
  });
  return { bricks, frameBricks, seed };
}

/** A simple grid-bucket spatial index over a brick list, so repeated point queries (a terrain
 *  sampler calls this once per grid point) don't linear-scan every brick. */
export function buildSpatialIndex(bricks, cellSizeIn) {
  const buckets = new Map();
  const key = (bx, by) => `${bx},${by}`;
  for (const b of bricks) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of b.polygon) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const bx0 = Math.floor(minX / cellSizeIn), bx1 = Math.floor(maxX / cellSizeIn);
    const by0 = Math.floor(minY / cellSizeIn), by1 = Math.floor(maxY / cellSizeIn);
    for (let bx = bx0; bx <= bx1; bx++) for (let by = by0; by <= by1; by++) {
      const k = key(bx, by);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(b);
    }
  }
  return { query: (x, y) => buckets.get(key(Math.floor(x / cellSizeIn), Math.floor(y / cellSizeIn))) || [] };
}

/**
 * The SECOND, DERIVED output: height at a board-inch point (x,y). Fred: brick relief is in
 * inches, default `set.reliefIn`, NEVER more than `set.reliefMaxIn` -- every brick's own raised
 * top, now a full 3D PROFILE (H23 item 73(c): rounded shoulder + slight crown + chipped corners,
 * `height-profile.js`'s own `brickTopHeight`, declared per set as `set.heightProfile`; a set with
 * no declared profile reduces exactly to the original flat `reliefIn + heightOffset`), is clamped
 * to reliefMaxIn here, the one place every source of height variation funnels through. Falls back
 * to `jointHeightIn` (0 = the groove floor) when the point is in a joint, not inside any brick.
 *
 * @param {(x:number,y:number,brick:object)=>number} [sampleDetailAt] — optional, see
 *   height-profile.js's own header: the adapter's de-lit high-pass sample surface, not built here.
 */
export function sampleHeight(result, index, x, y, set, jointHeightIn = 0, sampleDetailAt) {
  const candidates = index ? index.query(x, y) : [...result.bricks, ...result.frameBricks];
  for (const b of candidates) {
    if (pointInPolygon(x, y, b.polygon)) {
      const raw = brickTopHeight(x, y, b, set, result.seed, sampleDetailAt);
      return Math.max(0, Math.min(set.reliefMaxIn ?? 0.25, raw));
    }
  }
  return jointHeightIn;
}
