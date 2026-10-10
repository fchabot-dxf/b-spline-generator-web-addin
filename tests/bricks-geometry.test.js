/**
 * H23 item 74 -- direct unit coverage for geometry.js's own shared primitives that previously had
 * only INDIRECT coverage (clipToHalfPlane, promoted from along-path.js's own private copy) or are
 * new (roundPolygonCorners, the fieldstone layout's "slightly rounded corners").
 */
import { describe, it, expect } from 'vitest';
import { clipToHalfPlane, roundPolygonCorners, clipPolygonToBoard, rectPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a / 2);
}

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

const SQUARE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe('clipToHalfPlane', () => {
  it('a vertical line through the centre keeps exactly the half containing keepRef', () => {
    const line = { point: { x: 5, y: 0 }, dirX: 0, dirY: 1 }; // the line x=5
    const left = clipToHalfPlane(SQUARE, line, { x: 0, y: 5 });
    expect(polygonArea(left)).toBeCloseTo(50, 6);
    for (const p of left) expect(p.x).toBeLessThanOrEqual(5 + 1e-9);
    const right = clipToHalfPlane(SQUARE, line, { x: 10, y: 5 });
    expect(polygonArea(right)).toBeCloseTo(50, 6);
    for (const p of right) expect(p.x).toBeGreaterThanOrEqual(5 - 1e-9);
  });

  it('a line entirely outside the polygon (keepRef on the far side) empties it', () => {
    const line = { point: { x: 20, y: 0 }, dirX: 0, dirY: 1 }; // x=20, well past the square
    const kept = clipToHalfPlane(SQUARE, line, { x: 25, y: 5 }); // keep x>=20 -- nothing survives
    expect(polygonArea(kept)).toBeCloseTo(0, 6);
  });

  it('a line entirely on the keepRef side leaves the polygon unchanged (full area)', () => {
    const line = { point: { x: -5, y: 0 }, dirX: 0, dirY: 1 };
    const kept = clipToHalfPlane(SQUARE, line, { x: 5, y: 5 });
    expect(polygonArea(kept)).toBeCloseTo(100, 6);
  });
});

// A concave "notch" board: a 10x10 square with a rectangular bite taken out of the top edge
// (x in [3,6], y in [7,10]) -- reflex corners at (6,7) and (3,7), everything else a plain square.
const NOTCHED_BOARD = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 },
  { x: 6, y: 7 }, { x: 3, y: 7 }, { x: 3, y: 10 }, { x: 0, y: 10 },
];

