/**
 * F35 item 18 (1), brick top FLAT | ORGANIC. Organic (the original): each brick's top drapes over
 * the terrain under it. Flat: each brick is a rigid block on the least-squares plane of the terrain
 * under its footprint; grout stays draped. The mask only says WHICH brick covers each grid point
 * (editor/editor-brick-height-mask.js flatTop.brickOf); the plane is fitted at composite time
 * (core/engine/apply-stamp-layers.js) against the live terrain, so a terrain change that rebuilds
 * without re-rasterizing the mask still lands each brick on the new ground.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({
  preloadSetDetail: vi.fn(async () => {}),
  sampleDetailAtFor: vi.fn(() => undefined),
}));

import { rasterizeBrickHeightMask } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js';
import { BRICK_GEN_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { applyStampLayers, flatBrickPlaneHeights, STAMP_PASS_KIND } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';
import { clearStampMaskInWindow } from '../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js';
import { fitPlane } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/plane-fit.js';

const W = 8, H = 4, NX = 33, NZ = 17; // 0.25 in grid

/** Two real bricks side by side with a 1 in joint between them, the attribute shape the rasterizer reads. */
function fixture() {
  const root = document.createElement('div');
  const add = (id, pts) => {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', pts);
    poly.setAttribute('data-layer', 'L');
    poly.setAttribute(BRICK_GEN_ATTR, '1');
    poly.setAttribute('data-brick-set', '1');
    poly.setAttribute('data-brick-seed', '1');
    poly.setAttribute('data-brick-relief', '0.125');
    poly.setAttribute('data-brick-id', id);
    root.appendChild(poly);
  };
  add('left', '0.6,0.6 3.4,0.6 3.4,3.4 0.6,3.4');
  add('right', '4.6,0.6 7.4,0.6 7.4,3.4 4.6,3.4');
  document.body.appendChild(root);
  return { editor: { _sketchLayer: { node: root } }, layer: { id: 'L' }, cleanup: () => root.remove() };
}
async function masks() {
  const f = fixture();
  const flat = await rasterizeBrickHeightMask(f.editor, f.layer, NX, NZ, W, H, { topMode: 'flat' });
  const organic = await rasterizeBrickHeightMask(f.editor, f.layer, NX, NZ, W, H);
  f.cleanup();
  return { flat, organic };
}

/** A hilly terrain (inches) on the same grid: never planar under a brick. */
const hills = (amp = 0.3, phase = 0) => {
  const t = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) t[j * NX + i] = amp * Math.sin(i * 0.45 + phase) * Math.cos(j * 0.6) + 0.02 * i;
  return t;
};
const brickPoints = (brickOf, b) => [...brickOf.keys()].filter((k) => brickOf[k] === b);
/** Max residual of the best plane through (i, j, z[k]) over `ks` -- 0 for a planar set. */
const planeResidual = (ks, z) => {
  const pl = fitPlane(ks.map((k) => ({ x: k % NX, y: Math.floor(k / NX), z: z[k] })));
  return Math.max(...ks.map((k) => Math.abs(pl.eval(k % NX, Math.floor(k / NX)) - z[k])));
};
const layerOf = (mask, depth) => ({ enabled: true, svg: '<svg/>', mask, depth });

describe('the brick mask in Flat mode', () => {
  it('brickOf names each brick (0, 1), -1 in the joint; Organic carries no flatTop and the same body', async () => {
    const { flat, organic } = await masks();
    expect(organic.flatTop).toBeUndefined();
    expect(flat.flatTop.count).toBe(2);
    const { brickOf } = flat.flatTop;
    expect(brickPoints(brickOf, 0).length).toBeGreaterThan(20);
    expect(brickPoints(brickOf, 1).length).toBe(brickPoints(brickOf, 0).length);
    expect(brickOf[8 * NX + 16]).toBe(-1); // x = 4 in, the middle of the joint
    for (let k = 0; k < NX * NZ; k++) {
      if (organic.isStamped[k]) { expect(brickOf[k]).toBeGreaterThanOrEqual(0); expect(flat.body[k]).toBe(organic.body[k]); }
      if (brickOf[k] < 0) expect(flat.isStamped[k]).toBe(0);
    }
  });

  it('the inset-window hole clears brickOf too', async () => {
    const { flat } = await masks();
    clearStampMaskInWindow(flat, { x1: 0, y1: 0, x2: 4, y2: 4 }, NX, NZ, W, H);
    expect(brickPoints(flat.flatTop.brickOf, 0).length).toBe(0);
    expect(brickPoints(flat.flatTop.brickOf, 1).length).toBeGreaterThan(20);
  });
});

