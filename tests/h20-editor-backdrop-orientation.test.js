/**
 * H20 item 1 (Fred, screenshots): the SVG editor's terrain backdrop was
 * vertically flipped relative to the real 3D TOP view (ground truth) — the
 * Anatomical filter's ribs showed at the TOP of the editor backdrop and the
 * chest "V" at the BOTTOM, the opposite of the 3D TOP view. The frame
 * outline (a separate, vector-drawn overlay) was correct in both, so only
 * the raster terrain backdrop's row order was wrong.
 *
 * `canvas.getContext('2d')` returns null in this test environment (see
 * tests/stamp-mask-clear.test.js's own note on the same gap), so this tests
 * the extracted, canvas-free `computeTopViewPixels` directly — the exact
 * function `updateEditorTopView` now feeds into `ctx.putImageData`.
 *
 * MEASURED, not reasoned: an asymmetric heightmap (a raised region in the
 * grid's own high-j half — the same "a whole band, not a point" shape as
 * the real bug report's ribs), read back from the computed RGBA buffer, and
 * asserted to render in the SAME half of the canvas as it occupies in the
 * grid — i.e. matching terrain.js's own row order (top-view.js's "canvas
 * py=0 is at the Back (j=nz-1)" convention).
 *
 * (An early draft of this test used a small flat plateau as the "bump" —
 * it measured no signal at all, passing vacuously either way. Traced (by
 * computing the shading formula by hand, not by guessing) to the shading
 * being driven entirely by LOCAL GRADIENT/cavity: a flat plateau's own
 * interior has zero gradient and zero cavity relative to its (also flat)
 * neighbours, so it renders identically to flat background everywhere
 * except its own edge. Fixed by using a step BETWEEN two flat halves
 * instead — the real discriminating signal then concentrates at the one
 * row straddling the step, which is what these tests actually measure.)
 */
import { describe, it, expect } from 'vitest';
import { computeTopViewPixels } from '../bspline-frame-builder/b-spline-gen/html/core/render-topview.js';

const NX = 20, NZ = 20;

/** Two flat halves with a step between them at j=NZ/2 — the real
 *  discriminating signal (gradient) concentrates at that one boundary row. */
function stepHeightmap(tallHalf) {
  const heights = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const inTallHalf = tallHalf === 'high' ? j >= NZ / 2 : j < NZ / 2;
      heights[j * NX + i] = inTallHalf ? 0.9 : 0.2;
    }
  }
  return heights;
}

function halfSums(data) {
  let topHalfSum = 0, bottomHalfSum = 0;
  for (let py = 0; py < NZ / 2; py++) for (let px = 0; px < NX; px++) topHalfSum += data[(py * NX + px) * 4];
  for (let py = NZ / 2; py < NZ; py++) for (let px = 0; px < NX; px++) bottomHalfSum += data[(py * NX + px) * 4];
  return { topHalfSum, bottomHalfSum };
}

describe('H20 item 1: editor backdrop row order matches the 3D TOP view (terrain.js\'s own j=0..nz-1)', () => {
  it('a raised region at HIGH j (the back of the board) renders in the TOP half of the canvas', () => {
    const data = computeTopViewPixels(stepHeightmap('high'), NX, NZ, 'none');
    const { topHalfSum, bottomHalfSum } = halfSums(data);
    // Ground truth (top-view.js's own documented convention): j=nz-1 (back)
    // must land near canvas py=0 (top of the image the user sees).
    expect(topHalfSum, `top-half sum ${topHalfSum} vs bottom-half ${bottomHalfSum}`).toBeGreaterThan(bottomHalfSum);
  });

  it('a raised region at LOW j (the front of the board) renders in the BOTTOM half of the canvas', () => {
    const data = computeTopViewPixels(stepHeightmap('low'), NX, NZ, 'none');
    const { topHalfSum, bottomHalfSum } = halfSums(data);
    expect(bottomHalfSum, `bottom-half sum ${bottomHalfSum} vs top-half ${topHalfSum}`).toBeGreaterThan(topHalfSum);
  });

  it('same check holds with Mirror X (symmetry) on', () => {
    const data = computeTopViewPixels(stepHeightmap('high'), NX, NZ, 'x');
    const { topHalfSum, bottomHalfSum } = halfSums(data);
    expect(topHalfSum, `top-half sum ${topHalfSum} vs bottom-half ${bottomHalfSum}`).toBeGreaterThan(bottomHalfSum);
  });

  it('same check holds with Mirror X (symmetry) off, restated for the LOW-j case (both symmetry states covered for both quadrants)', () => {
    const data = computeTopViewPixels(stepHeightmap('low'), NX, NZ, 'x');
    const { topHalfSum, bottomHalfSum } = halfSums(data);
    expect(bottomHalfSum, `bottom-half sum ${bottomHalfSum} vs top-half ${topHalfSum}`).toBeGreaterThan(topHalfSum);
  });
});
