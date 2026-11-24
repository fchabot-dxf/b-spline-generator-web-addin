/**
 * Fred 2026-11-24: "on any screen size the header of a panel is locked at the top while you have it in view".
 * The pinning is ONE CSS rule (styles/layout-app.css) reading --sticky-head-top, which main/sticky-heads.js sets on each
 * scroll area from its pinned bar. These tests read the real stylesheet and the real palette markup.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stickyHeadTop, measureStickyHeads, foldScrollFix, STICKY_HEAD_SELECTOR } from '../bspline-frame-builder/b-spline-gen/html/main/sticky-heads.js';

const root = path.resolve(process.cwd(), 'bspline-frame-builder');
const css = readFileSync(path.join(root, 'styles/layout-app.css'), 'utf8');
const html = readFileSync(path.join(root, 'b-spline-gen/html/bspline_gen_palette.html'), 'utf8');
const ruleFor = (needle) => { const i = css.indexOf(needle); if (i < 0) return null; const open = css.indexOf('{', i); return { selector: css.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: css.slice(open + 1, css.indexOf('}', open)) }; };

describe('sticky panel headers: the declared CSS rule', () => {
  const head = ruleFor('.panel:not(.panel-sub) > .panel-header,');
  it('a top-level panel header (and the editor card head) is position: sticky at the declared top variable', () => {
    expect(head).not.toBeNull();
    expect(head.body).toMatch(/position:\s*sticky/);
    expect(head.body).toMatch(/top:\s*var\(--sticky-head-top/);
    expect(head.body).toMatch(/z-index:\s*var\(--z-sticky-head\)/);
    expect(head.selector).toContain('.drawer-branch > .drawer-branch-head');
  });
  it('sub-panel headers are not matched, and the sticky header sits under the pinned bar and the popovers', () => {
    expect(head.selector).not.toMatch(/\.panel-sub\s*>/);
    const z = Number(/--z-sticky-head:\s*(\d+)/.exec(css)[1]);
    const bar = Number(/\.sticky-actions\s*\{[^}]*z-index:\s*(\d+)/.exec(css)[1]);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(bar);
  });
  it('the panel clips instead of overflow: hidden (hidden would make the panel the sticky scroller)', () => {
    const panel = ruleFor('.panel:not(.panel-sub) {');
    expect(panel.body).toMatch(/overflow:\s*clip/);
  });
});

describe('sticky panel headers: which real headers the rule selects', () => {
  const doc = new DOMParser().parseFromString(html.replace(/<link[^>]*>/g, '').replace(/<script[\s\S]*?<\/script>/g, ''), 'text/html');
  it('every sidebar section header matches; the Edit Filter sub-panel header does not', () => {
    const tops = [...doc.querySelectorAll('.cad-sidebar .panel > .panel-header')].filter((h) => !h.parentElement.classList.contains('panel-sub'));
    expect(tops.length).toBeGreaterThan(8);
    expect(tops.every((h) => h.matches(STICKY_HEAD_SELECTOR))).toBe(true);
    const subs = [...doc.querySelectorAll('.panel-sub > .panel-header')];
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.some((h) => h.matches(STICKY_HEAD_SELECTOR))).toBe(false);
  });
});

describe('sticky panel headers: --sticky-head-top comes from the pinned bar', () => {
  it('the seed bar: height 55 + its own top -14 = 41 (the aside padding cancels)', () => {
    expect(stickyHeadTop(55, 'sticky', -14, 14)).toBe(41);
  });
  it('no pinned bar in the scroll area: flush at the top, cancelling the area\'s own top padding', () => {
    expect(stickyHeadTop(0, 'static', 0, 10)).toBe(-10);
    expect(stickyHeadTop(40, 'relative', 0, 0)).toBe(0);
  });
  it('measureStickyHeads writes the variable on the scroller, from the real bar', () => {
    document.body.innerHTML = '<aside class="cad-sidebar" style="padding-top:14px"><div class="sticky-actions" style="position:sticky;top:-14px"></div></aside>';
    const bar = document.querySelector('.sticky-actions');
    bar.getBoundingClientRect = () => ({ height: 55 });
    measureStickyHeads();
    expect(document.querySelector('.cad-sidebar').style.getPropertyValue('--sticky-head-top')).toBe('41px');
  });
  it('a fold that leaves the header above its pinned line scrolls it back onto the line', () => {
    expect(foldScrollFix(-24, 91)).toBe(115);
    expect(foldScrollFix(91, 91)).toBe(0);
  });
});
