/**
 * core/bricks/layouts/basketweave.js — PORTABLE (see rng.js). F35 item 7: "pairs alternating
 * horizontal/vertical in squares" -- a 'tile2d' pattern (library.js's own BRICK_PATTERNS), its own
 * layout file for the same reason fieldstone.js is its own file rather than a bond.js variant:
 * bond.js's entire vocabulary is stagger+rotation of ONE uniform row, which cannot express two
 * perpendicular orientations alternating by BLOCK the way basketweave needs.
 *
 * The actual packing algorithm lives in weave-core.js's own `weaveLayout`, shared verbatim with
 * herringbone.js -- basketweave is that SAME construction at 0 degrees (see weave-core.js's own
 * header for why the two patterns are really one algorithm with a rotation parameter, and for the
 * measured reasoning behind the construction itself).
 */
import { weaveLayout } from './weave-core.js';

/**
 * @param {{x:number,y:number}[]} boardOutline — closed polygon, board inches
 * @param {{brickLengthIn:number, brickHeightIn:number, grout:{widthIn:number}}} set
 * @param {Array} [_zones] — unused (same call-signature-parity precedent as fieldstone.js: this
 *   pattern has no course/zone concept of its own)
 * @returns {{cells: Array}}
 */
export function basketweaveLayout(boardOutline, set, _zones) {
  return weaveLayout(boardOutline, set.brickLengthIn, set.brickHeightIn, set.grout.widthIn, 0);
}
