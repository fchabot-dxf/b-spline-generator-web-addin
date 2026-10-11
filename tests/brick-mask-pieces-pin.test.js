/**
 * Fred 2026-10-11 ("the 2D pattern isn't the same in 3D"), MEASURED in the app: the 3D height mask is built from exactly the
 * 2D pieces (shots/seatE/mask: 0 piece interiors without mask height, 0 - 39 edge pixels of 4500 outside every piece). The
 * claim, pinned: the brick height mask (editor-brick-height-mask.js, what the 3D carves) covers each laid piece with THAT
 * piece and nothing else, and a motif's raised pieces carve RELIEF_LEVELS.raised above its flush ones.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({
  preloadSetDetail: vi.fn(async () => {}),
  sampleDetailAtFor: vi.fn(() => undefined),
}));

import { rasterizeBrickHeightMask } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js';
import { BRICK_GEN_ATTR, buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS, RELIEF_LEVELS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

const W = 7, H = 10, NX = 141, NZ = 201, SET = BRICK_SETS[0];

/** the zigzag motif frame laid by the engine, written as the editor draws it (drawBrick's attributes) */
function laidFixture() {
  const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1, scale: 1.25 / SET.brickLengthIn,
    suppression: 0, clumping: 0, frame: { primitives: buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: W, y2: H })), bands: FRAME_PRESETS.zigzag_band } });
  const root = document.createElement('div');
  r.frameBricks.forEach((b, k) => {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', b.polygon.map((p) => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('data-layer', 'L');
    poly.setAttribute(BRICK_GEN_ATTR, '1');
    poly.setAttribute('data-brick', 'frame');
    poly.setAttribute('data-brick-set', '1');
    poly.setAttribute('data-brick-seed', '1');
    poly.setAttribute('data-brick-id', `p${k}`);
    poly.setAttribute('data-brick-height-offset', String(b.heightOffset || 0));
    root.appendChild(poly);
  });
  document.body.appendChild(root);
  return { bricks: r.frameBricks, editor: { _sketchLayer: { node: root } }, cleanup: () => root.remove() };
}

describe('the 3D height mask is built from the 2D pieces', () => {
  it('each grid point inside a laid piece is covered by that piece; none outside every piece is covered', async () => {
    const f = laidFixture();
    const m = await rasterizeBrickHeightMask(f.editor, { id: 'L' }, NX, NZ, W, H, { topMode: 'flat' });
    f.cleanup();
    // flat mode's brickOf numbers the pieces in DOM order within their (set, seed, relief) group -- one group here
    expect(m.flatTop.count).toBe(f.bricks.length);
    let wrong = 0, missed = 0, stray = 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const x = (i / (NX - 1)) * W, y = H * (1 - j / (NZ - 1)), k = j * NX + i, b = m.flatTop.brickOf[k];
      const home = f.bricks.findIndex((p) => pointInPolygon(x, y, p.polygon));
      if (home >= 0 && b < 0) missed++;
      else if (home >= 0 && b !== home) wrong++;
      else if (home < 0 && b >= 0) stray++;
    }
    expect({ missed, wrong, stray }).toEqual({ missed: 0, wrong: 0, stray: 0 });
  });
  it('a motif\'s raised pieces carve RELIEF_LEVELS.raised above its flush ones (their faces, as the 3D carves them)', async () => {
    const f = laidFixture();
    const m = await rasterizeBrickHeightMask(f.editor, { id: 'L' }, 41, 57, W, H);
    f.cleanup();
    const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const face = (k) => m.faces[`frame:p${k}`];
    const motif = f.bricks.map((b, k) => ({ b, k })).filter(({ b }) => b.relief);
    const up = mean(motif.filter(({ b }) => b.relief === 'raised').map(({ k }) => face(k)));
    const flat = mean(motif.filter(({ b }) => b.relief === 'flush').map(({ k }) => face(k)));
    expect(up - flat).toBeGreaterThan(RELIEF_LEVELS.raised - 2 * SET.heightJitterIn);
  });
});
