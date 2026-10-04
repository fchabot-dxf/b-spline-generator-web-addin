/**
 * T86 item 16 (advisor dispatch, Fred: "bigger bricks break the engine" -- advisor contact sheet
 * shots/advisor/brick_size_compare.png, Stretcher wall + Soldier band, 7x9). Four sub-issues were
 * reported; this file covers (a), the one confirmed root-caused and fixed this pass:
 *
 * (a) CRASH -- FIXED. T9 at brickLengthIn 1/1.25/1.5 (and reported, T18 at 1.25) threw `TypeError:
 *     Cannot read properties of null (reading 'x')` at core/bricks/layouts/bond.js:141. Root cause:
 *     `primitive-ribbon.js`'s own `boundaryAtDepth` pushed `jointPointAt`'s own result straight into
 *     the returned boundary with no null-check (every OTHER joint-consuming call site in that file
 *     already defensively checks for a failed joint; this one didn't) -- `jointPointAt`'s own
 *     `curveIntersection` can genuinely fail to find a crossing once a frame band is deep enough that
 *     two neighbouring primitives' own offset-at-depth curves no longer meet near the true original
 *     junction (MEASURED: happens once the band depth exceeds roughly half the local gap, at a
 *     narrow waist/neck -- exactly what asking for a BIGGER brick does, since brickLengthIn also
 *     sets the Soldier band's own depth here). Fixed with a LOCAL fallback (not dropping real
 *     geometry): when the true mitred joint can't be found, that one corner uses its own simple
 *     (non-mitred) offset endpoint instead. A first attempt (dropping both primitives flanking the
 *     failed joint and rebuilding, mirroring fieldstone.js's own "never drop a cell" fix) was tried
 *     and reverted: MEASURED on the real repro, it cascades -- removing two primitives routinely
 *     exposes a NEW failing joint between their own former neighbours, and so on until the whole
 *     band's own boundary empties out, which is a worse outcome than the crash it replaces.
 *
 * (b) GAPS at 1.25/1.5in on T1/T12 (wall doesn't reach the band's own inner edge), (c) T18 neck
 * band collision at 1in, (d) one missing T1 brick near the top-right at 0.75/1in -- NOT covered
 * here. Measured directly before deciding scope: with (a)'s fix, all 16 (template x size) combos in
 * the advisor's own declared sweep run with ZERO crashes and ZERO cell-pair overlap (bondLayout's
 * own rectangular grid has no overlap mechanism to begin with; the crash was the real risk). A
 * neighbour-gap sweep was also tried, but came back noisy in a way that isn't trustworthy yet: T1/T12
 * show gaps of 0.22-0.31in even at 0.75in brickLengthIn (never reported as a problem at that size),
 * which looks like `bondLayout`'s own `findOverlap` (nearest-by-x-distance) occasionally pairing two
 * cells across a genuine board-outline notch rather than a true "wall doesn't reach the band" defect
 * -- not disentangled from the real (b)/(c)/(d) issues in the time available, so not asserted here
 * rather than ship an unreliable check. T18 also produced 0 cells at EVERY size tried (7x9, single
 * Soldier band) rather than the advisor's own specific "collides at 1in" symptom, suggesting this
 * file's own board/preset choice doesn't match the advisor's exact repro conditions for T18 -- flagged
 * honestly rather than claimed as covered.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { signedArea, polygonIntersection } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
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
function bbox(poly) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

const TEMPLATES = ['template_1', 'template_9', 'template_12', 'template_18'];
const SIZES_IN = [0.75, 1, 1.25, 1.5]; // the advisor's own declared sweep

describe('Wall + Soldier band, big-brick robustness (T86 item 16(a) regression)', () => {
  for (const templateId of TEMPLATES) {
    it(`${templateId}: never throws, and produces no pairwise cell overlap, across brickLengthIn 0.75-1.5`, () => {
      const notes = [];
      for (const size of SIZES_IN) {
        const SET = { ...BRICK_SETS[0], brickLengthIn: size };
        let cells;
        try {
          const { primitives } = realContour(templateId, 7, 9);
          const { innerPath } = bricksContourBands(primitives, FRAME_PRESETS.single_soldier, { set: SET, seed: 1 });
          cells = bondLayout(innerPath, SET, [{ pattern: 'stretcher' }]).cells;
        } catch (e) {
          notes.push(`brickLengthIn=${size}: THREW ${e.message}`);
          continue;
        }
        if (!cells.length) continue; // a genuinely infeasible combo (e.g. T18 here) -- not a throw, nothing to check further
        const boxes = cells.map((c) => bbox(c.polygon));
        for (let i = 0; i < cells.length; i++) {
          for (let j = i + 1; j < cells.length; j++) {
            const A = boxes[i], B = boxes[j];
            if (A.maxX < B.minX - 1e-6 || B.maxX < A.minX - 1e-6 || A.maxY < B.minY - 1e-6 || B.maxY < A.minY - 1e-6) continue;
            const inter = polygonIntersection(cells[i].polygon, cells[j].polygon);
            if (inter.length < 3) continue;
            const overlapArea = Math.abs(signedArea(inter));
            if (overlapArea > 1e-6) {
              notes.push(`brickLengthIn=${size}: cells ${cells[i].id}/${cells[j].id} overlap by ${overlapArea.toFixed(5)} sq in`);
            }
          }
        }
      }
      expect(notes, notes.join('\n')).toEqual([]);
    });
  }
});
