/**
 * 2026-10-08 (seat A): frame Generate's draw (generateFrameSeeds) asked frameParamRanges for EVERY key's range at
 * each step and read one -- its slowest part (MEASURED: frameParamRanges 310 - 334 ms of a 19-template x 20-seed
 * Generate sweep, ~100 ms with one key; the whole retry loop -20%). It now asks for `onlyKey`. A one-key range must
 * be EXACTLY the full table's entry for that key, for every template, board and draw step -- including the rules
 * whose presence test reads another key (T5 / T8's dip width + depth, T18's topInset with archRise, T4's left pinch).
 * The seeds every template generates were also byte-identical before / after over 95 cases (5 boards x 19
 * templates x 30 seeds, scratch sweep) -- this pins the invariant itself.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, findFrameTemplate, frameParam } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameParamRanges, generateFrameSeeds } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { PARAM_ORDER, generateSilhouette, paramsFromShapeModel } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';

const BOARDS = [[7, 9], [9, 12], [12, 6]];

describe('frameParamRanges for one key is the full table entry for that key', () => {
  for (const [W, H] of BOARDS) {
    it(`every template, every key, every draw step (${W}x${H}, 3 seeds)`, () => {
      let checked = 0;
      for (const tdef of FRAME_DEFS.templates) {
        const rec = normalizeFrameRecord({ templateId: tdef.id });
        const tpl = findFrameTemplate(FRAME_DEFS, rec.templateId);
        const region = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H }).region;
        const t = frameParam(FRAME_DEFS, rec, 'frame_thickness');
        const preset = tpl.silhouettePreset;
        for (const seed of [1, 2, 3]) {
          const drawn = generateFrameSeeds(tpl, region, seed * 7919, t);
          const params = { ...paramsFromShapeModel(preset, tpl.shapeModel, region) };
          for (const step of PARAM_ORDER[preset]) {
            const resolved = generateSilhouette(region, { preset, params }).params;
            const full = frameParamRanges(tpl, region, resolved, t);
            for (const key of PARAM_ORDER[preset]) {
              expect(frameParamRanges(tpl, region, resolved, t, key)[key], `${tdef.id} ${W}x${H} seed ${seed} step ${step} key ${key}`).toEqual(full[key]);
              checked++;
            }
            if (drawn[step] != null) params[step] = drawn[step];
          }
        }
      }
      expect(checked).toBeGreaterThan(1000);
    });
  }
});
