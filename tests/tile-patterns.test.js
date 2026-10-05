/**
 * F35 item 14: the TILE / PAVER patterns DRAWN on Fred's sheet 3 (shots/fred/ref_paver_tile_sheet.jpg), declared
 * BRICK_PATTERNS entries in a 'tiles' family with closed-form layouts (core/bricks/layouts/tiles.js); the unit = the
 * set's brick length. Each lays on a 7x9 wall inside the board with no overlaps and no unit larger than U; a pattern's
 * declared params (the octagon's dot size: options + one default) reach its layout through the fill.
 */
import { describe, it, expect } from 'vitest';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { brickSetById, BRICK_PATTERNS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { TILE_PARAMS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/layouts/tiles.js';
import { polygonsOverlap, patternParamsFor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const TILES = ['square_grid', 'square_diamond', 'octagon_square', 'hexagon', 'lozenge', 'framed_square'];
const W = 7, H = 9, U = 1.25;
const set1 = brickSetById(1);
const lay = (id, layoutParams) => generateBricks({
  boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
  set: { ...set1, layout: id, ...(layoutParams ? { layoutParams } : {}) }, scale: U / set1.brickLengthIn, suppression: 0, clumping: 0, seed: 7,
}).bricks;
const shrink = (poly, d) => {
  const c = poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }), { x: 0, y: 0 });
  return poly.map((p) => { const dx = p.x - c.x, dy = p.y - c.y, r = Math.hypot(dx, dy) || 1; return { x: p.x - (dx / r) * d, y: p.y - (dy / r) * d }; });
};
const longestEdge = (poly) => Math.max(...poly.map((p, i) => { const q = poly[(i + 1) % poly.length]; return Math.hypot(q.x - p.x, q.y - p.y); }));
const sig = (bricks) => bricks.map((b) => b.polygon.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ')).sort().join('|');

describe('F35 item 14: the tile patterns', () => {
  it('are declared Wall patterns in the tiles family; the octagons declare their dot size (3 options, one default)', () => {
    for (const id of TILES) expect(BRICK_PATTERNS[id], id).toMatchObject({ kind: 'tile2d', family: 'tiles' });
    for (const id of ['square_diamond', 'octagon_square']) {
      const p = BRICK_PATTERNS[id].params.ratio;
      expect(p.options).toHaveLength(3);
      expect(p.options).toContain(p.default);
    }
    expect(BRICK_PATTERNS.octagon_square.fixed).toEqual({ rotationDeg: 45 });
    expect(TILE_PARAMS.lozenge.aspect).toBeGreaterThan(1);
  });

  for (const id of TILES) {
    it(`${id}: lays on a 7x9 wall; inside the board; no overlaps; no unit larger than U`, () => {
      const bricks = lay(id);
      expect(bricks.length).toBeGreaterThan(30);
      for (const b of bricks) for (const p of b.polygon) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-6); expect(p.x).toBeLessThanOrEqual(W + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6); expect(p.y).toBeLessThanOrEqual(H + 1e-6);
      }
      // a whole (unclipped) unit is never larger than U along any edge; a board-edge clip can cut a longer chord
      const interior = bricks.filter((b) => b.polygon.every((p) => p.x > 0.01 && p.x < W - 0.01 && p.y > 0.01 && p.y < H - 0.01));
      expect(interior.length).toBeGreaterThan(5);
      for (const b of interior) expect(longestEdge(b.polygon)).toBeLessThanOrEqual(U + 1e-6);
      const s = bricks.map((b) => shrink(b.polygon, 0.004));
      let overlaps = 0;
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) if (polygonsOverlap(s[i], s[j])) overlaps++;
      expect(overlaps).toBe(0);
    });
  }

  it('all six differ; the two octagon drawings differ by their pinned turn', () => {
    expect(new Set(TILES.map((id) => sig(lay(id)))).size).toBe(TILES.length);
  });

  it('the dot size is data: each declared option lays a different octagon pattern; no pick = the default', () => {
    const opts = BRICK_PATTERNS.octagon_square.params.ratio.options;
    const sigs = opts.map((r) => sig(lay('octagon_square', { ratio: r })));
    expect(new Set(sigs).size).toBe(opts.length);
    expect(sig(lay('octagon_square'))).toBe(sigs[opts.indexOf(BRICK_PATTERNS.octagon_square.params.ratio.default)]);
  });

  it('the panel reads the current value: the default, then the user’s pick for THAT pattern only', () => {
    expect(patternParamsFor({}, 'octagon_square')).toEqual({ ratio: TILE_PARAMS.octagonDot.ratio.default });
    expect(patternParamsFor({ patternParams: { octagon_square: { ratio: 0.58 } } }, 'octagon_square')).toEqual({ ratio: 0.58 });
    expect(patternParamsFor({ patternParams: { octagon_square: { ratio: 0.58 } } }, 'square_diamond')).toEqual({ ratio: TILE_PARAMS.squareDiamond.ratio.default });
    expect(patternParamsFor({}, 'square_grid')).toEqual({});
  });
});
