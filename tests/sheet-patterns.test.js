/**
 * F35 item 13: the new Wall patterns DRAWN on Fred's sheet (shots/fred/ref_brick_pattern_sheet.jpg), declared as
 * BRICK_PATTERNS entries with closed-form layouts (core/bricks/layouts/sheet-patterns.js): each lays on a 7x9 wall,
 * no two bricks overlap, nothing leaves the board, no brick is stretched past the set's own L x W, and the picker
 * lists each under the sheet's own name.
 */
import { describe, it, expect } from 'vitest';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { brickSetById, BRICK_PATTERNS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { polygonsOverlap } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { readFileSync } from 'node:fs';

const NEW = ['stacked_horizontal', 'chevron', 'stacked_variation', 'basketweave_variation', 'basketweave_stacked'];
const W = 7, H = 9;
const set1 = brickSetById(1);
const lay = (id, lengthIn = 1.25) => generateBricks({
  boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
  set: { ...set1, layout: id }, scale: lengthIn / set1.brickLengthIn, suppression: 0, clumping: 0, seed: 7,
}).bricks;
/** The polygon pulled toward its centroid by `d` (so bricks that only TOUCH along a joint never count as overlapping). */
const shrink = (poly, d) => {
  const c = poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }), { x: 0, y: 0 });
  return poly.map((p) => { const dx = p.x - c.x, dy = p.y - c.y, r = Math.hypot(dx, dy) || 1; return { x: p.x - (dx / r) * d, y: p.y - (dy / r) * d }; });
};
/** The longest EDGE (a 45 deg chevron brick's bounding box is wider than the brick; its long edge is L). */
const span = (poly) => Math.max(...poly.map((p, i) => { const q = poly[(i + 1) % poly.length]; return Math.hypot(q.x - p.x, q.y - p.y); }));

describe('F35 item 13: the sheet patterns', () => {
  it('are declared Wall patterns (tile2d) under the sheet’s own names, in the picker families', () => {
    for (const id of NEW) expect(BRICK_PATTERNS[id], id).toEqual({ kind: 'tile2d' });
    const src = readFileSync('bspline-frame-builder/b-spline-gen/html/main/brick-panel.js', 'utf-8');
    for (const label of ['Stacked horizontal', 'Chevron', 'Stacked variation', 'Basketweave variation', 'Basketweave + stacked']) expect(src).toContain(`'${label}'`);
  });

  for (const id of NEW) {
    it(`${id}: lays on a 7x9 wall; inside the board; no overlaps; never longer than a brick`, () => {
      const bricks = lay(id);
      expect(bricks.length).toBeGreaterThan(40);
      for (const b of bricks) for (const p of b.polygon) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-6); expect(p.x).toBeLessThanOrEqual(W + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6); expect(p.y).toBeLessThanOrEqual(H + 1e-6);
      }
      const L = 1.25;
      for (const b of bricks) expect(span(b.polygon)).toBeLessThanOrEqual(L + 1e-6); // the chevron's slope stays within L
      const s = bricks.map((b) => shrink(b.polygon, 0.004));
      let overlaps = 0;
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) if (polygonsOverlap(s[i], s[j])) overlaps++;
      expect(overlaps).toBe(0);
    });
  }

  it('the pattern decides the layout: each one differs from the others', () => {
    const sig = (id) => lay(id).map((b) => b.polygon.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ')).sort().join('|');
    expect(new Set(NEW.map(sig)).size).toBe(NEW.length);
  });
});
