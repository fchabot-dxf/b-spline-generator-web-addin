/**
 * Bare board ground, shared by the brick coverage tests (seat D, moved out of bricks-wall-coverage-matrix 2026-10-08 for
 * the tip-fill fan pin): grid points inside the contour that are in no brick and more than one joint from every brick.
 *  - bareGroundScan: the reference scan (every box per grid point);
 *  - bareGround: the same verdict per point with the boxes bucketed (load-proofing), plus the largest CONNECTED bare patch
 *    (4-neighbour grid points) -- one dropped brick, or a fan slice given up, is one patch (T86 item 16(d)).
 */
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

/** the scan's grid step (in) */
export const GRID_IN = 0.04;
/** T86 item 16(d): the largest bare patch may be this share of ONE brick face (L x H of the scaled set). A dropped wall
 *  brick is one patch: T1's top-right corner brick (dropped before item 21c d23c428) left 0.16-0.37 of a face at
 *  0.75-1.5 in; T11 butt_frame 0.75 in's given-up fan slice (before the tip-fill fan blockers) 1.1 faces. Main is
 *  <= 0.03 of a face at 0.75-1 in over every preset, 7x9 and 9x12 (seat D, 2026-10-08). */
export const PATCH_MAX_FACE = 0.05;
/** the lays allowed a larger patch than PATCH_MAX_FACE, `<template> <W>x<H> <L>` -> face share (read by the coverage
 *  matrix and the gap sweep). T16 7x9 1.5 in: the wall's 39 deg tip at the neck, narrower than TIP_FILL_MIN_DEG (no
 *  needles) and under the wall's piece floor -- bare by declared rule, capped at today's measure (0.072); the gap sweep
 *  measured the same patch under every frame preset (it is the wall's, not the band's). */
export const PATCH_KNOWN = Object.freeze({ 'template_16 7x9 1.5': 0.08 });

export const tess = (prims) => prims.flatMap((p) => (p.type === 'arc'
  ? Array.from({ length: 32 }, (_, k) => { const t = p.theta1 + ((p.theta2 - p.theta1) * k) / 32; return { x: p.cx + p.r * Math.cos(t), y: p.cy + p.r * Math.sin(t) }; })
  : [p.p0]));
const segDist = (px, py, a, b) => {
  const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey, u = l ? Math.max(0, Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / l)) : 0;
  return Math.hypot(a.x + u * ex - px, a.y + u * ey - py);
};
/** a brick's polygon + its box grown by one joint (the only bricks that can be "near" a point lie in its box) */
const boxesOf = (bricks, J) => bricks.map((b) => { const xs = b.polygon.map((p) => p.x), ys = b.polygon.map((p) => p.y); return { p: b.polygon, x0: Math.min(...xs) - J, x1: Math.max(...xs) + J, y0: Math.min(...ys) - J, y1: Math.max(...ys) + J }; });
const nearBox = (b, x, y, J) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
  && (pointInPolygon(x, y, b.p) || b.p.some((q, i) => segDist(x, y, q, b.p[(i + 1) % b.p.length]) <= J * 1.05));
/** board ground inside the contour that is in no brick and more than one joint from every brick -- the reference scan
 *  (every box per grid point); kept to pin bareGround below to it */
export function bareGroundScan(contour, bricks, J, { W, H }) {
  const boxes = boxesOf(bricks, J);
  let bare = 0;
  for (let y = GRID_IN / 2; y < H; y += GRID_IN) for (let x = GRID_IN / 2; x < W; x += GRID_IN) {
    if (!pointInPolygon(x, y, contour)) continue;
    if (!boxes.some((b) => nearBox(b, x, y, J))) bare++;
  }
  return bare * GRID_IN * GRID_IN;
}
/** The same count, with the boxes bucketed on a coarse grid (load-proofing, seat D 2026-10-07): a box is filed in every
 *  bucket it overlaps, so the bucket of a point holds every box that contains it -- the same `nearBox` test on the same
 *  candidates that can pass it, so the same verdict per point. MEASURED before: this scan was 0.86 s of template_1's
 *  1.44 s (the rest is generateBricks), and the template_1 case (4 sizes) timed out at 35-38 s in 2 of 12 loaded runs. */
const BUCKET_IN = 0.25;
export function bareGround(contour, bricks, J, { W, H }) {
  const nx = Math.ceil(W / BUCKET_IN) + 1, buckets = new Map();
  const cell = (v) => Math.floor(v / BUCKET_IN);
  for (const b of boxesOf(bricks, J)) {
    for (let j = cell(b.y0); j <= cell(b.y1); j++) for (let i = cell(b.x0); i <= cell(b.x1); i++) {
      const k = j * nx + i;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(b);
    }
  }
  const bare = new Set(), cols = Math.ceil(W / GRID_IN) + 1;
  let row = 0;
  for (let y = GRID_IN / 2; y < H; y += GRID_IN, row++) for (let x = GRID_IN / 2, col = 0; x < W; x += GRID_IN, col++) {
    if (!pointInPolygon(x, y, contour)) continue;
    if (!(buckets.get(cell(y) * nx + cell(x)) || []).some((b) => nearBox(b, x, y, J))) bare.add(row * cols + col);
  }
  // T86 item 16(d): the largest CONNECTED bare patch (4-neighbour grid points) -- one dropped wall brick is one patch
  let largest = 0;
  const seen = new Set();
  for (const s of bare) {
    if (seen.has(s)) continue;
    let n = 0;
    for (const st = [s], _ = seen.add(s); st.length; n++) {
      const c = st.pop();
      for (const k of [c + 1, c - 1, c + cols, c - cols]) if (bare.has(k) && !seen.has(k)) { seen.add(k); st.push(k); }
    }
    largest = Math.max(largest, n);
  }
  return { sqIn: bare.size * GRID_IN * GRID_IN, largestSqIn: largest * GRID_IN * GRID_IN };
}
