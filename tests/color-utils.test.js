/**
 * color-utils.js in isolation — H8's own declared frame-colour table.
 */
import { describe, it, expect } from 'vitest';
import { FRAME_COLORS, frameColorFor } from '../bspline-frame-builder/b-spline-gen/html/core/color-utils.js';

const BOARD_COLORS = {
  '3D Ash - Unfinished': '#d9c9a3',
  '3D Mahogany - Unfinished': '#7a3b2e',
  '3D Pine - Unfinished': '#e3c07a',
  '3D Maple - Painted': '#ead7ad',
  '3D Oak - Painted': '#b88a55',
};
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const sum = (rgb) => rgb[0] + rgb[1] + rgb[2];

describe('FRAME_COLORS / frameColorFor', () => {
  it('declares an entry for every wood previewColors has (frame-3d.test.js\'s own FRAME_DEFS source)', () => {
    expect(Object.keys(FRAME_COLORS).sort()).toEqual(Object.keys(BOARD_COLORS).sort());
  });

  it('a wood lighter than middle gray (Ash, Pine, Maple) has a LIGHTER declared frame colour', () => {
    for (const name of ['3D Ash - Unfinished', '3D Pine - Unfinished', '3D Maple - Painted']) {
      expect(sum(toRgb(FRAME_COLORS[name]))).toBeGreaterThan(sum(toRgb(BOARD_COLORS[name])));
    }
  });

  it('Mahogany (darker than middle gray) and Oak (a declared exception, live: "Oak needs darker" — it sat almost exactly at middle gray, and the move-away-from-middle rule\'s own "lighter" call read as barely different from its own board) both have a DARKER declared frame colour', () => {
    for (const name of ['3D Mahogany - Unfinished', '3D Oak - Painted']) {
      expect(sum(toRgb(FRAME_COLORS[name]))).toBeLessThan(sum(toRgb(BOARD_COLORS[name])));
    }
  });

  it('every declared frame colour differs from its own board colour ("a tiny bit different")', () => {
    for (const [name, board] of Object.entries(BOARD_COLORS)) {
      expect(FRAME_COLORS[name]).not.toBe(board);
    }
  });

  it('is a genuinely different colour for every declared wood (never collapses two woods together)', () => {
    expect(new Set(Object.values(FRAME_COLORS)).size).toBe(Object.keys(FRAME_COLORS).length);
  });

  it('frameColorFor looks up the declared table by wood name', () => {
    expect(frameColorFor('3D Ash - Unfinished', '#000000')).toBe(FRAME_COLORS['3D Ash - Unfinished']);
  });

  it('frameColorFor falls back to the given board colour for an undeclared wood', () => {
    expect(frameColorFor('3D Unknown - Wood', '#123456')).toBe('#123456');
  });
});
