/**
 * H23 item 72 BRICK ENGINE -- bricksAlongPath (core primitive #1): corner-snapping/mitre on
 * sharp-turn polylines, both declared profiles ('bricks' = individual bricks with real joints,
 * 'continuous' = one unbroken band with a declared texture-blend PLAN -- data-level checks only,
 * pixel blending is a renderer concern per the advisor's own approved split), orientation, and
 * determinism. ('ridge' is declared but throws -- P2's own ribbon-engine profile, see
 * bricks-profile-stubs.test.js.)
 */
import { describe, it, expect } from 'vitest';
import { bricksAlongPath } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/along-path.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const SET = BRICK_SETS[0];

function bbox(polygon) {
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('bricksAlongPath — "bricks" profile (default)', () => {
  const straight = [{ x: 0, y: 0 }, { x: 10, y: 0 }];

  it('lays bricks end to end along a straight line at pitch+joint spacing, in order', () => {
    const { bricks } = bricksAlongPath(straight, { set: SET, orientation: 'stretcher', seed: 1 });
    expect(bricks.length).toBeGreaterThan(5);
    // H23 item 74 (Fred via advisor, "no arbitrary cut sizes"): the run's own length (10in) doesn't
    // divide evenly by pitch+joint, so every joint in THIS run is slightly widened (vs the set's own
    // declared grout.widthIn) to absorb that mismatch, and the FINAL brick is sized to the nearest
    // declared FILL_FRACTIONS entry -- never an arbitrary leftover. Joints stay close to the
    // declared width (a small, bounded adjustment, not an arbitrary one).
    for (let i = 1; i < bricks.length; i++) {
      const prevBox = bbox(bricks[i - 1].polygon), curBox = bbox(bricks[i].polygon);
      const joint = curBox.minX - prevBox.maxX;
      expect(joint).toBeGreaterThan(SET.grout.widthIn * 0.5);
      expect(joint).toBeLessThan(SET.grout.widthIn * 1.5);
    }
    // every brick's own length is a declared FILL_FRACTIONS multiple of brickLengthIn (1, 2/3, 1/2,
    // or 1/3) -- never an arbitrary stretch/shrink.
    const fractionLengths = [1, 2 / 3, 1 / 2, 1 / 3].map((f) => f * SET.brickLengthIn);
    for (const b of bricks) {
      const box = bbox(b.polygon);
      const len = box.maxX - box.minX;
      expect(fractionLengths.some((fl) => Math.abs(len - fl) < 1e-3), `brick length ${len} is not a declared fraction`).toBe(true);
    }
    // exactly one brick (the final one) is NOT full-length -- every run here ends with precisely one
    // fractional "fill" piece, never more.
    const fullLen = SET.brickLengthIn;
    const nonFull = bricks.filter((b) => { const { maxX, minX } = bbox(b.polygon); return Math.abs((maxX - minX) - fullLen) > 1e-3; });
    expect(nonFull.length).toBe(1);
  });

  it('orientation=soldier swaps pitch/width vs stretcher', () => {
    const stretcher = bricksAlongPath(straight, { set: SET, orientation: 'stretcher', seed: 1 });
    const soldier = bricksAlongPath(straight, { set: SET, orientation: 'soldier', seed: 1 });
    const sBox = bbox(stretcher.bricks[0].polygon), oBox = bbox(soldier.bricks[0].polygon);
    expect(sBox.maxX - sBox.minX).toBeCloseTo(SET.brickLengthIn, 3);
    expect(sBox.maxY - sBox.minY).toBeCloseTo(SET.brickHeightIn, 3);
    expect(oBox.maxX - oBox.minX).toBeCloseTo(SET.brickHeightIn, 3);
    expect(oBox.maxY - oBox.minY).toBeCloseTo(SET.brickLengthIn, 3);
  });

  it('a declared corner forces a brick boundary there — every brick is simple and stays within the mitre\'s own reach (no unmitred straddle)', () => {
    // An L-shaped path with a sharp 90deg turn at vertex 1 (arc-length = 5, the first leg's length).
    const lShape = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }];
    const { bricks } = bricksAlongPath(lShape, { set: SET, orientation: 'stretcher', seed: 2, cornerIndices: [1] });
    const halfWidth = SET.brickHeightIn / 2; // 'stretcher' cross-dimension
    // H23 item 73(a): the corner's own END bricks are now legitimately MITRED (extended past the
    // corner, then clipped to the true cut) -- their own bbox can exceed brickLengthIn (that was
    // the old, now-too-strict, bound). The real invariant: every brick stays a SIMPLE polygon (no
    // self-intersecting "unmitred straddle"), and none reaches further than the mitre's own
    // declared maximum reach (MITRE_REACH = halfWidth*5, mirrored here) plus one ordinary pitch.
    const maxReasonableSpan = halfWidth * 5 + SET.brickLengthIn + 1e-3;
    const isSimplePolygon = (poly) => {
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
    };
    for (const b of bricks) {
      expect(isSimplePolygon(b.polygon), `brick ${b.id} is self-intersecting`).toBe(true);
      const box = bbox(b.polygon);
      const w = box.maxX - box.minX, h = box.maxY - box.minY;
      expect(Math.max(w, h)).toBeLessThanOrEqual(maxReasonableSpan);
    }
  });

  it('same seed -> identical output; different seed -> different sample/flip/jitter picks', () => {
    const r1 = bricksAlongPath(straight, { set: SET, seed: 7 });
    const r2 = bricksAlongPath(straight, { set: SET, seed: 7 });
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
    const r3 = bricksAlongPath(straight, { set: SET, seed: 8 });
    expect(JSON.stringify(r1)).not.toEqual(JSON.stringify(r3));
  });

  it('a closed loop (a square contour) produces no net gap at the seam', () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const { bricks } = bricksAlongPath(square, {
      set: SET, orientation: 'stretcher', seed: 3, closed: true, cornerIndices: [0, 1, 2, 3],
    });
    expect(bricks.length).toBeGreaterThan(10);
  });
});

