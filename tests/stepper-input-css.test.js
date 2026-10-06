/**
 * Item 69 (seat E, measured): the sidebar's slider-row number boxes are FORMULA fields (core/formula-field.js flips the
 * input to type="text"), so the palette's stepper rule must not be qualified by [type="number"] -- with it, the boxes fell
 * back to base.css's plain text-input rule (16 px font, 8 px side padding) and showed 12 px of value at desktop: "1.5"
 * read "1.", "15" read "1!" (15 boxes at 1400 px, 2 at 900 px; 0 after this rule).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const html = readFileSync(path.resolve(process.cwd(), 'bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html'), 'utf8');
const ruleBody = (sel) => { const i = html.indexOf(`${sel} {`); return i < 0 ? null : html.slice(i, html.indexOf('}', i)); };

describe('the stepper input rule covers formula (type="text") fields', () => {
  it('one rule for every stepper input, no type qualifier, its own font and padding', () => {
    expect(html).not.toContain('.cad-stepper input[type="number"] {');
    const body = ruleBody('    .cad-stepper input');
    expect(body).not.toBeNull();
    expect(body).toMatch(/font-size:\s*11px/);
    expect(body).toMatch(/padding:\s*0 2px/);
    expect(body).toMatch(/min-width:\s*38px/);
  });
});
