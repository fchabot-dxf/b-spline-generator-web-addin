/**
 * Fred 2026-11-23 ("divide this in two settings"), phase 3 of the terrain fit:
 *  A) FILL FLOOR -- on a terrainFit 'fill' board the whole BODY stays inside the stock 0..carveZ: the terrain's highest point
 *     is carveZ and its lowest is the body's bottom clearance -- P.thickness with Thicken on, down, Back 'shell' (the shell's
 *     bottom lands at about 0); 0 with Thicken off, up, or Back 'flat' (core/engine/build-thicken-data.js fillFloorIn).
 *  B) Back: Shell / Flat (P.backMode, the Thicken line's settings). 'shell' (DEFAULT, and absent on every saved board) = the
 *     offset shell, bit for bit; 'flat' = the body is solid from the top surface down to a flat bottom at z = 0.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, DEFAULT, updateP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { buildThickenData, fillFloorIn } from '../bspline-frame-builder/b-spline-gen/html/core/engine/build-thicken-data.js';
import { generateThickenedStep } from '../bspline-frame-builder/b-spline-gen/html/core/stepWriter.js';
import { heightsInputDigest } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { MIGRATIONS, runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

const BASE = {
  ...DEFAULT, widthIn: 7, heightIn: 9, carveZ: 0.9, seed: 41118, scale: 3.7, noiseType: 'simplex', symmetry: 'x',
  edgeMargin: 0, terrainFit: 'fill', thickenEnabled: true, thickness: 0.125, thickenDir: 'down', backMode: 'shell',
};
const range = (a, stride = 1, off = 0) => { let lo = Infinity, hi = -Infinity; for (let k = off; k < a.length; k += stride) { const v = a[k]; if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };
const same = (a, b) => a.length === b.length && Array.prototype.every.call(a, (v, i) => Object.is(v, b[i]));
/** A board the way core/engine/rebuild.js builds it: the terrain (with its fill floor), then the back. */
function board(o = {}, nx = 141, nz = 181) {
  const p = { ...BASE, ...o };
  const { heights } = generateHeightmap({ ...p, nx, nz, terrainFloorIn: fillFloorIn(p) });
  const t = buildThickenData(heights, nx, nz, p, {});
  return { p, heights, back: t.data ? t.data.offsetPts : null, rawBack: t.data ? t.data.rawOffsetPts : null };
}

describe('A) the fill floor: the body stays inside the stock 0..carveZ', () => {
  it('the floor: P.thickness with Thicken on + down + Shell; 0 otherwise; 0 on a legacy board', () => {
    expect(fillFloorIn(BASE)).toBe(0.125);
    expect(fillFloorIn({ ...BASE, thickness: 0.3 })).toBe(0.3);
    expect(fillFloorIn({ ...BASE, thickenEnabled: false })).toBe(0);
    expect(fillFloorIn({ ...BASE, thickenDir: 'up' })).toBe(0);
    expect(fillFloorIn({ ...BASE, backMode: 'flat' })).toBe(0);
    expect(fillFloorIn({ ...BASE, terrainFit: 'legacy' })).toBe(0);
    expect(fillFloorIn({ ...BASE, terrainFit: undefined })).toBe(0);
  });
  it('Shell: the terrain spans thickness..carveZ (a dense grid), and the shell bottom lands at about 0', () => {
    const p = { ...BASE };
    const [lo, hi] = range(generateHeightmap({ ...p, nx: 961, nz: 961, terrainFloorIn: fillFloorIn(p) }).heights);
    expect(lo).toBeGreaterThanOrEqual(0.125 - 1e-6);
    expect(lo).toBeLessThan(0.125 + 0.003 * 0.9);
    expect(hi).toBeLessThanOrEqual(0.9 * (1 + 1e-5));
    expect(hi).toBeGreaterThan(0.997 * 0.9);
    const { heights, back, rawBack } = board();
    expect(range(heights)[1]).toBeLessThanOrEqual(0.9); // the top stays under the stock top
    // MEASURED (141 x 181): the offset shell's own bottom (along the normals) lands at +0.0047; the back as built -- after the
    // thin fill (extraThickenThin pushes steep cells down) and the 0.3 in smoothing -- at -0.0259
    expect(Math.abs(range(rawBack, 3, 2)[0])).toBeLessThan(0.01);
    const [blo] = range(back, 3, 2);
    expect(blo).toBeGreaterThan(-0.03);
    expect(blo).toBeLessThan(0.01);
  });
  it('Shell: a thicker shell raises the floor with it (the offset shell bottom still lands at about 0)', () => {
    const { heights, rawBack } = board({ thickness: 0.3 });
    expect(range(heights)[0]).toBeGreaterThan(0.29);
    expect(Math.abs(range(rawBack, 3, 2)[0])).toBeLessThan(0.01); // MEASURED +0.0038 (the built back: -0.1266, see the report)
  });
  it('Thicken off / up: the terrain spans 0..carveZ (phase 2)', () => {
    for (const o of [{ thickenEnabled: false }, { thickenDir: 'up' }]) {
      const p = { ...BASE, ...o };
      const [lo, hi] = range(generateHeightmap({ ...p, nx: 961, nz: 961, terrainFloorIn: fillFloorIn(p) }).heights);
      expect(lo).toBeLessThan(0.003 * 0.9);
      expect(lo).toBeGreaterThanOrEqual(-1e-6);
      expect(hi).toBeGreaterThan(0.997 * 0.9);
    }
  });
  it('still resolution independent: two grids agree at every shared point, floor included', () => {
    const a = board({}, 36, 46).heights, b = board({}, 71, 91).heights;
    for (let j = 0; j < 46; j++) for (let i = 0; i < 36; i++) expect(Object.is(a[j * 36 + i], b[(2 * j) * 71 + 2 * i])).toBe(true);
  });
  it('a legacy board ignores the floor (bit for bit)', () => {
    const p = { ...BASE, terrainFit: 'legacy', nx: 48, nz: 62 };
    expect(same(generateHeightmap({ ...p, terrainFloorIn: 0.125 }).heights, generateHeightmap(p).heights)).toBe(true);
  });
  it('the heights are rebuilt when the floor moves (a fill board), and reused when it cannot (legacy)', () => {
    const keep = { ...P };
    try {
      Object.assign(P, BASE);
      const d0 = heightsInputDigest(61, 81);
      P.thickness = 0.2;
      expect(heightsInputDigest(61, 81)).not.toBe(d0);
      Object.assign(P, { terrainFit: 'legacy', thickness: 0.125 });
      const l0 = heightsInputDigest(61, 81);
      P.thickness = 0.2;
      expect(heightsInputDigest(61, 81)).toBe(l0);
    } finally { for (const k of Object.keys(P)) delete P[k]; Object.assign(P, keep); }
  });
});