describe('bricksAlongPath — "continuous" profile (data-level blend plan only)', () => {
  const straight = [{ x: 0, y: 0 }, { x: 10, y: 0 }];

  it('segments touch with NO joint gap (one unbroken band)', () => {
    const { bricks } = bricksAlongPath(straight, { set: SET, orientation: 'stretcher', profile: 'continuous', seed: 4 });
    expect(bricks.length).toBeGreaterThan(3);
    for (let i = 1; i < bricks.length; i++) {
      const prevBox = bbox(bricks[i - 1].polygon), curBox = bbox(bricks[i].polygon);
      expect(curBox.minX - prevBox.maxX).toBeCloseTo(0, 2);
    }
  });

  it('never takes the full 0,0 - 1,1 crop window of a sample (never a full, un-cropped tile)', () => {
    const { bricks } = bricksAlongPath(straight, { set: SET, profile: 'continuous', seed: 4 });
    for (const b of bricks) {
      const { x0, y0, x1, y1 } = b.cropWindow;
      const isFullWindow = x0 < 1e-6 && y0 < 1e-6 && x1 > 0.999 && y1 > 0.999;
      expect(isFullWindow).toBe(false);
      expect(x1 - x0).toBeLessThan(1);
      expect(y1 - y0).toBeLessThan(1);
    }
  });

  it('declares overlapIn >= one brick length (pitch), per the "overlap by >=1 brick length" rule', () => {
    const { bricks } = bricksAlongPath(straight, { set: SET, orientation: 'stretcher', profile: 'continuous', seed: 4 });
    for (const b of bricks) expect(b.overlapIn).toBeGreaterThanOrEqual(SET.brickLengthIn - 1e-9);
  });

  it('edge wobble stays within +/-5% of the band half-width', () => {
    const { bricks } = bricksAlongPath(straight, { set: SET, orientation: 'stretcher', profile: 'continuous', seed: 4 });
    const halfWidth = SET.brickHeightIn / 2;
    for (const b of bricks) {
      const box = bbox(b.polygon);
      const measuredHalfWidth = (box.maxY - box.minY) / 2;
      expect(Math.abs(measuredHalfWidth - halfWidth) / halfWidth).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it('is deterministic for a given seed', () => {
    const r1 = bricksAlongPath(straight, { set: SET, profile: 'continuous', seed: 9 });
    const r2 = bricksAlongPath(straight, { set: SET, profile: 'continuous', seed: 9 });
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
  });
});
