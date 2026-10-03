/**
 * H23 item 72 BRICK ENGINE -- bond ZONES (advisor, ref_brick_bond_zones.jpg: "patterns of
 * different width"). bricksFillShape/opts.zones -> layouts/bond.js's own zone resolution: a list
 * of horizontal bands, each its own bond kind (running/stack/soldier) and size (rows|heightIn),
 * default = a single running zone (byte-identical to the pre-zones behaviour). Also covers the
 * "a few odd samples at a low rate" sample-pool split (samples.js).
 */
import { describe, it, expect } from 'vitest';
import { bricksFillShape } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/fill-shape.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { assignSamples } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/samples.js';
import { bondLayout } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/layouts/bond.js';

const SET = BRICK_SETS[0];
const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

function bbox(polygon) {
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

describe('bond zones', () => {
  it('no zones given == a single running zone (unchanged default behaviour)', () => {
    const board = rect(9, 12);
    const implicit = bricksFillShape(board, null, { set: SET, seed: 3 });
    const explicit = bricksFillShape(board, null, { set: SET, seed: 3, zones: [{ bond: 'running' }] });
    expect(JSON.stringify(implicit)).toEqual(JSON.stringify(explicit));
  });

  it('soldier zones at top/bottom produce bricks rotated 90deg (L/H swapped) with no stagger', () => {
    const board = rect(9, 12);
    const { cells } = bondLayout(board, SET, [
      { bond: 'soldier', rows: 3 }, { bond: 'running' }, { bond: 'soldier', rows: 3 },
    ]);
    const topCourseCells = cells.filter((c) => c.courseIndex === 0);
    expect(topCourseCells.length).toBeGreaterThan(0);
    for (const c of topCourseCells) {
      const { w, h } = bbox(c.polygon);
      expect(w).toBeCloseTo(SET.brickHeightIn, 5);
      expect(h).toBeCloseTo(SET.brickLengthIn, 5);
    }
    // no stagger within a soldier course: every cell's cx should land on the same colPitch grid
    // (no half-pitch offset between consecutive courses of the SAME bond kind) -- verified by
    // comparing course 0 and course 1 (both soldier, since rows:3) x-positions: identical set.
    const course1 = cells.filter((c) => c.courseIndex === 1).map((c) => Math.round(c.cx * 1000));
    const course0 = topCourseCells.map((c) => Math.round(c.cx * 1000));
    expect(new Set(course1)).toEqual(new Set(course0));
  });

  it('a middle running zone keeps the half-brick stagger between its own consecutive courses', () => {
    const board = rect(9, 12);
    const { cells } = bondLayout(board, SET, [
      { bond: 'soldier', rows: 2 }, { bond: 'running', rows: 2 }, { bond: 'soldier', rows: 2 },
    ]);
    const runningCourses = [...new Set(cells.filter((c) => c.courseIndex >= 2 && c.courseIndex < 4).map((c) => c.courseIndex))].sort();
    expect(runningCourses.length).toBe(2);
    const xsA = cells.filter((c) => c.courseIndex === runningCourses[0]).map((c) => c.cx).sort((a, b) => a - b);
    const xsB = cells.filter((c) => c.courseIndex === runningCourses[1]).map((c) => c.cx).sort((a, b) => a - b);
    const colPitch = SET.brickLengthIn + SET.grout.widthIn;
    const minDelta = Math.min(...xsB.map((x) => Math.min(...xsA.map((y) => Math.abs(x - y)))));
    expect(minDelta).toBeCloseTo(colPitch / 2, 2);
  });

  it('a `rows`-sized zone produces exactly that many courses', () => {
    const board = rect(20, 20); // tall board so the fill zone has plenty of room
    const { cells } = bondLayout(board, SET, [{ bond: 'soldier', rows: 4 }, { bond: 'running' }]);
    const soldierCourses = new Set(cells.filter((c) => {
      const { w } = bbox(c.polygon);
      return Math.abs(w - SET.brickHeightIn) < 1e-6;
    }).map((c) => c.courseIndex));
    expect(soldierCourses.size).toBe(4);
    expect(Math.max(...soldierCourses)).toBe(3);
  });

  it('an unsized (fill) zone covers the remaining board height', () => {
    const board = rect(9, 12);
    const { cells } = bondLayout(board, SET, [{ bond: 'soldier', rows: 2 }, { bond: 'running' }]);
    const maxY = Math.max(...cells.map((c) => c.cy));
    expect(maxY).toBeGreaterThan(10); // the fill zone reaches well down the 12in board
  });

  it('odd-flagged samples are drawn at ~oddSampleRate, not the uniform per-sample rate', () => {
    const board = rect(9, 30); // many cells for a stable empirical rate
    const { cells } = bondLayout(board, SET);
    const assigned = assignSamples(cells, SET, 11);
    const oddIds = new Set(SET.samples.filter((s) => s.odd).map((s) => s.id));
    let oddCount = 0;
    for (const v of assigned.values()) if (oddIds.has(v.sampleId)) oddCount++;
    const rate = oddCount / assigned.size;
    expect(rate).toBeGreaterThan(SET.oddSampleRate * 0.5);
    expect(rate).toBeLessThan(SET.oddSampleRate * 1.5);
  });

  it('oddSampleRate=0 (or a set with no odd samples) never draws an odd sample', () => {
    const board = rect(9, 20);
    const { cells } = bondLayout(board, SET);
    const noOddSet = { ...SET, oddSampleRate: 0 };
    const assigned = assignSamples(cells, noOddSet, 11);
    const oddIds = new Set(SET.samples.filter((s) => s.odd).map((s) => s.id));
    for (const v of assigned.values()) expect(oddIds.has(v.sampleId)).toBe(false);
  });
});
