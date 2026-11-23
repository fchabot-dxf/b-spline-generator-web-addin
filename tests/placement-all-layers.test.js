/**
 * Fred 2026-11-23 ("in case I want to carve instead of raise"): a VECTOR STAMP LAYER and the BRICKS get the Thicken placement
 * the STL and height patches have -- 'withSurface' (Before thicken: the back follows them; the default and every saved board)
 * or 'afterBack' (After thicken: the top only, the back is thickened from the heights without them).
 *  - core/stamp/placement.js: the one table (values, absent = withSurface);
 *  - core/engine/rebuild.js _collectStampPasses: the art pass carries the layer's `placement`, the brick pass
 *    P.brickSettings.placement (read with the brick depth by main/stamp-mask-manager.js as layer._brickPlacement: the heights
 *    stage never reads P.brickSettings); buildHeights' ONE 'afterBack' split reads PLACEMENT_PASS_KINDS.
 * Real shapes: the real rebuild on the real P, an editor roster stand-in with real mask arrays (the shape
 * main/stamp-mask-manager.js sets: layer._mask = a body array, layer._brickMask = { body, fillet, isStamped }).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P, lastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { rebuild, _forgetHeights, _collectStampPasses } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { resolveGrid } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { PLACEMENT_PASS_KINDS, STAMP_PASS_KIND } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';
import { STAMP_PLACEMENTS, placementOf } from '../bspline-frame-builder/b-spline-gen/html/core/stamp/placement.js';
import { STL_PLACEMENTS } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { HEIGHT_PLACEMENTS } from '../bspline-frame-builder/b-spline-gen/html/core/height/layer.js';
import { LAYER_TOOLING_FIELDS, restoreLayerTooling } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';

const W = 5, H = 6, SP = 0.1;
/** A disc of radius r (inches) at (cx, cy) on the build's grid: 1 inside, a soft rim. */
function disc(nx, nz, cx, cy, r) {
  return Float32Array.from({ length: nx * nz }, (_, k) => {
    const x = -W / 2 + (k % nx) * W / (nx - 1), y = -H / 2 + Math.floor(k / nx) * H / (nz - 1);
    const d = Math.hypot(x - cx, y - cy);
    return d <= r ? 1 : d <= r + 0.15 ? 1 - (d - r) / 0.15 : 0;
  });
}
const artLayer = (nx, nz, extra = {}) => ({
  id: 'L1', name: 'Carving', visible: true, carve: true, depth: -0.2, profile: 'flat', angle: 90,
  blur: 0, smoothing: 15, suppression: 0.15, edgeFilletRadius: 0, filletPower: 2.2,
  _mask: disc(nx, nz, 0.3, -0.2, 1.1), ...extra,
});
const brickLayer = (nx, nz) => {
  const body = disc(nx, nz, -0.4, 0.5, 1.2);
  return { id: 'B1', name: 'Bricks', visible: true, carve: true, depth: 0.25, profile: 'vbit', suppression: 0, smoothing: 0,
    filletPower: 2.2, _brickMask: { body, fillet: null, isStamped: Uint8Array.from(body, (v) => (v > 0 ? 1 : 0)) }, _brickDepth: -0.15 };
};

const KEYS = ['widthIn', 'heightIn', 'spacing', 'thickenEnabled', 'jobTimeline', 'stlLayers', 'heightLayers', 'brickSettings'];
const saved = {};
beforeEach(() => {
  for (const k of KEYS) saved[k] = P[k];
  Object.assign(P, { widthIn: W, heightIn: H, spacing: SP, thickenEnabled: true, jobTimeline: null, stlLayers: [], heightLayers: [] });
  P.brickSettings = { ...(saved.brickSettings || {}) };
  delete P.brickSettings.placement;
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete P[k]; else P[k] = saved[k]; }
  window.svgEditor = null;
  _forgetHeights();
});

async function build(layers) {
  window.svgEditor = { _layers: layers };
  _forgetHeights();
  await rebuild({ update() {}, setStlGhosts() {} }, () => {}, () => {});
  return { heights: Float32Array.from(lastResult.heights), offsetPts: Float32Array.from(lastResult.thickenData.offsetPts) };
}
const same = (a, b) => a.length === b.length && a.every((v, k) => v === b[k]);

