/**
 * STL-RELIEF, Fred 2026-11-22: per STL, 'Follow the terrain' (the default = today exactly) or 'Level' (one rigid object at the
 * terrain height under its centre + Z: the terrain is filled or cut to it), and the ghost's colours for a Level STL read the LOCAL
 * terrain. Real meshes (createStlLayer), the real pass (stlPass) and the real applyStampLayers, on a SLOPED clean surface.
 *
 *  - GUARD (measured on the code BEFORE 'Level' existed): follow (absent `surface`) stamps byte-identical heights.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createStlLayer, stlPass, normaliseStlLayer, STL_LAYER_DEFAULTS, STL_SURFACES, _resetStlCachesForTests,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { indexMesh, encodeMesh } from '../bspline-frame-builder/b-spline-gen/html/core/stl/mesh.js';
import { ghostGeometry, surfaceAt, STL_GHOST_COLOURS } from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost.js';
import { applyStampLayers } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  STL_CONTROLS, renderStlPanel, bindStlPanel, addStlFromSoup, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';

const tri = (a, b, c) => [...a, ...b, ...c];
/** A closed square pyramid over [-5,5]^2 at z = 0, apex (0, 0, 4). */
function pyramid() {
  const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
  return Float32Array.from([tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T), tri(A, C, B), tri(A, D, C)].flat());
}
const GRID = { nx: 41, nz: 41, widthIn: 20, heightIn: 20 }; // dx = dy = 0.5; row j at y = -10 + j*0.5
const N = GRID.nx * GRID.nz;
/** The sloped clean surface: z = 0.1 i + 0.05 j (rises to the right and UP the board). */
const SLOPE = () => Float32Array.from({ length: N }, (_, k) => 0.1 * (k % GRID.nx) + 0.05 * Math.floor(k / GRID.nx));
const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
/** A real imported record (createStlLayer: welded, stored, fitted: unitIn = 1 on this 20 x 20 board), placed off-centre. */
function record(extra = {}) {
  const { record: r } = createStlLayer({ soup: pyramid(), name: 'pyr', board: { widthIn: GRID.widthIn, heightIn: GRID.heightIn } });
  return { ...r, id: 'pyr', position: { x: 1.3, y: -2.1, z: -0.4 }, ...extra };
}
const stamp = (rec, clean = SLOPE()) => applyStampLayers(clean, [stlPass(rec, GRID)], GRID.nx, GRID.nz);

beforeEach(() => _resetStlCachesForTests());
afterEach(() => _resetStlCachesForTests());

describe('GUARD (measured before Level): follow = an absent `surface` stamps exactly today\'s heights on a slope', () => {
  // sha256 (first 16 hex) of the stamped Float32Array, measured on 4dab80ff (before 'surface' existed)
  const PINS = {
    'max raised': '545c30a30f7d84ec',
    'max carved': '5e12cb6f66c44931',
    'add raised': '67f48b6a5ba7d6ec',
    'add carved': '841192eb6ff8816c',
  };
  for (const blend of ['max', 'add']) for (const raise of [true, false]) {
    const name = `${blend} ${raise ? 'raised' : 'carved'}`;
    it(name, () => {
      const rec = record({ blend, raise });
      delete rec.surface; // absent: a record saved before the option
      const h = stamp(rec);
      expect(sha(h)).not.toBe(sha(SLOPE())); // it did stamp
      expect(sha(h)).toBe(PINS[name]);
      expect(sha(stamp({ ...rec, surface: 'follow' }))).toBe(PINS[name]); // 'follow' written = absent
    });
  }
});

/** The test's own bilinear read of a grid at fractional (fi, fj) (row-major, nx columns). */
const bilinear = (h, fi, fj) => {
  const i0 = Math.floor(fi), j0 = Math.floor(fj), ti = fi - i0, tj = fj - j0, at = (i, j) => h[j * GRID.nx + i];
  return (at(i0, j0) * (1 - ti) + at(i0 + 1, j0) * ti) * (1 - tj) + (at(i0, j0 + 1) * (1 - ti) + at(i0 + 1, j0 + 1) * ti) * tj;
};

describe('stlPass: surface and the pivot in fractional grid coordinates', () => {
  it('Level carries surface and pivot = ((x + W/2) / dx, (y + H/2) / dy); +y = a LARGER row (buildHeightField\'s frame)', () => {
    const p = stlPass(record({ surface: 'level' }), GRID);
    expect(p.surface).toBe('level');
    expect(p.pivot[0]).toBeCloseTo((1.3 + 10) / 0.5, 9); // 22.6
    expect(p.pivot[1]).toBeCloseTo((-2.1 + 10) / 0.5, 9); // 15.8
    const up = stlPass(record({ surface: 'level', position: { x: 1.3, y: 2.1, z: 0 } }), GRID);
    expect(up.pivot[1]).toBeCloseTo(24.2, 9);
    expect(up.pivot[1]).toBeGreaterThan(p.pivot[1]);
    const g2 = { nx: 21, nz: 31, widthIn: 10, heightIn: 12 }; // dx = 0.5, dy = 0.4
    expect(stlPass(record({ surface: 'level', position: { x: -1, y: 3, z: 0 } }), g2).pivot).toEqual([(-1 + 5) / 0.5, (3 + 6) / 0.4]);
  });
  it('follow (absent or written) carries surface "follow" and no pivot', () => {
    const rec = record(); delete rec.surface;
    for (const r of [rec, { ...rec, surface: 'follow' }]) {
      const p = stlPass(r, GRID);
      expect(p.surface).toBe('follow');
      expect('pivot' in p).toBe(false);
    }
  });
});

