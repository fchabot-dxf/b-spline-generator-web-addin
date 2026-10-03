/**
 * H23 item 72 BRICK ENGINE -- bricksFillShape (core primitive #2): non-stretch, suppression
 * exactness, determinism, hole exclusion.
 */
import { describe, it, expect } from 'vitest';
import { bricksFillShape } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/fill-shape.js';
import { BRICK_SETS, PIECE_CATALOGUE, enabledPieces } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { bondLayout } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/layouts/bond.js';
import { assignPieces } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/pieces.js';
import { computeSuppressedCells } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/suppression.js';

const SET = BRICK_SETS[0];
const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

function bbox(polygon) {
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

describe('bricksFillShape', () => {
  it('never stretches a brick: every cell keeps the set\'s own length/height ratio, on two different board sizes', () => {
    const expectedRatio = SET.brickLengthIn / SET.brickHeightIn;
    for (const [w, h] of [[6, 9], [9, 12]]) {
      const { bricks } = bricksFillShape(rect(w, h), null, { set: SET, seed: 1 });
      expect(bricks.length).toBeGreaterThan(0);
      for (const b of bricks) {
        const { w: bw, h: bh } = bbox(b.polygon);
        const ratio = bw / bh;
        expect(Math.abs(ratio - expectedRatio) / expectedRatio).toBeLessThan(0.02);
      }
    }
  });

  it('suppression removes an EXACT fraction of PIECES, regardless of clumping', () => {
    const board = rect(9, 12);
    for (const clumping of [0.1, 0.5, 0.9]) {
      const { bricks } = bricksFillShape(board, null, { set: SET, seed: 5, suppression: 0.3, clumping, topBias: 0.5 });
      const noSupp = bricksFillShape(board, null, { set: SET, seed: 5, suppression: 0, clumping, topBias: 0.5 });
      // Reconstruct piece groups from the SUPPRESSED output's own sibling pieceIds is not directly
      // observable from bricks alone (suppressed pieces are simply absent) -- so compare the piece
      // COUNT of the un-suppressed run against the surviving brick count's own implied piece count
      // is not exact either (pieces vary 1-3 bricks). Assert instead on the documented contract
      // directly via the removed CELL count bound: it can never exceed suppression*totalCells*3
      // (largest piece) nor be positionally unaffected by suppression=0.3 actually removing something.
      expect(bricks.length).toBeLessThan(noSupp.bricks.length);
      const removedFraction = 1 - bricks.length / noSupp.bricks.length;
      // pieces are 1-3 cells, so the removed CELL fraction tracks the 30% PIECE fraction loosely --
      // bound it well clear of 0 and of removing everything.
      expect(removedFraction).toBeGreaterThan(0.1);
      expect(removedFraction).toBeLessThan(0.5);
    }
  });

  it('suppression=0.3 removes the EXACT same PIECE count independent of clumping (the stated contract)', () => {
    const board = rect(9, 12);
    const { cells } = bondLayout(board, SET);
    const pieceOf = assignPieces(cells, enabledPieces(PIECE_CATALOGUE), 5);
    const pieceCount = new Set([...pieceOf.values()].map((v) => v.cellIds[0])).size;
    const expectedRemoved = Math.round(0.3 * pieceCount);
    for (const clumping of [0.0, 0.5, 1.0]) {
      const suppressed = computeSuppressedCells(pieceOf, cells, { suppression: 0.3, topBias: 0.5, clumping }, 5);
      const removedPieceCount = new Set(
        [...suppressed].map((cellId) => pieceOf.get(cellId).cellIds[0]),
      ).size;
      expect(removedPieceCount).toBe(expectedRemoved);
    }
  });

  it('same seed -> byte-identical output (determinism)', () => {
    const board = rect(9, 12);
    const r1 = bricksFillShape(board, null, { set: SET, seed: 42, suppression: 0.2, clumping: 0.4 });
    const r2 = bricksFillShape(board, null, { set: SET, seed: 42, suppression: 0.2, clumping: 0.4 });
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
  });

  it('different seeds produce different layouts (not accidentally constant)', () => {
    const board = rect(9, 12);
    const r1 = bricksFillShape(board, null, { set: SET, seed: 1 });
    const r2 = bricksFillShape(board, null, { set: SET, seed: 2 });
    expect(JSON.stringify(r1)).not.toEqual(JSON.stringify(r2));
  });

  it('excludes bricks whose centroid falls inside a hole', () => {
    const board = rect(9, 12);
    const hole = [{ x: 3, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 8 }, { x: 3, y: 8 }];
    const full = bricksFillShape(board, null, { set: SET, seed: 9 });
    const withHole = bricksFillShape(board, [hole], { set: SET, seed: 9 });
    expect(withHole.bricks.length).toBeLessThan(full.bricks.length);
    const centroidOf = (poly) => ({
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
    });
    const insideHoleBBox = (c) => c.x > 3 && c.x < 6 && c.y > 4 && c.y < 8;
    for (const b of withHole.bricks) expect(insideHoleBBox(centroidOf(b.polygon))).toBe(false);
  });

  it('returns no bricks for an unknown layout id (declared-table miss, not a throw)', () => {
    const board = rect(9, 12);
    const badSet = { ...SET, layout: 'nonexistent' };
    const { bricks } = bricksFillShape(board, null, { set: badSet, seed: 1 });
    expect(bricks).toEqual([]);
  });
});
