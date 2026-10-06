/**
 * H23 item 76 -- direct + real-template coverage for primitive-ribbon.js's own ribbonPieces, the
 * 4th architecture attempt (after three reverted centreline-patch attempts, see WORK-LOG) that
 * builds each row directly from the ORIGINAL template primitives + a depth range, never by
 * compounding offsetPathInward/bricksAlongPath through a previously-offset polyline.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { inwardSignFor, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { radialSignAt } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/arc-voussoir.js';
import { ribbonPieces } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/primitive-ribbon.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';

const SET = BRICK_SETS[0];
const ARC_STEPS = 16;

function isSimplePolygon(poly) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const segCross = (a0, a1, b0, b1) => {
    const d1 = cross(b0, b1, a0), d2 = cross(b0, b1, a1), d3 = cross(a0, a1, b0), d4 = cross(a0, a1, b1);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === (i + 1) % n || i === (j + 1) % n) continue;
    if (segCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
  }
  return true;
}

describe('ribbonPieces on a synthetic square (no arcs, a plain 90deg mitred corner)', () => {
  // CCW square, (0,0)->(10,0)->(10,10)->(0,10), inwardSign=+1.
  function square() {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const inwardSign = inwardSignFor(pts);
    const line = (p0, p1) => {
      const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy);
      return { type: 'line', p0, p1, nx: (-dy / len) * inwardSign, ny: (dx / len) * inwardSign };
    };
    return [line(pts[0], pts[1]), line(pts[1], pts[2]), line(pts[2], pts[3]), line(pts[3], pts[0])];
  }

  it('every piece is simple and inside the board, at the outer depth', () => {
    const primitives = square();
    const { pieces } = ribbonPieces(primitives, 0, SET.brickLengthIn, SET, 'soldier', SET.brickHeightIn, SET.grout.widthIn, 1, 'test', 0);
    expect(pieces.length).toBeGreaterThan(0);
    for (const p of pieces) {
      expect(isSimplePolygon(p.polygon), `piece ${p.id} is self-intersecting`).toBe(true);
      for (const pt of p.polygon) {
        expect(pt.x).toBeGreaterThanOrEqual(-1e-6);
        expect(pt.x).toBeLessThanOrEqual(10 + 1e-6);
        expect(pt.y).toBeGreaterThanOrEqual(-1e-6);
        expect(pt.y).toBeLessThanOrEqual(10 + 1e-6);
      }
    }
  });

  it('every piece is simple and inside the board, at a DEEPER depth (not the outer edge)', () => {
    // A plain symmetric square does NOT happen to discriminate the "keepRef only correct at d0=0"
    // bug this file's own KEEP_REF_STEP_IN fix corrects (CONFIRMED directly: mutating the fix back
    // to its pre-fix form still passes this exact test, 0/0 on this square at any depth) -- kept as
    // a basic sanity check on a simple shape, not as that bug's own regression test. The REAL
    // templates below (T1/T12, three_band) are what actually caught it: mutating the SAME fix back
    // made 2 of those 4 tests fail with the EXACT vertex counts (76, 64) measured by hand while
    // diagnosing this bug -- see WORK-LOG for the full account.
    const primitives = square();
    const { pieces } = ribbonPieces(primitives, 2, 2.75, SET, 'soldier', SET.brickHeightIn, SET.grout.widthIn, 1, 'test', 0);
    expect(pieces.length).toBeGreaterThan(0);
    for (const p of pieces) {
      expect(isSimplePolygon(p.polygon), `piece ${p.id} is self-intersecting`).toBe(true);
      for (const pt of p.polygon) {
        expect(pt.x).toBeGreaterThanOrEqual(-1e-6);
        expect(pt.x).toBeLessThanOrEqual(10 + 1e-6);
        expect(pt.y).toBeGreaterThanOrEqual(-1e-6);
        expect(pt.y).toBeLessThanOrEqual(10 + 1e-6);
      }
    }
  });
});

function tessellate(primitives) {
  const points = [];
  for (const prim of primitives) {
    if (prim.type === 'A') {
      for (let k = 0; k < ARC_STEPS; k++) {
        const t = prim.theta1 + (prim.dTheta * k) / ARC_STEPS;
        points.push({ x: prim.cx + prim.rx * Math.cos(t), y: prim.cy + prim.ry * Math.sin(t) });
      }
    } else {
      points.push({ x: prim.p0.x, y: prim.p0.y });
    }
  }
  return points;
}

/** Build primitive-ribbon.js's own primitive format directly from a real template's own
 *  sil.primitives, same conversion the advisor's own spec describes. */
