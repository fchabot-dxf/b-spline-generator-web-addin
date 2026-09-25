/**
 * T56 (Fred: "your usual lattice is much denser than what I need... I
 * want 6-7 rails and 8-10 ties") — `rails.mode:'count'` / `ties.mode:
 * 'count'`, the new default. Declares the intent (a count range) rather
 * than tuning a probability — the advisor's own measurement of the OLD
 * density-mode controls found no density value that reliably lands a
 * target count.
 *
 * T56 AMEND (Fred, having VIEWED the advisor's own rendered options and
 * picked "B" — 7 rails, 13 SHORT-stub ties — as fine): widened
 * `ties.count` to [8,13]; the tie SPAN default is `span.mode:'cells'`
 * (today's ORIGINAL short-stub behavior, spanMin/spanMax grid cells,
 * snapped toward a nearby rail), NOT rail-to-rail bridging — my own
 * first guess at the default, before Fred actually saw the rendered
 * options. `span.mode:'rails'` (every tie bridges adjacent rails
 * exactly, ends always land ON a rail row) is kept as a real, declared
 * ALTERNATIVE, not removed.
 */
import { describe, it, expect } from 'vitest';
import { computePattern, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

const EXTENT = { iMin: 0, jMin: 0, iMax: 12, jMax: 30 }; // a tall board — plenty of rows/columns for 6-7 rails / 8-13 ties

function railRows(result) {
  return [...new Set(result.segments.filter((s) => s.kind === 'rail').map((s) => s.a.j))].sort((a, b) => a - b);
}
function tieSegs(result) {
  return result.segments.filter((s) => s.kind === 'tie');
}

describe('computePattern: rails.mode/ties.mode default to \'count\' (T56)', () => {
  it('PATTERN_DEFAULTS declares the dispatched ranges and the CELLS span default (Fred\'s own amend)', () => {
    expect(PATTERN_DEFAULTS.rails.mode).toBe('count');
    expect(PATTERN_DEFAULTS.rails.count).toEqual([6, 7]);
    expect(PATTERN_DEFAULTS.ties.mode).toBe('count');
    expect(PATTERN_DEFAULTS.ties.count).toEqual([8, 13]);
    expect(PATTERN_DEFAULTS.ties.span.mode).toBe('cells');
    expect(PATTERN_DEFAULTS.ties.span.rails).toBe(1); // declared for when span.mode:'rails' is selected
  });

  it('50 seeds: rail count is always in [6,7], evenly spread (first/last row at the extent\'s own edges)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const result = computePattern({ ...PATTERN_DEFAULTS, seed }, { extent: EXTENT });
      const rows = railRows(result);
      expect(rows.length).toBeGreaterThanOrEqual(6);
      expect(rows.length).toBeLessThanOrEqual(7);
      expect(rows[0]).toBe(EXTENT.jMin);
      expect(rows[rows.length - 1]).toBe(EXTENT.jMax);
    }
  });

  it('50 seeds: tie count is always in [8,13]', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const result = computePattern({ ...PATTERN_DEFAULTS, seed }, { extent: EXTENT });
      const ties = tieSegs(result);
      expect(ties.length).toBeGreaterThanOrEqual(8);
      expect(ties.length).toBeLessThanOrEqual(13);
    }
  });

  it('50 seeds: every default (cells-mode) tie\'s own span is spanMin..spanMax grid cells (a short stub, per Fred\'s own pick)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const result = computePattern({ ...PATTERN_DEFAULTS, seed }, { extent: EXTENT });
      for (const tie of tieSegs(result)) {
        const span = Math.abs(tie.b.j - tie.a.j);
        expect(span).toBeGreaterThanOrEqual(PATTERN_DEFAULTS.ties.spanMin);
        expect(span).toBeLessThanOrEqual(PATTERN_DEFAULTS.ties.spanMax);
      }
    }
  });

  it('50 seeds: no two ties share a column (distinct slots, per the dispatch\'s own "spread them")', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const result = computePattern({ ...PATTERN_DEFAULTS, seed }, { extent: EXTENT });
      const columns = tieSegs(result).map((t) => t.a.i);
      expect(new Set(columns).size).toBe(columns.length);
    }
  });

  it('holds under orientation:\'vertical\' too (rails run the OTHER axis, same count guarantees)', () => {
    for (const seed of [1, 2, 3, 17, 42]) {
      const result = computePattern({ ...PATTERN_DEFAULTS, orientation: 'vertical', seed }, { extent: EXTENT });
      const rails = result.segments.filter((s) => s.kind === 'rail');
      const ties = result.segments.filter((s) => s.kind === 'tie');
      // Vertical: rails run along j at a fixed i (a.i===b.i); count is
      // over DISTINCT i values now, not j.
      const railIs = new Set(rails.map((r) => r.a.i));
      expect(railIs.size).toBeGreaterThanOrEqual(6);
      expect(railIs.size).toBeLessThanOrEqual(7);
      expect(ties.length).toBeGreaterThanOrEqual(8);
      expect(ties.length).toBeLessThanOrEqual(13);
    }
  });
});

