/**
 * Redesign phase 5 (seat D's mockups shots/seatD/redesign/mock_Sidebar_*): the main sidebar's four former tabs are the
 * BRANCHES of one collapse tree, Generate New Seed pinned above; item 47's PIN keeps a section at the top. The real
 * sidebar markup is loaded from the palette (the shapes the app really has), not a hand-built DOM.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SIDEBAR_TABS, SIDEBAR_DEFAULT_OPEN, SIDEBAR_OPEN_STORAGE_KEY, SIDEBAR_PINNED_STORAGE_KEY, SIDEBAR_LEGACY_TAB_STORAGE_KEY, BRANCH_CARET,
  initSidebarTabs, setSidebarTab, toggleSidebarBranch, toggleSidebarPin, sectionKey, tabOfSection, revealSidebarSection, initialOpenBranches,
} from '../bspline-frame-builder/b-spline-gen/html/main/sidebar-tabs.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const SIDEBAR = HTML.slice(HTML.indexOf('<aside class="cad-sidebar">'), HTML.indexOf('</aside>', HTML.indexOf('<aside class="cad-sidebar">')) + 8);

const panels = () => [...document.querySelectorAll('.cad-sidebar-sections .panel')].filter((p) => sectionKey(p.classList));
// on screen = not inside a folded branch (jsdom has no layout: the [hidden] body is what folds it)
const shown = () => panels().filter((p) => !p.closest('.sidebar-branch-body[hidden]')).map((p) => sectionKey(p.classList));
const $ = (id) => document.getElementById(id);

beforeEach(() => {
  localStorage.clear();
  window.togglePanel = vi.fn();
  document.body.innerHTML = SIDEBAR;
});

describe('phase 5: the main sidebar tree', () => {
  it('every section in the real sidebar is declared in exactly one branch', () => {
    const keys = [...document.querySelectorAll('.cad-sidebar-sections > .panel')].map((p) => sectionKey(p.classList));
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const k of keys) expect(SIDEBAR_TABS.filter((t) => t.sections.includes(k)).length, k).toBe(1);
  });

  it('Generate New Seed stays first and alone in the pinned bar; the branches follow in SIDEBAR_TABS order, each with its sections', () => {
    initSidebarTabs();
    const actions = document.querySelector('.cad-sidebar > .sticky-actions');
    expect([...actions.children].map((c) => c.id)).toEqual(['btnRandomSeed']);
    const branches = [...document.querySelectorAll('.cad-sidebar-sections > .sidebar-branch')];
    expect(branches.map((b) => b.dataset.branch)).toEqual(SIDEBAR_TABS.map((t) => t.id));
    expect(branches.map((b) => b.querySelector('.sidebar-branch-label').textContent)).toEqual(['Board', 'Surface', 'Decor', 'Output']);
    for (const t of SIDEBAR_TABS) {
      expect([...$(`sidebarBranch_${t.id}`).children].map((p) => sectionKey(p.classList)), t.id).toEqual(t.sections);
    }
  });

  it('the first look is the mockup\'s: Board and Surface open, Decor and Output folded', () => {
    initSidebarTabs();
    expect(SIDEBAR_DEFAULT_OPEN).toEqual(['board', 'surface']);
    expect(shown()).toEqual([...SIDEBAR_TABS[0].sections, ...SIDEBAR_TABS[1].sections]);
    expect($('sidebarTab_board').getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-branch="decor"] .sidebar-branch-caret').textContent).toBe(BRANCH_CARET.folded);
  });

  it('a caret folds and unfolds its own branch only; the open set is remembered per device', () => {
    initSidebarTabs();
    document.querySelector('[data-branch="board"] .sidebar-branch-caret').click();
    expect(shown()).toEqual(SIDEBAR_TABS[1].sections);
    document.querySelector('[data-branch="output"] .sidebar-branch-caret').click();
    expect(shown()).toEqual([...SIDEBAR_TABS[1].sections, ...SIDEBAR_TABS[3].sections]);
    expect(JSON.parse(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY))).toEqual(['surface', 'output']);
    document.body.innerHTML = SIDEBAR;
    initSidebarTabs();
    expect(shown()).toEqual([...SIDEBAR_TABS[1].sections, ...SIDEBAR_TABS[3].sections]);
  });

  it('a branch label (the former tab id) opens its branch and scrolls to it -- a second tap never folds it', () => {
    initSidebarTabs();
    const head = document.querySelector('[data-branch="decor"] .sidebar-branch-head');
    head.scrollIntoView = vi.fn();
    $('sidebarTab_decor').click();
    expect(shown()).toContain('panel-brick');
    expect(head.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    $('sidebarTab_decor').click();
    expect(shown()).toContain('panel-brick');
    expect(head.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('a device with no tree state yet: the default plus the tab it last had open', () => {
    expect(initialOpenBranches(null, 'output')).toEqual(['board', 'surface', 'output']);
    expect(initialOpenBranches(null, null)).toEqual(['board', 'surface']);
    expect(initialOpenBranches(['decor', 'gone'], 'output')).toEqual(['decor']); // a saved set wins, unknown ids dropped
    localStorage.setItem(SIDEBAR_LEGACY_TAB_STORAGE_KEY, JSON.stringify('decor'));
    initSidebarTabs();
    expect(shown()).toContain('panel-stamp');
  });

  it('a pinned section moves to the top, shows whatever is folded, and goes back into its branch when unpinned', () => {
    initSidebarTabs();
    const brick = document.querySelector('.panel.panel-brick');
    const pin = brick.querySelector('.panel-header > .panel-pin');
    pin.click();
    expect(window.togglePanel).not.toHaveBeenCalled(); // the pin never folds the section
    expect(brick.parentElement.id).toBe('sidebarPinned');
    for (const t of SIDEBAR_TABS) if (!t.sections.includes('panel-brick')) toggleSidebarBranch(t.id);
    expect(shown()).toContain('panel-brick');
    expect(pin.classList.contains('pinned')).toBe(true);
    expect(JSON.parse(localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY))).toEqual(['panel-brick']);
    toggleSidebarPin('panel-brick');
    expect([...$('sidebarBranch_decor').children].map((p) => sectionKey(p.classList))).toEqual(SIDEBAR_TABS[2].sections);
  });

  it('the pinned block sits first among the sections; two pins keep the page\'s reading order', () => {
    initSidebarTabs();
    toggleSidebarPin('panel-view');
    toggleSidebarPin('panel-stock');
    const box = $('sidebarPinned');
    expect(box.parentElement.firstElementChild).toBe(box);
    expect([...box.children].map((p) => sectionKey(p.classList))).toEqual(['panel-stock', 'panel-view']);
  });

  it('revealSidebarSection: its branch opens and the section unfolds (the brick matrix uses it); a pinned one stays put', () => {
    window.togglePanel = (h) => h.classList.toggle('collapsed');
    initSidebarTabs();
    const header = document.querySelector('.panel.panel-brick > .panel-header');
    expect(header.classList.contains('collapsed')).toBe(true);
    revealSidebarSection('panel-brick');
    expect(shown()).toContain('panel-brick');
    expect(header.classList.contains('collapsed')).toBe(false);
    toggleSidebarPin('panel-filter'); toggleSidebarBranch('surface');
    revealSidebarSection('panel-filter');
    expect($('sidebarTab_surface').getAttribute('aria-expanded')).toBe('false');
  });

  it('a section no branch declares falls into the declared default (never vanishes)', () => {
    expect(tabOfSection('panel-something-new')).toBe('decor');
  });

  it('blocked storage: starts on the default open set with nothing pinned, and still folds / opens', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      initSidebarTabs();
      expect(shown()).toEqual([...SIDEBAR_TABS[0].sections, ...SIDEBAR_TABS[1].sections]);
      setSidebarTab('output');
      expect(shown()).toContain('panel-export');
    } finally { get.mockRestore(); set.mockRestore(); }
  });
});
