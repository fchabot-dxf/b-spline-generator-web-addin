/**
 * T86 item 10 (Fred, the Raised brush's "grout mode": cuts grout joints through bricks wherever it is drawn):
 * core/bricks/grout-cut.js bricksGroutCut. On a real running-bond wall (and a framed board, the cut crossing two
 * elements): nothing is left within the cut, no two pieces overlap, slivers drop, a cut brick's pieces keep its own
 * fields, bricks the cut misses come back untouched, and the area removed is the cut's own (plus dropped slivers).
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { generateBricks, ENGINE_OPTIONS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { bricksGroutCut } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS, MIN_PIECE_FRACTION, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // pairwise overlap checks: see heavy-test-timeout.js

const SET = BRICK_SETS[0], W = 7, H = 9, SCALE = 1 / SET.brickLengthIn; // 1 in bricks
const J = SET.grout.widthIn;
const S = scaledSet(SET, SCALE), MIN = MIN_PIECE_FRACTION * S.brickLengthIn * S.brickHeightIn;
const board = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const area = (p) => Math.abs(signedArea(p));
const wall = () => generateBricks({ boardOutline: board, set: SET, seed: 3, scale: SCALE, suppression: 0, clumping: 0, zones: [{ pattern: 'stretcher' }] }).bricks;
const STRAIGHT = [{ x: 0.4, y: 2.1 }, { x: 6.6, y: 6.3 }];
const CURVED = Array.from({ length: 41 }, (_, i) => ({ x: 0.4 + 6.2 * (i / 40), y: 4.5 + 2.2 * Math.sin((i / 40) * 2 * Math.PI) }));
const lengthOf = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

function check(before, after, line, widthIn, overlapTol = 1e-4) {
  const bad = [];
  // nothing left within the cut: points along the stroke and across it, inside 95% of the half-width
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], len = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    for (let t = 0; t <= 1; t += 0.05) for (const o of [-0.95, 0, 0.95]) {
      const x = a.x + (b.x - a.x) * t + nx * o * widthIn / 2, y = a.y + (b.y - a.y) * t + ny * o * widthIn / 2;
      if (after.some((q) => pointInPolygon(x, y, q.polygon))) bad.push(`a piece at (${x.toFixed(2)},${y.toFixed(2)}) inside the cut`);
    }
  }
  const box = (p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
  const bx = after.map((b) => box(b.polygon));
  for (let i = 0; i < after.length; i++) for (let j = i + 1; j < after.length; j++) {
    const A = bx[i], B = bx[j];
    if (A[1] < B[0] || B[1] < A[0] || A[3] < B[2] || B[3] < A[2]) continue;
    if (area(polygonIntersection(after[i].polygon, after[j].polygon)) > overlapTol) bad.push(`${after[i].id}/${after[j].id} overlap`);
  }
  const byId = new Map(before.map((b) => [String(b.id), b]));
  const cut = after.filter((b) => !before.includes(b));
  for (const p of cut) {
    if (area(p.polygon) < MIN) bad.push(`${p.id} a sliver (${area(p.polygon).toFixed(4)} sq in)`);
    const src = byId.get(String(p.id).replace(/\.\d+$/, ''));
    if (!src || src.sampleId !== p.sampleId || src.flip !== p.flip || src.heightOffset !== p.heightOffset) bad.push(`${p.id} lost its brick's fields`);
  }
  const removed = before.reduce((s, b) => s + area(b.polygon), 0) - after.reduce((s, b) => s + area(b.polygon), 0);
  const dropped = before.length; // generous bound on dropped slivers: each at most one quarter brick
  if (removed < 0.5 * lengthOf(line) * widthIn * 0.3) bad.push(`removed only ${removed.toFixed(3)} sq in`);
  if (removed > lengthOf(line) * widthIn + Math.PI * widthIn ** 2 / 4 + dropped * MIN) bad.push(`removed ${removed.toFixed(3)} sq in, more than the cut`);
  return { bad, cut: cut.length, kept: after.filter((b) => before.includes(b)).length };
}

describe('bricksGroutCut (T86 item 10)', () => {
  it('listed in ENGINE_OPTIONS: generateBricks reads groutCut, so the Raised brush shows its Grout mode', () => {
    expect(ENGINE_OPTIONS).toContain('groutCut');
  });
  for (const [name, line] of [['straight', STRAIGHT], ['curved', CURVED]]) {
    it(`a ${name} cut across running bond: a joint through every brick it crosses, no overlap, no sliver`, () => {
      const before = wall();
      const after = bricksGroutCut(before, line, { widthIn: J, minPieceArea: MIN });
      const r = check(before, after, line, J);
      expect(r.bad.slice(0, 5)).toEqual([]);
      expect(r.cut).toBeGreaterThan(10);
      expect(r.kept).toBeGreaterThan(before.length / 2);
    });
  }
  it('a wide cut drops the slivers it leaves', () => {
    const before = wall();
    const wide = 0.25;
    const after = bricksGroutCut(before, STRAIGHT, { widthIn: wide, minPieceArea: MIN });
    const unfiltered = bricksGroutCut(before, STRAIGHT, { widthIn: wide, minPieceArea: 0 });
    expect(unfiltered.some((b) => area(b.polygon) < MIN)).toBe(true); // there were slivers to drop
    expect(check(before, after, STRAIGHT, wide).bad.slice(0, 5)).toEqual([]);
  });
  it('a cut crossing two elements (the frame band and the wall) cuts both', () => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }), board: { widthIn: W, heightIn: H } }, 0, 0);
    const r = generateBricks({ boardOutline: board, set: SET, seed: 3, scale: SCALE, suppression: 0, clumping: 0, frame: { primitives: buildRibbonPrimitives(sil.primitives), bands: FRAME_PRESETS.single_soldier } });
    const before = [...r.frameBricks, ...r.bricks];
    const line = [{ x: 0.1, y: 8.6 }, { x: 3.5, y: 4.5 }];
    const after = bricksGroutCut(before, line, { widthIn: J, minPieceArea: MIN });
    // overlap tolerance = the frame/wall seam's own hairline residual (worst pair 0.0006 sq in, measured in
    // bricks-wall-region.test.js), there before any cut
    const res = check(before, after, line, J, 1e-3);
    expect(res.bad.slice(0, 5)).toEqual([]);
    const cutKinds = new Set(after.filter((b) => !before.includes(b)).map((b) => (r.frameBricks.some((f) => String(b.id).startsWith(`${f.id}.`)) ? 'frame' : 'wall')));
    expect(cutKinds).toEqual(new Set(['frame', 'wall']));
  });
  it('a dab inside one brick opens no joint: every brick comes back as it was', () => {
    const before = wall();
    const b = before.find((x) => area(x.polygon) > 0.9 * S.brickLengthIn * S.brickHeightIn);
    const c = b.polygon.reduce((s, p) => ({ x: s.x + p.x / b.polygon.length, y: s.y + p.y / b.polygon.length }), { x: 0, y: 0 });
    const after = bricksGroutCut(before, [c], { widthIn: J, minPieceArea: MIN });
    expect(after.every((x, i) => x === before[i])).toBe(true);
  });
  it('no polyline or no width: the bricks as given', () => {
    const before = wall();
    expect(bricksGroutCut(before, [], { widthIn: J })).toBe(before);
    expect(bricksGroutCut(before, STRAIGHT, { widthIn: 0 })).toBe(before);
  });
});
