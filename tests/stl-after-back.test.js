/**
 * STL-RELIEF placement 'afterBack' ("After thicken", STL-RELIEF-DESIGN.md 11.5 / 12 / 13): the STL is added to the TOP only; the
 * BACK (thicken's offset surface) is built from the heights as they are WITHOUT the afterBack STL passes.
 *  - core/stl/layer.js stlPass carries the record's placement;
 *  - core/engine/rebuild.js buildHeights stamps the afterBack passes last and hands the heights without them as backBase;
 *  - core/engine/build-thicken-data.js buildThickenData(opts.backFrom) offsets the back from backFrom, analyses the top's own heights;
 *  - main/stl-panel.js: one declared STL_CONTROLS entry ('placement', Before / After thicken).
 * Real shapes: the real buildThickenData / rebuild / panel on a real STL record (createStlLayer) and the real P.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

// count the normals passes (the real computeNormals runs; only the calls are counted)
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/thicken.js', async (importOriginal) => {
  const m = await importOriginal();
  return { ...m, computeNormals: vi.fn(m.computeNormals) };
});

import { computeNormals } from '../bspline-frame-builder/b-spline-gen/html/core/thicken.js';
import { buildThickenData } from '../bspline-frame-builder/b-spline-gen/html/core/engine/build-thicken-data.js';
import { indexMesh, encodeMesh } from '../bspline-frame-builder/b-spline-gen/html/core/stl/mesh.js';
import { stlPass, createStlLayer, _resetStlCachesForTests } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { rebuild, _forgetHeights } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { P, DEFAULT, lastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  renderStlPanel, bindStlPanel, addStlFromBuffer, activeStlLayer, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';
import { ghostState } from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost.js';

const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);

// ── a smooth surface A and A plus a raised bump (B) ─────────────────────────────────────────────────────────────────
const NX = 21, NZ = 21, W = 2, H = 2; // dx = dy = 0.1 in
const surf = (f) => Float32Array.from({ length: NX * NZ }, (_, k) => {
  const x = -W / 2 + (k % NX) * W / (NX - 1), y = -H / 2 + Math.floor(k / NX) * H / (NZ - 1);
  return f(x, y);
});
const A = surf((x, y) => 0.08 * Math.sin(1.3 * x) * Math.cos(0.9 * y));
const BUMP = surf((x, y) => 0.15 * Math.exp(-((x - 0.1) ** 2 + (y + 0.05) ** 2) / (2 * 0.2 ** 2)));
const B = Float32Array.from(A, (z, k) => z + BUMP[k]);
// the P fields buildThickenData reads (tests/build-thicken-data.test.js's shape); UNIFORM = no thin-fill, ADAPTIVE = the app defaults
const UNIFORM = Object.freeze({
  widthIn: W, heightIn: H, thickness: 0.25, thickenEnabled: true,
  thickenMode: 'uniform', thickenDir: 'down', extraThickenThin: 0,
  extraThickenThinFalloff: 0.05, thickenYellowOffset: 0.05,
});
const ADAPTIVE = Object.freeze({ ...UNIFORM, thickenMode: 'adaptive', extraThickenThin: 0.4, thickenYellowOffset: 0.01 });
// thicker than the safe map allows (measured: maxSafe 0.689 on B), no thin-fill: thin (blue) cells, so the colour pin is not all beige
const THICK = Object.freeze({ ...UNIFORM, thickness: 0.8, thickenYellowOffset: 0.01 });

describe('buildThickenData opts.backFrom: the back is offset from backFrom, the top analysed on its own heights', () => {
  for (const [name, params] of [['uniform', UNIFORM], ['adaptive + thin-fill', ADAPTIVE]]) {
    it(`${name}: B with backFrom A has A's back point for point, and B's own thickness (larger by the bump)`, () => {
      const a = buildThickenData(A, NX, NZ, params);
      const b = buildThickenData(B, NX, NZ, params);
      const bFromA = buildThickenData(B, NX, NZ, params, { backFrom: A });
      expect(Array.from(bFromA.data.offsetPts)).toEqual(Array.from(a.data.offsetPts));
      expect(Array.from(bFromA.data.rawOffsetPts)).toEqual(Array.from(a.data.rawOffsetPts));
      expect(Array.from(bFromA.data.clampMap)).toEqual(Array.from(a.data.clampMap));
      expect(Array.from(bFromA.data.offsetPts)).not.toEqual(Array.from(b.data.offsetPts)); // without backFrom the back follows the bump
      // the TOP is B: its normals and the thickness measured from B down to A's back
      expect(Array.from(bFromA.normals)).toEqual(Array.from(b.normals));
      let bumpSum = 0; for (const v of BUMP) bumpSum += v;
      expect(bFromA.sumThk - a.sumThk).toBeGreaterThan(0.5 * bumpSum);
      expect(bFromA.peakZ).toBeCloseTo(Math.max(...B), 6);
    });
  }
  it('backFrom equal to the heights array itself, or of the wrong length, reads as no backFrom', () => {
    const b = buildThickenData(B, NX, NZ, ADAPTIVE);
    for (const backFrom of [B, new Float32Array(NX * NZ - 1)]) {
      const r = buildThickenData(B, NX, NZ, ADAPTIVE, { backFrom });
      expect(Array.from(r.data.offsetPts)).toEqual(Array.from(b.data.offsetPts));
    }
  });
  it('a frozen backHeights (Back locked) beats backFrom', () => {
    const FROZEN = Float32Array.from({ length: NX * NZ }, (_, k) => -0.3 - 0.001 * k);
    const locked = buildThickenData(B, NX, NZ, ADAPTIVE, { backHeights: FROZEN });
    const both = buildThickenData(B, NX, NZ, ADAPTIVE, { backHeights: FROZEN, backFrom: A });
    expect(Array.from(both.data.offsetPts)).toEqual(Array.from(locked.data.offsetPts));
    for (let k = 0; k < NX * NZ; k++) expect(both.data.offsetPts[k * 3 + 2]).toBeCloseTo(FROZEN[k], 6);
  });
});

describe('GUARD: no backFrom = today\'s build (measured on the code BEFORE afterBack)', () => {
  beforeEach(() => { computeNormals.mockClear(); });
  it('the offset points and the top colours hash as before (A and B, uniform and adaptive)', () => {
    const got = {};
    for (const [sn, s] of [['A', A], ['B', B]]) {
      for (const [pn, p] of [['uniform', UNIFORM], ['adaptive', ADAPTIVE], ['thick', THICK]]) {
        const t = buildThickenData(s, NX, NZ, p);
        got[`${sn}/${pn}`] = [sha(t.data.offsetPts), sha(t.data.meshColours)];
      }
    }
    expect(buildThickenData(B, NX, NZ, THICK).counts.thin).toBeGreaterThan(0); // the colour pin covers a non-beige case
    // measured on cf10dccf (before backFrom existed); 4b937f024acd5dcc = all beige
    expect(got).toEqual({
      'A/uniform': ['a43c46fa52d3c4ff', '4b937f024acd5dcc'],
      'A/adaptive': ['a0b9de76df2163f3', '4b937f024acd5dcc'],
      'A/thick': ['96dae4093dce989f', '4b937f024acd5dcc'],
      'B/uniform': ['5511824514276fe8', '4b937f024acd5dcc'],
      'B/adaptive': ['a523502b64d34f17', '4b937f024acd5dcc'],
      'B/thick': ['f11528a3b32f3c1f', '94cc10da3ba74b6b'],
    });
  });
  it('one normals pass without backFrom; two with one', () => {
    buildThickenData(B, NX, NZ, ADAPTIVE);
    expect(computeNormals).toHaveBeenCalledTimes(1);
    computeNormals.mockClear();
    buildThickenData(B, NX, NZ, ADAPTIVE, { backFrom: A });
    expect(computeNormals).toHaveBeenCalledTimes(2);
  });
});

// ── STL records ─────────────────────────────────────────────────────────────────────────────────────────────────────
const tri = (a, b, c) => [...a, ...b, ...c];
function pyramidSoup() {
  const a = [-5, -5, 0], b = [5, -5, 0], c = [5, 5, 0], d = [-5, 5, 0], t = [0, 0, 4];
  return Float32Array.from([tri(a, b, t), tri(b, c, t), tri(c, d, t), tri(d, a, t), tri(a, c, b), tri(a, d, c)].flat());
}
function binaryStl(soup) {
  const n = soup.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true);
  return buf;
}

describe('stlPass carries the record\'s placement', () => {
  beforeEach(() => _resetStlCachesForTests());
  it('a record without the field: withSurface; placement afterBack: afterBack', () => {
    const grid = { nx: 15, nz: 19, widthIn: 7, heightIn: 9 };
    const raw = { id: 'p', unitIn: 0.3, mesh: encodeMesh(indexMesh(pyramidSoup())) }; // a saved record: no placement field
    expect(stlPass(raw, grid).placement).toBe('withSurface');
    expect(stlPass({ ...raw, placement: 'afterBack' }, grid).placement).toBe('afterBack');
    expect(raw).not.toHaveProperty('placement'); // the record is read, never written
  });
});

describe('end to end through the real rebuild: afterBack leaves the back as the board without the STL', () => {
  const KEYS = ['widthIn', 'heightIn', 'spacing', 'stlLayers', 'thickenEnabled', 'jobTimeline'];
  const before = {};
  beforeEach(() => { for (const k of KEYS) before[k] = P[k]; _resetStlCachesForTests(); });
  afterEach(() => { for (const k of KEYS) { if (before[k] === undefined) delete P[k]; else P[k] = before[k]; } _forgetHeights(); });

  async function build(stl) {
    P.stlLayers = [stl];
    _forgetHeights();
    await rebuild({ update() {}, setStlGhosts() {} }, () => {}, () => {});
    return { heights: Float32Array.from(lastResult.heights), offsetPts: Float32Array.from(lastResult.thickenData.offsetPts) };
  }

  it('afterBack: the offset points equal the STL-off board\'s, the heights carry the STL; withSurface: the back moves', async () => {
    Object.assign(P, { widthIn: 5, heightIn: 6, spacing: 0.1, thickenEnabled: true, jobTimeline: null });
    const { record } = createStlLayer({ soup: pyramidSoup(), name: 'pyr', board: { widthIn: 5, heightIn: 6 } }); // 2.5 in wide, 1 in tall
    expect(record).toMatchObject({ raise: true, blend: 'max', placement: 'withSurface' });
    const off = await build({ ...record, enabled: false });
    const after = await build({ ...record, placement: 'afterBack' });
    const withS = await build(record);
    expect(Array.from(after.heights)).not.toEqual(Array.from(off.heights)); // the STL is on the top
    let raised = 0; for (let k = 0; k < off.heights.length; k++) if (after.heights[k] - off.heights[k] > 0.05) raised++;
    expect(raised).toBeGreaterThan(50);
    expect(Array.from(after.heights)).toEqual(Array.from(withS.heights)); // one STL: the same top either way
    expect(Array.from(after.offsetPts)).toEqual(Array.from(off.offsetPts)); // ...but its back is the board's without it
    expect(Array.from(withS.offsetPts)).not.toEqual(Array.from(off.offsetPts)); // Before thicken: the back follows the STL
  }, 60000);
});

describe('panel: the declared Thicken choice', () => {
  const saved = {};
  beforeEach(() => {
    Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 7; P.heightIn = 9;
    P.stlLayers = DEFAULT.stlLayers; // the real boot state: the very same array
    document.body.innerHTML = '<div id="stlLayerBody"></div>';
    _resetStlPanelForTests();
    _resetStlCachesForTests();
    ghostState.visible = true;
  });
  afterEach(() => { if (saved.stl === undefined) delete P.stlLayers; else P.stlLayers = saved.stl; P.widthIn = saved.w; P.heightIn = saved.h; });

  it('renders Before / After thicken (Before active on a new STL); After writes placement afterBack into a NEW record', () => {
    renderStlPanel(document.getElementById('stlLayerBody'));
    const onChange = vi.fn();
    bindStlPanel({ onChange, refreshGhosts: () => {} });
    addStlFromBuffer(binaryStl(pyramidSoup()), 'p.stl');
    const btnBefore = document.querySelector('[data-stl-choice="placement:withSurface"]');
    const btnAfter = document.querySelector('[data-stl-choice="placement:afterBack"]');
    expect(btnBefore).toBeTruthy();
    expect(btnAfter).toBeTruthy();
    expect(btnBefore.textContent).toBe('Before thicken');
    expect(btnAfter.textContent).toBe('After thicken');
    expect(btnBefore.classList.contains('active')).toBe(true);
    const oldList = P.stlLayers, oldRec = activeStlLayer();
    onChange.mockClear();
    btnAfter.click();
    expect(activeStlLayer().placement).toBe('afterBack');
    expect(activeStlLayer()).not.toBe(oldRec);
    expect(P.stlLayers).not.toBe(oldList);
    expect(oldRec.placement).toBe('withSurface'); // copy-on-write: the old record is untouched
    expect(oldList[0]).toBe(oldRec);
    expect(DEFAULT.stlLayers).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-stl-choice="placement:afterBack"]').classList.contains('active')).toBe(true);
  });
});
