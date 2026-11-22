/**
 * HEIGHT-PAINTER slice 1: a height patch record (P.heightLayers[i], core/height/layer.js) becomes ONE stamp pass of kind
 * 'height', appended after the STL passes (core/engine/rebuild.js _collectStampPasses), stamped by the STL branches of
 * core/engine/apply-stamp-layers.js (Add / Max, Raised / Carved, Z offset, Follow / Level, before / after thicken).
 * Frame: buildHeightField's -- column i at x = -W/2 + i*dx, row j at y = -H/2 + j*dy, a LARGER row is UP.
 * The raster's own frame: pixel (c, r) centre at u = -w/2 + (c + 0.5) w/cols, v = -h/2 + (r + 0.5) h/rows (row 0 = the
 * patch's BOTTOM edge, +v up); the patch turns by `rotation` degrees counter-clockwise (as seen with +Y up).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { encodeRaster, _resetRasterCacheForTests } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import {
  HEIGHT_LAYER_DEFAULTS, normaliseHeightLayer, heightPass, heightPasses, boardToPatchPixel, _resetHeightCachesForTests,
} from '../bspline-frame-builder/b-spline-gen/html/core/height/layer.js';
import { _collectStampPasses } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { applyStampLayers } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';

const W = 4, H = 4, NX = 41, NZ = 41; // dx = dy = 0.1 in
const GRID = { nx: NX, nz: NZ, widthIn: W, heightIn: H };
const F02 = Math.f16round(0.2); // the stored (Float16) value of 0.2 in
const cell = (x, y) => Math.round((y + H / 2) / 0.1) * NX + Math.round((x + W / 2) / 0.1);

/** A 2 x 1 in patch at 100 px/in, a 0.2 in high disc (r 0.1 in) centred at u = +0.5, v = 0 (right of the patch centre). */
async function discRecord(over = {}) {
  const cols = 200, rows = 100, data = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = -1 + (c + 0.5) / 100, v = -0.5 + (r + 0.5) / 100;
    if (Math.hypot(u - 0.5, v) <= 0.1) data[r * cols + c] = 0.2;
  }
  return { ...normaliseHeightLayer({}), id: 'hp1', name: 'Disc', sizeIn: { w: 2, h: 1 }, raster: await encodeRaster(data, cols, rows), ...over };
}

const saved = {};
beforeEach(() => {
  _resetRasterCacheForTests(); _resetHeightCachesForTests();
  Object.assign(saved, { w: P.widthIn, h: P.heightIn, hl: P.heightLayers, stl: P.stlLayers });
  P.widthIn = W; P.heightIn = H; delete P.stlLayers;
});
afterEach(() => { P.widthIn = saved.w; P.heightIn = saved.h; P.heightLayers = saved.hl; P.stlLayers = saved.stl; delete window.svgEditor; });

describe('the record', () => {
  it('declared defaults (absent fields read as these; the STL stamp options keep their meanings)', () => {
    expect(HEIGHT_LAYER_DEFAULTS).toEqual({
      v: 1, enabled: true, name: 'Height', position: { x: 0, y: 0 }, rotation: 0, sizeIn: null, pxPerIn: 100,
      raise: true, blend: 'add', zOffset: 0, placement: 'withSurface',
    });
    const n = normaliseHeightLayer({ position: { x: 2 }, blend: 'nope' });
    expect(n.position).toEqual({ x: 2, y: 0 });
    expect(n.blend).toBe('add');
  });
  it('Fred 2026-11-22 ("No rigid"): a patch ALWAYS follows the terrain like an SVG layer -- heights += value on a slope, even for a record that says Level', async () => {
    const slope = Float32Array.from({ length: NX * NZ }, (_, k) => 0.1 + 0.02 * (k % NX) + 0.03 * Math.floor(k / NX));
    for (const over of [{}, { surface: 'level' }]) {
      const p = heightPass(await discRecord({ position: { x: 1, y: -1 }, ...over }), GRID);
      expect('surface' in p).toBe(false);
      expect('pivot' in p).toBe(false);
      const out = applyStampLayers(slope, [p], NX, NZ);
      expect(out[cell(1.5, -1)] - slope[cell(1.5, -1)]).toBeCloseTo(F02, 6); // on the terrain there, not a level top
      expect(out[cell(1, -1)]).toBe(slope[cell(1, -1)]);
    }
  });
});

