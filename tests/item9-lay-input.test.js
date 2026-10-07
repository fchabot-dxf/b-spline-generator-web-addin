/**
 * Item 9 (T86 item 29's engine keys, the app side): what a lay asks the engine for --
 *  - Crumble top bias: one board-wide value, absent reads 0.8 (Fred: every board, new and old) -- the lay unchanged;
 *  - "Crumble frame too": suppressFrame + frameSuppression sent only while on (off = the lay byte-identical);
 *  - the Window surround: insetSurround { rect, preset, corner } only with the inset window on, a preset other than
 *    None, and a Frame element (it is part of the Frame) -- its pieces come back as surroundBricks.
 * The real engine; a stub editor (the board size only).
 */
import { describe, it, expect } from 'vitest';
import {
  brickLayInput, frameGeomForLay, buildRibbonPrimitives, frameBandsOf, topBiasOf, TOP_BIAS_DEFAULT, windowSurroundOf,
  FRAME_SUPPRESSION_DEFAULT, SURROUND_CORNER_LIST, surroundRing,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { SURROUND_CORNERS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/inset-surround.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const editor = { _mW: 7, _mH: 9 };
const RECT = { x1: 2.5, y1: 3, x2: 4.5, y2: 6 };
const base = () => ({ ...JSON.parse(JSON.stringify(P.brickSettings)), seed: 11, suppression: 0.4, frameBandPreset: 'single_soldier' });
const geom = (s, insetRect = null) => ({ primitives: buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: 7, y2: 9 })), bands: frameBandsOf(s), insetRect });
const piecesKey = (r) => JSON.stringify([r.bricks, r.frameBricks, r.surroundBricks || null]);

describe('item 9: Crumble top bias', () => {
  it('an absent field reads 0.8 (pinned), a stored value is sent as is', () => {
    const s = base();
    delete s.topBias;
    expect(TOP_BIAS_DEFAULT).toBe(0.8);
    expect(topBiasOf(s)).toBe(0.8);
    expect(brickLayInput(editor, s, geom(s)).topBias).toBe(0.8);
    expect(brickLayInput(editor, { ...s, topBias: 0.1 }, geom(s)).topBias).toBe(0.1);
  });
  it('sending the default lays exactly what the engine laid without the field (old boards unchanged)', () => {
    const s = base();
    delete s.topBias;
    const input = brickLayInput(editor, s, geom(s));
    const { topBias, ...without } = input;
    expect(topBias).toBe(0.8);
    expect(piecesKey(generateBricks(input))).toBe(piecesKey(generateBricks(without)));
  });
  it('the top bias moves the wall crumble', () => {
    const s = base();
    const a = generateBricks(brickLayInput(editor, s, geom(s)));
    const b = generateBricks(brickLayInput(editor, { ...s, topBias: 0 }, geom(s)));
    expect(JSON.stringify(b.bricks)).not.toBe(JSON.stringify(a.bricks));
  });
});

describe('item 9: Crumble frame too', () => {
  it('off / absent sends neither key; on sends both (the stored amount, else the declared default)', () => {
    const s = base();
    for (const off of [s, { ...s, suppressFrame: false, frameSuppression: 0.6 }]) {
      const input = brickLayInput(editor, off, geom(off));
      expect('suppressFrame' in input || 'frameSuppression' in input).toBe(false);
    }
    expect(brickLayInput(editor, { ...s, suppressFrame: true }, geom(s))).toMatchObject({ suppressFrame: true, frameSuppression: FRAME_SUPPRESSION_DEFAULT });
    expect(brickLayInput(editor, { ...s, suppressFrame: true, frameSuppression: 0.6 }, geom(s))).toMatchObject({ frameSuppression: 0.6 });
  });
  it('on removes frame pieces; off lays the frame byte-identical to never having had it', () => {
    const s = base();
    const before = generateBricks(brickLayInput(editor, s, geom(s)));
    const on = generateBricks(brickLayInput(editor, { ...s, suppressFrame: true, frameSuppression: 0.5 }, geom(s)));
    const off = generateBricks(brickLayInput(editor, { ...s, suppressFrame: false, frameSuppression: 0.5 }, geom(s)));
    expect(on.frameBricks.length).toBeLessThan(before.frameBricks.length);
    expect(piecesKey(off)).toBe(piecesKey(before));
  });
});

describe('item 9: the Window surround', () => {
  it('its corners are the Frame corner choices the engine takes, in the Frame order', () => {
    expect(SURROUND_CORNER_LIST.map((c) => c.id).sort()).toEqual([...SURROUND_CORNERS].sort());
  });
  it('a stored pick is read back; an unknown / empty preset is None, an unknown corner the mitre', () => {
    expect(windowSurroundOf({})).toEqual({ preset: 'none', corner: 'mitre' });
    expect(windowSurroundOf({ windowSurround: { preset: 'single_soldier', corner: 'butt' } })).toEqual({ preset: 'single_soldier', corner: 'butt' });
    expect(windowSurroundOf({ windowSurround: { preset: 'nope', corner: 'nope' } })).toEqual({ preset: 'none', corner: 'mitre' });
  });
  it('sent only with the window on and a preset picked', () => {
    const s = { ...base(), windowSurround: { preset: 'single_soldier', corner: 'butt' } };
    expect(brickLayInput(editor, s, geom(s, RECT)).insetSurround).toEqual({ rect: RECT, preset: 'single_soldier', corner: 'butt' });
    expect('insetSurround' in brickLayInput(editor, s, geom(s, null))).toBe(false); // the inset window is off
    expect('insetSurround' in brickLayInput(editor, base(), geom(s, RECT))).toBe(false); // None
  });
  it('part of the Frame element: with no Frame laid or on the board, no surround (frameGeomForLay)', () => {
    const s = base();
    const stub = { _sketchLayer: { node: { querySelector: () => null } } };
    expect(frameGeomForLay(stub, geom(s, RECT), ['wall']).insetRect).toBeNull();
    expect(frameGeomForLay(stub, geom(s, RECT), ['wall', 'frame']).insetRect).toEqual(RECT);
  });
  it('the engine lays its pieces around the window, the wall cut clear of the ring', () => {
    const s = { ...base(), suppression: 0, windowSurround: { preset: 'single_soldier', corner: 'mitre' } };
    const r = generateBricks(brickLayInput(editor, s, geom(s, RECT)));
    expect(r.surroundBricks.length).toBeGreaterThan(0);
    const ring = surroundRing(r.surroundBricks, RECT);
    const [o] = [ring.outer];
    expect(o[0].x).toBeLessThan(RECT.x1); expect(o[2].x).toBeGreaterThan(RECT.x2);
    const centre = (b) => b.polygon.reduce((a, p) => ({ x: a.x + p.x / b.polygon.length, y: a.y + p.y / b.polygon.length }), { x: 0, y: 0 });
    const inRing = (c) => c.x > o[0].x + 1e-6 && c.x < o[2].x - 1e-6 && c.y > o[0].y + 1e-6 && c.y < o[2].y - 1e-6;
    expect(r.bricks.filter((b) => inRing(centre(b)))).toEqual([]);
    expect(r.surroundBricks.every((b) => inRing(centre(b)))).toBe(true);
  });
});
