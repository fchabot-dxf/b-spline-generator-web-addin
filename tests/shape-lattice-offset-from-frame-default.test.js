/**
 * Fred ("a NEW shape lattice should start with 'Offset from frame' ticked at distance 0"): pins the
 * panel's new-lattice default (properties-shape-lattice.js `_offsetFromFrameByDefault`, reached through
 * `currentPattern`, the one lazy-creation point) on EVERY template, and pins that a saved board keeps
 * what it has. PATTERN_DEFAULTS.contour.fromFrame stays OFF on purpose: it is also what an old saved
 * contour without the key merges with, and without a frame there is nothing to follow.
 */
import { describe, it, expect, afterEach } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { setFrameProfileProvider } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { currentPattern } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import { contourFromFrameOf } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';

const editorWith = (pattern) => ({
  _mW: 7, _mH: 9,
  _layers: [{ id: '0', name: 'Layer 1', visible: true, ...(pattern ? { pattern } : {}) }],
  _activeLayer: '0',
});
const chooseFrame = (templateId) => setFrameProfileProvider(() => ({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId }) }));
/** A Shape Lattice already generated and saved (hasGeneratedSilhouette), as a loaded board carries it. */
const savedGenerated = (contour) => ({
  shape: { source: 'generated', preset: 'hourglass' }, extent: { mode: 'boundary' }, ...(contour ? { contour } : {}),
});

afterEach(() => setFrameProfileProvider(null));

describe('a NEW Shape Lattice starts offset from the frame at distance 0', () => {
  const templates = FRAME_DEFS.templates.map((t) => t.id);
  it('the template list is the real one (T16/T17 included)', () => {
    expect(templates).toEqual(expect.arrayContaining(['template_1', 'template_16', 'template_17']));
  });
  it.each(templates)('%s: fromFrame on, distance 0, outer reference', (templateId) => {
    chooseFrame(templateId);
    const p = currentPattern(editorWith());
    expect(p.contour.fromFrame).toMatchObject({ on: true, distance: 0, distanceRef: 'outer' });
    expect(contourFromFrameOf(p)).toEqual({ on: true, distance: 0 });
  });
  it('no frame chosen: off (the toggle is disabled with "Choose a frame first"; ticks once a frame is chosen)', () => {
    const editor = editorWith();
    expect(contourFromFrameOf(currentPattern(editor))).toEqual({ on: false, distance: 0 });
    chooseFrame('template_1');
    expect(contourFromFrameOf(currentPattern(editor))).toEqual({ on: true, distance: 0 });
  });
});

describe('a saved board keeps what it has', () => {
  it('an old generated lattice with no fromFrame key stays off', () => {
    chooseFrame('template_1');
    const p = currentPattern(editorWith(savedGenerated({ show: true, width: null, segmentColors: [] })));
    expect(p.contour.fromFrame).toBeUndefined();
    expect(contourFromFrameOf(p).on).toBe(false);
  });
  it('an old generated lattice with no contour at all stays off', () => {
    chooseFrame('template_1');
    const p = currentPattern(editorWith(savedGenerated(null)));
    expect(p.contour).toBeUndefined();
    expect(contourFromFrameOf(p).on).toBe(false);
  });
  it('a saved explicit off and a saved distance are kept', () => {
    chooseFrame('template_1');
    const off = currentPattern(editorWith(savedGenerated({ show: true, fromFrame: { on: false, distance: 0.4, distanceRef: 'outer' } })));
    expect(off.contour.fromFrame).toEqual({ on: false, distance: 0.4, distanceRef: 'outer' });
    const on = currentPattern(editorWith(savedGenerated({ show: true, fromFrame: { on: true, distance: -0.25, distanceRef: 'outer' } })));
    expect(on.contour.fromFrame).toEqual({ on: true, distance: -0.25, distanceRef: 'outer' });
  });
  it('a panel choice made before the first Generate (userSet, unticked) is kept', () => {
    chooseFrame('template_1');
    const p = currentPattern(editorWith({ contour: { show: true, fromFrame: { on: false, distance: 0, distanceRef: 'outer', userSet: true } } }));
    expect(p.contour.fromFrame.on).toBe(false);
  });
});