describe('heightPass: a known disc at a known place', () => {
  it('unturned at (1, -1): the disc lands at (1.5, -1); the patch centre and outside the patch are not covered', async () => {
    const p = heightPass(await discRecord({ position: { x: 1, y: -1 } }), GRID);
    expect(p).toMatchObject({ kind: 'height', id: 'height:hp1', blend: 'add', carve: false, depth: 1, zOffset: 0 });
    expect(p.mask.body[cell(1.5, -1)]).toBeCloseTo(F02, 9);
    expect(p.mask.isStamped[cell(1.5, -1)]).toBe(1);
    expect(p.mask.body[cell(1, -1)]).toBe(0);       // inside the patch, unpainted: transparent
    expect(p.mask.isStamped[cell(1, -1)]).toBe(0);
    expect(p.mask.body[cell(-1, 1)]).toBe(0);       // outside the patch
  });
  it('turned 90 degrees (counter-clockwise, +Y up): the disc right of the centre goes ABOVE it -- (1, -0.5), a larger row', async () => {
    const p = heightPass(await discRecord({ position: { x: 1, y: -1 }, rotation: 90 }), GRID);
    expect(p.mask.body[cell(1, -0.5)]).toBeCloseTo(F02, 9);
    expect(p.mask.body[cell(1.5, -1)]).toBe(0);
    expect(p.mask.body[cell(1, -1.5)]).toBe(0);     // not below: the turn is counter-clockwise
  });
  it('boardToPatchPixel is the same mapping (the painter uses it for the pointer)', async () => {
    const rec = await discRecord({ position: { x: 1, y: -1 }, rotation: 90 });
    const q = boardToPatchPixel(rec, 1, -0.5);
    expect(q.inside).toBe(true);
    expect(q.c).toBeCloseTo(149.5, 9);
    expect(q.r).toBeCloseTo(49.5, 9);
    expect(boardToPatchPixel(rec, 3, 3).inside).toBe(false);
  });
  it('stamped with Add on a flat board: +0.2 there (Raised), -0.2 (Carved), nothing elsewhere; Z offset only where painted', async () => {
    const clean = new Float32Array(NX * NZ).fill(0.5);
    const up = applyStampLayers(clean, [heightPass(await discRecord({ position: { x: 1, y: -1 } }), GRID)], NX, NZ);
    expect(up[cell(1.5, -1)]).toBeCloseTo(0.5 + F02, 7);
    expect(up[cell(1, -1)]).toBe(0.5);
    const down = applyStampLayers(clean, [heightPass(await discRecord({ position: { x: 1, y: -1 }, raise: false }), GRID)], NX, NZ);
    expect(down[cell(1.5, -1)]).toBeCloseTo(0.5 - F02, 7);
    const z = applyStampLayers(clean, [heightPass(await discRecord({ position: { x: 1, y: -1 }, zOffset: 0.05 }), GRID)], NX, NZ);
    expect(z[cell(1.5, -1)]).toBeCloseTo(0.55 + F02, 7);
    expect(z[cell(1, -1)]).toBe(0.5);
  });
  it('a disabled record, or one without a raster, gives no pass', async () => {
    expect(heightPass(await discRecord({ enabled: false }), GRID)).toBeNull();
    expect(heightPass({ id: 'x' }, GRID)).toBeNull();
  });
  it('a raster not decoded yet gives no pass this build (the rebuild decodes first; core/engine/rebuild.js)', async () => {
    const rec = JSON.parse(JSON.stringify(await discRecord()));
    _resetRasterCacheForTests(); _resetHeightCachesForTests();
    expect(heightPasses([rec], GRID)).toEqual([]);
  });
});

describe('the pass joins the build after the STL passes', () => {
  it('_collectStampPasses (grid-aware): editor art, then the height pass last', async () => {
    window.svgEditor = { _layers: [{ id: 'a', visible: true, carve: true, depth: 0.2, profile: 'flat', _mask: { body: new Float32Array(NX * NZ), fillet: null, isStamped: new Uint8Array(NX * NZ) } }] };
    P.heightLayers = [await discRecord()];
    expect(_collectStampPasses(NX, NZ).map((p) => [p.id, p.kind])).toEqual([['a', 'art'], ['height:hp1', 'height']]);
  });
});
