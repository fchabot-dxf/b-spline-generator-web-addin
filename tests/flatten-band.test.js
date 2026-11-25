/**
 * Fred 2026-11-25: Surface > FLATTEN BAND (core/flatten-band.js, core/flatten-band-outline.js, main/flatten-band-ui.js) -- a
 * flat strip along the wood frame's outline (the board rectangle with no frame), feathered into the terrain on both sides,
 * applied to the Shape, the Texture or Both, at a Flat height (in) the user sets (absent = the board's fill floor).
 * Saved boards (AGENTS.md rule 3): no band keys = the band off = the heights and the back bit for bit as main 3df01ae9
 * (MIGRATIONS 'flatten-band-off' is a declared no-op); the retiring Flat Border (P.edgeMarginIn > 0) builds as before too.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P, DEFAULT, NEW_BOARD_ONLY_KEYS, lastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { generateHeightmap, terrainFitRange } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { rebuild, _forgetHeights } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { MIGRATIONS, runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { outlineField, bandWeightGrid, bandWeightAt, bandGeometry, rectOutline, BAND_APPLIES_TO } from '../bspline-frame-builder/b-spline-gen/html/core/flatten-band.js';
import { bandOutlineOf } from '../bspline-frame-builder/b-spline-gen/html/core/flatten-band-outline.js';
import { SIDEBAR_TABS } from '../bspline-frame-builder/b-spline-gen/html/main/sidebar-tabs.js';
import { SECTION_THEMES } from '../bspline-frame-builder/b-spline-gen/html/main/section-themes.js';
import { syncFlattenBandUI, FLAT_BORDER_RETIREMENT, bandHeightShown } from '../bspline-frame-builder/b-spline-gen/html/main/flatten-band-ui.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const clone = (v) => JSON.parse(JSON.stringify(v));
const fnv = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };

const W = 7, H = 9;
const HOURGLASS = frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: 'template_1' }), { widthIn: W, heightIn: H }).primitives;
const BASE = {
  widthIn: W, heightIn: H, carveZ: 1.5, seed: 42, scale: 3.7, macroScale: 0.65, mapZoom: 1, seedOffsetX: 0.03, seedOffsetY: -0.02,
  symmetry: 'none', noiseType: 'simplex', smoothIntensity: 0, nx: 57, nz: 73,
};
const BAND = { bandEnabled: true, bandAppliesTo: 'both', bandWidthIn: 0.5, bandInnerFeatherIn: 1, bandOuterFeatherIn: 0.25, bandHeightIn: 0.3, bandOutline: HOURGLASS };
const gen = (o) => generateHeightmap({ ...DEFAULT, ...BASE, ...o }).heights;
/** The grid point nearest board point (x, y) (editor frame: y down): [i, j, k]. */
const at = (o, x, y) => { const nx = o.nx ?? BASE.nx, nz = o.nz ?? BASE.nz; const i = Math.round(x / W * (nx - 1)), j = Math.round((1 - y / H) * (nz - 1)); return [i, j, j * nx + i]; };

