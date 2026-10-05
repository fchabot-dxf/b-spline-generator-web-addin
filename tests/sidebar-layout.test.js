/**
 * F35 item 26 -- the main sidebar drag-resizes on desktop (declared min/max, persisted per viewer), its button/icon
 * grids gain columns with the width (one declared cell min, CSS auto-fit), and past ~2x the default its sections
 * flow into two columns in reading order, a section never split. ONE declaration: SIDEBAR_LAYOUT
 * (main/sidebar-layout.js). The live drag, column flow and reload persistence are proved via CDP (WORK-LOG).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SIDEBAR_LAYOUT, sidebarBounds, isTwoColumn, initSidebarLayout } from '../bspline-frame-builder/b-spline-gen/html/main/sidebar-layout.js';
import { makeSplitter } from '../bspline-frame-builder/b-spline-gen/html/editor/splitter.js';

const ROOT = 'bspline-frame-builder/';
const html = readFileSync(ROOT + 'b-spline-gen/html/bspline_gen_palette.html', 'utf-8');
const css = readFileSync(ROOT + 'styles/layout-app.css', 'utf-8');

function stubMedia(phone) {
  window.matchMedia = vi.fn(() => ({ matches: phone, addEventListener: () => {}, removeEventListener: () => {} }));
}

describe('F35 item 26: the declaration', () => {
  it('min/max bound the drag; the 3D view always keeps its declared room', () => {
    expect(sidebarBounds(1600)).toEqual({ min: SIDEBAR_LAYOUT.minPx, max: SIDEBAR_LAYOUT.maxPx });
    expect(sidebarBounds(800).max).toBe(800 - SIDEBAR_LAYOUT.keepViewportPx);
    expect(sidebarBounds(300).max).toBe(SIDEBAR_LAYOUT.minPx); // never a max below the min
  });
  it('two columns from ~2x the default width, one below', () => {
    expect(SIDEBAR_LAYOUT.twoColumnPx).toBe(2 * SIDEBAR_LAYOUT.defaultPx);
    expect(isTwoColumn(SIDEBAR_LAYOUT.twoColumnPx - 1)).toBe(false);
    expect(isTwoColumn(SIDEBAR_LAYOUT.twoColumnPx)).toBe(true);
  });
  it('the default is the CSS default (one number, two readers)', () => {
    expect(css).toContain(`--cad-sidebar-width: ${SIDEBAR_LAYOUT.defaultPx}px;`);
  });
});

describe('F35 item 26: the splitter persists per viewer when asked', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  const mk = (storage) => {
    const handle = document.createElement('div');
    return makeSplitter(document.createElement('div'), {
      handle, axis: 'width', computeRawSize: (x) => x, snaps: () => [{ name: 'a', px: 100 }],
      min: () => 50, max: () => 900, storageKey: 'k', ...(storage ? { storage } : {}), applySize: () => {}, readSize: () => 0,
    });
  };
  it("storage 'local' -> localStorage (survives the session)", () => {
    mk('local').setSize(321);
    expect(localStorage.getItem('k')).toBe('321');
    expect(sessionStorage.getItem('k')).toBeNull();
  });
  it('default stays sessionStorage (the phone splitters, "per session")', () => {
    mk().setSize(222);
    expect(sessionStorage.getItem('k')).toBe('222');
    expect(localStorage.getItem('k')).toBeNull();
  });
});

describe('F35 item 26: initSidebarLayout', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    document.body.innerHTML = '<main><aside class="cad-sidebar"><div class="cad-sidebar-sections"></div></aside><div id="resizer"></div></main>';
    // the module's synthetic 'resize' (it re-fits the 3D view) -- happy-dom leaves isTrusted unset, so the splitter's
    // own trusted-only guard cannot tell it apart and would recurse; the browser can (proved live)
    vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
  });
  const sidebar = () => document.querySelector('.cad-sidebar');
  const width = () => document.documentElement.style.getPropertyValue('--cad-sidebar-width');

  it("desktop, a viewer's saved width comes back -- and a wide one flows into two columns", () => {
    stubMedia(false);
    localStorage.setItem(SIDEBAR_LAYOUT.storageKey, '572');
    initSidebarLayout();
    expect(width()).toBe('572px');
    expect(sidebar().classList.contains('sidebar-two-col')).toBe(true);
    expect(sidebar().classList.contains('sidebar-desktop')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--sidebar-cell-min')).toBe(`${SIDEBAR_LAYOUT.cellMinPx}px`);
  });
  it('a fresh viewer gets the default, one column', () => {
    stubMedia(false);
    initSidebarLayout();
    expect(width()).toBe(`${SIDEBAR_LAYOUT.defaultPx}px`);
    expect(sidebar().classList.contains('sidebar-two-col')).toBe(false);
  });
  it('a saved width is clamped to the declared max', () => {
    stubMedia(false);
    localStorage.setItem(SIDEBAR_LAYOUT.storageKey, '5000');
    initSidebarLayout();
    expect(width()).toBe(`${sidebarBounds(window.innerWidth).max}px`);
  });
  it('phones: untouched (mobile-resizer.js owns the handle there), one column, no desktop grids', () => {
    stubMedia(true);
    localStorage.setItem(SIDEBAR_LAYOUT.storageKey, '572');
    initSidebarLayout();
    expect(width()).toBe('');
    expect(sidebar().className).toBe('cad-sidebar');
  });
});

describe('F35 item 26: the page and the CSS read the declaration', () => {
  const aside = html.slice(html.indexOf('<aside class="cad-sidebar">'), html.indexOf('<div class="cad-resizer" id="resizer">'));
  it('every sidebar section sits inside .cad-sidebar-sections (the column container); the pinned actions outside', () => {
    const sections = aside.slice(aside.indexOf('<div class="cad-sidebar-sections">'));
    expect(aside.indexOf('class="sticky-actions"')).toBeLessThan(aside.indexOf('<div class="cad-sidebar-sections">'));
    expect((aside.match(/class="panel /g) || []).length).toBe((sections.match(/class="panel /g) || []).length);
  });
  it('the old inline desktop drag is gone (one drag, the declared one), and the tool groups carry no fixed 2-column style', () => {
    expect(html).not.toMatch(/Resizer Compatibility logic/);
    expect(html).not.toMatch(/cad-tool-group" style=/);
  });
  it('two columns never split a section; grids auto-fit the declared cell; both desktop-scoped', () => {
    expect(css).toMatch(/\.cad-sidebar\.sidebar-two-col \.cad-sidebar-sections\s*\{[^}]*column-count:\s*2/);
    expect(css).toMatch(/\.cad-sidebar-sections > \.panel\s*\{[^}]*break-inside:\s*avoid/);
    expect(css).toMatch(/\.cad-sidebar\.sidebar-desktop \.cad-tool-group\s*\{[^}]*repeat\(auto-fit, minmax\(var\(--sidebar-cell-min\), 1fr\)\)/);
  });
});
