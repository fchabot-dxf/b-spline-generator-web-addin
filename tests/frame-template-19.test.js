/**
 * H23 item 80: Template 19 ("Arched Head - Tapered sides", from Template 18). A COPY of Template 18
 * with taperAngle switched on (default 8 deg, T12/T13's own precedent) -- the shared taper construction
 * itself is covered by tests/frame-taper-construction.test.js; this file covers the TEMPLATE
 * declaration and its own shapeModel composition.
 *
 * MEASURED, this item (turn 556): omitting `shapeExtractor` (T12/T13's own apparent precedent) is
 * WRONG for this template specifically -- unlike T12/T13, the generic `hourglass` extractor does not
 * know to reject a narrow-head+arch shape, so once this template's own goldens existed it silently
 * "fit" from them and DROPPED archRise/topInset/cornerRTop/cornerRBottom/waistOpeningFtIn entirely
 * (every feature that makes this template's own head what it is), keeping only the generic base-
 * hourglass features. Fixed by declaring `shapeExtractor: "hourglass_narrow_arched_head"` (Template
 * 18's own existing always-refuses stub, reused) so this template stays on its provisional model, the
 * SAME safety T18 itself already has. `test_pins_the_full_feature_set` below exists specifically so a
 * regression of this exact class (an extractor silently succeeding and dropping features) fails loudly
 * here instead of only showing up as a visually wrong shape.
 *
 * Un-hidden the same turn: a 22-case live matrix (every declared handle at its own reachable
 * {min, max} + default, x {7x9, 9x12}, T18's own un-hide methodology) is all-BUILT.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T18 = tplOf('template_18'), T19 = tplOf('template_19');

describe('Template 19: declaration', () => {
  it('is "19. Arched Head - Tapered sides", the shared hourglass preset, from Template 18, un-hidden after its own 22-case live matrix', () => {
    expect(T19.name).toBe('Template 19 - Arched Head - Tapered sides');
    expect(frameLabel(T19)).toBe('19. Arched Head - Tapered sides');
    expect(T19.silhouettePreset).toBe('hourglass');
    expect(T19.hidden).toBe(false);
    expect(T19.handles.map((h) => h.key)).toEqual(['archRise', 'topInset', 'waistReach', 'waistCenterY', 'taperAngle']);
    for (const h of T19.handles) expect(h.binding).toBe('seeded');
  });

  it('is provisional, composed from Template 18 plus taperAngle -- not a real fit', () => {
    // The bug this item found: without the right shapeExtractor, this template's own goldens get a
    // REAL fit from the generic hourglass extractor instead, which silently drops every feature that
    // isn't part of a plain Template-1-style pinch. Staying provisional is the correct, safe state
    // until a real narrow-head-arch extractor exists (same as Template 18 itself).
    expect(T19.shapeModel.provisional).toBeDefined();
    expect(T19.shapeModel.provisional.taperAngleDeg).toBe(8);
    expect(T19.shapeModel.features.taperAngle).toEqual({ hw: 0, hh: 0, const: 8 });
  });

  it('pins the full feature set -- an extractor silently dropping features must fail HERE, not just look wrong', () => {
    // Every one of Template 18's own features, kept verbatim (the "from": "template_18" composition),
    // plus taperAngle. Sorted so the assertion doesn't depend on declaration order.
    expect(Object.keys(T19.shapeModel.features).sort()).toEqual([
      'archRise', 'cornerR', 'cornerRBottom', 'cornerRTop', 'depth', 'notch',
      'taperAngle', 'topInset', 'waistCy', 'waistOpeningFtIn', 'waistR',
    ]);
    // Every feature besides taperAngle must be IDENTICAL to Template 18's own -- not just present,
    // but numerically unchanged (the whole point of "every feature kept exactly").
    for (const key of Object.keys(T18.shapeModel.features)) {
      expect(T19.shapeModel.features[key], key).toEqual(T18.shapeModel.features[key]);
    }
  });
});
