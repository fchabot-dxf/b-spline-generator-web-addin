/**
 * SE7b slice 1 — computePattern: the declared Lattice PATTERN -> plain
 * lattice-coordinate segment/node data. Pure function, no DOM/editor
 * object — see SE7B-PATTERN-GENERATOR-DESIGN.md and
 * editor/editor-lattice-pattern.js's own header for the design.
 */
import { describe, it, expect } from 'vitest';
import { computePattern, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

const EXTENT = { iMin: 0, jMin: 0, jMax: 8, iMax: 10 };

describe('computePattern: determinism', () => {
  it('same PATTERN (including seed) -> byte-identical output across two calls', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 7 };
    const a = computePattern(pattern, { extent: EXTENT });
    const b = computePattern(pattern, { extent: EXTENT });
    expect(a).toEqual(b);
  });

  it('different seed -> different ties, but IDENTICAL rails (rails are deterministic from every/offset only)', () => {
    const a = computePattern({ ...PATTERN_DEFAULTS, seed: 1 }, { extent: EXTENT });
    const b = computePattern({ ...PATTERN_DEFAULTS, seed: 2 }, { extent: EXTENT });
    const railsA = a.segments.filter(s => s.kind === 'rail');
    const railsB = b.segments.filter(s => s.kind === 'rail');
    expect(railsA).toEqual(railsB);

    const tiesA = a.segments.filter(s => s.kind === 'tie');
    const tiesB = b.segments.filter(s => s.kind === 'tie');
    expect(tiesA).not.toEqual(tiesB); // different seed must actually move something
  });
});

describe('computePattern: rails', () => {
  it('every=2, offset=0 on a 9-row (0..8) extent produces exactly 5 rails, each spanning the full width', () => {
    const { segments } = computePattern(
      { ...PATTERN_DEFAULTS, ties: { ...PATTERN_DEFAULTS.ties, density: 0 } },
      { extent: EXTENT }
    );
    const rails = segments.filter(s => s.kind === 'rail');
    expect(rails).toHaveLength(5); // j = 0,2,4,6,8
    expect(rails.map(r => r.a.j)).toEqual([0, 2, 4, 6, 8]);
    for (const r of rails) {
      expect(r.a.i).toBe(EXTENT.iMin);
      expect(r.b.i).toBe(EXTENT.iMax);
      expect(r.a.j).toBe(r.b.j); // horizontal — constant row
    }
  });

  it('offset=1 shifts which rows are rails', () => {
    const { segments } = computePattern(
      { ...PATTERN_DEFAULTS, rails: { every: 2, offset: 1 }, ties: { ...PATTERN_DEFAULTS.ties, density: 0 } },
      { extent: EXTENT }
    );
    const rows = segments.filter(s => s.kind === 'rail').map(r => r.a.j);
    expect(rows).toEqual([1, 3, 5, 7]);
  });

  it('every<=0 is a degenerate guard — no infinite loop, no rails', () => {
    expect(() => computePattern(
      { ...PATTERN_DEFAULTS, rails: { every: 0, offset: 0 } },
      { extent: EXTENT }
    )).not.toThrow();
    const { segments } = computePattern(
      { ...PATTERN_DEFAULTS, rails: { every: 0, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 0 } },
      { extent: EXTENT }
    );
    expect(segments.filter(s => s.kind === 'rail')).toHaveLength(0);
  });
});

