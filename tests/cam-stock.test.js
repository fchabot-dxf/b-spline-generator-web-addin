/**
 * The CAM palette's Stock card (CAM-builder/ui/html/cam-stock.js), Fred 2026-10-20: exactly three number fields (X, Y, Z in
 * inches) + a Clear button, a status line, and an amber DETECTION-ONLY warning. Empty = default; filled = written on the
 * next BUILD / APPLY. The add-in side: CAM-builder/test_stock_card.py.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSize, readFields, statusLine, warningText, requestFor, STOCK_NOTE } from '../bspline-frame-builder/CAM-builder/ui/html/cam-stock.js';

const PALETTE = readFileSync('bspline-frame-builder/CAM-builder/ui/html/cam_builder_palette.html', 'utf8');

describe('reading the three fields', () => {
  it('all empty = the default; all three numbers = a box; anything else = partial (nothing saved)', () => {
    expect(readFields('', '', '')).toEqual({ kind: 'default' });
    expect(readFields('7.5', '9.5', '1.5')).toEqual({ kind: 'box', dims: [7.5, 9.5, 1.5] });
    expect(readFields('7.5', '', '1.5')).toEqual({ kind: 'partial' });
    expect(readFields('7.5', 'abc', '1.5')).toEqual({ kind: 'partial' });
    expect(readFields('7.5', '-2', '1.5')).toEqual({ kind: 'partial' });
    expect(parseSize(' 0 ')).toBeNaN();
  });
});

describe('the status line', () => {
  it('says the default and that an existing stock is kept; then the typed box', () => {
    expect(statusLine({ kind: 'default' })).toBe('stock: default (panel + 1 in, 2 in tall; a setup that already has a stock keeps it)');
    expect(statusLine({ kind: 'box', dims: [7.5, 9.5, 1.5] })).toBe('stock: 7.5 × 9.5 × 1.5 in (centred on the panel, bottom on the model bottom)');
    expect(statusLine({ kind: 'partial' })).toMatch(/all three/);
  });
});

describe('the warning is detection only', () => {
  const needs = { x: 8.1, y: 9, z: 1 };
  it('names the short axis with the numbers, and says BUILD writes it anyway', () => {
    expect(warningText({ kind: 'box', dims: [7.5, 9.5, 1.5] }, needs))
      .toBe('Smaller than the panel + frame: X 7.5 in is less than the 8.1 in the part needs. BUILD writes it anyway.');
  });
  it('is empty for a big enough box, a default card, or an unknown part', () => {
    expect(warningText({ kind: 'box', dims: [9, 10, 2] }, needs)).toBe('');
    expect(warningText({ kind: 'default' }, needs)).toBe('');
    expect(warningText({ kind: 'box', dims: [1, 1, 1] }, null)).toBe('');
  });
  it('never turns into a request that clamps: the box asked for is the typed one', () => {
    expect(requestFor({ kind: 'box', dims: [1, 1, 1] })).toEqual({ action: 'set_stock', data: { dims: [1, 1, 1] } });
    expect(requestFor({ kind: 'default' })).toEqual({ action: 'set_stock', data: { dims: null } });
    expect(requestFor({ kind: 'partial' })).toBeNull();
  });
});

describe('the card in the palette', () => {
  const card = PALETTE.slice(PALETTE.indexOf('id="stock-card"'), PALETTE.indexOf('id="toolpaths-card"'));
  it('has exactly three number fields X, Y, Z plus one Clear button, and no other input', () => {
    expect(card.match(/<input\b/g)).toHaveLength(3);
    expect([...card.matchAll(/<input[^>]*id="([^"]+)"[^>]*type="number"|<input[^>]*type="number"[^>]*id="([^"]+)"/g)].length).toBe(3);
    expect(card).toMatch(/id="bs-stock-x"/); expect(card).toMatch(/id="bs-stock-y"/); expect(card).toMatch(/id="bs-stock-z"/);
    expect(card.match(/<button\b/g)).toHaveLength(1);
    expect(card).toMatch(/id="bs-stock-clear"/);
  });
  it('the note names PREVIEW and the out-of-date toolpaths', () => {
    expect(STOCK_NOTE).toMatch(/PREVIEW/); expect(STOCK_NOTE).toMatch(/out of date/);
  });
  it('typing saves the box and redraws the Fusion preview; PREVIEW also draws the default; leaving the tab clears it', () => {
    expect(PALETTE).toMatch(/send\(req\.action, req\.data\);\s*send\('preview_stock_bspline'/);
    expect(PALETTE).toMatch(/showDefault: true/);
    expect(PALETTE).toMatch(/mode !== currentMode[^\n]*send\('preview_clear'\)/);
  });
});