describe('flatBrickPlaneHeights', () => {
  const brickOf = new Int32Array(NX * NZ).fill(-1);
  for (let j = 2; j <= 13; j++) for (let i = 3; i <= 13; i++) brickOf[j * NX + i] = 0;
  const ks = brickPoints(brickOf, 0);

  it('terrain that already IS a plane is reproduced exactly', () => {
    const t = new Float32Array(NX * NZ).map((_, k) => 0.03 * (k % NX) - 0.05 * Math.floor(k / NX) + 1.2);
    const z = flatBrickPlaneHeights(t, brickOf, 1, NX);
    for (const k of ks) expect(z[k]).toBeCloseTo(t[k], 5);
  });
  it('on hills: planar, equal to the least-squares fit, NaN off the brick', () => {
    const t = hills();
    const z = flatBrickPlaneHeights(t, brickOf, 1, NX);
    expect(planeResidual(ks, t)).toBeGreaterThan(0.05); // the ground itself is not flat
    expect(planeResidual(ks, z)).toBeLessThan(1e-5);
    const ref = fitPlane(ks.map((k) => ({ x: k % NX, y: Math.floor(k / NX), z: t[k] })));
    for (const k of ks) expect(z[k]).toBeCloseTo(ref.eval(k % NX, Math.floor(k / NX)), 4);
    expect(Number.isNaN(z[0])).toBe(true);
  });
});

describe('applyStampLayers: Flat vs Organic on hilly terrain', () => {
  const depth = 0.125;
  let flatMask, organicMask, brickOf;
  beforeAll(async () => {
    ({ flat: flatMask, organic: organicMask } = await masks());
    brickOf = flatMask.flatTop.brickOf;
  });
  const base = (out, sign = 1) => out.map((v, k) => v - sign * flatMask.body[k] * depth);

  it('Flat: each brick top (minus its own profile) is one plane; Organic is not; the joint is identical', () => {
    const t = hills();
    const flat = applyStampLayers(t, [layerOf(flatMask, depth)], NX, NZ);
    const organic = applyStampLayers(t, [layerOf(organicMask, depth)], NX, NZ);
    for (const b of [0, 1]) {
      const ks = brickPoints(brickOf, b);
      expect(planeResidual(ks, base(flat))).toBeLessThan(1e-5);
      expect(planeResidual(ks, base(organic))).toBeGreaterThan(0.05);
    }
    for (let k = 0; k < NX * NZ; k++) if (brickOf[k] < 0) expect(flat[k]).toBe(organic[k]);
  });

  it('a terrain change with the SAME mask moves each Flat brick onto the new ground (no stale heights)', () => {
    const t1 = hills(0.3, 0), t2 = hills(0.3, 1.7).map((v) => v + 0.5);
    const flatBase = base(applyStampLayers(t2, [layerOf(flatMask, depth)], NX, NZ));
    for (const b of [0, 1]) {
      const ks = brickPoints(brickOf, b);
      const mean = (a) => ks.reduce((s, k) => s + a[k], 0) / ks.length;
      expect(planeResidual(ks, flatBase)).toBeLessThan(1e-5); // still one rigid plane...
      expect(mean(flatBase)).toBeCloseTo(mean(t2), 4); // ...fitted to the NEW ground (a least-squares plane keeps the mean)
      expect(Math.abs(mean(flatBase) - mean(t1))).toBeGreaterThan(0.3);
    }
  });

  it('Carved (negative depth): same plane, profile subtracted', () => {
    const out = applyStampLayers(hills(), [layerOf(flatMask, -depth)], NX, NZ);
    expect(planeResidual(brickPoints(brickOf, 0), base(out, -1))).toBeLessThan(1e-5);
  });
});

