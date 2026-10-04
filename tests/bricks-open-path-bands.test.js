/**
 * T86 item 7 (Fred: "a brush line can have a few brick patterns, maybe 2 and 3 bricks wide"; advisor
 * refinement: "the SAME band list as the frame ... laid along an OPEN path ... rows offset either
 * side of the stroke centreline ... one engine: bricksContourBands on an open primitive list, not a
 * separate brush code path"). `bricksContourBands`/`ribbonPieces` now take `opts.closed` (default
 * true, so every existing closed-contour caller is unaffected) and `opts.centered` (bands straddle
 * the stroke's own centreline instead of starting from it and going only inward).
 */
import { describe, it, expect } from 'vitest';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { ribbonPieces } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/primitive-ribbon.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const SET = BRICK_SETS[0];
const L = SET.brickLengthIn, H = SET.brickHeightIn;

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
function bboxOf(poly) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (((poly[i].y > y) !== (poly[j].y > y))
      && (x < ((poly[j].x - poly[i].x) * (y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x)) inside = !inside;
  }
  return inside;
}
function overlapFraction(subject, other, GRID = 10) {
  const { minX, maxX, minY, maxY } = bboxOf(subject);
  let inSubject = 0, inBoth = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = minX + (maxX - minX) * (i + 0.5) / GRID, y = minY + (maxY - minY) * (j + 0.5) / GRID;
      if (!pointInPolygon(x, y, subject)) continue;
      inSubject++;
      if (pointInPolygon(x, y, other)) inBoth++;
    }
  }
  return inSubject ? inBoth / inSubject : 0;
}
function worstOverlap(bricks) {
  const boxes = bricks.map((b) => bboxOf(b.polygon));
  let worst = 0;
  for (let i = 0; i < bricks.length; i++) {
    for (let j = i + 1; j < bricks.length; j++) {
      const A = boxes[i], B = boxes[j];
      if (A.maxX < B.minX - 1e-6 || B.maxX < A.minX - 1e-6 || A.maxY < B.minY - 1e-6 || B.maxY < A.minY - 1e-6) continue;
      worst = Math.max(worst, overlapFraction(bricks[i].polygon, bricks[j].polygon));
    }
  }
  return worst;
}

describe('bricksContourBands: closed:false (brush, open path) -- 1-wide stretcher on a straight stroke', () => {
  it('bands straddle the centreline (y in [-H/2, H/2]) and the ends are square (no mitre overshoot)', () => {
    const primitives = [{ type: 'line', p0: { x: 0, y: 0 }, p1: { x: 5, y: 0 } }];
    const { bricks } = bricksContourBands(primitives, [{ widthIn: H, pattern: 'stretcher' }], { set: SET, seed: 1, closed: false, centered: true });
    expect(bricks.length).toBeGreaterThan(0);
    for (const b of bricks) expect(isSimplePolygon(b.polygon), `piece ${b.id} is self-intersecting`).toBe(true);
    const ys = bricks.flatMap((b) => b.polygon.map((p) => p.y));
    expect(Math.min(...ys)).toBeCloseTo(-H / 2, 3);
    expect(Math.max(...ys)).toBeCloseTo(H / 2, 3);
    const xs = bricks.flatMap((b) => b.polygon.map((p) => p.x));
    // CLIP_EPS_IN (0.02in, primitive-ribbon.js's own float-safety margin on an unclipped open end,
    // the SAME margin every other "no joint here" piece in this codebase already carries) is the
    // only tolerance -- a real mitre overshoot would be off by a full brick, not a float epsilon.
    expect(Math.min(...xs)).toBeGreaterThan(-0.03);
    expect(Math.max(...xs)).toBeLessThan(5.03);
  });

  it('returns no innerPath (boundaryAtDepth is a closed-contour concept)', () => {
    const primitives = [{ type: 'line', p0: { x: 0, y: 0 }, p1: { x: 5, y: 0 } }];
    const { innerPath } = bricksContourBands(primitives, [{ widthIn: H, pattern: 'stretcher' }], { set: SET, seed: 1, closed: false, centered: true });
    expect(innerPath).toEqual([]);
  });
});

describe('bricksContourBands: closed:false + centered -- 3-wide flemish/soldier/flemish on a BENT (right-angle) stroke', () => {
  const bands = [{ widthIn: H, pattern: 'flemish' }, { widthIn: L, pattern: 'soldier' }, { widthIn: H, pattern: 'flemish' }];
  const bentPrimitives = [
    { type: 'line', p0: { x: 0, y: 0 }, p1: { x: 3, y: 0 } },
    { type: 'line', p0: { x: 3, y: 0 }, p1: { x: 3, y: 3 } },
  ];

  it('all 3 bands build, every piece is simple, and no two pieces overlap across the bend', () => {
    const { bricks } = bricksContourBands(bentPrimitives, bands, { set: SET, seed: 2, closed: false, centered: true });
    expect(bricks.length).toBeGreaterThan(0);
    expect(new Set(bricks.map((b) => b.bandIndex))).toEqual(new Set([0, 1, 2]));
    for (const b of bricks) expect(isSimplePolygon(b.polygon), `piece ${b.id} is self-intersecting`).toBe(true);
    expect(worstOverlap(bricks), 'worst pairwise overlap fraction').toBeLessThan(1e-6);
  });

  it('every piece carries stable {bandIndex, rowIndex, pieceIndex} metadata (de\'s own accent-level hook)', () => {
    const { bricks } = bricksContourBands(bentPrimitives, bands, { set: SET, seed: 2, closed: false, centered: true });
    for (const b of bricks) {
      expect(Number.isInteger(b.bandIndex)).toBe(true);
      expect(Number.isInteger(b.rowIndex)).toBe(true);
      expect(Number.isInteger(b.pieceIndex)).toBe(true);
    }
    const { bricks: again } = bricksContourBands(bentPrimitives, bands, { set: SET, seed: 2, closed: false, centered: true });
    expect(again.map((b) => [b.bandIndex, b.rowIndex, b.pieceIndex])).toEqual(bricks.map((b) => [b.bandIndex, b.rowIndex, b.pieceIndex]));
  });
});

