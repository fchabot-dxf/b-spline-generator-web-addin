/**
 * RAIL-SPACING (R6, engine only — panel UI is R7): `rails.mode:'spacing'` — rails laid out from the
 * BOUNDARY (anchor + rail-to-rail inches), not the grid. See editor-lattice-pattern.js's own
 * `_railRowsBySpacing` doc comment for the layout rule, and PATTERN_DEFAULTS.rails' own comment for
 * why `spacingCount` is a deliberately DIFFERENT field from the existing `rails.count` (a [min,max]
 * seeded range used by the unrelated 'count' mode).
 *
 * A wide, tall extent (jMin=0, jMax=40 lattice rows at the default P.spacing=0.25in -> a 10in-tall
 * boundary) gives plenty of room to see several rails without edge effects dominating every test.
 */
import { describe, it, expect } from 'vitest';
import { computePattern, PATTERN_DEFAULTS, freshPattern } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

const EXTENT = { iMin: 0, jMin: 0, iMax: 20, jMax: 40 }; // 10in tall at the default P.spacing=0.25

// Same tiny helper every other editor-lattice-pattern-*.test.js file already declares locally
// (tests/editor-lattice-pattern-ending.test.js etc.) — a rectangle exactly matching an extent, so
// 'boundary' mode (the Shape Lattice tool's own code path) clips every row to its own full width,
// making a boundary-mode run directly comparable to a board/rect-mode run over the SAME extent.
function rectPrimitives(iMin, jMin, iMax, jMax) {
  const c = [[iMin, jMin], [iMax, jMin], [iMax, jMax], [iMin, jMax]];
  return c.map((p, k) => ({
    type: 'L',
    p0: { x: p[0], y: p[1] },
    p1: { x: c[(k + 1) % 4][0], y: c[(k + 1) % 4][1] },
  }));
}

function railJs(result) {
  return [...new Set(result.segments.filter((s) => s.kind === 'rail').map((s) => s.a.j))].sort((a, b) => a - b);
}
function tieSegs(result) {
  return result.segments.filter((s) => s.kind === 'tie');
}
function gapsOf(rows) {
  return rows.slice(1).map((r, i) => +(r - rows[i]).toFixed(9));
}
function pattern(rails, ties) {
  return { ...PATTERN_DEFAULTS, rails: { ...PATTERN_DEFAULTS.rails, mode: 'spacing', ...rails }, ...(ties ? { ties: { ...PATTERN_DEFAULTS.ties, ...ties } } : {}) };
}

describe('PATTERN_DEFAULTS.rails — the new fields', () => {
  it('declares anchor/spacing/spacingCount alongside the existing every/count/offset, unchanged', () => {
    // Fred, confirmed: new-pattern defaults are anchor:'center', spacing: 1in.
    expect(PATTERN_DEFAULTS.rails.anchor).toBe('center');
    expect(PATTERN_DEFAULTS.rails.spacing).toBe(1);
    expect(PATTERN_DEFAULTS.rails.spacingCount).toBeNull();
    // R7 carry-over 1 (Fred, advisor review): the default MODE itself changed to 'spacing' AFTER this
    // R6 test was first written — see the dedicated describe block below for that.
    expect(PATTERN_DEFAULTS.rails.count).toEqual([6, 7]); // 'count' mode's OWN range is untouched
  });
});

