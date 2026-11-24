/**
 * Fred 2026-11-24 ("Extend below zero is fine"): with Back = Flat the flat base can sit BELOW the stock bottom --
 * P.flatBaseDropIn (the Thicken line's 'Base below 0 (in)', shown only while Back is Flat): the flat bottom at
 * z = -flatBaseDropIn, a plinth under the stock. The relief, the fill rule and the fill floor are unchanged (the floor still
 * uses the thickness). Absent / 0 = today's flat bottom at z = 0, bit for bit (MIGRATIONS 'flat-base-drop-zero').
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { buildThickenData, fillFloorIn } from '../bspline-frame-builder/b-spline-gen/html/core/engine/build-thicken-data.js';
import { generateThickenedStep } from '../bspline-frame-builder/b-spline-gen/html/core/stepWriter.js';
import { MIGRATIONS, runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { syncBackFlatUI } from '../bspline-frame-builder/b-spline-gen/html/main/back-flat-ui.js';

const BASE = {
  ...DEFAULT, widthIn: 7, heightIn: 9, carveZ: 0.9, seed: 41118, scale: 3.7, noiseType: 'simplex', symmetry: 'x', edgeMargin: 0,
  terrainFit: 'fill', thickenEnabled: true, thickness: 0.125, thickenDir: 'down', backMode: 'flat',
};
const NX = 71, NZ = 91;
const same = (a, b) => a.length === b.length && Array.prototype.every.call(a, (v, i) => Object.is(v, b[i]));
function board(o = {}) {
  const p = { ...BASE, ...o };
  const { heights } = generateHeightmap({ ...p, nx: NX, nz: NZ, terrainFloorIn: fillFloorIn(p) });
  return { p, heights, t: buildThickenData(heights, NX, NZ, p, {}) };
}

describe('Base below 0: the flat bottom moves down, nothing else', () => {
  it('a new board: 0 (the flat bottom at the stock bottom, as before)', () => {
    expect(DEFAULT.flatBaseDropIn).toBe(0);
  });
  it('absent = 0 = today, bit for bit (every back point +0)', () => {
    const absent = board({ flatBaseDropIn: undefined }), zero = board({ flatBaseDropIn: 0 });
    expect(same(absent.t.data.offsetPts, zero.t.data.offsetPts)).toBe(true);
    for (let k = 0; k < NX * NZ; k++) expect(Object.is(absent.t.data.offsetPts[k * 3 + 2], 0)).toBe(true);
  });
  it('0.25: every back point at z -0.25; the top (relief, fill, floor) unchanged', () => {
    const zero = board({ flatBaseDropIn: 0 }), drop = board({ flatBaseDropIn: 0.25 });
    for (let k = 0; k < NX * NZ; k++) expect(drop.t.data.offsetPts[k * 3 + 2]).toBe(-0.25);
    expect(same(drop.heights, zero.heights)).toBe(true);
    expect(fillFloorIn(drop.p)).toBe(0.125);
    expect(drop.t.floorZ).toBe(-0.25); // the body's z bounds (the H readout's) follow the real bottom
  });
  it('the thin-spot check measures to the real bottom (thicker body, no more thin points than at 0)', () => {
    const zero = board({ flatBaseDropIn: 0, carveZ: 0.1 }), drop = board({ flatBaseDropIn: 0.25, carveZ: 0.1 });
    expect(drop.t.minThk).toBeGreaterThan(zero.t.minThk + 0.24);
    expect(drop.t.counts.thin + drop.t.counts.topBot).toBeLessThan(zero.t.counts.thin + zero.t.counts.topBot);
  });
  it('Send / STEP: the bottom surface at z -0.25, the walls down to it', () => {
    const { heights, t } = board({ flatBaseDropIn: 0.25 });
    const step = generateThickenedStep(heights, t.data.offsetPts, { widthIn: 7, heightIn: 9, nx: NX, nz: NZ, options: { stamped: true } }, heights);
    expect((step.match(/CARTESIAN_POINT\('',\([^)]*,-0\.250000\)\)/g) || []).length).toBeGreaterThanOrEqual(NX * NZ);
    expect(step).not.toMatch(/CARTESIAN_POINT\('',\([^)]*,0\.000000\)\)/); // nothing left at the old bottom
  });
  it('Shell ignores it (the offset shell, bit for bit)', () => {
    const a = board({ backMode: 'shell', flatBaseDropIn: 0 }), b = board({ backMode: 'shell', flatBaseDropIn: 0.25 });
    expect(same(a.t.data.offsetPts, b.t.data.offsetPts)).toBe(true);
  });
  it("MIGRATIONS 'flat-base-drop-zero': declared once, writes nothing (absent reads 0)", () => {
    expect(MIGRATIONS.filter((m) => m.id === 'flat-base-drop-zero')).toHaveLength(1);
    const p = { noiseType: 'simplex' };
    runMigrations(p);
    expect('flatBaseDropIn' in p).toBe(false);
  });
});

describe("the field: 'Base below 0 (in)', right under the Back select, shown only while Back is Flat", () => {
  const PALETTE = 'bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
  const html = readFileSync(PALETTE, 'utf8');
  const body = html.slice(html.indexOf('<body'), html.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
  const keep = {};
  beforeEach(() => { keep.backMode = P.backMode; document.body.innerHTML = body; });
  afterEach(() => { P.backMode = keep.backMode; document.body.innerHTML = ''; });
  const row = () => document.querySelector('[data-back-flat-row="flatBaseDrop"]');
  it('the slider + number pair (0..1 step 0.05 on the slider; the number box typed freely), after the Back select', () => {
    const slider = document.getElementById('flatBaseDropInSlider'), num = document.getElementById('flatBaseDropIn');
    expect(row().contains(slider) && row().contains(num)).toBe(true);
    expect([slider.min, slider.max, slider.step]).toEqual(['0', '1', '0.05']);
    expect(num.hasAttribute('min') || num.hasAttribute('max')).toBe(false);
    expect(row().textContent).toMatch(/Base below 0 \(in\)/);
    expect(document.getElementById('backMode').compareDocumentPosition(row()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.getElementById('thickenSettings').contains(row())).toBe(true);
  });
  it('hidden while Back is Shell, shown while Flat', () => {
    P.backMode = 'shell'; syncBackFlatUI(document);
    expect(row().hidden).toBe(true);
    P.backMode = 'flat'; syncBackFlatUI(document);
    expect(row().hidden).toBe(false);
  });
  it('is bound like the other Thicken fields (a slider pair, a numeric P key)', () => {
    const st = readFileSync('bspline-frame-builder/b-spline-gen/html/core/state.js', 'utf8');
    expect(st).toMatch(/flatBaseDropIn: 'flatBaseDropInSlider'/);
  });
});
