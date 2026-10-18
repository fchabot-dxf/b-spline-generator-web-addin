/**
 * core/pull-rails.js -- Pull from Fusion, rails custom-position + lock slice (seat D 2026-10-16; advisor 45):
 * matchPulledRails matches a Pull reply's pulled line curves back to the exact rail by railId (Send-tagged,
 * never geometry-guessed), and computes each one's `at` -- the SAME offset fraction semantics
 * editor-lattice-pattern.js's own protectedRails[].at already uses.
 */
import { describe, it, expect } from 'vitest';
import { matchPulledRails } from '../bspline-frame-builder/b-spline-gen/html/core/pull-rails.js';

const SPACING = 0.25;
// board-inches extent [0,0]-[4,4] -> lattice [0,0]-[16,16] (i/j = inches/spacing)
const EXTENT = { iMin: 0, jMin: 0, iMax: 16, jMax: 16 };

describe('matchPulledRails: matched by railId, at = the SAME offset fraction protectedRails.at uses', () => {
  it('a pulled rail at the extent\'s own midpoint row gets at = 0.5', () => {
    // row y = 2in -> j = 8 -> (8-0)/(16-0) = 0.5
    const curves = [{ type: 'line', railId: 'rail7', isConstruction: false, x1: 0, y1: 2, x2: 4, y2: 2 }];
    expect(matchPulledRails(curves, { spacing: SPACING, orientation: 'horizontal', extent: EXTENT }))
      .toEqual([{ id: 'rail7', at: 0.5 }]);
  });

  it('a rail near the TOP row gets at close to 0, near the BOTTOM gets at close to 1', () => {
    const curves = [
      { type: 'line', railId: 'rail1', isConstruction: false, x1: 0, y1: 0.25, x2: 4, y2: 0.25 },
      { type: 'line', railId: 'rail2', isConstruction: false, x1: 0, y1: 3.75, x2: 4, y2: 3.75 },
    ];
    const [r1, r2] = matchPulledRails(curves, { spacing: SPACING, orientation: 'horizontal', extent: EXTENT });
    expect(r1.at).toBeCloseTo(0.0625, 10);
    expect(r2.at).toBeCloseTo(0.9375, 10);
  });

  it('several pulled rails each produce their own {id, at}, in curve order', () => {
    const curves = [
      { type: 'line', railId: 'rail3', isConstruction: false, x1: 0, y1: 1, x2: 4, y2: 1 },
      { type: 'line', railId: 'rail9', isConstruction: false, x1: 0, y1: 3, x2: 4, y2: 3 },
    ];
    const got = matchPulledRails(curves, { spacing: SPACING, orientation: 'horizontal', extent: EXTENT });
    expect(got.map((r) => r.id)).toEqual(['rail3', 'rail9']);
    expect(got[0].at).toBeCloseTo(0.25, 10);
    expect(got[1].at).toBeCloseTo(0.75, 10);
  });

  it('a rail moved PAST the extent is still reported (at outside [0,1]) -- placement decides, not the matcher', () => {
    const curves = [{ type: 'line', railId: 'rail4', isConstruction: false, x1: 0, y1: 5, x2: 4, y2: 5 }]; // y=5 > the 4in board
    const [r] = matchPulledRails(curves, { spacing: SPACING, orientation: 'horizontal', extent: EXTENT });
    expect(r.at).toBeGreaterThan(1);
  });

  it('a degenerate (zero-height) extent: at is null, not a divide-by-zero NaN', () => {
    const flat = { iMin: 0, jMin: 8, iMax: 16, jMax: 8 };
    const curves = [{ type: 'line', railId: 'rail1', isConstruction: false, x1: 0, y1: 2, x2: 4, y2: 2 }];
    expect(matchPulledRails(curves, { spacing: SPACING, orientation: 'horizontal', extent: flat })).toEqual([{ id: 'rail1', at: null }]);
  });
});

