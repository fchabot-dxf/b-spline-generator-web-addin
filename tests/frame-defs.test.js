/**
 * FB-APP S2 (F6), design §2.2: the JS side of the generated frame definition.
 * The Python side (bspline-frame-builder/frame-builder/test_frame_defs.py)
 * proves the file is FRESH; this proves it is the shape the app reads.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { PRESETS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { readFileSync } from 'node:fs';

describe('frame-defs (generated) — schema', () => {
  it('is a version the app understands, with no frame by default', () => {
    expect(FRAME_DEFS.frameDefsVersion).toBe(1);
    expect(FRAME_DEFS.defaultTemplate).toBeNull();
    expect(FRAME_DEFS.units).toBe('in');
  });

  it('declares the 5 woods with Ash as the default', () => {
    expect(FRAME_DEFS.appearance.default).toBe('3D Ash - Unfinished');
    // F12: real Fusion library names (validated against the recorded listing in test_frame_defs.py);
    // F14 (Fred): only 3D grain ones, Cherry retired, Oak added
    expect(FRAME_DEFS.appearance.options).toEqual([
      '3D Ash - Unfinished', '3D Mahogany - Unfinished', '3D Pine - Unfinished',
      '3D Maple - Painted', '3D Oak - Painted',
    ]);
  });

  it('F14: a saved Cherry frame migrates to the default Ash (an unlisted wood gets the default)', async () => {
    const { normalizeFrameRecord } = await import('../bspline-frame-builder/b-spline-gen/html/core/frame-record.js');
    expect(normalizeFrameRecord({ templateId: 'template_1', appearance: 'Cherry' }).appearance).toBe('3D Ash - Unfinished');
    // the pre-F12 name too
    expect(normalizeFrameRecord({ templateId: 'template_1', appearance: '3D Cherry - Unfinished' }).appearance).toBe('3D Ash - Unfinished');
    expect(normalizeFrameRecord({ templateId: 'template_1', appearance: '3D Oak - Painted' }).appearance).toBe('3D Oak - Painted');
  });

  it('F12: a wood saved under its old non-existent name keeps its choice (declared rename)', async () => {
    const { normalizeFrameRecord } = await import('../bspline-frame-builder/b-spline-gen/html/core/frame-record.js');
    expect(FRAME_DEFS.appearance.renamed).toEqual({ '3D Maple - Unfinished': '3D Maple - Painted' });
    expect(normalizeFrameRecord({ templateId: 'template_1', appearance: '3D Maple - Unfinished' }).appearance).toBe('3D Maple - Painted');
    expect(normalizeFrameRecord({ templateId: 'template_1', appearance: 'Balsa' }).appearance).toBe('3D Ash - Unfinished');
  });

  it('declares frame bottom as a Z position (negative, -1 in)', () => {
    const z = FRAME_DEFS.extrusion.find((s) => s.key === 'frameBottomZ');
    expect(z).toMatchObject({ param: 'frame_height_offset', default: -1, unit: 'in', ui: true });
  });

  it.each(FRAME_DEFS.templates.map((t) => [t.id, t]))('%s: preset, shape params and params are complete', (_id, t) => {
    expect(PRESETS[t.silhouettePreset]).toBeTruthy();
    // F8: the shape is a model fitted from the recorded Fusion goldens, with its fit report.
    // T6 TAB TOP: the frame-only tabTop preset's model: the tab's half width and height.
    // T8 DIPPED TOP + LEFT-ONLY WAVE: the frame-only dippedLeftWave preset's model: the wave's own depth/height,
    // the dip's half width, depth and (new) position -- no base template, like T6's tab top.
    // T9 I SHAPE: the frame-only iShape preset's model: the stem's half width and the flange height -- no base
    // template either, like T6's tab top.
    // T7 DIAMOND-TOP HOURGLASS: the frame-only diamondTopHourglass preset's model: the neck's half width and
    // height, the body flare height -- no base template either, like T6's tab top.
    // T11 HOURGLASS ROOF: the frame-only diamondTopHourglassPinch preset's model: Template 1's own split-corner
    // feature set (cornerR/cornerRTop/cornerRBottom/waistR/waistCy/notch/depth) -- no base template either, like
    // T6's tab top (frame_shape_fit.provisional_diamond_top_hourglass_pinch_model).
    const FEATURES = { hourglass: ['cornerR', 'depth', 'notch', 'waistCy', 'waistR'], bottle: ['bodyR', 'neckHalfW', 'neckR', 'neckTop'],
      tabTop: ['tabHalfWidth', 'tabHeight'], dippedLeftWave: ['topDipDepth', 'topDipHalfWidth', 'topDipPosition', 'waveCy', 'waveDepth'],
      iShape: ['flangeHeight', 'stemHalfWidth'], diamondTopHourglass: ['bodyFlareHeight', 'gableNeckWidth', 'neckHeight'],
      diamondTopHourglassPinch: ['cornerR', 'cornerRBottom', 'cornerRTop', 'depth', 'notch', 'waistCy', 'waistR'],
      // T84 item 3: the frame-only archedFunnel/tulip presets' own models -- every feature a plain hw/hh-linear
      // inch value straight from the construction (fb_engine/frame_shape_fit.py's own _arched_funnel/_tulip),
      // no base template either, like T6's tab top.
      archedFunnel: ['archRiseFrac', 'bulgeFrac', 'topWidth', 'waistHeightFrac', 'waistWidthFrac'],
      tulip: ['archRiseFrac', 'bulgeFrac', 'topWidth', 'upperCurveFrac', 'waistHeightFrac', 'waistWidthFrac'],
      // T84 item 5: the frame-only sandTimer preset's own model -- same plain hw/hh-linear
      // convention (fb_engine/frame_shape_fit.py's own _sand_timer), no base template either.
      sandTimer: ['bulgeFrac', 'pinchHeightFrac', 'pinchReachFrac', 'topWidth'],
      // F31 item 2b: the frame-only flask preset's own model -- same plain hw/hh-linear convention
      // (fb_engine/frame_shape_fit.py's own _flask), no base template either.
      flask: ['domeFullnessFrac', 'neckHeightFrac', 'topWidth'] };
    // T3 TAPERED HOURGLASS: a narrow-top hourglass model also carries topInset (and, once fitted from its own
    // goldens, the two corners separately) -- the only extras paramsFromShapeModel reads.
    // T4 OFFSET HOURGLASS: an offset-waist model also carries the left pinch (waistCyLeft, notchLeft, depthLeft).
    // T5 HOURGLASS DIPPED TOP: a dipped-top model also carries the top dip (topDipDepth, topDipHalfWidth).
    // T10 ARCHED HOURGLASS: an arched-top model also carries the arch's own rise (archRise).
    // T8 DIPPED TOP + LEFT-ONLY WAVE: H23 item 11 -- fitted (not provisional) from its own live goldens, the
    // dippedLeftWave model also carries the wave's own corner radius, notch and arc radius (waveCornerR,
    // waveNotch, waveR), measured the same way Template 1's own cornerR/notch/waistR are, not declared by
    // the provisional shim.
    // F30 item 3 (Template 12/13, the taper copies): every base feature kept, plus one new scale-invariant
    // `taperAngle` -- the only extra either preset's own provisional model carries for these two.
    const EXTRA = { hourglass: ['cornerRBottom', 'cornerRTop', 'topInset', 'depthLeft', 'notchLeft', 'waistCyLeft', 'topDipDepth', 'topDipHalfWidth', 'archRise', 'taperAngle'], bottle: ['taperAngle'], tabTop: [], dippedLeftWave: ['waveCornerR', 'waveNotch', 'waveR'], iShape: [], diamondTopHourglass: [], diamondTopHourglassPinch: [], archedFunnel: [], tulip: [], sandTimer: [], flask: [] };
    const keys = Object.keys(t.shapeModel.features);
    expect(keys.filter((k) => FEATURES[t.silhouettePreset].includes(k)).sort()).toEqual(FEATURES[t.silhouettePreset]);
    expect(keys.filter((k) => !FEATURES[t.silhouettePreset].includes(k)).every((k) => EXTRA[t.silhouettePreset].includes(k))).toBe(true);
    if (!['template_3', 'template_4', 'template_5', 'template_8', 'template_10', 'template_12', 'template_13'].includes(t.id)) expect(keys.sort()).toEqual(FEATURES[t.silhouettePreset]); // Template 1 / 2: exactly as before
    // T6: a provisional model of its own (no base template, frame_shape_fit.provisional_tab_top_model) is fitted
    // from nothing yet; every other model (T3-T5's provisional ones carry Template 1's fit) from 2+ goldens.
    if (t.shapeModel.provisional && t.shapeModel.provisional.baseModel === null) expect(t.shapeModel.fit.fittedFrom).toEqual([]);
    else expect(t.shapeModel.fit.fittedFrom.length).toBeGreaterThanOrEqual(2);
    for (const p of t.params) {
      expect(p).toHaveProperty('unit');
      expect(p).toHaveProperty('default');
      expect(['board', 'frame']).toContain(p.owner);
    }
    for (const name of ['frame_thickness', 'boundingboxoffset']) expect(t.params.map((p) => p.name)).toContain(name);
  });

  it('the JS module and the JSON are the same render', () => {
    const json = JSON.parse(readFileSync('bspline-frame-builder/b-spline-gen/html/data/frame-defs.json', 'utf-8'));
    expect(FRAME_DEFS).toEqual(json);
  });
});