function buildPrimitives(silPrimitives, inwardSign) {
  return silPrimitives.map((prim, i) => {
    if (prim.type === 'L') {
      const next = silPrimitives[(i + 1) % silPrimitives.length];
      const p1 = next.type === 'L' ? next.p0 : { x: next.cx + next.rx * Math.cos(next.theta1), y: next.cy + next.ry * Math.sin(next.theta1) };
      const dx = p1.x - prim.p0.x, dy = p1.y - prim.p0.y, len = Math.hypot(dx, dy);
      return { type: 'line', p0: prim.p0, p1, nx: (-dy / len) * inwardSign, ny: (dx / len) * inwardSign };
    }
    const theta2 = prim.theta1 + prim.dTheta;
    const midT = (prim.theta1 + theta2) / 2;
    const mid = { x: prim.cx + prim.rx * Math.cos(midT), y: prim.cy + prim.ry * Math.sin(midT) };
    const direction = Math.sign(prim.dTheta) || 1;
    const tangent = { tx: -Math.sin(midT) * direction, ty: Math.cos(midT) * direction };
    const radialSign = radialSignAt(tangent, mid.x, mid.y, prim.cx, prim.cy, inwardSign);
    return { type: 'arc', cx: prim.cx, cy: prim.cy, r: prim.rx, theta1: prim.theta1, theta2, radialSign };
  });
}

function realPrimitives(templateId, W, H) {
  const record = normalizeFrameRecord({ templateId });
  const frame = { defs: FRAME_DEFS, record, board: { widthIn: W, heightIn: H } };
  const sil = frameContourSilhouette(frame, 0, 0);
  const pts = tessellate(sil.primitives);
  const inwardSign = inwardSignFor(pts);
  return buildPrimitives(sil.primitives, inwardSign);
}

function allRibbonPieces(primitives, bands) {
  let pieces = [], depthSoFar = 0, nextId = 0;
  bands.forEach((band, bandIndex) => {
    const naturalWidth = band.pattern === 'soldier' ? SET.brickLengthIn : SET.brickHeightIn;
    const pitch = band.pattern === 'soldier' ? SET.brickHeightIn : SET.brickLengthIn;
    const rows = Math.max(1, Math.round(band.widthIn / naturalWidth));
    for (let row = 0; row < rows; row++) {
      const d0 = depthSoFar + naturalWidth * row, d1 = depthSoFar + naturalWidth * (row + 1);
      const built = ribbonPieces(
        primitives, d0, d1, SET, band.pattern, pitch, SET.grout.widthIn, 1, 'frame', nextId,
        band.cornerStyle || 'mitre', bandIndex,
      );
      pieces = pieces.concat(built.pieces);
      nextId = built.nextId;
    }
    depthSoFar += naturalWidth * rows;
  });
  return pieces;
}

const bbox = (poly) => {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};
// T86 item 19 follow-up: was grid-sampled (10x10 cell-centre, via `pointInPolygon`) -- MEASURED to
// false-positive on pieces that merely TOUCH at a shared mitre vertex (zero real area overlap) once
// `pointInPolygon` itself learned to treat an on-boundary point as inside (needed for a real
// bondLayout bug, T86 item 19's own fix). Exact polygon-intersection AREA is immune to that; same
// "fraction of subject covered by other" semantic the grid sampler approximated, now exact.
function overlapFraction(subject, other) {
  const inter = polygonIntersection(subject, other);
  if (inter.length < 3) return 0;
  const subjectArea = Math.abs(signedArea(subject));
  return subjectArea > 0 ? Math.abs(signedArea(inter)) / subjectArea : 0;
}