describe('rails.mode:\'spacing\' — anchor + spacing (Fred\'s own case: a rail exactly on the boundary)', () => {
  it('anchor \'start\': the FIRST rail sits exactly on the boundary\'s start edge (jMin)', () => {
    const rows = railJs(computePattern(pattern({ anchor: 'start', spacing: 1 }), { extent: EXTENT }));
    expect(rows[0]).toBe(EXTENT.jMin);
    expect(rows.length).toBeGreaterThan(1);
  });

  it('anchor \'end\': the LAST rail sits exactly on the boundary\'s end edge (jMax)', () => {
    const rows = railJs(computePattern(pattern({ anchor: 'end', spacing: 1 }), { extent: EXTENT }));
    expect(rows[rows.length - 1]).toBe(EXTENT.jMax);
  });

  it('anchor \'center\': a rail sits exactly on the boundary\'s centre line', () => {
    const rows = railJs(computePattern(pattern({ anchor: 'center', spacing: 1 }), { extent: EXTENT }));
    expect(rows).toContain((EXTENT.jMin + EXTENT.jMax) / 2);
  });

  it('every generated gap is identical, and equals spacing/P.spacing in lattice units, for all three anchors', () => {
    for (const anchor of ['start', 'center', 'end']) {
      const rows = railJs(computePattern(pattern({ anchor, spacing: 1 }), { extent: EXTENT }));
      const gaps = gapsOf(rows);
      expect(new Set(gaps).size, anchor).toBe(1); // every gap identical
      expect(gaps[0], anchor).toBeCloseTo(1 / PATTERN_DEFAULTS.spacing, 9); // 1in / 0.25in = 4 lattice rows
    }
  });

  it('rails that would fall outside the boundary are dropped, never clamped or wrapped', () => {
    const rows = railJs(computePattern(pattern({ anchor: 'start', spacing: 1 }), { extent: EXTENT }));
    expect(Math.max(...rows)).toBeLessThanOrEqual(EXTENT.jMax);
    expect(Math.min(...rows)).toBeGreaterThanOrEqual(EXTENT.jMin);
  });

  it('OFF-GRID spacing (not a whole number of grid steps) is honoured exactly, no rounding', () => {
    // 0.3in spacing against a 0.25in grid step -> 1.2 lattice rows per gap, never rounds to 1 or 2.
    const rows = railJs(computePattern(pattern({ anchor: 'start', spacing: 0.3 }), { extent: EXTENT }));
    const gaps = gapsOf(rows);
    expect(gaps[0]).toBeCloseTo(0.3 / PATTERN_DEFAULTS.spacing, 9);
    expect(Number.isInteger(gaps[0])).toBe(false); // genuinely off-grid, not silently snapped
    expect(rows[0]).toBe(EXTENT.jMin); // the anchor itself is still exact
  });

  it('spacingCount limits to exactly N rails, from the anchor (start: first N; end: last N)', () => {
    const start = railJs(computePattern(pattern({ anchor: 'start', spacing: 1, spacingCount: 3 }), { extent: EXTENT }));
    expect(start.length).toBe(3);
    expect(start[0]).toBe(EXTENT.jMin);
    const end = railJs(computePattern(pattern({ anchor: 'end', spacing: 1, spacingCount: 3 }), { extent: EXTENT }));
    expect(end.length).toBe(3);
    expect(end[end.length - 1]).toBe(EXTENT.jMax);
  });

  it('spacingCount with anchor \'center\' keeps the centre row and is symmetric for an ODD count', () => {
    const rows = railJs(computePattern(pattern({ anchor: 'center', spacing: 1, spacingCount: 3 }), { extent: EXTENT }));
    const c = (EXTENT.jMin + EXTENT.jMax) / 2;
    expect(rows.length).toBe(3);
    expect(rows).toContain(c);
    expect(rows[0]).toBeCloseTo(2 * c - rows[2], 9); // symmetric about the centre
  });

  it('spacingCount with anchor \'center\' STRADDLES the centre for an EVEN count — Fred, confirmed: NO rail on the centre line', () => {
    const rows = railJs(computePattern(pattern({ anchor: 'center', spacing: 1, spacingCount: 4 }), { extent: EXTENT }));
    const c = (EXTENT.jMin + EXTENT.jMax) / 2;
    expect(rows.length).toBe(4);
    expect(rows).not.toContain(c);
    // symmetric pairs, matched from the OUTSIDE in on the ascending-sorted array (rows[0]<->rows[3] is
    // the outer pair, rows[1]<->rows[2] the inner pair) — each pair's own midpoint is exactly centre.
    expect(rows[0] + rows[3]).toBeCloseTo(2 * c, 9);
    expect(rows[1] + rows[2]).toBeCloseTo(2 * c, 9);
    const gaps = gapsOf(rows);
    expect(new Set(gaps.map((g) => +g.toFixed(9))).size).toBe(1); // still evenly spaced throughout
  });

  it('no spacingCount = fill the boundary (more rails than a small explicit count would give)', () => {
    const filled = railJs(computePattern(pattern({ anchor: 'start', spacing: 1 }), { extent: EXTENT }));
    const limited = railJs(computePattern(pattern({ anchor: 'start', spacing: 1, spacingCount: 2 }), { extent: EXTENT }));
    expect(filled.length).toBeGreaterThan(limited.length);
  });

  it('a degenerate boundary (jMax < jMin) or a non-positive spacing yields NO rails, never throws', () => {
    expect(railJs(computePattern(pattern({ anchor: 'start', spacing: 1 }), { extent: { iMin: 0, jMin: 5, iMax: 20, jMax: 2 } }))).toEqual([]);
    expect(() => computePattern(pattern({ anchor: 'start', spacing: 0 }), { extent: EXTENT })).not.toThrow();
    expect(railJs(computePattern(pattern({ anchor: 'start', spacing: 0 }), { extent: EXTENT }))).toEqual([]);
  });

  it('unseeded: two computePattern calls with the SAME inputs but different seeds are byte-identical', () => {
    const a = railJs(computePattern({ ...pattern({ anchor: 'start', spacing: 1 }), seed: 1 }, { extent: EXTENT }));
    const b = railJs(computePattern({ ...pattern({ anchor: 'start', spacing: 1 }), seed: 999999 }, { extent: EXTENT }));
    expect(a).toEqual(b);
  });

  it('both orientations: \'vertical\' lays out the SAME anchor+spacing rule on the SWAPPED canonical extent', () => {
    // orient() swaps i/j on the way IN (the extent's own iMin/iMax become the CANONICAL jMin/jMax for
    // 'vertical' before this engine ever runs) and back OUT on the way out — so a vertical run's own
    // rails, read back as COLUMNS (i), must match a HORIZONTAL run computed directly over the swapped
    // extent, not the ORIGINAL EXTENT (a different-sized canonical jMax would give a different count).
    const swapped = { iMin: EXTENT.jMin, jMin: EXTENT.iMin, iMax: EXTENT.jMax, jMax: EXTENT.iMax };
    const equivalentHoriz = computePattern(pattern({ anchor: 'start', spacing: 1 }), { extent: swapped });
    const vert = computePattern({ ...pattern({ anchor: 'start', spacing: 1 }), orientation: 'vertical' }, { extent: EXTENT });
    const equivalentRows = railJs(equivalentHoriz);
    const vertCols = [...new Set(vert.segments.filter((s) => s.kind === 'rail').map((s) => s.a.i))].sort((a, b) => a - b);
    expect(vertCols).toEqual(equivalentRows);
    expect(vertCols.length).toBeGreaterThan(1);
  });
});

