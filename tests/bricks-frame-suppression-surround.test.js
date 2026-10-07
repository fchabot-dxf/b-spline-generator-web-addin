/**
 * T86 item 29 (lane-b; seat E took it, seat B offline): the frame bands CRUMBLE by the wall's own rule
 * (suppressFrame + frameSuppression, suppression.js suppressBricks over computeSuppressedCells) and an inset window
 * gets a brick SURROUND laid through the ribbon path (insetSurround, inset-surround.js laySurround). Seat D measured
 * before: suppression reached only the wall fill (bricksFillShape), frame bricks never crumbled, no surround existed.
 * Off = byte-identical lays.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks, ENGINE_OPTIONS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { polygonIntersection, signedArea, polygonCentroid } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { insetWindowOuterRect } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0];
const BOARDS = { t1: ['template_1', 7, 9], t18: ['template_18', 7, 10] };
const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
function primsOf(templateId, W, H) {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId }), board: { widthIn: W, heightIn: H } }, 0, 0);
  return buildRibbonPrimitives(sil.primitives);
}
function input(board, extra = {}) {
  const [tpl, W, H] = BOARDS[board];
  return {
    boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
    set: SET, seed: 11, scale: 1, suppression: 0.2, clumping: 0.3, topBias: 0.8,
    frame: { primitives: primsOf(tpl, W, H), bands: FRAME_PRESETS.single_soldier },
    ...extra,
  };
}
const key = (b) => b.polygon.map((p) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`).join(' ');
const WINDOW = { cx: 0, cy: 0.4, w: 2.4, h: 3 }; // inset-window record shape: centre from the board centre, +y up
const rectOf = (board) => insetWindowOuterRect(WINDOW, BOARDS[board][1], BOARDS[board][2]);

describe('T86 item 29: off is byte-identical', () => {
  it.each(['t1', 't18'])('%s: absent / suppressFrame false / frameSuppression 0 / no surround -> the same lay', (board) => {
    const base = generateBricks(input(board));
    expect(generateBricks(input(board, { suppressFrame: false, frameSuppression: 0.5 }))).toEqual(base);
    expect(generateBricks(input(board, { suppressFrame: true, frameSuppression: 0 }))).toEqual(base);
    expect(generateBricks(input(board, { insetSurround: undefined }))).toEqual(base);
  });
});

describe('T86 item 29: the frame crumbles by the wall rule', () => {
  it.each(['t1', 't18'])('%s: exact count, a subset of the off lay, deterministic by seed', (board) => {
    const off = generateBricks(input(board)).frameBricks;
    const on = generateBricks(input(board, { suppressFrame: true, frameSuppression: 0.3 })).frameBricks;
    expect(on.length).toBe(off.length - Math.round(0.3 * off.length));
    const offKeys = new Set(off.map(key));
    expect(on.every((b) => offKeys.has(key(b)))).toBe(true);
    const again = generateBricks(input(board, { suppressFrame: true, frameSuppression: 0.3 })).frameBricks;
    expect(again.map(key)).toEqual(on.map(key));
    const other = generateBricks(input(board, { suppressFrame: true, frameSuppression: 0.3, seed: 12 })).frameBricks;
    expect(other.map(key)).not.toEqual(on.map(key));
  });

  it('weighted to the top: at topBias 1 the removed pieces sit higher than the kept ones', () => {
    const off = generateBricks(input('t1', { topBias: 1 })).frameBricks;
    const on = generateBricks(input('t1', { topBias: 1, suppressFrame: true, frameSuppression: 0.25 })).frameBricks;
    const kept = new Set(on.map(key));
    const y = (bs) => bs.reduce((s, b) => s + polygonCentroid(b.polygon).y, 0) / bs.length;
    expect(y(off.filter((b) => !kept.has(key(b))))).toBeLessThan(y(on));
  });

  it('the wall is untouched by the frame setting', () => {
    expect(generateBricks(input('t1', { suppressFrame: true, frameSuppression: 0.4 })).bricks).toEqual(generateBricks(input('t1')).bricks);
  });
});

describe('T86 item 29: the inset window surround', () => {
  it.each(['single_soldier', 'soldier_stretcher', 'three_band'])('T1, %s: around the window, its inner edge on the window, nothing inside, no wall overlap', (preset) => {
    const r = rectOf('t1');
    const res = generateBricks(input('t1', { suppression: 0, insetSurround: { rect: r, preset } }));
    const ring = res.surroundBricks;
    expect(ring.length).toBeGreaterThan(20);
    const inside = (p) => p.x > r.x1 + 1e-6 && p.x < r.x2 - 1e-6 && p.y > r.y1 + 1e-6 && p.y < r.y2 - 1e-6;
    expect(ring.filter((b) => b.polygon.some(inside)).length).toBe(0);
    // the ring touches all four window edges (its inner edge is the window)
    const touches = (edge) => ring.some((b) => b.polygon.some(edge));
    expect([(p) => Math.abs(p.x - r.x1) < 1e-6, (p) => Math.abs(p.x - r.x2) < 1e-6, (p) => Math.abs(p.y - r.y1) < 1e-6, (p) => Math.abs(p.y - r.y2) < 1e-6].every(touches)).toBe(true);
    // the wall flows around the ring and leaves the window empty
    expect(res.bricks.filter((b) => inside(polygonCentroid(b.polygon))).length).toBe(0);
    let overlap = 0;
    for (const w of res.bricks) for (const s of ring) overlap += area(polygonIntersection(w.polygon, s.polygon));
    expect(overlap).toBeLessThan(1e-6);
  });

  it('every corner is a mitre by default: each window corner has pieces cut on the diagonal; a declared butt corner changes them', () => {
    const r = rectOf('t1');
    const ring = generateBricks(input('t1', { insetSurround: { rect: r, preset: 'single_soldier' } })).surroundBricks;
    const diagonalAt = (cx, cy) => ring.some((b) => b.polygon.some((p, i) => {
      const q = b.polygon[(i + 1) % b.polygon.length];
      const J = SET.grout.widthIn; // two mitred pieces meet with a joint along the diagonal: their ends sit within it of the corner
      const near = Math.hypot(p.x - cx, p.y - cy) < J || Math.hypot(q.x - cx, q.y - cy) < J;
      return near && Math.abs(Math.abs(q.x - p.x) - Math.abs(q.y - p.y)) < 1e-6 && Math.abs(q.x - p.x) > 1e-6;
    }));
    expect([[r.x1, r.y1], [r.x2, r.y1], [r.x2, r.y2], [r.x1, r.y2]].every(([x, y]) => diagonalAt(x, y))).toBe(true);
    const butt = generateBricks(input('t1', { insetSurround: { rect: r, preset: 'single_soldier', corner: 'butt' } })).surroundBricks;
    expect(butt.map(key)).not.toEqual(ring.map(key));
  });

  it('an unknown / empty preset or an invalid rect lays no surround', () => {
    const r = rectOf('t1');
    expect(generateBricks(input('t1', { insetSurround: { rect: r, preset: 'none' } })).surroundBricks).toBeUndefined();
    expect(generateBricks(input('t1', { insetSurround: { rect: { x1: 3, y1: 3, x2: 2, y2: 4 }, preset: 'single_soldier' } })).surroundBricks).toBeUndefined();
  });
});

describe('T86 item 29: declared on ENGINE_OPTIONS', () => {
  it('suppressFrame, frameSuppression, insetSurround', () => {
    expect(ENGINE_OPTIONS).toEqual(expect.arrayContaining(['suppressFrame', 'frameSuppression', 'insetSurround']));
  });
});