describe('ribbonPieces on REAL template geometry (H23 item 76, advisor-dispatched rebuild)', () => {
  const CASES = [
    ['template_1 (hourglass -- concave waist, convex shoulder fillets)', 'template_1', 7, 9],
    ['template_12 (tapered)', 'template_12', 7, 9],
  ];

  for (const [name, templateId, W, H] of CASES) {
    for (const presetName of ['single_soldier', 'three_band']) {
      it(`${name}, ${presetName}: every piece is simple, 0 outside the board`, () => {
        const primitives = realPrimitives(templateId, W, H);
        const pieces = allRibbonPieces(primitives, FRAME_PRESETS[presetName]);
        expect(pieces.length).toBeGreaterThan(0);
        let notSimple = 0, outOfBounds = 0;
        for (const p of pieces) {
          if (!isSimplePolygon(p.polygon)) notSimple++;
          for (const pt of p.polygon) {
            const dx = Math.max(0 - pt.x, pt.x - W, 0), dy = Math.max(0 - pt.y, pt.y - H, 0);
            if (Math.max(dx, dy) > 0.001) outOfBounds++;
          }
        }
        expect(notSimple, `${notSimple} self-intersecting pieces`).toBe(0);
        expect(outOfBounds, `${outOfBounds} vertices outside the board`).toBe(0);
      });
    }

    it(`${name}, single_soldier: no two pieces overlap (exact polygon-intersection area)`, () => {
      const primitives = realPrimitives(templateId, W, H);
      const pieces = allRibbonPieces(primitives, FRAME_PRESETS.single_soldier);
      let worst = 0;
      for (let i = 0; i < pieces.length; i++) {
        for (let j = i + 1; j < pieces.length; j++) {
          const A = bbox(pieces[i].polygon), B = bbox(pieces[j].polygon);
          if (A.maxX < B.minX - 1e-6 || B.maxX < A.minX - 1e-6 || A.maxY < B.minY - 1e-6 || B.maxY < A.minY - 1e-6) continue;
          worst = Math.max(worst, overlapFraction(pieces[i].polygon, pieces[j].polygon));
        }
      }
      // Was MEASURED non-zero on both templates before F35 item 7's own grout-scaling correction
      // (scaledSet now scales grout.widthIn WITH the brick, see bricks-scale-grout.test.js) shifted
      // piece boundaries enough to move a shared-corner seam -- the two end triangles at a corner
      // are built by two INDEPENDENT clip chains that land on the SAME mathematical mitre line but
      // can differ by float-epsilon in their own vertices (same seam class bricks-contour-bands.
      // test.js's own overlap test documents). T86 item 19 follow-up: this now measures EXACT
      // polygon-intersection area (was grid-sampled -- see `overlapFraction`'s own header), so 0.03
      // is a real area-fraction bound, not a sampling-noise allowance.
      expect(worst, 'worst pairwise overlap fraction').toBeLessThan(0.03);
    });

    // T86 item 19 follow-up -- PRE-EXISTING, NOT caused by this item: switching `overlapFraction`
    // to exact polygon-intersection area (see its own header) revealed this test's old 10x10
    // grid-sampled check was badly under-measuring the real severity here. H23 item 76's own comment
    // described "a small triangle pair... MEASURED 0.300" at a row-transition seam; the EXACT
    // measurement instead found 12 DISTINCT pairs at ~1.000 (one piece FULLY contained in its own
    // neighbour, not a sliver) on template_1 alone -- a real, visible defect (doubled-up brick
    // geometry) at every row transition around the waist, not one bounded imperfection. CONFIRMED
    // not caused by this item's own geometry.js changes: the piece polygons themselves, and this
    // exact overlap area, are BYTE-IDENTICAL with `geometry.js` stashed back to its pre-item-19
    // state (the only thing that changed is HOW accurately the test now measures a quantity
    // `primitive-ribbon.js`'s own three_band row-transition logic was always producing). No
    // threshold can honestly pass here until that's fixed -- `.todo` keeps the finding visible
    // instead of silently deleting coverage or picking a meaningless threshold (the true worst case
    // is ~1.0, so nothing short of "always pass" would NOT also flag this real defect). Flagged for
    // its own dispatch; out of scope for T86 item 19 (Wall-only, no Frame bands).
    // T86 item 21b (seat B / fc, 2026-10-06): un-todo'd -- MEASURED already fixed before 21b (neck-medial 44f375e:
    // worst pair 0.0005 of a piece on T1 and T12, nothing over 0.03); this test FAILS at 5a4ddd9, where the todo was
    // written, and now guards it.
    it(`${name}, three_band (deep multi-row stress case): no two pieces overlap (exact polygon-intersection area)`, () => {
      const pieces = allRibbonPieces(realPrimitives(templateId, W, H), FRAME_PRESETS.three_band);
      let worst = 0;
      for (let i = 0; i < pieces.length; i++) {
        for (let j = i + 1; j < pieces.length; j++) {
          const A = bbox(pieces[i].polygon), B = bbox(pieces[j].polygon);
          if (A.maxX < B.minX - 1e-6 || B.maxX < A.minX - 1e-6 || A.maxY < B.minY - 1e-6 || B.maxY < A.minY - 1e-6) continue;
          worst = Math.max(worst, overlapFraction(pieces[i].polygon, pieces[j].polygon));
        }
      }
      expect(worst, 'worst pairwise overlap fraction').toBeLessThan(0.03);
    });
  }
});

