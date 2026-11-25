/**
 * Redesign phase 4, the Draw tab (Fred's mockups shots/seatD/redesign/mock_Draw_*; advisor 2026-10-15: no Pen branch --
 * its settings are General's; no Edit branch -- the selection bar): the Draw drawer is ONE collapse tree
 * (main/draw-tree.js) on the shared mechanism (main/drawer-tree.js). Its branches' content comes in through the Draw
 * tab's declared panelHosts, so another tab (Brick: the Layers) can borrow it and give it back. The REAL palette body.
 */
import { describe, it, expect, beforeEach } from 'vitest';
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
  it('General, Text, Expand, Stamp -- no Pen, no Edit, no Layers; the Art-tab strip hides on this tab (its buttons kept)', () => {
    // DRAW-STAMP U (location only): + the Stamp branch, the selected layer's stamp settings moved in from the sidebar
    // the editor layer stack (Fred 2026-11-24): the Layers branch retired -- the stack above the panel lists the layers
    expect(DRAW_DRAWER_TREE.map((b) => b.id)).toEqual(['general', 'text', 'expand', 'stamp']);
    expect($('editorLayersList')).toBeNull();
    for (const t of ART_TABS) { expect($(`artTab_${t.id}`), t.id).not.toBeNull(); expect($(`artTab_${t.id}`).style.display, t.id).toBe('none'); }
  });
  it('each branch holds its content: stroke / colour / fill in General, the font group in Text, Expand\'s group, the Layers', () => {
    for (const g of ['editorStrokeGroup', 'editorColorGroup', 'editorFillModeGroup']) expect(inBranch('general', g), g).toBe(true);
    for (const g of ['editorFontGroup', 'editorSymbolKeyboardToggle']) expect(inBranch('text', g), g).toBe(true);
    expect(inBranch('expand', 'editorExpandGroup')).toBe(true);
  });
  it('the first look: General open (the layers are in the stack above); the caret folds; the open set is remembered', () => {
    expect(open('general')).toBe(true);
    branch('general').querySelector('.drawer-branch-caret').click();
    expect(open('general')).toBe(false);
    expect(JSON.parse(localStorage.getItem(DRAW_TREE_OPEN_KEY))).not.toContain('general');
  });
  it('a tool branch is the tool\'s: the text mode opens it, another mode folds it', () => {
    setMode('text');
    expect(open('text')).toBe(true);
    setMode('select');
    expect(open('text')).toBe(false);
  });
  it('no tab borrows a Layers list any more: the Brick slot keeps only its start hint', () => {
    setEditorTab('brick');
    expect([...$('brickLayersSlot').children].map((c) => c.id)).toEqual(['brickStartHint']);
    setEditorTab('artwork');
    expect($('drawLayersBody')).toBeNull();
  });
  // Fred 2026-11-24 (tool-row duplicates, the Brick tab's fix applied here): the Text / Expand cards repeated the tool
  // rail's Text / Expand buttons -- now only the ARMED tool's card shows; General, Layers, Stamp as before
  it('only the armed tool\'s card shows: Pen / Select / the other tools show none, Text and Expand each their own (open, titled)', () => {
    const shown = () => [...$('drawDrawerTree').querySelectorAll(':scope > .drawer-branch')].filter((s) => s.style.display !== 'none').map((s) => s.dataset.branch);
    const free = DRAW_DRAWER_TREE.filter((b) => !b.armsTool).map((b) => b.id);
    expect(free).toEqual(['general', 'stamp']);
    for (const m of ['select', 'draw', 'node', 'line', 'rect', 'circle', 'erase', 'cut', 'stripe']) {
      setMode(m);
      expect(shown(), m).toEqual(free);
    }
    for (const b of DRAW_DRAWER_TREE.filter((x) => x.armsTool)) {
      setMode(b.armsTool);
      expect(shown(), b.id).toEqual(DRAW_DRAWER_TREE.filter((x) => !x.armsTool || x.id === b.id).map((x) => x.id));
      expect(open(b.id), b.id).toBe(true);
      expect(branch(b.id).querySelector('.drawer-branch-title').textContent, b.id).toBe(b.title);
    }
  });
  it('the tree shows on the Draw tab only', () => {
    setEditorTab('lattice');
    expect($('drawDrawerTree').style.display).toBe('none');
    setEditorTab('artwork');
    expect($('drawDrawerTree').style.display).toBe('');
  });
});
