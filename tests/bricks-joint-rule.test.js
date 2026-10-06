/**
 * T86 item 21b, the JOINT RULE (advisor + Fred, 2026-10-06): every seam between two band pieces is the declared grout
 * joint -- rows and bands stop half a joint short of each other and of the wall, mitres / notches / fan corners are
 * joints, voussoir and fan joints are constant-width strips, and the row planner never flexes a joint (the run's slack
 * goes into its end closer). WHY: a 0-gap seam becomes a zero-area sliver profile in the Fusion Bricks sketch (seat A's
 * e2e: 147 profiles for 126 pieces), and two abutting courses read as one slab in 3D. MEASURED on neck-medial before:
 * 1,504 joints exactly 0 wide over 456 lays (8 presets x 19 templates x 3 sizes).
 * The seam floor is the joint less ARC_SAG_IN: an arc is drawn as chords (arc-voussoir MAX_SEGMENT_ANGLE), which sit up
 * to ~0.004 in inside the true curve -- MEASURED narrowest seam on the sweep: 0.0303 in, always on an arc.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, BRUSH_PRESETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0], JOINT = SET.grout.widthIn, ARC_SAG_IN = 0.004;
const box = (p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
function polyDistance(A, B) {
  let best = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) for (const p of P) for (let k = 0; k < Q.length; k++) {
    const u = Q[k], v = Q[(k + 1) % Q.length], dx = v.x - u.x, dy = v.y - u.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - u.x) * dx + (p.y - u.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - u.x - t * dx, p.y - u.y - t * dy));
  }
  return best;
}
/** the narrowest seam between any two band pieces (0 when two overlap), and where */
function narrowestSeam(bricks) {
  const bx = bricks.map((b) => box(b.polygon));
  let worst = { d: Infinity };
  for (let i = 0; i < bricks.length; i++) for (let j = i + 1; j < bricks.length; j++) {
    const a = bx[i], b = bx[j];
    if (a[1] + JOINT < b[0] || b[1] + JOINT < a[0] || a[3] + JOINT < b[2] || b[3] + JOINT < a[2]) continue;
    const inter = polygonIntersection(bricks[i].polygon, bricks[j].polygon);
    const d = inter.length >= 3 && Math.abs(signedArea(inter)) > 1e-9 ? 0 : polyDistance(bricks[i].polygon, bricks[j].polygon);
    if (d < worst.d) worst = { d, a: bricks[i].id, b: bricks[j].id };
  }
  return worst;
}

describe('the joint rule: every seam between band pieces is the declared joint (T86 item 21b)', () => {
  const TEMPLATES = ['template_1', 'template_5', 'template_8', 'template_11', 'template_14', 'template_18'];
  const PRESETS = ['single_soldier', 'three_band', 'double_course', 'mixed_bands', 'quoin_corners'];
  for (const id of TEMPLATES) {
    it(`${id}: every preset at 1 and 1.25 in -- no seam under the joint (less the arc chord sag)`, () => {
      const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: id }), board: { widthIn: 7, heightIn: 9 } }, 0, 0);
      const prims = buildRibbonPrimitives(sil.primitives);
      const bad = [];
      for (const preset of PRESETS) for (const L of [1, 1.25]) {
        const { bricks } = bricksContourBands(prims, FRAME_PRESETS[preset], { set: SET, seed: 1, scale: L / SET.brickLengthIn });
        const w = narrowestSeam(bricks);
        if (w.d < JOINT - ARC_SAG_IN) bad.push(`${preset} ${L}: ${w.a} / ${w.b} ${w.d.toFixed(4)} in`);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe("the joint rule on a Brush stroke (seat E's measurement: bricks butting along the run, ends overhanging 0.02 in)", () => {
  it('an open two-segment stroke: every seam a joint, no brick past either end of the stroke', () => {
    const pts = [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 6.5, y: 3.5 }];
    const prims = pts.slice(0, -1).map((p, i) => ({ type: 'line', p0: p, p1: pts[i + 1] }));
    for (const preset of ['stretcher_1', ...Object.keys(BRUSH_PRESETS).filter((k) => k !== 'stretcher_1')]) {
      const { bricks } = bricksContourBands(prims, BRUSH_PRESETS[preset], { set: SET, seed: 1, closed: false, centered: true });
      expect(narrowestSeam(bricks).d, preset).toBeGreaterThanOrEqual(JOINT - ARC_SAG_IN);
      // the start end is the line x = 1 (the first segment runs along +x): nothing past it
      expect(Math.min(...bricks.flatMap((b) => b.polygon.map((p) => p.x))), preset).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });
});
