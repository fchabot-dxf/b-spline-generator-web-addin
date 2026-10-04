/**
 * T86 item 19 (seat 88's measurement on main 5559125, T1 7x9, Red Brick 0.75, Wall only, no Frame
 * bands -- the item-14 post-fix scenario, Wall fills `frame.primitives` directly): (A) holes along
 * the contour's left side/top-left -- rows missing their end pieces, ~2 sq in uncovered, gaps up to
 * 0.234in; (B) one malformed 5-point L-polygon brick reaching x=7.272 on a 7in board.
 *
 * Root cause (not a "missing closer piece" issue, and not a `bondLayout`/`clipPolygonToBoard` bug
 * either): `geometry.js`'s own `pointInPolygon` has zero boundary tolerance, and a point BUILT to
 * land exactly on a polygon edge can drift by a float ULP to either side of it. MEASURED directly:
 * `bondLayout`'s own course-0 bricks (bottom edge built as `minY + cH/2 - cH/2`, algebraically
 * `minY` but not associative in IEEE 754) landed at 0.24999999999999997 against the board's own
 * exact 0.25 -- JUST outside. `clipPolygonToBoard` -> `polygonIntersection` seeds its own
 * inside/outside state from `pointInPolygon` on the cell's own first vertex, so that one-ULP drift
 * flipped the WHOLE course-0 row to "outside" and (B)'s own malformed polygon came from the SAME
 * misclassification corrupting the Greiner-Hormann walk for the one cell that did have real
 * crossings. Structural, not a one-off: `bondLayout` always starts its course stack at
 * `boardOutline`'s own `minY`, so ANY template with a flat bottom edge hits this for Wall's own
 * first course against its own true contour.
 *
 * FOLLOW-UP, caught by the full suite gate: making `pointInPolygon` boundary-tolerant broke
 * `polygonIntersection`'s own `anyHit===false` fallback, which used to test an arbitrary raw VERTEX
 * (`subject[0]`) as a proxy for "is the whole subject inside clip". Two contour-bands.js corner
 * pieces that merely TOUCH at one shared mitre vertex (zero real crossings, same code path as a
 * genuinely nested pair) started reading as 100% overlapping, because that shared vertex is -- by
 * definition -- within the new on-boundary tolerance of the OTHER polygon too. Fixed by testing the
 * subject's own CENTROID instead: it only lands on/near `clip`'s boundary when the whole subject
 * genuinely sits right at the edge, so it keeps discriminating "merely touching" from "inside"
 * correctly in both cases. (`tests/bricks-real-template-contours.test.js`'s own overlap check was
 * ALSO affected -- its own grid-sampling used raw `pointInPolygon` the same way -- upgraded to exact
 * polygon-intersection area, the same methodology every other overlap check in this codebase uses.)
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { bondLayout } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/layouts/bond.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

function templateContour(templateId, W, H) {
  const record = normalizeFrameRecord({ templateId });
  const frame = { defs: FRAME_DEFS, record, board: { widthIn: W, heightIn: H } };
  const sil = frameContourSilhouette(frame, 0, 0);
  const primitives = buildRibbonPrimitives(sil.primitives);
  // depth-0 boundary via the SAME route item 14's own test used: bricksContourBands with 0 bands.
  const { innerPath } = bricksContourBands(primitives, [], { set: BRICK_SETS[0], seed: 1 });
  return innerPath;
}

describe('pointInPolygon (T86 item 19): tolerant of a point built to land exactly on an edge', () => {
  it('a point one float ULP outside an exact grid edge still reads as inside', () => {
    // bondLayout's own exact drift pattern: courseCy = minY + cH/2, then the cell's own bottom edge
    // is courseCy - cH/2 -- algebraically minY, but MEASURED (minY=0.25, cH/2=0.1) to actually land
    // at 0.24999999999999997, one ULP short of the square's own exact bottom edge.
    const square = [{ x: 0, y: 0.25 }, { x: 1, y: 0.25 }, { x: 1, y: 1.25 }, { x: 0, y: 1.25 }];
    const courseCy = 0.25 + 0.1;
    const driftedBottomY = courseCy - 0.1;
    expect(driftedBottomY).not.toBe(0.25); // confirms the drift is real, not a hypothetical
    expect(pointInPolygon(0.5, driftedBottomY, square)).toBe(true);
  });

  it("template_1 (hourglass) 7x9, Wall only, no Frame bands: course 0 is fully populated, not a single malformed cell", () => {
    const innerPath = templateContour('template_1', 7, 9);
    const SET = { ...BRICK_SETS[0], brickLengthIn: 0.75 };
    const { cells } = bondLayout(innerPath, SET, [{ pattern: 'stretcher' }]);
    const course0 = cells.filter((c) => c.courseIndex === 0);
    // the true repro: pre-fix this was exactly 1 cell (the malformed L-polygon); a normal course
    // this wide should carry close to (board width / brickLengthIn) whole+partial pieces.
    expect(course0.length).toBeGreaterThanOrEqual(7);
    for (const c of course0) expect(c.polygon.length).toBeLessThanOrEqual(4); // no L-shaped artifacts
  });

  it('no cell polygon reaches outside the board\'s own bounding box, on any course', () => {
    const innerPath = templateContour('template_1', 7, 9);
    const SET = { ...BRICK_SETS[0], brickLengthIn: 0.75 };
    const { cells } = bondLayout(innerPath, SET, [{ pattern: 'stretcher' }]);
    const xs = innerPath.map((p) => p.x), ys = innerPath.map((p) => p.y);
    const minX = Math.min(...xs) - 1e-6, maxX = Math.max(...xs) + 1e-6;
    const minY = Math.min(...ys) - 1e-6, maxY = Math.max(...ys) + 1e-6;
    for (const c of cells) {
      for (const p of c.polygon) {
        expect(p.x, `cell ${c.id} x=${p.x}`).toBeGreaterThanOrEqual(minX);
        expect(p.x, `cell ${c.id} x=${p.x}`).toBeLessThanOrEqual(maxX);
        expect(p.y, `cell ${c.id} y=${p.y}`).toBeGreaterThanOrEqual(minY);
        expect(p.y, `cell ${c.id} y=${p.y}`).toBeLessThanOrEqual(maxY);
      }
    }
  });

  it('polygonIntersection: two triangles sharing only one vertex (zero real crossings) are NOT reported as overlapping', () => {
    // the exact real-world pair (contour-bands.js corner pieces, template_1 7x9): two right
    // triangles meeting at (6.75,0.25), otherwise entirely disjoint.
    const a = [{ x: 6.75, y: 0.25 }, { x: 6.75, y: 0.6938538984254665 }, { x: 6.306146101574534, y: 0.6938538984254665 }];
    const b = [{ x: 6.316666666666666, y: 0.25 }, { x: 6.75, y: 0.25 }, { x: 6.316666666666666, y: 0.6833333333333336 }];
    const inter = polygonIntersection(a, b);
    const area = inter.length >= 3 ? Math.abs(signedArea(inter)) : 0;
    expect(area).toBeLessThan(1e-9);
  });
});
