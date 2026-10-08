/**
 * The panel's corner / fan checks (frameCornerEffect, frameHasFan -> bricksContourBands opts.cornerCutsOnly) count the
 * bands' ROW joints only, so they lay no stones. MEASURED 2026-10-07 (phone width, 4x CPU throttle): a Brick-set tap on
 * a stone-ring frame took 13.8 s to paint, 9 s of it these checks laying the ring's whole fieldstone fill 4x
 * (cornerCutsOnly skipped the rows' pieces but not an area band's). Skipping them: the same answers on 720 cases (4
 * templates x 2 sizes x every set x every frame preset x 2 brick sizes), 472.5 -> 30.7 ms CPU per check.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';

const fills = vi.hoisted(() => ({ n: 0 }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/fill-shape.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, bricksFillShape: (...a) => { fills.n++; return actual.bricksFillShape(...a); } };
});

import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands, frameCornerEffect, frameHasFan } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }), board: { widthIn: 7, heightIn: 9 } }, 0, 0);
const prims = buildRibbonPrimitives(sil.primitives);
const cases = Object.values(BRICK_SETS).flatMap((set) => Object.values(FRAME_PRESETS).map((bands) => ({ set, bands, opts: { set, seed: 1, scale: 0.75 / set.brickLengthIn } })));

describe('the corner / fan checks lay no stones', () => {
  it('a full lay fills an area band somewhere in the sweep (the case the checks must skip exists)', () => {
    fills.n = 0;
    for (const c of cases) bricksContourBands(prims, c.bands, c.opts);
    expect(fills.n).toBeGreaterThan(0);
  });
  it('frameCornerEffect and frameHasFan never fill one, on any set x preset', () => {
    fills.n = 0;
    for (const c of cases) { frameCornerEffect(prims, c.bands, c.opts); frameHasFan(prims, c.bands, c.opts); }
    expect(fills.n).toBe(0);
  });
});