describe('Level on the slope: one rigid object at the terrain height under its centre (+ Z)', () => {
  const setup = (blend, raise, z = -0.4) => {
    const rec = record({ surface: 'level', blend, raise, position: { x: 1.3, y: -2.1, z } });
    const clean = SLOPE();
    const pass = stlPass(rec, GRID);
    const base = bilinear(clean, pass.pivot[0], pass.pivot[1]);
    const objH = (k) => z + pass.mask.body[k] * Math.abs(pass.depth);
    const covered = (k) => !!pass.mask.isStamped[k];
    return { clean, pass, base, objH, covered, h: stamp(rec, clean) };
  };
  it('the base is the bilinear terrain under the pivot (3.05 on this slope)', () => {
    const { base } = setup('max', true);
    expect(base).toBeCloseTo(0.1 * 22.6 + 0.05 * 15.8, 5);
  });
  const FORMULA = {
    'max raised': (c, b, o) => Math.max(c, b + o),
    'add raised': (c, b, o) => b + o,
    'max carved': (c, b, o) => Math.min(c, b - o),
    'add carved': (c, b, o) => b - o,
  };
  for (const blend of ['max', 'add']) for (const raise of [true, false]) {
    const name = `${blend} ${raise ? 'raised' : 'carved'}`;
    it(`${name}: every covered point = the formula exactly; every uncovered point unchanged`, () => {
      const { clean, base, objH, covered, h } = setup(blend, raise);
      let nCov = 0;
      for (let k = 0; k < N; k++) {
        if (covered(k)) { nCov++; expect(h[k]).toBe(Math.fround(FORMULA[name](clean[k], base, objH(k)))); }
        else expect(h[k]).toBe(clean[k]);
      }
      expect(nCov).toBeGreaterThan(100);
    });
  }
  it('uphill: Max leaves the terrain where it is higher than the object, Add cuts it down to the object', () => {
    const max = setup('max', true, 0), add = setup('add', true, 0);
    const uphill = [];
    for (let k = 0; k < N; k++) if (max.covered(k) && max.clean[k] > max.base + max.objH(k) + 0.05) uphill.push(k);
    expect(uphill.length).toBeGreaterThan(10);
    for (const k of uphill) {
      expect(max.h[k]).toBe(max.clean[k]);
      expect(add.h[k]).toBe(Math.fround(add.base + add.objH(k)));
      expect(add.h[k]).toBeLessThan(add.clean[k]);
    }
  });
  it('follow on the same slope is NOT level: its covered points ride the terrain (the two options differ)', () => {
    const lvl = setup('add', true);
    const rec = record({ blend: 'add', raise: true }); delete rec.surface;
    const fol = stamp(rec);
    let differ = 0;
    for (let k = 0; k < N; k++) if (lvl.covered(k) && Math.abs(fol[k] - lvl.h[k]) > 1e-4) differ++;
    expect(differ).toBeGreaterThan(100);
  });
});

describe('the record field', () => {
  it('declared: surface defaults to follow, STL_SURFACES lists follow and level, normalise reads an unknown value as follow', () => {
    expect(STL_LAYER_DEFAULTS.surface).toBe('follow');
    expect(STL_SURFACES).toEqual(['follow', 'level']);
    expect(normaliseStlLayer({}).surface).toBe('follow');
    expect(normaliseStlLayer({ surface: 'level' }).surface).toBe('level');
    expect(normaliseStlLayer({ surface: 'tilted' }).surface).toBe('follow');
    const raw = { surface: 'tilted' };
    normaliseStlLayer(raw);
    expect(raw).toEqual({ surface: 'tilted' }); // never written back
  });
});

