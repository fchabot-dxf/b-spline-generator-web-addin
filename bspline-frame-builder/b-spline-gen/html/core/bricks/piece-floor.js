/**
 * core/bricks/piece-floor.js — PORTABLE (see rng.js). The smallest piece a CUT may leave (a wall piece cut by a brush
 * stroke, a piece cut by a grout cut): below it the piece is not laid and reads as a slightly wider joint. Declared PER
 * LAYOUT, each the floor its own layout lays to -- library.js MIN_PIECE_FRACTION of its smallest piece:
 *  - fieldstone: of its smallest stone tier (layouts/fieldstone.js fieldstoneMinPieceArea);
 *  - every other layout (the bonds, coursed rubble, the sheet patterns): of one brick, brickLengthIn x brickHeightIn.
 * MEASURED (seat E, 2026-10-08): the cuts read the one-brick floor for every set, and fieldstone's "brick" is its stone
 * SPACING (White rocks 1.1 in, at 1.25 in bricks 1.83 x 1.83): every stone fragment under 0.84 sq in dropped -- 16 x the
 * layout's own floor -- and a brush stroke over a fieldstone wall left 1.68 sq in of bare board round it.
 * The floor is keyed by the layout that LAID the pieces, which is not always the set's own: a frame of Grey stone (a
 * coursed-rubble set) lays its ring with its bandLayout, fieldstone (contour-bands.js setBandPattern), and a brush stroke
 * lays courses whatever the set (LAID_BY_COURSES). MEASURED: a grout cut across the Grey stone ring left a 5-joint hole.
 */
import { MIN_PIECE_FRACTION } from './library.js';
import { fieldstoneMinPieceArea } from './layouts/fieldstone.js';

/** layout -> the floor (sq in) for a SCALED set of that layout; a layout not listed uses the one-brick floor */
export const PIECE_FLOOR_BY_LAYOUT = Object.freeze({ fieldstone: fieldstoneMinPieceArea });
/** pieces laid in courses of one brick (a frame's course bands, a brush stroke): the one-brick floor */
export const LAID_BY_COURSES = 'courses';
/** the floor for pieces of a SCALED set laid by `laidBy` (a layout name; default the set's own layout) */
export const minPieceAreaOf = (set, laidBy = set.layout) => (PIECE_FLOOR_BY_LAYOUT[laidBy] || ((s) => MIN_PIECE_FRACTION * s.brickLengthIn * s.brickHeightIn))(set);
/** the layout a FRAME's (or a window surround's) closed bands lay with a set: its band pattern, else courses */
export const frameLaidBy = (set, bandPatternOf) => bandPatternOf(set, true) || LAID_BY_COURSES;
