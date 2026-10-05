/**
 * T86-27 correction (seat C 02, advisor 45 ruling A, 2026-10-05): a TILE's row 0 is the wall's BOTTOM course for BOTH
 * tile inputs -- customBond's courses and accentCuts' rows -- declared once as library.js COURSE_ROW_ORIGIN. Measured
 * before: customBond counted from the TOP and accentCuts from the BOTTOM, so which bond course a tile row marked
 * flipped with the wall's course-count parity (a 3.4 in wall marked the half-brick courses, a 3.8 in wall the whole
 * ones). The built-in-as-tile pin (bricks-custom-bond) is re-checked here on an odd AND an even course count.
 */
import { describe, it, expect } from 'vitest';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, COURSE_ROW_ORIGIN } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const SET = BRICK_SETS[0], SCALE = 1 / SET.brickLengthIn;
const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const lay = (h, extra) => generateBricks({ boardOutline: rect(4, h), set: SET, seed: 3, scale: SCALE, suppression: 0, clumping: 0, zones: [{ pattern: 'stretcher' }], ...extra }).bricks;
const width = (b) => Math.max(...b.polygon.map((p) => p.x)) - Math.min(...b.polygon.map((p) => p.x));
const top = (b) => Math.min(...b.polygon.map((p) => p.y));
/** the bricks grouped by course, BOTTOM course first */
function coursesBottomUp(bricks) {
  const rows = new Map();
  for (const b of bricks) { const y = Math.round(top(b) * 1000); if (!rows.has(y)) rows.set(y, []); rows.get(y).push(b); }
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r);
}
// row 0 = whole bricks, row 1 = half bricks; the accent tile marks row 0 only
const BOND = { courses: [{ pieces: [1], offset: 0 }, { pieces: [0.5], offset: 0 }] };
const CUTS = { unit: 0.5, tile: { rows: 2, cols: 2, cells: [[true, true], [false, false]] } };

describe('one course-row origin for every tile input (T86-27 correction)', () => {
  it('is declared once: the bottom course', () => expect(COURSE_ROW_ORIGIN).toBe('bottom'));
  for (const h of [3.0, 3.4, 3.8]) {
    it(`a ${h} in wall: the bottom course is the tile's row 0 (whole bricks) and carries row 0's marks`, () => {
      const rows = coursesBottomUp(lay(h, { customBond: BOND, accentCuts: CUTS }));
      expect(rows.length).toBeGreaterThan(8);
      rows.forEach((r, k) => {
        const whole = k % 2 === 0;
        const widest = Math.max(...r.map(width));
        expect(widest > 0.6, `course ${k} from the bottom: widest piece ${widest.toFixed(3)}`).toBe(whole);
        expect(r.every((b) => b.accentMarked === whole), `course ${k} from the bottom: marks`).toBe(true);
      });
    });
  }
  // the built-in stretcher staggers its odd courses counted from the TOP (unchanged, every saved wall); a tile counted
  // from the bottom therefore matches it as written on an odd course count, and with its two courses swapped on an even one
  const STRETCHER = [{ pieces: [1], offset: 0 }, { pieces: [1], offset: 0.5 }];
  for (const h of [3.4, 3.8]) {
    it(`the built-in stretcher written as a tile lays the same bricks (pin) on a ${h} in wall`, () => {
      const builtin = lay(h, {});
      const n = coursesBottomUp(builtin).length;
      const courses = n % 2 === 1 ? STRETCHER : [...STRETCHER].reverse();
      expect(lay(h, { customBond: { courses } }).map((b) => b.polygon)).toEqual(builtin.map((b) => b.polygon));
    });
  }
  it('the pin covers both parities', () => {
    expect(new Set([3.4, 3.8].map((h) => coursesBottomUp(lay(h, {})).length % 2))).toEqual(new Set([0, 1]));
  });

  // T86-26 + T86-27 composed (seat C 02, measured): accentCuts' cell is `unit` of a BRICK's pitch (its declared contract),
  // so a custom piece of p bricks spans p / unit cells -- before, the cell was sized from each piece's own length, which
  // cut a 2-brick piece in two and shifted the marks onto the half pieces
  it('accentCuts on a custom bond: a piece of p bricks = p / unit cells (a 2-brick piece marked whole, its halves not)', () => {
    const board = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 0.3 }, { x: 0, y: 0.3 }]; // one course
    const b = generateBricks({ boardOutline: board, set: SET, seed: 3, scale: SCALE, suppression: 0, clumping: 0, zones: [{ pattern: 'stretcher' }],
      customBond: { courses: [{ pieces: [2, 0.5, 0.5], offset: 0 }] },
      accentCuts: { unit: 0.5, tile: { rows: 1, cols: 6, cells: [[true, true, true, true, false, false]] } } }).bricks;
    const pitch = SET.brickLengthIn * SCALE + SET.grout.widthIn;
    const pieces = b.map((k) => ({ x0: Math.min(...k.polygon.map((p) => p.x)), w: width(k), m: k.accentMarked })).sort((p, q) => p.x0 - q.x0)
      .filter((p) => p.x0 + p.w < 6 - 1e-6); // whole pieces (the board edge clips the last)
    expect(pieces.map((p) => [Math.round((p.w + SET.grout.widthIn) / pitch * 2) / 2, p.m])).toEqual([[2, true], [0.5, false], [0.5, false], [2, true], [0.5, false]]);
  });
});

