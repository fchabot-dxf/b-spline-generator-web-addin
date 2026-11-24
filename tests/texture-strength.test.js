/**
 * Fred 2026-11-23: Terrain Texture > Texture Strength (P.textureStrength, 0..1, default 1).
 * 1 / absent = today's output bit for bit; 0 = exactly 'Flat (no texture)' (isolateSkeleton), hills and shapeFlat alike.
 * Saved boards (AGENTS.md rule 3): a board with no textureStrength builds the same digests as main eb918410
 * (the three cloud boards of tests/photo-removed-pin.test.js; MIGRATIONS 'texture-strength' is a declared no-op).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, DEFAULT, NEW_BOARD_ONLY_KEYS, lastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { rebuild, _forgetHeights } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { MIGRATIONS, runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BASE = {
  widthIn: 7, heightIn: 9, carveZ: 1.5, seed: 42, scale: 3.7, macroScale: 0.65, mapZoom: 1, seedOffsetX: 0.03, seedOffsetY: -0.02,
  octaves: 4, roughness: 0.5, edgeMargin: 0.2, symOffsetX: 0, symOffsetY: 0, warpIntensity: 1.0, symmetry: 'none', nx: 48, nz: 62,
  noiseType: 'simplex',
};
const FLAT = { shapeFlat: true, surfaceHeightIn: 0.4 };
const same = (a, b) => a.length === b.length && Array.prototype.every.call(a, (v, i) => Object.is(v, b[i]));
const gen = (o) => generateHeightmap({ ...DEFAULT, ...BASE, ...o }).heights;

describe('Texture Strength in the engine', () => {
  for (const [name, extra] of [['hills', {}], ['flat shape', FLAT]]) {
    it(`${name}: 0 equals Flat (no texture), 1 and absent equal today, 0.5 lies between`, () => {
      const today = gen(extra);
      const flat = gen({ ...extra, isolateSkeleton: true });
      expect(same(gen({ ...extra, textureStrength: 0 }), flat)).toBe(true);
      expect(same(gen({ ...extra, textureStrength: 1 }), today)).toBe(true);
      expect(same(gen({ ...extra, textureStrength: null }), today)).toBe(true);
      expect(same(today, flat)).toBe(false);
      const half = gen({ ...extra, textureStrength: 0.5 });
      expect(same(half, today)).toBe(false);
      expect(same(half, flat)).toBe(false);
    });
  }
});

describe('Texture Strength in the panel', () => {
  it('has #textureStrengthSlider and #textureStrength, after Noise Type and before Fine Scale', () => {
    expect(HTML).toMatch(/id="textureStrengthSlider"[^>]*max="1"[^>]*value="1"/);
    expect(HTML).toMatch(/id="textureStrength" value="1"/);
    const at = (s) => HTML.indexOf(s);
    expect(at('id="noiseType"')).toBeLessThan(at('id="textureStrengthSlider"'));
    expect(at('id="textureStrengthSlider"')).toBeLessThan(at('id="scaleSlider"'));
  });
  it('defaults to 1 in P and is bound to its slider', async () => {
    expect(DEFAULT.textureStrength).toBe(1);
    const st = readFileSync('bspline-frame-builder/b-spline-gen/html/core/state.js', 'utf8');
    expect(st).toMatch(/textureStrength: 'textureStrengthSlider'/);
  });
});

describe("MIGRATIONS 'texture-strength' and saved boards", () => {
  const BOARDS = JSON.parse(readFileSync('tests/fixtures/photo-removed-boards.json', 'utf8'));
  const fnv = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
  const saved = { ...P };
  afterEach(() => { for (const k of Object.keys(P)) delete P[k]; Object.assign(P, saved); window.svgEditor = null; _forgetHeights(); });
  const MAIN = { 'claude 14': { heights: '9c672c69', back: '6e8935d9' } }; // main eb918410, no textureStrength

  it('declared once and writes nothing', () => {
    expect(MIGRATIONS.filter((m) => m.id === 'texture-strength')).toHaveLength(1);
    const p = { noiseType: 'simplex' };
    runMigrations(p);
    expect('textureStrength' in p).toBe(false);
  });
  it("a saved board without the key builds main's digests", async () => {
    const snapP = JSON.parse(JSON.stringify(BOARDS['claude 14'].P));
    delete snapP.textureStrength;
    for (const k of Object.keys(DEFAULT)) {
      if (k in snapP) continue;
      if (NEW_BOARD_ONLY_KEYS.includes(k)) { delete P[k]; continue; } // left absent, as the real loaders do
      P[k] = JSON.parse(JSON.stringify(DEFAULT[k]));
    }
    Object.assign(P, snapP);
    delete P.textureStrength; // a load of a save that lacks it must still build as 1
    runMigrations(P);
    window.svgEditor = { _layers: [] };
    _forgetHeights();
    await rebuild({ update() {}, setStlGhosts() {} }, () => {}, () => {});
    expect({ heights: fnv(lastResult.heights), back: fnv(lastResult.thickenData.offsetPts) }).toEqual(MAIN['claude 14']);
  });
});
