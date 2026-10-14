/**
 * Fred 2026-10-11 (EDGE TAPER: "the current ones seem particularly tapered, fine, but I want to control it"): each
 * element (Wall, Brick frame, Brush) can override its set's heightProfile.edgeRadiusIn -- P.brickSettings.edgeByElement,
 * the range declared in core/bricks/library.js EDGE_TAPER, read by editor-brick-tool.js elementEdgeRadius and the
 * height mask (opts.edges), which applies it in the SET's place (a surface style still scales it). Untouched = today.
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
import * as lib from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

const { BRICK_SETS, FRAME_PRESETS } = lib;
const W = 7, H = 9, NX = 141, NZ = 181, SET = BRICK_SETS[0];

/** a Wall inside a single-soldier Frame, written as drawBrick writes them (kind = data-brick) */
const laid = (() => {
  const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1,
    scale: 1.25 / SET.brickLengthIn, suppression: 0, clumping: 0,
    frame: { primitives: tool.buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: W, y2: H })), bands: FRAME_PRESETS.single_soldier } });
  return [...r.bricks.map((b) => ({ b, kind: 'wall' })), ...r.frameBricks.map((b) => ({ b, kind: 'frame' }))];
})();
async function mask(opts = {}) {
  const root = document.createElement('div');
  laid.forEach(({ b, kind }, k) => {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', b.polygon.map((p) => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('data-layer', 'L');
    poly.setAttribute(tool.BRICK_GEN_ATTR, '1');
    poly.setAttribute('data-brick', kind);
    poly.setAttribute('data-brick-set', '1');
    poly.setAttribute('data-brick-seed', '1');
    poly.setAttribute('data-brick-id', `${kind}${k}`);
    poly.setAttribute('data-brick-height-offset', String(b.heightOffset || 0));
    root.appendChild(poly);
  });
  document.body.appendChild(root);
  try { return await rasterizeBrickHeightMask({ _sketchLayer: { node: root } }, { id: 'L' }, NX, NZ, W, H, opts); } finally { root.remove(); }
}
const sha = (m) => createHash('sha256').update(Buffer.from(m.body.buffer)).digest('hex').slice(0, 16);
/** the grid points inside a piece of `kind` */
const pointsOf = (kind) => {
  const ks = [];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = (i / (NX - 1)) * W, y = H * (1 - j / (NZ - 1));
    if (laid.some((p) => p.kind === kind && pointInPolygon(x, y, p.b.polygon))) ks.push(j * NX + i);
  }
  return ks;
};
const meanAt = (m, ks) => ks.reduce((s, k) => s + m.body[k], 0) / ks.length;

describe('EDGE_TAPER is declared data', () => {
  it('0 (sharp) up to maxFactor x the widest set default; every set default inside the range', () => {
    const own = (s) => (s.heightProfile && s.heightProfile.edgeRadiusIn) || 0;
    const widest = Math.max(...BRICK_SETS.map(own));
    expect(lib.EDGE_TAPER.minIn).toBe(0);
    expect(lib.EDGE_TAPER.maxIn).toBeCloseTo(lib.EDGE_TAPER.maxFactor * widest, 9);
    for (const s of BRICK_SETS) expect(own(s), String(s.id)).toBeLessThanOrEqual(lib.EDGE_TAPER.maxIn);
  });
  it('elementEdgeRadius: untouched = the element\'s set\'s own; a number wins; the Raised brush shares the Brush\'s', () => {
    const settings = { setIds: { wall: 1, frame: 1, brush: 1, raisedBrush: 1 }, edgeByElement: { wall: null, frame: null, brush: null } };
    for (const kind of ['wall', 'frame', 'brush', 'raisedBrush']) expect(tool.elementEdgeRadius(settings, kind), kind).toBe(SET.heightProfile.edgeRadiusIn);
    expect(tool.elementEdgeRadius({}, 'wall')).toBe(SET.heightProfile.edgeRadiusIn); // a saved board without the field
    const own = { ...settings, edgeByElement: { wall: 0, frame: null, brush: 0.08 } };
    expect([tool.elementEdgeRadius(own, 'wall'), tool.elementEdgeRadius(own, 'frame'), tool.elementEdgeRadius(own, 'raisedBrush')])
      .toEqual([0, SET.heightProfile.edgeRadiusIn, 0.08]);
  });
});

describe('the height mask reads it', () => {
  it('untouched (absent / all null) carves byte-identically to the pre-taper mask', async () => {
    // golden taken on the tree before the taper (origin/main 3cf5b79's code)
    const GOLDEN = '663944943522f2be';
    const none = sha(await mask());
    expect(none).toBe(GOLDEN);
    expect(sha(await mask({ edges: { wall: null, frame: null, brush: null } }))).toBe(GOLDEN);
  });
  it('per element: a Frame taper changes the Frame\'s pieces and not one Wall point', async () => {
    const base = await mask(), sharp = await mask({ edges: { frame: 0 } });
    const wall = pointsOf('wall'), frame = pointsOf('frame');
    expect(wall.filter((k) => sharp.body[k] !== base.body[k]).length).toBe(0);
    expect(frame.filter((k) => sharp.body[k] !== base.body[k]).length).toBeGreaterThan(frame.length * 0.1);
  });
  it('sharp > the set\'s own > wide: a narrower shoulder keeps more of each piece at its top', async () => {
    const frame = pointsOf('frame');
    const [sharp, own, wide] = await Promise.all([mask({ edges: { frame: 0 } }), mask(), mask({ edges: { frame: lib.EDGE_TAPER.maxIn } })]);
    expect(meanAt(sharp, frame)).toBeGreaterThan(meanAt(own, frame) + 1e-3);
    expect(meanAt(own, frame)).toBeGreaterThan(meanAt(wide, frame) + 1e-3);
  });
  it('in the SET\'s place: under Weathered (which scales the shoulder) the set\'s own value as an override changes nothing', async () => {
    const opts = { surfaceStyle: 'weathered', surfaceWear: 0.5 };
    const own = await mask(opts), same = await mask({ ...opts, edges: { wall: SET.heightProfile.edgeRadiusIn, frame: SET.heightProfile.edgeRadiusIn } });
    expect(sha(same)).toBe(sha(own));
  });
});
