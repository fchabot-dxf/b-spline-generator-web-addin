/**
 * T77 (TIE-GAP, Fred: "in ties I want a minimum space apart") —
 * `_enforceTieMinSpacing` (editor-lattice-pattern.js) and its wiring into
 * `computePattern`'s own tie-slot pipeline: no two GENERATED ties whose
 * own spans overlap or touch (the same rail gap, or adjacent gaps sharing
 * a rail) may sit closer than `ties.minSpacing` (real inches) apart along
 * the rail direction — dropping candidates ("generate FEWER"), never
 * moving one, when the seeded count can't fit.
 */
import { describe, it, expect } from 'vitest';
import {
  computePattern, PATTERN_DEFAULTS, _enforceTieMinSpacing,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

const EXTENT = { iMin: 0, jMin: 0, iMax: 12, jMax: 30 };

function tieSegs(result) {
  return result.segments.filter((s) => s.kind === 'tie');
}

/** Independent oracle: does ANY pair of ties in `segs` violate `minSpacingIn`
 *  (real inches, `spacing` inches/cell), per this feature's own declared
 *  rule (span overlap-or-touch AND column distance < minSpacing)? Reads
 *  the SAME segments computePattern itself returns, never re-trusting the
 *  function under test's own internal bookkeeping. */
function findViolation(segs, minSpacingIn, spacing) {
  const minCells = minSpacingIn / spacing;
  for (let a = 0; a < segs.length; a++) {
    for (let b = a + 1; b < segs.length; b++) {
      const [t1, t2] = [segs[a], segs[b]];
      const lo1 = Math.min(t1.a.j, t1.b.j), hi1 = Math.max(t1.a.j, t1.b.j);
      const lo2 = Math.min(t2.a.j, t2.b.j), hi2 = Math.max(t2.a.j, t2.b.j);
      const overlapOrTouch = lo1 <= hi2 && lo2 <= hi1;
      if (overlapOrTouch && Math.abs(t1.a.i - t2.a.i) < minCells - 1e-9) {
        return { t1, t2, dist: Math.abs(t1.a.i - t2.a.i) * spacing };
      }
    }
  }
  return null;
}

describe('_enforceTieMinSpacing (pure filter, direct unit tests)', () => {
  it('keeps every candidate when minSpacing is 0 (an explicit opt-out, not a special case internally)', () => {
    const slots = [{ i: 0, jStart: 0, jEnd: 5 }, { i: 0.5, jStart: 0, jEnd: 5 }];
    expect(_enforceTieMinSpacing(slots, 0, 0.25)).toEqual(slots);
  });

  it('drops the LATER candidate when two overlapping-span ties are closer than minSpacing, keeping the earlier one', () => {
    const slots = [
      { i: 0, jStart: 0, jEnd: 5 },
      { i: 1, jStart: 0, jEnd: 5 }, // 1 cell * 0.25in = 0.25in apart -- violates 0.5in
    ];
    const result = _enforceTieMinSpacing(slots, 0.5, 0.25);
    expect(result).toEqual([slots[0]]);
  });

  it('keeps BOTH when their spans do not overlap or touch at all, however close their columns are', () => {
    const slots = [
      { i: 0, jStart: 0, jEnd: 5 },
      { i: 0, jStart: 10, jEnd: 15 }, // same column, but nowhere near each other vertically
    ];
    expect(_enforceTieMinSpacing(slots, 0.5, 0.25)).toEqual(slots);
  });

  it('keeps BOTH when their spans overlap but they are far enough apart in columns', () => {
    const slots = [
      { i: 0, jStart: 0, jEnd: 5 },
      { i: 4, jStart: 0, jEnd: 5 }, // 4 cells * 0.25in = 1.0in apart -- clears 0.5in
    ];
    expect(_enforceTieMinSpacing(slots, 0.5, 0.25)).toEqual(slots);
  });

  it('adjacent gaps that only TOUCH (one ends exactly where the other starts) still conflict -- the declared "visually pair" rule', () => {
    const slots = [
      { i: 0, jStart: 0, jEnd: 10 }, // gap 0-10
      { i: 0.5, jStart: 10, jEnd: 20 }, // adjacent gap, touches at j=10, close in column
    ];
    const result = _enforceTieMinSpacing(slots, 0.5, 0.25);
    expect(result).toEqual([slots[0]]);
  });

  it('a chain of 3+ mutually-close ties: greedily keeps every one that does not conflict with an ALREADY-accepted one, not just pairwise the first two', () => {
    const slots = [
      { i: 0, jStart: 0, jEnd: 5 },
      { i: 1, jStart: 0, jEnd: 5 }, // conflicts with slot 0 -- dropped
      { i: 4, jStart: 0, jEnd: 5 }, // clears slot 0 (accepted) by 1.0in -- kept
      { i: 4.5, jStart: 0, jEnd: 5 }, // conflicts with the NOW-accepted slot 2 -- dropped
    ];
    const result = _enforceTieMinSpacing(slots, 0.5, 0.25);
    expect(result.map((s) => s.i)).toEqual([0, 4]);
  });
});

describe('computePattern — TIE-GAP integration (count mode, the default)', () => {
  it('PATTERN_DEFAULTS declares ties.minSpacing = 0.5', () => {
    expect(PATTERN_DEFAULTS.ties.minSpacing).toBe(0.5);
  });

  it('50 seeds: no generated tie pair ever violates the default minSpacing (0.5in @ 0.25in/cell)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const result = computePattern({ ...PATTERN_DEFAULTS, seed }, { extent: EXTENT });
      const violation = findViolation(tieSegs(result), PATTERN_DEFAULTS.ties.minSpacing, 0.25);
      expect(violation).toBeNull();
    }
  });

  it('a non-vacuous control: WITHOUT the filter (minSpacing:0), at least one of these same 50 seeds genuinely DOES violate 0.5in -- proving the filter is doing real work, not passing by coincidence', () => {
    let anyViolation = false;
    for (let seed = 1; seed <= 50; seed++) {
      const result = computePattern({ ...PATTERN_DEFAULTS, seed, ties: { ...PATTERN_DEFAULTS.ties, minSpacing: 0 } }, { extent: EXTENT });
      if (findViolation(tieSegs(result), 0.5, 0.25)) { anyViolation = true; break; }
    }
    expect(anyViolation).toBe(true);
  });

  it('spacing wins over count: a minSpacing too large for the [8,13] range to fit generates FEWER ties, never throws, never overlaps', () => {
    // A generous minSpacing (2in = 8 cells @ 0.25in) on a 12-column board
    // cannot possibly fit 8+ ties spread across only 13 candidate columns
    // (iMax-iMin+1) without violating it -- forcing real drops.
    for (let seed = 1; seed <= 20; seed++) {
      const pattern = { ...PATTERN_DEFAULTS, seed, ties: { ...PATTERN_DEFAULTS.ties, minSpacing: 2 } };
      expect(() => computePattern(pattern, { extent: EXTENT })).not.toThrow();
      const result = computePattern(pattern, { extent: EXTENT });
      const ties = tieSegs(result);
      expect(ties.length).toBeLessThan(PATTERN_DEFAULTS.ties.count[0]); // genuinely fewer than the declared minimum
      expect(findViolation(ties, 2, 0.25)).toBeNull();
    }
  });

  it('works for one-ended ties too (oneEnded stubs are still checked by their own real span)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const pattern = { ...PATTERN_DEFAULTS, seed, ties: { ...PATTERN_DEFAULTS.ties, oneEnded: 4 } };
      const result = computePattern(pattern, { extent: EXTENT });
      expect(findViolation(tieSegs(result), PATTERN_DEFAULTS.ties.minSpacing, 0.25)).toBeNull();
    }
  });

  it('works in density mode too (not just count mode)', () => {
    // rails.every:5 (a FIXED, guaranteed-every-gap-is-5-rows stride, not the
    // seeded 'count' default) matches this test's own anchor:'rails',
    // spanMin=spanMax=5 -- the SAME deterministic-rail-spacing precedent
    // tests/editor-lattice-pattern-density-count.test.js's own analogous
    // density-mode test already uses, so EVERY column genuinely gets a
    // density:1 candidate, for every seed, non-vacuously.
    for (let seed = 1; seed <= 20; seed++) {
      const pattern = {
        ...PATTERN_DEFAULTS, seed,
        rails: { mode: 'every', every: 5, offset: 0 },
        ties: { ...PATTERN_DEFAULTS.ties, mode: 'density', density: 1, anchor: 'rails', spanMin: 5, spanMax: 5 },
      };
      const result = computePattern(pattern, { extent: EXTENT });
      expect(tieSegs(result).length).toBeGreaterThan(0); // non-vacuous: density:1 genuinely produces candidates
      expect(findViolation(tieSegs(result), PATTERN_DEFAULTS.ties.minSpacing, 0.25)).toBeNull();
    }
  });

  it('a saved pattern with no minSpacing key at all reads the declared default (0.5), same "missing = default" convention every other field here uses', () => {
    const oldSavedTies = { mode: 'count', count: [8, 13], spread: 'stratified', span: { mode: 'rails', rails: 1 }, maxRailGaps: 1, oneEnded: 1 };
    const result = computePattern({ ...PATTERN_DEFAULTS, ties: oldSavedTies }, { extent: EXTENT });
    expect(findViolation(tieSegs(result), 0.5, 0.25)).toBeNull();
  });
});

describe('computePattern — TIE-GAP works with boundary mode (Shape Lattice, contour-clipped ties)', () => {
  function rectPrimitives(iMin, jMin, iMax, jMax) {
    const c = [[iMin, jMin], [iMax, jMin], [iMax, jMax], [iMin, jMax]];
    return c.map((p, k) => ({ type: 'L', p0: { x: p[0], y: p[1] }, p1: { x: c[(k + 1) % 4][0], y: c[(k + 1) % 4][1] } }));
  }

  it('20 seeds: no generated tie pair violates minSpacing inside a clipped boundary either', () => {
    const boundary = { mode: 'boundary', iMin: 0, jMin: 0, iMax: 12, jMax: 30, primitives: rectPrimitives(2, 5, 10, 25) };
    for (let seed = 1; seed <= 20; seed++) {
      const result = computePattern({ ...PATTERN_DEFAULTS, seed }, { extent: boundary });
      expect(findViolation(tieSegs(result), PATTERN_DEFAULTS.ties.minSpacing, 0.25)).toBeNull();
    }
  });
});
