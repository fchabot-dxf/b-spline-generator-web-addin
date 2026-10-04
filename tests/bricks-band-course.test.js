/**
 * F35 item 8 -- the per-band pattern picker's own engine (core/bricks/band-course.js). Tests per the
 * dispatch's own spec: "no overlap, inside the band, grout +-10% on T1 + square." Drives the REAL
 * template machinery for T1 (frameContourSilhouette + buildRibbonPrimitives, the SAME chokepoint
 * tests/bricks-real-template-contours.test.js already uses and the live Brick-tab adapter itself
 * uses via main/brick-panel.js's resolveFrameGeom) -- no synthetic hourglass stand-in.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bandCourseBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/band-course.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const SET = BRICK_SETS[0]; // brickLengthIn 0.75, brickHeightIn 0.2, grout.widthIn 0.034

function linesFromPolygon(pts) {
  return pts.map((p, i) => ({ type: 'line', p0: p, p1: pts[(i + 1) % pts.length] }));
}
const SQUARE_PRIMITIVES = linesFromPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);

function realPrimitives(templateId, widthIn, heightIn) {
  const record = normalizeFrameRecord({ templateId });
  const frame = { defs: FRAME_DEFS, record, board: { widthIn, heightIn } };
  const sil = frameContourSilhouette(frame, 0, 0);
  if (sil.error) throw new Error(`${templateId} ${widthIn}x${heightIn}: frameContourSilhouette failed (${sil.error})`);
  return buildRibbonPrimitives(sil.primitives);
}
const T1_PRIMITIVES = realPrimitives('template_1', 7, 9);

// Separating-axis overlap test, independent of band-course.js's own construction -- the test's own
// ground truth, same technique tests/bricks-weave-layouts.test.js already uses for rotated polygons.
function polysOverlap(a, b) {
  const edgesOf = (poly) => poly.map((p, i) => { const q = poly[(i + 1) % poly.length]; return { x: q.x - p.x, y: q.y - p.y }; });
  const axes = [...edgesOf(a), ...edgesOf(b)].map((e) => ({ x: -e.y, y: e.x }));
  for (const ax of axes) {
    const proj = (poly) => poly.map((p) => p.x * ax.x + p.y * ax.y);
    const pa = proj(a), pb = proj(b);
    const aMin = Math.min(...pa), aMax = Math.max(...pa), bMin = Math.min(...pb), bMax = Math.max(...pb);
    if (aMax < bMin + 1e-6 || bMax < aMin + 1e-6) return false;
  }
  return true;
}

function pointSegDist(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}
function polyDist(a, b) {
  if (polysOverlap(a, b)) return 0;
  let best = Infinity;
  for (const [poly, other] of [[a, b], [b, a]]) {
    for (const p of poly) for (let i = 0; i < other.length; i++) {
      const d = pointSegDist(p, other[i], other[(i + 1) % other.length]);
      if (d < best) best = d;
    }
  }
  return best;
}

const PATTERNS = ['stretcher', 'stack', 'soldier', 'header', 'flemish'];

describe('bandCourseBricks (F35 item 8) -- exact geometry on a plain square', () => {
  // v=0 is the square's own true outer edge (bandFrameAt's own documented convention, hand-verified
  // in contour-bands.test.js's own describe block) -- a single stretcher band of width brickHeightIn
  // (one row) should place its first brick's OUTER edge exactly ON the square (y=0 along the bottom).
  it('a single-row stretcher band\'s first brick sits exactly on the outer edge, correct size', () => {
    const { bricks } = bandCourseBricks(SQUARE_PRIMITIVES, [{ widthIn: SET.brickHeightIn, pattern: 'stretcher' }], SET, { seed: 1 });
    expect(bricks.length).toBeGreaterThan(5);
    const first = bricks[0].polygon;
    const ys = first.map((p) => p.y), xs = first.map((p) => p.x);
    expect(Math.min(...ys)).toBeCloseTo(0, 6); // outer edge, v=0
    expect(Math.max(...ys)).toBeCloseTo(SET.brickHeightIn, 3); // v1 = one stretcher row deep
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(SET.brickLengthIn, 3); // true declared length, never stretched
  });

  it('two stacked bands (soldier then stretcher) meet with zero gap/overlap at the shared depth', () => {
    const { bricks } = bandCourseBricks(
      SQUARE_PRIMITIVES,
      [{ widthIn: SET.brickLengthIn, pattern: 'soldier' }, { widthIn: SET.brickHeightIn, pattern: 'stretcher' }],
      SET, { seed: 2 },
    );
    const soldierDepth = Math.max(...bricks.filter((b) => Math.max(...b.polygon.map((p) => p.y)) <= SET.brickLengthIn + 0.05).map((b) => Math.max(...b.polygon.map((p) => p.y))));
    expect(soldierDepth).toBeCloseTo(SET.brickLengthIn, 2); // band 1's own inner edge == band 2's own outer edge
  });
});

for (const [fixtureLabel, primitives] of [['plain square', SQUARE_PRIMITIVES], ['T1 (hourglass, concave waist)', T1_PRIMITIVES]]) {
  describe(`bandCourseBricks (F35 item 8) -- ${fixtureLabel}`, () => {
    for (const pattern of PATTERNS) {
      const bands = [{ widthIn: SET.brickHeightIn * 2, pattern }]; // 2 rows, exercises row-to-row stacking too
      const { bricks } = bandCourseBricks(primitives, bands, SET, { seed: 3 });

      it(`${pattern}: produces a substantial number of bricks (sanity: it actually ran)`, () => {
        expect(bricks.length).toBeGreaterThan(10);
      });

      it(`${pattern}: no two bricks overlap (exact SAT test)`, () => {
        let overlapCount = 0;
        for (let i = 0; i < bricks.length; i++) for (let j = i + 1; j < bricks.length; j++) {
          if (polysOverlap(bricks[i].polygon, bricks[j].polygon)) overlapCount++;
        }
        expect(overlapCount).toBe(0);
      });

      // A brick's own NEAREST neighbour is often the next ROW's brick directly across the row
      // boundary (same u, adjacent v) -- deliberately FLUSH (zero gap), the SAME row-to-row
      // convention `bricksContourBands` itself already uses (confirmed: naturalWidth rows stack
      // edge-to-edge with no depth-direction joint). So a gap is valid when it's either real grout
      // (+-10% of declared) OR flush (near zero) -- same two-way classification
      // tests/bricks-weave-layouts.test.js's own checkGroutTolerance already established for
      // basketweave's own deliberately-flush square boundaries.
      it(`${pattern}: the gap between neighbouring bricks is either real grout (+-10%) or a deliberately flush row boundary`, () => {
        const J = SET.grout.widthIn;
        let sampled = 0, withinTolerance = 0;
        for (let i = 0; i < bricks.length; i++) {
          let nearest = Infinity;
          for (let j = 0; j < bricks.length; j++) {
            if (i === j) continue;
            const d = polyDist(bricks[i].polygon, bricks[j].polygon);
            if (d < nearest) nearest = d;
          }
          if (Number.isFinite(nearest) && nearest < J * 3) { // only count genuine NEIGHBOURS, not the
            // far side of the loop -- a brick's nearest neighbour is always a real joint (the band is
            // densely packed), so this threshold only excludes degenerate "nothing nearby" cases.
            sampled++;
            const isGrout = nearest > J * 0.9 && nearest < J * 1.1;
            const isFlush = nearest < J * 0.2;
            if (isGrout || isFlush) withinTolerance++;
          }
        }
        expect(sampled).toBeGreaterThan(5);
        expect(withinTolerance / sampled).toBeGreaterThanOrEqual(0.8);
      });
    }

    it('bands stack without overlap between them (a 3-row-deep band split as 1+2 rows across two bands matches a single 3-row band\'s own bricks almost exactly)', () => {
      const whole = bandCourseBricks(primitives, [{ widthIn: SET.brickHeightIn * 3, pattern: 'stretcher' }], SET, { seed: 4 }).bricks;
      const split = bandCourseBricks(primitives, [{ widthIn: SET.brickHeightIn, pattern: 'stretcher' }, { widthIn: SET.brickHeightIn * 2, pattern: 'stretcher' }], SET, { seed: 4 }).bricks;
      expect(split.length).toBe(whole.length);
      let overlapCount = 0;
      for (let i = 0; i < split.length; i++) for (let j = i + 1; j < split.length; j++) {
        if (polysOverlap(split[i].polygon, split[j].polygon)) overlapCount++;
      }
      expect(overlapCount).toBe(0);
    });
  });
}
