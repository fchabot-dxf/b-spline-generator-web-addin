/**
 * F30 item 3 (Fred's own taper copies): Template 12 ("Hourglass - Tapered sides", from Template 1) and
 * Template 13 ("Narrow Neck - Tapered sides", from Template 2). Both are COPIES of their base template with
 * taperAngle switched on (default 8 deg) -- the shared construction itself is covered thoroughly by
 * tests/frame-taper-construction.test.js; this file covers the TEMPLATE declaration, the frame-level pipeline
 * (frameCutProfile/frameInnerProfile/frameMiters/Generate) each one now drives, and the "Taper angle" handle.
 *
 * Both are FRAME_HIDDEN (no Fusion golden for Template 12 -- its tapered goldens don't pass the generic
 * hourglass extractor's own validity check at 2+ sizes, so it stays on a provisional shapeModel built from
 * Template 1's own fit, same pattern as Template 3/4/5/10; Template 13 DOES have a real fit, from its own
 * recorded goldens via a taper-aware `bottle_taper` extractor) until Fred has seen an actual built solid, not
 * just these numeric/sketch confirmations -- both sketch 2 (shape outline) AND sketch 3 (enclosure/miters/solid
 * cut) are live-Fusion-verified, at multiple board sizes, with real recorded goldens for both templates (see
 * WORK-LOG-fb-app.md for the live constraint-solve values and the golden-recording session).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameHandles, handleDragPatch, generateFrameSeeds, generateValidFrameSeeds } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { HANDLE_SEGMENT_INDEX } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
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
  it('Template 12 is "12. Hourglass - Tapered sides", the shared hourglass preset, shown (F30 item 4), from Template 1', () => {
    expect(T12.name).toBe('Template 12 - Hourglass - Tapered sides');
    expect(frameLabel(T12)).toBe('12. Hourglass - Tapered sides');
    expect(T12.silhouettePreset).toBe('hourglass');
    expect(T12.hidden).toBeFalsy();
    expect(T12.shapeModel.provisional.taperAngleDeg).toBe(8);
    expect(T12.shapeModel.features.taperAngle).toEqual({ hw: 0, hh: 0, const: 8 });
    // every one of Template 1's own fitted features is KEPT (not replaced, unlike T10's own rebuild).
    const T1 = tplOf('template_1');
    for (const k of ['cornerR', 'depth', 'notch', 'waistCy', 'waistR']) {
      expect(T12.shapeModel.features[k]).toEqual(T1.shapeModel.features[k]);
    }
  });

  it('Template 13 is "13. Narrow Neck - Tapered sides", the shared bottle preset, shown (F30 item 4), with a REAL fit '
    + '(bottle_taper, from its own recorded goldens) that still carries taperAngle', () => {
    expect(T13.name).toBe('Template 13 - Narrow Neck - Tapered sides');
    expect(frameLabel(T13)).toBe('13. Narrow Neck - Tapered sides');
    expect(T13.silhouettePreset).toBe('bottle');
    expect(T13.hidden).toBeFalsy();
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

  it('both carry a "Taper angle" handle, seeded, basis hw (advisor-confirmed design, 2026-10-01)', () => {
    for (const t of [T12, T13]) {
      const h = t.handles.find((x) => x.key === 'taperAngle');
      expect(h, t.id).toMatchObject({ label: 'Taper angle', basis: 'hw', binding: 'seeded' });
    }
  });
});

describe('Template 12/13: the "Taper angle" handle (advisor-confirmed design: a position square at the top '
  + 'corner, mirrored left, a horizontal drag narrows/widens it)', () => {
  const drag = (id, key, seeds, dx, dy, W = 7, H = 9) => {
    const r = rec(id, seeds);
    const prof = frameCutProfile(FRAME_DEFS, r, board(W, H));
    const hs = frameHandles(tplOf(id), prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec: r, next: normalizeFrameRecord({ ...r, ...handleDragPatch(r, h, pt, prof.region) }) };
  };

  it.each([['template_12', 'x'], ['template_13', 'x']])('%s: the handle is axis %s (horizontal), its own ONE '
    + 'segment index declared', (id) => {
    const { h, hs } = drag(id, 'taperAngle', {}, 0, 0);
    expect(h.axis).toBe('x');
    expect(h.handleKind).toBe('position');
    expect(hs.map((x) => x.key)).toContain('taperAngle');
    const preset = tplOf(id).silhouettePreset;
    expect(HANDLE_SEGMENT_INDEX[preset].taperAngle).toBe(0); // the horn itself, same convention as topInset's own
  });

  it.each(['template_12', 'template_13'])('%s: dragging left/right at 7x9 narrows/widens the top corner, '
    + 'staying inside the declared [-15, 15] band, and the shape stays clean', (id) => {
    const { prof: base } = drag(id, 'taperAngle', {}, 0, 0);
    const baseDeg = base.params.taperAngle;
    // the top corner's own x decreases as taperAngle increases (frame-taper-construction.test.js's own finding):
    // dragging the right-side handle RIGHTWARD (toward the board edge, +dx) widens it (more negative taperAngle);
    // dragging it LEFTWARD (toward the centre, -dx) narrows it (more positive).
    const { next: wider } = drag(id, 'taperAngle', {}, 0.5, 0);
    const { next: narrower } = drag(id, 'taperAngle', {}, -0.5, 0);
    const widerProf = frameCutProfile(FRAME_DEFS, wider, board(7, 9));
    const narrowerProf = frameCutProfile(FRAME_DEFS, narrower, board(7, 9));
    expect(widerProf.params.taperAngle).toBeLessThan(baseDeg);
    expect(narrowerProf.params.taperAngle).toBeGreaterThan(baseDeg);
    for (const p of [widerProf, narrowerProf]) {
      expect(p.params.taperAngle).toBeGreaterThanOrEqual(-15 - 1e-6);
      expect(p.params.taperAngle).toBeLessThanOrEqual(15 + 1e-6);
      expect(p.defects).toEqual([]);
    }
  });

  it.each(['template_12', 'template_13'])('%s: dragged far past the band, the handle stops at its own feasible '
    + 'range and the frame stays valid (real miters)', (id) => {
    const { next: lo } = drag(id, 'taperAngle', {}, -50, 0);
    const { next: hi } = drag(id, 'taperAngle', {}, 50, 0);
    for (const rec_ of [lo, hi]) {
      const p = frameCutProfile(FRAME_DEFS, rec_, board(7, 9));
      expect(p.defects).toEqual([]);
      expect(p.params.taperAngle).toBeGreaterThanOrEqual(-15 - 1e-6);
      expect(p.params.taperAngle).toBeLessThanOrEqual(15 + 1e-6);
      if (p.fit.ok) {
        const innr = frameInnerProfile(FRAME_DEFS, rec_, board(7, 9));
        expect(innr.defects).toEqual([]);
        expect(frameMiters(p.primitives, innr.primitives).length).toBeGreaterThan(0);
      }
    }
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