describe('matchPulledRails: what it skips (never guesses an id, never includes a non-rail curve)', () => {
  it('a hand-drawn/legacy line with no railId at all is skipped', () => {
    const curves = [{ type: 'line', railId: null, isConstruction: false, x1: 0, y1: 2, x2: 4, y2: 2 }];
    expect(matchPulledRails(curves, { spacing: SPACING, orientation: 'horizontal', extent: EXTENT })).toEqual([]);
  });

  // The old pin ("a construction line is skipped even if it somehow carries a railId") guarded a case that never
  // happens the way it assumed: measured live in Fusion (2026-10-18, 7x9 board), ALL 9 Send-tagged rails
  // (rail1..rail9) are construction lines, so the skip dropped every real rail and Apply moved nothing.
  it('a construction line that carries a railId IS a rail (every real Send rail is one)', () => {
    const curves = [{ type: 'line', railId: 'rail7', isConstruction: true, x1: 0, y1: 2, x2: 4, y2: 2 }];
    expect(matchPulledRails(curves, { spacing: SPACING, orientation: 'horizontal', extent: EXTENT }))
      .toEqual([{ id: 'rail7', at: 0.5 }]);
  });

  it('a construction line with NO railId is still skipped', () => {
    const curves = [{ type: 'line', railId: null, isConstruction: true, x1: 0, y1: 2, x2: 4, y2: 2 }];
    expect(matchPulledRails(curves, { spacing: SPACING, orientation: 'horizontal', extent: EXTENT })).toEqual([]);
  });

  it('a non-line curve (circle, arc, spline) is skipped regardless of any railId-shaped field', () => {
    const curves = [{ type: 'circle', railId: 'rail7', isConstruction: false, cx: 1, cy: 1, r: 0.2 }];
    expect(matchPulledRails(curves, { spacing: SPACING, orientation: 'horizontal', extent: EXTENT })).toEqual([]);
  });

  it('an id shaped like a rail id but from a stale/foreign source (not RAIL_ID_RE) is skipped', () => {
    const curves = [{ type: 'line', railId: 'contour3', isConstruction: false, x1: 0, y1: 2, x2: 4, y2: 2 }];
    expect(matchPulledRails(curves, { spacing: SPACING, orientation: 'horizontal', extent: EXTENT })).toEqual([]);
  });

  it('no curves at all: an empty list, not an error', () => {
    expect(matchPulledRails([], { spacing: SPACING, orientation: 'horizontal', extent: EXTENT })).toEqual([]);
    expect(matchPulledRails(undefined, { spacing: SPACING, orientation: 'horizontal', extent: EXTENT })).toEqual([]);
  });
});

describe('matchPulledRails: vertical orientation uses the conjugated (swapped) axis, same as protectedRails', () => {
  // a non-square extent: iMin..iMax [0,16] (board width 4in), jMin..jMax [0,40] (board height 10in) -- a wrong
  // (unoriented) implementation would divide by the WRONG span here, unlike with a square extent where a bug
  // in the axis swap is invisible (both spans are identical, so it accidentally gives the right answer anyway).
  const WIDE_EXTENT = { iMin: 0, jMin: 0, iMax: 16, jMax: 40 };

  it('a vertical-orientation rail runs along j (constant x); its row is the i axis, oriented through the SAME extent', () => {
    // vertical: rails run top-to-bottom at a given x. x=2in -> i=8, of the extent's own iMin..iMax [0,16] -> 0.5.
    // An implementation that forgot to orient the extent would divide by the j-span (40) instead and get 0.2.
    const curves = [{ type: 'line', railId: 'rail5', isConstruction: false, x1: 2, y1: 0, x2: 2, y2: 4 }];
    const got = matchPulledRails(curves, { spacing: SPACING, orientation: 'vertical', extent: WIDE_EXTENT });
    expect(got[0].at).toBeCloseTo(0.5, 10);
  });
});
