/**
 * SE13 Slice 3 (T49) — two pure-logic pieces of computePattern's boundary
 * mode: the "fix first" edge-collinear-row product decision (a boundary
 * edge drawn exactly on a snapped grid line must not silently vanish,
 * unless the Border piece already draws that same edge), and §5's
 * ending-rule table (on-boundary / inset / joint / loose, loose's own
 * degrade-to-inset case).
 */
import { describe, it, expect } from 'vitest';
import { computePattern, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

function rectPrimitives(iMin, jMin, iMax, jMax) {
  const c = [[iMin, jMin], [iMax, jMin], [iMax, jMax], [iMin, jMax]];
  return c.map((p, k) => ({
    type: 'L',
    p0: { x: p[0], y: p[1] },
    p1: { x: c[(k + 1) % 4][0], y: c[(k + 1) % 4][1] },
  }));
}

describe('computePattern: "fix first" -- an edge-collinear rail/tie must not silently vanish', () => {
  const iMin = 0, jMin = 0, iMax = 10, jMax = 8;
  // The boundary's own edges land EXACTLY on iMin/jMin/iMax/jMax -- the
  // real-world case (Snap on by default, a hand-drawn rect boundary) that
  // T48's own insideSpans-only computation silently dropped (both the
  // OUTERMOST rail row at jMin/jMax and the outermost tie column at
  // iMin/iMax, per the collinear-edge degenerate case documented in
  // tests/editor-lattice-boundary.test.js).
  const primitives = rectPrimitives(iMin, jMin, iMax, jMax);
  const basePattern = {
    ...PATTERN_DEFAULTS,
    rails: { every: 2, offset: 0 }, // jMin=0 and jMax=8 are both rail rows
    ties: { density: 1, spanMin: jMax, spanMax: jMax, columns: [iMin, 5, iMax], anchor: 'free', railSnapRows: 0 },
    boundary: { ...PATTERN_DEFAULTS.boundary, endRule: 'on-boundary' }, // isolate from the inset pull-back
  };

  it('Border OFF (default): the jMin/jMax rail rows and iMin/iMax tie columns are KEPT, spanning the full edge', () => {
    const { segments } = computePattern(basePattern, {
      extent: { iMin, jMin, iMax, jMax, mode: 'boundary', primitives },
    });
    const rails = segments.filter((s) => s.kind === 'rail');
    const topRail = rails.find((s) => s.a.j === jMin);
    const bottomRail = rails.find((s) => s.a.j === jMax);
    expect(topRail).toBeDefined();
    expect(bottomRail).toBeDefined();
    expect([topRail.a.i, topRail.b.i].sort((x, y) => x - y)).toEqual([iMin, iMax]);
    expect([bottomRail.a.i, bottomRail.b.i].sort((x, y) => x - y)).toEqual([iMin, iMax]);

    const ties = segments.filter((s) => s.kind === 'tie');
    const leftTie = ties.find((s) => s.a.i === iMin);
    const rightTie = ties.find((s) => s.a.i === iMax);
    expect(leftTie).toBeDefined();
    expect(rightTie).toBeDefined();
  });

  it('Border ON: the SAME edge-collinear rail/tie is dropped instead (the Border piece already draws that line -- no double stroke)', () => {
    const pattern = {
      ...basePattern,
      boundary: { ...basePattern.boundary, border: { enabled: true, width: null, color: null } },
    };
    const { segments } = computePattern(pattern, {
      extent: { iMin, jMin, iMax, jMax, mode: 'boundary', primitives },
    });
    const rails = segments.filter((s) => s.kind === 'rail');
    expect(rails.find((s) => s.a.j === jMin)).toBeUndefined();
    expect(rails.find((s) => s.a.j === jMax)).toBeUndefined();

    const ties = segments.filter((s) => s.kind === 'tie');
    expect(ties.find((s) => s.a.i === iMin)).toBeUndefined();
    expect(ties.find((s) => s.a.i === iMax)).toBeUndefined();
  });

  it('an INTERIOR rail row (not collinear with any edge) is present and unaffected by the Border toggle either way', () => {
    const off = computePattern(basePattern, { extent: { iMin, jMin, iMax, jMax, mode: 'boundary', primitives } });
    const on = computePattern(
      { ...basePattern, boundary: { ...basePattern.boundary, border: { enabled: true, width: null, color: null } } },
      { extent: { iMin, jMin, iMax, jMax, mode: 'boundary', primitives } },
    );
    const interiorOff = off.segments.filter((s) => s.kind === 'rail' && s.a.j === 4);
    const interiorOn = on.segments.filter((s) => s.kind === 'rail' && s.a.j === 4);
    expect(interiorOff).toEqual(interiorOn);
    expect(interiorOff.length).toBeGreaterThan(0);
  });
});

describe('computePattern: §5 ending-rule table, a circular boundary (non-collinear crossings)', () => {
  const cx = 5, cy = 4, r = 4;
  const primitives = [{ type: 'CIRCLE', cx, cy, r }];
  const spacing = PATTERN_DEFAULTS.spacing;
  const halfRail = PATTERN_DEFAULTS.widths.rails / 2 / spacing;
  const j = 1; // |j - cy| = 3 -> a real chord, not tangent
  const expectedHalfChord = Math.sqrt(r * r - (j - cy) * (j - cy));
  const rawLo = cx - expectedHalfChord, rawHi = cx + expectedHalfChord;
  const extent = { iMin: 1, jMin: 0, iMax: 9, jMax: 8, mode: 'boundary', primitives };
  const basePattern = { ...PATTERN_DEFAULTS, rails: { every: 1, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 0 } };

  function railAtJ(endRule) {
    const pattern = { ...basePattern, boundary: { ...PATTERN_DEFAULTS.boundary, endRule } };
    const { segments, nodePoints } = computePattern(pattern, { extent });
    const rail = segments.find((s) => s.kind === 'rail' && s.a.j === j);
    return { rail, nodePoints };
  }

  it('on-boundary: the raw crossing point, unchanged -- zero extra geometry', () => {
    const { rail } = railAtJ('on-boundary');
    expect(rail.a.i).toBeCloseTo(rawLo, 9);
    expect(rail.b.i).toBeCloseTo(rawHi, 9);
  });

  it('inset (default): both ends pulled back by exactly halfWidth along the rail\'s own axis', () => {
    const { rail } = railAtJ('inset');
    expect(rail.a.i).toBeCloseTo(rawLo + halfRail, 9);
    expect(rail.b.i).toBeCloseTo(rawHi - halfRail, 9);
  });

  it('joint: same geometry as on-boundary, PLUS a node at each crossing (reuses existing node emission)', () => {
    const { rail, nodePoints } = railAtJ('joint');
    expect(rail.a.i).toBeCloseTo(rawLo, 9);
    expect(rail.b.i).toBeCloseTo(rawHi, 9);
    const hasNodeAt = (i) => nodePoints.some((p) => p.j === j && Math.abs(p.i - i) < 1e-6);
    expect(hasNodeAt(rawLo)).toBe(true);
    expect(hasNodeAt(rawHi)).toBe(true);
  });

  it('loose: each end pulled back to the nearest GRID-integer stop strictly inside the span, not the raw crossing', () => {
    const { rail } = railAtJ('loose');
    // rawLo ~= 5 - 2.6458 = 2.354 -> the next integer stop moving INWARD is 3.
    // rawHi ~= 5 + 2.6458 = 7.646 -> the next integer stop moving INWARD is 7.
    expect(rail.a.i).toBeCloseTo(Math.ceil(rawLo), 9);
    expect(rail.b.i).toBeCloseTo(Math.floor(rawHi), 9);
    expect(rail.a.i).not.toBeCloseTo(rawLo, 2);
    expect(rail.b.i).not.toBeCloseTo(rawHi, 2);
  });

  it('loose degrades to inset when the span is shorter than one grid cell (no stop fits between the two crossings)', () => {
    // Center on a HALF-integer (5.5, not 5) so the tiny chord [5.2,5.8]
    // straddles no integer lattice line at all -- r=0.3 alone isn't
    // enough (a chord centered ON an integer, e.g. [4.7,5.3], still
    // contains that integer strictly inside it, which IS a valid loose
    // stop, not the "no stop fits" case this test means to isolate).
    const tinyPrimitives = [{ type: 'CIRCLE', cx: 5.5, cy: 4, r: 0.3 }];
    const tinyExtent = { iMin: 4, jMin: 3, iMax: 7, jMax: 5, mode: 'boundary', primitives: tinyPrimitives };
    const pattern = {
      ...PATTERN_DEFAULTS, rails: { every: 1, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 0 },
      boundary: { ...PATTERN_DEFAULTS.boundary, endRule: 'loose' },
    };
    const { segments } = computePattern(pattern, { extent: tinyExtent });
    const rail = segments.find((s) => s.kind === 'rail' && s.a.j === 4); // the row through the tiny circle's own center
    expect(rail).toBeDefined();
    // The chord at the center row is [5.2, 5.8] -- shorter than one grid
    // cell and straddling no integer, so no stop lies strictly between
    // the two crossings -> both ends must fall back to the INSET math
    // (pulled back by halfRail from the raw crossing), not a grid integer.
    const rawChordLo = 5.5 - 0.3, rawChordHi = 5.5 + 0.3;
    expect(rail.a.i).toBeCloseTo(rawChordLo + halfRail, 9);
    expect(rail.b.i).toBeCloseTo(rawChordHi - halfRail, 9);
  });
});

describe('computePattern: T50 -- the fill cuts at the boundary\'s own inner-stroke edge, not the raw centerline', () => {
  // The dispatch's own exact test case: circle r=2, stroke 0.8 -> the
  // center row's own rail endpoints land at radius 1.6 (2 - 0.8/2), BEFORE
  // whatever the ending rule itself does on top of that.
  const cx = 5, cy = 5, r = 2;
  const primitives = [{ type: 'CIRCLE', cx, cy, r }];
  const extentBase = { iMin: 2, jMin: 2, iMax: 8, jMax: 8, mode: 'boundary', primitives };
  const basePattern = { ...PATTERN_DEFAULTS, rails: { every: 1, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 0 } };

  it('on-boundary: the shrunk (inner-stroke) crossing, not the raw r=2 crossing', () => {
    const pattern = { ...basePattern, boundary: { ...PATTERN_DEFAULTS.boundary, endRule: 'on-boundary' } };
    const { segments } = computePattern(pattern, { extent: { ...extentBase, edgeShrink: 0.4 } }); // half of 0.8
    const centerRail = segments.find((s) => s.kind === 'rail' && s.a.j === cy);
    expect(centerRail.a.i).toBeCloseTo(cx - 1.6, 9);
    expect(centerRail.b.i).toBeCloseTo(cx + 1.6, 9);
  });

  it('inset: the ending rule\'s own pullback applies ON TOP of the inner-stroke shrink, not instead of it', () => {
    const pattern = { ...basePattern, boundary: { ...PATTERN_DEFAULTS.boundary, endRule: 'inset' } };
    const halfRail = PATTERN_DEFAULTS.widths.rails / 2 / PATTERN_DEFAULTS.spacing;
    const { segments } = computePattern(pattern, { extent: { ...extentBase, edgeShrink: 0.4 } });
    const centerRail = segments.find((s) => s.kind === 'rail' && s.a.j === cy);
    expect(centerRail.a.i).toBeCloseTo(cx - 1.6 + halfRail, 9);
    expect(centerRail.b.i).toBeCloseTo(cx + 1.6 - halfRail, 9);
  });

  it('edgeShrink: 0 (unstroked boundary, or boundary.edge==="centerline") reduces to the pre-T50 raw-crossing behavior', () => {
    const pattern = { ...basePattern, boundary: { ...PATTERN_DEFAULTS.boundary, endRule: 'on-boundary' } };
    const { segments } = computePattern(pattern, { extent: { ...extentBase, edgeShrink: 0 } });
    const centerRail = segments.find((s) => s.kind === 'rail' && s.a.j === cy);
    expect(centerRail.a.i).toBeCloseTo(cx - r, 9);
    expect(centerRail.b.i).toBeCloseTo(cx + r, 9);
  });

  it('a chord shorter than the full shrink on both ends collapses to a point rather than inverting', () => {
    // A tiny circle (r=0.5) with a huge shrink (0.4, i.e. a 0.8"-wide
    // stroke on a 1"-diameter circle) -- the center row's own shrink from
    // both ends (0.4 + 0.4 = 0.8) very nearly consumes the whole chord (1.0).
    const tinyPrimitives = [{ type: 'CIRCLE', cx: 5, cy: 5, r: 0.5 }];
    const pattern = { ...basePattern, boundary: { ...PATTERN_DEFAULTS.boundary, endRule: 'on-boundary' } };
    const { segments } = computePattern(pattern, {
      extent: { iMin: 4, jMin: 4, iMax: 6, jMax: 6, mode: 'boundary', primitives: tinyPrimitives, edgeShrink: 0.6 },
    });
    const centerRail = segments.find((s) => s.kind === 'rail' && s.a.j === 5);
    // shrink (0.6) on each end exceeds the half-chord (0.5) -- must
    // collapse to a single point at the center, not invert past it.
    expect(centerRail).toBeDefined();
    expect(centerRail.a.i).toBeCloseTo(centerRail.b.i, 9);
    expect(centerRail.a.i).toBeCloseTo(5, 9);
  });

  it('a "free" tie end (not a boundary crossing) is never shrunk, even when edgeShrink is nonzero', () => {
    // Column i=5 is the circle's own CENTER column -- its own natural
    // boundary span is the full diameter [3,7]. Narrowing the QUERY
    // window to jMin:4,jMax:6 (strictly inside [3,7], with real margin on
    // both sides) guarantees any 1-cell tie drawn there is comfortably
    // interior regardless of the random seed -- not an assumption about
    // exactly where the draw happens to land (a real, self-caught bug
    // this same turn: the ORIGINAL version of this test used the full
    // [2,8] window, where the free 'anchor' draw could land with an end
    // EXACTLY on the boundary's own edge by chance -- which, per T50's
    // own fix below, correctly SHOULD be shrunk in that case too, since
    // it's genuinely at the boundary regardless of why).
    const pattern = {
      ...PATTERN_DEFAULTS, rails: { every: 0, offset: 0 },
      ties: { density: 1, spanMin: 1, spanMax: 1, columns: [5], anchor: 'free', railSnapRows: 0 },
      boundary: { ...PATTERN_DEFAULTS.boundary, endRule: 'on-boundary' },
    };
    const narrowExtent = { ...extentBase, jMin: 4, jMax: 6 };
    const unshrunkResult = computePattern(pattern, { extent: { ...narrowExtent, edgeShrink: 0 } });
    const shrunkResult = computePattern(pattern, { extent: { ...narrowExtent, edgeShrink: 0.4 } });
    const tieBefore = unshrunkResult.segments.find((s) => s.kind === 'tie');
    const tieAfter = shrunkResult.segments.find((s) => s.kind === 'tie');
    expect(tieBefore).toBeDefined();
    // Sanity: the drawn span must genuinely sit STRICTLY inside the
    // boundary's own [3,7] span (real margin, not touching either end)
    // for this test to prove anything about "free" ends specifically.
    expect(Math.min(tieBefore.a.j, tieBefore.b.j)).toBeGreaterThan(3);
    expect(Math.max(tieBefore.a.j, tieBefore.b.j)).toBeLessThan(7);
    expect(tieAfter).toEqual(tieBefore); // unaffected -- neither end is a real crossing
  });
});
