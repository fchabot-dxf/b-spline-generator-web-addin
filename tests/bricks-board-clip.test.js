/**
 * contour-bands.js clipPiecesToBoard's fast path (seat E, 2026-10-10): a piece clear of the board's outline with a vertex
 * inside is kept as built WITHOUT the polygon clip -- MEASURED: that clip was 52% of a T1 9x12 0.75 in stone-frame Generate
 * (4x CPU: 3.2 s -> 1.0 s with the thin-ring Poisson skip; 10,944 lays hashed byte-identical before / after). These pin
 * what the shortcut must never change, on a concave (L-shaped) board.
 */
import { describe, it, expect } from 'vitest';
import { clipPiecesToBoard } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

// an L: the 10 x 10 square without its top-right 5 x 5 quarter (the notch)
const BOARD = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 }];
const rect = (x0, y0, x1, y1) => ({ polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });
const MIN = 0.01;

describe('clipPiecesToBoard: the inside shortcut changes nothing', () => {
  it('a piece wholly inside is kept as built (the same object)', () => {
    const b = rect(1, 1, 3, 2);
    expect(clipPiecesToBoard([b], BOARD, MIN)[0]).toBe(b);
  });
  it('a piece crossing the outline is cut to the board', () => {
    const [c] = clipPiecesToBoard([rect(8, 4, 12, 6)], BOARD, MIN); // over the right edge AND into the notch
    expect(Math.abs(signedArea(c.polygon))).toBeCloseTo(2, 6); // only 8..10 x 4..5 is on the board
  });
  it('a piece in the notch, clear of every edge, is outside: dropped, not kept by the shortcut', () => {
    expect(clipPiecesToBoard([rect(6, 6, 8, 8)], BOARD, MIN)).toEqual([]);
  });
  it('a piece lying along the outline takes the full clip and is kept whole', () => {
    const b = rect(0, 2, 2, 3); // its left edge on the board's
    const [c] = clipPiecesToBoard([b], BOARD, MIN);
    expect(Math.abs(signedArea(c.polygon))).toBeCloseTo(2, 6);
  });
});
