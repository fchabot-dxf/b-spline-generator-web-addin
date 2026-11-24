/**
 * Fred 2026-11-24: the Z ruler spans the WHOLE BODY -- from the lowest point of the back (a Flat base below 0, a shell dipping
 * under the stock bottom) up to the top -- the same extent the solid mesh has, not the top surface alone. The REAL
 * TerrainPreview.update runs on a stand-in `this` (three.js mocked, as tests/heights-inert-keys.test.js does); the extent it
 * hands the ground grid's ruler (setZExtent) is read back.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { buildThickenData, fillFloorIn } from '../bspline-frame-builder/b-spline-gen/html/core/engine/build-thicken-data.js';
import { TerrainPreview } from '../bspline-frame-builder/b-spline-gen/html/core/preview/index.js';

const THREE = new Proxy({}, {
  get(t, name) {
    if (!(name in t)) t[name] = class {
      constructor(...args) { this.type = name; this.args = args; this.attributes = {}; this.index = null; this.children = []; this.userData = {}; this.position = { set() {}, copy() {} };
        if (name === 'BufferAttribute') [this.array, this.itemSize] = args;
        else if (args.length && args[0] && args[0].attributes) [this.geometry, this.material] = args; }
      setAttribute(k, a) { this.attributes[k] = a; return this; } setIndex(i) { this.index = i; return this; }
      setFromPoints(p) { this.points = p; return this; } add(o) { this.children.push(o); return this; }
      computeVertexNormals() {} computeBoundingBox() {} computeBoundingSphere() {} dispose() {}
    };
    return t[name];
  },
});
function rulerExtentOf(heights, nx, nz, offsetPts, wireframe = false) {
  const seen = {};
  const self = {
    _THREE: THREE, _dispose() {}, _groundGrid: { update() {}, setZExtent(W, H, lo, hi) { seen.lo = lo; seen.hi = hi; } }, _syncZScale() {},
    _sculpt: { getConfig: () => null, reapplySelection() {} }, _scene: { add() {} }, _orbit: { setTargetZ() {}, fitToStock() {} }, _resize() {},
    _leaders: { setData() {} }, _applyFrame() {}, _visibleWorstPts() { return []; }, _rebuildDrapeMesh() {},
    _curvesVisible: false, _lastW: 0, _lastH: 0, _solidMeshes: [],
  };
  TerrainPreview.prototype.update.call(self, heights, nx, nz, 7, 9, 0.9, null, [], false, offsetPts, 0.25, [], [], wireframe, null, false, false);
  return seen;
}
const BASE = { ...DEFAULT, widthIn: 7, heightIn: 9, carveZ: 0.9, seed: 41118, scale: 3.7, noiseType: 'simplex', symmetry: 'x', edgeMargin: 0,
  terrainFit: 'fill', thickenEnabled: true, thickness: 0.125, thickenDir: 'down' };
const NX = 71, NZ = 91;
function board(o) {
  const p = { ...BASE, ...o };
  const { heights } = generateHeightmap({ ...p, nx: NX, nz: NZ, terrainFloorIn: fillFloorIn(p) });
  const t = buildThickenData(heights, NX, NZ, p, {});
  let tlo = Infinity, thi = -Infinity, blo = Infinity, bhi = -Infinity;
  for (const z of heights) { tlo = Math.min(tlo, z); thi = Math.max(thi, z); }
  if (t.data) for (let k = 2; k < t.data.offsetPts.length; k += 3) { blo = Math.min(blo, t.data.offsetPts[k]); bhi = Math.max(bhi, t.data.offsetPts[k]); }
  return { heights, back: t.data && t.data.offsetPts, tlo, thi, blo, bhi };
}

describe('the Z ruler spans the whole body', () => {
  it('Flat with a 0.25 base below 0: from -0.25 up to the top', () => {
    const b = board({ backMode: 'flat', flatBaseDropIn: 0.25 });
    const r = rulerExtentOf(b.heights, NX, NZ, b.back);
    expect(r.lo).toBe(-0.25);
    expect(r.hi).toBe(b.thi);
  });
  it("Shell: from the back's own lowest point (it dips under 0) up to the top", () => {
    const b = board({ backMode: 'shell' });
    expect(b.blo).toBeLessThan(0);
    const r = rulerExtentOf(b.heights, NX, NZ, b.back);
    expect(r.lo).toBe(b.blo);
    expect(r.hi).toBe(Math.max(b.thi, b.bhi));
  });
  it('Thicken off (no back): the top surface alone, as before', () => {
    const b = board({ thickenEnabled: false });
    const r = rulerExtentOf(b.heights, NX, NZ, null);
    expect([r.lo, r.hi]).toEqual([b.tlo, b.thi]);
  });
});
