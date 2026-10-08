/**
 * T86 item 5 (Fred: "when it crosses another line, should conform, straight cut, not mitre"; his picks on the crossing
 * mock 2026-10-07): where brick strokes cross, or a stroke meets the frame, one runs through and the other is cut
 * STRAIGHT along its edge, one joint off it, the cut run re-planned from the fill set (core/bricks/crossings.js + the
 * ribbon's cut joints). Who runs through is declared: the frame always; a stroke that ENDS at a junction stops; at an X
 * the earlier stroke. A stroke that meets nothing is laid exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { strokeBricksWithCrossings, bricksForStroke, buildRibbonPrimitives, resolvedSetFor, scaleFor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { CROSSING_RULE, strokeCrossings, splitAtCrossings, simplifyOutline, throughRegion } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/crossings.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { polygonIntersection, signedArea, pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';

const S0 = JSON.parse(JSON.stringify(P.brickSettings));
const J = resolvedSetFor(S0).grout.widthIn;
const line = (a, b, n = 24) => Array.from({ length: n + 1 }, (_, k) => ({ x: a[0] + ((b[0] - a[0]) * k) / n, y: a[1] + ((b[1] - a[1]) * k) / n }));
const arc = (cx, cy, r, t0, t1, n = 40) => Array.from({ length: n + 1 }, (_, k) => { const t = t0 + ((t1 - t0) * k) / n; return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) }; });
const st = (points) => ({ points, settings: { ...S0 } });
const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const segDist = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };
const distToPoly = (p, P) => (pointInPolygon(p.x, p.y, P) ? 0 : Math.min(...P.map((a, i) => segDist(p, a, P[(i + 1) % P.length]))));
const gap = (A, B) => Math.min(...A.map((p) => distToPoly(p, B)), ...B.map((p) => distToPoly(p, A)));
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const H_LINE = line([0.5, 4], [7.5, 4]);

describe('the crossing rule is declared', () => {
  it('the frame runs through; the stroke that ends stops; at an X the earlier one', () => {
    expect(CROSSING_RULE).toEqual({ frameRunsThrough: true, endingStrokeStops: true, atAnX: 'earlier' });
  });
  const outlineOf = (pts) => { const out = {}; bricksForStroke(pts, { ...S0 }, out); return { points: pts, outline: out.ribbonOutline }; };
  it.each([
    ['an X: the later is cut by the earlier', [H_LINE, line([4, 1.2], [4, 6.8])], [[], [0]]],
    ['a T: the later ends on the earlier and stops', [H_LINE, line([4, 1.2], [4, 4])], [[], [0]]],
    ['an end-touch: the EARLIER ends on the later and stops (Fred 5b)', [line([4, 1.2], [4, 4]), H_LINE], [[1], []]],
    ['two strokes a brick apart: no junction', [H_LINE, line([0.5, 5.5], [7.5, 5.5])], [[], []]],
    // the Brush draws a straight stroke as TWO points: two 4-vertex outlines crossing in an X have no vertex inside each
    // other (MEASURED live: a vertex-only test found no junction and nothing was cut)
    ['an X of two-point strokes (as the Brush draws them)', [[{ x: 1, y: 4.5 }, { x: 6, y: 4.5 }], [{ x: 3.5, y: 2.3 }, { x: 3.5, y: 6.7 }]], [[], [0]]],
  ])('%s', (_, lines, want) => {
    expect(strokeCrossings(lines.map(outlineOf), J)).toEqual(want);
  });
});

describe('the split: free parts ending on a straight cut', () => {
  const region = throughRegion(simplifyOutline((() => { const out = {}; bricksForStroke(H_LINE, { ...S0 }, out); return out.ribbonOutline; })()), J);
  it('an outline traced back along itself reduces to its turning points (no spike when grown)', () => {
    const out = {}; bricksForStroke(H_LINE, { ...S0 }, out);
    expect(out.ribbonOutline.length).toBeGreaterThan(8);
    expect(simplifyOutline(out.ribbonOutline).length).toBe(4);
    const ys = region.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2 * (0.5 * (Math.max(...out.ribbonOutline.map((p) => p.y)) - Math.min(...out.ribbonOutline.map((p) => p.y))) + J), 6);
  });
  it('an X splits the later stroke in two, each part cut along the through edge (dir +-x)', () => {
    const parts = splitAtCrossings(line([4, 1.2], [4, 6.8]), [region], { halfWidth: 0.17, brickLengthIn: 1.25 });
    expect(parts.length).toBe(2);
    expect(parts[0].start).toBeNull();
    expect(Math.abs(parts[0].end.dirX)).toBeCloseTo(1, 9);
    expect(Math.abs(parts[1].start.dirX)).toBeCloseTo(1, 9);
    expect(parts[1].end).toBeNull();
  });
  it('a part shorter than MIN_PART_OF_BRICK of a brick is not laid', () => {
    const parts = splitAtCrossings(line([4, 3.7], [4, 6.8]), [region], { halfWidth: 0.17, brickLengthIn: 1.25 });
    expect(parts.length).toBe(1);
    expect(parts[0].start).not.toBeNull();
  });
});

describe('the six crossing cases, laid', () => {
  const set = resolvedSetFor(S0), scale = scaleFor(S0);
  const frame = bricksContourBands(buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: 8, y2: 8 })), FRAME_PRESETS.single_soldier, { set: BRICK_SETS[0], seed: 1, scale });
  const framePolys = frame.bricks.map((b) => b.polygon);
  // [name, strokes in creation order, frame pieces, which stroke runs through (-1: the frame), which is cut]
  const CASES = [
    ['X at 90 deg', [H_LINE, line([4, 1.2], [4, 6.8])], [], 0, 1],
    ['X at 45 deg', [H_LINE, line([1.6, 1.6], [6.4, 6.4])], [], 0, 1],
    ['T', [H_LINE, line([4, 1.2], [4, 4])], [], 0, 1],
    ['a curved stroke across a straight one', [H_LINE, arc(4, 8, 5, -2.5, -0.64)], [], 0, 1],
    ['end-touch: the earlier ends on the later', [line([4, 1.2], [4, 4]), H_LINE], [], 1, 0],
    ['a stroke into the frame band', [line([4, 4.62], [4, 0.3])], framePolys, -1, 0],
  ];
  it.each(CASES)('%s: no overlap, the cut a joint (+-10 %) off the through edge, no piece under 1/4 of the stroke\'s own', (name, lines, frames, through, cut) => {
    const res = strokeBricksWithCrossings(lines.map(st), frames);
    const alone = lines.map((pts) => bricksForStroke(pts, { ...S0 }));
    const all = res.flatMap((r) => r.bricks);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(area(polygonIntersection(all[i].polygon, all[j].polygon))).toBeLessThan(1e-4);
    for (const f of frames) for (const b of all) expect(area(polygonIntersection(b.polygon, f))).toBeLessThan(1e-4);
    // the through stroke is laid as if alone (a frame is not re-laid at all)
    if (through >= 0) expect(res[through].bricks).toEqual(alone[through]);
    // the cut: the cut stroke's nearest piece is one joint off what runs through
    const others = through >= 0 ? res[through].bricks.map((b) => b.polygon) : frames;
    const near = others.filter((o) => res[cut].bricks.some((b) => gap(b.polygon, o) < 3 * J));
    const g = Math.min(...res[cut].bricks.flatMap((b) => near.map((o) => gap(b.polygon, o))));
    expect(g, name).toBeGreaterThan(0.9 * J);
    expect(g, name).toBeLessThan(1.1 * J);
    // no sliver: every piece of the cut stroke at least 1/4 of its own median piece
    const typical = median(alone[cut].map((b) => area(b.polygon)));
    for (const b of res[cut].bricks) expect(area(b.polygon) / typical, name).toBeGreaterThanOrEqual(0.24);
  });
  it('a stroke that meets nothing is laid exactly as before', () => {
    const lines = [H_LINE, line([0.5, 6], [7.5, 6])];
    const res = strokeBricksWithCrossings(lines.map(st), framePolys.filter(() => false));
    lines.forEach((pts, i) => expect(res[i].bricks).toEqual(bricksForStroke(pts, { ...S0 })));
  });
});

// pick 2 (seat E): a Continuous run covers its own pieces (it has no ribbon outline), so it runs through and stops by the
// same rule as any stroke; the inset window's surround is laid into the frame's pieces, so it runs through like the frame
describe('Continuous strokes and the window surround in the crossing rule', () => {
  const CONT = { ...S0, profile: 'continuous' };
  const two = (a, b) => [a, b];
  const V2 = [{ x: 4, y: 1.2 }, { x: 4, y: 6.8 }], VT2 = [{ x: 4, y: 1.2 }, { x: 4, y: 4 }], H2 = [{ x: 0.5, y: 4 }, { x: 7.5, y: 4 }];
  it.each([
    ['a brick stroke across an EARLIER Continuous one', two({ points: H2, settings: CONT }, { points: V2, settings: { ...S0 } })],
    ['a Continuous stroke across an earlier brick one', two({ points: H2, settings: { ...S0 } }, { points: V2, settings: CONT })],
    ['a brick stroke ending on an earlier Continuous one', two({ points: H2, settings: CONT }, { points: VT2, settings: { ...S0 } })],
    ['a Continuous stroke ending on an earlier brick one', two({ points: H2, settings: { ...S0 } }, { points: VT2, settings: CONT })],
  ])('%s: the later is cut a joint off the earlier, no overlap', (_, strokes) => {
    const res = strokeBricksWithCrossings(strokes, []);
    for (const a of res[0].bricks) for (const b of res[1].bricks) expect(area(polygonIntersection(a.polygon, b.polygon))).toBeLessThan(1e-4);
    const g = Math.min(...res[1].bricks.flatMap((b) => res[0].bricks.map((o) => gap(b.polygon, o.polygon))));
    expect(g).toBeGreaterThan(0.9 * J);
    expect(g).toBeLessThan(1.1 * J);
  });
  it('a stroke across the inset window surround ring is cut a joint off it, no overlap', async () => {
    const { laySurround } = await import('../bspline-frame-builder/b-spline-gen/html/core/bricks/inset-surround.js');
    const ring = laySurround({ rect: { x1: 2.5, y1: 3, x2: 4.5, y2: 6 }, preset: 'single_soldier', corner: 'mitre' }, { set: BRICK_SETS[0], seed: 1, scale: scaleFor(S0) }).bricks.map((b) => b.polygon);
    const [res] = strokeBricksWithCrossings([{ points: [{ x: 1, y: 4.5 }, { x: 7, y: 4.5 }], settings: { ...S0 } }], ring);
    for (const b of res.bricks) for (const f of ring) expect(area(polygonIntersection(b.polygon, f))).toBeLessThan(1e-4);
    const g = Math.min(...res.bricks.flatMap((b) => ring.map((f) => gap(b.polygon, f))));
    expect(g).toBeGreaterThan(0.9 * J);
    expect(g).toBeLessThan(1.1 * J);
  });
});

// the gate's strokes run (2026-10-08, a Grey stone frame): a stroke's SIDE met one stone before its centreline entered
// another; cut on the centreline's stone only, the end piece overlapped the first and was dropped -- a 1 in gap. The split
// now follows the centreline and both edges: the stroke stops a joint short of whatever it meets first.
describe('a stroke whose edge meets an obstacle its centreline misses', () => {
  const A = [{ x: 4.05, y: 1.6 }, { x: 4.6, y: 1.6 }, { x: 4.6, y: 2.0 }, { x: 4.05, y: 2.0 }]; // only the stroke's right half reaches it
  const B = [{ x: 3, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 1 }, { x: 3, y: 1 }]; // the band it runs into
  it('stops a joint short of the block, resumes past it, and stops a joint short of the band -- no overlap, no lost piece', () => {
    const [res] = strokeBricksWithCrossings([{ points: [{ x: 4, y: 4.5 }, { x: 4, y: 0.3 }], settings: { ...S0 } }], [A, B]);
    for (const b of res.bricks) for (const f of [A, B]) expect(area(polygonIntersection(b.polygon, f))).toBeLessThan(1e-4);
    for (const f of [A, B]) {
      const g = Math.min(...res.bricks.map((b) => gap(b.polygon, f)));
      expect(g).toBeGreaterThan(0.9 * J);
      expect(g).toBeLessThan(1.1 * J);
    }
    // pieces both above the block and between the block and the band
    expect(res.bricks.some((b) => b.polygon.every((p) => p.y > 2.0))).toBe(true);
    expect(res.bricks.some((b) => b.polygon.every((p) => p.y < 1.6 && p.y > 1.0))).toBe(true);
  });
});
