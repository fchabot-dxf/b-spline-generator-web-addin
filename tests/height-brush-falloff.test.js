/**
 * HEIGHT-PAINTER (Fred 2026-11-22: "for a brush I'd also want to decide the falloff profile"): the brush's falloff PROFILE is
 * a declared choice (core/height/brush.js BRUSH_FALLOFFS) beside the hardness. Hardness says WHERE the roll-off starts
 * (1 inside hardness * R), the profile says its SHAPE between there and the rim R. The default ('smooth') is the slice-1
 * curve exactly, so nothing painted before changes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { brushFalloff, BRUSH_FALLOFFS, BRUSH_DEFAULTS, createStroke } from '../bspline-frame-builder/b-spline-gen/html/core/height/brush.js';

const R = 1, HARD = 0.2;
const at = (profile, t) => brushFalloff(HARD * R + t * (R - HARD * R), R, HARD, profile); // t: 0 at the hardness edge, 1 at the rim

describe('BRUSH_FALLOFFS: the declared profiles', () => {
  it('declares smooth (the default), linear, dome, soft, spike and plateau, each with a label', () => {
    expect(Object.keys(BRUSH_FALLOFFS)).toEqual(['smooth', 'linear', 'dome', 'soft', 'spike', 'plateau', 'custom']); // + 'custom' (tests/height-brush-custom-curve.test.js)
    for (const p of Object.values(BRUSH_FALLOFFS)) expect(typeof p.label).toBe('string');
    expect(BRUSH_DEFAULTS.falloff).toBe('smooth');
  });

  it('every profile: 1 inside the hard core, 0 at and past the rim, never rising outward', () => {
    for (const p of Object.keys(BRUSH_FALLOFFS)) {
      expect(brushFalloff(0, R, HARD, p), p).toBe(1);
      expect(brushFalloff(HARD * R, R, HARD, p), p).toBe(1);
      expect(brushFalloff(R, R, HARD, p), p).toBe(0);
      expect(brushFalloff(1.5 * R, R, HARD, p), p).toBe(0);
      let prev = 1;
      for (let i = 1; i < 50; i++) { const v = at(p, i / 50); expect(v, `${p} @ ${i}`).toBeLessThanOrEqual(prev + 1e-12); prev = v; }
    }
  });

  it('their shapes, half-way through the roll-off', () => {
    expect(at('smooth', 0.5)).toBeCloseTo(0.5, 12);
    expect(at('linear', 0.5)).toBeCloseTo(0.5, 12);
    expect(at('dome', 0.5)).toBeCloseTo(Math.sqrt(0.75), 12);
    expect(at('spike', 0.5)).toBeCloseTo(0.125, 12);
    expect(at('plateau', 0.5)).toBeCloseTo(1 - 1 / 64, 12);
    expect(at('soft', 0.5)).toBeCloseTo(Math.exp(-4.5 * 0.25) * Math.pow(0.5, 0.25), 12);
    // the shapes really differ: dome holds up, spike drops, at the same point
    expect(at('dome', 0.5)).toBeGreaterThan(at('smooth', 0.5));
    expect(at('spike', 0.5)).toBeLessThan(at('linear', 0.5));
  });

  it('no profile given = smooth = the slice-1 curve, exactly', () => {
    for (let i = 0; i <= 20; i++) {
      const r = i / 20, t = Math.max(0, (r - HARD) / (1 - HARD));
      const legacy = r <= HARD ? 1 : r >= 1 ? 0 : 1 - t * t * (3 - 2 * t);
      expect(brushFalloff(r, R, HARD)).toBeCloseTo(legacy, 14);
      expect(brushFalloff(r, R, HARD, 'smooth')).toBeCloseTo(legacy, 14);
    }
  });
});

describe('the panel declares the Falloff choice', () => {
  it('HEIGHT_CONTROLS has a brush "falloff" choice listing every profile, right after Hardness', async () => {
    const { HEIGHT_CONTROLS } = await import('../bspline-frame-builder/b-spline-gen/html/main/height-panel.js');
    const ids = HEIGHT_CONTROLS.map((c) => c.id);
    const c = HEIGHT_CONTROLS.find((x) => x.id === 'falloff');
    expect(c).toMatchObject({ group: 'brush', target: 'brush', kind: 'choice', path: ['falloff'] });
    expect(c.options.map(([k]) => k)).toEqual(Object.keys(BRUSH_FALLOFFS));
    expect(ids.indexOf('falloff')).toBe(ids.indexOf('tip') + 1); // Fred 2026-11-22: no presets -- Falloff right after Tip, above size / hardness
  });
});

describe('the stroke uses the brush\'s profile', () => {
  let raster;
  beforeEach(() => { raster = { cols: 41, rows: 41, data: new Float32Array(41 * 41) }; });
  const paint = (falloff) => {
    const s = createStroke(raster, { ...BRUSH_DEFAULTS, mode: 'set', targetIn: 1, opacity: 1, flow: 1, sizeIn: 0.4, hardness: 0.2, falloff }, { pxPerInX: 100, pxPerInY: 100 });
    s.addPoint(20, 20, 1); // one dab at the pixel centre (20, 20)
    return raster.data[20 * 41 + 20 + 14]; // a pixel 14 px out (0.14 in, inside the 0.2 in radius, past the 0.04 in core)
  };
  it('a dome dab stands higher at the same ring than a spike dab', () => {
    const dome = paint('dome');
    raster = { cols: 41, rows: 41, data: new Float32Array(41 * 41) };
    const spike = paint('spike');
    expect(dome).toBeGreaterThan(spike + 0.2);
  });
});
