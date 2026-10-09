// A stone frame ring thinner than the stone spacing is laid as a COURSE of stones along the ring (THIN_RING, Fred's
// pick (A), 2026-10-08). MEASURED before it (seat E): noise-seeded, such a ring left seedless stretches -- the widest
// gap reached 5-11 joints (T6 9x12 1.5 in mixed bands 10.9; T1 7x9 1 in single soldier, the right-waist sliver) and
// sharp stone corners down to 20 deg (short-grain needles, Fred's rule). FAST runs the shot cases; FULL=1 every
// template x 7x9 / 9x12 x 0.75-1.5 in x the five presets x White rocks / Grey stone.
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { tess } from './bare-ground.js';

/** the caps: widest gap in joints (2 x the farthest ground point from any piece / joint; worst 2.77, T5 9x12 double
 *  course -- T9's 3.79 pocket at the wall's corner under the stem closed by fieldstone's CORNER_ROUNDING), and the sharpest stone corner -- the angle at each outline vertex between the points
 *  cornerArmJoints joints along the outline either way (main: T16 9x12 1.5 in mixed bands 20 deg; after: 46 deg and up) */
const CAPS = Object.freeze({ widestGapJoints: 3, minCornerDeg: 40, cornerArmJoints: 2 });
const FAST = [
  ['template_6', 9, 12, 1.5, 'mixed_bands', 3],
  ['template_1', 7, 9, 1, 'single_soldier', 3],
  ['template_9', 7, 9, 1, 'single_soldier', 3],
  ['template_16', 9, 12, 1.5, 'mixed_bands', 3],
];
const TEMPLATES = FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k));
const FULL = process.env.FULL ? TEMPLATES.flatMap((tpl) => [[7, 9], [9, 12]].flatMap(([W, H]) => [3, 5].flatMap((id) => [0.75, 1, 1.25, 1.5].flatMap((L) =>
  ['single_soldier', 'soldier_stretcher', 'three_band', 'double_course', 'mixed_bands'].map((p) => [tpl, W, H, L, p, id]))))) : [];

const segDist = (x, y, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - x, a.y + t * ey - y); };
const box = (p) => [Math.min(...p.map((q) => q.x)), Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.x)), Math.max(...p.map((q) => q.y))];
/** the point `s` along the outline from vertex i, walking forward (dir 1) or back (dir -1) */
const walk = (P, i, s, dir) => {
  let a = P[i], k = i;
  for (let n = 0; n < P.length; n++) {
    const b = P[(k + dir + P.length) % P.length], l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l >= s) return { x: a.x + ((b.x - a.x) * s) / l, y: a.y + ((b.y - a.y) * s) / l };
    s -= l; a = b; k = (k + dir + P.length) % P.length;
  }
  return a;
};
const sharpest = (P, arm) => {
  let min = 180;
  for (let i = 0; i < P.length; i++) {
    const b = P[i], a = walk(P, i, arm, -1), c = walk(P, i, arm, 1), ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
    min = Math.min(min, (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1)))) * 180) / Math.PI);
  }
  return min;
};

function measure([tpl, W, H, L, preset, id]) {
  const WALL = BRICK_SETS[0], ring = BRICK_SETS.find((s) => s.id === id), scale = L / WALL.brickLengthIn, J = scaledSet(ring, scale).grout.widthIn;
  const prims = buildRibbonPrimitives(frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0).primitives);
  const C = tess(prims);
  const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: WALL, scale, seed: 1, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS[preset], set: ring } });
  const P = [...r.bricks, ...r.frameBricks].map((b) => b.polygon), bb = P.map(box);
  let overlaps = 0;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = bb[i], b = bb[j];
    if (!(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) && Math.abs(signedArea(polygonIntersection(P[i], P[j])) || 0) > 1e-3) overlaps++;
  }
  const offOutline = P.filter((Q) => Q.some((p) => !pointInPolygon(p.x, p.y, C) && Math.min(...C.map((a, i) => segDist(p.x, p.y, a, C[(i + 1) % C.length]))) > J)).length;
  const R = 1, B = 0.5, buckets = new Map(), key = (i, j) => i * 10007 + j;
  P.forEach((Q, k) => { const b = bb[k]; for (let i = Math.floor((b[0] - R) / B); i <= Math.floor((b[2] + R) / B); i++) for (let j = Math.floor((b[1] - R) / B); j <= Math.floor((b[3] + R) / B); j++) { const kk = key(i, j); if (!buckets.has(kk)) buckets.set(kk, []); buckets.get(kk).push(k); } });
  let widest = 0; const h = 0.04;
  for (let y = h / 2; y < H; y += h) for (let x = h / 2; x < W; x += h) {
    if (!pointInPolygon(x, y, C)) continue;
    let d = R;
    for (const k of buckets.get(key(Math.floor(x / B), Math.floor(y / B))) || []) { const Q = P[k]; if (pointInPolygon(x, y, Q)) { d = 0; break; } for (let i = 0; i < Q.length; i++) d = Math.min(d, segDist(x, y, Q[i], Q[(i + 1) % Q.length])); }
    widest = Math.max(widest, d);
  }
  return { gapJ: (2 * widest) / J, overlaps, offOutline, cornerDeg: Math.min(...r.frameBricks.map((b) => sharpest(b.polygon, CAPS.cornerArmJoints * J))) };
}

describe('thin stone rings: a course of stones, no seam wider than the cap, no needles', () => {
  it.each([...FAST, ...FULL])('%s %ix%i %s in %s set %i', { timeout: 600000 }, (...c) => {
    const m = measure(c);
    expect(m.overlaps).toBe(0);
    expect(m.offOutline).toBe(0);
    expect(m.gapJ).toBeLessThanOrEqual(CAPS.widestGapJoints);
    expect(m.cornerDeg).toBeGreaterThanOrEqual(CAPS.minCornerDeg);
  });
});
