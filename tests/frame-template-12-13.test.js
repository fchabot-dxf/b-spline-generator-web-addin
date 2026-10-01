/**
 * F30 item 3 (Fred's own taper copies): Template 12 ("Hourglass - Tapered sides", from Template 1) and
 * Template 13 ("Narrow Neck - Tapered sides", from Template 2). Both are COPIES of their base template with
 * taperAngle switched on (default 8 deg) -- the shared construction itself is covered thoroughly by
 * tests/frame-taper-construction.test.js; this file covers the TEMPLATE declaration and the frame-level
 * pipeline (frameCutProfile/frameInnerProfile/frameMiters/Generate) each one now drives.
 *
 * Both are FRAME_HIDDEN (no recorded Fusion goldens yet; a provisional shapeModel built from the base
 * template's own fit, same pattern as Template 3/4/5/10) until live-verified in Fusion -- done this pass
 * (sketch 2 "Shape Outline" only, at 7x9 and 6x9: converges to the correct arc branch, symmetric, the top
 * horn slanted at exactly the default 8 deg, no reflex/wrong-branch arcs -- see WORK-LOG-fb-app.md for the
 * live constraint-solve values). Sketch 3 (enclosure/miters/solid) and a saved Fusion golden are not yet
 * recorded, hence still hidden.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { generateFrameSeeds, generateValidFrameSeeds } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T12 = tplOf('template_12'), T13 = tplOf('template_13');
const T = 0.75; // the default frame thickness
const BOARDS = [[7, 9], [6, 9], [11, 14], [5, 7]]; // portrait only, Fred's current usage
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec = (id, seeds, extra = {}) => normalizeFrameRecord({ templateId: id, seeds, ...extra });
const profile = (id, seeds, W = 7, H = 9) => frameCutProfile(FRAME_DEFS, rec(id, seeds), board(W, H));
const inner = (id, seeds, W = 7, H = 9) => frameInnerProfile(FRAME_DEFS, rec(id, seeds), board(W, H));

describe('Template 12/13: declaration', () => {
  it('Template 12 is "12. Hourglass - Tapered sides", the shared hourglass preset, hidden, from Template 1', () => {
    expect(T12.name).toBe('Template 12 - Hourglass - Tapered sides');
    expect(frameLabel(T12)).toBe('12. Hourglass - Tapered sides');
    expect(T12.silhouettePreset).toBe('hourglass');
    expect(T12.hidden).toBe(true);
    expect(T12.shapeModel.provisional.taperAngleDeg).toBe(8);
    expect(T12.shapeModel.features.taperAngle).toEqual({ hw: 0, hh: 0, const: 8 });
    // every one of Template 1's own fitted features is KEPT (not replaced, unlike T10's own rebuild).
    const T1 = tplOf('template_1');
    for (const k of ['cornerR', 'depth', 'notch', 'waistCy', 'waistR']) {
      expect(T12.shapeModel.features[k]).toEqual(T1.shapeModel.features[k]);
    }
  });

  it('Template 13 is "13. Narrow Neck - Tapered sides", the shared bottle preset, hidden, with a REAL fit '
    + '(bottle_taper, from its own recorded goldens) that still carries taperAngle', () => {
    expect(T13.name).toBe('Template 13 - Narrow Neck - Tapered sides');
    expect(frameLabel(T13)).toBe('13. Narrow Neck - Tapered sides');
    expect(T13.silhouettePreset).toBe('bottle');
    expect(T13.hidden).toBe(true);
    // F30 item 3: goldens recorded 2026-10-01 (tests/fixtures/frame-parity/template_13_*.json) pass
    // `bottle_taper`'s own validity check at 2 of 3 sizes, so this is no longer the provisional model --
    // frame_definition.py's own template_shape_model still re-applies taperAngle unconditionally.
    expect(T13.shapeModel.provisional).toBeUndefined();
    expect(T13.shapeModel.fit.fittedFrom.length).toBeGreaterThanOrEqual(2);
    expect(T13.shapeModel.features.taperAngle).toEqual({ hw: 0, hh: 0, const: 8 });
    // the REAL fit's own features are independently measured from this template's OWN goldens (a different,
    // smaller set than Template 2's own fit uses), so they're close but not identical to Template 2's.
    for (const k of ['bodyR', 'neckHalfW', 'neckR', 'neckTop']) {
      expect(T13.shapeModel.features[k]).toHaveProperty('hw');
      expect(T13.shapeModel.features[k]).toHaveProperty('hh');
    }
  });

  it('neither gets a taperAngle handle yet (lands in a later pass, advisor-confirmed 2026-10-01)', () => {
    for (const t of [T12, T13]) expect(t.handles.map((h) => h.key)).not.toContain('taperAngle');
  });
});

describe.each([['template_12', () => T12, '12'], ['template_13', () => T13, '13']])(
  'Template %s: the tapered top stays within the board, a clean outer AND inner outline', (id, getT, _n) => {
    it.each(BOARDS)('%dx%d: a clean outer outline at the default (8 deg) taper', (W, H) => {
      const prof = profile(id, {}, W, H);
      expect(prof.defects, `${W}x${H}`).toEqual([]);
      expect(prof.primitives.length, `${W}x${H}`).toBe(getT().regions.outline.length);
    });

    it.each(BOARDS)('%dx%d: a clean inner outline (or none, if the board is too small to fit a frame)', (W, H) => {
      const prof = profile(id, {}, W, H);
      const innr = inner(id, {}, W, H);
      if (prof.fit.ok) expect(innr.defects, `${W}x${H}`).toEqual([]);
    });

    it('7x9: real miters between the outer and inner profile', () => {
      const prof = profile(id, {}, 7, 9);
      const innr = inner(id, {}, 7, 9);
      expect(prof.fit.ok).toBe(true);
      const miters = frameMiters(prof.primitives, innr.primitives);
      expect(miters.length).toBeGreaterThan(0);
    });

    it('[Generate] draws a valid outer AND inner outline, 50 seeds x portrait boards (the advisor: '
      + '"Generate must never produce a broken frame")', () => {
      const isValid = (seeds, W, H) => {
        const innr = inner(id, seeds, W, H);
        return !innr || innr.defects.length === 0;
      };
      for (const [W, H] of BOARDS) {
        const region = profile(id, {}, W, H).region;
        for (let seed = 1; seed <= 50; seed++) {
          const seeds = generateValidFrameSeeds(getT(), region, seed, T, (s) => isValid(s, W, H));
          const prof = profile(id, seeds, W, H), innr = inner(id, seeds, W, H);
          expect(prof.defects, `${W}x${H} seed ${seed}`).toEqual([]);
          if (prof.fit.ok) expect(innr.defects, `${W}x${H} seed ${seed}`).toEqual([]);
        }
      }
    });
  },
);

describe('Template 12/13: Fred\'s own extreme-taper tolerance ("don\'t worry too much about extremes... it\'s '
  + 'enough that Generate never produces a broken frame and tests confirm nothing crashes")', () => {
  it.each([['template_12', () => T12], ['template_13', () => T13]])('%s: an explicit extreme manual taperAngle '
    + '(+/-15, the declared band) never crashes Generate/the profile pipeline, at 7x9', (id, getT) => {
    for (const taperAngle of [-15, 15]) {
      expect(() => {
        const prof = profile(id, { taperAngle }, 7, 9);
        inner(id, { taperAngle }, 7, 9);
        if (prof.fit.ok) frameMiters(prof.primitives, inner(id, { taperAngle }, 7, 9).primitives);
      }, `${id} taperAngle ${taperAngle}`).not.toThrow();
    }
  });
});
