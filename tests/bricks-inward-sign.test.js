/**
 * T86 (seat E, the silent zero-brick lay; MEASURED): geometry.js inwardSignFor reads a closed path's WINDING. It used a
 * vote of every vertex (a trial offset both ways, the side ending nearer the centroid), so densely tessellated concave
 * arcs out-voted the straight sides: an outline with T1's notch alone on one side laid its whole band OUTSIDE the board
 * and the board clip dropped all 99 pieces -- 0 laid, no note. The fixture is T1's own right-side notch (its exact arcs)
 * on a 4 x 4.55 in board. Every template at every portrait board size (2078 outlines) read the same sign either way.
 */
import { describe, it, expect } from 'vitest';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { inwardSignFor, offsetPathInward, pointInPolygon, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const SET = BRICK_SETS[0];
/** T1 7x9's right-side notch (contour-from-frame's own primitives, template_1), moved onto a W-wide board */
function notchOutline(W) {
  const dx = W - 6.75, dy = 1 - 3.23031025, yb = 5.77516325 + dy + 1;
  const A = (cx, cy, r, t, d) => ({ type: 'A', cx: cx + dx, cy: cy + dy, rx: r, ry: r, theta1: t, dTheta: d });
  return [{ type: 'L', p0: { x: W, y: 0 } }, A(6.1267455, 3.23031025, 0.6232545, 0, 1.3522546530615491),
    A(6.409337007548882, 4.50273675, 0.6801745, -1.7893380005282433, -2.7045093061231), A(6.1267455, 5.77516325, 0.6232545, -1.3522546530615491, 1.3522546530615491),
    { type: 'L', p0: { x: W, y: 5.77516325 + dy } }, { type: 'L', p0: { x: W, y: yb } }, { type: 'L', p0: { x: 0, y: yb } }, { type: 'L', p0: { x: 0, y: 0 } }];
}
const tess = (prims, steps = 16) => prims.flatMap((p) => (p.type === 'arc' ? Array.from({ length: steps }, (_, k) => { const t = p.theta1 + ((p.theta2 - p.theta1) * k) / steps; return { x: p.cx + p.r * Math.cos(t), y: p.cy + p.r * Math.sin(t) }; }) : [p.p0]));
const centroid = (P) => P.reduce((m, p) => ({ x: m.x + p.x / P.length, y: m.y + p.y / P.length }), { x: 0, y: 0 });

describe('inwardSignFor reads the winding', () => {
  it.each([['as drawn', false], ['reversed', true]])('the notch board (%s): the inward offset of every straight side lands inside', (_, rev) => {
    const B = tess(buildRibbonPrimitives(notchOutline(4)), 16);
    const P = rev ? [...B].reverse() : B;
    const moved = offsetPathInward(P, 0.01, inwardSignFor(P));
    // the corners of the straight sides (no arc vertex near them): each moves into the board
    const corners = P.map((p, i) => i).filter((i) => [0, 4].includes(Math.round(P[i].x * 100) / 100) && [0, 4.54].includes(Math.floor(P[i].y * 100) / 100));
    expect(corners.length).toBe(4);
    for (const i of corners) expect(pointInPolygon(moved[i].x, moved[i].y, P), `vertex ${i}`).toBe(true);
    expect(inwardSignFor(P)).toBe(signedArea(P) < 0 ? 1 : -1);
  });
});

describe('a frame outline with a lone notch lays its band inside the board', () => {
  it.each([4, 6.75])('W = %s in: pieces laid, every one inside the board', (W) => {
    const prims = buildRibbonPrimitives(notchOutline(W));
    const r = bricksContourBands(prims, [{ widthIn: 0.75, pattern: 'soldier', cornerStyle: 'mitre' }], { set: SET, seed: 1, scale: 1 });
    expect(r.bricks.length).toBeGreaterThan(50);
    const board = tess(prims, 128);
    for (const b of r.bricks) { const c = centroid(b.polygon); expect(pointInPolygon(c.x, c.y, board)).toBe(true); }
  });
});
