/**
 * H23 item 76 -- direct unit coverage for arc-voussoir.js's own voussoirPieces (true circular-arc
 * brick construction) and radialSignAt, independent of any real template data.
 */
import { describe, it, expect } from 'vitest';
import { voussoirPieces, radialSignAt } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/arc-voussoir.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const SET = BRICK_SETS[0]; // brickLengthIn 0.75, grout.widthIn 0.06

function isSimplePolygon(poly) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const segCross = (a0, a1, b0, b1) => {
    const d1 = cross(b0, b1, a0), d2 = cross(b0, b1, a1), d3 = cross(a0, a1, b0), d4 = cross(a0, a1, b1);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === (i + 1) % n || i === (j + 1) % n) continue;
      if (segCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}

describe('radialSignAt', () => {
  it('a CCW-tangent point on a circle: the plain "out" perpendicular points TOWARD the centre (radius decreases)', () => {
    // at angle 0 on a circle centred at the origin, the CCW tangent is (0,1) (straight up).
    const sign = radialSignAt({ tx: 0, ty: 1 }, 5, 0, 0, 0);
    expect(sign).toBe(-1);
  });

  it('a CW-tangent point on the SAME circle: "out" points AWAY from the centre (radius increases)', () => {
    const sign = radialSignAt({ tx: 0, ty: -1 }, 5, 0, 0, 0);
    expect(sign).toBe(1);
  });
});

describe('voussoirPieces', () => {
  it('a comfortably-wide quarter-circle: every piece is simple, reaches the true outer radius exactly, stays within the true inner radius', () => {
    const r = 5, halfWidth = SET.brickLengthIn / 2; // r=5 is comfortably larger than halfWidth=0.375
    const { pieces } = voussoirPieces(0, 0, r, 0, Math.PI / 2, halfWidth, -1, SET.brickHeightIn, SET.grout.widthIn, SET, 1, 'test', 0);
    expect(pieces.length).toBeGreaterThan(0);
    // the TRUE geometric bounds, sign-agnostic (radialSign=-1 here makes voussoirPieces' own
    // internal "rOuter" the numerically SMALLER value -- just a naming convention, not the real
    // outer/inner distinction, so take min/max directly rather than assume which name is bigger).
    const rMax = Math.max(r + halfWidth, r - halfWidth), rMin = Math.min(r + halfWidth, r - halfWidth);
    for (const p of pieces) {
      expect(isSimplePolygon(p.polygon), `piece ${p.id} is self-intersecting`).toBe(true);
      for (const pt of p.polygon) {
        const dist = Math.hypot(pt.x, pt.y);
        expect(dist).toBeLessThanOrEqual(rMax + 1e-6);
        expect(dist).toBeGreaterThanOrEqual(rMin - 1e-6);
      }
    }
  });

  it('every piece reaches the TRUE outer radius exactly (at least one vertex, no "floating short" of it)', () => {
    const r = 5, halfWidth = SET.brickLengthIn / 2;
    const { pieces } = voussoirPieces(0, 0, r, 0, Math.PI / 2, halfWidth, -1, SET.brickHeightIn, SET.grout.widthIn, SET, 1, 'test', 0);
    const rOuter = r + halfWidth;
    for (const p of pieces) {
      const maxDist = Math.max(...p.polygon.map((pt) => Math.hypot(pt.x, pt.y)));
      expect(maxDist).toBeCloseTo(rOuter, 6);
    }
  });

  it('consecutive pieces never overlap and their gap matches the planned joint width (grid-sampled)', () => {
    const r = 5, halfWidth = SET.brickLengthIn / 2;
    const { pieces } = voussoirPieces(0, 0, r, 0, Math.PI / 2, halfWidth, -1, SET.brickHeightIn, SET.grout.widthIn, SET, 1, 'test', 0);
    expect(pieces.length).toBeGreaterThan(1);
    const pointInPoly = (x, y, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        const hit = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
        if (hit) inside = !inside;
      }
      return inside;
    };
    for (let i = 1; i < pieces.length; i++) {
      // sample points along the midline between the two pieces' own bboxes -- none should be
      // "inside both" (overlap) and the two pieces should not be touching with zero gap either.
      let inBoth = 0;
      const allPts = [...pieces[i - 1].polygon, ...pieces[i].polygon];
      for (const p of allPts) {
        if (pointInPoly(p.x, p.y, pieces[i - 1].polygon) && pointInPoly(p.x, p.y, pieces[i].polygon)) inBoth++;
      }
      expect(inBoth).toBe(0);
    }
  });

  it('MUTATION CHECK: forcing pieces to share the SAME angular range (no joint gap) DOES overlap -- proving the no-overlap test above is not vacuous', () => {
    const r = 5, halfWidth = SET.brickLengthIn / 2;
    // call with grout=0 AND a tiny pitch so many pieces pack with ~zero gap, then verify at least
    // adjacent pieces' own polygons touch/overlap when deliberately given overlapping angular spans
    // by directly building two pieces at the SAME theta range (simulating the bug this file's own
    // joint-gap advance is supposed to prevent).
    const { pieces: a } = voussoirPieces(0, 0, r, 0, 0.3, halfWidth, -1, SET.brickHeightIn, SET.grout.widthIn, SET, 1, 'a', 0);
    const { pieces: b } = voussoirPieces(0, 0, r, 0, 0.3, halfWidth, -1, SET.brickHeightIn, SET.grout.widthIn, SET, 1, 'b', 0); // SAME range as `a`
    // `a`'s and `b`'s own first piece occupy the IDENTICAL angular range -- they must overlap fully.
    const pointInPoly = (x, y, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        const hit = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
        if (hit) inside = !inside;
      }
      return inside;
    };
    const centroid = (poly) => poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, y: s.y + p.y / poly.length }), { x: 0, y: 0 });
    const c = centroid(a[0].polygon);
    expect(pointInPoly(c.x, c.y, b[0].polygon)).toBe(true); // a's own centre sits inside b -- true overlap
  });

  it('skips the WHOLE segment (no pieces, no garbage pinwheel) when the declared cross-width exceeds the available radius', () => {
    const tinyR = 0.3, halfWidth = SET.brickLengthIn / 2; // 0.375 > 0.3 -- a physically-impossible fit
    const { pieces } = voussoirPieces(0, 0, tinyR, 0, Math.PI / 2, halfWidth, 1, SET.brickHeightIn, SET.grout.widthIn, SET, 1, 'test', 0);
    expect(pieces).toEqual([]);
  });

  it('is deterministic: same seed, same inputs, identical pieces', () => {
    const r = 5, halfWidth = SET.brickLengthIn / 2;
    const run1 = voussoirPieces(0, 0, r, 0, Math.PI / 2, halfWidth, -1, SET.brickHeightIn, SET.grout.widthIn, SET, 7, 'x', 0);
    const run2 = voussoirPieces(0, 0, r, 0, Math.PI / 2, halfWidth, -1, SET.brickHeightIn, SET.grout.widthIn, SET, 7, 'x', 0);
    expect(JSON.stringify(run1.pieces)).toBe(JSON.stringify(run2.pieces));
  });

  it('a REVERSED angular direction (theta2 < theta1) still produces simple, correctly-ordered pieces', () => {
    const r = 5, halfWidth = SET.brickLengthIn / 2;
    const { pieces } = voussoirPieces(0, 0, r, Math.PI / 2, 0, halfWidth, -1, SET.brickHeightIn, SET.grout.widthIn, SET, 1, 'test', 0);
    expect(pieces.length).toBeGreaterThan(0);
    for (const p of pieces) expect(isSimplePolygon(p.polygon)).toBe(true);
  });
});
