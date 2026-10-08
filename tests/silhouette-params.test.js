/**
 * 2026-10-08 (seat A): frame Generate's draw (generateFrameSeeds) read the resolved params at each step through
 * generateSilhouette(...).params, building the whole outline every time. silhouetteParams returns the same object
 * WITHOUT the build: every solver's params are its own _resolveParams draw, reported through one declaration
 * (SILHOUETTE_SOLVERS' frameOnlyWhenSet). MEASURED: draw 264 - 281 -> 199 - 215 ms, retry loop -11% (3 profile
 * pairs); the seeds every template generates byte-identical over 95 cases (5 boards x 19 templates x 30 seeds).
 * This pins the two to the same JSON (key order included) wherever the app asks.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, findFrameTemplate, frameParam } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { generateFrameSeeds } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import {
  PRESETS, PARAM_ORDER, generateSilhouette, silhouetteParams, paramsFromShapeModel,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';

const same = (region, shape, label) =>
  expect(JSON.stringify(silhouetteParams(region, shape)), label).toBe(JSON.stringify(generateSilhouette(region, shape).params));

describe('silhouetteParams is generateSilhouette(...).params without the outline', () => {
  for (const [W, H] of [[7, 9], [9, 12], [12, 6]]) {
    it(`every frame template, along its draw (${W}x${H}, 3 seeds, + no params)`, () => {
      for (const tdef of FRAME_DEFS.templates) {
        const rec = normalizeFrameRecord({ templateId: tdef.id });
        const tpl = findFrameTemplate(FRAME_DEFS, rec.templateId);
        const region = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H }).region;
        const t = frameParam(FRAME_DEFS, rec, 'frame_thickness');
        const preset = tpl.silhouettePreset;
        same(region, { preset }, `${tdef.id} no params`);
        for (const seed of [1, 2, 3]) {
          const drawn = generateFrameSeeds(tpl, region, seed * 7919, t);
          const params = { ...paramsFromShapeModel(preset, tpl.shapeModel, region) };
          for (const key of PARAM_ORDER[preset]) {
            same(region, { preset, params }, `${tdef.id} seed ${seed} before ${key}`);
            if (drawn[key] != null) params[key] = drawn[key];
          }
        }
      }
    });
  }
  it('every Shape Lattice preset, its own seeds; an unknown preset resolves as the hourglass', () => {
    const region = { x: 0, y: 0, w: 6, h: 8 };
    for (const preset of [...Object.keys(PRESETS), 'notAPreset']) {
      for (const seed of [1, 42, 99]) same(region, { preset, seed }, `${preset} seed ${seed}`);
    }
  });
});