describe('computePattern: ties.columns (hand-picked)', () => {
  it('explicit columns produce a tie in EXACTLY those columns, bypassing density entirely (density:0 still ties)', () => {
    const { segments } = computePattern(
      { ...PATTERN_DEFAULTS, ties: { ...PATTERN_DEFAULTS.ties, density: 0, columns: [2, 5, 9] } },
      { extent: EXTENT }
    );
    const tieColumns = segments.filter(s => s.kind === 'tie').map(s => s.a.i).sort((a, b) => a - b);
    expect(tieColumns).toEqual([2, 5, 9]);
  });

  it('column SELECTION is seed-independent when explicit, but SPAN for those columns still legitimately draws from the seed', () => {
    // Correction to the design doc's own test-list wording (SE7B-PATTERN-
    // GENERATOR-DESIGN.md §6 said explicit columns "bypass lcgPoints
    // entirely" — on implementing it, that's the wrong behavior: hand-
    // picking WHICH columns get a tie is a separate decision from how
    // long each one is, and there's no reason a reroll shouldn't still be
    // able to vary hand-picked ties' spans. Corrected here, not silently
    // left inconsistent with the shipped code — see WORK-LOG.
    // anchor:'free' (not the default 'rails') on purpose: with rails
    // every 2 rows and spanMin..spanMax=1..3, 'rails' anchor usually has
    // exactly ONE valid candidate end-row regardless of the seed's draw
    // (2 is the only in-range multiple of the rail spacing), which would
    // make this specific pattern's span seed-INdependent as a side effect
    // of the rail spacing, not of the code being wrong. 'free' anchor's
    // span is a direct continuous function of the seed with no such
    // discretization artifact, so it's the fair way to test this claim.
    const patternA = { ...PATTERN_DEFAULTS, seed: 1, ties: { ...PATTERN_DEFAULTS.ties, density: 0, columns: [3], anchor: 'free', spanMin: 1, spanMax: 5 } };
    const patternB = { ...PATTERN_DEFAULTS, seed: 2, ties: { ...PATTERN_DEFAULTS.ties, density: 0, columns: [3], anchor: 'free', spanMin: 1, spanMax: 5 } };
    const a = computePattern(patternA, { extent: EXTENT }).segments.find(s => s.kind === 'tie');
    const b = computePattern(patternB, { extent: EXTENT }).segments.find(s => s.kind === 'tie');
    expect(a.a.i).toBe(3);
    expect(b.a.i).toBe(3); // same column both times — selection didn't move
    // at least one endpoint differs between the two seeds' span choice
    const same = a.a.j === b.a.j && a.b.j === b.b.j;
    expect(same).toBe(false);
  });
});

describe('computePattern: ties.anchor', () => {
  it("anchor:'rails' (default) — every generated tie starts AND ends exactly on a rail row", () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 11, rails: { every: 2, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 1, anchor: 'rails', spanMin: 1, spanMax: 3 } };
    const { segments } = computePattern(pattern, { extent: EXTENT });
    const railRows = new Set(segments.filter(s => s.kind === 'rail').map(s => s.a.j));
    const ties = segments.filter(s => s.kind === 'tie');
    expect(ties.length).toBeGreaterThan(0); // density:1 must actually produce ties to test against
    for (const t of ties) {
      expect(railRows.has(t.a.j)).toBe(true);
      expect(railRows.has(t.b.j)).toBe(true);
      const span = Math.abs(t.b.j - t.a.j);
      expect(span).toBeGreaterThanOrEqual(1);
      expect(span).toBeLessThanOrEqual(3);
    }
  });

  it("anchor:'free' — span length respects spanMin/spanMax and stays within jMin..jMax, without requiring rail rows", () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 11, rails: { every: 2, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 1, anchor: 'free', spanMin: 1, spanMax: 3 } };
    const { segments } = computePattern(pattern, { extent: EXTENT });
    const ties = segments.filter(s => s.kind === 'tie');
    expect(ties.length).toBeGreaterThan(0);
    for (const t of ties) {
      expect(t.a.i).toBe(t.b.i); // vertical — constant column
      const span = t.b.j - t.a.j;
      expect(span).toBeGreaterThanOrEqual(1);
      expect(span).toBeLessThanOrEqual(3);
      expect(t.a.j).toBeGreaterThanOrEqual(EXTENT.jMin);
      expect(t.b.j).toBeLessThanOrEqual(EXTENT.jMax);
    }
  });

  it("anchor:'rails' with no rails at all produces no ties (nothing to bridge between) rather than throwing", () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 5, rails: { every: 1000, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 1, anchor: 'rails' } };
    expect(() => computePattern(pattern, { extent: EXTENT })).not.toThrow();
    const { segments } = computePattern(pattern, { extent: EXTENT });
    expect(segments.filter(s => s.kind === 'tie')).toHaveLength(0);
  });
});

