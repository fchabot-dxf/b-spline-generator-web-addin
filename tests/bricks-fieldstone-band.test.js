/**
 * T86 item 20 (Fred: "a frame of fieldstone and a wall of soldier with dot raised"): fieldstone as
 * a band-capable pattern -- a fieldstone band fills the RING between its own outer and inner edges
 * with the same `fieldstoneLayout` Wall fill already uses (same tiers, same `largeStones` range),
 * via `contour-bands.js`'s own `ribbonSlitPolygon` ("keyhole" technique) + `bricksFillShape` reuse.
 * "Corners included, no mitres needed" -- a stone's own clip against the ring's real edges already
 * handles a corner correctly, no separate corner-piece machinery the rectangular bond patterns need.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // a heavy sweep: see heavy-test-timeout.js
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

function realContour(templateId, widthIn, heightIn) {
  const record = normalizeFrameRecord({ templateId });
  const frame = { defs: FRAME_DEFS, record, board: { widthIn, heightIn } };
  const sil = frameContourSilhouette(frame, 0, 0);
  return { primitives: buildRibbonPrimitives(sil.primitives) };
}
function totalOverlapArea(cells) {
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const inter = polygonIntersection(cells[i].polygon, cells[j].polygon);
      if (inter.length >= 3) total += Math.abs(signedArea(inter));
    }
  }
  return total;
}
// area of `poly` that falls OUTSIDE `boundary` -- poly's own area minus its exact intersection with
// boundary -- the rigorous check (not point-sampling, which can't tell "a vertex touches the ring's
// own true edge" (expected, correct) apart from "a vertex sits meaningfully past it" (a real bug)).
function areaOutside(poly, boundary) {
  const polyArea = Math.abs(signedArea(poly));
  const inter = polygonIntersection(poly, boundary);
  const interArea = inter.length >= 3 ? Math.abs(signedArea(inter)) : 0;
  return Math.max(0, polyArea - interArea);
}
function distToPolyline(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
  }
  return best;
}
function areaInside(poly, hole) {
  const inter = polygonIntersection(poly, hole);
  return inter.length >= 3 ? Math.abs(signedArea(inter)) : 0;
}

const SET_BASE = BRICK_SETS[0]; // Red brick -- grout/tier math is set-driven, Red brick exercises it directly

function ringContainmentCheck(templateId, widthIn) {
  const SET = { ...SET_BASE, brickLengthIn: 0.75 };
  const { primitives } = realContour(templateId, 7, 9);
  const outer = bricksContourBands(primitives, [], { set: SET, seed: 1 }).innerPath; // 0 bands -> depth 0 -> true outer contour
  const { bricks: cells, innerPath: inner } = bricksContourBands(primitives, [{ widthIn, pattern: 'fieldstone' }], { set: SET, seed: 1 });
  let worstOutside = 0, worstInside = 0;
  for (const c of cells) {
    worstOutside = Math.max(worstOutside, areaOutside(c.polygon, outer));
    worstInside = Math.max(worstInside, areaInside(c.polygon, inner));
  }
  const ringCoverage = (() => {
    const xs = outer.map((p) => p.x), ys = outer.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const GRID = 60;
    let total = 0, covered = 0;
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const x = minX + ((maxX - minX) * (i + 0.5)) / GRID, y = minY + ((maxY - minY) * (j + 0.5)) / GRID;
      if (!pointInPolygon(x, y, outer) || pointInPolygon(x, y, inner)) continue;
      // 21b joint rule: innerPath is where the WALL starts, one joint inside the band's own edge -- that strip is the
      // band-to-wall joint, not ring for stones to cover
      if (distToPolyline(x, y, inner) < SET.grout.widthIn) continue;
      total++;
      if (cells.some((c) => pointInPolygon(x, y, c.polygon))) covered++;
    }
    return total > 0 ? covered / total : 1;
  })();
  return { cells, overlap: totalOverlapArea(cells), worstOutside, worstInside, ringCoverage };
}

describe('fieldstone as a band pattern (T86 item 20)', () => {
  for (const widthIn of [0.75, 1]) {
    it(`template_1, band widthIn=${widthIn}: no overlap, every stone stays inside the ring, reasonable coverage`, () => {
      const r = ringContainmentCheck('template_1', widthIn);
      expect(r.cells.length).toBeGreaterThan(0);
      expect(r.overlap).toBeLessThan(1e-6);
      expect(r.worstOutside, 'worst area escaping the outer edge').toBeLessThan(1e-6);
      expect(r.worstInside, 'worst area intruding the inner hole').toBeLessThan(1e-6);
      expect(r.ringCoverage).toBeGreaterThanOrEqual(0.85);
    });
  }

  // T86 item 20, template_18: PRE-EXISTING, NOT caused by this item -- this is the SAME geometric
  // limitation item 16(c) already named ("T18 neck at 1in: bands from both sides collide (wedges
  // overlap); medial rule"), now hit by the fieldstone band path too since both read the SAME
  // `boundaryAtDepth`. CONFIRMED directly: `boundaryAtDepth(enriched, 0.75)` and `(enriched, 1)` on
  // template_18's own contour are BOTH self-intersecting (measured via a convexity/crossing scan,
  // not assumed) -- T18's own neck is simply too narrow for a fieldstone band this deep to produce a
  // SIMPLE ring at all, independent of how the ring gets filled. The resulting overlap is severe
  // (MEASURED up to ~7.8 sq in at widthIn=1, not a small cosmetic residual), so no honest threshold
  // exists here until 16(c) itself is fixed -- `it.todo` keeps the finding visible with the real
  // numbers rather than picking a number that would hide it or silently losing the coverage.
  // T86 item 16(c) (seat B): unblocked -- boundaryAtDepth now samples an arc only between its own two
  // joints, so T18's neck no longer self-intersects at these depths.
  for (const widthIn of [0.75, 1]) {
    it(`template_18, band widthIn=${widthIn}: no overlap, every stone stays inside the ring, reasonable coverage`, () => {
      const r = ringContainmentCheck('template_18', widthIn);
      expect(r.cells.length).toBeGreaterThan(0);
      expect(r.overlap).toBeLessThan(1e-6);
      expect(r.worstOutside, 'worst area escaping the outer edge').toBeLessThan(1e-6);
      expect(r.worstInside, 'worst area intruding the inner hole').toBeLessThan(1e-6);
      expect(r.ringCoverage).toBeGreaterThanOrEqual(0.85);
    });
  }

  // T86 item 20: a KNOWN, bounded residual at band TRANSITIONS (fieldstone's own ring boundary vs
  // the next band's own independently-built mitred corner pieces) -- the SAME class of "two
  // independently-constructed adjacent pieces don't perfectly coordinate at a corner" residual this
  // file's own git history already documents for course-to-course seams (see
  // bricks-real-template-contours.test.js's own overlap test). MEASURED: ALL 16 affected soldier
  // pieces (of 104) are corner/fillet pieces (3-6 vertices, not a plain 4-vertex rectangle) -- not a
  // pervasive defect, concentrated exactly where two independent corner constructions meet. 0.25 sq
  // in catches a real regression (the pre-measured value is 0.183) while not flagging this.
  it('mixes with a course band in one preset (fieldstone outer + soldier inner), no crash, overlap stays bounded (known corner-transition residual)', () => {
    const SET = { ...SET_BASE, brickLengthIn: 0.75 };
    // 9x12: the 1.53 in stack fits T1's narrowest gap there; on a 7x9 the fit rule (T86 item 28) drops the soldier
    const { primitives } = realContour('template_1', 9, 12);
    const { bricks: cells, innerPath } = bricksContourBands(
      primitives, [{ widthIn: 0.75, pattern: 'fieldstone' }, { widthIn: 0.75, pattern: 'soldier' }], { set: SET, seed: 1 },
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(innerPath.length).toBeGreaterThan(0);
    const fieldstoneCells = cells.filter((c) => c.bandIndex === 0);
    const soldierCells = cells.filter((c) => c.bandIndex === 1);
    expect(fieldstoneCells.length).toBeGreaterThan(0);
    expect(soldierCells.length).toBeGreaterThan(0);
    // within-band overlap stays the strict, real requirement (MEASURED 0 both ways) -- only the
    // CROSS-band transition gets the documented, bounded allowance.
    expect(totalOverlapArea(fieldstoneCells), 'within fieldstone band').toBeLessThan(1e-6);
    expect(totalOverlapArea(soldierCells), 'within soldier band').toBeLessThan(1e-6);
    expect(totalOverlapArea(cells), 'including the band-transition seam').toBeLessThan(0.25);
  });

  // T86 item 21 (the advisor's own amendment, from the mixed-preset shot: "a large EMPTY WEDGE at
  // the top-right corner... no stones, bare board"): the slit polygon's own bridge used to start at
  // `outer[0]` -- whatever point `boundaryAtDepth`'s own tessellation happens to begin at, often a
  // board corner -- and a corner's own sharp turn plus the slit's own degenerate double-edge there
  // measurably starved Poisson-disc's own candidate acceptance nearby (64.4% coverage in a focused
  // sample box around that corner, vs the ring's own >=85% elsewhere). Fixed by starting the bridge
  // at the LONGEST edge instead (reliably mid-straight-run, nowhere near a corner), with inner's own
  // bridge point found by nearest-WORLD-POSITION match rather than the same raw array index (outer/
  // inner tessellate independently -- MEASURED a real 102-vs-38-point mismatch that, naively
  // index-matched, misaligned the bridge enough to collapse total stone count by 40%).
  it('no large coverage gap concentrated at the ring\'s own bridge seam (a board corner, the default tessellation start)', () => {
    const SET = { ...SET_BASE, brickLengthIn: 0.75 };
    const { primitives } = realContour('template_1', 7, 9);
    const outer = bricksContourBands(primitives, [], { set: SET, seed: 1 }).innerPath;
    const { bricks: cells, innerPath: inner } = bricksContourBands(primitives, [{ widthIn: 0.75, pattern: 'fieldstone' }], { set: SET, seed: 1 });
    // the exact corner the pre-fix bridge started at (outer[0], unrotated) -- a focused box around it
    const minX = 5.6, maxX = 6.7, minY = 0.3, maxY = 1.6, GRID = 40;
    let total = 0, covered = 0;
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const x = minX + ((maxX - minX) * (i + 0.5)) / GRID, y = minY + ((maxY - minY) * (j + 0.5)) / GRID;
      if (!pointInPolygon(x, y, outer) || pointInPolygon(x, y, inner)) continue;
      total++;
      if (cells.some((c) => pointInPolygon(x, y, c.polygon))) covered++;
    }
    const coverage = total > 0 ? covered / total : 1;
    expect(coverage, `corner-box coverage: ${covered}/${total}`).toBeGreaterThanOrEqual(0.85);
  });

  it('BRICK_PATTERNS declares fieldstone as band-capable (the flag 37\'s own picker reads)', async () => {
    const { BRICK_PATTERNS } = await import('../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js');
    expect(BRICK_PATTERNS.fieldstone.bandCapable).toBe(true);
    // herringbone/basketweave stay Wall-only -- confirms the flag is deliberate, not accidentally broad
    expect(BRICK_PATTERNS.herringbone.bandCapable).toBeFalsy();
    expect(BRICK_PATTERNS.basketweave.bandCapable).toBeFalsy();
  });
});
