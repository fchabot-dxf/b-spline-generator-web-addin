/**
 * Redesign phase 5 (seat D's mockups shots/seatD/redesign/mock_Sidebar_*): the main sidebar's former tabs are the
 * BRANCHES of one collapse tree, Generate New Seed pinned above; item 47's PIN keeps a section at the top. Fred
 * 2026-10-11 (final): three branches, Surface ending with a "2D editor" group (Photo, Brick, Vector stamping). The real
 * sidebar markup is loaded from the palette (the shapes the app really has), not a hand-built DOM.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SIDEBAR_TABS, SIDEBAR_DEFAULT_OPEN, SIDEBAR_OPEN_STORAGE_KEY, SIDEBAR_PINNED_STORAGE_KEY, SIDEBAR_LEGACY_TAB_STORAGE_KEY, SIDEBAR_TAB_ALIASES, BRANCH_CARET,
  initSidebarTabs, setSidebarTab, toggleSidebarBranch, toggleSidebarPin, sectionKey, tabOfSection, revealSidebarSection, initialOpenBranches,
  declaredSectionOrder, branchSections, groupOfSection,
} from '../bspline-frame-builder/b-spline-gen/html/main/sidebar-tabs.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const SIDEBAR = HTML.slice(HTML.indexOf('<aside class="cad-sidebar">'), HTML.indexOf('</aside>', HTML.indexOf('<aside class="cad-sidebar">')) + 8);

const panels = () => [...document.querySelectorAll('.cad-sidebar-sections .panel')].filter((p) => sectionKey(p.classList));
// on screen = not inside a folded branch (jsdom has no layout: the [hidden] body is what folds it)
const shown = () => panels().filter((p) => !p.closest('.sidebar-branch-body[hidden]')).map((p) => sectionKey(p.classList));
const $ = (id) => document.getElementById(id);
const sectionsOf = (id) => branchSections(SIDEBAR_TABS.find((t) => t.id === id));
// a branch's sections as they stand in the page (its own, then its groups')
const inBranch = (id) => [...$(`sidebarBranch_${id}`).querySelectorAll('.panel')].filter((p) => sectionKey(p.classList)).map((p) => sectionKey(p.classList));
const BOARD = sectionsOf('board'), SURFACE = sectionsOf('surface'), OUTPUT = sectionsOf('output');

beforeEach(() => {
  localStorage.clear();
  window.togglePanel = vi.fn();
  document.body.innerHTML = SIDEBAR;
});

describe('phase 5: the main sidebar tree', () => {
  it('every section in the real sidebar is declared exactly once', () => {
    const keys = [...document.querySelectorAll('.cad-sidebar-sections > .panel')].map((p) => sectionKey(p.classList));
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const k of keys) expect(SIDEBAR_TABS.flatMap(branchSections).filter((s) => s === k).length, k).toBe(1);
  });

  it('Fred 2026-10-11 (final): three branches; Surface ends with a "2D editor" GROUP -- Photo, Brick, Vector stamping', () => {
    expect(SIDEBAR_TABS.map((t) => t.id)).toEqual(['board', 'surface', 'output']);
    expect(SURFACE).toEqual(['panel-skeleton', 'panel-filter', 'panel-sculpt-top', 'panel-thicken', 'panel-sculpt-bot', 'panel-photo', 'panel-brick', 'panel-stamp']);
    expect(groupOfSection('panel-brick')).toMatchObject({ id: 'editor', label: '2D editor' });
    expect(groupOfSection('panel-filter')).toBeNull();
    initSidebarTabs();
    const group = $('sidebarGroup_editor');
    expect(group.parentElement.id).toBe('sidebarBranch_surface');
    expect(group.parentElement.lastElementChild).toBe(group); // after Surface's own sections
    expect(group.querySelector('.sidebar-group-head').textContent).toBe('2D editor');
    expect([...group.querySelectorAll(':scope > .panel')].map((p) => sectionKey(p.classList))).toEqual(['panel-photo', 'panel-brick', 'panel-stamp']);
  });

  it('Generate New Seed stays first and alone in the pinned bar; the branches follow in SIDEBAR_TABS order, each in its DECLARED order', () => {
    initSidebarTabs();
    const actions = document.querySelector('.cad-sidebar > .sticky-actions');
    expect([...actions.children].map((c) => c.id)).toEqual(['btnRandomSeed']);
    const branches = [...document.querySelectorAll('.cad-sidebar-sections > .sidebar-branch')];
    expect(branches.map((b) => b.dataset.branch)).toEqual(SIDEBAR_TABS.map((t) => t.id));
    expect(branches.map((b) => b.querySelector('.sidebar-branch-label').textContent)).toEqual(['Board', 'Surface', 'Output']);
    // the page's markup has Photo after Filter and Brick in its own block: the declaration, not the markup, orders them
    for (const t of SIDEBAR_TABS) expect(inBranch(t.id), t.id).toEqual(branchSections(t));
  });

  it('declaredSectionOrder: branch by branch in the declared order; an undeclared section after its branch\'s own', () => {
    expect(declaredSectionOrder(['panel-stamp', 'panel-view', 'panel-photo', 'panel-stock', 'panel-new', 'panel-skeleton']))
      .toEqual(['panel-stock', 'panel-skeleton', 'panel-photo', 'panel-stamp', 'panel-new', 'panel-view']);
  });

  it('the first look is the mockup\'s: Board and Surface open, Output folded', () => {
    initSidebarTabs();
    expect(SIDEBAR_DEFAULT_OPEN).toEqual(['board', 'surface']);
    expect(shown()).toEqual([...BOARD, ...SURFACE]);
    expect($('sidebarTab_board').getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-branch="output"] .sidebar-branch-caret').textContent).toBe(BRANCH_CARET.folded);
  });

  it('a caret folds and unfolds its own branch only; the open set is remembered per device', () => {
    initSidebarTabs();
    document.querySelector('[data-branch="board"] .sidebar-branch-caret').click();
    expect(shown()).toEqual(SURFACE);
    document.querySelector('[data-branch="output"] .sidebar-branch-caret').click();
    expect(shown()).toEqual([...SURFACE, ...OUTPUT]);
    expect(JSON.parse(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY))).toEqual(['surface', 'output']);
    document.body.innerHTML = SIDEBAR;
    initSidebarTabs();
    expect(shown()).toEqual([...SURFACE, ...OUTPUT]);
  });

  it('a branch label (the former tab id) opens its branch and scrolls to it -- a second tap never folds it', () => {
    initSidebarTabs();
    toggleSidebarBranch('surface');
    const head = document.querySelector('[data-branch="surface"] .sidebar-branch-head');
    head.scrollIntoView = vi.fn();
    $('sidebarTab_surface').click();
    expect(shown()).toContain('panel-brick');
    expect(head.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    $('sidebarTab_surface').click();
    expect(shown()).toContain('panel-brick');
    expect(head.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('the retired Decor id: setSidebarTab("decor") opens Surface and scrolls to its 2D editor group; no element carries it', () => {
    expect(SIDEBAR_TAB_ALIASES.decor).toEqual({ tab: 'surface', group: 'editor' });
    initSidebarTabs();
    toggleSidebarBranch('surface');
    const group = $('sidebarGroup_editor');
    group.scrollIntoView = vi.fn();
    setSidebarTab('decor');
    expect(shown()).toContain('panel-brick');
    expect(group.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect($('sidebarTab_decor')).toBeNull();
  });

  it('a group whose sections are all pinned away hides its heading; one back shows it again', () => {
    initSidebarTabs();
    for (const k of ['panel-photo', 'panel-brick', 'panel-stamp']) toggleSidebarPin(k);
    expect($('sidebarGroup_editor').hidden).toBe(true);
    toggleSidebarPin('panel-brick');
    expect($('sidebarGroup_editor').hidden).toBe(false);
  });

  it('a device\'s saved state from before the merge: a stored "decor" open flag reads as Surface, the old Decor tab too', () => {
    expect(initialOpenBranches(['decor', 'output'], null)).toEqual(['surface', 'output']);
    expect(initialOpenBranches(['board'], 'decor')).toEqual(['board']); // a saved set wins
    expect(initialOpenBranches(null, 'decor')).toEqual(['board', 'surface']);
    expect(initialOpenBranches(null, 'output')).toEqual(['board', 'surface', 'output']);
    expect(initialOpenBranches(['gone'], null)).toEqual([]); // unknown ids dropped
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, JSON.stringify(['decor']));
    initSidebarTabs();
    expect(shown()).toEqual(SURFACE);
  });

  it('a device with no tree state yet: the default plus the tab it last had open', () => {
    localStorage.setItem(SIDEBAR_LEGACY_TAB_STORAGE_KEY, JSON.stringify('output'));
    initSidebarTabs();
    expect(shown()).toContain('panel-export');
  });

  it('a pinned section moves to the top, shows whatever is folded, and goes back into its place when unpinned', () => {
    initSidebarTabs();
    const brick = document.querySelector('.panel.panel-brick');
    const pin = brick.querySelector('.panel-header > .panel-pin');
    pin.click();
    expect(window.togglePanel).not.toHaveBeenCalled(); // the pin never folds the section
    expect(brick.parentElement.id).toBe('sidebarPinned');
    toggleSidebarBranch('board'); toggleSidebarBranch('surface');
    expect(shown()).toEqual(['panel-brick']);
    expect(pin.classList.contains('pinned')).toBe(true);
    expect(JSON.parse(localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY))).toEqual(['panel-brick']);
    toggleSidebarPin('panel-brick');
    expect(inBranch('surface')).toEqual(SURFACE);
    expect(brick.parentElement.id).toBe('sidebarGroup_editor');
  });

  it('the pinned block sits first among the sections; pins keep the declared order', () => {
    initSidebarTabs();
    toggleSidebarPin('panel-view');
    toggleSidebarPin('panel-stamp');
    toggleSidebarPin('panel-thicken');
    const box = $('sidebarPinned');
    expect(box.parentElement.firstElementChild).toBe(box);
    expect([...box.children].map((p) => sectionKey(p.classList))).toEqual(['panel-thicken', 'panel-stamp', 'panel-view']);
  });

  it('revealSidebarSection: its branch opens and the section unfolds (the brick matrix uses it); a pinned one stays put', () => {
    window.togglePanel = (h) => h.classList.toggle('collapsed');
    initSidebarTabs();
    toggleSidebarBranch('surface');
    const header = document.querySelector('.panel.panel-brick > .panel-header');
    expect(header.classList.contains('collapsed')).toBe(true);
    revealSidebarSection('panel-brick');
    expect(shown()).toContain('panel-brick');
    expect(header.classList.contains('collapsed')).toBe(false);
    toggleSidebarPin('panel-view');
    revealSidebarSection('panel-view');
    expect($('sidebarTab_output').getAttribute('aria-expanded')).toBe('false');
  });

  it('a section no branch declares falls into the declared default (never vanishes)', () => {
    expect(tabOfSection('panel-something-new')).toBe('surface');
  });

  it('blocked storage: starts on the default open set with nothing pinned, and still folds / opens', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      initSidebarTabs();
      expect(shown()).toEqual([...BOARD, ...SURFACE]);
      setSidebarTab('output');
      expect(shown()).toContain('panel-export');
    } finally { get.mockRestore(); set.mockRestore(); }
  });
});
