/**
 * The CAM palette's Frame split (CAM-builder/ui/html/cam-frame-layout.js), FRAME-SPLIT, Fred 2026-10-24: the frame cut as
 * 1-4 setups, one optional thickness per piece. The add-in side: CAM-builder/test_frame_split.py.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseThickness, requestForCount, requestForThickness, rows, FRAME_NOTE } from '../bspline-frame-builder/CAM-builder/ui/html/cam-frame-layout.js';

const PALETTE = readFileSync('bspline-frame-builder/CAM-builder/ui/html/cam_builder_palette.html', 'utf8');
const TWO = [{ bars: ['bottom', 'right'], thickness_in: null }, { bars: ['top', 'left'], thickness_in: 1.97 }];

describe('the Frame split requests', () => {
  it('a Pieces button asks for that preset', () => {
    expect(requestForCount(2)).toEqual({ action: 'set_frame_layout', data: { count: 2 } });
  });
  it('a thickness edit sends the whole layout with only that piece changed; empty = the bars\' own; garbage sends nothing', () => {
    expect(requestForThickness(TWO, 0, '1.75')).toEqual({ action: 'set_frame_layout', data: { pieces: [
      { bars: ['bottom', 'right'], thickness_in: 1.75 }, { bars: ['top', 'left'], thickness_in: 1.97 }] } });
    expect(requestForThickness(TWO, 1, '').data.pieces[1].thickness_in).toBeNull();
    expect(requestForThickness(TWO, 1, 'abc')).toBeNull();
    expect(requestForThickness(TWO, 1, '-1')).toBeNull();
    expect(parseThickness(' 0 ')).toBeNaN();
  });
  it('rows show each piece\'s setup name, bars and thickness', () => {
    expect(rows({ pieces: TWO, names: ['Frame A', 'Frame B'] })).toEqual([
      { index: 0, name: 'Frame A', bars: 'bottom + right', thickness: '' },
      { index: 1, name: 'Frame B', bars: 'top + left', thickness: '1.97' }]);
  });
  it('a piece with no bar in this frame is hidden (its index kept for the others); the window gets its own row', () => {
    const three = [{ bars: ['bottom', 'right'], thickness_in: null }, { bars: ['top'], thickness_in: null },
      { bars: ['left'], thickness_in: 2 }];
    const r = rows({ pieces: three, names: ['Frame A', null, 'Frame B'], window: true });
    expect(r.map((x) => [x.index, x.name])).toEqual([[0, 'Frame A'], [2, 'Frame B'], [null, 'Frame Window']]);
    expect(requestForThickness(three, r[1].index, '1.5').data.pieces[2].thickness_in).toBe(1.5);
    expect(FRAME_NOTE).toMatch(/next BUILD/);
  });
});

describe('the Frame card in the palette', () => {
  const card = PALETTE.slice(PALETTE.indexOf('data-setup="frame"'), PALETTE.indexOf('class="cam-action-section"'));
  it('has Pieces buttons 1-4 and asks for the saved layout on boot', () => {
    for (const n of [1, 2, 3, 4]) expect(card).toMatch(new RegExp(`data-count="${n}"`));
    expect(card).toMatch(/id="frame-pieces"/);
    expect(PALETTE).toMatch(/send\('get_frame_layout'\)/);
    expect(PALETTE).toMatch(/action === 'frame_layout'/);
  });
  it('every Frame piece setup lights the Frame card dot', () => {
    const keys = PALETTE.match(/const SETUP_KEYS = (\[[^\]]*\]);/);
    const fn = PALETTE.match(/function setupKeyFor\(name\) \{[\s\S]*?\n  \}/);
    const setupKeyFor = new Function(`const SETUP_KEYS = ${keys[1]}; ${fn[0]}; return setupKeyFor;`)();
    for (const n of ['Frame', 'Frame A', 'Frame B', 'Frame C', 'Frame D', 'Frame Window']) expect(setupKeyFor(n)).toBe('frame');
    expect(setupKeyFor('B-spline Back')).toBe('bspline_back');
  });
});
