/**
 * T86 item 13 (Fred: "brush over wall = the wall flows around"): generateBricks' `exclusions` -- each brush brick's
 * polygon, grown by one grout width, is a hole in the wall fill. Measured on real brush strokes (bricksAlongPath, a
 * straight one and an S-curve) across a stretcher wall and a herringbone wall, by sampling the board on a grid
 * (independent of the cut itself):
 *   - no wall brick lies under a stroke's footprint
 *   - the wall still covers what it covered before, outside the footprint (no voids beyond the grout and the
 *     dropped slivers)
 *   - every cut piece is at least EXCLUSION_MIN_PIECE_FRACTION of a brick
 *   - the engine says it applied them (37's app stub stands down on `exclusionsApplied`)
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import { generateBricks, ENGINE_OPTIONS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { bricksAlongPath } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/along-path.js';
import { EXCLUSION_MIN_PIECE_FRACTION } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/fill-shape.js';
import { brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon, signedArea, offsetPathInward, inwardSignFor } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // a sampled sweep: see heavy-test-timeout.js

const W = 7, H = 9;
const board = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const SET = brickSetById(1);
const J = SET.grout.widthIn;
const WALLS = {
  stretcher: { set: SET, zones: [{ pattern: 'stretcher' }] },
  herringbone: { set: { ...SET, layout: 'herringbone' } },
};
const STROKES = {
  straight: [{ x: 0.5, y: 4.5 }, { x: 6.5, y: 4.6 }],
  'S-curve': Array.from({ length: 41 }, (_, i) => ({ x: 0.5 + 6 * (i / 40), y: 4.5 + 2 * Math.sin((i / 40) * 2 * Math.PI) })),
};
const lay = (wall, exclusions) => generateBricks({ boardOutline: board, ...WALLS[wall], suppression: 0, clumping: 0, seed: 3, exclusions });
const strokeBricks = (pts) => bricksAlongPath(pts, { set: SET, seed: 5 }).bricks;
const grow = (poly, d) => offsetPathInward(poly, d, -inwardSignFor(poly));
const boxed = (polys) => polys.map((p) => ({ p, x0: Math.min(...p.map((q) => q.x)), x1: Math.max(...p.map((q) => q.x)), y0: Math.min(...p.map((q) => q.y)), y1: Math.max(...p.map((q) => q.y)) }));
const inAny = (x, y, boxes) => boxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && pointInPolygon(x, y, b.p));

describe('exclusions (T86 item 13)', () => {
  it('is an option the engine honours', () => expect(ENGINE_OPTIONS).toContain('exclusions'));
  it('no exclusions: the wall is unchanged and nothing is claimed', () => {
    const a = generateBricks({ boardOutline: board, ...WALLS.stretcher, suppression: 0, clumping: 0, seed: 3 });
    expect(a.exclusionsApplied).toBeUndefined();
    expect(lay('stretcher', []).bricks.map((b) => b.polygon)).toEqual(a.bricks.map((b) => b.polygon));
  });
  for (const wall of Object.keys(WALLS)) for (const [name, pts] of Object.entries(STROKES)) {
    it(`${name} stroke across a ${wall} wall: the wall flows around it`, () => {
      const stroke = strokeBricks(pts);
      expect(stroke.length).toBeGreaterThan(5);
      const before = lay(wall).bricks.map((b) => b.polygon);
      const res = lay(wall, stroke.map((b) => ({ polygon: b.polygon })));
      expect(res.exclusionsApplied).toBe(true);
      const after = res.bricks.map((b) => b.polygon);
      // a footprint shrunk a hair (no wall brick in it) and one grown past the grout (the wall as before outside it)
      const under = stroke.map((b) => grow(b.polygon, J - 1e-3));
      const clear = stroke.map((b) => grow(b.polygon, J + 1e-3));
      const [bBefore, bAfter, bUnder, bClear] = [before, after, under, clear].map(boxed);
      let overlap = 0, wanted = 0, kept = 0;
      for (let x = 0.01; x < W; x += 0.02) for (let y = 0.01; y < H; y += 0.02) {
        const isWall = inAny(x, y, bAfter);
        if (isWall && inAny(x, y, bUnder)) overlap++;
        if (!inAny(x, y, bClear) && inAny(x, y, bBefore)) { wanted++; if (isWall) kept++; }
      }
      expect(overlap, 'wall samples under the stroke').toBe(0);
      expect(kept / wanted, 'wall kept outside the footprint').toBeGreaterThan(0.97);
      // the cut pieces (a polygon not in the uncut wall) are never slivers
      const minArea = EXCLUSION_MIN_PIECE_FRACTION * SET.brickLengthIn * SET.brickHeightIn;
      const untouched = new Set(before.map((p) => JSON.stringify(p)));
      const cut = after.filter((p) => !untouched.has(JSON.stringify(p)));
      expect(cut.length).toBeGreaterThan(0);
      expect(Math.min(...cut.map((p) => Math.abs(signedArea(p))))).toBeGreaterThanOrEqual(minArea);
    });
  }
});
