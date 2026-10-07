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
