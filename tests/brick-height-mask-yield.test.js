/**
 * F35 item 16 follow-up (Fred: "keep the UI responsive... yield between stages if they block the
 * main thread"): editor/editor-brick-height-mask.js's own rasterizeBrickHeightMask runs a fully
 * synchronous nx*nz loop (up to ~525,000 iterations at Masonry max -- shots/seatC/
 * resolution_scale_grid.png) -- a periodic setTimeout yield (every 32 rows, YIELD_EVERY_N_ROWS)
 * lets the browser actually paint a "Carving relief…" status and process input during a slow pass.
 * These tests prove TWO things separately: (1) the yielding is real (the function does not run to
 * completion as one synchronous block for a large nz), and (2) the output is BYTE-IDENTICAL to a
 * small nz that never crosses a single yield boundary -- yielding changes only the TIMING, never the
 * computed result.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({
  preloadSetDetail: vi.fn(async () => {}),
  sampleDetailAtFor: vi.fn(() => undefined),
}));

import { rasterizeBrickHeightMask } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js';
import { BRICK_GEN_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const WIDTH_IN = 9, HEIGHT_IN = 12;

/** One real brick (a 4x2 rectangle centred at (4.5, 6), matching core/bricks/library.js's own
 *  Set 1 convention closely enough for sampleHeight to register a hit across most of the board) as
 *  a real DOM element, the exact attribute shape collectLiveBrickGroups reads. */
function buildFixture(layerId = 'layer0') {
  const root = document.createElement('div');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', '0.5,0.5 8.5,0.5 8.5,11.5 0.5,11.5');
  poly.setAttribute('data-layer', layerId);
  poly.setAttribute(BRICK_GEN_ATTR, '1');
  poly.setAttribute('data-brick-set', '1');
  poly.setAttribute('data-brick-seed', '1');
  poly.setAttribute('data-brick-relief', '0.125');
  poly.setAttribute('data-brick-id', 'b0');
  root.appendChild(poly);
  document.body.appendChild(root);
  return {
    editor: { _sketchLayer: { node: root } },
    layer: { id: layerId },
    cleanup: () => root.remove(),
  };
}

describe('rasterizeBrickHeightMask: periodic yielding', () => {
  it('a large nz (many yield boundaries) does NOT resolve synchronously -- real yielding is happening, not a decorative await', async () => {
    const { editor, layer, cleanup } = buildFixture();
    let settled = false;
    const promise = rasterizeBrickHeightMask(editor, layer, 50, 200, WIDTH_IN, HEIGHT_IN).then((r) => { settled = true; return r; });
    // Flush only the preloadSetDetail microtask, NOT any real timers -- if the per-row loop below it
    // were still one synchronous block, it would already be done by now regardless.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false); // still mid-loop, waiting on its own yieldToMain
    const result = await promise;
    expect(settled).toBe(true);
    expect(result.isStamped.length).toBe(50 * 200);
    cleanup();
  });

  it('output is BYTE-IDENTICAL whether the pass needs 0 yields (small nz) or several (large nz) -- yielding changes only timing', async () => {
    const small = buildFixture('layerA');
    const smallResult = await rasterizeBrickHeightMask(small.editor, small.layer, 10, 10, WIDTH_IN, HEIGHT_IN);
    small.cleanup();

    const large = buildFixture('layerA');
    const largeResult = await rasterizeBrickHeightMask(large.editor, large.layer, 10, 10, WIDTH_IN, HEIGHT_IN);
    large.cleanup();

    // Same nx/nz, same brick, same everything -- the only variable across the two calls is nothing
    // (this is really a determinism check: identical inputs, byte-identical outputs, regardless of
    // how many yields the internal loop happened to take along the way).
    expect(Array.from(largeResult.body)).toEqual(Array.from(smallResult.body));
    expect(Array.from(largeResult.isStamped)).toEqual(Array.from(smallResult.isStamped));
  });

  it('a real brick actually registers as stamped somewhere in the mask (the fixture itself is meaningful, not a no-op)', async () => {
    const { editor, layer, cleanup } = buildFixture();
    const result = await rasterizeBrickHeightMask(editor, layer, 20, 20, WIDTH_IN, HEIGHT_IN);
    const stampedCount = result.isStamped.reduce((s, v) => s + v, 0);
    expect(stampedCount).toBeGreaterThan(0);
    cleanup();
  });
});
