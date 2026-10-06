/**
 * Item 69 (seat E, measured): the Thicken offset slider (step 0.01) could not hold its own default 0.125 -- it showed
 * and snapped to 0.13, so a slider round trip never got back to 1/8". Every paired slider's P default must sit on
 * that slider's own step grid (min + k * step).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT, SLIDER_PAIRS } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const html = readFileSync(path.resolve(process.cwd(), 'bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html'), 'utf8');
const attrsOf = (id) => {
  const m = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
  if (!m) return null;
  const a = (n) => { const x = m[0].match(new RegExp(`\\s${n}="([^"]*)"`)); return x ? x[1] : null; };
  return { min: Number(a('min') ?? 0), step: a('step') };
};

describe('every paired slider can hold its own default', () => {
  it('DEFAULT[key] is on the slider step grid', () => {
    const off = [];
    for (const [key, sliderId] of Object.entries(SLIDER_PAIRS)) {
      const s = attrsOf(sliderId); const d = DEFAULT[key];
      if (!s || typeof d !== 'number' || !s.step || s.step === 'any') continue;
      const k = (d - s.min) / Number(s.step);
      if (Math.abs(k - Math.round(k)) > 1e-6) off.push(`${key} ${d} on ${sliderId} min ${s.min} step ${s.step}`);
    }
    expect(off).toEqual([]);
  });
});
