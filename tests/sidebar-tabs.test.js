/**
 * F35 items 48 + 47 (Fred's OK on mockup v2): the main sidebar's TABS (Board | Surface | Decor | Output) at the very
 * top with Generate New Seed under them, and a PIN per section (pinned sections show on every tab, above the tab's).
 * The real sidebar markup is loaded from the palette (the shapes the app really has), not a hand-built DOM.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SIDEBAR_TABS, SIDEBAR_DEFAULT_TAB, SIDEBAR_TAB_STORAGE_KEY, SIDEBAR_PINNED_STORAGE_KEY,
  initSidebarTabs, setSidebarTab, toggleSidebarPin, sectionKey, tabOfSection,
} from '../bspline-frame-builder/b-spline-gen/html/main/sidebar-tabs.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const SIDEBAR = HTML.slice(HTML.indexOf('<aside class="cad-sidebar">'), HTML.indexOf('</aside>', HTML.indexOf('<aside class="cad-sidebar">')) + 8);

const panels = () => [...document.querySelectorAll('.cad-sidebar-sections .panel')].filter((p) => sectionKey(p.classList));
const shown = () => panels().filter((p) => p.style.display !== 'none').map((p) => sectionKey(p.classList));

beforeEach(() => {
  localStorage.clear();
  window.togglePanel = vi.fn();
  document.body.innerHTML = SIDEBAR;
});

describe('items 48 + 47: the main sidebar tabs and pins', () => {
  it('every section in the real sidebar is declared in exactly one tab', () => {
    document.body.innerHTML = SIDEBAR;
    const keys = [...document.querySelectorAll('.cad-sidebar-sections > .panel')].map((p) => sectionKey(p.classList));
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const k of keys) expect(SIDEBAR_TABS.filter((t) => t.sections.includes(k)).length, k).toBe(1);
  });

  it('the strip is the FIRST thing in the sidebar, Generate New Seed right under it', () => {
    initSidebarTabs();
    const actions = document.querySelector('.cad-sidebar > .sticky-actions');
    expect(actions.firstElementChild.id).toBe('sidebarTabs');
    expect(actions.firstElementChild.nextElementSibling.id).toBe('btnRandomSeed');
    expect([...actions.querySelectorAll('.ui-tab')].map((b) => b.textContent)).toEqual(['Board', 'Surface', 'Decor', 'Output']);
  });

  it('a tab shows only its own sections; the pick is remembered', () => {
    initSidebarTabs();
    expect(shown()).toEqual(SIDEBAR_TABS.find((t) => t.id === SIDEBAR_DEFAULT_TAB).sections);
    document.getElementById('sidebarTab_surface').click();
    expect(shown()).toEqual(['panel-skeleton', 'panel-filter', 'panel-sculpt-top', 'panel-thicken', 'panel-sculpt-bot']);
    expect(document.getElementById('sidebarTab_surface').classList.contains('active')).toBe(true);
    expect(JSON.parse(localStorage.getItem(SIDEBAR_TAB_STORAGE_KEY))).toBe('surface');
    document.body.innerHTML = SIDEBAR;
    initSidebarTabs();
    expect(shown()).toContain('panel-thicken');
  });

  it('a pinned section moves above the tab, shows on every tab, and goes back to its own place when unpinned', () => {
    initSidebarTabs();
    const brick = document.querySelector('.panel.panel-brick');
    const nextBefore = brick.nextElementSibling;
    const pin = brick.querySelector('.panel-header > .panel-pin');
    pin.click();
    expect(window.togglePanel).not.toHaveBeenCalled(); // the pin never folds the section
    expect(brick.parentElement.id).toBe('sidebarPinned');
    for (const t of SIDEBAR_TABS) { setSidebarTab(t.id); expect(shown()).toContain('panel-brick'); }
    expect(pin.classList.contains('pinned')).toBe(true);
    expect(JSON.parse(localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY))).toEqual(['panel-brick']);
    toggleSidebarPin('panel-brick');
    expect(brick.nextElementSibling).toBe(nextBefore);
    setSidebarTab('board');
    expect(shown()).not.toContain('panel-brick');
  });

  it('the pinned block sits first among the sections; two pins keep the declared reading order', () => {
    initSidebarTabs();
    toggleSidebarPin('panel-view');
    toggleSidebarPin('panel-stock');
    const box = document.getElementById('sidebarPinned');
    expect(box.parentElement.firstElementChild).toBe(box);
    expect([...box.children].map((p) => sectionKey(p.classList))).toEqual(['panel-stock', 'panel-view']);
  });

  it('a section no tab declares falls into the declared default (never vanishes)', () => {
    expect(tabOfSection('panel-something-new')).toBe('decor');
  });

  it('blocked storage: starts on the default tab with nothing pinned, and still switches', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      initSidebarTabs();
      expect(shown()).toEqual(['panel-stock', 'panel-frame']);
      setSidebarTab('output');
      expect(shown()).toEqual(['panel-view', 'panel-export', 'panel-resolution']);
    } finally { get.mockRestore(); set.mockRestore(); }
  });
});
