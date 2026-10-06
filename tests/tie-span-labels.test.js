/**
 * F35 item 54 (Fred: "I don't know what Cells is for"): the Lattice + Shape Lattice tie SPAN toggle reads as what it
 * does -- "Span: Short stub | Rail to rail" with a tooltip each, from one declaration (TIE_SPAN_MODES). Read from the
 * lay code: 'cells' = a short stub of span min-max cells snapped toward a rail; 'rails' = rail to rail exactly.
 * Labels only: the button ids and the modes are unchanged.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TIE_SPAN_MODES, labelTieSpanButtons, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

describe('item 54: the tie Span toggle says what it does', () => {
  it('declares the two modes the lay code reads, with plain labels + tooltips', () => {
    expect(TIE_SPAN_MODES.map((m) => [m.id, m.label])).toEqual([['cells', 'Short stub'], ['rails', 'Rail to rail']]);
    for (const m of TIE_SPAN_MODES) expect(m.title.length).toBeGreaterThan(20);
    expect(TIE_SPAN_MODES.map((m) => m.id)).toContain(PATTERN_DEFAULTS.ties.span.mode);
  });
  it('labelTieSpanButtons gives each button its declared label + tooltip', () => {
    const cells = document.createElement('button'), rails = document.createElement('button');
    cells.textContent = 'Cells'; rails.textContent = 'Rails';
    labelTieSpanButtons({ cells, rails });
    expect([cells.textContent, rails.textContent]).toEqual(['Short stub', 'Rail to rail']);
    expect(cells.title).toBe(TIE_SPAN_MODES[0].title);
  });
  it('both panels label the row "Span" and keep their button ids', () => {
    const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf-8');
    for (const prefix of ['lattice', 'shapeLattice']) {
      const at = html.indexOf(`id="${prefix}TiesSpanModeCells"`);
      expect(at, prefix).toBeGreaterThan(0);
      expect(html.slice(Math.max(0, at - 400), at)).toMatch(/>Span</);
      expect(html).toContain(`id="${prefix}TiesSpanModeRails"`);
    }
  });
});
