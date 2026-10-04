/**
 * editor/breakpoints.js declares the ONE phone breakpoint, but CSS can't import it: the @media blocks in
 * styles/editor.css, styles/layout-app.css and bspline_gen_palette.html (and its inline matchMedia calls)
 * repeat the number. Fred moved it 720 -> 900 (2026-10-04); this keeps every copy equal to the declaration,
 * so the next move can't leave a half-switched layout behind.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MOBILE_MAX_PX, MOBILE_QUERY, LANDSCAPE_PHONE_QUERY } from '../bspline-frame-builder/b-spline-gen/html/editor/breakpoints.js';

const FILES = [
  'bspline-frame-builder/styles/editor.css',
  'bspline-frame-builder/styles/layout-app.css',
  'bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html',
];
// Only the PHONE breakpoint's range is checked; other, deliberately different widths are outside it
// (a 400px small-phone tweak; the 601px "(pointer: fine)" nav-label rule in the palette).
const PHONE_RANGE = [650, 1100];

function mediaWidths(file) {
  const out = [];
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!/@media\s*\(|matchMedia\(/.test(line)) return; // real queries, not comments that mention @media
    for (const m of line.matchAll(/(max|min)-width:\s*(\d+)px/g)) {
      const px = Number(m[2]);
      if (px >= PHONE_RANGE[0] && px <= PHONE_RANGE[1]) out.push({ file, line: i + 1, kind: m[1], px });
    }
  });
  return out;
}

describe('the phone breakpoint has one value everywhere', () => {
  it('the JS queries are built from MOBILE_MAX_PX', () => {
    expect(MOBILE_QUERY).toBe(`(max-width: ${MOBILE_MAX_PX}px)`);
    expect(LANDSCAPE_PHONE_QUERY).toContain(`(min-width: ${MOBILE_MAX_PX + 1}px)`);
  });
  it.each(FILES)('%s: every phone-range max-width is MOBILE_MAX_PX and every min-width is MOBILE_MAX_PX + 1', (file) => {
    const found = mediaWidths(file);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(f.px, `${f.file}:${f.line} ${f.kind}-width`).toBe(f.kind === 'max' ? MOBILE_MAX_PX : MOBILE_MAX_PX + 1);
    }
  });
});
