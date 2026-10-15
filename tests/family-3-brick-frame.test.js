import { describe, it, expect } from 'vitest';
import {
  WOOD_FRAME_FAMILIES,
  familyForTemplate,
  isPresetConforming,
  framePresetsForTemplate,
} from '../bspline-frame-builder/b-spline-gen/html/core/bricks/frame-families.js';
import {
  FRAME_PRESETS,
  brickSetById,
} from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { generateSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import fdefs from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.json';

function buildRibbonPrimitives(primitives) {
  const list = primitives || [];
  const n = list.length;
  return list.map((prim, i) => {
    if (prim.type === 'A') {
      return { type: 'arc', cx: prim.cx, cy: prim.cy, r: prim.rx, theta1: prim.theta1, theta2: prim.theta1 + prim.dTheta };
    }
    const next = list[(i + 1) % n];
    const p1 = next.type === 'A'
      ? { x: next.cx + next.rx * Math.cos(next.theta1), y: next.cy + next.ry * Math.sin(next.theta1) }
      : next.p0;
    return { type: 'line', p0: prim.p0, p1 };
  });
}

describe('Family 3 Brick Frame Adaptation (Pointed & Dipped Gables)', () => {
  const family3Templates = ['template_5', 'template_7', 'template_8', 'template_11', 'template_14'];

  it('classifies all 5 templates into Family 3 with declared gable segment types', () => {
    for (const tid of family3Templates) {
      const fam = familyForTemplate(tid);
      expect(fam, `Template ${tid} should belong to Family 3`).not.toBeNull();
      expect(fam.id).toBe('family_3_gables');
      expect(fam.segmentTypes.top).toBe('peaked_or_dipped');
      expect(fam.segmentTypes.bottom).toBe('straight_or_inverted_peak');
      expect(fam.segmentTypes.corners).toBe('ridge_apex_and_eaves');
    }
  });

  it('correctly filters conforming presets vs non-conforming / clashing presets', () => {
    const conforming = [
      'single_soldier',
      'soldier_stretcher',
      'three_band',
      'double_soldier',
      'header_band',
      'mixed_bands',
      'craftsman_apron',
      'corbelled_cornice',
      'zigzag_band',
    ];
    const nonConforming = [
      'arch_keystone',
      'butt_frame',
      'stepped_fret',
      'quoin_corners',
      'double_course',
      'flemish_architrave',
    ];

    for (const tid of family3Templates) {
      for (const p of conforming) {
        expect(isPresetConforming(tid, p), `${p} should conform to ${tid}`).toBe(true);
      }
      for (const p of nonConforming) {
        expect(isPresetConforming(tid, p), `${p} should NOT conform to ${tid}`).toBe(false);
      }
    }
  });

  it('framePresetsForTemplate lists Family 3 presets first, the clashing ones after (never hidden)', () => {
    const mockList = [
      { id: 'single_soldier', label: 'Single Soldier' },
      { id: 'soldier_stretcher', label: 'Soldier + Stretcher' },
      { id: 'three_band', label: 'Three Band' },
      { id: 'arch_keystone', label: 'Arch + Keystone' },
      { id: 'butt_frame', label: 'Butt Frame' },
      { id: 'quoin_corners', label: 'Quoined Frame' },
      { id: 'flemish_architrave', label: 'Flemish architrave' },
      { id: 'double_course', label: 'Double course' },
      { id: 'stepped_fret', label: 'Stepped fret' },
    ];

    const filtered = framePresetsForTemplate('template_7', mockList);
    const ids = filtered.map((x) => x.id);
    // Fred 2026-10-14 ("suggest, don't hide"): EVERY preset stays pickable -- the family's first, marked, the rest after
    expect([...ids].sort()).toEqual(mockList.map((x) => x.id).sort());
    const fit = ["single_soldier","soldier_stretcher","three_band"], other = ["arch_keystone","butt_frame","quoin_corners","flemish_architrave","double_course","stepped_fret"];
    for (const id of fit) expect(filtered.find((x) => x.id === id).fits, id).toBe(true);
    for (const id of other) expect(filtered.find((x) => x.id === id).fits, id).toBe(false);
    expect(Math.max(...fit.map((id) => ids.indexOf(id)))).toBeLessThan(Math.min(...other.map((id) => ids.indexOf(id))));
  });

  it('engine: generates clean brick bands for all Family 3 templates with conforming presets (0 out of bounds)', () => {
    const set = brickSetById(1);
    const region = { x: 0.25, y: 0.25, w: 6.5, h: 8.5 };
    const fam = WOOD_FRAME_FAMILIES.family_3_gables;

    for (const tid of family3Templates) {
      const tDef = fdefs.templates.find((t) => t.id === tid);
      const sil = generateSilhouette(region, { preset: tDef.silhouettePreset, params: tDef.shapeModel?.params || {} });
      const prims = buildRibbonPrimitives(sil.primitives);

      for (const pid of fam.conformingPresetIds) {
        if (pid === 'none') continue;

        const bands = FRAME_PRESETS[pid];
        const res = bricksContourBands(prims, bands, { set, seed: 1 });
        expect(res.bricks.length, `${tid} + ${pid} should generate bricks`).toBeGreaterThan(0);

        for (const b of res.bricks) {
          expect(b.polygon.length, `Brick polygon on ${tid} + ${pid} must have at least 3 vertices`).toBeGreaterThanOrEqual(3);
          for (const pt of b.polygon) {
            expect(pt.x, `${tid} + ${pid} brick x out of board bounds`).toBeGreaterThanOrEqual(-0.02);
            expect(pt.x, `${tid} + ${pid} brick x out of board bounds`).toBeLessThanOrEqual(7.02);
            expect(pt.y, `${tid} + ${pid} brick y out of board bounds`).toBeGreaterThanOrEqual(-0.02);
            expect(pt.y, `${tid} + ${pid} brick y out of board bounds`).toBeLessThanOrEqual(9.02);
            expect(Number.isFinite(pt.x), `Vertex x must be finite on ${tid} + ${pid}`).toBe(true);
            expect(Number.isFinite(pt.y), `Vertex y must be finite on ${tid} + ${pid}`).toBe(true);
          }
        }
      }
    }
  }, 90000); // every conforming preset on every template: 18 s alone with the six short-brick bands (2026-10-14), 30 s+ under a parallel run
});
