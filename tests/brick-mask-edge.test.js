/**
 * Item 74n (Fred: teeth along the panel's cut edge): core/bricks/mask-edge.js maskEdgeSource + the brick pass copy in
 * core/engine/apply-stamp-layers.js. The ring BRICK_MASK_EDGE_RING_CELLS deep inside the outline and the points outside
 * it within BRICK_MASK_EDGE_BLEED_CELLS take the height of the nearest point deeper than the ring; every deeper point is
 * untouched (that is what keeps the board's bricks exactly as before away from the edge).
 */
import { describe, it, expect } from 'vitest';
import { maskEdgeSource, BRICK_MASK_EDGE_RING_CELLS, BRICK_MASK_EDGE_BLEED_CELLS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/mask-edge.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { applyStampLayers, STAMP_PASS_KIND } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';

// a 4 x 5 in board on a 0.1 in grid, an ellipse outline (a curve crosses the grid at every angle)
const W = 4, H = 5, nx = 41, nz = 51;
const outline = Array.from({ length: 96 }, (_, n) => {
  const t = (n / 96) * 2 * Math.PI;
  return { x: W / 2 + 1.7 * Math.cos(t), y: H / 2 + 2.2 * Math.sin(t) };
});
const at = (k) => ({ i: k % nx, j: Math.floor(k / nx), x: ((k % nx) / (nx - 1)) * W, y: H * (1 - Math.floor(k / nx) / (nz - 1)) });
const inside = Array.from({ length: nx * nz }, (_, k) => pointInPolygon(at(k).x, at(k).y, outline));
const ring = BRICK_MASK_EDGE_RING_CELLS;
const isDeep = (k) => {
  if (!inside[k]) return false;
  const { i, j } = at(k);
  for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) {
    const ii = i + di, jj = j + dj;
    if (di * di + dj * dj <= ring * ring && ii >= 0 && jj >= 0 && ii < nx && jj < nz && !inside[jj * nx + ii]) return false;
  }
  return true;
};

describe('74n: maskEdgeSource', () => {
  const src = maskEdgeSource(outline, nx, nz, W, H);
  it('declares a one-point ring and a two-point bleed', () => {
    expect(BRICK_MASK_EDGE_RING_CELLS).toBe(1);
    expect(BRICK_MASK_EDGE_BLEED_CELLS).toBe(2);
  });
  it('never targets a point deeper than the ring; every source is such a deep point', () => {
    let deep = 0;
    for (let k = 0; k < nx * nz; k++) {
      if (isDeep(k)) { deep++; expect(src[k], `deep point ${k}`).toBe(-1); }
      if (src[k] >= 0) expect(isDeep(src[k]), `source of ${k}`).toBe(true);
    }
    expect(deep).toBeGreaterThan(500);
  });
  it('targets every ring point inside, and the outside points next to the outline', () => {
    let ringPts = 0, outsideNear = 0;
    for (let k = 0; k < nx * nz; k++) {
      if (inside[k] && !isDeep(k)) { ringPts++; expect(src[k], `ring point ${k}`).toBeGreaterThanOrEqual(0); }
      if (!inside[k]) {
        const { i, j } = at(k);
        const nextToInside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => inside[(j + dj) * nx + (i + di)]);
        if (nextToInside) { outsideNear++; expect(src[k], `outside point ${k}`).toBeGreaterThanOrEqual(0); }
      }
    }
    expect(ringPts).toBeGreaterThan(50);
    expect(outsideNear).toBeGreaterThan(50);
  });
  it('leaves the points far outside alone; no outline = nothing to do', () => {
    expect(src[0]).toBe(-1); // the board corner, well outside the ellipse
    expect(maskEdgeSource(null, nx, nz, W, H)).toBeNull();
    expect(maskEdgeSource([{ x: 0, y: 0 }, { x: 1, y: 0 }], nx, nz, W, H)).toBeNull();
  });
});

describe('74n: the brick pass carries the deep heights to the edge', () => {
  // a brick mask: a checker of bricks (body 1) and joints (body 0) everywhere, so the edge band and the interior differ
  const body = new Float32Array(nx * nz).map((_, k) => ((at(k).i >> 1) + (at(k).j >> 1)) % 2);
  const terrain = new Float32Array(nx * nz).map((_, k) => 0.3 + 0.02 * at(k).x + 0.01 * at(k).y);
  const pass = (mask, kind) => [{ id: 'L#bricks', kind, name: 'b', enabled: true, svg: '1', mask, depth: 0.125, profile: 'flat', edgeFilletRadius: 0 }];
  const edgeSource = maskEdgeSource(outline, nx, nz, W, H);
  const without = applyStampLayers(terrain, pass({ body, fillet: new Float32Array(nx * nz), isStamped: new Uint8Array(nx * nz).fill(1) }, STAMP_PASS_KIND.bricks), nx, nz);
  const withEdge = applyStampLayers(terrain, pass({ body, fillet: new Float32Array(nx * nz), isStamped: new Uint8Array(nx * nz).fill(1), edgeSource }, STAMP_PASS_KIND.bricks), nx, nz);
  it('every point deeper than the ring is byte-identical', () => {
    let deep = 0;
    for (let k = 0; k < nx * nz; k++) if (isDeep(k)) { deep++; expect(withEdge[k], `deep ${k}`).toBe(without[k]); }
    expect(deep).toBeGreaterThan(500);
  });
  it('each target takes its source\'s final height', () => {
    let targets = 0;
    for (let k = 0; k < nx * nz; k++) if (edgeSource[k] >= 0) { targets++; expect(withEdge[k]).toBe(without[edgeSource[k]]); }
    expect(targets).toBeGreaterThan(100);
  });
  it('an ART pass never reads an edge map', () => {
    const art = applyStampLayers(terrain, pass({ body, fillet: new Float32Array(nx * nz), isStamped: new Uint8Array(nx * nz).fill(1), edgeSource }, STAMP_PASS_KIND.art), nx, nz);
    const artPlain = applyStampLayers(terrain, pass({ body, fillet: new Float32Array(nx * nz), isStamped: new Uint8Array(nx * nz).fill(1) }, STAMP_PASS_KIND.art), nx, nz);
    expect([...art]).toEqual([...artPlain]);
  });
});
