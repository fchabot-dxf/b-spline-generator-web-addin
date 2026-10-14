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

describe('Family 4 & 5 Brick Frame Adaptation', () => {
  describe('Family 4: Stepped & Tabbed Profiles (T6, T9)', () => {
    const family4Templates = ['template_6', 'template_9'];

    it('classifies T6 and T9 into Family 4 with stepped/reflex segment types', () => {
      for (const tid of family4Templates) {
        const fam = familyForTemplate(tid);
        expect(fam, `Template ${tid} should belong to Family 4`).not.toBeNull();
        expect(fam.id).toBe('family_4_stepped_tabs');
        expect(fam.segmentTypes.top).toBe('stepped_tab');
        expect(fam.segmentTypes.corners).toBe('stepped_90_and_reflex');
      }
    });

    it('includes stepped_fret and excludes arch_keystone and quoin_corners', () => {
      for (const tid of family4Templates) {
        expect(isPresetConforming(tid, 'stepped_fret')).toBe(true);
        expect(isPresetConforming(tid, 'crenellated_battlement')).toBe(true);
        expect(isPresetConforming(tid, 'art_deco_stepped')).toBe(true);
        expect(isPresetConforming(tid, 'single_soldier')).toBe(true);
        expect(isPresetConforming(tid, 'soldier_stretcher')).toBe(true);
        expect(isPresetConforming(tid, 'arch_keystone')).toBe(false);
        expect(isPresetConforming(tid, 'quoin_corners')).toBe(false);
        expect(isPresetConforming(tid, 'butt_frame')).toBe(false);
      }
    });

    it('engine: generates clean brick bands for Family 4 templates with conforming presets (0 out of bounds)', () => {
      const set = brickSetById(1);
      const region = { x: 0.25, y: 0.25, w: 6.5, h: 8.5 };
      const fam = WOOD_FRAME_FAMILIES.family_4_stepped_tabs;

      for (const tid of family4Templates) {
        const tDef = fdefs.templates.find((t) => t.id === tid);
        const sil = generateSilhouette(region, { preset: tDef.silhouettePreset, params: tDef.shapeModel?.params || {} });
        const prims = buildRibbonPrimitives(sil.primitives);

        for (const pid of fam.conformingPresetIds) {
          if (pid === 'none') continue;
          const bands = FRAME_PRESETS[pid];
          const res = bricksContourBands(prims, bands, { set, seed: 1 });
          expect(res.bricks.length, `${tid} + ${pid} should generate bricks`).toBeGreaterThan(0);

          for (const b of res.bricks) {
            expect(b.polygon.length, `Brick polygon on ${tid} + ${pid} must have >= 3 vertices`).toBeGreaterThanOrEqual(3);
            for (const pt of b.polygon) {
              expect(pt.x, `${tid} + ${pid} brick x out of bounds`).toBeGreaterThanOrEqual(-0.02);
              expect(pt.x, `${tid} + ${pid} brick x out of bounds`).toBeLessThanOrEqual(7.02);
              expect(pt.y, `${tid} + ${pid} brick y out of bounds`).toBeGreaterThanOrEqual(-0.02);
              expect(pt.y, `${tid} + ${pid} brick y out of bounds`).toBeLessThanOrEqual(9.02);
            }
          }
        }
      }
    });
  });

  describe('Family 5: Shouldered Neck & Flared Profiles (T15, T17)', () => {
    const family5Templates = ['template_15', 'template_17'];

    it('classifies T15 and T17 into Family 5 with shouldered neck/flared segment types', () => {
      for (const tid of family5Templates) {
        const fam = familyForTemplate(tid);
        expect(fam, `Template ${tid} should belong to Family 5`).not.toBeNull();
        expect(fam.id).toBe('family_5_shouldered_flared');
        expect(fam.segmentTypes.top).toBe('neck_or_flared_lip');
        expect(fam.segmentTypes.corners).toBe('curved_shoulders_and_square_base');
      }
    });

    it('includes conforming presets and excludes arch_keystone, quoin_corners, and butt_frame', () => {
      for (const tid of family5Templates) {
        expect(isPresetConforming(tid, 'single_soldier')).toBe(true);
        expect(isPresetConforming(tid, 'soldier_stretcher')).toBe(true);
        expect(isPresetConforming(tid, 'corbelled_cornice')).toBe(true);
        expect(isPresetConforming(tid, 'florentine_architrave')).toBe(true);
        expect(isPresetConforming(tid, 'venetian_dentil')).toBe(true);
        expect(isPresetConforming(tid, 'arch_keystone')).toBe(false);
        expect(isPresetConforming(tid, 'quoin_corners')).toBe(false);
        expect(isPresetConforming(tid, 'butt_frame')).toBe(false);
      }
    });

    it('engine: generates clean brick bands for Family 5 templates with conforming presets (0 out of bounds)', () => {
      const set = brickSetById(1);
      const region = { x: 0.25, y: 0.25, w: 6.5, h: 8.5 };
      const fam = WOOD_FRAME_FAMILIES.family_5_shouldered_flared;

      for (const tid of family5Templates) {
        const tDef = fdefs.templates.find((t) => t.id === tid);
        const sil = generateSilhouette(region, { preset: tDef.silhouettePreset, params: tDef.shapeModel?.params || {} });
        const prims = buildRibbonPrimitives(sil.primitives);

        for (const pid of fam.conformingPresetIds) {
          if (pid === 'none') continue;
          const bands = FRAME_PRESETS[pid];
          const res = bricksContourBands(prims, bands, { set, seed: 1 });
          expect(res.bricks.length, `${tid} + ${pid} should generate bricks`).toBeGreaterThan(0);

          for (const b of res.bricks) {
            expect(b.polygon.length, `Brick polygon on ${tid} + ${pid} must have >= 3 vertices`).toBeGreaterThanOrEqual(3);
            for (const pt of b.polygon) {
              expect(pt.x, `${tid} + ${pid} brick x out of bounds`).toBeGreaterThanOrEqual(-0.02);
              expect(pt.x, `${tid} + ${pid} brick x out of bounds`).toBeLessThanOrEqual(7.02);
              expect(pt.y, `${tid} + ${pid} brick y out of bounds`).toBeGreaterThanOrEqual(-0.02);
              expect(pt.y, `${tid} + ${pid} brick y out of bounds`).toBeLessThanOrEqual(9.02);
            }
          }
        }
      }
    });
  });
});