describe('RAIL-SPACING does not disturb the pre-existing rails.mode values (ruling 5, migration)', () => {
  it('an old pattern with no rails.mode at all still defaults to \'every\' (unaffected by the new default fields)', () => {
    const oldStyle = { ...PATTERN_DEFAULTS, rails: { every: 3, offset: 1 } }; // pre-T56 shape: no `mode`, no `count`
    const rows = railJs(computePattern(oldStyle, { extent: EXTENT }));
    // every=3 offset=1 from jMin=0 -> rows 1,4,7,... (unchanged 'every' math, PATTERN_DEFAULTS' new
    // anchor/spacing/spacingCount fields are silently present but never read by this mode).
    expect(rows[0]).toBe(1);
    expect(gapsOf(rows)[0]).toBe(3);
  });

  it('an EXPLICIT rails.mode:\'count\' (no longer the default, still a real supported mode) is completely untouched', () => {
    const rows = railJs(computePattern({ ...PATTERN_DEFAULTS, rails: { ...PATTERN_DEFAULTS.rails, mode: 'count' }, seed: 42 }, { extent: EXTENT }));
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.length).toBeLessThanOrEqual(7);
  });

  it('rails.mode:\'every\' explicitly requested is also completely untouched', () => {
    const rows = railJs(computePattern({ ...PATTERN_DEFAULTS, rails: { ...PATTERN_DEFAULTS.rails, mode: 'every', every: 2, offset: 0 } }, { extent: EXTENT }));
    expect(rows).toEqual(Array.from({ length: (EXTENT.jMax - EXTENT.jMin) / 2 + 1 }, (_, k) => EXTENT.jMin + k * 2));
  });
});

