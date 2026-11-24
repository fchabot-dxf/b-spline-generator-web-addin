/**
 * Fred 2026-11-24: "the small coloured side on each section ... I want it to touch the edge of the screen".
 * ONE CSS mechanism in styles/layout-app.css: --panel-edge-gap (the aside's padding; a branch body adds its indent)
 * is the negative left margin of every .section-themed panel AND the extra width of its stripe. Nothing per panel.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf-8').replace(/\r\n/g, '\n');
const rule = (sel) => { const i = css.indexOf(sel + ' {'); expect(i, sel).toBeGreaterThan(-1); return css.slice(i, css.indexOf('}', i)); };

describe('the section stripe reaches the sidebar edge', () => {
  it('the gap is one variable: the aside padding, plus the branch indent inside a branch body', () => {
    expect(rule('aside')).toMatch(/--panel-edge-gap:\s*var\(--sidebar-pad\)/);
    expect(rule('.sidebar-branch-body')).toMatch(/--panel-edge-gap:\s*calc\(var\(--sidebar-pad\) \+ var\(--branch-indent\)\)/);
    expect(rule('.sidebar-branch-body')).toMatch(/padding-left:\s*var\(--branch-indent\)/);
  });
  it('every themed panel steps left by the gap and widens its stripe by the same gap (and the width rule comes after the shorthands)', () => {
    expect(rule('.cad-sidebar .section-themed')).toMatch(/margin-left:\s*calc\(-1 \* var\(--panel-edge-gap\)\)/);
    const widen = css.indexOf('.cad-sidebar .section-themed > .panel-body { border-left-width: calc(var(--section-stripe-w) + var(--panel-edge-gap)); }');
    expect(widen).toBeGreaterThan(-1);
    expect(css.indexOf('border-left: var(--section-stripe-w) solid var(--section-stripe)')).toBeLessThan(widen);
    expect(css.indexOf('.cad-sidebar .section-themed > .panel-body {\n    background: var(--section-body);\n    border-left: var(--section-stripe-w)')).toBeLessThan(widen);
  });
  it('no per-panel rule: no panel-<name> selector touches the margin or the edge gap', () => {
    const lines = css.split('\n').filter((l) => /--panel-edge-gap/.test(l) || /section-stripe-w/.test(l));
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(l).not.toMatch(/\.panel-(stock|frame|filter|sculpt|view|export|resolution|stl|skeleton|layers)\b/);
  });
  it('the two-column mode opens a column gap equal to the reach, so column 2 stripes do not cover column 1', () => {
    expect(rule('.cad-sidebar.sidebar-two-col .cad-sidebar-sections')).toMatch(/column-gap:\s*calc\(var\(--sidebar-pad\) \+ var\(--branch-indent\)\)/);
  });
});
