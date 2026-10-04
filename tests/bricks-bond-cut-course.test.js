/**
 * T86 item 15 (Fred, shots/fred/empty_course_top.png: "empty line of brick, can it be filled with
 * half bricks"): bondLayout's own course stack used to end wherever the declared course pitch
 * happened to land, leaving a genuine empty strip between the last course's own top edge and the
 * board's real top whenever the pitch didn't divide the available height evenly -- `clipPolygonToBoard`
 * only ever shrinks a cell, it can't grow one to reach further than its own declared rectangle, so
 * nothing was ever generated to cover that strip. Declared rule: a residual strip >= a quarter brick
 * gets one CUT course (same pattern/bond/stagger as the course below, just a shorter height); a
 * narrower strip stays open (reads as a wider joint against the board's own edge).
 */
import { describe, it, expect } from 'vitest';
import { bondLayout } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/layouts/bond.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

const SET = BRICK_SETS[0]; // Red brick
const { brickHeightIn: H, grout } = SET;
const J = grout.widthIn;
const N_WHOLE_COURSES = 3;
// an EXPLICITLY sized zone (a fixed row count, same as a real Fred-declared zone, or a Frame band's
// own course planning) -- the scenario the bug actually needs: a single unsized zone's own
// `Math.ceil(share/pitch)` row count already over-provisions by construction (always >= the true
// board height), so it incidentally covers this gap today; an explicit row count has no such
// safety net, which is exactly why the bug surfaced for Fred in the first place.
const SIZED_ZONE = [{ pattern: 'stretcher', rows: N_WHOLE_COURSES }];

// A rectangular board exactly `N_WHOLE_COURSES` courses tall, plus a residual strip of
// `fraction * H` on top -- the precise scenario the declared rule is about.
function rectBoardWithResidual(fraction) {
  const width = 6;
  const height = N_WHOLE_COURSES * (H + J) + fraction * H;
  return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
}

// A board whose top edge is a circular arc (apex above the springing points) instead of a flat
// line -- same N whole courses' worth of straight sides, then an arched top reaching `apexFraction *
// H` higher than the springing points at its own peak. Tests that the cut course's own per-cell
// clipping still behaves (shorter cells near the springing points, taller near the apex), not a
// flat-topped special case.
function archBoardWithApex(apexFraction) {
  const width = 6, springY = N_WHOLE_COURSES * (H + J);
  const apexY = springY + apexFraction * H;
  const r = (width / 2) ** 2 / (2 * (apexY - springY)) + (apexY - springY) / 2; // circle through both springing points and the apex
  const cy = springY + (apexY - springY) - r;
  const pts = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: springY }];
  const STEPS = 24;
  for (let i = 0; i <= STEPS; i++) {
    const x = width - (width * i) / STEPS;
    const dx = x - width / 2;
    const y = cy + Math.sqrt(Math.max(0, r * r - dx * dx));
    pts.push({ x, y });
  }
  pts.push({ x: 0, y: springY });
  return pts;
}

function maxCellY(cells) {
  return Math.max(...cells.map((c) => Math.max(...c.polygon.map((p) => p.y))));
}
function totalOverlapArea(cells) {
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const inter = polygonIntersection(cells[i].polygon, cells[j].polygon);
      if (inter.length >= 3) total += Math.abs(signedArea(inter));
    }
  }
  return total;
}

describe('bondLayout (T86 item 15): the last course reaches the board\'s own top edge, via one cut course', () => {
  it.each([0.5, 0.3])('straight top, residual = %s x brickHeightIn: a cut course fills it, reaching the board\'s real top', (fraction) => {
    const board = rectBoardWithResidual(fraction);
    const maxY = Math.max(...board.map((p) => p.y));
    const { cells } = bondLayout(board, SET, SIZED_ZONE);
    expect(cells.length).toBeGreaterThan(0);
    expect(maxCellY(cells)).toBeCloseTo(maxY, 6);
    expect(totalOverlapArea(cells)).toBeLessThan(1e-6);
  });

  it('straight top, residual = 0.2 x brickHeightIn (below the quarter-brick floor): stays open, no sliver cell', () => {
    const board = rectBoardWithResidual(0.2);
    const maxY = Math.max(...board.map((p) => p.y));
    const { cells } = bondLayout(board, SET, SIZED_ZONE);
    expect(cells.length).toBeGreaterThan(0);
    // the top of the topmost REAL course sits one full pitch below maxY -- nothing was generated to
    // claim the last 0.2 x H, so the highest cell falls meaningfully short of the board's own top.
    expect(maxCellY(cells)).toBeLessThan(maxY - 0.1 * H);
  });

  it.each([0.6, 0.3])('arched top, apex = %s x brickHeightIn above the springing line: no crash, no overlap, cut-course cells present near the apex', (apexFraction) => {
    const board = archBoardWithApex(apexFraction);
    const { cells } = bondLayout(board, SET, SIZED_ZONE);
    expect(cells.length).toBeGreaterThan(0);
    expect(totalOverlapArea(cells)).toBeLessThan(1e-6);
    const springY = N_WHOLE_COURSES * (H + J);
    // SOME cell must reach meaningfully above the last whole course's own top edge (springY) -- i.e.
    // the cut course (clipped by the arch) is actually contributing area, not just attempted and
    // dropped as degenerate everywhere.
    expect(maxCellY(cells)).toBeGreaterThan(springY + 0.1 * H);
  });
});
