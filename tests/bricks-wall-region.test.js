/**
 * T86 item 18 (Fred: "once any area is painted, ONLY the painted areas get bricks, no full fill underneath; no areas =
 * the full fill as today"): region.js strokesToRegion turns area-brush strokes into the wall's region (the union of the
 * swept strokes, holes allowed, minus each newer area), and generateBricks' `wallRegion` lays the wall only there.
 * Areas checked against closed forms (a capsule = 2rL + pi r^2); the lay by grid-sampling the board.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { generateBricks, ENGINE_OPTIONS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { strokesToRegion } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/region.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // grid-sampled lays: see heavy-test-timeout.js

const SET = BRICK_SETS[0];
const J = SET.grout.widthIn;
const W = 7, H = 9;
const board = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const regionArea = (polys) => polys.reduce((s, r) => s + area(r.outer) - r.holes.reduce((t, h) => t + area(h), 0), 0);
const capsule = (len, w) => len * w + Math.PI * (w / 2) ** 2;
const P = (...xy) => xy.map(([x, y]) => ({ x, y }));
const inRegion = (x, y, polys) => polys.some((r) => pointInPolygon(x, y, r.outer) && !r.holes.some((h) => pointInPolygon(x, y, h)));
const lay = (extra) => generateBricks({ boardOutline: board, set: SET, seed: 3, scale: 1, suppression: 0, clumping: 0, zones: [{ pattern: 'stretcher' }], ...extra });

/** every wall brick inside the region; no two wall bricks overlap; the region's inside (a grout and a quarter brick
 *  in from its edge) covered by bricks except their own joints */
function checkLay(bricks, polys, others = []) {
  const bad = [];
  for (const b of bricks) {
    const inside = polys.reduce((s, r) => s + area(polygonIntersection(b.polygon, r.outer)), 0);
    if (area(b.polygon) - inside > 1e-4) bad.push(`brick ${b.id} outside the region by ${(area(b.polygon) - inside).toFixed(4)}`);
    for (const r of polys) for (const h of r.holes) if (area(polygonIntersection(b.polygon, h)) > 1e-4) bad.push(`brick ${b.id} in a hole`);
    // the wall/frame seam's own hairline residual, the same with or without a region (measured T1 7x9: worst pair
    // 0.0006 sq in either way) -- a region must never put a brick ON the band
    for (const o of others) if (area(polygonIntersection(b.polygon, o.polygon)) > 1e-3) bad.push(`brick ${b.id} on a frame brick`);
  }
  for (let i = 0; i < bricks.length; i++) for (let j = i + 1; j < bricks.length; j++) {
    if (area(polygonIntersection(bricks[i].polygon, bricks[j].polygon)) > 1e-4) bad.push(`bricks ${bricks[i].id}/${bricks[j].id} overlap`);
  }
  return bad;
}
function coverage(bricks, polys, inset) {
  let want = 0, got = 0;
  const near = (x, y) => [[0, 0], [inset, 0], [-inset, 0], [0, inset], [0, -inset]].every(([dx, dy]) => inRegion(x + dx, y + dy, polys));
  for (let x = 0.05; x < W; x += 0.1) for (let y = 0.05; y < H; y += 0.1) {
    if (!near(x, y)) continue;
    want++;
    if (bricks.some((b) => pointInPolygon(x, y, b.polygon) || pointInPolygon(x + J, y, b.polygon) || pointInPolygon(x, y + J, b.polygon))) got++;
  }
  return want ? got / want : 0;
}

describe('strokesToRegion (T86 item 18)', () => {
  it('one straight stroke: one outer, the capsule\'s area, no hole', () => {
    const { polygons } = strokesToRegion([{ points: P([1, 4], [5, 4]), widthIn: 1 }]);
    expect(polygons.length).toBe(1);
    expect(polygons[0].holes.length).toBe(0);
    expect(regionArea(polygons) / capsule(4, 1)).toBeCloseTo(1, 2);
  });
  it('two crossing strokes: ONE outer, their union\'s area (sum minus the shared square)', () => {
    const { polygons } = strokesToRegion([{ points: P([1, 4], [5, 4]), widthIn: 1 }, { points: P([3, 2], [3, 6]), widthIn: 1 }]);
    expect(polygons.length).toBe(1);
    expect(regionArea(polygons) / (2 * capsule(4, 1) - 1)).toBeCloseTo(1, 2);
  });
  it('a closed ring: an outer with its hole', () => {
    const ring = Array.from({ length: 73 }, (_, k) => ({ x: 3.5 + 2 * Math.cos((k / 72) * 2 * Math.PI), y: 4.5 + 2 * Math.sin((k / 72) * 2 * Math.PI) }));
    const { polygons } = strokesToRegion([{ points: ring, widthIn: 0.5 }]);
    expect(polygons.length).toBe(1);
    expect(polygons[0].holes.length).toBe(1);
    expect(area(polygons[0].holes[0]) / (Math.PI * 1.75 ** 2)).toBeCloseTo(1, 2);
    expect(regionArea(polygons) / (Math.PI * (2.25 ** 2 - 1.75 ** 2))).toBeCloseTo(1, 2);
  });
  it('minus: a newer stroke across it splits it in two, a gap wide', () => {
    const { polygons } = strokesToRegion([{ points: P([1, 4], [5, 4]), widthIn: 1 }], [{ points: P([3, 2], [3, 6]), widthIn: 1 }], { gapIn: 0.1 });
    expect(polygons.length).toBe(2);
    expect(regionArea(polygons) / (capsule(4, 1) - 1 * 1.2)).toBeCloseTo(1, 2);
  });
  it('no strokes: no region', () => expect(strokesToRegion([]).polygons).toEqual([]));
});

