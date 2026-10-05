/**
 * SIL-RESOLVE (F5, Fred 2026-09-26): silhouette arcs must NEVER invert.
 * Fred's live case — Hourglass with a high corner radius — drew the
 * shoulder/waist arcs looping over each other. Root cause: the waist radius
 * was `hw*waistReach - hw*cornerRadius`, negative whenever
 * cornerRadius > waistReach (the old clamp was `<= 0.95 - waistReach`).
 *
 * Every outline must pass the shared guard `outlineDefects` (simple loop,
 * tangent at every arc joint, positive radius, no reversed arc), for every
 * slider combination, on several board sizes, in both orientations.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import {
  generateSilhouette, generateContourSilhouette, outlineDefects, feasibleParamRanges, PRESETS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // the declared heavy-test timeout: timed out at 5 s under the fleet's load (turns 261-265)

const R79 = { x: 0, y: 0, w: 7, h: 9 };

describe("Fred's looping case (red before the fix)", () => {
  // Read off Fred's screenshot: waist reach ~28% of its slider (0.05..0.92),
  // corner radius ~70% (0.04..0.6), waist position mid.
  const fred = { preset: 'hourglass', params: { waistReach: 0.294, cornerRadius: 0.432, waistCenterY: 0 } };

  it('resolves to a clean outline (no loop, tangent, positive sweeps)', () => {
    const sil = generateSilhouette(R79, fred);
    expect(outlineDefects(sil.primitives)).toEqual([]);
  });

  it('keeps the requested corner radius instead of silently clamping it', () => {
    const sil = generateSilhouette(R79, fred);
    expect(sil.params.cornerRadius).toBeCloseTo(0.432, 6);
  });
});

describe('AMEND 1 target: shallow waist with LARGE shoulder/hip radii (Fusion T1-like)', () => {
  // 7x9 board, waist bulging in only ~0.4 in each side, big shoulder radius.
  const hw = R79.w / 2;
  const target = { preset: 'hourglass', params: { waistReach: 0.4 / hw, cornerRadius: 0.5, waistCenterY: 0 } };

  it('is clean and keeps its large radius and its shallow waist', () => {
    const sil = generateSilhouette(R79, target);
    expect(outlineDefects(sil.primitives)).toEqual([]);
    const arcs = sil.primitives.filter((p) => p.type === 'A');
    const shoulder = arcs[0];
    expect(shoulder.rx).toBeCloseTo(0.5 * hw, 6); // 1.75 in: large, as requested
    // Innermost x of the right waist = hw - 0.4 in (the shallow pinch).
    const waist = arcs[1];
    expect(waist.cx - waist.rx).toBeCloseTo(R79.w - 0.4, 6);
    expect(waist.rx).toBeLessThan(shoulder.rx); // a small round waist between large shoulders
  });
});

// ---------------------------------------------------------------- dense sweep
const REGIONS = [
  { x: 0, y: 0, w: 7, h: 9 }, // portrait
  { x: 0, y: 0, w: 9, h: 7 }, // landscape (other orientation)
  { x: 0, y: 0, w: 12, h: 6 }, // wide
  { x: 0, y: 0, w: 5, h: 5 }, // square
  { x: 0, y: 0, w: 3, h: 2 }, // small board
];
const STROKES = [0, 0.05];
const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
// The panel sliders' own ranges (bspline_gen_palette.html shapeParam-* inputs).
const SLIDERS = {
  hourglass: { waistReach: [0.05, 0.92], cornerRadius: [0.04, 0.6], waistCenterY: [-0.6, 0.6] },
  bottle: { neckWidth: [0.05, 0.85], skeletonX: [0.1, 0.95], neckLength: [0.08, 0.85] },
};

function grid(preset) {
  const keys = Object.keys(PRESETS[preset].params);
  const values = keys.map((k) => linspace(...SLIDERS[preset][k], 7));
  const out = [];
  for (const a of values[0]) for (const b of values[1]) for (const c of values[2]) {
    out.push({ [keys[0]]: a, [keys[1]]: b, [keys[2]]: c });
  }
  return out;
}

describe.each(['hourglass', 'bottle'])('dense sweep: %s', (preset) => {
  it('every slider combination x board x orientation x stroke is clean', () => {
    const bad = [];
    for (const region of REGIONS) {
      for (const stroke of STROKES) {
        for (const params of grid(preset)) {
          const sil = generateContourSilhouette(region, { preset, params }, stroke * 2);
          const d = outlineDefects(sil.primitives);
          if (d.length) bad.push({ region: `${region.w}x${region.h}`, stroke, params, defect: d[0] });
          if (bad.length > 5) break;
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('resolved params always sit inside the declared feasible range', () => {
    for (const region of REGIONS) {
      for (const params of grid(preset)) {
        const sil = generateSilhouette(region, { preset, params });
        const ranges = feasibleParamRanges(preset, region, sil.params);
        for (const [k, v] of Object.entries(sil.params)) {
          expect(v).toBeGreaterThanOrEqual(ranges[k].min - 1e-9);
          expect(v).toBeLessThanOrEqual(ranges[k].max + 1e-9);
        }
      }
    }
  });

  it('a value inside the declared feasible range is honoured exactly (no silent clamp)', () => {
    for (const region of REGIONS) {
      const base = generateSilhouette(region, { preset, params: {} }).params;
      const ranges = feasibleParamRanges(preset, region, base);
      const [key] = Object.keys(ranges).slice(-1); // the most-dependent param (resolved last)
      const mid = (ranges[key].min + ranges[key].max) / 2;
      const sil = generateSilhouette(region, { preset, params: { ...base, [key]: mid } });
      expect(sil.params[key]).toBeCloseTo(mid, 9);
    }
  });
});

describe('the guard itself', () => {
  it('flags a reversed / looping outline', () => {
    // A figure-eight: two lines that cross.
    const prims = [
      { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 1, y: 1 } },
      { type: 'L', p0: { x: 1, y: 1 }, p1: { x: 1, y: 0 } },
      { type: 'L', p0: { x: 1, y: 0 }, p1: { x: 0, y: 1 } },
      { type: 'L', p0: { x: 0, y: 1 }, p1: { x: 0, y: 0 } },
    ];
    expect(outlineDefects(prims).map((d) => d.kind)).toContain('selfIntersection');
  });

  it('passes the default presets on the 7x9 board', () => {
    for (const preset of ['hourglass', 'bottle']) {
      expect(outlineDefects(generateSilhouette(R79, { preset }).primitives)).toEqual([]);
    }
  });
});

describe('stored segments after a slider change (the second loop mechanism)', () => {
  // The panel stores shape.segments after every Generate and passes them back
  // in. Before F5 those were reused verbatim, bulges computed for the OLD
  // params: at Fred's params that alone gave 8 non-tangent joints.
  it('solver-owned segments are re-solved from the current params', () => {
    const first = generateSilhouette(R79, { preset: 'hourglass' });
    const fred = { waistReach: 0.294, cornerRadius: 0.432, waistCenterY: 0 };
    const again = generateSilhouette(R79, { preset: 'hourglass', params: fred, segments: first.segments });
    expect(outlineDefects(again.primitives)).toEqual([]);
    expect(again.hasUserSegments).toBe(false);
  });

  it('a user-styled segment survives a param change verbatim (and only tangency is relaxed)', () => {
    const first = generateSilhouette(R79, { preset: 'hourglass' });
    const segs = first.segments.map((s) => ({ ...s }));
    segs[1] = { style: 'kink', bulge: 0.3, dir: 'out', cornerRadius: 0, user: true };
    const again = generateSilhouette(R79, { preset: 'hourglass', params: { cornerRadius: 0.3 }, segments: segs });
    expect(again.hasUserSegments).toBe(true);
    expect(again.segments[1]).toMatchObject({ style: 'kink', bulge: 0.3, user: true });
    expect(outlineDefects(again.primitives, { requireTangency: false })).toEqual([]);
  });

  it('a legacy styled segment (no flag, style differs from the solver) counts as user-owned', () => {
    const first = generateSilhouette(R79, { preset: 'hourglass' });
    const segs = first.segments.map((s) => ({ ...s }));
    segs[2] = { style: 'straight', bulge: 0, dir: 'out', cornerRadius: 0 };
    const again = generateSilhouette(R79, { preset: 'hourglass', segments: segs });
    expect(again.segments[2].style).toBe('straight');
    expect(again.hasUserSegments).toBe(true);
  });
});

// ---------------------------------------------------------------- F12 SHAPE-PARAMS dense sweep
// the new params set together, and each one ALONE (the others left at their
// defaults: e.g. only the waist radius moved, the corners still the old shared one)
const NEW_PARAM_SETS = {
  hourglass: [['waistRadius', 'cornerRadiusTop', 'cornerRadiusBottom'], ['waistRadius'], ['cornerRadiusTop'], ['cornerRadiusBottom']],
  bottle: [['bodyRadius']],
};
const coarse = (preset) => {
  const keys = Object.keys(PRESETS[preset].params);
  const values = keys.map((k) => linspace(...SLIDERS[preset][k], 4));
  const out = [];
  for (const a of values[0]) for (const b of values[1]) for (const c of values[2]) out.push({ [keys[0]]: a, [keys[1]]: b, [keys[2]]: c });
  return out;
};

describe.each(['hourglass', 'bottle'])('F12 dense sweep of the NEW params: %s', (preset) => {
  it('each new param at its range min / mid / max (given the ones before it) is clean and honoured exactly', () => {
    const bad = [];
    let checked = 0;
    const fracs = [0, 0.5, 1];
    for (const set of NEW_PARAM_SETS[preset]) for (const region of REGIONS) for (const stroke of STROKES) for (const base of coarse(preset)) {
      // every combination of the set's fractions, each resolved in PARAM_ORDER on top of the previous ones
      const combos = set.reduce((acc) => acc.flatMap((c) => fracs.map((f) => [...c, f])), [[]]);
      for (const combo of combos) {
        const params = { ...base };
        let sil = generateContourSilhouette(region, { preset, params }, stroke * 2);
        set.forEach((key, i) => {
          const r = feasibleParamRanges(preset, region, sil.params, stroke)[key];
          params[key] = r.min + (r.max - r.min) * combo[i];
          sil = generateContourSilhouette(region, { preset, params }, stroke * 2);
        });
        checked++;
        const d = outlineDefects(sil.primitives);
        const off = set.filter((k) => Math.abs(sil.params[k] - params[k]) > 1e-9);
        if (d.length || off.length) bad.push({ region: `${region.w}x${region.h}`, stroke, params, defect: d[0], clamped: off });
        if (bad.length > 5) break;
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThan(preset === 'hourglass' ? 10000 : 1000);
  }, 20000); // H23 item 31: hourglass alone measured ~2.6s unloaded; timed out at the 5s default under
  // concurrent full-suite load (H23 items 18/29) -- same fix as frame-3d-sweep.test.js's own sweep,
  // explicit headroom, not fewer combinations checked.
});
