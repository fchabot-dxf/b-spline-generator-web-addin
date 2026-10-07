/**
 * T86 item 10, the engine key: generateBricks({ ..., groutCut: [{ polyline, widthIn? }] }) cuts a grout joint through the
 * laid Wall AND Frame pieces after the lay (core/bricks/grout-cut.js bricksGroutCut) -- the Raised brush's Grout mode.
 * Each element at its own set's joint unless the cut declares a width; a piece under its element's quarter-brick floor
 * drops into the joint. No cut = the lay exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { generateBricks, ENGINE_OPTIONS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { BRICK_SETS, FRAME_PRESETS, MIN_PIECE_FRACTION, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';

const SET = BRICK_SETS[0], W = 7, H = 9, SCALE = 1;
const BOARD = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const frame = { primitives: buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: W, y2: H })), bands: FRAME_PRESETS.single_soldier };
const lay = (extra = {}) => generateBricks({ boardOutline: BOARD, set: SET, seed: 3, scale: SCALE, suppression: 0, clumping: 0, frame, ...extra });
// a cut from the board's left edge (through the soldier band) diagonally into the wall
const CUT = [{ x: 0.1, y: 2.2 }, { x: 2.5, y: 3.4 }, { x: 4.6, y: 6.1 }];
const area = (p) => Math.abs(signedArea(p));
const along = (line, step = 0.01) => line.slice(1).flatMap((b, i) => {
  const a = line[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  return Array.from({ length: n }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }));
});
const covering = (pieces, line) => along(line).filter((p) => pieces.some((b) => pointInPolygon(p.x, p.y, b.polygon))).length;

describe('T86 item 10: generateBricks groutCut', () => {
  it('is a declared engine option', () => {
    expect(ENGINE_OPTIONS).toContain('groutCut');
  });
  it('no cut (absent, [], or a cut with no points) lays exactly as before', () => {
    const plain = JSON.stringify(lay());
    expect(JSON.stringify(lay({ groutCut: [] }))).toBe(plain);
    expect(JSON.stringify(lay({ groutCut: [{ polyline: [] }] }))).toBe(plain);
  });
  it('cuts a joint through the Wall AND the Frame along the stroke: no piece covers the line any more', () => {
    const before = lay(), after = lay({ groutCut: [{ polyline: CUT }] });
    expect(covering(before.bricks, CUT)).toBeGreaterThan(50);
    expect(covering(before.frameBricks, CUT)).toBeGreaterThan(5);
    expect(covering(after.bricks, CUT)).toBe(0);
    expect(covering(after.frameBricks, CUT)).toBe(0);
    expect(after.groutCutApplied).toBe(1);
    expect(after.bricks.length).toBeGreaterThan(before.bricks.length); // cut bricks became pieces
  });
  it('leaves the pieces it does not reach untouched, and drops none under the floor', () => {
    const before = lay(), after = lay({ groutCut: [{ polyline: CUT }] });
    const eff = scaledSet(SET, SCALE), floor = MIN_PIECE_FRACTION * eff.brickLengthIn * eff.brickHeightIn;
    for (const b of after.bricks) expect(area(b.polygon)).toBeGreaterThanOrEqual(floor - 1e-9);
    const keep = new Set(after.bricks.map((b) => JSON.stringify(b.polygon)));
    const far = before.bricks.filter((b) => b.polygon.every((p) => p.y > 7.5)); // well clear of the cut
    expect(far.length).toBeGreaterThan(5);
    for (const b of far) expect(keep.has(JSON.stringify(b.polygon))).toBe(true);
  });
  it('the joint is the element\'s own width; a cut can declare a wider one', () => {
    const at = (w) => { const r = lay({ groutCut: [{ polyline: CUT, ...(w ? { widthIn: w } : {}) }] }); return r.bricks.reduce((t, b) => t + area(b.polygon), 0); };
    const plainArea = lay().bricks.reduce((t, b) => t + area(b.polygon), 0);
    const own = at(), wide = at(0.2);
    expect(own).toBeLessThan(plainArea);
    expect(wide).toBeLessThan(own); // a wider cut takes more of the wall
  });
});

// Fred (item 10 extended): "also cut Brush bricks" -- one declared cut step for every element (grout-cut.js applyGroutCuts)
import { applyGroutCuts, bricksAlongPath } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';

describe('T86 item 10: applyGroutCuts, the one shared cut step (Wall / Frame / Brush)', () => {
  const STROKE = [{ x: 1, y: 5 }, { x: 6, y: 5.4 }];
  const ACROSS = [{ x: 3.2, y: 4.2 }, { x: 3.6, y: 6.2 }];
  const brush = () => bricksAlongPath(STROKE, { set: SET, scale: SCALE, seed: 4 }).bricks;
  it('cuts a Brush stroke\'s bricks at the set\'s joint: none covers the cut line, none under the floor', () => {
    const before = brush();
    expect(covering(before, ACROSS)).toBeGreaterThan(0);
    const after = applyGroutCuts(before, [{ polyline: ACROSS }], SET, SCALE);
    expect(covering(after, ACROSS)).toBe(0);
    const eff = scaledSet(SET, SCALE), floor = MIN_PIECE_FRACTION * eff.brickLengthIn * eff.brickHeightIn;
    for (const b of after) expect(area(b.polygon)).toBeGreaterThanOrEqual(floor - 1e-9);
  });
  it('no cut, an empty cut, or no pieces = the same pieces back', () => {
    const before = brush();
    expect(applyGroutCuts(before, [], SET, SCALE)).toBe(before);
    expect(applyGroutCuts(before, [{ polyline: [] }], SET, SCALE)).toBe(before);
    expect(applyGroutCuts([], [{ polyline: ACROSS }], SET, SCALE)).toEqual([]);
  });
  it('generateBricks\' wall cut IS this step over the plain lay (the elements cannot diverge)', () => {
    const plain = lay(), cut = lay({ groutCut: [{ polyline: CUT }] });
    expect(JSON.stringify(cut.bricks)).toBe(JSON.stringify(applyGroutCuts(plain.bricks, [{ polyline: CUT }], SET, SCALE)));
  });
});

describe('T86 item 10: the whole drawn line is the cut (one swept band), not one capsule per segment', () => {
  // captured in the brush matrix (Soldier brush piece, the recorded cut): the line STARTS inside the piece, leaves by its
  // right edge, comes back and leaves again. One capsule per segment ignored the first segment (wholly inside = a dab),
  // so 6 of 36 samples of the drawn cut stayed under the piece; the band carves the drawn line as one shape
  const piece = { id: 's', polygon: [{ x: 3.1626, y: 3.8503 }, { x: 3.4959, y: 3.8583 }, { x: 3.467, y: 5.1424 }, { x: 3.1626, y: 5.1497 }] };
  const line = [{ x: 3.25, y: 4.25 }, { x: 3.25, y: 4.5 }, { x: 3.5, y: 4.75 }, { x: 3.4371, y: 4.9702 }, { x: 3.5394, y: 5.3407 }, { x: 3.443, y: 5.5577 }, { x: 3.5, y: 6 }];
  it('no sample of the drawn line stays under the piece', async () => {
    const { bricksGroutCut } = await import('../bspline-frame-builder/b-spline-gen/html/core/bricks/grout-cut.js');
    expect(covering([piece], line)).toBeGreaterThan(0);
    expect(covering(bricksGroutCut([piece], line, { widthIn: 0.034 }), line)).toBe(0);
  });
  it('a dab inside one piece still opens no joint (the piece comes back whole)', async () => {
    const { bricksGroutCut } = await import('../bspline-frame-builder/b-spline-gen/html/core/bricks/grout-cut.js');
    const out = bricksGroutCut([piece], [{ x: 3.3, y: 4.3 }, { x: 3.31, y: 4.4 }, { x: 3.3, y: 4.5 }], { widthIn: 0.034 });
    expect(out).toEqual([piece]);
  });
});

describe('T86 item 10 x seat E\'s single frame lay: the cut runs on the frame as laid, BEFORE the frame crumble', () => {
  it('cut + "Crumble frame too" = the crumble of the cut pieces of the plain lay', async () => {
    const { suppressBricks } = await import('../bspline-frame-builder/b-spline-gen/html/core/bricks/suppression.js');
    const crumble = { suppressFrame: true, frameSuppression: 0.4, topBias: 0.8, clumping: 0.3 };
    const plain = lay({ topBias: 0.8, clumping: 0.3 });
    const both = lay({ ...crumble, groutCut: [{ polyline: CUT }] });
    const cutFirst = applyGroutCuts(plain.frameBricks, [{ polyline: CUT }], SET, SCALE);
    const expected = suppressBricks(cutFirst, { suppression: 0.4, topBias: 0.8, clumping: 0.3 }, 3, scaledSet(SET, SCALE).brickHeightIn);
    expect(JSON.stringify(both.frameBricks)).toBe(JSON.stringify(expected));
    expect(covering(both.frameBricks, CUT)).toBe(0);
  });
});