describe('ribbonPieces with cornerStyle="butt" (T86 item 1)', () => {
  // CCW square, (0,0)->(10,0)->(10,10)->(0,10), inwardSign=+1 -- primitives[0]=bottom (horizontal,
  // "through" at both its own corners), primitives[1]=right (vertical, "butt" at both), [2]=top
  // (horizontal, through), [3]=left (vertical, butt) -- every corner in a plain rectangle is exactly
  // one horizontal + one vertical primitive, so this fixture exercises all 4 butt joints at once.
  function square() {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const inwardSign = inwardSignFor(pts);
    const line = (p0, p1) => {
      const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy);
      return { type: 'line', p0, p1, nx: (-dy / len) * inwardSign, ny: (dx / len) * inwardSign };
    };
    return [line(pts[0], pts[1]), line(pts[1], pts[2]), line(pts[2], pts[3]), line(pts[3], pts[0])];
  }

  const D0 = 0, D1 = SET.brickLengthIn, GROUT = SET.grout.widthIn; // 0, 0.75, 0.034

  it('every piece is simple and inside the board', () => {
    const primitives = square();
    const { pieces } = ribbonPieces(primitives, D0, D1, SET, 'soldier', SET.brickHeightIn, GROUT, 1, 'test', 0, 'butt');
    expect(pieces.length).toBeGreaterThan(0);
    for (const p of pieces) {
      expect(isSimplePolygon(p.polygon), `piece ${p.id} is self-intersecting`).toBe(true);
      for (const pt of p.polygon) {
        expect(pt.x).toBeGreaterThanOrEqual(-1e-6);
        expect(pt.x).toBeLessThanOrEqual(10 + 1e-6);
        expect(pt.y).toBeGreaterThanOrEqual(-1e-6);
        expect(pt.y).toBeLessThanOrEqual(10 + 1e-6);
      }
    }
  });

  it('the horizontal (through) band runs the full 0..10 span, uninterrupted', () => {
    // bottom (primitives[0]): both its own corners are met by a VERTICAL (butt) neighbour, so
    // bottom is "through" at both ends -- no clip at all, same as this project's own pre-existing
    // "null joint" convention. HAND-COMPUTED (not read back from the engine): the pieces' own
    // combined x-extent must reach exactly 0 and 10, not stop short at some clipped position.
    // Discriminate by which band a piece's own DEPTH span belongs to (every piece in a band spans
    // that band's full [d0,d1] in its cross-direction) -- an "every point's y stays under D1" test
    // alone also accidentally admits a bottom-run end piece whose own narrow x-sliver happens to sit
    // past x=10-D1 (MEASURED: caught this exact false-positive while writing this test).
    const primitives = square();
    const { pieces } = ribbonPieces(primitives, D0, D1, SET, 'soldier', SET.brickHeightIn, GROUT, 1, 'test', 0, 'butt');
    const bottomPieces = pieces.filter((p) => {
      const ys = p.polygon.map((pt) => pt.y);
      return Math.min(...ys) <= 1e-6 && Math.max(...ys) >= D1 - 1e-6;
    });
    const xs = bottomPieces.flatMap((p) => p.polygon.map((pt) => pt.x));
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(10, 6);
  });

  it('the vertical (butt) band is square-cut exactly one grout gap past the through band\'s own inner edge', () => {
    // right (primitives[1]): HAND-COMPUTED expected span -- the through bands' own d1 edge sits at
    // y=D1 (bottom) and y=10-D1 (top); one grout gap further AWAY from each corner (into right's own
    // middle) gives right's own usable y-range as exactly [D1+GROUT, 10-D1-GROUT].
    const primitives = square();
    const { pieces } = ribbonPieces(primitives, D0, D1, SET, 'soldier', SET.brickHeightIn, GROUT, 1, 'test', 0, 'butt');
    const rightPieces = pieces.filter((p) => {
      const xs = p.polygon.map((pt) => pt.x);
      return Math.min(...xs) <= 10 - D1 + 1e-6 && Math.max(...xs) >= 10 - 1e-6;
    });
    expect(rightPieces.length).toBeGreaterThan(0);
    const ys = rightPieces.flatMap((p) => p.polygon.map((pt) => pt.y));
    expect(Math.min(...ys)).toBeCloseTo(D1 + GROUT, 6);
    expect(Math.max(...ys)).toBeCloseTo(10 - D1 - GROUT, 6);
  });

  it('no overlap between the through and butt bands at a corner (a real grout gap, not a seam)', () => {
    const primitives = square();
    const { pieces } = ribbonPieces(primitives, D0, D1, SET, 'soldier', SET.brickHeightIn, GROUT, 1, 'test', 0, 'butt');
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const A = bbox(pieces[i].polygon), B = bbox(pieces[j].polygon);
        if (A.maxX < B.minX - 1e-6 || B.maxX < A.minX - 1e-6 || A.maxY < B.minY - 1e-6 || B.maxY < A.minY - 1e-6) continue;
        expect(overlapFraction(pieces[i].polygon, pieces[j].polygon), `${pieces[i].id} vs ${pieces[j].id}`).toBe(0);
      }
    }
  });

  it('template_1 (arcs present): butt falls back to mitre at every arc-involved corner -- still simple, 0 outside the board', () => {
    const primitives = realPrimitives('template_1', 7, 9);
    const pieces = allRibbonPieces(primitives, FRAME_PRESETS.butt_frame);
    expect(pieces.length).toBeGreaterThan(0);
    let notSimple = 0, outOfBounds = 0;
    for (const p of pieces) {
      if (!isSimplePolygon(p.polygon)) notSimple++;
      for (const pt of p.polygon) {
        const dx = Math.max(0 - pt.x, pt.x - 7, 0), dy = Math.max(0 - pt.y, pt.y - 9, 0);
        if (Math.max(dx, dy) > 0.001) outOfBounds++;
      }
    }
    expect(notSimple, `${notSimple} self-intersecting pieces`).toBe(0);
    expect(outOfBounds, `${outOfBounds} vertices outside the board`).toBe(0);
  });
});