describe('computePattern: ties.span.mode:\'rails\' (a real, declared ALTERNATIVE, not the default)', () => {
  const railsSpanTies = (overrides = {}) => ({
    ...PATTERN_DEFAULTS.ties, span: { mode: 'rails', rails: 1 }, ...overrides,
  });

  it('50 seeds: every tie starts AND ends exactly on a real rail row (bridges, never a floating stub)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const result = computePattern({ ...PATTERN_DEFAULTS, seed, ties: railsSpanTies() }, { extent: EXTENT });
      const rows = new Set(railRows(result));
      for (const tie of tieSegs(result)) {
        expect(rows.has(tie.a.j)).toBe(true);
        expect(rows.has(tie.b.j)).toBe(true);
        expect(Math.abs(tie.b.j - tie.a.j)).toBeGreaterThan(0);
      }
    }
  });

  it('50 seeds with maxRailGaps:2: BOTH gap sizes (1 and 2) actually occur across the population', () => {
    // T56 self-caught bug (see WORK-LOG): the column's own SELECTION
    // score and its GAP-SIZE draw must use DIFFERENT seeds, or the
    // lowest-scored (= earliest-selected) columns would systematically
    // also get the lowest gap-size draws — invisible when maxRailGaps:1
    // (gap size is constant regardless of the draw), so this test
    // exercises the ONE setting where that bug would actually show up.
    const seen = new Set();
    for (let seed = 1; seed <= 50; seed++) {
      const result = computePattern(
        { ...PATTERN_DEFAULTS, seed, ties: railsSpanTies({ maxRailGaps: 2 }) },
        { extent: EXTENT }
      );
      const rows = railRows(result);
      for (const tie of tieSegs(result)) {
        const gapSize = rows.indexOf(tie.b.j) - rows.indexOf(tie.a.j);
        seen.add(gapSize);
      }
    }
    expect(seen.has(1)).toBe(true);
    expect(seen.has(2)).toBe(true);
  });
});

