/**
 * H23 item 72 BRICK ENGINE -- engine.js: generateBricks (frame + fill composition),
 * buildSpatialIndex (vs a brute-force scan), and sampleHeight (the relief-height clamp: Fred's
 * rule, "never more than reliefMaxIn", every source of height variation funnels through here).
 */
import { describe, it, expect } from 'vitest';
import { generateBricks, buildSpatialIndex, sampleHeight } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const SET = BRICK_SETS[0];
const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const rectPrimitives = (w, h) => {
  const pts = rect(w, h);
  return pts.map((p, i) => ({ type: 'line', p0: p, p1: pts[(i + 1) % pts.length] }));
};

describe('generateBricks', () => {
  it('with no frame, fills the whole board', () => {
    const board = rect(9, 12);
    const result = generateBricks({ boardOutline: board, set: SET, seed: 1 });
    expect(result.bricks.length).toBeGreaterThan(0);
    expect(result.frameBricks).toEqual([]);
  });

  it('with a frame, shrinks the fill to the frame\'s own innerPath', () => {
    const board = rect(9, 12);
    const noFrame = generateBricks({ boardOutline: board, set: SET, seed: 1 });
    const framed = generateBricks({
      boardOutline: board, set: SET, seed: 1,
      frame: { primitives: rectPrimitives(9, 12), bands: FRAME_PRESETS.single_soldier },
    });
    expect(framed.frameBricks.length).toBeGreaterThan(0);
    expect(framed.bricks.length).toBeLessThan(noFrame.bricks.length);
  });

  it('threads zones through to the fill', () => {
    const board = rect(9, 12);
    const plain = generateBricks({ boardOutline: board, set: SET, seed: 1 });
    const zoned = generateBricks({
      boardOutline: board, set: SET, seed: 1,
      zones: [{ bond: 'soldier', rows: 3 }, { bond: 'running' }],
    });
    expect(JSON.stringify(plain.bricks)).not.toEqual(JSON.stringify(zoned.bricks));
  });

  // F35 item 12 follow-up (Fred): the Wall picker's own 'none' pattern (editor-brick-tool.js's
  // applyWallPattern sets this flag) -- Wall produces zero bricks, Frame is untouched.
  it('skipWallFill produces zero wall bricks but leaves a frame\'s own bricks untouched', () => {
    const board = rect(9, 12);
    const withWall = generateBricks({
      boardOutline: board, set: SET, seed: 1,
      frame: { primitives: rectPrimitives(9, 12), bands: FRAME_PRESETS.single_soldier },
    });
    const noWall = generateBricks({
      boardOutline: board, set: SET, seed: 1, skipWallFill: true,
      frame: { primitives: rectPrimitives(9, 12), bands: FRAME_PRESETS.single_soldier },
    });
    expect(withWall.bricks.length).toBeGreaterThan(0);
    expect(noWall.bricks).toEqual([]);
    expect(noWall.frameBricks.length).toBe(withWall.frameBricks.length);
  });

  // F35 item 12 follow-up: FRAME_PRESETS.none (an empty band list) is the Frame band preset's own
  // OFF switch -- generateBricks' own existing `bands.length` check (written for the omitted-frame
  // case) already handles it with no special code: zero frame bricks, Wall fills to the board's own
  // true outer contour (the SAME result as passing no frame at all).
  it('FRAME_PRESETS.none (empty bands) behaves exactly like no frame at all', () => {
    const board = rect(9, 12);
    const noFrameAtAll = generateBricks({ boardOutline: board, set: SET, seed: 1 });
    const noneFrame = generateBricks({
      boardOutline: board, set: SET, seed: 1,
      frame: { primitives: rectPrimitives(9, 12), bands: FRAME_PRESETS.none },
    });
    expect(noneFrame.frameBricks).toEqual([]);
    expect(noneFrame.bricks.length).toBe(noFrameAtAll.bricks.length);
  });
});

describe('buildSpatialIndex', () => {
  it('query() returns the same candidate set a brute-force scan would consider (a superset containing the true hit)', () => {
    const board = rect(9, 12);
    const { bricks } = generateBricks({ boardOutline: board, set: SET, seed: 1 });
    const index = buildSpatialIndex(bricks, 1);
    // sample a grid of points; for every point that brute-force finds inside SOME brick, the
    // indexed query's own candidate list must include that same brick.
    for (let x = 0.5; x < 9; x += 1.3) {
      for (let y = 0.5; y < 12; y += 1.7) {
        const bruteHit = bricks.find((b) => pointInPoly(x, y, b.polygon));
        if (!bruteHit) continue;
        const candidates = index.query(x, y);
        expect(candidates).toContain(bruteHit);
      }
    }
  });
});

function pointInPoly(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y, xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

describe('sampleHeight', () => {
  it('returns jointHeightIn when the point falls in a joint (not inside any brick)', () => {
    const board = rect(9, 12);
    const result = generateBricks({ boardOutline: board, set: SET, seed: 1 });
    // the very first joint gap is at x = brickLengthIn (just past the first brick), y in the first course
    const h = sampleHeight(result, null, SET.brickLengthIn + SET.grout.widthIn / 2, 0.1, SET, 0);
    expect(h).toBe(0);
  });

  it('never exceeds reliefMaxIn, even with heightJitterIn pushing a brick over it', () => {
    const board = rect(9, 12);
    const extremeSet = { ...SET, reliefIn: 0.24, reliefMaxIn: 0.25, heightJitterIn: 0.5 }; // jitter alone can exceed the budget
    const result = generateBricks({ boardOutline: board, set: extremeSet, seed: 1 });
    const index = buildSpatialIndex([...result.bricks, ...result.frameBricks], 1);
    for (const b of result.bricks) {
      const c = b.polygon.reduce((s, p) => ({ x: s.x + p.x / b.polygon.length, y: s.y + p.y / b.polygon.length }), { x: 0, y: 0 });
      const h = sampleHeight(result, index, c.x, c.y, extremeSet);
      expect(h).toBeLessThanOrEqual(extremeSet.reliefMaxIn + 1e-9);
    }
  });

  it('gives the same answer with or without a spatial index', () => {
    const board = rect(9, 12);
    const result = generateBricks({ boardOutline: board, set: SET, seed: 1 });
    const index = buildSpatialIndex([...result.bricks, ...result.frameBricks], 1);
    for (const [x, y] of [[1, 1], [4.5, 6], [8, 11]]) {
      expect(sampleHeight(result, index, x, y, SET)).toBeCloseTo(sampleHeight(result, null, x, y, SET), 9);
    }
  });
});