describe('computePattern: nodes', () => {
  it('nodes.ends places a node at both endpoints of every generated tie', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 3, ties: { ...PATTERN_DEFAULTS.ties, density: 1, columns: [4] }, nodes: { ends: true, crossings: false } };
    const { segments, nodePoints } = computePattern(pattern, { extent: EXTENT });
    const tie = segments.find(s => s.kind === 'tie');
    const keys = new Set(nodePoints.map(p => `${p.i},${p.j}`));
    expect(keys.has(`${tie.a.i},${tie.a.j}`)).toBe(true);
    expect(keys.has(`${tie.b.i},${tie.b.j}`)).toBe(true);
  });

  it('nodes.ends:false places no tie-end nodes', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 3, ties: { ...PATTERN_DEFAULTS.ties, density: 1, columns: [4] }, nodes: { ends: false, crossings: false } };
    const { nodePoints } = computePattern(pattern, { extent: EXTENT });
    expect(nodePoints).toHaveLength(0);
  });

  it('nodes.crossings places a node where a rail and a tie actually cross, and NOT at a rail\'s own boundary endpoints', () => {
    // A tie anchored to rails necessarily crosses every rail row it
    // spans through, including any rail rows strictly between its start
    // and end — force a wide span so there's a genuine in-between crossing.
    const pattern = {
      ...PATTERN_DEFAULTS, seed: 9,
      rails: { every: 1, offset: 0 }, // rails at every row: 0..8
      ties: { density: 0, columns: [5], anchor: 'free', spanMin: 4, spanMax: 4 },
      nodes: { ends: false, crossings: true },
    };
    const { segments, nodePoints } = computePattern(pattern, { extent: EXTENT });
    const tie = segments.find(s => s.kind === 'tie');
    expect(tie).toBeDefined();
    const midJ = tie.a.j + 2; // a rail row strictly inside the tie's span
    const keys = new Set(nodePoints.map(p => `${p.i},${p.j}`));
    expect(keys.has(`${tie.a.i},${midJ}`)).toBe(true);
    // the rail's own boundary endpoints (far from column 5) must NOT
    // have been added as spurious "crossing" nodes
    expect(keys.has(`${EXTENT.iMin},${midJ}`)).toBe(false);
    expect(keys.has(`${EXTENT.iMax},${midJ}`)).toBe(false);
  });
});

describe('computePattern: occupied skipping', () => {
  it('skips a rail whose start cell is in `occupied`', () => {
    const pattern = { ...PATTERN_DEFAULTS, rails: { every: 2, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 0 } };
    const occupied = new Set([`${EXTENT.iMin},4,rail`]);
    const { segments } = computePattern(pattern, { extent: EXTENT, occupied });
    const rows = segments.filter(s => s.kind === 'rail').map(s => s.a.j);
    expect(rows).not.toContain(4);
    expect(rows).toEqual([0, 2, 6, 8]); // every OTHER rail still present
  });

  it('skips a tie whose start cell is in `occupied`, without affecting other columns', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 4, ties: { ...PATTERN_DEFAULTS.ties, density: 1, columns: [2, 5] } };
    const first = computePattern(pattern, { extent: EXTENT });
    const tieAt2 = first.segments.find(s => s.kind === 'tie' && s.a.i === 2);
    expect(tieAt2).toBeDefined();

    const occupied = new Set([`2,${tieAt2.a.j},tie`]);
    const { segments } = computePattern(pattern, { extent: EXTENT, occupied });
    const tieColumns = segments.filter(s => s.kind === 'tie').map(s => s.a.i);
    expect(tieColumns).not.toContain(2);
    expect(tieColumns).toContain(5);
  });

  it('skips a node whose cell is in `occupied`', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 3, ties: { ...PATTERN_DEFAULTS.ties, density: 1, columns: [4] }, nodes: { ends: true, crossings: false } };
    const first = computePattern(pattern, { extent: EXTENT });
    const tie = first.segments.find(s => s.kind === 'tie');
    const occupied = new Set([`${tie.a.i},${tie.a.j},node`]);
    const { nodePoints } = computePattern(pattern, { extent: EXTENT, occupied });
    const keys = new Set(nodePoints.map(p => `${p.i},${p.j}`));
    expect(keys.has(`${tie.a.i},${tie.a.j}`)).toBe(false);
    expect(keys.has(`${tie.b.i},${tie.b.j}`)).toBe(true); // the OTHER end is unaffected
  });
});

describe('computePattern: input contract', () => {
  it('throws a clear error when opts.extent is missing', () => {
    expect(() => computePattern(PATTERN_DEFAULTS, {})).toThrow(/extent/);
  });
});
