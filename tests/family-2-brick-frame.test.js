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
import { layArch, ARCH_SPECS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/arch-surround.js';
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

describe('Family 2 Brick Frame Adaptation (Arched Head & Vaulted Frames)', () => {
  const family2Templates = ['template_10', 'template_16', 'template_18', 'template_19'];

  it('classifies all 4 templates into Family 2 with declared arched segment types', () => {
    for (const tid of family2Templates) {
      const fam = familyForTemplate(tid);
      expect(fam, `Template ${tid} should belong to Family 2`).not.toBeNull();
      expect(fam.id).toBe('family_2_arched');
      expect(fam.segmentTypes.top).toBe('arched');
      expect(fam.segmentTypes.bottom).toBe('straight');
      expect(fam.segmentTypes.corners).toBe('arch_shoulders_and_square_base');
    }
  });

  it('correctly filters conforming presets (including arch_keystone, quoin_corners) vs non-conforming presets', () => {
    const conforming = ['arch_keystone', 'quoin_corners', 'single_soldier', 'soldier_stretcher', 'three_band', 'corbelled_cornice', 'double_soldier'];
    const nonConforming = ['butt_frame', 'stepped_fret', 'flemish_architrave', 'double_course'];

    for (const tid of family2Templates) {
      for (const p of conforming) {
        expect(isPresetConforming(tid, p), `${p} should conform to ${tid}`).toBe(true);
      }
      for (const p of nonConforming) {
        expect(isPresetConforming(tid, p), `${p} should NOT conform to ${tid}`).toBe(false);
      }
    }
  });

  it('framePresetsForTemplate includes arch_keystone, quoin_corners and excludes pruned/clashing presets for Family 2', () => {
    const mockList = [
      { id: 'single_soldier', label: 'Single Soldier' },
      { id: 'soldier_stretcher', label: 'Soldier + Stretcher' },
      { id: 'arch_keystone', label: 'Arch + Keystone' },
      { id: 'butt_frame', label: 'Butt Frame' },
      { id: 'quoin_corners', label: 'Quoined Frame' },
      { id: 'flemish_architrave', label: 'Flemish architrave' },
      { id: 'double_course', label: 'Double course' },
    ];

    const filtered = framePresetsForTemplate('template_10', mockList);
    const ids = filtered.map((x) => x.id);
    expect(ids).toContain('arch_keystone');
    expect(ids).toContain('quoin_corners');
    expect(ids).toContain('single_soldier');
    expect(ids).toContain('soldier_stretcher');
    expect(ids).not.toContain('butt_frame');
    expect(ids).not.toContain('flemish_architrave');
    expect(ids).not.toContain('double_course');
  });

  it('engine: generates clean brick bands for all Family 2 templates with conforming presets (0 out of bounds)', () => {
    const set = brickSetById(1);
    const region = { x: 0.25, y: 0.25, w: 6.5, h: 8.5 };
    const fam = WOOD_FRAME_FAMILIES.family_2_arched;

    for (const tid of family2Templates) {
      const tDef = fdefs.templates.find((t) => t.id === tid);
      const sil = generateSilhouette(region, { preset: tDef.silhouettePreset, params: tDef.shapeModel?.params || {} });
      const prims = buildRibbonPrimitives(sil.primitives);

      for (const pid of fam.conformingPresetIds) {
        if (pid === 'none') continue;

        if (pid === 'arch_keystone' || pid === 'quoin_corners') {
          const spec = pid === 'arch_keystone' ? ARCH_SPECS.rowlock_keystone : ARCH_SPECS.soldier_quoin;
          const res = layArch(spec, prims, [], { set, seed: 1 });
          expect(res.pieces?.length, `${tid} + ${pid} should generate pieces`).toBeGreaterThan(0);
          
          if (pid === 'quoin_corners') {
            const stones = res.pieces.filter((p) => p.setId === 6);
            expect(stones.length, `${tid} + quoin_corners must have 5 accent stones (2 base + 2 springers + 1 keystone)`).toBe(5);
          }

          for (const p of res.pieces) {
            expect(p.polygon.length, `Arch piece polygon on ${tid} must have at least 3 vertices`).toBeGreaterThanOrEqual(3);
            for (const pt of p.polygon) {
              expect(pt.x, `${tid} + ${pid} piece x out of bounds`).toBeGreaterThanOrEqual(-0.02);
              expect(pt.x, `${tid} + ${pid} piece x out of bounds`).toBeLessThanOrEqual(7.02);
              expect(pt.y, `${tid} + ${pid} piece y out of bounds`).toBeGreaterThanOrEqual(-0.02);
              expect(pt.y, `${tid} + ${pid} piece y out of bounds`).toBeLessThanOrEqual(9.02);
            }
          }
        } else {
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
    }
  });
});