describe('ribbonPieces with cornerStyle="lapped" (T86 item 1, advisor decision turn 291)', () => {
  // Same square fixture as the butt describe block above.
  function square() {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const inwardSign = inwardSignFor(pts);
    const line = (p0, p1) => {
      const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy);
      return { type: 'line', p0, p1, nx: (-dy / len) * inwardSign, ny: (dx / len) * inwardSign };
    };
    return [line(pts[0], pts[1]), line(pts[1], pts[2]), line(pts[2], pts[3]), line(pts[3], pts[0])];
  }
  const D0 = 0, D1 = SET.brickLengthIn, GROUT = SET.grout.widthIn;

  it('bandIndex=0 (even) is identical to "butt" -- the advisor\'s own "a single-band lapped frame equals butt"', () => {
    const primitives = square();
    const butt = ribbonPieces(primitives, D0, D1, SET, 'soldier', SET.brickHeightIn, GROUT, 1, 'test', 0, 'butt');
    const lapped = ribbonPieces(primitives, D0, D1, SET, 'soldier', SET.brickHeightIn, GROUT, 1, 'test', 0, 'lapped', 0);
    expect(lapped.pieces.length).toBe(butt.pieces.length);
    for (let i = 0; i < butt.pieces.length; i++) {
      expect(lapped.pieces[i].polygon).toEqual(butt.pieces[i].polygon);
    }
  });

  it('bandIndex=1 (odd) FLIPS which sides are through -- the horizontal bottom band is now square-cut, the vertical right band now runs full length', () => {
    const primitives = square();
    const { pieces } = ribbonPieces(primitives, D0, D1, SET, 'soldier', SET.brickHeightIn, GROUT, 1, 'test', 0, 'lapped', 1);
    // bottom (was through at bandIndex=0): now the lapped/butt side -- its own x-extent must stop
    // short of the board edges by one grout gap past the (now-through) side bands' own d1 edge.
    const bottom = pieces.filter((p) => {
      const ys = p.polygon.map((pt) => pt.y);
      return Math.min(...ys) <= 1e-6 && Math.max(...ys) >= D1 - 1e-6;
    });
    const xs = bottom.flatMap((p) => p.polygon.map((pt) => pt.x));
    expect(Math.min(...xs)).toBeCloseTo(D1 + GROUT, 6);
    expect(Math.max(...xs)).toBeCloseTo(10 - D1 - GROUT, 6);
    // right (was butt at bandIndex=0): now runs the FULL [0,10] span uninterrupted.
    const right = pieces.filter((p) => {
      const xs2 = p.polygon.map((pt) => pt.x);
      return Math.min(...xs2) <= 10 - D1 + 1e-6 && Math.max(...xs2) >= 10 - 1e-6;
    });
    const ys = right.flatMap((p) => p.polygon.map((pt) => pt.y));
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeCloseTo(10, 6);
  });

  it('FRAME_PRESETS.double_course (2 bands) alternates end to end through bricksContourBands, not just the raw ribbonPieces call', () => {
    const primitives = square();
    const { bricks } = bricksContourBands(primitives, FRAME_PRESETS.double_course, { set: SET, seed: 1 });
    expect(bricks.length).toBeGreaterThan(0);
    for (const p of bricks) {
      expect(isSimplePolygon(p.polygon), `piece ${p.id} is self-intersecting`).toBe(true);
      for (const pt of p.polygon) {
        expect(pt.x).toBeGreaterThanOrEqual(-1e-6);
        expect(pt.x).toBeLessThanOrEqual(10 + 1e-6);
        expect(pt.y).toBeGreaterThanOrEqual(-1e-6);
        expect(pt.y).toBeLessThanOrEqual(10 + 1e-6);
      }
    }
    // band 0 (depth [0,0.75]): bottom pieces reach the full [0,10] span (through).
    // 21b joint rule: each band stops half a joint short of its neighbour band / the wall (band 0: [0, D1 - j/2])
    const halfJ = SET.grout.widthIn / 2;
    const band0Bottom = bricks.filter((p) => {
      const ys = p.polygon.map((pt) => pt.y);
      return Math.min(...ys) <= 1e-6 && Math.max(...ys) >= D1 - halfJ - 1e-6;
    });
    const xs0 = band0Bottom.flatMap((p) => p.polygon.map((pt) => pt.x));
    expect(Math.min(...xs0)).toBeCloseTo(0, 6);
    expect(Math.max(...xs0)).toBeCloseTo(10, 6);
    // band 1 (depth [0.75,1.5]): bottom pieces are now the lapped/clipped side, NOT the full span.
    const band1Bottom = bricks.filter((p) => {
      const ys = p.polygon.map((pt) => pt.y);
      return Math.min(...ys) <= D1 + halfJ + 1e-6 && Math.max(...ys) >= 2 * D1 - halfJ - 1e-6; // band 1: [D1 + j/2, 2 D1 - j/2]
    });
    const xs1 = band1Bottom.flatMap((p) => p.polygon.map((pt) => pt.x));
    expect(Math.min(...xs1)).toBeGreaterThan(0.01); // clipped short of the board edge, unlike band 0
    expect(Math.max(...xs1)).toBeLessThan(9.99);
  });

  it('template_1 (arcs present): lapped also falls back to mitre at every arc-involved corner -- still simple, 0 outside the board', () => {
    const primitives = realPrimitives('template_1', 7, 9);
    const pieces = allRibbonPieces(primitives, FRAME_PRESETS.double_course);
    expect(pieces.length).toBeGreaterThan(0);
    let notSimple = 0, outOfBounds = 0;
    for (const p of pieces) {
      if (!isSimplePolygon(p.polygon)) notSimple++;
      for (const pt of p.polygon) {
        const dx = Math.max(0 - pt.x, pt.x - 7, 0), dy = Math.max(0 - pt.y, pt.y - 9, 0);
        if (Math.max(dx, dy) > 0.001) outOfBounds++;
      }
    }
    expect(notSimple, `${notSimple} self-intersecting pieces`).toBe(0);
    expect(outOfBounds, `${outOfBounds} vertices outside the board`).toBe(0);
  });
});

