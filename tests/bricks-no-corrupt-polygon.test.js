/**
 * Regression test for a real, reproduced bug (seat 37/F35 item 18 turn 177, advisor dispatch): on
 * template_1 7x9 at brickLengthIn=1.5, one Wall brick's own clipped polygon came back as a 39-point,
 * 13.97 sq in shape (nearly the WHOLE board interior) instead of a small clipped brick -- it silently
 * swallowed every interior brick behind it (invisible in Organic 3D mode, obvious as one giant flat
 * plane in Flat mode, but the underlying 2D CELL corruption is the same either way, upstream of both
 * render modes).
 *
 * ROOT CAUSE (bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js, `polygonIntersection`,
 * the Greiner-Hormann concave board clip EVERY layout here shares): a near-tangent crossing pair (a
 * brick edge grazing a board-outline feature, two crossings only ~0.0014in apart) put the trace's own
 * "entry" and "exit" nodes immediately adjacent on the brick's own vertex list, with nothing of the
 * brick's own perimeter between them. The walk rule (jump to the OTHER polygon's list at any
 * crossing) then has no choice but to continue on the BOARD's own list -- and if the board's own
 * forward vertex order doesn't loop back to the matching twin quickly, it must walk almost the
 * board's ENTIRE remaining perimeter before the loop closes. This is a RECURRING failure class of the
 * forward-walk rule on near-tangent inputs (the function's own header already documented an earlier,
 * structurally identical incident -- "a 44-vertex result that was almost literally the whole board
 * outline" -- found and partially addressed before this one). FIXED with a general, PROVABLE
 * invariant rather than chasing every possible near-tangent configuration: `subject & clip`'s own
 * area can never exceed `subject`'s own area -- `polygonIntersection` now validates its own result
 * against this and returns empty (which every caller here already treats as "fully clipped away",
 * not a crash) rather than ship a result physics rules out.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bondLayout } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/layouts/bond.js';

function realContour(templateId, widthIn, heightIn) {
  const record = normalizeFrameRecord({ templateId });
  const frame = { defs: FRAME_DEFS, record, board: { widthIn, heightIn } };
  const sil = frameContourSilhouette(frame, 0, 0);
  const primitives = buildRibbonPrimitives(sil.primitives);
  return { primitives };
}

const TEMPLATE_IDS = Array.from({ length: 17 }, (_, i) => `template_${i + 1}`);
// the advisor's own declared sweep: a sub-grout-scale miniature, the set's own default, the exact
// repro size, a large decorative size, and a true life-size brick.
const BRICK_LENGTHS_IN = [0.375, 0.75, 1.5, 3, 8];

describe('bond Wall: no single piece larger than 1.2x a brick, on any template x declared size (T86/F35 item 18 turn 177 regression)', () => {
  for (const templateId of TEMPLATE_IDS) {
    it(`${templateId} 7x9`, () => {
      const { primitives } = realContour(templateId, 7, 9);
      const violations = [];
      for (const brickLengthIn of BRICK_LENGTHS_IN) {
        const SET = { ...BRICK_SETS[0], brickLengthIn };
        const { innerPath } = bricksContourBands(primitives, FRAME_PRESETS.single_soldier, { set: SET, seed: 1 });
        // a brick/band combo that leaves no real interior (band swallows the whole board at an
        // extreme size) returns a degenerate or null-containing innerPath -- nothing to check there.
        if (innerPath.length < 3 || !innerPath.every((p) => p)) continue;
        const { cells } = bondLayout(innerPath, SET, [{ pattern: 'stretcher' }]);
        const nominalArea = SET.brickLengthIn * SET.brickHeightIn;
        const maxAllowed = nominalArea * 1.2;
        for (const c of cells) {
          const area = Math.abs(signedArea(c.polygon));
          if (area > maxAllowed) {
            violations.push(`brickLengthIn=${brickLengthIn}: cell id=${c.id} course=${c.courseIndex} col=${c.colIndex} area=${area.toFixed(4)} (nominal=${nominalArea.toFixed(4)}, allowed<=${maxAllowed.toFixed(4)}) verts=${c.polygon.length}`);
          }
        }
      }
      expect(violations, violations.join('\n')).toEqual([]);
    });
  }
});
