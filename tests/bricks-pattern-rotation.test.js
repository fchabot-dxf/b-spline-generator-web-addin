/**
 * T86 item 29 (advisor: rotation is an angle every wall pattern gets, not a pattern; "running bond at 45" = stretcher +
 * rotation 45): generateBricks' `rotationDeg` turns the wall pattern about the outline's centre (fill-shape.js
 * rotatedFill). On a 7x9 wall: every whole brick's long axis lies at the angle, the piece count stays the same order
 * as at 0, every brick stays inside the board, and 0 / absent is byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { generateBricks, ENGINE_OPTIONS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { bricksAlongPath } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/along-path.js';
import { polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { brickSetById, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const W = 7, H = 9;
const board = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const SET = brickSetById(1);
const lay = (extra) => generateBricks({ boardOutline: board, set: SET, suppression: 0, clumping: 0, seed: 3, zones: [{ pattern: 'stretcher' }], ...extra }).bricks;
const area = (p) => Math.abs(signedArea(p));
/** the long axis of a whole brick (a 4-corner piece the size of a full brick), in degrees mod 180 */
function wholeBrickAxes(bricks, scale = 1) {
  const s = scaledSet(SET, scale), full = s.brickLengthIn * s.brickHeightIn;
  return bricks.filter((b) => b.polygon.length === 4 && Math.abs(area(b.polygon) - full) < 0.02 * full).map((b) => {
    let best = null;
    for (let i = 0; i < 4; i++) {
      const a = b.polygon[i], c = b.polygon[(i + 1) % 4], len = Math.hypot(c.x - a.x, c.y - a.y);
      if (!best || len > best.len) best = { len, deg: ((Math.atan2(c.y - a.y, c.x - a.x) * 180) / Math.PI + 360) % 180 };
    }
    return best.deg;
  });
}
const off = (deg, want) => Math.min(Math.abs(deg - want), 180 - Math.abs(deg - want));

describe('pattern rotation (T86 item 29)', () => {
  it('is an option the engine honours', () => expect(ENGINE_OPTIONS).toContain('rotationDeg'));
  it('0 and absent lay exactly what they did', () => {
    const plain = lay({});
    expect(lay({ rotationDeg: 0 }).map((b) => b.polygon)).toEqual(plain.map((b) => b.polygon));
    expect(wholeBrickAxes(plain).every((d) => off(d, 0) < 0.01)).toBe(true);
  });
  for (const deg of [45, 90]) {
    it(`running bond at ${deg}: every whole brick lies at ${deg} deg, the same order of pieces, all inside the board`, () => {
      const base = lay({}), turned = lay({ rotationDeg: deg });
      const axes = wholeBrickAxes(turned);
      expect(axes.length).toBeGreaterThan(20);
      expect(Math.max(...axes.map((d) => off(d, deg)))).toBeLessThan(0.01);
      expect(turned.length / base.length).toBeGreaterThan(0.8);
      expect(turned.length / base.length).toBeLessThan(1.25);
      for (const b of turned) expect(area(b.polygon) - area(polygonIntersection(b.polygon, board))).toBeLessThan(1e-6);
    });
  }
  it('herringbone turns too (a tile2d layout), inside the board', () => {
    const set = { ...SET, layout: 'herringbone' };
    const a = generateBricks({ boardOutline: board, set, suppression: 0, clumping: 0, seed: 3 }).bricks;
    const b = generateBricks({ boardOutline: board, set, suppression: 0, clumping: 0, seed: 3, rotationDeg: 45 }).bricks;
    expect(b.length).toBeGreaterThan(0.8 * a.length);
    expect(b.map((x) => x.polygon)).not.toEqual(a.map((x) => x.polygon));
    for (const x of b) expect(area(x.polygon) - area(polygonIntersection(x.polygon, board))).toBeLessThan(1e-6);
  });
  it('exclusions turn with it: no rotated wall brick under a brush stroke', () => {
    const stroke = bricksAlongPath([{ x: 0.5, y: 4.5 }, { x: 6.5, y: 4.6 }], { set: SET, seed: 5 }).bricks;
    const r = lay({ rotationDeg: 45, exclusions: stroke.map((s) => ({ polygon: s.polygon })) });
    let under = 0;
    for (const b of r) for (const s of stroke) under += area(polygonIntersection(b.polygon, s.polygon));
    expect(under).toBeLessThan(1e-6);
  });
});
