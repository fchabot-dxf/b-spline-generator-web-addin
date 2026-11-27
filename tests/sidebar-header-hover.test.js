/**
 * Fred 2026-11-27 ("i dont like this hover feedback, just make it simpler"): hovering a themed sidebar header must not
 * move anything. Its :hover state used to re-declare `border-left`, which (beating the stripe-to-the-edge width rule)
 * shrank the stripe by --panel-edge-gap and shifted the header under the pointer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

describe('themed sidebar header hover', () => {
  it('no :hover rule of a themed header touches its border (the stripe never changes width under the pointer)', () => {
    const hover = rules.filter((r) => /section-themed\s*>\s*\.panel-header:hover/.test(r.sel));
    expect(hover.length).toBeGreaterThan(0);
    for (const r of hover) expect(r.body).not.toMatch(/border/);
  });
  it('the header still carries its stripe, widened to the sidebar edge', () => {
    const base = rules.find((r) => r.sel === '.cad-sidebar .section-themed > .panel-header' && /border-left:/.test(r.body));
    expect(base).toBeTruthy();
    const width = rules.find((r) => /border-left-width:\s*calc\(var\(--section-stripe-w\) \+ var\(--panel-edge-gap\)\)/.test(r.body));
    expect(width && width.sel).toMatch(/section-themed > \.panel-header/);
  });
  it('hover is only a slight darkening', () => {
    const hover = rules.filter((r) => r.sel === '.cad-sidebar .section-themed > .panel-header:hover');
    expect(hover.some((r) => /filter:\s*brightness\(0\.97\)/.test(r.body))).toBe(true);
  });
});
