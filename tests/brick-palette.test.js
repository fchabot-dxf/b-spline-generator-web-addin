/**
 * Brick palettes (seat A 2026-10-15; Fred's colour plan, PAINT ONLY): an element's colour per role
 * (core/bricks/palette.js) -- defaults, the field from its SET's natural colour, its pattern's declared colours, the
 * user's own -- shown only in the Colour look, as ONE set of rules the 2D view (a page <style>), the 3D drape (the same
 * rules in its SVG) and the SVG download read. The Height look (absent on a saved board) is today's view, untouched.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  paletteOf, paletteCss, brickPaintOf, lookModeOf, BRICK_SET_COLOURS, ROLE_DEFAULT_COLOURS, PALETTE_STYLE_ID, DEFAULT_LOOK_MODE,
} from '../bspline-frame-builder/b-spline-gen/html/core/bricks/palette.js';
import { applyBrickPalette } from '../bspline-frame-builder/b-spline-gen/html/editor/brick-palette-style.js';
import { buildDrapeSvg } from '../bspline-frame-builder/b-spline-gen/html/core/preview/drape-svg.js';

const S = (over = {}) => ({ setIds: { wall: 1, frame: 3, brush: 4 }, pattern: 'stretcher', frameBandPreset: 'single_soldier',
  brushBandPreset: 'stretcher_1', ...over });

describe('the palette, resolved', () => {
  it('the field is the element’s SET colour; the other roles their defaults', () => {
    expect(paletteOf(S(), 'wall')).toEqual({ ...ROLE_DEFAULT_COLOURS, field: BRICK_SET_COLOURS[1] });
    expect(paletteOf(S(), 'frame').field).toBe(BRICK_SET_COLOURS[3]); // White rocks
    expect(paletteOf(S(), 'brush').field).toBe(BRICK_SET_COLOURS[4]);
  });
  it('a pattern’s declared colours: the Greek key’s green / white are its motif / field', () => {
    const s = S({ frameBandPreset: 'greek_key_mosaic' });
    expect(paletteOf(s, 'frame')).toMatchObject({ motif: '#3f8f72', field: '#f2efe6' });
    expect(paletteOf(s, 'wall').field).toBe(BRICK_SET_COLOURS[1]); // the wall keeps its set's
    expect(paletteOf({ ...s, colourByElement: { frame: { motif: '#000000' } } }, 'frame').motif).toBe('#000000');
  });
  it('the user’s own colour wins per role; a malformed one is ignored (null = the default)', () => {
    const s = S({ colourByElement: { frame: { motif: '#123456', field: null, accent: 'red' } } });
    expect(paletteOf(s, 'frame')).toMatchObject({ motif: '#123456', field: BRICK_SET_COLOURS[3], accent: ROLE_DEFAULT_COLOURS.accent });
    expect(paletteOf(s, 'wall').motif).toBe(ROLE_DEFAULT_COLOURS.motif); // per element
  });
});

describe('the look', () => {
  it('a saved board (no lookMode) is the Height look: no rules, no paint', () => {
    expect(DEFAULT_LOOK_MODE).toBe('height');
    expect(lookModeOf({})).toBe('height');
    expect(paletteCss(S())).toBe('');
    expect(brickPaintOf(S(), 'wall', 'field')).toBeNull();
  });
  it('the Colour look: one rule per element and role, plus a flagged accent as the accent', () => {
    const css = paletteCss(S({ lookMode: 'colour' }));
    expect(css).toContain(`[data-brick="wall"][data-brick-role="field"]{fill:${BRICK_SET_COLOURS[1]} !important}`);
    expect(css).toContain(`[data-brick="frame"][data-brick-role="motif"]{fill:${ROLE_DEFAULT_COLOURS.motif} !important}`);
    expect(css).toContain(`[data-brick="brush"][data-brick-accent="1"]{fill:${ROLE_DEFAULT_COLOURS.accent} !important}`);
    expect(css).not.toContain('grout'); // the grout keeps its own paint
  });
});

describe('the three surfaces read the same rules', () => {
  beforeEach(() => { document.getElementById(PALETTE_STYLE_ID)?.remove(); });
  it('2D: one page style, rewritten in place, emptied by the Height look (never in the drawing)', () => {
    expect(applyBrickPalette(S())).toBe('');
    expect(document.getElementById(PALETTE_STYLE_ID)).toBeNull();
    applyBrickPalette(S({ lookMode: 'colour' }));
    const style = document.getElementById(PALETTE_STYLE_ID);
    expect(style.parentNode).toBe(document.head);
    expect(style.textContent).toBe(paletteCss(S({ lookMode: 'colour' })));
    applyBrickPalette(S({ lookMode: 'colour', colourByElement: { wall: { field: '#010203' } } }));
    expect(document.querySelectorAll(`#${PALETTE_STYLE_ID}`)).toHaveLength(1);
    expect(style.textContent).toContain('fill:#010203');
    applyBrickPalette(S());
    expect(style.textContent).toBe('');
  });
  it('3D: the drape SVG carries the same rules (and none in the Height look)', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 9" width="7" height="9">'
      + '<polygon data-layer="1" data-brick="wall" data-brick-role="field" fill="#808080" points="0,0 1,0 1,1"/></svg>';
    const layers = [{ id: '1', visible: true, showColor: true }];
    const css = paletteCss(S({ lookMode: 'colour' }));
    expect(buildDrapeSvg(layers, svg, { css })).toContain(`<style>${css}</style>`);
    expect(buildDrapeSvg(layers, svg)).not.toContain('<style>');
  });
});
