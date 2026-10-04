/**
 * core/bricks/contour-bands.js — PORTABLE (see rng.js). Core primitive #3 (the advisor, after
 * Fred's own UI lock -- "the Brick tab has three tools: Brush, Wall, Frame" -- contour bands get
 * their OWN entry point rather than being folded only into an option of bricksFillShape):
 *
 *   bricksContourBands(path, bands, opts) -> { bricks, innerPath }
 *
 * A declared list of BANDS running outer -> inner along a closed PATH (the board/frame outline,
 * supplied by the adapter), each its own declared width + pattern (library.js's own
 * FRAME_PRESETS). A thin band-stacker on top of bricksAlongPath (primitive #1).
 *
 * A band's own BRICKS ARE NEVER STRETCHED to fit `widthIn` exactly -- a brick's cross-dimension is
 * always its natural size (brickLengthIn for 'soldier', brickHeightIn for 'stretcher'; MEASURED,
 * not assumed: a first pass here offset each band's centreline by widthIn/2 directly, which is
 * only correct when widthIn happens to equal that natural size -- confirmed wrong by a rendered
 * preview showing visible gaps/overlaps at every band seam once a preset's own declared widthIn
 * diverged from the pattern's real brick size). Instead `widthIn` is SNAPPED to the nearest whole
 * number of that pattern's own brick-width rows (at least 1), each row its own
 * bricksAlongPath call on its own centreline, stacked outer -> inner within the band -- so a wider
 * band is genuinely MULTIPLE COURSES of full-size bricks, never one row of stretched ones, and the
 * next band always starts exactly where the actual (snapped) rows end, with no seam gap.
 */
import { offsetPathInward, inwardSignFor } from './geometry.js';
import { bricksAlongPath } from './along-path.js';
import { scaledSet } from './library.js';

/**
 * @param {{x:number,y:number}[]} path — closed polygon, ORDERED, board inches
 * @param {{widthIn:number, pattern:'soldier'|'stretcher'}[]} bands — outer -> inner
 * @param {object} opts
 * @param {object} opts.set — a library.BRICK_SETS entry
 * @param {number[]} [opts.cornerIndices=[]] — indices into `path` where a real corner occurs
 * @param {{startIndex:number, endIndex:number, cx:number, cy:number, r:number, theta1:number, theta2:number, radialSign:1|-1}[]} [opts.arcSegments=[]]
 *   — H23 item 76: declared TRUE circular arcs within `path` (the caller's own job to supply, from
 *   the real frame primitive data -- see arc-voussoir.js's own header). `r`/`theta1`/`theta2`/
 *   `radialSign` describe `path` itself (depth 0); EVERY row gets its OWN exact circle derived from
 *   these by adjusting `r` for that row's own cumulative offset depth (`theta1`/`theta2`/`cx`/`cy`
 *   stay IDENTICAL across rows -- offsetting a circle never moves its centre or sweep angle, only
 *   its radius) -- bricksAlongPath itself never re-derives any of this, it only ever walks a
 *   circle it's already been handed.
 * @param {number} [opts.scale=1] — uniform multiplier on the set's own brick length/height (grout unaffected)
 * @param {number} opts.seed
 * @returns {{ bricks: Array, innerPath: {x:number,y:number}[] }} innerPath = the last band's own
 *   inner edge, where bricksFillShape (the Wall tool) should start from.
 */
export function bricksContourBands(path, bands, opts) {
  const { seed } = opts;
  const set = scaledSet(opts.set, opts.scale); // scaled ONCE here; the inner bricksAlongPath calls
  // below get this already-scaled set directly (no opts.scale passed to them) so it's never applied twice.
  const cornerIndices = opts.cornerIndices || [];
  const arcSegments = opts.arcSegments || [];
  const sign = inwardSignFor(path);
  const bricks = [];
  let outer = path;
  let depthSoFar = 0; // how far INWARD (same direction `sign`/offsetPathInward move) `outer` has
  // already been pushed from the ORIGINAL `path` -- tracked alongside `outer` so every row's own
  // arc segments can be derived directly from the ORIGINAL (depth-0) ones, not re-measured.

  bands.forEach((band, bandIndex) => {
    const pattern = band.pattern || 'stretcher';
    const naturalWidth = pattern === 'soldier' ? set.brickLengthIn : set.brickHeightIn;
    const rows = Math.max(1, Math.round(band.widthIn / naturalWidth));
    for (let row = 0; row < rows; row++) {
      const centerline = offsetPathInward(outer, naturalWidth * (row + 0.5), sign);
      const rowDepth = depthSoFar + naturalWidth * (row + 0.5);
      const rowArcSegments = arcSegments.map((seg) => ({ ...seg, r: seg.r - seg.radialSign * rowDepth }));
      const { bricks: bandBricks } = bricksAlongPath(centerline, {
        set, orientation: pattern, closed: true, cornerIndices, arcSegments: rowArcSegments,
        seed: seed ^ (bandIndex * 0x1000193) ^ (row * 0x01000000), pieceId: 'frame',
      });
      bricks.push(...bandBricks);
    }
    outer = offsetPathInward(outer, naturalWidth * rows, sign);
    depthSoFar += naturalWidth * rows;
  });
  return { bricks, innerPath: outer };
}