describe('B) Back: Shell / Flat', () => {
  it("a new board's back is the shell (the default is unchanged); absent reads Shell, bit for bit", () => {
    expect(DEFAULT.backMode).toBe('shell');
    const { heights } = board();
    const shell = buildThickenData(heights, 141, 181, { ...BASE, backMode: 'shell' }, {}).data.offsetPts;
    const absent = buildThickenData(heights, 141, 181, { ...BASE, backMode: undefined }, {}).data.offsetPts;
    expect(same(shell, absent)).toBe(true);
  });
  it('Flat: the back is the board grid at z = 0, every point; the terrain spans 0..carveZ', () => {
    const { heights, back } = board({ backMode: 'flat' });
    for (let k = 0; k < 141 * 181; k++) {
      expect(back[k * 3 + 2]).toBe(0);
      expect(back[k * 3]).toBeCloseTo(-3.5 + (k % 141) * 7 / 140, 6); // float32
      expect(back[k * 3 + 1]).toBeCloseTo(-4.5 + Math.floor(k / 141) * 9 / 180, 6);
    }
    const [lo, hi] = range(heights);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(lo).toBeLessThan(0.02 * 0.9);
    expect(hi).toBeLessThanOrEqual(0.9);
  });
  it('Flat on a legacy board: the same flat back at z = 0 under the old terrain', () => {
    const { heights, back } = board({ terrainFit: 'legacy', backMode: 'flat' });
    expect(range(back, 3, 2)).toEqual([0, 0]);
    expect(range(heights)[0]).toBeGreaterThan(0.2);
  });
  it('Send / STEP: the solid is written from the back points -- Flat sends a bottom whose every control point is at z 0', () => {
    const zeroPts = (step) => (step.match(/CARTESIAN_POINT\('',\([^)]*,0\.000000\)\)/g) || []).length;
    const nx = 11, nz = 13;
    const flat = board({ backMode: 'flat' }, nx, nz), shell = board({}, nx, nz);
    const step = (b) => generateThickenedStep(b.heights, b.back, { widthIn: 7, heightIn: 9, nx, nz, options: { stamped: true } }, b.heights);
    expect(zeroPts(step(flat))).toBeGreaterThanOrEqual(nx * nz); // the whole bottom surface on the stock bottom
    expect(zeroPts(step(shell))).toBeLessThan(nx * nz / 4);
  });
  it('a locked Back (job timeline) still wins: the frozen underside, not the flat one', () => {
    const { heights } = board({ backMode: 'flat' });
    const frozen = new Float32Array(141 * 181).fill(-0.05);
    const t = buildThickenData(heights, 141, 181, { ...BASE, backMode: 'flat' }, { backHeights: frozen });
    expect(range(t.data.offsetPts, 3, 2)).toEqual([-0.05, -0.05].map(Math.fround));
  });
  it("is a string param bound to the Thicken line's #backMode (Shell, Flat)", () => {
    const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
    const at = html.indexOf('id="thickenSettings"');
    const sel = html.indexOf('id="backMode"');
    expect(sel).toBeGreaterThan(at);
    expect(sel).toBeLessThan(html.indexOf('id="brickPanelBody"'));
    expect(html).toMatch(/<select[^>]*id="backMode"[\s\S]*?<option value="shell"[^>]*>Shell<\/option>[\s\S]*?<option value="flat"[^>]*>Flat<\/option>/);
    const keep = P.backMode;
    try { updateP('backMode', 'flat'); expect(P.backMode).toBe('flat'); } finally { P.backMode = keep; }
  });
  it("MIGRATIONS 'back-mode-shell': declared once, writes nothing (absent reads Shell)", () => {
    expect(MIGRATIONS.filter((m) => m.id === 'back-mode-shell')).toHaveLength(1);
    const p = { noiseType: 'simplex' };
    runMigrations(p);
    expect('backMode' in p).toBe(false);
  });
});

afterEach(() => {});
