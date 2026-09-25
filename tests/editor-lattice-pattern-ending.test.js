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
  const basePattern = { ...PATTERN_DEFAULTS, rails: { every: 1, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, mode: 'density', density: 0 } };

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
      ...PATTERN_DEFAULTS, rails: { every: 1, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, mode: 'density', density: 0 },
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

// T50's own "the fill cuts at the boundary's own inner-stroke edge" tests
// lived here as a `computePattern`-level `extent.edgeShrink` field, applied
// per-crossing right before the ending rule. T51 (advisor review of T50)
// found that per-crossing scan-direction shrink only happened to be exact
// at a circle's own center row/column — elsewhere (any row where
// |y-cy| > the true inner radius) it left rails sitting ENTIRELY INSIDE
// the visible stroke band, since shrinking a still-valid OUTER crossing by
// a flat amount is not the same as re-cutting against a smaller, TRUE
// inward-offset boundary. `extent.edgeShrink` is gone from `computePattern`
// entirely now (deleted, not left as a dead branch, per the advisor's own
// instruction) — the inset happens earlier, in `shapeToInnerBoundaryPrimitives`
// (editor-lattice-boundary.js, tested in tests/editor-lattice-boundary.test.js),
// which reuses the Expand tool's own analytic/biarc offset engine to
// compute the shape's own TRUE inner ring before `computePattern` ever
// sees it — so by the time a rail/tie is clipped against it, the
// primitives themselves already ARE the correct boundary, and the ending
// rule composes with that the same way it always did. The end-to-end
// "which stroke width wins, and does the ending rule apply on top of the
// inset" behavior this block used to check now lives in
// tests/editor-lattice-pattern-boundary-emit.test.js's own "T50 -- which
// stroke width..." describe block (through the real, async
// `generatePattern`, not a hand-built `extent.edgeShrink`).