describe('the ghost of a Level STL', () => {
  const ghostRec = (extra = {}) => ({ ...normaliseStlLayer({ id: 'g', unitIn: 1, mesh: encodeMesh(indexMesh(pyramid())) }), surface: 'level', ...extra });
  /** the vertex nearest scene (x, y) at mesh z = 0 (a base corner) */
  const cornerAt = (g, x, y) => {
    let best = -1, d = Infinity;
    for (let v = 0; v < g.positions.length / 3; v++) {
      const dd = Math.hypot(g.positions[v * 3] - x, g.positions[v * 3 + 1] - y);
      if (dd < d) { d = dd; best = v; }
    }
    return best;
  };
  const colourOf = (g, v) => Array.from(g.colours.slice(v * 3, v * 3 + 3)).map((c) => +c.toFixed(3));
  const same = (c) => c.map((x) => +x.toFixed(3));
  it('rigid on the slope: vertices with the same mesh z sit at the same height (the terrain under the pivot + Z)', () => {
    const clean = SLOPE();
    const g = ghostGeometry(ghostRec({ position: { x: 1.3, y: -2.1, z: 0 } }), clean, GRID);
    const a = cornerAt(g, 1.3 - 5, -2.1 - 5), b = cornerAt(g, 1.3 + 5, -2.1 - 5), c = cornerAt(g, 1.3 + 5, -2.1 + 5);
    const base = surfaceAt(clean, GRID, 1.3, -2.1);
    for (const v of [a, b, c]) expect(g.positions[v * 3 + 2]).toBeCloseTo(base, 5);
    expect(g.place.baseZ).toBeCloseTo(base, 6);
  });
  it('colours read the LOCAL terrain: a base corner over a terrain bump is buried, the same corner as follow meets', () => {
    const bumped = new Float32Array(N); // flat 0 with a 1 in bump under the corner at scene (-3.7, -7.1)
    for (let j = 4; j <= 7; j++) for (let i = 11; i <= 14; i++) bumped[j * GRID.nx + i] = 1;
    const at = { position: { x: 1.3, y: -2.1, z: 0 } };
    expect(surfaceAt(bumped, GRID, -3.7, -7.1)).toBeCloseTo(1, 6);
    expect(surfaceAt(bumped, GRID, 1.3, -2.1)).toBe(0);
    const lvl = ghostGeometry(ghostRec(at), bumped, GRID);
    const v = cornerAt(lvl, -3.7, -7.1);
    expect(lvl.positions[v * 3 + 2]).toBeCloseTo(0, 5); // rigid at the pivot's terrain
    expect(colourOf(lvl, v)).toEqual(same(STL_GHOST_COLOURS.buried)); // rel = 0 + 0 + 0 - 1 = -1
    const fol = ghostGeometry({ ...ghostRec(at), surface: 'follow' }, bumped, GRID);
    expect(colourOf(fol, cornerAt(fol, -3.7, -7.1))).toEqual(same(STL_GHOST_COLOURS.meets)); // follow: rel = Z + mesh z = 0
    // a far corner on flat terrain reads as follow does
    const w = cornerAt(lvl, 6.3, 2.9);
    expect(colourOf(lvl, w)).toEqual(same(STL_GHOST_COLOURS.meets));
  });
});

describe('the panel: one STL_CONTROLS entry, "On the terrain"', () => {
  const $ = (id) => document.getElementById(id);
  const saved = {};
  beforeEach(() => {
    Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 7; P.heightIn = 9; delete P.stlLayers;
    document.body.innerHTML = '<div id="stlLayerBody"></div>';
    _resetStlPanelForTests();
  });
  afterEach(() => {
    if (saved.stl === undefined) delete P.stlLayers; else P.stlLayers = saved.stl;
    P.widthIn = saved.w; P.heightIn = saved.h;
  });
  it('declared in the Place group; renders Follow the terrain / Level; Level writes surface:"level" into a NEW record (copy-on-write)', () => {
    const c = STL_CONTROLS.find((x) => x.id === 'surface');
    expect(c).toMatchObject({ group: 'place', kind: 'choice', path: ['surface'], label: 'On the terrain' });
    expect(c.options.map(([k, t]) => [k, t])).toEqual([['follow', 'Follow the terrain'], ['level', 'Level']]);
    expect(STL_CONTROLS.filter((x) => x.path[0] === 'surface')).toHaveLength(1);
    renderStlPanel($('stlLayerBody'));
    bindStlPanel({});
    P.stlLayers = DEFAULT.stlLayers;
    const defaultJson = JSON.stringify(DEFAULT.stlLayers);
    const rec = addStlFromSoup(pyramid(), 'pyr');
    const btns = [...document.querySelectorAll('#stl_surface [data-stl-choice]')];
    expect(btns.map((b) => b.textContent)).toEqual(['Follow the terrain', 'Level']);
    expect(btns[0].classList.contains('active')).toBe(true); // the default shows as follow
    const list = P.stlLayers;
    btns[1].click();
    expect(P.stlLayers).not.toBe(list);
    expect(P.stlLayers[0]).not.toBe(rec);
    expect(P.stlLayers[0].surface).toBe('level');
    expect(rec.surface).toBe('follow'); // the old record is untouched
    expect(JSON.stringify(DEFAULT.stlLayers)).toBe(defaultJson);
    expect(document.querySelector('#stl_surface [data-stl-choice="surface:level"]').classList.contains('active')).toBe(true);
  });
});