describe('the outline: one signed distance field (inches, negative inside)', () => {
  const f = outlineField(HOURGLASS);
  // Hourglass on 7 x 9: the outline is the 0.25 in bounding-box offset, pinched by the waist arcs (centre x 0.5907, r 0.6802)
  it('Hourglass: the centre is inside, at its distance to the waist', () => {
    expect(f.at(3.5, 4.50273675)).toBeCloseTo(-(3.5 - (0.5906629924511178 + 0.6801745)), 9);
  });
  it('Hourglass: the waist notch is OUTSIDE (a rectangle would call it inside)', () => {
    expect(f.at(0.6, 4.50273675)).toBeCloseTo(0.6801745 - (0.6 - 0.5906629924511178), 9);
    expect(outlineField(rectOutline(W, H)).at(0.6, 4.50273675)).toBeLessThan(0);
  });
  it('Hourglass: past the 0.25 in offset is outside; a point on the outline reads 0', () => {
    expect(f.at(0.1, 1)).toBeCloseTo(0.15, 9);
    expect(f.at(3.5, 0.25)).toBeCloseTo(0, 12);
    expect(f.at(3.5, 0.5)).toBeCloseTo(-0.25, 9);
  });
  it('the band profile: flat inside width/2, the feathers on their own side, 0 beyond', () => {
    const g = bandGeometry(BAND);
    expect(bandWeightAt(0, g)).toBe(1);
    expect(bandWeightAt(-0.25, g)).toBe(1);
    expect(bandWeightAt(-0.75, g)).toBe(0.5); // halfway through the 1 in inner feather
    expect(bandWeightAt(0.375, g)).toBe(0.5); // halfway through the 0.25 in outer feather
    expect(bandWeightAt(-1.25, g)).toBe(0);
    expect(bandWeightAt(0.5, g)).toBe(0);
  });
  it('the frame outline is the one source (frameCutProfile); no frame = the board rectangle', () => {
    const base = { widthIn: W, heightIn: H, bandEnabled: true };
    expect(bandOutlineOf({ ...base, frame: { templateId: 'template_1' } })).toEqual(HOURGLASS);
    expect(bandOutlineOf({ ...base, frame: null })).toEqual(rectOutline(W, H));
    expect(bandOutlineOf({ ...base, bandEnabled: false, frame: null })).toBe(null);
  });
});

describe('the band in the heightmap', () => {
  const off = gen({});
  it('off / absent: bit for bit as before (every band value set, the switch off)', () => {
    const { bandEnabled, ...rest } = BAND;
    expect(fnv(gen({ ...rest, bandEnabled: false }))).toBe(fnv(off));
    expect(fnv(gen({ ...BAND, bandOutline: null }))).toBe(fnv(off)); // no outline handed: no band
  });
  it('a point beyond the flat + feather is the terrain untouched, to the bit -- every such point', () => {
    const on = gen(BAND);
    const w = bandWeightGrid({ ...DEFAULT, ...BASE, ...BAND }, BASE.nx, BASE.nz);
    let untouched = 0, changed = 0;
    for (let k = 0; k < on.length; k++) {
      if (w[k] === 0) { expect(Object.is(on[k], off[k])).toBe(true); untouched++; } else if (on[k] !== off[k]) changed++;
    }
    expect(untouched).toBeGreaterThan(1000);
    expect(changed).toBeGreaterThan(500);
    const [, , kc] = at({}, 3.5, 4.5);
    expect(w[kc]).toBe(0);
  });
  it('a point on the outline is the Flat height (Both)', () => {
    const nz = 37; // row 35 lies on the top edge of the outline (y = 0.25 in = 9 * (1 - 35/36))
    const h = gen({ ...BAND, bandWidthIn: 0, nz });
    const k = 35 * BASE.nx + 28; // x = 3.5
    expect(h[k]).toBe(Math.fround(0.3));
    expect(gen({ nz })[k]).not.toBe(Math.fround(0.3));
  });
  it('Texture only = Texture Strength 0 there; Shape only = Flat (no hills) at the Flat height there; Both = the height', () => {
    const [, , k] = at({}, 3.5, 0.3); // 0.05 in inside the outline: in the flat
    const level = 0.3;
    for (const fit of ['legacy', 'fill']) {
      const o = { terrainFit: fit };
      const tex = gen({ ...o, ...BAND, bandAppliesTo: 'texture' });
      const shape = gen({ ...o, ...BAND, bandAppliesTo: 'shape' });
      const both = gen({ ...o, ...BAND, bandAppliesTo: 'both' });
      if (fit === 'legacy') expect(tex[k]).toBe(gen({ ...o, textureStrength: 0 })[k]);
      else { // 'fill': the band comes AFTER the fit, so its point is Strength 0's value mapped by the band-free board's own fit
        const [lo, hi] = terrainFitRange({ ...DEFAULT, ...BASE });
        const raw = gen({ terrainFit: 'legacy', textureStrength: 0 })[k] / BASE.carveZ;
        expect(tex[k]).toBeCloseTo((raw - lo) / (hi - lo) * BASE.carveZ, 5);
      }
      expect(shape[k]).toBe(gen({ ...o, shapeFlat: true, surfaceHeightIn: level })[k]);
      expect(shape[k]).toBeGreaterThan(Math.fround(level)); // the grain still rides on the flat
      expect(both[k]).toBe(Math.fround(level));
      // the two switches are independent: texture-only leaves the shape (its value is not the flat); shape-only keeps the grain
      expect(tex[k]).not.toBe(both[k]);
      expect(shape[k]).not.toBe(both[k]);
    }
  });
  it('the Flat height defaults to the fill floor (null = the board\'s own low level)', () => {
    const [, , k] = at({}, 3.5, 0.3);
    const h = gen({ ...BAND, bandHeightIn: null, terrainFit: 'fill', terrainFloorIn: 0.125 });
    expect(h[k]).toBe(Math.fround(0.125));
    expect(bandHeightShown({ ...DEFAULT, bandHeightIn: null, terrainFit: 'fill', thickenEnabled: true, thickenDir: 'down', thickness: 0.125, carveZ: 1.5 })).toBe(0.125);
    expect(bandHeightShown({ ...DEFAULT, bandHeightIn: 0.4 })).toBe(0.4);
  });
  it('resolution independent: two grids agree at every point they share', () => {
    const a = gen({ ...BAND, nx: 29, nz: 37 }), b = gen({ ...BAND, nx: 57, nz: 73 });
    let shared = 0;
    for (let j = 0; j < 37; j++) for (let i = 0; i < 29; i++) { expect(a[j * 29 + i]).toBe(b[(2 * j) * 57 + 2 * i]); shared++; }
    expect(shared).toBe(29 * 37);
    expect(fnv(b)).not.toBe(fnv(gen({ nx: 57, nz: 73 }))); // the band is on in both
  });
  it('Rectangle (no frame): the band runs along the board edge', () => {
    const rect = gen({ ...BAND, bandOutline: rectOutline(W, H) });
    expect(rect[0]).toBe(Math.fround(0.3)); // the corner point lies on the loop
    expect(rect[at({}, 3.5, 4.5)[2]]).toBe(off[at({}, 3.5, 4.5)[2]]);
  });
});