describe('clipPolygonToBoard (concave board, H23 item 76 cont.)', () => {
  it('a cell entirely inside a concave board is returned unchanged', () => {
    const cell = rectPolygon(1, 1, 0.5, 0.5); // [0.5,1.5]x[0.5,1.5], well clear of the notch
    const clipped = clipPolygonToBoard(cell, NOTCHED_BOARD, { x: 1, y: 1 });
    expect(polygonArea(clipped)).toBeCloseTo(1, 9);
  });

  it('a cell entirely inside the notch (outside the board) is dropped', () => {
    const cell = rectPolygon(4.5, 8.5, 0.5, 0.5); // squarely inside the notch -- outside the board
    const clipped = clipPolygonToBoard(cell, NOTCHED_BOARD, { x: 4.5, y: 8.5 });
    expect(clipped.length).toBeLessThan(3);
  });

  it('a cell straddling the notch wall is cut to its TRUE partial area, not kept whole or dropped', () => {
    // cell = [2.5,4.5] x [6,8.5]: its own centre (3.5,7.25) is INSIDE the notch (outside the
    // board), so the OLD keep-whole-or-drop fallback would have dropped this cell entirely (area
    // 0) even though most of it (the y<7 strip) is real board interior. Hand-computed true area:
    // the x in [2.5,3] strip is entirely inside (2.75 wide check below) -- see inline arithmetic.
    //   x in [2.5,3]: full height 2.5 (y 6..8.5) -> 0.5 * 2.5 = 1.25
    //   x in [3,4.5]: only y in [6,7] is inside (below the notch) -> 1.5 * 1 = 1.5
    //   total = 2.75
    const cell = [{ x: 2.5, y: 6 }, { x: 4.5, y: 6 }, { x: 4.5, y: 8.5 }, { x: 2.5, y: 8.5 }];
    const clipped = clipPolygonToBoard(cell, NOTCHED_BOARD, { x: 3.5, y: 7.25 });
    expect(polygonArea(clipped)).toBeCloseTo(2.75, 9);
    expect(isSimplePolygon(clipped)).toBe(true);
    // the whole point: NOT the old all-or-nothing answers.
    expect(polygonArea(clipped)).not.toBeCloseTo(0, 1);
    expect(polygonArea(clipped)).not.toBeCloseTo(5, 1); // 5 = the cell's own full, unclipped area
  });

  it('a cell straddling the notch on BOTH sides (genuinely disconnected by it) keeps only the larger piece', () => {
    // cell = [0.5,9.5] x [7.2,8]: the notch (x in [3,6]) cuts this into a LEFT piece (x 0.5..3,
    // width 2.5) and a RIGHT piece (x 6..9.5, width 3.5) -- unequal on purpose so "largest" is
    // unambiguous. Left area = 2.5*0.8 = 2.0; right area = 3.5*0.8 = 2.8.
    const cell = [{ x: 0.5, y: 7.2 }, { x: 9.5, y: 7.2 }, { x: 9.5, y: 8 }, { x: 0.5, y: 8 }];
    const clipped = clipPolygonToBoard(cell, NOTCHED_BOARD, { x: 7.75, y: 7.6 }); // a ref point inside the kept (right) piece
    expect(polygonArea(clipped)).toBeCloseTo(2.8, 9);
    expect(isSimplePolygon(clipped)).toBe(true);
    for (const p of clipped) expect(p.x).toBeGreaterThanOrEqual(6 - 1e-9); // confirms it's the RIGHT piece, not the left
  });
});

