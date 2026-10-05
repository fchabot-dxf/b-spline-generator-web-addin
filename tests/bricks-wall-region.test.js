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
import { strokesToRegion, WALL_REGION_PICK } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/region.js';
import { pointInPolygon, polygonIntersection, polygonCentroid, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
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

const key = (p) => JSON.stringify(p);
const centroidIn = (b, polys) => { const c = polygonCentroid(b.polygon); return inRegion(c.x, c.y, polys); };
/** T86 item 18b (WALL_REGION_PICK 'centroid', Fred: complete bricks): against the SAME wall laid without a region --
 *  every laid brick is one of its whole bricks (nothing cut at the region edge), every laid brick's centroid is in the
 *  region, every one of its bricks whose centroid is in the region is laid, no overlap, and none on a frame brick
 *  (beyond the seam's own hairline, 0.0006 sq in measured with or without a region). */
function checkWhole(laid, plain, polys, others = []) {
  const bad = [];
  const plainKeys = new Set(plain.map((b) => key(b.polygon)));
  const laidKeys = new Set(laid.map((b) => key(b.polygon)));
  for (const b of laid) {
    if (!plainKeys.has(key(b.polygon))) bad.push(`brick ${b.id} is not a whole brick of the bond (cut?)`);
    if (!centroidIn(b, polys)) bad.push(`brick ${b.id} laid with its centroid outside the region`);
    for (const o of others) if (area(polygonIntersection(b.polygon, o.polygon)) > 1e-3) bad.push(`brick ${b.id} on a frame brick`);
  }
  for (const b of plain) if (centroidIn(b, polys) && !laidKeys.has(key(b.polygon))) bad.push(`brick ${b.id} has its centroid in the region but is not laid`);
  for (let i = 0; i < laid.length; i++) for (let j = i + 1; j < laid.length; j++) {
    if (area(polygonIntersection(laid[i].polygon, laid[j].polygon)) > 1e-4) bad.push(`bricks ${laid[i].id}/${laid[j].id} overlap`);
  }
  return bad;
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
  it('is an option the engine honours', () => expect(ENGINE_OPTIONS).toContain('wallRegion'));
  it('no strokes = the full fill as today, and it says it read it', () => {
    const plain = lay({});
    const empty = lay({ wallRegion: { strokes: [] } });
    expect(empty.bricks.map((b) => b.polygon)).toEqual(plain.bricks.map((b) => b.polygon));
    expect(empty.wallRegionApplied).toBe(true);
    expect(plain.wallRegionApplied).toBeUndefined();
  });
  it('the pick rule is declared: whole bricks by centroid', () => expect(WALL_REGION_PICK).toBe('centroid'));
  it('two overlapping strokes: whole bricks, exactly those whose centroid is in the union', () => {
    const strokes = [{ points: P([1, 6], [6, 5]), widthIn: 1.6 }, { points: P([2, 2], [4, 7.5]), widthIn: 1.2 }];
    const polys = strokesToRegion(strokes).polygons;
    expect(polys.length).toBe(1);
    const r = lay({ wallRegion: { strokes } });
    expect(r.wallRegionApplied).toBe(true);
    expect(r.bricks.length).toBeGreaterThan(20);
    expect(checkWhole(r.bricks, lay({}).bricks, polys).slice(0, 5)).toEqual([]);
  });
  it('a stroke across the frame band: whole wall bricks inside the frame, the band clip kept, the frame laid in full', () => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }), board: { widthIn: W, heightIn: H } }, 0, 0);
    const frame = { primitives: buildRibbonPrimitives(sil.primitives), bands: FRAME_PRESETS.single_soldier };
    const strokes = [{ points: P([-0.5, 7], [3.5, 4.5], [7.5, 2]), widthIn: 1.5 }];
    const polys = strokesToRegion(strokes).polygons;
    const r = lay({ frame, wallRegion: { strokes } });
    expect(r.bricks.length).toBeGreaterThan(5);
    expect(r.frameBricks.length).toBeGreaterThan(50);
    expect(checkWhole(r.bricks, lay({ frame }).bricks, polys, r.frameBricks).slice(0, 5)).toEqual([]);
  });
  it('newest wins: each brick belongs to exactly one area -- the newest whose region holds its centroid', () => {
    const older = [{ points: P([1, 4.5], [6, 4.5]), widthIn: 2 }], newer = [{ points: P([3.5, 2], [3.5, 7]), widthIn: 1.2 }];
    const o = lay({ wallRegion: { strokes: older, minus: newer } }).bricks, n = lay({ wallRegion: { strokes: newer } }).bricks;
    const plain = lay({}).bricks;
    const oPolys = strokesToRegion(older, newer).polygons, nPolys = strokesToRegion(newer).polygons;
    expect(o.length).toBeGreaterThan(10);
    expect(checkWhole(o, plain, oPolys).slice(0, 5)).toEqual([]);
    expect(checkWhole(n, plain, nPolys).slice(0, 5)).toEqual([]);
    const oKeys = new Set(o.map((b) => key(b.polygon)));
    expect(n.filter((b) => oKeys.has(key(b.polygon))).map((b) => b.id)).toEqual([]); // never shared
    const both = strokesToRegion([...older, ...newer]).polygons;
    expect(o.length + n.length).toBe(plain.filter((b) => centroidIn(b, both)).length); // every brick of the union, once
  });
  it('turns with the pattern (item 29): whole rotated bricks by centroid', () => {
    const strokes = [{ points: P([1, 6], [6, 5]), widthIn: 1.6 }];
    const polys = strokesToRegion(strokes).polygons;
    const r = lay({ wallRegion: { strokes }, rotationDeg: 45 });
    expect(r.bricks.length).toBeGreaterThan(5);
    expect(checkWhole(r.bricks, lay({ rotationDeg: 45 }).bricks, polys).slice(0, 5)).toEqual([]);
  });
});