describe('ruling 6 — ties/nodes attach correctly to OFF-GRID rails', () => {
  const OFFGRID = { anchor: 'start', spacing: 0.3 }; // 1.2 lattice rows/gap — never an integer

  it('the DEFAULT tie path (ties.mode:\'count\', span.mode:\'rails\', already index-based) bridges adjacent off-grid rails exactly', () => {
    // oneEnded:0 -- isolate rail-to-rail bridging; a one-ended tie's free end is DELIBERATELY not on a
    // rail (its own separate mechanic, T67 AMEND 3+4) and is not what this test checks.
    const result = computePattern(pattern(OFFGRID, { minSpacing: 0, oneEnded: 0 }), { extent: EXTENT });
    const rows = railJs(result);
    const ties = tieSegs(result);
    expect(ties.length).toBeGreaterThan(0);
    for (const t of ties) {
      expect(rows, `tie jStart ${t.a.j} must be an actual rail row`).toContain(t.a.j);
      expect(rows, `tie jEnd ${t.b.j} must be an actual rail row`).toContain(t.b.j);
      const iStart = rows.indexOf(t.a.j), iEnd = rows.indexOf(t.b.j);
      expect(Math.abs(iEnd - iStart)).toBe(1); // span.rails:1 default -> exactly one gap apart
    }
  });

  it('the OLDER ties.mode:\'density\' + anchor:\'rails\' path also bridges off-grid rails (the _tieSpanForColumn fix)', () => {
    const result = computePattern(
      pattern(OFFGRID, { mode: 'density', anchor: 'rails', density: 1, spanMin: 1, spanMax: 1, minSpacing: 0 }),
      { extent: EXTENT },
    );
    const rows = railJs(result);
    const ties = tieSegs(result);
    expect(ties.length).toBeGreaterThan(0); // BEFORE the fix this was 0: an integer spanMin/spanMax=1
    // could never match a 1.2-lattice-row coordinate gap, so every column silently produced no tie.
    for (const t of ties) {
      expect(rows).toContain(t.a.j);
      expect(rows).toContain(t.b.j);
    }
  });

  it('nodes (rail ends + crossings) still form on off-grid rails', () => {
    const result = computePattern(
      pattern(OFFGRID, { minSpacing: 0, oneEnded: 0 }),
      { extent: EXTENT },
    );
    expect(result.nodePoints.length).toBeGreaterThan(0);
    const railRowSet = new Set(railJs(result));
    // Every node point's own j must land on a REAL rail row (rail-end nodes) or is a genuine tie/rail
    // crossing (also necessarily coincident with a rail row, by construction) -- either way, off-grid
    // j values are never rounded away.
    for (const p of result.nodePoints) expect([...railRowSet].some((j) => Math.abs(j - p.j) < 1e-9)).toBe(true);
  });

  it('TIE-GAP (ties.minSpacing) still holds regardless of rails.mode: no two ties sharing rows sit closer than the gap', () => {
    // T80 item 1: this used to assert "a big gap gives FEWER ties" -- that
    // was the bug itself (spacing dropped ties after the count was chosen).
    // Count mode now refills from other valid columns, so what must hold is
    // the spacing rule, checked directly.
    const gapIn = 5;
    const ties = tieSegs(computePattern(pattern(OFFGRID, { minSpacing: gapIn }), { extent: EXTENT }));
    expect(ties.length).toBeGreaterThan(0);
    const minCells = gapIn / 0.25; // default P.spacing (see EXTENT above)
    for (let x = 0; x < ties.length; x++) {
      for (let y = x + 1; y < ties.length; y++) {
        const a = ties[x], b = ties[y];
        const overlap = Math.min(a.a.j, a.b.j) <= Math.max(b.a.j, b.b.j) && Math.min(b.a.j, b.b.j) <= Math.max(a.a.j, a.b.j);
        if (overlap) expect(Math.abs(a.a.i - b.a.i)).toBeGreaterThanOrEqual(minCells - 1e-9);
      }
    }
  });
});