describe('roundPolygonCorners', () => {
  it('radius=0 (or omitted) returns the polygon unchanged', () => {
    expect(roundPolygonCorners(SQUARE, 0)).toBe(SQUARE);
  });

  it('a square corner of known radius: the two tangent points sit exactly `radius` back from the vertex along each edge', () => {
    const rounded = roundPolygonCorners(SQUARE, 1, 4);
    // vertex (0,0)'s own incident edges run to (0,10) [via wraparound from (0,10)->(0,0)] and (10,0).
    // Its own tangent points should be at (1,0) [back along the x-edge] and (0,1) [back along the y-edge].
    const near = (pt, x, y) => Math.abs(pt.x - x) < 1e-6 && Math.abs(pt.y - y) < 1e-6;
    expect(rounded.some((p) => near(p, 1, 0))).toBe(true);
    expect(rounded.some((p) => near(p, 0, 1))).toBe(true);
    // the sharp vertex itself (0,0) must be GONE -- that's the whole point of rounding it
    expect(rounded.some((p) => near(p, 0, 0))).toBe(false);
  });

  it('every rounded corner stays a simple (non-self-intersecting) polygon', () => {
    expect(isSimplePolygon(roundPolygonCorners(SQUARE, 1, 4))).toBe(true);
    expect(isSimplePolygon(roundPolygonCorners(SQUARE, 4.9, 6))).toBe(true); // radius close to the clamp ceiling (0.45*10=4.5)
  });

  it('rounding only ever REMOVES material (area strictly decreases, never increases)', () => {
    const base = polygonArea(SQUARE);
    const rounded = polygonArea(roundPolygonCorners(SQUARE, 2, 4));
    expect(rounded).toBeLessThan(base);
    expect(rounded).toBeGreaterThan(base * 0.9); // "slightly" -- a small radius relative to the shape shouldn't eat much
  });

  it('a requested radius larger than the shape clamps (via the tangent-length cap) instead of corrupting the polygon', () => {
    const tiny = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const rounded = roundPolygonCorners(tiny, 10, 4); // a radius 10x the shape's own size
    expect(isSimplePolygon(rounded)).toBe(true);
    expect(polygonArea(rounded)).toBeGreaterThan(0);
  });

  it('MUTATION CHECK: without the tangent clamp, an oversized radius on a small shape DOES self-intersect', () => {
    // reproduce roundPolygonCorners with the `maxTangent` clamp disabled, to prove the clamp in the
    // real implementation is load-bearing (not a no-op) -- same discipline as the mitre-clip tests.
    function roundUnclamped(poly, radius, segments = 4) {
      const n = poly.length;
      const out = [];
      for (let i = 0; i < n; i++) {
        const v = poly[i], prev = poly[(i - 1 + n) % n], next = poly[(i + 1) % n];
        const u1x = prev.x - v.x, u1y = prev.y - v.y, len1 = Math.hypot(u1x, u1y);
        const u2x = next.x - v.x, u2y = next.y - v.y, len2 = Math.hypot(u2x, u2y);
        const n1x = u1x / len1, n1y = u1y / len1, n2x = u2x / len2, n2y = u2y / len2;
        const half = Math.acos(Math.max(-1, Math.min(1, n1x * n2x + n1y * n2y))) / 2;
        const tangent = radius / Math.tan(half); // NO clamp here -- the bug this test proves is fixed
        const t1 = { x: v.x + n1x * tangent, y: v.y + n1y * tangent };
        const t2 = { x: v.x + n2x * tangent, y: v.y + n2y * tangent };
        out.push(t1, t2); // the arc itself doesn't matter for this check -- the tangent points alone already cross
      }
      return out;
    }
    const tiny = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(isSimplePolygon(roundUnclamped(tiny, 10, 4))).toBe(false);
  });

  it('an already-rounded (near-straight) vertex is left alone -- no spurious points added', () => {
    // three colinear points: the middle one has a ~180deg interior angle, not a real corner.
    const straightish = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const rounded = roundPolygonCorners(straightish, 1, 4);
    expect(rounded.some((p) => Math.abs(p.x - 5) < 1e-6 && Math.abs(p.y - 0) < 1e-6)).toBe(true);
  });
});

describe('roundPolygonCorners acuteSetbackOfRightAngle (fieldstone, 2026-10-09)', () => {
  // the setback: how far the rounded outline sits back from the sharp vertex (its nearest point to it)
  const setback = (poly, v) => Math.min(...poly.map((p) => Math.hypot(p.x - v.x, p.y - v.y)));
  const r = 1, rightAngle = r * (Math.SQRT2 - 1);
  // a 45 deg corner at the origin (long edges, so the 45%-of-edge clamp stays out of it)
  const WEDGE = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }];
  it('an acute corner is cut back no further than a right angle of the same radius', () => {
    expect(setback(roundPolygonCorners(WEDGE, r, 16), WEDGE[0])).toBeCloseTo(r * (1 / Math.sin(Math.PI / 8) - 1), 2); // 1.61: the full fillet
    expect(setback(roundPolygonCorners(WEDGE, r, 16, { acuteSetbackOfRightAngle: true }), WEDGE[0])).toBeCloseTo(rightAngle, 2);
  });
  it('a right angle and blunter corners are rounded as before', () => {
    expect(roundPolygonCorners(SQUARE, r, 4, { acuteSetbackOfRightAngle: true })).toEqual(roundPolygonCorners(SQUARE, r, 4));
    const hexagon = Array.from({ length: 6 }, (_, k) => ({ x: 10 * Math.cos((k * Math.PI) / 3), y: 10 * Math.sin((k * Math.PI) / 3) })); // 120 deg corners
    expect(roundPolygonCorners(hexagon, r, 4, { acuteSetbackOfRightAngle: true })).toEqual(roundPolygonCorners(hexagon, r, 4));
  });
});
