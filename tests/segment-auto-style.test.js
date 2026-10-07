/**
 * Item 74j (Fred: Shape Lattice segment style "Auto | Straight | Curve", Auto the default; seat D measured in 74g: a styled
 * segment stayed pinned -- Curve then Straight did not return the original shape, SIL-RESOLVE F5 ownership): Auto is a
 * declared choice (editor-shape-lattice-generator.js SEGMENT_STYLE_CHOICES) that un-pins the segment, so the solver shapes
 * it again; a saved segment with no style reads as Auto.
 */
import { describe, it, expect } from 'vitest';
import {
  generateSilhouette, SEGMENT_STYLE_CHOICES, AUTO_SEGMENT_STYLE, segmentStylePatch, segmentChoiceOf,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';

const R = { x: 0, y: 0, w: 7, h: 9 };
const shape = (segments) => ({ preset: 'hourglass', seed: 42, params: {}, ...(segments ? { segments } : {}) });
const geom = (sil) => JSON.stringify(sil.primitives);
const fresh = generateSilhouette(R, shape());
const n = fresh.segments.length;
const CURVE_SEG = fresh.segments.findIndex((s) => s.style === 'curve'); // the solver's own arc (the shoulder)
const withSeg = (i, seg) => fresh.segments.map((s, k) => (k === i ? seg : { ...s }));

describe('item 74j: Auto is a declared segment-style choice', () => {
  it('the choices, in order: Auto, Straight, Curve, Kink -- Auto first (the default)', () => {
    expect(SEGMENT_STYLE_CHOICES.map((c) => c.label)).toEqual(['Auto', 'Straight', 'Curve', 'Kink']);
    expect(SEGMENT_STYLE_CHOICES[0].id).toBe(AUTO_SEGMENT_STYLE);
    for (const c of SEGMENT_STYLE_CHOICES) expect(c.title, c.id).toBeTruthy();
  });
  it('the patch each choice writes: Auto pins nothing; Straight bulge 0; Curve keeps a bulge', () => {
    expect(segmentStylePatch('auto', { bulge: 0.7 })).toEqual({ style: 'auto' });
    expect(segmentStylePatch('straight', { bulge: 0.7 })).toEqual({ style: 'straight', bulge: 0 });
    expect(segmentStylePatch('curve', { bulge: 0.7 })).toEqual({ style: 'curve', bulge: 0.7 });
    expect(segmentStylePatch('curve', {})).toEqual({ style: 'curve', bulge: 0.5 });
  });
});

describe('item 74j: Auto un-pins -- the solver shapes the segment again', () => {
  it('the hourglass has a solver curve to pin', () => { expect(CURVE_SEG).toBeGreaterThanOrEqual(0); });
  it('pinned Straight on the solver\'s curve changes the outline; Auto on it gives back exactly the original', () => {
    const pinned = generateSilhouette(R, shape(withSeg(CURVE_SEG, { style: 'straight', bulge: 0, dir: 'out', user: true })));
    expect(geom(pinned)).not.toBe(geom(fresh));
    expect(segmentChoiceOf(pinned.segments[CURVE_SEG])).toBe('straight');
    const auto = generateSilhouette(R, shape(withSeg(CURVE_SEG, { style: AUTO_SEGMENT_STYLE })));
    expect(geom(auto)).toBe(geom(fresh));
    expect(segmentChoiceOf(auto.segments[CURVE_SEG])).toBe(AUTO_SEGMENT_STYLE);
  });
  it('legacy: a saved segment with NO style reads as Auto (was: a pinned straight)', () => {
    const legacy = generateSilhouette(R, shape(withSeg(CURVE_SEG, { bulge: 0, dir: 'out' })));
    expect(geom(legacy)).toBe(geom(fresh));
    expect(legacy.hasUserSegments).toBe(false);
    expect(n).toBe(legacy.segments.length);
  });
});