describe('advisor AMEND (Fred, confirmed): off-grid stays unrounded; every tie end lies EXACTLY on its rail', () => {
  // Sweeps anchors x sizes x orientations x board/rect vs. boundary (Shape Lattice) — the amendment's
  // own ask: "tie endpoints == rail coordinate (tolerance 1e-9) across anchors/sizes/orientations, box
  // + Shape Lattice." A spacing that is DELIBERATELY not a whole number of grid steps in every case
  // (0.3in / 0.25in default P.spacing = 1.2 lattice rows/gap) — the exact scenario "off-grid is fine"
  // protects, and the one this amendment's own test asks for by name.
  const SIZES = [{ iMin: 0, jMin: 0, iMax: 20, jMax: 40 }, { iMin: 0, jMin: 0, iMax: 14, jMax: 18 }, { iMin: 0, jMin: 0, iMax: 30, jMax: 61 }];

  // orient() (editor-lattice.js) swaps {i,j} -> {i:j, j:i} for 'vertical' on the way OUT — a canonical
  // rail (constant j) surfaces as constant `.i` in the OUTPUT segments, and a tie's bridging coordinate
  // (canonical j) surfaces as the tie's own `.i`. 'horizontal' is the identity, so `axis` is simply
  // which OUTPUT field ('i' or 'j') carries what was canonical-j, per orientation.
  function assertTiesExactlyOnRails(result, label, orientation = 'horizontal') {
    const axis = orientation === 'vertical' ? 'i' : 'j';
    const rows = [...new Set(result.segments.filter((s) => s.kind === 'rail').map((s) => s.a[axis]))];
    const ties = result.segments.filter((s) => s.kind === 'tie');
    expect(ties.length, label).toBeGreaterThan(0);
    for (const t of ties) {
      // A one-ended tie's free end is deliberately NOT on a rail (its own separate mechanic) — only
      // ends actually marked `anchored`-shape (both ends for a rail-to-rail bridge) are checked here;
      // this sweep sets oneEnded:0, so every generated tie is rail-to-rail and BOTH ends must match.
      const nearestA = Math.min(...rows.map((j) => Math.abs(j - t.a[axis])));
      const nearestB = Math.min(...rows.map((j) => Math.abs(j - t.b[axis])));
      expect(nearestA, `${label}: tie start ${t.a[axis]}`).toBeLessThan(1e-9);
      expect(nearestB, `${label}: tie end ${t.b[axis]}`).toBeLessThan(1e-9);
    }
  }

  it('board/rect mode: every anchor x size x orientation', () => {
    for (const anchor of ['start', 'center', 'end']) {
      for (const extent of SIZES) {
        for (const orientation of ['horizontal', 'vertical']) {
          const P = { ...pattern({ anchor, spacing: 0.3 }, { minSpacing: 0, oneEnded: 0 }), orientation };
          assertTiesExactlyOnRails(computePattern(P, { extent }), `${anchor}/${orientation}/${extent.iMax}x${extent.jMax}`, orientation);
        }
      }
    }
  });

  it('boundary mode (Shape Lattice): the same sweep, clipped through insideSpans, not board/rect\'s shortcut', () => {
    for (const anchor of ['start', 'center', 'end']) {
      for (const extent of SIZES) {
        const primitives = rectPrimitives(extent.iMin, extent.jMin, extent.iMax, extent.jMax);
        const P = pattern({ anchor, spacing: 0.3 }, { minSpacing: 0, oneEnded: 0 });
        assertTiesExactlyOnRails(
          computePattern(P, { extent: { ...extent, mode: 'boundary', primitives } }),
          `boundary/${anchor}/${extent.iMax}x${extent.jMax}`,
        );
      }
    }
  });

  it('the OLDER ties.mode:\'density\' path is included in the same guarantee', () => {
    const P = pattern({ anchor: 'start', spacing: 0.3 }, { mode: 'density', anchor: 'rails', density: 1, spanMin: 1, spanMax: 1, minSpacing: 0 });
    assertTiesExactlyOnRails(computePattern(P, { extent: EXTENT }), 'density-mode');
  });
});

