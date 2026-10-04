/**
 * core/bricks/layouts/herringbone.js — PORTABLE (see rng.js). F35 item 7: "bricks at 45 degrees,
 * alternating" -- a 'tile2d' pattern (library.js's own BRICK_PATTERNS), its own layout file for the
 * same reason fieldstone.js is its own file rather than a bond.js variant (see basketweave.js's own
 * header for the full reasoning, shared verbatim).
 *
 * The actual packing lives in weave-core.js's own `weaveLayout` -- herringbone IS basketweave's own
 * construction, rotated 45 degrees (weave-core.js's own header explains why a from-scratch
 * closed-form diagonal chevron tiling turned out to be real, unsolved geometry in this session, and
 * why rotating the already-verified block construction is the one approach that measured out
 * correct AND good-looking).
 */
import { weaveLayout } from './weave-core.js';

/**
 * @param {{x:number,y:number}[]} boardOutline — closed polygon, board inches
 * @param {{brickLengthIn:number, brickHeightIn:number, grout:{widthIn:number}}} set
 * @param {Array} [_zones] — unused (same call-signature-parity precedent as fieldstone.js)
 * @returns {{cells: Array}}
 */
export function herringboneLayout(boardOutline, set, _zones) {
  return weaveLayout(boardOutline, set.brickLengthIn, set.brickHeightIn, set.grout.widthIn, 45);
}
