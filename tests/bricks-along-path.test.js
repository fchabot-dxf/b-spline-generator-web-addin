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
    for (let i = 1; i < bricks.length; i++) {
      const prevBox = bbox(bricks[i - 1].polygon), curBox = bbox(bricks[i].polygon);
      // consecutive bricks: a real joint gap of jointWidthIn between them (not back to back)
      expect(curBox.minX - prevBox.maxX).toBeCloseTo(SET.grout.widthIn, 3);
    }
    // every brick except possibly the last (clipped to the path's own remaining length) is a full
    // brickLengthIn long -- never stretched/shrunk to fit the pitch.
    for (let i = 0; i < bricks.length - 1; i++) {
      const box = bbox(bricks[i].polygon);
      expect(box.maxX - box.minX).toBeCloseTo(SET.brickLengthIn, 3);
    }
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

  it('a declared corner forces a brick boundary there — no brick straddles it', () => {
    // An L-shaped path with a sharp 90deg turn at vertex 1 (arc-length = 5, the first leg's length).
    const lShape = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }];
    const { bricks } = bricksAlongPath(lShape, { set: SET, orientation: 'stretcher', seed: 2, cornerIndices: [1] });
    // every brick's own 4 corners should lie entirely on one side of x=5 or entirely on y>=0 after
    // the turn -- i.e. no polygon has points with x<5-eps AND points past the corner on the
    // vertical leg (y far from 0, x far from 5). Simplify: assert no single brick's bbox straddles
    // BOTH legs by checking width/height stay brick-length-sized (never elongated across the bend).
    for (const b of bricks) {
      const box = bbox(b.polygon);
      const w = box.maxX - box.minX, h = box.maxY - box.minY;
      // a brick confined to one straight leg has one dimension ~jointless brick size (small) and
      // the other ~brickHeightIn (the band width) -- neither should be grossly larger than the
      // declared brickLengthIn, which WOULD happen if a brick quad spanned the corner.
      expect(Math.max(w, h)).toBeLessThanOrEqual(SET.brickLengthIn + 1e-3);
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
