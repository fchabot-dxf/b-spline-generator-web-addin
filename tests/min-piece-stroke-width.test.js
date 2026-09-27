/**
 * Fred: "The only distance it should use is the stroke width." The one-lattice-cell minimum (MIN_PIECE_CELLS)
 * is retired everywhere: the shortest piece a cut, a joint slide, a rail push, a rail/tie end-stretch or a stripe
 * may leave is the piece's OWN stroke width (`minPieceLength`, editor-lattice-chains.js).
 */
import { describe, it, expect } from 'vitest';
import { minPieceLength, MIN_PIECE_FLOOR_IN } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-chains.js';
import { stretchRailEnd, stretchTieEnd } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';

const el = (attrs) => ({ node: { getAttribute: (k) => (attrs[k] !== undefined ? String(attrs[k]) : null) } });

describe('minPieceLength: the stroke width, nothing else', () => {
  it('reads the piece\'s own stroke-width', () => {
    expect(minPieceLength(el({ 'stroke-width': 0.07 }))).toBe(0.07);
    expect(minPieceLength(el({ 'stroke-width': '0.5' }))).toBe(0.5);
  });
  it('a piece with no (or a zero) stroke width gets only the tiny zero-length floor', () => {
    expect(minPieceLength(el({}))).toBe(MIN_PIECE_FLOOR_IN);
    expect(minPieceLength(el({ 'stroke-width': 0 }))).toBe(MIN_PIECE_FLOOR_IN);
    expect(MIN_PIECE_FLOOR_IN).toBeLessThan(0.01);
  });
});

describe('end-stretch clamps take the stroke width (in cells), not one cell', () => {
  const spacing = 0.25, sw = 0.05, min = sw / spacing; // 0.2 cell
  it('rail: shortened past its fixed end stops one stroke width short of it', () => {
    const r = stretchRailEnd({ a: { i: 0, j: 2 }, b: { i: 8, j: 2 } }, 'b', -5, min);
    expect(r.b.i).toBeCloseTo(min, 12);
    expect(r.b.i * spacing).toBeCloseTo(sw, 12); // 0.05 in, well under one 0.25 in cell
  });
  it('tie: same rule on its own axis', () => {
    const t = stretchTieEnd({ a: { i: 3, j: 0 }, b: { i: 3, j: 8 } }, 'a', 20, min);
    expect(t.a.j).toBeCloseTo(8 - min, 12);
  });
});
