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
    // anchor:'free' on purpose (T30: this is also the DEFAULT now, but
    // that's incidental to why it's chosen here): with rails every 2 rows
    // and spanMin..spanMax=1..3, 'rails' anchor usually has exactly ONE
    // valid candidate end-row regardless of the seed's draw (2 is the
    // only in-range multiple of the rail spacing), which would make this
    // specific pattern's span seed-INdependent as a side effect of the
    // rail spacing, not of the code being wrong. 'free' anchor's span is
    // a direct continuous function of the seed with no such
    // discretization artifact, so it's the fair way to test this claim.
    // T30's own railSnapRows:1 default is still active here (spread from
    // PATTERN_DEFAULTS.ties) and can nudge either seed's raw span onto a
    // nearby rail — confirmed this doesn't collapse the two seeds' spans
    // to the same value for these specific seeds (1, 2); not a structural
    // guarantee, just verified to still hold after T30's change.
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
  it("anchor:'rails' (strict mode, explicit — 'free' is the default since T30) — every generated tie starts AND ends exactly on a rail row", () => {
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

// T30 (Fred: "don't limit it to rails, but do snap to them") — anchor:'free'
// is now the default, with a free end snapping onto a rail row within
// railSnapRows (default 1). Each case below is built from a RAW (pre-snap,
// railSnapRows:0) span discovered for a fixed seed+column+spanMin/spanMax —
// not asserted blind against the RNG — then re-run with a rail placed at an
// exact, deliberate distance from that raw span's end and railSnapRows
// restored, so every assertion traces to a concrete, reproducible number
// rather than "whatever the seed happens to produce this time".
describe("computePattern: ties.anchor 'free' + railSnapRows (T30)", () => {
  // A taller extent than the file's own EXTENT (jMax:8) — these cases need
  // room for a rail several rows past a span that itself needs room to
  // exist; jMax:8 would clip the raw spans below before railSnapRows ever
  // enters the picture. Scoped to this block only; every other describe
  // above keeps using the file's shared (shorter) EXTENT.
  const EXTENT_TALL = { iMin: 0, jMin: 0, jMax: 20, iMax: 10 };

  // seed:4, col:3, spanMin:1/spanMax:5 -> raw span {a.j:15, b.j:18} with
  // railSnapRows:0 (verified directly against computePattern before writing
  // these assertions, not assumed).
  const RAW_SEED = 4;
  const RAW_COLUMN = 3;
  const RAW = { aJ: 15, bJ: 18 };

  function makePattern({ railOffset, spanMin = 1, spanMax = 5, railSnapRows = 1 }) {
    return {
      ...PATTERN_DEFAULTS,
      seed: RAW_SEED,
      rails: { every: 1000, offset: railOffset }, // every:1000 within a 20-row extent -> exactly one rail row, at `railOffset`
      ties: { ...PATTERN_DEFAULTS.ties, density: 0, columns: [RAW_COLUMN], anchor: 'free', spanMin, spanMax, railSnapRows },
    };
  }

  it('sanity: railSnapRows:0 reproduces the RAW span this whole block is built from', () => {
    const pattern = makePattern({ railOffset: 1000, railSnapRows: 0 }); // rail far outside the extent — irrelevant either way with snapping off
    const tie = computePattern(pattern, { extent: EXTENT_TALL }).segments.find(s => s.kind === 'tie');
    expect(tie.a.j).toBe(RAW.aJ);
    expect(tie.b.j).toBe(RAW.bJ);
  });

  it('an end exactly 1 row from a rail snaps onto it (default railSnapRows:1)', () => {
    const pattern = makePattern({ railOffset: RAW.bJ + 1 }); // rail at 19, one row past the raw end (18)
    const tie = computePattern(pattern, { extent: EXTENT_TALL }).segments.find(s => s.kind === 'tie');
    expect(tie.a.j).toBe(RAW.aJ);     // the OTHER end, nowhere near a rail, is untouched
    expect(tie.b.j).toBe(RAW.bJ + 1); // snapped onto the rail
  });

  it('an end 2 rows from a rail stays free (default railSnapRows:1 does not reach that far)', () => {
    const pattern = makePattern({ railOffset: RAW.bJ + 2 }); // rail at 20, two rows past the raw end
    const tie = computePattern(pattern, { extent: EXTENT_TALL }).segments.find(s => s.kind === 'tie');
    expect(tie.a.j).toBe(RAW.aJ);
    expect(tie.b.j).toBe(RAW.bJ); // unchanged — too far to snap
  });

  it('railSnapRows:0 turns snapping off entirely, even for a rail 1 row away', () => {
    const pattern = makePattern({ railOffset: RAW.bJ + 1, railSnapRows: 0 });
    const tie = computePattern(pattern, { extent: EXTENT_TALL }).segments.find(s => s.kind === 'tie');
    expect(tie.b.j).toBe(RAW.bJ); // unchanged — snapping explicitly off
  });

  it('span limits are respected after snapping: a rail 1 row away is NOT used if snapping onto it would leave [spanMin, spanMax]', () => {
    // spanMin:3/spanMax:3 (strict — the raw span itself, from a DIFFERENT
    // discovered seed, is exactly 3) — any snap changes the span away from
    // 3, so it must be rejected even though the rail sits right next door.
    const pattern = {
      ...PATTERN_DEFAULTS, seed: 1,
      rails: { every: 1000, offset: 9 }, // one row past this seed's raw b.j (8) — verified via computePattern before writing this test
      ties: { ...PATTERN_DEFAULTS.ties, density: 0, columns: [3], anchor: 'free', spanMin: 3, spanMax: 3, railSnapRows: 1 },
    };
    const tie = computePattern(pattern, { extent: EXTENT_TALL }).segments.find(s => s.kind === 'tie');
    expect(tie.a.j).toBe(5);
    expect(tie.b.j).toBe(8); // NOT snapped to 9 — that would make span:4, outside [3,3]
    expect(Math.abs(tie.b.j - tie.a.j)).toBe(3);
  });

  it("anchor:'rails' (strict mode) ignores railSnapRows entirely — already exact, nothing to snap", () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 11, rails: { every: 2, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 1, anchor: 'rails', spanMin: 1, spanMax: 3, railSnapRows: 1 } };
    const { segments } = computePattern(pattern, { extent: EXTENT });
    const railRows = new Set(segments.filter(s => s.kind === 'rail').map(s => s.a.j));
    const ties = segments.filter(s => s.kind === 'tie');
    expect(ties.length).toBeGreaterThan(0);
    for (const t of ties) {
      expect(railRows.has(t.a.j)).toBe(true);
      expect(railRows.has(t.b.j)).toBe(true);
    }
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

/**
 * SE7h ADD-ON 2 (Fred: "add a check box for nodes at rail end") — its own
 * step, separate from nodes.crossings (which deliberately skips a rail's
 * own two endpoints). Default false so every existing saved pattern is
 * unaffected; when true, every rail gets a node at each of its two ends.
 */
describe('computePattern: nodes.railEnds (SE7h add-on 2)', () => {
  it('railEnds:false (default) places no nodes at rail ends', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, rails: { every: 2, offset: 0 },
      ties: { ...PATTERN_DEFAULTS.ties, density: 0 },
      nodes: { ends: false, crossings: false, railEnds: false },
    };
    const { segments, nodePoints } = computePattern(pattern, { extent: EXTENT });
    expect(segments.filter(s => s.kind === 'rail').length).toBeGreaterThan(0); // non-vacuous: rails DO exist
    expect(nodePoints).toHaveLength(0);
  });

  it('railEnds:true places exactly 2 nodes per rail, at its own a/b endpoints', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, rails: { every: 2, offset: 0 },
      ties: { ...PATTERN_DEFAULTS.ties, density: 0 },
      nodes: { ends: false, crossings: false, railEnds: true },
    };
    const { segments, nodePoints } = computePattern(pattern, { extent: EXTENT });
    const rails = segments.filter(s => s.kind === 'rail');
    expect(rails.length).toBeGreaterThan(0);
    const keys = new Set(nodePoints.map(p => `${p.i},${p.j}`));
    for (const r of rails) {
      expect(keys.has(`${r.a.i},${r.a.j}`)).toBe(true);
      expect(keys.has(`${r.b.i},${r.b.j}`)).toBe(true);
    }
    expect(nodePoints).toHaveLength(rails.length * 2);
  });

  it('railEnds:true works under orientation:"vertical" too — nodes land at each vertical rail\'s top/bottom', () => {
    const extent = { iMin: 0, iMax: 6, jMin: 0, jMax: 8 };
    const pattern = {
      ...PATTERN_DEFAULTS, orientation: 'vertical', rails: { every: 2, offset: 0 },
      ties: { ...PATTERN_DEFAULTS.ties, density: 0 },
      nodes: { ends: false, crossings: false, railEnds: true },
    };
    const { segments, nodePoints } = computePattern(pattern, { extent });
    const rails = segments.filter(s => s.kind === 'rail');
    expect(rails.length).toBeGreaterThan(0);
    for (const r of rails) expect(r.a.i).toBe(r.b.i); // sanity: these really are vertical rails
    const keys = new Set(nodePoints.map(p => `${p.i},${p.j}`));
    for (const r of rails) {
      expect(keys.has(`${r.a.i},${extent.jMin}`)).toBe(true);
      expect(keys.has(`${r.a.i},${extent.jMax}`)).toBe(true);
    }
    expect(nodePoints).toHaveLength(rails.length * 2);
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

/**
 * SE7h (Fred: "invert rails and ties so rails are vertical") —
 * PATTERN.orientation conjugates the WHOLE computation through orient()
 * (editor-lattice.js): the extent is transposed in, the SAME rail-row/
 * tie-span/crossing math runs unchanged, every output point is
 * transposed back out. No second copy of the algorithm exists for
 * 'vertical' — these tests are the direct proof of that claim, plus the
 * dispatch's own two verify lines.
 */
describe('computePattern: orientation (SE7h)', () => {
  // A SQUARE extent so orienting the BOUNDS is a no-op numerically
  // (iMin===jMin, iMax===jMax) — isolates "does the OUTPUT get swapped"
  // from "did the extent transpose correctly", which the 7x9 test below
  // covers separately.
  const SQUARE_EXTENT = { iMin: 0, jMin: 0, iMax: 8, jMax: 8 };

  it('vertical output = horizontal output with i/j swapped, on a square extent (the dispatch\'s own verify line)', () => {
    const base = { ...PATTERN_DEFAULTS, seed: 55, ties: { ...PATTERN_DEFAULTS.ties, density: 0.6 } };
    const horizontal = computePattern({ ...base, orientation: 'horizontal' }, { extent: SQUARE_EXTENT });
    const vertical = computePattern({ ...base, orientation: 'vertical' }, { extent: SQUARE_EXTENT });

    expect(vertical.segments).toHaveLength(horizontal.segments.length);
    for (let k = 0; k < horizontal.segments.length; k++) {
      expect(vertical.segments[k].kind).toBe(horizontal.segments[k].kind);
      expect(vertical.segments[k].a).toEqual({ i: horizontal.segments[k].a.j, j: horizontal.segments[k].a.i });
      expect(vertical.segments[k].b).toEqual({ i: horizontal.segments[k].b.j, j: horizontal.segments[k].b.i });
    }
    expect(vertical.nodePoints).toHaveLength(horizontal.nodePoints.length);
    for (let k = 0; k < horizontal.nodePoints.length; k++) {
      expect(vertical.nodePoints[k]).toEqual({ i: horizontal.nodePoints[k].j, j: horizontal.nodePoints[k].i });
    }
  });

  it('non-vacuous: horizontal and vertical outputs actually DIFFER (rules out orient() silently being a no-op)', () => {
    const base = { ...PATTERN_DEFAULTS, seed: 55, rails: { every: 2, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 0 } };
    const horizontal = computePattern({ ...base, orientation: 'horizontal' }, { extent: SQUARE_EXTENT });
    const vertical = computePattern({ ...base, orientation: 'vertical' }, { extent: SQUARE_EXTENT });
    expect(vertical.segments).not.toEqual(horizontal.segments);
  });

  it('on a 7x9 board, rails run along the 9" axis when vertical (the dispatch\'s own other verify line)', () => {
    // spacing=1 assumed by the caller — lattice units ARE inches here, so
    // a 7"x9" board is iMin..iMax = 0..6 (7 wide), jMin..jMax = 0..8 (9 tall).
    const extent = { iMin: 0, iMax: 6, jMin: 0, jMax: 8 };
    const { segments } = computePattern(
      { ...PATTERN_DEFAULTS, orientation: 'vertical', rails: { every: 2, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 0 } },
      { extent }
    );
    const rails = segments.filter((s) => s.kind === 'rail');
    expect(rails.length).toBeGreaterThan(0); // non-vacuous: there IS something to check
    for (const r of rails) {
      expect(r.a.i).toBe(r.b.i); // a straight VERTICAL line — constant real-i
      // ...spanning the FULL 9" axis (jMin..jMax), not a short segment.
      expect([r.a.j, r.b.j].sort((x, y) => x - y)).toEqual([extent.jMin, extent.jMax]);
    }
    // The rails themselves are spread across the 7" WIDTH (real-i), every
    // 2 lattice units per PATTERN.rails.every — 4 rails at i=0,2,4,6.
    expect(rails.map((r) => r.a.i).sort((a, b) => a - b)).toEqual([0, 2, 4, 6]);
  });

  it('an old saved pattern with no `orientation` key at all reads as horizontal (no migration needed)', () => {
    const base = { ...PATTERN_DEFAULTS, seed: 77, ties: { ...PATTERN_DEFAULTS.ties, density: 0.5 } };
    const legacy = { ...base };
    delete legacy.orientation;
    expect(legacy.orientation).toBeUndefined(); // sanity: the field really is absent

    const legacyOutput = computePattern(legacy, { extent: SQUARE_EXTENT });
    const explicitHorizontal = computePattern({ ...base, orientation: 'horizontal' }, { extent: SQUARE_EXTENT });
    expect(legacyOutput).toEqual(explicitHorizontal);
  });
});
