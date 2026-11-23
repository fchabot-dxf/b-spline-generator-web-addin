/**
 * Phone editor: the SVG canvas box must fill the container's whole width (owner's phone, Height tab, drawer open:
 * the zoomed-in picture was drawn only in a centred vertical band, 190 of 390 px, and clipped at both sides).
 * Cause: `#editorSVGContainer` is a child of the column flexbox `#editorCanvasContainer`; `margin: 0 auto` there turns
 * off the cross-axis stretch, so the box shrank to its content width -- the SVG's own height x the board's aspect.
 * Measured in the browser: the band narrows as the drawer opens. The rule must STRETCH, never auto-margin.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync('bspline-frame-builder/styles/editor.css', 'utf8');

/** the declarations of every `#editorSVGContainer { ... }` rule that sits inside a max-width @media block */
function phoneCanvasRules(css) {
  const out = [];
  const media = /@media[^{]*max-width[^{]*\{/g;
  let m;
  while ((m = media.exec(css))) {
    let depth = 1, i = media.lastIndex;
    while (i < css.length && depth) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
    const block = css.slice(media.lastIndex, i - 1);
    for (const r of block.matchAll(/(^|\n)\s*#editorSVGContainer\s*\{([^}]*)\}/g)) out.push(r[2].replace(/\/\*[\s\S]*?\*\//g, ''));
  }
  return out;
}

describe('phone editor canvas box', () => {
  const rules = phoneCanvasRules(CSS);
  it('the phone #editorSVGContainer rule exists', () => {
    expect(rules.length).toBeGreaterThan(0);
  });
  it('does not centre itself with auto side margins (that shrinks the box to its content)', () => {
    for (const body of rules) expect(body).not.toMatch(/margin\s*:\s*[^;]*\bauto\b/);
  });
  it('stretches across the column flexbox instead', () => {
    expect(rules.some((body) => /align-self\s*:\s*stretch/.test(body))).toBe(true);
  });
});
