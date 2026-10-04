/**
 * H23 item 72 BRICK ENGINE -- engine.js: generateBricks (frame + fill composition),
 * buildSpatialIndex (vs a brute-force scan), and sampleHeight (the relief-height clamp: Fred's
 * rule, "never more than reliefMaxIn", every source of height variation funnels through here).
 */
import { describe, it, expect } from 'vitest';
import { generateBricks, buildSpatialIndex, sampleHeight } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

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

  // F35 item 16 (Fred: "I'd rather they all have the same size"): Frame bands no longer carry
  // their own `frame.set` brick-length override (main/brick-panel.js's now-retired
  // resolveFrameBrickSet) -- they must pick up the SAME top-level `scale` as Wall, via
  // generateBricks' own `frame.set || set` fallback, with NO frame.set provided at all (exactly
  // what every real caller now sends).
  it('with no frame.set override, Frame bands scale IDENTICALLY to Wall via the shared top-level scale', () => {
    const board = rect(9, 12);
    const frame = { primitives: rectPrimitives(9, 12), bands: FRAME_PRESETS.single_soldier };
    const base = generateBricks({ boardOutline: board, set: SET, seed: 1, frame });
    const doubled = generateBricks({ boardOutline: board, set: SET, seed: 1, frame, scale: 2 });

    expect(doubled.frameBricks.length).toBeGreaterThan(0);
    const bbox = (poly) => ({
      w: Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x)),
      h: Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y)),
    });
    // Same precedent as bricks-scale-grout.test.js's own contour-bands check: the first few pieces
    // of a long soldier run can be corner-fit, not a plain scaled whole piece -- pick one safely
    // past that (both runs have 10+ plain pieces per side at this board size).
    const b0 = bbox(base.frameBricks.filter((b) => !b.id.includes('corner'))[5].polygon);
    const d0 = bbox(doubled.frameBricks.filter((b) => !b.id.includes('corner'))[5].polygon);
    expect(Math.max(d0.w, d0.h)).toBeCloseTo(Math.max(b0.w, b0.h) * 2, 1);

    // And Wall's own fill scaled by the exact same factor, from the exact same `scale` -- proving
    // Wall and Frame are reading ONE shared value, not two independently-derived ones.
    const wb0 = bbox(base.bricks[0].polygon), wd0 = bbox(doubled.bricks[0].polygon);
    expect(wd0.w).toBeCloseTo(wb0.w * 2, 6);
    expect(wd0.h).toBeCloseTo(wb0.h * 2, 6);
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
  // OFF switch -- zero frame bricks, Wall fills to `frame.primitives`' own true outer contour. On
  // a RECTANGULAR fixture (this test's own `rect`/`rectPrimitives`, both the same shape) that is
  // indistinguishable from "no frame at all" -- see the next test for the case where it matters.
  it('FRAME_PRESETS.none (empty bands) behaves exactly like no frame at all, on a rectangular board', () => {
    const board = rect(9, 12);
    const noFrameAtAll = generateBricks({ boardOutline: board, set: SET, seed: 1 });
    const noneFrame = generateBricks({
      boardOutline: board, set: SET, seed: 1,
      frame: { primitives: rectPrimitives(9, 12), bands: FRAME_PRESETS.none },
    });
    expect(noneFrame.frameBricks).toEqual([]);
    expect(noneFrame.bricks.length).toBe(noFrameAtAll.bricks.length);
  });

  // T86 item 14 (regression): the rectangular fixture above can't tell `frame.primitives` apart
  // from `boardOutline` -- they're the same shape. Here they genuinely differ (a notched
  // non-rectangular frame.primitives, well inside a much bigger bounding boardOutline), which is
  // exactly the real-app shape (editor-brick-tool.js's own `boardPolygon` is ALWAYS a plain
  // rectangle; `frame.primitives`, when a template resolves, almost never is). Confirmed this
  // FAILS against the pre-fix engine.js (git stash): every single Wall brick landed inside the
  // oversized rectangle instead, 8 of them with a centroid outside the notched true contour.
  it('with bands: [] (or omitted) and a NON-rectangular frame.primitives, Wall still conforms to the true contour, not the bigger boardOutline', () => {
    // a deep triangular notch bitten out of the right edge (y 4..8, dipping in to x=4 at y=6) --
    // any brick filling the bigger rectangular board instead of this contour will have centroids
    // landing either past x=9 (the contour's own max x) or inside the bitten-out triangle itself.
    const withNotch = [
      { x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 4 }, { x: 4, y: 6 }, { x: 9, y: 8 }, { x: 9, y: 12 }, { x: 0, y: 12 },
    ];
    const toPrimitives = (pts) => pts.map((p, i) => ({ type: 'line', p0: p, p1: pts[(i + 1) % pts.length] }));
    const biggerBoard = [{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 12 }, { x: 0, y: 12 }]; // wider than the notched contour

    for (const bands of [FRAME_PRESETS.none, undefined]) {
      const result = generateBricks({
        boardOutline: biggerBoard, set: SET, seed: 1,
        frame: { primitives: toPrimitives(withNotch), bands },
      });
      expect(result.frameBricks).toEqual([]);
      expect(result.bricks.length).toBeGreaterThan(0);
      for (const b of result.bricks) {
        const cx = b.polygon.reduce((s, p) => s + p.x, 0) / b.polygon.length;
        const cy = b.polygon.reduce((s, p) => s + p.y, 0) / b.polygon.length;
        expect(pointInPolygon(cx, cy, withNotch)).toBe(true);
      }
    }
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

// T86 item 19's own amendment (advisor): a UI control for an option the engine ignores must not
// show (ENGINE_OPTIONS' own header, turn 199) -- the inverse is just as real: an option the engine
// DOES read but forgot to declare leaves its own control permanently hidden, exactly what nearly
// happened with `largeStones` (already correctly listed by the time this landed -- CONFIRMED
// against both lane-b and origin/main directly, not assumed -- but the class of mistake is real and
// worth a standing guard, not a one-off check). Scans engine.js's OWN source for every `input.<key>`
// property read (plus its destructured params), rather than hand-maintaining a parallel list that
// would just as easily drift -- self-updating as the function's own reads change.
describe('ENGINE_OPTIONS completeness (T86 item 19 amendment)', () => {
  it('every input.<key> engine.js actually reads is declared in ENGINE_OPTIONS', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js', 'utf8');
    const { ENGINE_OPTIONS } = await import('../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js');
    const fnBody = src.slice(src.indexOf('export function generateBricks'), src.indexOf('export function', src.indexOf('export function generateBricks') + 1));
    const destructured = [...fnBody.matchAll(/const \{ ([^}]+) \} = input;/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
    const dotted = [...fnBody.matchAll(/\binput\.(\w+)/g)].map((m) => m[1]);
    const used = new Set([...destructured, ...dotted]);
    const missing = [...used].filter((k) => !ENGINE_OPTIONS.includes(k));
    expect(missing, `read by generateBricks but not in ENGINE_OPTIONS: ${missing.join(', ')}`).toEqual([]);
  });
});