describe("saved boards: MIGRATIONS 'flatten-band-off' and the Flat Border", () => {
  const BOARDS = JSON.parse(readFileSync('tests/fixtures/photo-removed-boards.json', 'utf8'));
  const saved = { ...P };
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { for (const k of Object.keys(P)) delete P[k]; Object.assign(P, saved); window.svgEditor = null; _forgetHeights(); localStorage.clear(); });
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
  // main 3df01ae9, measured on its own code (the band's files swapped out)
  const MAIN = {
    'claude 14': { heights: '9c672c69', back: '6e8935d9' },
    'claude 14, Flat Border 1 in': { heights: '8112ae52', back: '3b5d6d09' },
  };
  it('declared once and writes nothing', () => {
    expect(MIGRATIONS.filter((m) => m.id === 'flatten-band-off')).toHaveLength(1);
    const p = { noiseType: 'simplex' };
    runMigrations(p);
    expect(Object.keys(p).some((k) => k.startsWith('band'))).toBe(false);
  });
  it("'claude 14' (framed) without the band keys builds main's digests", async () => {
    const snapP = clone(BOARDS['claude 14'].P);
    expect(Object.keys(snapP).some((k) => k.startsWith('band'))).toBe(false);
    cloudLoad(snapP);
    expect(P.bandEnabled).toBe(false);
    expect(await build()).toEqual(MAIN['claude 14']);
  }, 60000);
  it("a board with a Flat Border (edgeMarginIn 1) builds main's digests (the legacy path kept)", async () => {
    cloudLoad({ ...clone(BOARDS['claude 14'].P), edgeMarginIn: 1 });
    expect(await build()).toEqual(MAIN['claude 14, Flat Border 1 in']);
  }, 60000);
  it("the same board with the band on changes (the band reaches the heights through the frame's outline)", async () => {
    cloudLoad({ ...clone(BOARDS['claude 14'].P), bandEnabled: true, bandHeightIn: 0.2 });
    expect((await build()).heights).not.toBe(MAIN['claude 14'].heights);
  }, 60000);
});

