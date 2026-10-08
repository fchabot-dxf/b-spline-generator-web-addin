/**
 * Fred 2026-10-08 ("Yes, grey only", seat D's mock shots/seatD/agrey/grey_by_height_mock.png): bricks read in greys
 * from their carve height. ONE ramp (core/bricks/height-grey.js) for the 2D editor (per point, from each layer's cached
 * brick mask: editor/brick-height-grey.js) and the SVG download (one flat grey per brick: tests/svg-download.test.js).
 */
import { describe, it, expect } from 'vitest';
import {
  HEIGHT_GREY_RAMP, greyLevel, greyOfHeight, NEUTRAL_BRICK_GREY, heightGreyPixels,
} from '../bspline-frame-builder/b-spline-gen/html/core/bricks/height-grey.js';
import { applyBrickHeightGreys, heightGreyPatternId, heightGreyPaintFor } from '../bspline-frame-builder/b-spline-gen/html/editor/brick-height-grey.js';

const R = HEIGHT_GREY_RAMP;
describe('the ramp (declared once)', () => {
  it('lighter = higher, clamped to its ends; the neutral grey is a plain face', () => {
    expect(greyLevel(R.lowIn)).toBe(R.dark);
    expect(greyLevel(R.highIn)).toBe(R.light);
    expect(greyLevel(R.lowIn - 1)).toBe(R.dark);
    expect(greyLevel(R.highIn + 1)).toBe(R.light);
    const hs = [-0.05, 0, 0.06, 0.12, 0.19];
    hs.slice(1).forEach((h, i) => expect(greyLevel(h)).toBeGreaterThan(greyLevel(hs[i])));
    expect(NEUTRAL_BRICK_GREY).toBe(greyOfHeight(R.neutralIn));
    expect(greyOfHeight(0.12)).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });
  it('mask -> pixels: row 0 of the image is the board TOP (mask row nz-1); no brick = transparent', () => {
    const nx = 2, nz = 2, body = new Float32Array([0, 1, 0.5, 0]); // mask row 0 = bottom: [0, 1]; row 1 = top: [0.5, 0]
    const px = heightGreyPixels(body, 0.125, nx, nz);
    const at = (i, j) => Array.from(px.slice((j * nx + i) * 4, (j * nx + i) * 4 + 4));
    expect(at(0, 0)).toEqual([greyLevel(0.0625), greyLevel(0.0625), greyLevel(0.0625), 255]); // top-left = mask (0, 1)
    expect(at(1, 0)[3]).toBe(0);
    expect(at(0, 1)[3]).toBe(0);
    expect(at(1, 1)).toEqual([greyLevel(0.125), greyLevel(0.125), greyLevel(0.125), 255]);
  });
});

const NS = 'http://www.w3.org/2000/svg';
function board() {
  const svg = document.createElementNS(NS, 'svg');
  const g = document.createElementNS(NS, 'g');
  svg.appendChild(g);
  document.body.appendChild(svg);
  const piece = (layer, attrs) => { const e = document.createElementNS(NS, attrs.tag || 'polygon'); for (const [k, v] of Object.entries({ 'data-brick-gen': '1', 'data-layer': layer, ...attrs })) if (k !== 'tag') e.setAttribute(k, v); g.appendChild(e); return e; };
  const wall = piece('2', { 'data-brick': 'wall', 'data-brick-set': '1', fill: NEUTRAL_BRICK_GREY });
  const groutNone = piece('2', { tag: 'path', 'data-brick': 'grout', fill: 'none' });
  const groutCol = piece('3', { tag: 'path', 'data-brick': 'grout', fill: '#cfc6b4' });
  const frame = piece('3', { 'data-brick': 'frame', 'data-brick-set': '1', fill: NEUTRAL_BRICK_GREY });
  const mask = { body: new Float32Array(6).fill(1), nx: 3, nz: 2, faces: {} };
  const ed = { _sketchLayer: { node: g }, _mW: 7, _mH: 9, _layers: [{ id: 2, _brickMask: mask, _brickDepth: 0.125 }, { id: 3 }] };
  return { svg, ed, wall, frame, groutNone, groutCol, mask };
}

describe('the 2D editor: each layer’s mask as its bricks’ greys, on a mask update only', () => {
  it('a layer with a mask: one pattern over the board, its bricks + its colourless grout point at it; a layer without: neutral', () => {
    const { svg, ed, wall, frame, groutNone, groutCol } = board();
    const calls = [];
    const r = applyBrickHeightGreys(ed, { encode: (px, nx, nz) => { calls.push([px.length, nx, nz]); return 'data:image/png;base64,AAAA'; } });
    expect(r).toEqual({ layers: 1, painted: 2, encoded: 1 });
    expect(calls).toEqual([[3 * 2 * 4, 3, 2]]);
    const id = heightGreyPatternId(2);
    const pat = svg.querySelector(`#${id}`);
    expect(pat.getAttribute('patternUnits')).toBe('userSpaceOnUse');
    expect(['width', 'height'].map((k) => pat.getAttribute(k))).toEqual(['7', '9']);
    expect(pat.firstChild.getAttribute('href')).toBe('data:image/png;base64,AAAA');
    expect(wall.getAttribute('fill')).toBe(`url(#${id})`);
    expect(groutNone.getAttribute('fill')).toBe(`url(#${id})`);
    expect(frame.getAttribute('fill')).toBe(NEUTRAL_BRICK_GREY); // layer 3: no mask yet
    expect(groutCol.getAttribute('fill')).toBe('#cfc6b4'); // a grout colour of its own stays
    expect(heightGreyPaintFor(ed, 2)).toBe(`url(#${id})`);
    expect(heightGreyPaintFor(ed, 3)).toBeNull();
    svg.remove();
  });
  it('the image is encoded once per mask (a repaint with the same mask re-encodes nothing); a new mask re-encodes', () => {
    const { svg, ed } = board();
    let n = 0;
    const encode = () => `data:image/png;base64,${++n}`;
    applyBrickHeightGreys(ed, { encode });
    expect(applyBrickHeightGreys(ed, { encode }).encoded).toBe(0);
    ed._layers[0]._brickMask = { ...ed._layers[0]._brickMask, body: new Float32Array(6).fill(0.5) };
    expect(applyBrickHeightGreys(ed, { encode }).encoded).toBe(1);
    expect(svg.querySelector(`#${heightGreyPatternId(2)}`).firstChild.getAttribute('href')).toBe('data:image/png;base64,2');
    svg.remove();
  });
  it('a mask that goes away: its pattern removed, its bricks back to neutral (no stale greys)', () => {
    const { svg, ed, wall, groutNone } = board();
    applyBrickHeightGreys(ed, { encode: () => 'data:x' });
    ed._layers[0]._brickMask = null;
    applyBrickHeightGreys(ed, { encode: () => 'data:x' });
    expect(svg.querySelector(`#${heightGreyPatternId(2)}`)).toBeNull();
    expect(wall.getAttribute('fill')).toBe(NEUTRAL_BRICK_GREY);
    expect(groutNone.getAttribute('fill')).toBe('none');
    svg.remove();
  });
  it('no canvas (the encoder returns null): neutral, nothing broken', () => {
    const { svg, ed, wall } = board();
    expect(applyBrickHeightGreys(ed, { encode: () => null }).layers).toBe(0);
    expect(wall.getAttribute('fill')).toBe(NEUTRAL_BRICK_GREY);
    svg.remove();
  });
});
