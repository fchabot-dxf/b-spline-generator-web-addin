/**
 * Redesign phase 4, the Draw tab (Fred's mockups shots/seatD/redesign/mock_Draw_*; advisor 2026-10-15: no Pen branch --
 * its settings are General's; no Edit branch -- the selection bar): the Draw drawer is ONE collapse tree
 * (main/draw-tree.js) on the shared mechanism (main/drawer-tree.js). Its branches' content comes in through the Draw
 * tab's declared panelHosts, so another tab (Brick: the Layers) can borrow it and give it back. The REAL palette body.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { initArtTabs, ART_TABS } from '../bspline-frame-builder/b-spline-gen/html/main/art-tabs.js';
import { DRAW_DRAWER_TREE, DRAW_TREE_OPEN_KEY, drawBranchDomId, initDrawTree } from '../bspline-frame-builder/b-spline-gen/html/main/draw-tree.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);
const branch = (id) => $(drawBranchDomId(id));
const open = (id) => branch(id).classList.contains('open');
const inBranch = (id, el) => branch(id).contains($(el));
const setMode = (m) => { window.svgEditor._currentMode = m; document.dispatchEvent(new CustomEvent('editorModeChanged', { detail: { mode: m } })); };

beforeEach(() => {
  try { localStorage.removeItem(DRAW_TREE_OPEN_KEY); } catch (_) { /* blocked */ }
  document.body.innerHTML = BODY;
  window.svgEditor = { _currentMode: 'select', setMode: (m) => setMode(m) };
  initArtTabs();
  initDrawTree();
  setEditorTab('artwork');
});

describe('the Draw tree', () => {
  it('General, Text, Expand, Layers -- no Pen, no Edit; the Art-tab strip hides on this tab (its buttons kept)', () => {
    expect(DRAW_DRAWER_TREE.map((b) => b.id)).toEqual(['general', 'text', 'expand', 'layers']);
    for (const t of ART_TABS) { expect($(`artTab_${t.id}`), t.id).not.toBeNull(); expect($(`artTab_${t.id}`).style.display, t.id).toBe('none'); }
  });
  it('each branch holds its content: stroke / colour / fill in General, the font group in Text, Expand\'s group, the Layers', () => {
    for (const g of ['editorStrokeGroup', 'editorColorGroup', 'editorFillModeGroup']) expect(inBranch('general', g), g).toBe(true);
    for (const g of ['editorFontGroup', 'editorSymbolKeyboardToggle']) expect(inBranch('text', g), g).toBe(true);
    expect(inBranch('expand', 'editorExpandGroup')).toBe(true);
    for (const g of ['editorLayersHeader', 'editorLayersList']) expect(inBranch('layers', g), g).toBe(true);
  });
  it('the first look: General open, the rest folded; the open set is remembered per device', () => {
    expect(open('general')).toBe(true);
    expect(open('layers')).toBe(false);
    branch('layers').querySelector('.drawer-branch-head').click();
    expect(open('layers')).toBe(true);
    expect(JSON.parse(localStorage.getItem(DRAW_TREE_OPEN_KEY))).toContain('layers');
  });
  it('a tool branch is the tool\'s: the Text header arms the Text tool; the text mode opens it, another mode folds it', () => {
    const click = vi.fn(); $('toolText').addEventListener('click', click);
    branch('text').querySelector('.drawer-branch-head').click();
    expect(click).toHaveBeenCalled();
    setMode('text');
    expect(open('text')).toBe(true);
    setMode('select');
    expect(open('text')).toBe(false);
  });
  it('the Brick tab borrows the Layers and gives them back INTO the tree (the active tab is applied last)', () => {
    setEditorTab('brick');
    expect($('brickLayersSlot').contains($('editorLayersList'))).toBe(true);
    setEditorTab('artwork');
    expect(inBranch('layers', 'editorLayersList')).toBe(true);
  });
  it('the tree shows on the Draw tab only', () => {
    setEditorTab('lattice');
    expect($('drawDrawerTree').style.display).toBe('none');
    setEditorTab('artwork');
    expect($('drawDrawerTree').style.display).toBe('');
  });
});
