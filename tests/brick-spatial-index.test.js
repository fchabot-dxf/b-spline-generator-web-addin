/**
 * 2026-10-08 (seat A; the phone map: with bricks laid, every rebuild spent most of its time in the brick height mask's
 * per-point pointInPolygon rejections -- spacing 3.3 s, stamp drags 1 - 2.6 s, frame nudges ~0.75 s). buildSpatialIndex's
 * query now returns only the bucket's bricks whose box (padded past pointInPolygon's 1e-9 in on-edge rule) holds the
 * point, in the same order, with numeric bucket keys. The answer must stay the one a scan of EVERY brick gives:
 * sampleHeight with the index == sampleHeight with none (index null = all bricks, in order), points on edges and
 * corners included, overlapping bricks included (the first match must still be the same brick).
 */
import { describe, it, expect } from 'vitest';
import { buildSpatialIndex, sampleHeight } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

let seed = 77;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function randomBricks(n, W, H) {
  const bricks = [];
  for (let k = 0; k < n; k++) {
    const cx = rnd() * W, cy = rnd() * H, w = 0.3 + rnd() * 1.5, h = 0.2 + rnd() * 0.8, a = (rnd() - 0.5) * 0.6;
    const c = Math.cos(a), s = Math.sin(a);
    const pts = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
    bricks.push({ id: k, polygon: k % 5 === 0 ? pts.slice(0, 3) : pts, heightOffset: rnd() * 0.05 }); // some triangles (mitres)
  }
  return bricks;
}

describe('buildSpatialIndex: the same first-match brick as a scan of every brick', () => {
  it('random + on-edge + on-corner points, overlapping bricks: sampleHeight through the index == without it', () => {
    const set = brickSetById(1);
    let checked = 0, inBrick = 0;
    for (const cell of [0.5, 2, 6]) {
      const bricks = randomBricks(120, 9, 12);
      const result = { bricks, frameBricks: [], seed: 5 };
      const index = buildSpatialIndex(bricks, cell);
      const pts = [];
      for (let k = 0; k < 3000; k++) pts.push([rnd() * 9, rnd() * 12]);
      for (const b of bricks) b.polygon.forEach((p, i) => { const q = b.polygon[(i + 1) % b.polygon.length]; pts.push([p.x, p.y], [(p.x + q.x) / 2, (p.y + q.y) / 2]); });
      for (const [x, y] of pts) {
        const a = sampleHeight(result, index, x, y, set, -1), b = sampleHeight(result, null, x, y, set, -1);
        expect(Object.is(a, b), `cell ${cell} at ${x},${y}`).toBe(true);
        if (a !== -1) inBrick++;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10000);
    expect(inBrick).toBeGreaterThan(2000);
  });
});
