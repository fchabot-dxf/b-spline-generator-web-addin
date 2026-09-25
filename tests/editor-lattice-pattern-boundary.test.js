/**
 * SE13 Slice 2 (T48) — computePattern's `extent.mode === 'boundary'`
 * branch, plus `_resolveExtent`'s matching branch. Scope, per the T48
 * dispatch (advisor's own ruling on SE13 open question 1): spans + grid-
 * cell-pre-filter only, uniform per-kind color exactly like Board mode
 * (`runs.stepLen` stays null — no parts, no omit/loose, no stored rolls).
 * Each row/column's own `insideSpans` (SE13 Slice 1, T47) becomes ONE
 * emitted segment per inside span — Ground-truth #2's own "multiple
 * inside-sub-spans per row/column" restructuring, verified directly
 * (a donut boundary's own row produces TWO rail segments, not one).
 *
 * Verification style matches this session's own established discipline:
 * the headline claim is "boundary mode with a RECTANGULAR boundary is
 * byte-identical to today's `mode:'rect'`" — the degenerate case every
 * other assertion needs to reduce to correctly. Circle-chord shortening
 * and tie-clipping are checked against independent closed-form/oracle
 * values, never the module's own math reused as its own check.
 */
import { describe, it, expect } from 'vitest';
import {
  computePattern, _resolveExtent, PATTERN_DEFAULTS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { shapeToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js';

function mockEl(type, attrs = {}) {
  return { type, attr: (name) => (name in attrs ? attrs[name] : undefined) };
}

function rectPrimitives(iMin, jMin, iMax, jMax) {
  const c = [[iMin, jMin], [iMax, jMin], [iMax, jMax], [iMin, jMax]];
  return c.map((p, k) => ({
    type: 'L',
    p0: { x: p[0], y: p[1] },
    p1: { x: c[(k + 1) % 4][0], y: c[(k + 1) % 4][1] },
  }));
}

describe('computePattern: boundary mode reduces to rect mode for a rectangular boundary', () => {
  // The boundary rect is deliberately PADDED one lattice unit beyond the
  // tested [iMin,jMin,iMax,jMax] box, not exactly equal to it. A scan line
  // exactly collinear with a boundary EDGE is a genuine, already-tested
  // degenerate case in SE13 Slice 1 (`insideSpans`' own parallel-line
  // guard, tests/editor-lattice-boundary.test.js's own "flat-edge-
  // collinear" case: both L segments sharing that edge report no
  // crossing) -- if the boundary's own edges sat exactly on iMin/jMin/
  // iMax/jMax, the OUTERMOST rail row and tie column would each spuriously
  // vanish, which would be re-testing Slice 1's own already-proven
  // half-open convention, not this slice's new clipping logic. Padding the
  // boundary out means every row/column in [iMin,iMax]x[jMin,jMax] sits
  // STRICTLY inside it, so `insideSpans` always returns the boundary's own
  // (wider) span, which `_clipToSpans` then narrows back down to exactly
  // [iMin,iMax] -- the real property under test: clipping to a boundary
  // that doesn't actually constrain anything must be a no-op.
  const iMin = 0, jMin = 0, iMax = 10, jMax = 8;
  const pad = 1;
  const PATTERN = {
    ...PATTERN_DEFAULTS,
    seed: 7,
    ties: { ...PATTERN_DEFAULTS.ties, density: 0.6 },
    nodes: { ends: true, crossings: true, railEnds: true },
  };

  it('segments + nodePoints are byte-identical to mode:\'rect\' over the same box', () => {
    const rectResult = computePattern(PATTERN, { extent: { iMin, jMin, iMax, jMax } });
    const boundaryResult = computePattern(PATTERN, {
      extent: {
        iMin, jMin, iMax, jMax, mode: 'boundary',
        primitives: rectPrimitives(iMin - pad, jMin - pad, iMax + pad, jMax + pad),
      },
    });
    expect(boundaryResult).toEqual(rectResult);
  });

  it('same reduction holds under orientation:\'vertical\' (proves the scan-line construction, not just the identity default)', () => {
    const vPattern = { ...PATTERN, orientation: 'vertical' };
    const rectResult = computePattern(vPattern, { extent: { iMin, jMin, iMax, jMax } });
    const boundaryResult = computePattern(vPattern, {
      extent: {
        iMin, jMin, iMax, jMax, mode: 'boundary',
        primitives: rectPrimitives(iMin - pad, jMin - pad, iMax + pad, jMax + pad),
      },
    });
    expect(boundaryResult).toEqual(rectResult);
  });

  it('end-to-end via _resolveExtent + shapeToPrimitives (a real <rect> element, world-space inches, spacing-scaled)', async () => {
    const spacing = PATTERN.spacing;
    const el = mockEl('rect', {
      x: String((iMin - pad) * spacing), y: String((jMin - pad) * spacing),
      width: String((iMax - iMin + 2 * pad) * spacing), height: String((jMax - jMin + 2 * pad) * spacing),
    });
    const worldPrimitives = await shapeToPrimitives(el);
    const resolved = _resolveExtent({}, { ...PATTERN, extent: { mode: 'boundary' } }, worldPrimitives);
    // _resolveExtent's own bbox pre-filter picks up the PADDED bounds
    // (its whole job is "which rows/columns to even consider" — the
    // padding itself is real information, not noise to discard).
    expect(resolved.iMin).toBe(iMin - pad);
    expect(resolved.jMin).toBe(jMin - pad);
    expect(resolved.iMax).toBe(iMax + pad);
    expect(resolved.jMax).toBe(jMax + pad);
    expect(resolved.primitives).toEqual(rectPrimitives(iMin - pad, jMin - pad, iMax + pad, jMax + pad));

    // Compare against rect-mode over the ORIGINAL (unpadded) box: since
    // the padded boundary doesn't constrain anything within it, every row/
    // column computePattern actually visits inside [iMin,iMax]x[jMin,jMax]
    // must still reduce to plain rect-mode's own output there.
    const boundaryResult = computePattern(PATTERN, { extent: { ...resolved, iMin, jMin, iMax, jMax } });
    const rectResult = computePattern(PATTERN, { extent: { iMin, jMin, iMax, jMax } });
    expect(boundaryResult).toEqual(rectResult);
  });
});

describe('computePattern: boundary mode, determinism', () => {
  it('same PATTERN + same boundary (including a non-rectangular one) -> byte-identical output across two calls', () => {
    const primitives = [{ type: 'CIRCLE', cx: 5, cy: 4, r: 4 }];
    const PATTERN = { ...PATTERN_DEFAULTS, seed: 11, rails: { every: 1, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 0.5 } };
    const extent = { iMin: 1, jMin: 0, iMax: 9, jMax: 8, mode: 'boundary', primitives };
    const a = computePattern(PATTERN, { extent });
    const b = computePattern(PATTERN, { extent });
    expect(a).toEqual(b);
  });
});

describe('computePattern: a circular boundary shortens rail rows near top/bottom (chords), exact against the circle\'s own equation', () => {
  const cx = 5, cy = 4, r = 4;
  const primitives = [{ type: 'CIRCLE', cx, cy, r }];
  const PATTERN = { ...PATTERN_DEFAULTS, rails: { every: 1, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 0 } };
  const extent = { iMin: 1, jMin: 0, iMax: 9, jMax: 8, mode: 'boundary', primitives };

  it('the center row spans the full diameter; a row 3 above center is a shorter, exact chord', () => {
    const { segments } = computePattern(PATTERN, { extent });
    const rails = segments.filter((s) => s.kind === 'rail');

    const centerRow = rails.find((s) => s.a.j === cy);
    expect(centerRow.b.i - centerRow.a.i).toBeCloseTo(2 * r, 9);

    const j = 1; // |j - cy| = 3
    const offRow = rails.find((s) => s.a.j === j);
    const expectedHalfChord = Math.sqrt(r * r - (j - cy) * (j - cy)); // independent oracle
    expect(offRow.a.i).toBeCloseTo(cx - expectedHalfChord, 9);
    expect(offRow.b.i).toBeCloseTo(cx + expectedHalfChord, 9);
    expect(offRow.b.i - offRow.a.i).toBeLessThan(centerRow.b.i - centerRow.a.i);
  });

  it('a row exactly tangent to the circle (j = jMin, the bottom) emits NO rail segment (zero-length span dropped, not a degenerate zero-width one)', () => {
    const { segments } = computePattern(PATTERN, { extent });
    const rails = segments.filter((s) => s.kind === 'rail');
    expect(rails.find((s) => s.a.j === 0)).toBeUndefined();
    expect(rails.find((s) => s.a.j === 8)).toBeUndefined();
  });
});

describe('computePattern: a concave/holed boundary produces MULTIPLE segments for one row (Ground-truth #2)', () => {
  it('a donut (outer r=10, inner hole r=4, same center) rail through the center emits exactly TWO rail segments', () => {
    const d = 'M -10 0 A 10 10 0 1 0 10 0 A 10 10 0 1 0 -10 0 Z M -4 0 A 4 4 0 1 0 4 0 A 4 4 0 1 0 -4 0 Z';
    // Hand-built to match shapeToPrimitives' own path output shape, tested
    // independently in tests/editor-lattice-boundary.test.js -- reused
    // here via the real function rather than re-typing the primitive list,
    // so this test also proves the two modules compose correctly end to end.
    return shapeToPrimitives(mockEl('path', { d })).then((primitives) => {
      const PATTERN = { ...PATTERN_DEFAULTS, rails: { every: 1, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 0 } };
      const extent = { iMin: -10, jMin: -10, iMax: 10, jMax: 10, mode: 'boundary', primitives };
      const { segments } = computePattern(PATTERN, { extent });
      const rowZero = segments.filter((s) => s.kind === 'rail' && s.a.j === 0);
      expect(rowZero).toHaveLength(2);
      const sorted = rowZero.slice().sort((a, b) => a.a.i - b.a.i);
      expect(sorted[0].a.i).toBeCloseTo(-10, 6);
      expect(sorted[0].b.i).toBeCloseTo(-4, 6);
      expect(sorted[1].a.i).toBeCloseTo(4, 6);
      expect(sorted[1].b.i).toBeCloseTo(10, 6);
    });
  });
});

describe('computePattern: ties are clipped to the boundary, not just rails', () => {
  it('a forced tie column near the circle\'s own edge is shortened to the inside span, not the raw drawn span', () => {
    const cx = 5, cy = 4, r = 4;
    const primitives = [{ type: 'CIRCLE', cx, cy, r }];
    const column = 2; // dx = 3 from center -> inside span in j is [cy-sqrt(7), cy+sqrt(7)]
    const jMin = 0, jMax = 8;
    const base = {
      ...PATTERN_DEFAULTS,
      seed: 99,
      rails: { every: 0, offset: 0 }, // no rails -- isolate ties
      ties: { density: 1, spanMin: 1, spanMax: 8, columns: [column], anchor: 'free', railSnapRows: 0 },
    };

    // The RAW (unclipped) draw for this exact seed/column, from rect mode
    // over the SAME jMin/jMax -- _tieSpanForColumn isn't exported, so the
    // raw span is read back out of a real computePattern call instead of
    // re-deriving its RNG math by hand.
    const rawResult = computePattern(base, { extent: { iMin: column, jMin, iMax: column, jMax } });
    const rawTie = rawResult.segments.find((s) => s.kind === 'tie');
    expect(rawTie).toBeDefined();
    const rawA = Math.min(rawTie.a.j, rawTie.b.j), rawB = Math.max(rawTie.a.j, rawTie.b.j);

    const expectedHalf = Math.sqrt(r * r - (cx - column) * (cx - column)); // independent oracle
    const insideLo = cy - expectedHalf, insideHi = cy + expectedHalf;

    const boundaryResult = computePattern(base, {
      extent: { iMin: column, jMin, iMax: column, jMax, mode: 'boundary', primitives },
    });
    const clippedTie = boundaryResult.segments.find((s) => s.kind === 'tie');

    // Sanity: the raw draw must actually straddle the boundary for this
    // test to prove anything (otherwise clipping would be a no-op here too).
    expect(rawA < insideLo || rawB > insideHi).toBe(true);

    expect(clippedTie).toBeDefined();
    const clipA = Math.min(clippedTie.a.j, clippedTie.b.j), clipB = Math.max(clippedTie.a.j, clippedTie.b.j);
    expect(clipA).toBeCloseTo(Math.max(rawA, insideLo), 9);
    expect(clipB).toBeCloseTo(Math.min(rawB, insideHi), 9);
  });
});

describe('_resolveExtent: boundary branch, degenerate case', () => {
  it('an empty primitive list (deleted/degenerate boundary element) resolves to an inverted, empty extent -- computePattern then emits nothing', () => {
    const resolved = _resolveExtent({}, { ...PATTERN_DEFAULTS, extent: { mode: 'boundary' } }, []);
    expect(resolved.iMax).toBeLessThan(resolved.iMin);
    const { segments, nodePoints } = computePattern(PATTERN_DEFAULTS, { extent: resolved });
    expect(segments).toEqual([]);
    expect(nodePoints).toEqual([]);
  });
});