describe('the one placement table', () => {
  it('two values, absent / unknown = withSurface; STL and height patches read the same table', () => {
    expect(STAMP_PLACEMENTS).toEqual(['withSurface', 'afterBack']);
    expect(STL_PLACEMENTS).toBe(STAMP_PLACEMENTS);
    expect(HEIGHT_PLACEMENTS).toBe(STAMP_PLACEMENTS);
    expect([placementOf(undefined), placementOf('x'), placementOf('afterBack')]).toEqual(['withSurface', 'withSurface', 'afterBack']);
    expect(PLACEMENT_PASS_KINDS).toEqual([STAMP_PASS_KIND.art, STAMP_PASS_KIND.bricks, STAMP_PASS_KIND.stl, STAMP_PASS_KIND.height]);
  });
});

describe('the passes carry the placement (absent = withSurface: a saved board is unchanged)', () => {
  it('a layer and brick settings without the field: both passes withSurface; set: afterBack', () => {
    const { nx, nz } = resolveGrid(W, H, SP);
    const layer = { ...artLayer(nx, nz), _brickMask: brickLayer(nx, nz)._brickMask, _brickDepth: -0.15 };
    window.svgEditor = { _layers: [layer] };
    let passes = _collectStampPasses(nx, nz);
    expect(passes.map((p) => [p.kind, p.placement])).toEqual([['art', 'withSurface'], ['bricks', 'withSurface']]);
    expect(layer).not.toHaveProperty('placement'); // read, never written
    layer.placement = 'afterBack';
    layer._brickPlacement = 'afterBack'; // main/stamp-mask-manager.js: placementOf(P.brickSettings.placement), set with _brickDepth
    passes = _collectStampPasses(nx, nz);
    expect(passes.map((p) => [p.kind, p.placement])).toEqual([['art', 'afterBack'], ['bricks', 'afterBack']]);
  });
});

describe('end to end through the real rebuild: After thicken leaves the back as the board without it', () => {
  it('a carved vector layer: the back equals the layer-free board\'s, the top carries the carving (= Before thicken\'s top)', async () => {
    const { nx, nz } = resolveGrid(W, H, SP);
    const off = await build([]);
    const withS = await build([artLayer(nx, nz)]);
    const after = await build([artLayer(nx, nz, { placement: 'afterBack' })]);
    let carved = 0; for (let k = 0; k < off.heights.length; k++) if (off.heights[k] - after.heights[k] > 0.1) carved++;
    expect(carved).toBeGreaterThan(200);                          // the carving is on the top
    expect(same(after.heights, withS.heights)).toBe(true);        // one layer: the same top either way
    expect(same(after.offsetPts, off.offsetPts)).toBe(true);      // ...but the back is the board's without it
    expect(same(withS.offsetPts, off.offsetPts)).toBe(false);     // Before thicken: the back follows the carving
  }, 60000);

  it('carved bricks: the same (P.brickSettings.placement, carried by the mask manager as layer._brickPlacement)', async () => {
    const { nx, nz } = resolveGrid(W, H, SP);
    const off = await build([]);
    const withS = await build([brickLayer(nx, nz)]);
    const after = await build([{ ...brickLayer(nx, nz), _brickPlacement: 'afterBack' }]);
    let carved = 0; for (let k = 0; k < off.heights.length; k++) if (off.heights[k] - after.heights[k] > 0.1) carved++;
    expect(carved).toBeGreaterThan(200);
    expect(same(after.heights, withS.heights)).toBe(true);
    expect(same(after.offsetPts, off.offsetPts)).toBe(true);
    expect(same(withS.offsetPts, off.offsetPts)).toBe(false);
  }, 60000);
});

describe('the layer field is saved and undone like the other stamp settings', () => {
  it('in the undo tooling fields; a restore of a snapshot taken without it removes it again (absent = Before thicken)', () => {
    expect(LAYER_TOOLING_FIELDS).toContain('placement');
    const layers = [{ id: 'a', depth: 0.25, placement: 'afterBack' }];
    restoreLayerTooling(layers, [{ id: 'a', depth: 0.25 }]);
    expect(layers[0]).not.toHaveProperty('placement');
    restoreLayerTooling(layers, [{ id: 'a', depth: 0.25, placement: 'afterBack' }]);
    expect(layers[0].placement).toBe('afterBack');
  });
});
