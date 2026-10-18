/**
 * Fred 2026-10-11 (the Raised brush retired; plan approved with his answers): a brick's own HEIGHT is a declared record --
 * P.brickSettings.heights = [{ id, level, pick: 'points' | 'region', points | region }] (core/bricks/height-records.js),
 * re-matched to the bricks of every lay and carved by the height mask (editor-brick-height-mask.js opts.heights):
 *  (1) a tap's POINTS: the brick under each point (on a size change too);
 *  (2) a box's REGION: the whole bricks whose centroid lies in it, on every lay;
 *  a brick picked by several records takes the latest's level; a board with no record carves exactly as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({
  preloadSetDetail: vi.fn(async () => {}),
  sampleDetailAtFor: vi.fn(() => undefined),
}));

import { rasterizeBrickHeightMask } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js';
import * as tool from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { pointInPolygon, polygonCentroid } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { bricksPickedBy, heightLevelsFor } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/height-records.js';
import { MIGRATIONS } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

const W = 7, H = 9, NX = 141, NZ = 181, SET = BRICK_SETS[0];
const sq = (x0, y0, s) => [{ x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s }];

describe('the records pick bricks by the declared rules', () => {
  const bricks = [{ polygon: sq(0, 0, 1) }, { polygon: sq(1.1, 0, 1) }, { polygon: sq(2.2, 0, 1) }];
  it('(1) a point picks the brick containing it; a point over no brick picks nothing (it stays in the record)', () => {
    expect(bricksPickedBy({ pick: 'points', points: [{ x: 0.5, y: 0.5 }, { x: 2.7, y: 0.2 }, { x: 1.05, y: 0.5 }] }, bricks)).toEqual([0, 2]);
  });
  it('(2) a region picks the WHOLE bricks whose centroid lies in it, not the ones it only touches', () => {
    expect(bricksPickedBy({ pick: 'region', region: sq(0.8, -0.5, 1.2) }, bricks)).toEqual([1]); // brick 0 touched, its centroid out
  });
  it('a brick picked twice takes the latest record\'s level', () => {
    const levels = heightLevelsFor([{ level: 0.06, pick: 'points', points: [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }] }, { level: -0.03, pick: 'points', points: [{ x: 1.5, y: 0.5 }] }], bricks);
    expect([...levels.entries()]).toEqual([[0, 0.06], [1, -0.03]]);
  });
});

/** a Wall in a single-soldier Frame on 7x9, written as drawBrick writes it */
function lay(L, seed = 1) {
  const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed, scale: L / SET.brickLengthIn,
    suppression: 0, clumping: 0, frame: { primitives: tool.buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: W, y2: H })), bands: FRAME_PRESETS.single_soldier } });
  return [...r.bricks.map((b) => ({ b, kind: 'wall' })), ...r.frameBricks.map((b) => ({ b, kind: 'frame' }))];
}
async function mask(laid, opts = {}) {
  const root = document.createElement('div');
  laid.forEach(({ b, kind }, k) => {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', b.polygon.map((p) => `${p.x},${p.y}`).join(' '));
    for (const [a, v] of [['data-layer', 'L'], [tool.BRICK_GEN_ATTR, '1'], ['data-brick', kind], ['data-brick-set', '1'], ['data-brick-seed', '1'],
      ['data-brick-id', `${kind}${k}`], ['data-brick-height-offset', String(b.heightOffset || 0)]]) poly.setAttribute(a, v);
    root.appendChild(poly);
  });
  document.body.appendChild(root);
  try { return await rasterizeBrickHeightMask({ _sketchLayer: { node: root } }, { id: 'L' }, NX, NZ, W, H, opts); } finally { root.remove(); }
}
const sha = (m) => createHash('sha256').update(Buffer.from(m.body.buffer)).digest('hex').slice(0, 16);
const facesOf = (m, laid) => laid.map(({ kind }, k) => m.faces[`${kind}:${kind}${k}`]);

describe('the height mask carves them', () => {
  const laid = lay(1.25);
  it('a board with no record carves byte-identically (absent, [], or a record over no brick)', async () => {
    const GOLDEN = '663944943522f2be'; // the mask on main 734553c, the same fixture (tests/brick-edge-taper.test.js pins it too)
    expect(sha(await mask(laid))).toBe(GOLDEN);
    expect(sha(await mask(laid, { heights: [] }))).toBe(GOLDEN);
    expect(sha(await mask(laid, { heights: [{ id: 'h1', level: 0.06, pick: 'points', points: [{ x: -5, y: -5 }] }] }))).toBe(GOLDEN);
  });
  it('(1) a tap raises exactly the brick under its point by its level; every other face unchanged', async () => {
    const k = laid.findIndex(({ kind }) => kind === 'wall'), c = polygonCentroid(laid[k].b.polygon);
    const before = facesOf(await mask(laid), laid);
    const after = facesOf(await mask(laid, { heights: [{ id: 'h1', level: 0.0625, pick: 'points', points: [c] }] }), laid);
    expect(after[k] - before[k]).toBeCloseTo(0.0625, 6);
    expect(after.filter((f, i) => i !== k && f !== before[i]).length).toBe(0);
  });
  it('(2) a box lowers every whole brick whose centroid lies in it -- wall AND frame', async () => {
    const region = sq(0, 0, 2.5);
    const inside = laid.map(({ b }) => polygonCentroid(b.polygon)).map((c) => pointInPolygon(c.x, c.y, region));
    const before = facesOf(await mask(laid), laid);
    const after = facesOf(await mask(laid, { heights: [{ id: 'h1', level: -0.03, pick: 'region', region }] }), laid);
    expect(inside.filter(Boolean).length).toBeGreaterThan(3);
    expect(laid.some(({ kind }, i) => kind === 'frame' && inside[i])).toBe(true);
    laid.forEach((_, i) => expect(after[i] - before[i], `piece ${i}`).toBeCloseTo(inside[i] ? -0.03 : 0, 6));
  });
  it('a re-lay re-matches the record: a new seed and a size change still raise the brick under the point', async () => {
    const k = laid.findIndex(({ kind }) => kind === 'wall'), c = polygonCentroid(laid[k].b.polygon), rec = [{ id: 'h1', level: 0.05, pick: 'points', points: [c] }];
    for (const again of [lay(1.25, 7), lay(0.75)]) {
      const j = again.findIndex(({ b }) => pointInPolygon(c.x, c.y, b.polygon));
      const before = facesOf(await mask(again), again), after = facesOf(await mask(again, { heights: rec }), again);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(after[j] - before[j]).toBeCloseTo(0.05, 6);
    }
  });
});

describe("migration 'brick-height-records'", () => {
  const m = () => MIGRATIONS.find((x) => x.id === 'brick-height-records');
  it('a board saved before has no heights: it gets [] (it carves as before); a board with records keeps them', () => {
    const old = { brickSettings: { pattern: 'stretcher' } };
    expect(m().when(old)).toBe(true);
    m().apply(old);
    expect(old.brickSettings.heights).toEqual([]);
    const kept = { brickSettings: { heights: [{ id: 'h1', level: 0.06, pick: 'points', points: [{ x: 1, y: 1 }] }] } };
    expect(m().when(kept)).toBe(false);
  });
});
