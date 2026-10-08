// Stones under a brush stroke and a grout cut (seat E, 2026-10-08). A fieldstone wall cut by a brush stroke's bricks
// (the wall's exclusions) or by a grout cut must close round the cut: no bare board beyond a joint. Measured before the
// fix on this 6 x 6 board, White rocks at 1.25 in: 1.68 sq in bare round the stroke, 2.07 sq in along the grout cut --
// the cuts dropped every stone fragment under ONE BRICK's quarter (0.84 sq in, 16 x fieldstone's own floor), and a
// stone wholly holding a stroke brick was dropped whole. piece-floor.js declares each layout's floor; fill-shape.js
// splits a piece round a hole it wholly holds.
import { describe, it, expect } from 'vitest';
import { bricksFillShape } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/fill-shape.js';
import { applyGroutCuts } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/grout-cut.js';
import { BRICK_SETS, scaledSet, MIN_PIECE_FRACTION, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { setBandPattern } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { minPieceAreaOf, PIECE_FLOOR_BY_LAYOUT, frameLaidBy, LAID_BY_COURSES } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/piece-floor.js';
import { fieldstoneMinPieceArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/layouts/fieldstone.js';

const ROCK = BRICK_SETS.find((s) => s.layout === 'fieldstone');
const SCALE = 1.25 / 0.75;
const BOARD = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }];
const BARE_MAX_SQIN = 0.05; // grid-sampling slack; the measured bugs were 1.68 and 2.07
const sd = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };
const dist = (p, Q) => (pointInPolygon(p.x, p.y, Q) ? 0 : Math.min(...Q.map((a, i) => sd(p, a, Q[(i + 1) % Q.length]))));
/** sq in of the window farther than `d` from every stone and every covered polygon (the stroke, the cut's channel) */
function bare(stones, covered, c, win, d) {
  let n = 0; const h = 0.02;
  const near = [...stones.map((b) => b.polygon), ...covered].filter((P) => P.some((p) => Math.abs(p.x - c.x) < win && Math.abs(p.y - c.y) < win));
  for (let x = c.x - win / 2; x < c.x + win / 2; x += h) for (let y = c.y - win / 2; y < c.y + win / 2; y += h) if (near.every((P) => dist({ x, y }, P) > d)) n++;
  return n * h * h;
}

describe('the floor a cut may leave is the layout\'s own (piece-floor.js)', () => {
  it('fieldstone reads its smallest stone tier; every other layout one brick', () => {
    const rock = scaledSet(ROCK, SCALE);
    expect(PIECE_FLOOR_BY_LAYOUT.fieldstone).toBe(fieldstoneMinPieceArea);
    expect(minPieceAreaOf(rock)).toBeCloseTo(fieldstoneMinPieceArea(rock), 12);
    expect(minPieceAreaOf(rock)).toBeLessThan(MIN_PIECE_FRACTION * rock.brickLengthIn * rock.brickHeightIn / 4);
    for (const s of BRICK_SETS.filter((x) => x.layout !== 'fieldstone')) expect(minPieceAreaOf(s)).toBe(MIN_PIECE_FRACTION * s.brickLengthIn * s.brickHeightIn);
  });
});

describe('a fieldstone wall closes round a cut', () => {
  const J = scaledSet(ROCK, SCALE).grout.widthIn;
  const plain = bricksFillShape(BOARD, null, { set: ROCK, seed: 1, scale: SCALE }).bricks;

  it('round a brush stroke (the wall\'s exclusions): no bare board, no stone over the stroke', () => {
    const stroke = [0, 1, 2].map((k) => { const x0 = 1.5 + k * 1.034; return [{ x: x0, y: 2.85 }, { x: x0 + 1, y: 2.85 }, { x: x0 + 1, y: 3.15 }, { x: x0, y: 3.15 }]; });
    const cut = bricksFillShape(BOARD, null, { set: ROCK, seed: 1, scale: SCALE, exclusions: stroke.map((polygon) => ({ polygon })) }).bricks;
    expect(bare(plain, [], { x: 3, y: 3 }, 2.4, 0.75 * J)).toBe(0);
    expect(bare(cut, stroke, { x: 3, y: 3 }, 2.4, 0.75 * J)).toBeLessThanOrEqual(BARE_MAX_SQIN);
    const over = cut.flatMap((b) => stroke.map((s) => Math.abs(signedArea(polygonIntersection(b.polygon, s)) || 0))).filter((a) => a > 1e-4);
    expect(over).toEqual([]);
  });

  it('along a grout cut: no bare board beyond the cut\'s own joint', () => {
    const gc = applyGroutCuts(plain, [{ polyline: [{ x: 0.5, y: 4.5 }, { x: 5.5, y: 4.5 }] }], ROCK, SCALE);
    const channel = [{ x: 0.5, y: 4.5 - J / 2 }, { x: 5.5, y: 4.5 - J / 2 }, { x: 5.5, y: 4.5 + J / 2 }, { x: 0.5, y: 4.5 + J / 2 }];
    expect(bare(gc, [channel], { x: 3, y: 4.5 }, 2.4, 0.75 * J)).toBeLessThanOrEqual(BARE_MAX_SQIN);
  });
});

describe('a stone ring closes round a grout cut (the floor of the layout that LAID the ring)', () => {
  const GREY = BRICK_SETS.find((s) => s.bandLayout === 'fieldstone');
  it('Grey stone rings with fieldstone; a brick set\'s frame lays courses', () => {
    expect(frameLaidBy(GREY, setBandPattern)).toBe('fieldstone');
    expect(frameLaidBy(BRICK_SETS.find((s) => s.layout === 'running_bond') || BRICK_SETS[0], setBandPattern)).toBe(LAID_BY_COURSES);
  });
  // the cut may add at most one dropped fragment of the RING's own floor over the plain lay (measured: plain 0.012 sq in
  // in this window, cut 0.057 -> +0.045 under the floor 0.052; with the one-brick floor the cut left 0.417)
  it('a grout cut across a Grey stone ring adds no more bare board than one fragment under the ring\'s floor', () => {
    const W = 6, H = 8, B = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
    const frame = { primitives: buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: W, y2: H })), bands: FRAME_PRESETS.single_soldier, set: GREY };
    const lay = (extra) => generateBricks({ boardOutline: B, set: ROCK, seed: 1, scale: SCALE, suppression: 0, clumping: 0, frame, ...extra });
    const Jf = scaledSet(GREY, SCALE).grout.widthIn, cut = [{ x: 3, y: H - 2.5 }, { x: 3, y: H + 0.5 }];
    const channel = [{ x: 3 - Jf / 2, y: H - 2.5 }, { x: 3 + Jf / 2, y: H - 2.5 }, { x: 3 + Jf / 2, y: H + 0.5 }, { x: 3 - Jf / 2, y: H + 0.5 }];
    const offBoard = [{ x: -1, y: H }, { x: W + 1, y: H }, { x: W + 1, y: H + 1 }, { x: -1, y: H + 1 }];
    const bareOf = (r) => bare([...r.frameBricks, ...r.bricks], [channel, offBoard], { x: 3, y: H - 1 }, 2, 0.75 * Jf);
    const added = bareOf(lay({ groutCut: [{ polyline: cut }] })) - bareOf(lay({}));
    expect(added).toBeLessThanOrEqual(minPieceAreaOf(scaledSet(GREY, SCALE), 'fieldstone'));
  });
});
