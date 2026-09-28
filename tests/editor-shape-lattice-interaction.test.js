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
  HANDLE_SEGMENT_INDEX, radiusThroughPoint, hitTestArcGrip, waistReachFromCentre,
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

  it('a position handle\'s axis is x or y (never diagonal); a radius handle is its ARC (F27 item 2 arc pull: "more intuitive to pull the arc than the arc center")', () => {
    const out = generateSilhouette(REGION, { preset });
    const handles = computeParamHandles(preset, REGION, out.params);
    for (const h of handles) {
      if (h.handleKind === 'radius') {
        expect(h.axis).toBe('arc');
        expect(h.arcs).toEqual([out.primitives[h.segment], out.primitives[h.mirrorSegment]]);
        expect(h.segment).toBe(HANDLE_SEGMENT_INDEX[preset][h.key]);
        expect(h.mirrorSegment).toBe(mirrorSegmentIndex(h.segment, out.segments.length));
      } else expect(h.axis).toMatch(/^[xy]$/);
    }
    expect(handles.filter((h) => h.handleKind === 'radius').map((h) => h.key).sort())
      .toEqual(preset === 'hourglass' ? ['cornerRadiusBottom', 'cornerRadiusTop', 'waistRadius'] : ['bodyRadius', 'skeletonX']);
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

describe('F27 item 2 arc pull: the pure pieces', () => {
  const at = (a, t, d = 0) => { const th = a.theta1 + a.dTheta * t; return { x: a.cx + (a.rx + d) * Math.cos(th), y: a.cy + (a.rx + d) * Math.sin(th) }; };

  it('radiusThroughPoint: the value whose circle passes through the point; past the range, the nearer limit', () => {
    const circleAt = (v) => ({ cx: 0, cy: 0, r: v }); // concentric circles: r = v
    expect(radiusThroughPoint(circleAt, { min: 0.1, max: 5 }, 1, { x: 3, y: 4 })).toBeCloseTo(5, 9);
    expect(radiusThroughPoint(circleAt, { min: 0.1, max: 5 }, 1, { x: 0.3, y: 0.4 })).toBeCloseTo(0.5, 9);
    expect(radiusThroughPoint(circleAt, { min: 0.1, max: 2 }, 1, { x: 30, y: 40 })).toBe(2);
    expect(radiusThroughPoint(circleAt, { min: 0.1, max: 2 }, 1, { x: 0, y: 0 })).toBe(0.1);
  });

  it('radiusThroughPoint tracks the CURRENT branch: of two roots, the one on the current sheet of the family', () => {
    // circles through the origin, centred on the x axis: r = |v|, centre (v, 0). A point (x, y) lies on it
    // for one v; a family folding back (centre (-v) past 0) is covered by the orientation test.
    const circleAt = (v) => ({ cx: v, cy: 0, r: Math.abs(v) });
    const v = radiusThroughPoint(circleAt, { min: 0.05, max: 10 }, 2, { x: 1, y: 1 }); // (x-v)^2 + 1 = v^2 -> v = 1
    expect(v).toBeCloseTo(1, 9);
  });

  it('hitTestArcGrip: either side\'s arc within tolerance -> { handle, side }; a far point -> null; a non-arc handle never', () => {
    const out = generateSilhouette(REGION, { preset: 'hourglass', seed: 42 });
    const hs = computeParamHandles('hourglass', REGION, out.params);
    const top = hs.find((h) => h.key === 'cornerRadiusTop');
    const onRight = at(top.arcs[0], 0.4, 0.02), onLeft = at(top.arcs[1], 0.4, -0.02);
    expect(hitTestArcGrip(hs, onRight, 0.05)).toMatchObject({ handle: { key: 'cornerRadiusTop' }, side: 0 });
    expect(hitTestArcGrip(hs, onLeft, 0.05)).toMatchObject({ handle: { key: 'cornerRadiusTop' }, side: 1 });
    expect(hitTestArcGrip(hs, onRight, 0.01)).toBeNull();
    expect(hitTestArcGrip(hs, { x: REGION.w / 2, y: REGION.h / 2 }, 0.05)).toBeNull();
    expect(hitTestArcGrip(hs.filter((h) => h.axis !== 'arc'), onRight, 1)).toBeNull();
  });

  it('the arcs are the DRAWN ones: opts.strokeHalfWidth insets them exactly as the contour is drawn, and the drag solves there', () => {
    const shape = { preset: 'hourglass', seed: 42, params: {} };
    const sh = 0.06;
    const drawn = generateSilhouette(REGION, shape, sh);
    const hs = computeParamHandles('hourglass', REGION, drawn.params, undefined, { strokeHalfWidth: sh, shape });
    const top = hs.find((h) => h.key === 'cornerRadiusTop');
    expect(top.arcs[0]).toEqual(drawn.primitives[1]);
    const q = at(top.arcs[0], 0.5, 0.05);
    const v = top.valueFromWorld(q);
    const a1 = generateSilhouette(REGION, { ...shape, params: { cornerRadiusTop: v } }, sh).primitives[1];
    expect(Math.hypot(q.x - a1.cx, q.y - a1.cy)).toBeCloseTo(a1.rx, 6);
  });

  it('a user-styled segment (the param no longer drives it) has no grip; the rest keep theirs', () => {
    const out = generateSilhouette(REGION, { preset: 'hourglass', seed: 42 });
    const segments = out.segments.map((sg, i) => (i === 1 || i === 9 ? { style: 'straight', bulge: 0, dir: 'out', user: true } : sg));
    const hs = computeParamHandles('hourglass', REGION, out.params, undefined, { shape: { seed: 42, params: {}, segments } });
    expect(hs.find((h) => h.key === 'cornerRadiusTop')).toBeUndefined();
    expect(hs.find((h) => h.key === 'cornerRadiusBottom').axis).toBe('arc');
  });

  it('waistReachFromCentre: unparked, the centre is the pointer; parked, no jump at the edge and continuous inward', () => {
    const geo = { cx0: 0, hw: 1, edge: 1, radiusWaist: 0.4 };
    // centre = pinch + Rw = (1 - reach) + 0.4: reach 0.6 -> centre 0.8 (on the board)
    expect(waistReachFromCentre(geo, 0.7, 0.6)).toBeCloseTo(0.7, 12); // centre 0.7 -> reach 0.7
    // reach 0.2 -> centre 1.2, past the edge by 0.2: parked
    expect(waistReachFromCentre(geo, 1, 0.2)).toBeCloseTo(0.2, 12);
    expect(waistReachFromCentre(geo, 5, 0.2)).toBeCloseTo(0.2, 12);
    expect(waistReachFromCentre(geo, 0.999, 0.2)).toBeCloseTo(0.2, 2);
    expect(waistReachFromCentre(geo, 0.5, 0.2)).toBeCloseTo(1.4 - (0.5 + 0.2 * 0.5), 12); // blended
    expect(waistReachFromCentre(geo, 0, 0.2)).toBeCloseTo(1.4, 12); // at the centre line: under the pointer
  });
});
