/**
 * SC2 — the single board→Fusion carve transform.
 *
 * The send-to-Fusion path had micro + flip + offset from THREE roots
 * (SC1 trace): the Python _prescale_svg coord regex was comma-only (so
 * space-separated path d passed through untransformed → 1/96 micro), a
 * -(0.5*scale) fudge shifted everything 0.5in down, and it double-flipped
 * with the JS normalizeSvgForCarving <g> wrapper. Option A replaces all of
 * that with ONE affine baked in JS (editor-io.bakeSvgForCarving) built from
 * carveMatrix. This pins the MATH of that single transform; the full svg.js
 * bake is proven in-browser (see WORK-LOG) and confirmed by the human in
 * Fusion. Run: `npm test`.
 */
import { describe, it, expect } from 'vitest';
import { carveMatrix, transformPoint } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-coords.js';

// Convenience: carve a point for a given board.
const carve = (w, h, x, y, dpi = 96) => transformPoint(carveMatrix(w, h, dpi), { x, y });

describe('SC2: carveMatrix (editor svg-space → Fusion px-space)', () => {
  it('has the ONE-scale/ONE-flip/ONE-center shape (no fudge)', () => {
    // 7x9 board, 96 dpi: a=96 (scale), d=-96 (flip Y), e=-336, f=+432 (center)
    expect(carveMatrix(7, 9, 96)).toEqual({ a: 96, b: 0, c: 0, d: -96, e: -336, f: 432 });
  });

  it('maps the board corners + center correctly (right-side-up, centered)', () => {
    expect(carve(7, 9, 0, 0)).toEqual({ x: -336, y: 432 });   // top-left  → up-left
    expect(carve(7, 9, 7, 9)).toEqual({ x: 336, y: -432 });   // bot-right → down-right
    expect(carve(7, 9, 3.5, 4.5)).toEqual({ x: 0, y: 0 });    // center    → origin
  });

  it('flips Y — a point near the top maps to POSITIVE (up) Fusion Y', () => {
    // editor y=2 (near top, Y-down) → +2.5in up from center = +240px.
    // Guards the OFFSET-DOWN bug: the old -(0.5*scale) fudge gave 192 (0.5in low).
    expect(carve(7, 9, 1, 2)).toEqual({ x: -240, y: 240 });
    expect(carve(7, 9, 1, 2).y).not.toBe(192);
  });

  it('scales by dpi — a 1-inch shift is 96px (guards the micro bug)', () => {
    const a = carve(7, 9, 1, 4.5);
    const b = carve(7, 9, 2, 4.5);
    expect(b.x - a.x).toBe(96);   // 1 inch → 96 px (NOT 1 unit = 1/96 micro)
  });

  it('honors board size (centering follows widthIn/heightIn)', () => {
    // 10x5 board: half_w=480, half_h=240. (1,1) → (96-480, 240-96)
    expect(carve(10, 5, 1, 1)).toEqual({ x: -384, y: 144 });
    expect(carve(10, 5, 5, 2.5)).toEqual({ x: 0, y: 0 }); // center
  });

  it('defaults dpi to 96', () => {
    expect(carveMatrix(7, 9)).toEqual(carveMatrix(7, 9, 96));
  });
});