describe('bricksContourBands: "2-wide running" (a single stretcher band, 2 rows) stags by exactly half a brick', () => {
  it('row 1\'s own first piece is exactly L/2 narrower than row 0\'s, both starting at the same open end', () => {
    const primitives = [{ type: 'line', p0: { x: 0, y: 0 }, p1: { x: 10, y: 0 } }];
    const { bricks } = bricksContourBands(primitives, [{ widthIn: 2 * H, pattern: 'stretcher' }], { set: SET, seed: 3, closed: false, centered: true });
    const row0 = bricks.filter((b) => b.rowIndex === 0).sort((a, b) => a.polygon[0].x - b.polygon[0].x);
    const row1 = bricks.filter((b) => b.rowIndex === 1).sort((a, b) => a.polygon[0].x - b.polygon[0].x);
    expect(row0.length).toBeGreaterThan(0);
    expect(row1.length).toBeGreaterThan(0);
    // tolerance 1 decimal (0.05): both rows' own FIRST piece touches the true open end, which
    // carries CLIP_EPS_IN's own 0.02in float-safety margin (primitive-ribbon.js's own "no joint
    // here" extension, the same one every other open-end piece in this codebase already has) --
    // the half-brick STAGGER itself (what this test actually verifies) is 0.375in, 18x that margin.
    const width0 = Math.max(...row0[0].polygon.map((p) => p.x)) - Math.min(...row0[0].polygon.map((p) => p.x));
    const width1 = Math.max(...row1[0].polygon.map((p) => p.x)) - Math.min(...row1[0].polygon.map((p) => p.x));
    expect(width0).toBeCloseTo(L, 1);
    expect(width1).toBeCloseTo(L / 2, 1);
  });
});

describe('bricksContourBands: closed defaults to true -- every EXISTING (frame) caller is byte-unaffected', () => {
  it('a plain closed square, single_soldier, matches calling with closed explicitly true', () => {
    const square = [
      { type: 'line', p0: { x: 0, y: 0 }, p1: { x: 5, y: 0 }, nx: 0, ny: 1 },
      { type: 'line', p0: { x: 5, y: 0 }, p1: { x: 5, y: 5 }, nx: -1, ny: 0 },
      { type: 'line', p0: { x: 5, y: 5 }, p1: { x: 0, y: 5 }, nx: 0, ny: -1 },
      { type: 'line', p0: { x: 0, y: 5 }, p1: { x: 0, y: 0 }, nx: 1, ny: 0 },
    ];
    const a = bricksContourBands(square, FRAME_PRESETS.single_soldier, { set: SET, seed: 5 });
    const b = bricksContourBands(square, FRAME_PRESETS.single_soldier, { set: SET, seed: 5, closed: true });
    expect(a.bricks.length).toBeGreaterThan(0);
    expect(a.bricks).toEqual(b.bricks);
  });
});

describe('ribbonPieces: closed param defaults to true (no behaviour change for an un-migrated direct caller)', () => {
  it('omitting `closed` entirely gives the same result as passing it explicitly true', () => {
    const square = [
      { type: 'line', p0: { x: 0, y: 0 }, p1: { x: 5, y: 0 }, nx: 0, ny: 1 },
      { type: 'line', p0: { x: 5, y: 0 }, p1: { x: 5, y: 5 }, nx: -1, ny: 0 },
      { type: 'line', p0: { x: 5, y: 5 }, p1: { x: 0, y: 5 }, nx: 0, ny: -1 },
      { type: 'line', p0: { x: 0, y: 5 }, p1: { x: 0, y: 0 }, nx: 1, ny: 0 },
    ];
    const omitted = ribbonPieces(square, 0, 0.1, SET, 'stretcher', SET.brickLengthIn, SET.grout.widthIn, 1, 'test', 0);
    const explicit = ribbonPieces(square, 0, 0.1, SET, 'stretcher', SET.brickLengthIn, SET.grout.widthIn, 1, 'test', 0, 'mitre', 0, undefined, undefined, true);
    // strip the new bandIndex/rowIndex/pieceIndex tags (not present when comparing a pre-item-7
    // caller's own expectations) -- the POLYGON geometry itself must be identical either way.
    const strip = (r) => r.pieces.map((p) => p.polygon);
    expect(strip(omitted)).toEqual(strip(explicit));
  });
});