// F35 item 44 (Fred: "if there's a carving in art, the bricks don't work"): a carving art pass below a Flat brick pass.
// Measured live before (7x9 T1, a 0.35 in carve across 20 of 140 Flat bricks): 1,752 points of the crossed bricks off the
// stroke moved (max 0.10 in) and the groove was replaced by each brick's plane. Now: the plane is fitted under the art.
describe('item 44: a carving art pass under Flat bricks (STAMP_PASS_KIND)', () => {
  const depth = 0.125, carve = -0.2;
  let flatMask, organicMask, brickOf;
  beforeAll(async () => {
    ({ flat: flatMask, organic: organicMask } = await masks());
    brickOf = flatMask.flatTop.brickOf;
  });
  // a vertical carving stripe across the LEFT brick only (columns 7-8 = x 1.75-2.0 in)
  const stripe = (k) => { const i = k % NX; return i >= 7 && i <= 8; };
  const artMask = () => {
    const body = new Float32Array(NX * NZ), isStamped = new Uint8Array(NX * NZ);
    for (let k = 0; k < NX * NZ; k++) if (stripe(k)) { body[k] = 1; isStamped[k] = 1; }
    return { body, fillet: new Float32Array(NX * NZ), isStamped };
  };
  const art = () => ({ enabled: true, svg: '<svg/>', mask: artMask(), depth: carve, kind: STAMP_PASS_KIND.art });
  const bricks = (mask) => ({ ...layerOf(mask, depth), kind: STAMP_PASS_KIND.bricks });

  it('the crossed brick keeps its plane off the groove: those points are exactly the no-carve ones', () => {
    const t = hills();
    const without = applyStampLayers(t, [bricks(flatMask)], NX, NZ);
    const withArt = applyStampLayers(t, [art(), bricks(flatMask)], NX, NZ);
    const off = brickPoints(brickOf, 0).filter((k) => !stripe(k));
    expect(off.length).toBeGreaterThan(20);
    for (const k of off) expect(withArt[k]).toBeCloseTo(without[k], 6);
    for (const k of brickPoints(brickOf, 1)) expect(withArt[k]).toBeCloseTo(without[k], 6); // the other brick too
  });

  it('the groove under a Flat brick is the carve itself, the same as under an Organic one', () => {
    const t = hills();
    const fw = applyStampLayers(t, [art(), bricks(flatMask)], NX, NZ), fo = applyStampLayers(t, [bricks(flatMask)], NX, NZ);
    const ow = applyStampLayers(t, [art(), bricks(organicMask)], NX, NZ), oo = applyStampLayers(t, [bricks(organicMask)], NX, NZ);
    const under = brickPoints(brickOf, 0).filter(stripe);
    expect(under.length).toBeGreaterThan(5);
    for (const k of under) {
      expect(fw[k] - fo[k]).toBeCloseTo(carve, 6);
      expect(ow[k] - oo[k]).toBeCloseTo(carve, 6);
    }
  });

  it('art ABOVE the bricks (applied after) still just adds, and a pass with no kind is art', () => {
    const t = hills();
    const after = applyStampLayers(t, [bricks(flatMask), art()], NX, NZ);
    const without = applyStampLayers(t, [bricks(flatMask)], NX, NZ);
    for (const k of brickPoints(brickOf, 0)) expect(after[k] - without[k]).toBeCloseTo(stripe(k) ? carve : 0, 6);
    const { kind, ...untagged } = art();
    expect(kind).toBe('art');
    const legacy = applyStampLayers(t, [untagged, bricks(flatMask)], NX, NZ);
    const tagged = applyStampLayers(t, [art(), bricks(flatMask)], NX, NZ);
    expect([...legacy]).toEqual([...tagged]);
  });
});