describe('computePattern: boundary mode places <= count ("place what fits")', () => {
  function rectPrimitives(iMin, jMin, iMax, jMax) {
    const c = [[iMin, jMin], [iMax, jMin], [iMax, jMax], [iMin, jMax]];
    return c.map((p, k) => ({
      type: 'L',
      p0: { x: p[0], y: p[1] },
      p1: { x: c[(k + 1) % 4][0], y: c[(k + 1) % 4][1] },
    }));
  }

  it('a boundary narrower than the extent clips out some evenly-spread candidate rows, never exceeding [6,7] rails / [8,13] ties', () => {
    const boundary = {
      mode: 'boundary',
      iMin: EXTENT.iMin, jMin: EXTENT.jMin, iMax: EXTENT.iMax, jMax: EXTENT.jMax,
      primitives: rectPrimitives(EXTENT.iMin, 10, EXTENT.iMax, 20),
    };
    for (let seed = 1; seed <= 20; seed++) {
      const result = computePattern({ ...PATTERN_DEFAULTS, seed }, { extent: boundary });
      const rows = railRows(result);
      expect(rows.length).toBeLessThanOrEqual(7);
      for (const j of rows) {
        expect(j).toBeGreaterThanOrEqual(10);
        expect(j).toBeLessThanOrEqual(20);
      }
      const ties = tieSegs(result);
      expect(ties.length).toBeLessThanOrEqual(13);
      for (const tie of ties) {
        expect(Math.min(tie.a.j, tie.b.j)).toBeGreaterThanOrEqual(10);
        expect(Math.max(tie.a.j, tie.b.j)).toBeLessThanOrEqual(20);
      }
    }
  });

  it('nothing throws when the boundary leaves at most one candidate rail row (cells-mode ties don\'t need 2 rails to exist at all)', () => {
    const boundary = {
      mode: 'boundary',
      iMin: EXTENT.iMin, jMin: EXTENT.jMin, iMax: EXTENT.iMax, jMax: EXTENT.jMax,
      primitives: rectPrimitives(EXTENT.iMin, 0, EXTENT.iMax, 3),
    };
    for (let seed = 1; seed <= 10; seed++) {
      expect(() => computePattern({ ...PATTERN_DEFAULTS, seed }, { extent: boundary })).not.toThrow();
      const result = computePattern({ ...PATTERN_DEFAULTS, seed }, { extent: boundary });
      const ties = tieSegs(result);
      expect(ties.length).toBeLessThanOrEqual(13);
      for (const tie of ties) {
        expect(Math.min(tie.a.j, tie.b.j)).toBeGreaterThanOrEqual(0);
        expect(Math.max(tie.a.j, tie.b.j)).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('computePattern: mode:\'every\'/\'density\' remain real, working alternatives', () => {
  it('rails.mode:\'every\' still gives the exact fixed-stride rows, ignoring count entirely', () => {
    const result = computePattern(
      { ...PATTERN_DEFAULTS, rails: { mode: 'every', every: 3, offset: 0, count: [6, 7] } },
      { extent: EXTENT }
    );
    expect(railRows(result)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
  });

  it('ties.mode:\'density\' still gives the original free-anchor/density mechanism, ignoring count entirely', () => {
    // A WIDER extent (30 columns, not EXTENT's own 12) so density:1
    // forcing a tie on every column clearly exceeds even the top of the
    // declared count range (13) — not a coincidental off-by-one match.
    const wideExtent = { ...EXTENT, iMax: 30 };
    const result = computePattern(
      {
        ...PATTERN_DEFAULTS,
        rails: { mode: 'every', every: 5, offset: 0 },
        ties: { ...PATTERN_DEFAULTS.ties, mode: 'density', density: 1, anchor: 'rails', spanMin: 5, spanMax: 5, count: [8, 10] },
      },
      { extent: wideExtent }
    );
    // density:1, anchor:'rails' forces a tie on EVERY column where a
    // rail-pair 5 rows apart exists — many more than the count range
    // would ever allow, proving count is genuinely unread here.
    expect(tieSegs(result).length).toBeGreaterThan(13);
  });
});

describe('computePattern: an existing saved pattern (no `mode` key) keeps its OLD implicit behavior', () => {
  it('rails: {every,offset} with no mode key reads as \'every\', not the new \'count\' default', () => {
    const oldSavedRails = { every: 4, offset: 1 }; // exactly what a pre-T56 saved pattern's own rails object looked like
    const result = computePattern({ ...PATTERN_DEFAULTS, rails: oldSavedRails }, { extent: EXTENT });
    expect(railRows(result)).toEqual([1, 5, 9, 13, 17, 21, 25, 29]);
  });

  it('ties: {density,...} with no mode key reads as \'density\', not the new \'count\' default', () => {
    const oldSavedTies = { density: 0, spanMin: 1, spanMax: 3, columns: null, anchor: 'free', railSnapRows: 1 };
    const result = computePattern(
      { ...PATTERN_DEFAULTS, rails: { every: 5, offset: 0 }, ties: oldSavedTies },
      { extent: EXTENT }
    );
    expect(tieSegs(result).length).toBe(0); // density:0 correctly suppresses every tie, proving density mode is live
  });

  it('no `rails`/`ties` key at all (a genuinely brand-new pattern) gets the NEW count default', () => {
    const fresh = { ...PATTERN_DEFAULTS };
    delete fresh.rails;
    delete fresh.ties;
    const result = computePattern({ ...fresh, seed: 5 }, { extent: EXTENT });
    const rows = railRows(result);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.length).toBeLessThanOrEqual(7);
  });
});