describe('generateBricks wallRegion (T86 item 18)', () => {
  it('honoured but not listed yet: slice 2 (37) lists it with the Area tool it shows', () => {
    expect(ENGINE_OPTIONS).not.toContain('wallRegion');
    expect(lay({ wallRegion: { strokes: [{ points: P([1, 4], [5, 4]), widthIn: 1 }] } }).wallRegionApplied).toBe(true);
  });
  it('no strokes = the full fill as today, and it says it read it', () => {
    const plain = lay({});
    const empty = lay({ wallRegion: { strokes: [] } });
    expect(empty.bricks.map((b) => b.polygon)).toEqual(plain.bricks.map((b) => b.polygon));
    expect(empty.wallRegionApplied).toBe(true);
    expect(plain.wallRegionApplied).toBeUndefined();
  });
  it('two overlapping strokes: the wall only in their union, no overlap, the area covered', () => {
    const strokes = [{ points: P([1, 6], [6, 5]), widthIn: 1.6 }, { points: P([2, 2], [4, 7.5]), widthIn: 1.2 }];
    const polys = strokesToRegion(strokes, [], { gapIn: J }).polygons;
    expect(polys.length).toBe(1);
    const r = lay({ wallRegion: { strokes } });
    expect(r.wallRegionApplied).toBe(true);
    expect(r.bricks.length).toBeGreaterThan(20);
    expect(checkLay(r.bricks, polys).slice(0, 5)).toEqual([]);
    expect(coverage(r.bricks, polys, 0.25 * SET.brickLengthIn)).toBeGreaterThan(0.97);
  });
  it('a stroke across the frame band: wall bricks only inside both the frame and the stroke', () => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }), board: { widthIn: W, heightIn: H } }, 0, 0);
    const prims = buildRibbonPrimitives(sil.primitives);
    const strokes = [{ points: P([-0.5, 7], [3.5, 4.5], [7.5, 2]), widthIn: 1.5 }];
    const polys = strokesToRegion(strokes, [], { gapIn: J }).polygons;
    const r = lay({ frame: { primitives: prims, bands: FRAME_PRESETS.single_soldier }, wallRegion: { strokes } });
    expect(r.bricks.length).toBeGreaterThan(5);
    expect(r.frameBricks.length).toBeGreaterThan(50); // the frame is laid in full, not clipped to the region
    expect(checkLay(r.bricks, polys, r.frameBricks).slice(0, 5)).toEqual([]);
  });
  it('newest wins: the older area flows around the newer one, a grout joint apart', () => {
    const older = [{ points: P([1, 4.5], [6, 4.5]), widthIn: 2 }], newer = [{ points: P([3.5, 2], [3.5, 7]), widthIn: 1.2 }];
    const r = lay({ wallRegion: { strokes: older, minus: newer } });
    const newPolys = strokesToRegion(newer, [], {}).polygons;
    const grown = strokesToRegion(newer.map((s) => ({ ...s, widthIn: s.widthIn + 2 * 0.9 * J })), [], {}).polygons;
    expect(r.bricks.length).toBeGreaterThan(10);
    for (const b of r.bricks) expect(grown.reduce((s, p) => s + area(polygonIntersection(b.polygon, p.outer)), 0)).toBeLessThan(1e-4);
    expect(newPolys.length).toBe(1);
  });
  it('turns with the pattern (item 29): rotated bricks stay inside the region', () => {
    const strokes = [{ points: P([1, 6], [6, 5]), widthIn: 1.6 }];
    const polys = strokesToRegion(strokes, [], { gapIn: J }).polygons;
    const r = lay({ wallRegion: { strokes }, rotationDeg: 45 });
    expect(r.bricks.length).toBeGreaterThan(5);
    expect(checkLay(r.bricks, polys).slice(0, 5)).toEqual([]);
  });
});
