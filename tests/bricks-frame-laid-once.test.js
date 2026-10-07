/**
 * T86 (seat E, MEASURED): a lay whose wall leaves a bare tip (item 16f) laid the frame twice -- once for the wall's inner
 * path, again with the tip zones -- the second as long as the first (CPU, T18 7x9 1.25 in: ~143 -> ~69 ms per lay once
 * fixed). The frame is now PLANNED first (contour-bands opts.planOnly: bands, fit rule, inner path, no pieces) and laid
 * ONCE after the wall. 228 template lays (19 x 4 sizes x single / three band / Stone) were byte-identical either way.
 */
import { describe, it, expect, vi } from 'vitest';
const calls = vi.hoisted(() => ({ full: 0, plan: 0 }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, bricksContourBands: (p, b, o) => { if (o && o.planOnly) calls.plan++; else if (!(o && o.cornerCutsOnly)) calls.full++; return actual.bricksContourBands(p, b, o); } };
});
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { bareTips } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/tip-fill.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const SET = BRICK_SETS[0];
const primsOf = (tpl) => buildRibbonPrimitives(frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: 7, heightIn: 9 } }, 0, 0).primitives);
const lay = (tpl, L, preset = 'single_soldier') => generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 9 }, { x: 0, y: 9 }], set: SET, seed: 1, scale: L / SET.brickLengthIn, suppression: 0, clumping: 0, frame: { primitives: primsOf(tpl), bands: FRAME_PRESETS[preset] } });

describe('the frame is laid once per lay', () => {
  it.each([['template_14', 1.5], ['template_18', 1.25], ['template_1', 1], ['template_2', 1]])('%s at %s in: one plan, one frame lay (with or without bare tips)', (tpl, L) => {
    calls.full = 0; calls.plan = 0;
    const r = lay(tpl, L);
    expect(calls).toEqual({ full: 1, plan: 1 });
    if (tpl === 'template_14') expect(bareTips(r.interiorOutline, r.bricks, scaledSet(SET, L / SET.brickLengthIn)).length).toBeGreaterThan(0); // a tip lay indeed
  });
  it('the plan\'s inner path and fit note are the full lay\'s own (every template, single soldier + three band, 1.25 in)', () => {
    for (const tpl of FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k))) {
      const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: 7, heightIn: 9 } }, 0, 0);
      if (!sil || !sil.primitives) continue;
      const prims = buildRibbonPrimitives(sil.primitives);
      for (const preset of ['single_soldier', 'three_band']) {
        const opts = { set: SET, seed: 1, scale: 1.25 / SET.brickLengthIn };
        const full = bricksContourBands(prims, FRAME_PRESETS[preset], opts), plan = bricksContourBands(prims, FRAME_PRESETS[preset], { ...opts, planOnly: true });
        expect(plan.innerPath, `${tpl} ${preset}`).toEqual(full.innerPath);
        expect(plan.bandsReduced, `${tpl} ${preset}`).toEqual(full.bandsReduced);
        expect(plan.bricks).toEqual([]);
      }
    }
  });
});
