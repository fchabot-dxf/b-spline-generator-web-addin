/**
 * Fred 2026-11-23 ("carve depth Z is not actually that measurement, it just lifts the model in the air"; phase 2, option 2
 * "Relief fills it", NEW boards only). P.terrainFit 'fill': the GENERATED terrain (shape + texture, before stamps, layers,
 * sculpt and Thicken) is fitted so its lowest point is 0 and its highest is carveZ. 'legacy' / absent = the old scale
 * (heights = max(0, h) * carveZ), bit for bit.
 *
 * The fit's range is measured on ONE fixed reference sampling of the terrain (core/terrain.js TERRAIN_FIT_REF,
 * terrainFitRange), never on the grid being built -- the preview, the Send grid and the editor backdrop get the same map.
 *
 * Saved boards (AGENTS.md rule 3): a board saved before the key has no terrainFit; its loader leaves it absent
 * (core/state.js NEW_BOARD_ONLY_KEYS) and MIGRATIONS 'terrain-fit-legacy' writes 'legacy'. Pins: digests MEASURED on main
 * 68937a66 with this same build.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, DEFAULT, lastResult, loadLastSession, NEW_BOARD_ONLY_KEYS } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { generateHeightmap, terrainFitRange } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { rebuild, _forgetHeights } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { MIGRATIONS, runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

const BASE = {
  widthIn: 7, heightIn: 9, carveZ: 0.9, seed: 41118, scale: 3.7, macroScale: 0.65, mapZoom: 1, seedOffsetX: 0, seedOffsetY: 0,
  octaves: 4, roughness: 0.5, edgeMargin: 0, symmetry: 'x', symOffsetX: 0, symOffsetY: 0, warpIntensity: 1.0, noiseType: 'simplex',
};
const gen = (o) => generateHeightmap({ ...DEFAULT, ...BASE, ...o }).heights;
const range = (a) => { let lo = Infinity, hi = -Infinity; for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };
const same = (a, b) => a.length === b.length && Array.prototype.every.call(a, (v, i) => Object.is(v, b[i]));
const fnv = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

// The terrain itself spans 0..carveZ: no grid reads outside it (beyond float noise), and a dense grid (961 x 961 points, 3x the
// reference) reaches both ends within 0.3 %. A coarser grid's own samples sit a little inside (it misses the exact valley floor
// and peak), the same terrain at every resolution.
const DENSE = 961;
function spansCarve(o, cz = BASE.carveZ) {
  const [lo, hi] = range(gen({ terrainFit: 'fill', carveZ: cz, nx: DENSE, nz: DENSE, ...o }));
  expect(lo).toBeGreaterThanOrEqual(-1e-6 * cz);
  expect(hi).toBeLessThanOrEqual(cz * (1 + 1e-5));
  expect(lo).toBeLessThan(0.003 * cz);
  expect(hi).toBeGreaterThan(0.997 * cz);
}

describe('the fill: the generated terrain spans 0..carveZ', () => {
  for (const cz of [0.3, 0.9, 1.5]) {
    it(`carve depth ${cz}: lowest 0 and highest carveZ`, () => spansCarve({}, cz));
  }
  it('at the preview grid (141 x 181) the samples sit inside 0..carveZ, within 2 % of each end', () => {
    const [lo, hi] = range(gen({ terrainFit: 'fill', nx: 141, nz: 181 }));
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(BASE.carveZ);
    expect(lo).toBeLessThan(0.02 * BASE.carveZ);
    expect(hi).toBeGreaterThan(0.98 * BASE.carveZ);
    const [llo, lhi] = range(gen({ terrainFit: 'legacy', nx: 141, nz: 181 }));
    expect(llo).toBeGreaterThan(0.2 * BASE.carveZ); // control: the legacy terrain floats (Fred's report)
    expect(lhi).toBeLessThan(0.75 * BASE.carveZ);
  });
  it('the fill is the affine map of the legacy terrain (same shape, scaled and lowered)', () => {
    const leg = gen({ terrainFit: 'legacy', nx: 60, nz: 77 });
    const fil = gen({ terrainFit: 'fill', nx: 60, nz: 77 });
    const [rlo, rhi] = terrainFitRange({ ...DEFAULT, ...BASE });
    for (const k of [0, 17, 999, 2345, leg.length - 1]) expect(fil[k]).toBeCloseTo((leg[k] / BASE.carveZ - rlo) / (rhi - rlo) * BASE.carveZ, 5);
  });
  it('Pass 3 smoothing smooths the fitted terrain (it stays inside 0..carveZ)', () => {
    const [lo, hi] = range(gen({ terrainFit: 'fill', smoothIntensity: 1, smoothRadius: 1.2, nx: 241, nz: 301 }));
    expect(lo).toBeGreaterThanOrEqual(-1e-6);
    expect(hi).toBeLessThanOrEqual(BASE.carveZ + 1e-6);
  });
  it('a Map Zoom or a pan re-fits: the zoomed / panned terrain spans 0..carveZ too', () => {
    for (const o of [{ mapZoom: 2 }, { mapZoom: 0.6 }, { seedOffsetX: 0.3 }]) spansCarve(o);
  });
  it('another filter, symmetry off, a Flat Border: the same', () => {
    spansCarve({ noiseType: 'eroded', symmetry: 'none', edgeMargin: 0.15, seed: 7 });
  });
  it("Flat (no texture) on hills: the hills fill", () => spansCarve({ isolateSkeleton: true }));
});

describe('resolution independence', () => {
  it('the range is the same whatever grid asks for it', () => {
    const a = terrainFitRange({ ...DEFAULT, ...BASE, nx: 48, nz: 62 });
    const b = terrainFitRange({ ...DEFAULT, ...BASE, nx: 281, nz: 361 });
    expect(a).toEqual(b);
    expect(a[1]).toBeGreaterThan(a[0]);
  });
  it('the reused range follows every terrain setting (a seed, a filter tweak) and only skips carve depth / smoothing / grid', () => {
    const p = { ...DEFAULT, ...BASE };
    const a = terrainFitRange(p);
    const b = terrainFitRange({ ...p, seed: 7 });
    expect(b).not.toEqual(a);
    expect(terrainFitRange({ ...p, filterTweaks: { simplex: { warpStrength: 0.2 } } })).not.toEqual(a);
    expect(terrainFitRange({ ...p, carveZ: 1.7, smoothIntensity: 0.5, nx: 9, nz: 9 })).toEqual(a);
    expect(terrainFitRange({ ...p, seed: 7 })).toEqual(b);
  });
  it('two resolutions give the same height at every shared sample point', () => {
    const coarse = gen({ terrainFit: 'fill', nx: 36, nz: 46 }); // u = i / 35, v = j / 45
    const fine = gen({ terrainFit: 'fill', nx: 71, nz: 91 }); //   u = i / 70, v = j / 90: every coarse point is a fine one
    let n = 0;
    for (let j = 0; j < 46; j++) for (let i = 0; i < 36; i++) { expect(Object.is(coarse[j * 36 + i], fine[(2 * j) * 71 + 2 * i])).toBe(true); n++; }
    expect(n).toBe(36 * 46);
  });
});

describe('what the fill leaves alone', () => {
  it("'legacy' and absent build the old terrain bit for bit", () => {
    const absent = gen({ terrainFit: undefined, nx: 48, nz: 62 });
    expect(same(gen({ terrainFit: 'legacy', nx: 48, nz: 62 }), absent)).toBe(true);
    expect(fnv(absent)).toBe('e83765f9'); // main 68937a66, this BASE at 48 x 62
  });
  it('Flat (no hills): the shape is a flat base plus grain, never filled', () => {
    const flat = { shapeFlat: true, surfaceHeightIn: 0.2, nx: 48, nz: 62 };
    expect(same(gen({ ...flat, terrainFit: 'fill' }), gen({ ...flat, terrainFit: 'legacy' }))).toBe(true);
  });
  it('a terrain with no range (max == min) is left as built', () => {
    const level = { isolateSkeleton: true, density: 0, nx: 48, nz: 62 }; // no texture, no hills: one height everywhere
    const leg = gen({ ...level, terrainFit: 'legacy' });
    expect(range(leg)[0]).toBe(range(leg)[1]);
    expect(same(gen({ ...level, terrainFit: 'fill' }), leg)).toBe(true);
  });
});

describe("the key, the new-board default and MIGRATIONS 'terrain-fit-legacy'", () => {
  it("a new board fills; the key is a new-board-only default", () => {
    expect(DEFAULT.terrainFit).toBe('fill');
    expect(NEW_BOARD_ONLY_KEYS).toContain('terrainFit');
  });
  it("declared once; writes 'legacy' when the key is absent, nothing otherwise", () => {
    expect(MIGRATIONS.filter((m) => m.id === 'terrain-fit-legacy')).toHaveLength(1);
    const old = { noiseType: 'simplex' };
    runMigrations(old);
    expect(old.terrainFit).toBe('legacy');
    const fresh = { noiseType: 'simplex', terrainFit: 'fill' };
    runMigrations(fresh);
    expect(fresh.terrainFit).toBe('fill');
  });
});

describe('saved boards build as main 68937a66 did (heights + back)', () => {
  const BOARDS = JSON.parse(readFileSync('tests/fixtures/photo-removed-boards.json', 'utf8'));
  const SESSION = readFileSync('tools/brick-matrix/fixtures/pre-item22-board.splineGenLastSession.json', 'utf8');
  const saved = { ...P };
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { for (const k of Object.keys(P)) delete P[k]; Object.assign(P, saved); window.svgEditor = null; _forgetHeights(); localStorage.clear(); });
  const MAIN = {
    'claude 14': { heights: '9c672c69', back: '6e8935d9' }, // framed (template_8): the cloud-load path
    'claude 14 (Rectangle)': { heights: '9c672c69', back: '6e8935d9' }, // the same board with no frame
    'pre-item-22 session': { heights: '55152b93', back: 'a5961428' }, // framed (template_1), sculpted: the session-restore path
  };
  /** A project load (snapshot-manager.js applySnapshot 'load'): a key the save lacks reads as DEFAULT -- except the
   *  new-board-only keys, left absent -- then the migrations. */
  const cloudLoad = (snapP) => {
    for (const k of Object.keys(DEFAULT)) {
      if (k in snapP) continue;
      if (NEW_BOARD_ONLY_KEYS.includes(k)) { delete P[k]; continue; }
      P[k] = clone(DEFAULT[k]);
    }
    Object.assign(P, snapP);
    runMigrations(P);
  };
  const build = async () => {
    window.svgEditor = { _layers: [] };
    _forgetHeights();
    await rebuild({ update() {}, setStlGhosts() {} }, () => {}, () => {});
    return { heights: fnv(lastResult.heights), back: fnv(lastResult.thickenData.offsetPts) };
  };
  it("'claude 14' (framed), a cloud load: 'legacy', byte-identical", async () => {
    const snapP = clone(BOARDS['claude 14'].P);
    expect('terrainFit' in snapP).toBe(false);
    cloudLoad(snapP);
    expect(P.terrainFit).toBe('legacy');
    expect(await build()).toEqual(MAIN['claude 14']);
  }, 60000);
  it("'claude 14' with no frame (Rectangle): 'legacy', byte-identical", async () => {
    const snapP = { ...clone(BOARDS['claude 14'].P), frame: null };
    cloudLoad(snapP);
    expect(P.terrainFit).toBe('legacy');
    expect(await build()).toEqual(MAIN['claude 14 (Rectangle)']);
  }, 60000);
  it("the pre-item-22 session (framed, sculpted), a session restore: 'legacy', byte-identical", async () => {
    for (const k of Object.keys(DEFAULT)) P[k] = clone(DEFAULT[k]); // the page's P before the restore: a new board's
    localStorage.setItem('splineGenLastSession', SESSION);
    expect(loadLastSession()).toBe(true);
    runMigrations();
    expect(P.terrainFit).toBe('legacy');
    expect(await build()).toEqual(MAIN['pre-item-22 session']);
  }, 60000);
});