describe('the panel: its own Surface section after Terrain Texture; the Flat Border retires', () => {
  it('declared in SIDEBAR_TABS right after panel-filter, with a theme', () => {
    const surface = SIDEBAR_TABS.find((t) => t.id === 'surface').sections;
    expect(surface.indexOf('panel-band')).toBe(surface.indexOf('panel-filter') + 1);
    expect(SECTION_THEMES.band).toBeTruthy();
    expect(HTML).toMatch(/<div class="panel panel-band">/);
  });
  it('the controls: the switch, Applies to (one button per BAND_APPLIES_TO key), the height, the width and both feathers', () => {
    for (const id of ['bandEnabled', 'bandHeightIn', 'bandHeightInSlider', 'bandWidthIn', 'bandInnerFeatherIn', 'bandOuterFeatherIn']) expect(HTML).toContain(`id="${id}"`);
    const group = HTML.slice(HTML.indexOf('id="bandAppliesToGroup"'), HTML.indexOf('</div>', HTML.indexOf('id="bandAppliesToGroup"')));
    expect([...group.matchAll(/data-value="(\w+)"/g)].map((m) => m[1])).toEqual(Object.keys(BAND_APPLIES_TO));
  });
  it('defaults: off, Both, the height following the fill floor', () => {
    expect(DEFAULT.bandEnabled).toBe(false);
    expect(DEFAULT.bandAppliesTo).toBe('both');
    expect(DEFAULT.bandHeightIn).toBe(null);
  });
  const dom = () => {
    document.body.innerHTML = `<div data-legacy-row="flatBorder"><input id="edgeMarginIn"></div>
      <input type="checkbox" id="bandEnabled"><div data-band-row="settings"></div>
      <div id="bandAppliesToGroup"><button data-value="shape"></button><button data-value="texture"></button><button data-value="both"></button></div>
      <input type="range" id="bandHeightInSlider" min="0" max="1.5" step="0.01"><input type="number" id="bandHeightIn">`;
    return (s) => document.querySelector(s);
  };
  const saved = { ...P };
  afterEach(() => { for (const k of Object.keys(P)) delete P[k]; Object.assign(P, saved); document.body.innerHTML = ''; });
  it('the Flat Border row shows only on a loaded board that uses it, and never hides while its own value moves', () => {
    const $ = dom();
    expect(FLAT_BORDER_RETIREMENT.shows({ edgeMarginIn: 0 })).toBe(false);
    P.edgeMarginIn = 0; syncFlattenBandUI({ boardLoaded: true });
    expect($('[data-legacy-row="flatBorder"]').hidden).toBe(true);
    P.edgeMarginIn = 0.5; syncFlattenBandUI({ boardLoaded: true });
    expect($('[data-legacy-row="flatBorder"]').hidden).toBe(false);
    P.edgeMarginIn = 0; syncFlattenBandUI(); // a write, not a load: the row stays
    expect($('[data-legacy-row="flatBorder"]').hidden).toBe(false);
  });
  it('the rows show while the band is on; Applies to marks its button; the height travels 0..carveZ', () => {
    const $ = dom();
    Object.assign(P, { bandEnabled: false, bandAppliesTo: 'texture', carveZ: 0.8, bandHeightIn: 0.35 });
    syncFlattenBandUI();
    expect($('[data-band-row="settings"]').hidden).toBe(true);
    P.bandEnabled = true; syncFlattenBandUI();
    expect($('[data-band-row="settings"]').hidden).toBe(false);
    expect($('[data-value="texture"]').classList.contains('active')).toBe(true);
    expect($('[data-value="both"]').classList.contains('active')).toBe(false);
    expect($('#bandHeightInSlider').max).toBe('0.8');
    expect($('#bandHeightIn').value).toBe('0.35');
  });
});
