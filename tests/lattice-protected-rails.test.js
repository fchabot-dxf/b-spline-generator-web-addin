/**
 * Fred (protected rails): a recoloured / striped / cut generated rail is protected from Generate. computePattern
 * places each protected rail (PATTERN.protectedRails, a row fraction `at` of the rail extent) on the nearest
 * generated row, tagging the segment it becomes with `protect`; a row that no longer has the same number of pieces
 * gives the protection up.
 */
import { describe, it, expect } from 'vitest';
import { computePattern, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

const extent = { iMin: 0, jMin: 0, iMax: 10, jMax: 10 };
const base = { ...PATTERN_DEFAULTS, seed: 3, rails: { ...PATTERN_DEFAULTS.rails, mode: 'every', every: 2, offset: 0 } };
const rails = (r) => r.segments.filter((s) => s.kind === 'rail');

describe('protected rails', () => {
  it('no protection: output identical to before (no protect keys)', () => {
    const a = computePattern(base, { extent });
    const b = computePattern({ ...base, protectedRails: [] }, { extent });
    expect(b).toEqual(a);
    expect(rails(a).some((s) => 'protect' in s)).toBe(false);
  });

  it('a protected rail on a generated row keeps that row (count unchanged)', () => {
    const pr = { j: 4, at: 0.4, span: 0, spans: 1, pieces: [{ len: 10, color: '#f00', stripe: null }] };
    const r = computePattern({ ...base, protectedRails: [pr] }, { extent });
    expect(rails(r)).toHaveLength(rails(computePattern(base, { extent })).length);
    const tagged = rails(r).filter((s) => s.protect === 0);
    expect(tagged).toHaveLength(1);
    expect(tagged[0].a.j).toBe(4);
  });

  it('follows the extent: the same fraction on a taller extent lands on the nearest row there', () => {
    const pr = { j: 4, at: 0.4, span: 0, spans: 1, pieces: [{ len: 10, color: '#f00', stripe: null }] };
    const r = computePattern({ ...base, protectedRails: [pr] }, { extent: { ...extent, jMax: 20 } });
    expect(rails(r).find((s) => s.protect === 0).a.j).toBe(8);
  });

  it('snaps an off-grid protected rail onto the nearest generated row', () => {
    const pr = { j: 4.6, at: 0.46, span: 0, spans: 1, pieces: [{ len: 10, color: '#f00', stripe: null }] };
    const r = computePattern({ ...base, protectedRails: [pr] }, { extent });
    expect(rails(r).find((s) => s.protect === 0).a.j).toBe(4);
  });

  it('a row with a different number of pieces gives the protection up', () => {
    const pr = { j: 4, at: 0.4, span: 1, spans: 2, pieces: [{ len: 5, color: '#f00', stripe: null }] };
    const r = computePattern({ ...base, protectedRails: [pr] }, { extent });
    expect(rails(r).some((s) => s.protect != null)).toBe(false);
  });

  it('outside the extent: dropped', () => {
    const pr = { j: 40, at: 4, span: 0, spans: 1, pieces: [{ len: 10, color: '#f00', stripe: null }] };
    const r = computePattern({ ...base, protectedRails: [pr] }, { extent });
    expect(rails(r).some((s) => s.protect != null)).toBe(false);
  });

  it('works in vertical orientation (the row is a column in real space)', () => {
    const pr = { j: 6, at: 0.6, span: 0, spans: 1, pieces: [{ len: 10, color: '#f00', stripe: null }] };
    const r = computePattern({ ...base, orientation: 'vertical', protectedRails: [pr] }, { extent });
    const t = rails(r).find((s) => s.protect === 0);
    expect(t.a.i).toBe(6);
    expect(t.b.i).toBe(6);
  });
});