describe('R7 carry-over 1 — a brand-new pattern defaults to rails.mode:\'spacing\' (Fred, advisor review)', () => {
  it('PATTERN_DEFAULTS.rails.mode is \'spacing\' (anchor center, spacing 1in) — Fred\'s own defaults finally show', () => {
    expect(PATTERN_DEFAULTS.rails.mode).toBe('spacing');
    expect(PATTERN_DEFAULTS.rails.anchor).toBe('center');
    expect(PATTERN_DEFAULTS.rails.spacing).toBe(1);
  });

  it('a genuinely brand-new pattern (no rails key at all) resolves through \'spacing\', not \'count\'', () => {
    const fresh = { ...PATTERN_DEFAULTS };
    delete fresh.rails;
    const rows = railJs(computePattern({ ...fresh, seed: 7 }, { extent: EXTENT }));
    // 'spacing' mode is UNSEEDED (no draw at all) -> changing the seed changes NOTHING, unlike 'count'
    // mode's own seeded row count, which is exactly the property that distinguishes them here.
    const rowsOtherSeed = railJs(computePattern({ ...fresh, seed: 999 }, { extent: EXTENT }));
    expect(rows).toEqual(rowsOtherSeed);
    expect(new Set(gapsOf(rows)).size).toBe(1); // evenly spaced throughout, 'spacing' mode's own signature
  });

  it('an old saved pattern with an explicit rails.mode:\'count\' (T56-era) is byte-identical, unaffected by the new default', () => {
    const oldStyle = { ...PATTERN_DEFAULTS, rails: { mode: 'count', count: [6, 7], every: 2, offset: 0 } };
    const rows = railJs(computePattern({ ...oldStyle, seed: 42 }, { extent: EXTENT }));
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.length).toBeLessThanOrEqual(7);
  });

  it('an old saved pattern with no mode key at all (pre-T56) still resolves to \'every\', never the new default', () => {
    const oldStyle = { ...PATTERN_DEFAULTS, rails: { every: 3, offset: 1 } };
    const rows = railJs(computePattern(oldStyle, { extent: EXTENT }));
    expect(rows[0]).toBe(1);
    expect(gapsOf(rows)[0]).toBe(3);
  });
});

describe('R7 carry-over 2 — freshPattern: a NEW pattern\'s grid step comes from the editor grid, not the lattice-side default', () => {
  it('with an editor grid set, a fresh pattern\'s own spacing matches it, not PATTERN_DEFAULTS.spacing', () => {
    const editor = { _grid: { visible: true, snap: true, spacing: 0.5 } };
    const p = freshPattern(editor);
    expect(p.spacing).toBe(0.5);
    expect(p.spacing).not.toBe(PATTERN_DEFAULTS.spacing);
  });

  it('with no editor grid available, falls back to PATTERN_DEFAULTS.spacing, never throws', () => {
    expect(freshPattern(undefined).spacing).toBe(PATTERN_DEFAULTS.spacing);
    expect(freshPattern({}).spacing).toBe(PATTERN_DEFAULTS.spacing);
    expect(freshPattern({ _grid: {} }).spacing).toBe(PATTERN_DEFAULTS.spacing);
  });

  it('every OTHER field is untouched — freshPattern is a real clone of PATTERN_DEFAULTS, not a partial object', () => {
    const p = freshPattern({ _grid: { spacing: 0.5 } });
    expect(p.rails).toEqual(PATTERN_DEFAULTS.rails);
    expect(p.ties).toEqual(PATTERN_DEFAULTS.ties);
    expect(p).not.toBe(PATTERN_DEFAULTS); // a real clone, not the same object (mutation-safe)
  });

  it('a pattern created via freshPattern generates evenly-spaced rails at the STAMPED grid step, not the default one', () => {
    const p = freshPattern({ _grid: { spacing: 0.5 } });
    const rows = railJs(computePattern({ ...p, rails: { ...p.rails, anchor: 'start', spacing: 1 } }, { extent: EXTENT }));
    // 1in spacing / 0.5in grid step (the STAMPED value, not PATTERN_DEFAULTS.spacing=0.25) -> 2 lattice
    // rows/gap, not 4.
    expect(gapsOf(rows)[0]).toBe(2);
  });
});