describe('ribbonPieces with cornerStyle="block" (T86 item 1)', () => {
  // Same square fixture as the butt/lapped describe blocks above.
  function square() {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const inwardSign = inwardSignFor(pts);
    const line = (p0, p1) => {
      const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy);
      return { type: 'line', p0, p1, nx: (-dy / len) * inwardSign, ny: (dx / len) * inwardSign };
    };
    return [line(pts[0], pts[1]), line(pts[1], pts[2]), line(pts[2], pts[3]), line(pts[3], pts[0])];
  }
  const D0 = 0, D1 = SET.brickLengthIn, GROUT = SET.grout.widthIn;
  const QUOIN = BRICK_SETS[2]; // "White rocks" -- the BLOCK corner unit's own declared set
  const BLOCK = QUOIN.brickLengthIn; // 1.1

  function blockPieces(pieces) {
    return pieces.filter((p) => {
      let area = 0;
      for (let i = 0; i < p.polygon.length; i++) {
        const a = p.polygon[i], b = p.polygon[(i + 1) % p.polygon.length];
        area += a.x * b.y - b.x * a.y;
      }
      return Math.abs(area / 2) > BLOCK * BLOCK * 0.5; // the quoin squares are the only pieces anywhere near this area
    });
  }

  it('exactly 4 quoin squares, one per corner, each BLOCK x BLOCK, anchored at the true corner', () => {
    const primitives = square();
    const { pieces } = ribbonPieces(primitives, D0, D1, SET, 'soldier', SET.brickHeightIn, GROUT, 1, 'test', 0, 'block');
    const blocks = blockPieces(pieces);
    expect(blocks.length).toBe(4);
    for (const b of blocks) {
      let area = 0;
      for (let i = 0; i < b.polygon.length; i++) {
        const a = b.polygon[i], c = b.polygon[(i + 1) % b.polygon.length];
        area += a.x * c.y - c.x * a.y;
      }
      expect(Math.abs(area / 2)).toBeCloseTo(BLOCK * BLOCK, 6);
    }
  });

  it('HAND-COMPUTED: the bottom-right corner\'s own quoin square is exactly [(10,0),(10-BLOCK,0),(10-BLOCK,BLOCK),(10,BLOCK)]', () => {
    const primitives = square();
    const { pieces } = ribbonPieces(primitives, D0, D1, SET, 'soldier', SET.brickHeightIn, GROUT, 1, 'test', 0, 'block');
    const blocks = blockPieces(pieces);
    const bottomRight = blocks.find((b) => b.polygon.some((pt) => Math.abs(pt.x - 10) < 1e-6 && Math.abs(pt.y - 0) < 1e-6));
    expect(bottomRight).toBeTruthy();
    const expected = [{ x: 10, y: 0 }, { x: 10 - BLOCK, y: 0 }, { x: 10 - BLOCK, y: BLOCK }, { x: 10, y: BLOCK }];
    for (const e of expected) {
      expect(bottomRight.polygon.some((pt) => Math.abs(pt.x - e.x) < 1e-6 && Math.abs(pt.y - e.y) < 1e-6)).toBe(true);
    }
  });

  it('HAND-COMPUTED: each band\'s own run stops BLOCK+GROUT short of the corner, not just BLOCK', () => {
    // The block's own face sits at BLOCK from the corner; the band's own cut stops one more grout
    // gap past that, at BLOCK+GROUT -- so the bottom band's own x-extent must reach exactly
    // [BLOCK+GROUT, 10-BLOCK-GROUT], never all the way to the block's own bare face. The quoin
    // squares themselves also span y through [0,D1] (they're BLOCK=1.1 tall, D1=0.75), so they must
    // be excluded explicitly -- a plain y-range filter alone (no area check) catches them too, which
    // is exactly what silently broke this test's own first draft (min read 0, the TRUE corner, not
    // BLOCK+GROUT, because a quoin square's own x reaches all the way to the corner).
    const primitives = square();
    const { pieces } = ribbonPieces(primitives, D0, D1, SET, 'soldier', SET.brickHeightIn, GROUT, 1, 'test', 0, 'block');
    const blocks = blockPieces(pieces);
    const bottomBand = pieces.filter((p) => {
      if (blocks.includes(p)) return false;
      const ys = p.polygon.map((pt) => pt.y);
      return Math.min(...ys) <= 1e-6 && Math.max(...ys) >= D1 - 1e-6;
    });
    const xs = bottomBand.flatMap((p) => p.polygon.map((pt) => pt.x));
    expect(Math.min(...xs)).toBeCloseTo(BLOCK + GROUT, 6);
    expect(Math.max(...xs)).toBeCloseTo(10 - BLOCK - GROUT, 6);
  });

  it('no overlap anywhere (quoin squares included)', () => {
    const primitives = square();
    const { pieces } = ribbonPieces(primitives, D0, D1, SET, 'soldier', SET.brickHeightIn, GROUT, 1, 'test', 0, 'block');
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const A = bbox(pieces[i].polygon), B = bbox(pieces[j].polygon);
        if (A.maxX < B.minX - 1e-6 || B.maxX < A.minX - 1e-6 || A.maxY < B.minY - 1e-6 || B.maxY < A.minY - 1e-6) continue;
        expect(overlapFraction(pieces[i].polygon, pieces[j].polygon), `${pieces[i].id} vs ${pieces[j].id}`).toBe(0);
      }
    }
  });

  it('template_1 (arcs present): block also falls back to mitre at every arc-involved corner -- still simple, 0 outside the board', () => {
    const primitives = realPrimitives('template_1', 7, 9);
    const pieces = allRibbonPieces(primitives, FRAME_PRESETS.quoin_corners);
    expect(pieces.length).toBeGreaterThan(0);
    let notSimple = 0, outOfBounds = 0;
    for (const p of pieces) {
      if (!isSimplePolygon(p.polygon)) notSimple++;
      for (const pt of p.polygon) {
        const dx = Math.max(0 - pt.x, pt.x - 7, 0), dy = Math.max(0 - pt.y, pt.y - 9, 0);
        if (Math.max(dx, dy) > 0.001) outOfBounds++;
      }
    }
    expect(notSimple, `${notSimple} self-intersecting pieces`).toBe(0);
    expect(outOfBounds, `${outOfBounds} vertices outside the board`).toBe(0);
  });
});
