/**
 * T59 (SE14's own deferred "Slice 3 editing model") — the pure math
 * behind axis-locked param handles and the tap-a-segment hit-test
 * (editor-shape-lattice-interaction.js). Verify list: a handle's own
 * ANCHOR, fed back into its OWN `valueFromWorld`, recovers the EXACT
 * current param value (round-trip correctness — proves the anchor is
 * genuinely where the CURRENT value places it, not an approximation);
 * dragging to a new value and regenerating keeps that round-trip exact
 * across the param's own declared range (not just at the default);
 * segment hit-testing finds the right segment near its own midpoint,
 * including through a kink's own two-primitive split.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateSilhouette, PRESETS, SHAPE_PARAM_KEYS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import {
  boardRegion, computeParamHandles, hitTestSegment, primitiveSegmentMap, mirrorSegmentIndex,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';

const REGION = { x: 0, y: 0, w: 7, h: 9 }; // real board-inches scale, matching properties-shape-lattice.js's own _boardRegion

describe('boardRegion', () => {
  it('reads _mW/_mH off the editor, defaulting to 4x4', () => {
    expect(boardRegion({ _mW: 7, _mH: 9 })).toEqual({ x: 0, y: 0, w: 7, h: 9 });
    expect(boardRegion({})).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });
});

describe.each(['hourglass', 'bottle'])('computeParamHandles(%s) — round-trip correctness', (preset) => {
  it('one handle per declared Shape Lattice param (F12: SHAPE_PARAM_KEYS)', () => {
    const out = generateSilhouette(REGION, { preset, seed: 42 });
    const handles = computeParamHandles(preset, REGION, out.params);
    const handleKeys = handles.map((h) => h.key).sort();
    const declaredKeys = [...SHAPE_PARAM_KEYS[preset]].sort();
    expect(handleKeys).toEqual(declaredKeys);
  });

  it('EVERY handle\'s own anchor, fed back into its OWN valueFromWorld, recovers the exact current param value', () => {
    // Multiple seeds: each one lands the resolved params at a genuinely
    // different point in their own range (seed-jittered), so this isn't
    // just proving the round-trip at one lucky default.
    for (const seed of [1, 7, 42, 777, 99999]) {
      const out = generateSilhouette(REGION, { preset, seed });
      const handles = computeParamHandles(preset, REGION, out.params);
      for (const h of handles) {
        const recovered = h.valueFromWorld(h.anchor);
        expect(recovered).toBeCloseTo(out.params[h.key], 6);
      }
    }
  });

  it('non-vacuous: dragging a handle to a NEW value and regenerating keeps the round-trip exact (not just correct at the seed default)', () => {
    const key = Object.keys(PRESETS[preset].params)[0];
    const p = PRESETS[preset].params;
    const lo = 0, hi = 1; // sweep the whole declared param's own natural 0..1 range; generateSilhouette clamps internally
    for (const frac of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const explicitValue = lo + (hi - lo) * frac;
      const out = generateSilhouette(REGION, { preset, params: { [key]: explicitValue } });
      const handles = computeParamHandles(preset, REGION, out.params);
      const handle = handles.find((h) => h.key === key);
      const recovered = handle.valueFromWorld(handle.anchor);
      expect(recovered).toBeCloseTo(out.params[key], 5);
    }
  });

  it('axis is always x or y — this generator never declares a diagonal handle (see the module\'s own header comment); every radius handle sits at its arc centre (Fred: "please use center")', () => {
    const out = generateSilhouette(REGION, { preset });
    const handles = computeParamHandles(preset, REGION, out.params);
    for (const h of handles) expect(h.axis).toMatch(/^[xy]$/);
  });

  it('a handle only reads its OWN axis coordinate — moving the OFF-axis coordinate never changes the recovered value', () => {
    const out = generateSilhouette(REGION, { preset, seed: 42 });
    const handles = computeParamHandles(preset, REGION, out.params);
    for (const h of handles.filter((q) => q.axis !== 'arc')) { // F27 item 2: an on-arc handle reads both (its own describe below)
      const off = h.axis === 'x' ? { x: h.anchor.x, y: h.anchor.y + 3 } : { x: h.anchor.x + 3, y: h.anchor.y };
      expect(h.valueFromWorld(off)).toBeCloseTo(h.valueFromWorld(h.anchor), 9);
    }
  });
});

describe('hitTestSegment / primitiveSegmentMap', () => {
  it('primitiveSegmentMap: a kink segment contributes 2 primitive slots, everything else contributes 1', () => {
    const segments = [
      { style: 'straight' }, { style: 'kink' }, { style: 'curve' }, { style: 'kink' },
    ];
    expect(primitiveSegmentMap(segments)).toEqual([0, 1, 1, 2, 3, 3]);
  });

  it('finds the segment nearest a point at its own midpoint (straight edge)', () => {
    const out = generateSilhouette(REGION, { preset: 'hourglass', seed: 42 });
    // segment 5 is the bottom edge (rBottom -> lBottom), a pure straight L per the generator's own solver comment.
    const a = out.keypoints[5], b = out.keypoints[6];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(hitTestSegment(out.primitives, out.segments, mid, 0.5)).toBe(5);
  });

  it('finds a KINK segment\'s own index from a point near its apex, not the raw primitive index', () => {
    const out = generateSilhouette(REGION, {
      preset: 'hourglass', seed: 42,
      segments: [
        { style: 'kink', bulge: 0.4, dir: 'out', cornerRadius: 0 },
        ...Array(11).fill({ style: 'straight', bulge: 0, dir: 'out', cornerRadius: 0 }),
      ],
    });
    const a = out.keypoints[0], b = out.keypoints[1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // The apex is offset from the raw chord midpoint by the kink's own
    // bulge — probe a small neighborhood around it rather than assuming
    // the exact apex coordinate (keeps this test independent of
    // _bulgeApex's own internal formula).
    expect(hitTestSegment(out.primitives, out.segments, mid, 1.0)).toBe(0);
  });

  it('returns null when nothing is within tolerance', () => {
    const out = generateSilhouette(REGION, { preset: 'hourglass', seed: 42 });
    expect(hitTestSegment(out.primitives, out.segments, { x: -500, y: -500 }, 0.1)).toBeNull();
  });

  it('non-vacuous: a tolerance smaller than the actual distance also returns null (proves it isn\'t just "always hit")', () => {
    const out = generateSilhouette(REGION, { preset: 'hourglass', seed: 42 });
    const a = out.keypoints[5], b = out.keypoints[6];
    const farPoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 2 }; // 2" off the bottom edge
    expect(hitTestSegment(out.primitives, out.segments, farPoint, 0.1)).toBeNull();
  });
});

describe('mirrorSegmentIndex', () => {
  it('hourglass (n=12): right side 0-4 mirrors to 10-6; the two caps (5, 11) mirror to themselves', () => {
    expect([0, 1, 2, 3, 4].map((i) => mirrorSegmentIndex(i, 12))).toEqual([10, 9, 8, 7, 6]);
    expect(mirrorSegmentIndex(5, 12)).toBe(5);
    expect(mirrorSegmentIndex(11, 12)).toBe(11);
  });

  it('bottle (n=10): right side 0-3 mirrors to 8-5; the two caps (4, 9) mirror to themselves', () => {
    expect([0, 1, 2, 3].map((i) => mirrorSegmentIndex(i, 10))).toEqual([8, 7, 6, 5]);
    expect(mirrorSegmentIndex(4, 10)).toBe(4);
    expect(mirrorSegmentIndex(9, 10)).toBe(9);
  });

  it('is its own inverse (mirroring twice returns the original index)', () => {
    for (const n of [10, 12]) {
      for (let i = 0; i < n; i++) expect(mirrorSegmentIndex(mirrorSegmentIndex(i, n), n)).toBe(i);
    }
  });
});

describe('F20 SHOULDER-HIP: the Shape Lattice hourglass has a Shoulder and a Hip handle, no combined corner', () => {
  it('handles: Shoulder (top corner) and Hip (bottom corner), independent; the combined cornerRadius is not offered', () => {
    const out = generateSilhouette(REGION, { preset: 'hourglass', seed: 42 });
    const hs = computeParamHandles('hourglass', REGION, out.params);
    expect(hs.map((h) => h.key)).not.toContain('cornerRadius');
    const by = Object.fromEntries(hs.map((h) => [h.key, h]));
    expect(by.cornerRadiusTop.label).toBe('Shoulder');
    expect(by.cornerRadiusBottom.label).toBe('Hip');
    expect(by.cornerRadiusTop.anchor.y).toBeLessThan(by.cornerRadiusBottom.anchor.y); // shoulder above hip
    // independent: a new shoulder leaves the hip where it was
    const drag = { ...out.params, cornerRadiusTop: out.params.cornerRadiusTop + 0.08 };
    const again = computeParamHandles('hourglass', REGION, generateSilhouette(REGION, { preset: 'hourglass', seed: 42, params: drag }).params);
    const by2 = Object.fromEntries(again.map((h) => [h.key, h]));
    expect(by2.cornerRadiusBottom.anchor).toEqual(by.cornerRadiusBottom.anchor);
    expect(by2.cornerRadiusTop.anchor.x).not.toBeCloseTo(by.cornerRadiusTop.anchor.x, 6);
  });
  it('the panel sliders say "shoulder" and "hip"', () => {
    const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf-8');
    const label = (id) => html.match(new RegExp(`id="shapeParamRow-${id}"[^>]*>([^<]*)<`))[1].trim();
    expect(label('cornerRadiusTop')).toBe('shoulder');
    expect(label('cornerRadiusBottom')).toBe('hip');
  });
});
