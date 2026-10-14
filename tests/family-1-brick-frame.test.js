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

describe('Family 1 Brick Frame Adaptation (Straight Top/Bottom & Hourglass / Neck Sides)', () => {
  const family1Templates = ['template_1', 'template_2', 'template_3', 'template_4', 'template_12', 'template_13'];

  it('classifies all 6 templates into Family 1 with declared segment types', () => {
    for (const tid of family1Templates) {
      const fam = familyForTemplate(tid);
      expect(fam, `Template ${tid} should belong to Family 1`).not.toBeNull();
      expect(fam.id).toBe('family_1_hourglass_neck');
      expect(fam.segmentTypes.top).toBe('straight');
      expect(fam.segmentTypes.bottom).toBe('straight');
      expect(fam.segmentTypes.corners).toBe('square_90');
      expect(fam.segmentTypes.sides).toBe('hourglass_or_neck');
    }
  });

  it('correctly filters conforming presets vs non-conforming presets for Family 1', () => {
    const conforming = ['single_soldier', 'soldier_stretcher', 'three_band', 'quoin_corners', 'butt_frame', 'double_soldier'];
    const nonConforming = ['arch_keystone', 'stepped_fret'];

    for (const tid of family1Templates) {
      for (const p of conforming) {
        expect(isPresetConforming(tid, p), `${p} should conform to ${tid}`).toBe(true);
      }
      for (const p of nonConforming) {
        expect(isPresetConforming(tid, p), `${p} should NOT conform to ${tid}`).toBe(false);
      }
    }
  });

  it('framePresetsForTemplate filters out arch_keystone for Family 1', () => {
    const mockList = [
      { id: 'single_soldier', label: 'Single Soldier' },
      { id: 'soldier_stretcher', label: 'Soldier + Stretcher' },
      { id: 'arch_keystone', label: 'Arch + Keystone' },
      { id: 'quoin_corners', label: 'Quoined Frame' },
    ];

    const filtered = framePresetsForTemplate('template_1', mockList);
    const ids = filtered.map((x) => x.id);
    expect(ids).toContain('single_soldier');
    expect(ids).toContain('soldier_stretcher');
    expect(ids).toContain('quoin_corners');
    expect(ids).not.toContain('arch_keystone');
  });

  it('engine: generates clean brick bands for all Family 1 templates with conforming presets (0 out of bounds)', () => {
    const set = brickSetById(1);
    const region = { x: 0.25, y: 0.25, w: 6.5, h: 8.5 };
    const fam = WOOD_FRAME_FAMILIES.family_1_hourglass_neck;

    for (const tid of family1Templates) {
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
          }
        }
      }
    }
  });

  it('engine: quoin_corners places exactly 4 quoin blocks at the 4 square corners on every Family 1 template', () => {
    const set = brickSetById(1);
    const region = { x: 0.25, y: 0.25, w: 6.5, h: 8.5 };

    for (const tid of family1Templates) {
      const tDef = fdefs.templates.find((t) => t.id === tid);
      const sil = generateSilhouette(region, { preset: tDef.silhouettePreset, params: tDef.shapeModel?.params || {} });
      const prims = buildRibbonPrimitives(sil.primitives);
      const res = bricksContourBands(prims, FRAME_PRESETS.quoin_corners, { set, seed: 1 });
      expect(res.quoins?.length, `${tid} should have exactly 4 quoins`).toBe(4);
    }
  });
});
