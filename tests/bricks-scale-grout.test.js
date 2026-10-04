/**
 * H23 item 72 BRICK ENGINE -- two declared-data refinements, both advisor turn-504+:
 *  - grout: {widthIn, depthIn, profile} replaces the old flat jointWidthIn -- ONE shared group
 *    used by every Masonry layout/band/brush (Fred: "every Masonry set and layout has a GROUT
 *    parameter"). widthIn is what the layout itself reads for the joint gap; depthIn/profile are
 *    the height-map adapter's own concern, not read by core/bricks/ at all (declared here only).
 *  - opts.scale: a uniform multiplier on the active set's own brickLengthIn/brickHeightIn, taken
 *    by all three primitives (and generateBricks), default 1. Grout width is NEVER scaled (Fred:
 *    "grout width unaffected").
 */
import { describe, it, expect } from 'vitest';
import { bricksAlongPath } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/along-path.js';
import { bricksFillShape } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/fill-shape.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const SET = BRICK_SETS[0];
const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

function bbox(poly) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

describe('grout (declared data)', () => {
  it('every non-empty BRICK_SETS entry declares grout.widthIn/depthIn/profile, depthIn within the relief budget', () => {
    for (const set of BRICK_SETS) {
      if (!set.samples.length) continue;
      expect(set.grout).toBeTruthy();
      expect(set.grout.widthIn).toBeGreaterThan(0);
      expect(set.grout.depthIn).toBeGreaterThan(0);
      expect(set.grout.depthIn).toBeLessThanOrEqual(set.reliefIn);
      expect(set.grout.profile).toBe('recessed'); // no raised-bead profile declared -- Fred didn't pick it
    }
  });
});

describe('opts.scale', () => {
  it('scaledSet(set, 2) doubles brickLengthIn/brickHeightIn, keeps the aspect, leaves grout untouched', () => {
    const scaled = scaledSet(SET, 2);
    expect(scaled.brickLengthIn).toBeCloseTo(SET.brickLengthIn * 2, 9);
    expect(scaled.brickHeightIn).toBeCloseTo(SET.brickHeightIn * 2, 9);
    expect(scaled.brickLengthIn / scaled.brickHeightIn).toBeCloseTo(SET.brickLengthIn / SET.brickHeightIn, 9);
    expect(scaled.grout).toEqual(SET.grout); // same object -- not scaled, not even copied differently
  });

  it('scaledSet(set) / scaledSet(set, 1) returns the SAME object (no-op, no allocation)', () => {
    expect(scaledSet(SET)).toBe(SET);
    expect(scaledSet(SET, 1)).toBe(SET);
  });

  it('bricksAlongPath: scale=2 doubles brick dimensions; the joint gap still uses the SAME declared (unscaled) grout width as its nominal', () => {
    const straight = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const base = bricksAlongPath(straight, { set: SET, orientation: 'stretcher', seed: 1 });
    const doubled = bricksAlongPath(straight, { set: SET, orientation: 'stretcher', seed: 1, scale: 2 });
    const b0 = bbox(base.bricks[0].polygon), d0 = bbox(doubled.bricks[0].polygon);
    expect(d0.w).toBeCloseTo(b0.w * 2, 6);
    expect(d0.h).toBeCloseTo(b0.h * 2, 6);
    // H23 item 74 (Fred via advisor, "no arbitrary cut sizes"): a run's own joints are slightly
    // widened/narrowed from the declared grout.widthIn to absorb that run's own fractional-piece
    // mismatch -- by how much depends on how the run's own length divides by the (scaled) pitch, so
    // base and doubled no longer land on EXACTLY the same adjusted value. What stays true regardless
    // of scale: grout.widthIn itself is never scaled (used as-is, the declared nominal both runs
    // adjust AROUND), so every observed joint in either run stays within a bounded band of it.
    const b1 = base.bricks[1], d1 = doubled.bricks[1];
    const baseJoint = Math.min(...b1.polygon.map((p) => p.x)) - Math.max(...base.bricks[0].polygon.map((p) => p.x));
    const doubledJoint = Math.min(...d1.polygon.map((p) => p.x)) - Math.max(...doubled.bricks[0].polygon.map((p) => p.x));
    for (const joint of [baseJoint, doubledJoint]) {
      expect(joint).toBeGreaterThan(SET.grout.widthIn * 0.5);
      expect(joint).toBeLessThan(SET.grout.widthIn * 1.5);
    }
  });

  it('bricksFillShape: scale=2 doubles every brick\'s own footprint, same joint gap', () => {
    const board = rect(9, 12);
    const base = bricksFillShape(board, null, { set: SET, seed: 1 });
    const doubled = bricksFillShape(board, null, { set: SET, seed: 1, scale: 2 });
    const b0 = bbox(base.bricks[0].polygon), d0 = bbox(doubled.bricks[0].polygon);
    expect(d0.w).toBeCloseTo(b0.w * 2, 6);
    expect(d0.h).toBeCloseTo(b0.h * 2, 6);
    // fewer, bigger bricks cover the same board
    expect(doubled.bricks.length).toBeLessThan(base.bricks.length);
  });

  it('bricksContourBands: scale=2 doubles the frame band\'s own natural row width (same declared widthIn snaps to fewer, bigger rows)', () => {
    const square = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    const primitives = square.map((p, i) => ({ type: 'line', p0: p, p1: square[(i + 1) % square.length] }));
    const base = bricksContourBands(primitives, FRAME_PRESETS.single_soldier, { set: SET, seed: 5 });
    const doubled = bricksContourBands(primitives, FRAME_PRESETS.single_soldier, { set: SET, seed: 5, scale: 2 });
    // H23 item 76 (advisor review): every run's OWN first/last piece is now deliberately corner-fit
    // (planCornerRun, from the declared fraction set) rather than a plain scaled whole piece -- so
    // `bricks[0]` (what this test used to pick) no longer has a simple *2 relationship to its own
    // scaled counterpart (the two scales can pick a DIFFERENT best-fit corner fraction). Index 10 is
    // safely past either run's own corner-affected pieces (100+ pieces per side at the base scale,
    // 50+ at 2x) -- a genuinely plain, scaled whole piece, which is what this test means to check.
    const b0 = bbox(base.bricks.filter((b) => !b.id.includes('corner'))[10].polygon);
    const d0 = bbox(doubled.bricks.filter((b) => !b.id.includes('corner'))[10].polygon);
    expect(Math.max(d0.w, d0.h)).toBeCloseTo(Math.max(b0.w, b0.h) * 2, 2);
  });
});
