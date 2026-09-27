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
    expect(FRAME_DEFS.appearance.options).toEqual([
      '3D Ash - Unfinished', '3D Mahogany - Unfinished', '3D Pine - Unfinished',
      '3D Cherry - Unfinished', '3D Maple - Unfinished',
    ]);
  });

  it('declares frame bottom as a Z position (negative, -1 in)', () => {
    const z = FRAME_DEFS.extrusion.find((s) => s.key === 'frameBottomZ');
    expect(z).toMatchObject({ param: 'frame_height_offset', default: -1, unit: 'in', ui: true });
  });

  it.each(FRAME_DEFS.templates.map((t) => [t.id, t]))('%s: preset, shape params and params are complete', (_id, t) => {
    expect(PRESETS[t.silhouettePreset]).toBeTruthy();
    // F8: the shape is a model fitted from the recorded Fusion goldens, with its fit report.
    const FEATURES = { hourglass: ['cornerR', 'depth', 'notch', 'waistCy', 'waistR'], bottle: ['bodyR', 'neckHalfW', 'neckR', 'neckTop'] };
    expect(Object.keys(t.shapeModel.features).sort()).toEqual(FEATURES[t.silhouettePreset]);
    expect(t.shapeModel.fit.fittedFrom.length).toBeGreaterThanOrEqual(2);
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
