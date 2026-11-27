/**
 * Redesign phase 4, the Draw tab (Fred's mockups shots/seatD/redesign/mock_Draw_*; advisor 2026-10-15: no Pen branch --
 * its settings are General's; no Edit branch -- the selection bar): the Draw drawer is ONE collapse tree
 * (main/draw-tree.js) on the shared mechanism (main/drawer-tree.js); the drawing tools' settings are the context bar's
 * (main/editor-tool-bar.js), so the tree holds the layer's own (Stamp). The REAL palette body.
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
  it('Stamp only -- no General / Text / Expand (the context bar), no Pen, no Edit, no Layers; the Art-tab strip hides on this tab (its buttons kept)', () => {
    // DRAW-STAMP U (location only): + the Stamp branch, the selected layer's stamp settings moved in from the sidebar
    // the editor layer stack (Fred 2026-11-24): the Layers branch retired -- the stack above the panel lists the layers
    // the context bar (owner 2026-11-27): General / Text / Expand were TOOL settings -- the active tool's row of the bar
    expect(DRAW_DRAWER_TREE.map((b) => b.id)).toEqual(['stamp']);
    expect($('editorLayersList')).toBeNull();
    for (const t of ART_TABS) { expect($(`artTab_${t.id}`), t.id).not.toBeNull(); expect($(`artTab_${t.id}`).style.display, t.id).toBe('none'); }
  });
  it('the side panel holds none of the drawing tools\' groups (stroke / colour / fill, font, expand)', () => {
    for (const g of ['editorStrokeGroup', 'editorColorGroup', 'editorFillModeGroup', 'editorFontGroup', 'editorSymbolKeyboardToggle', 'editorExpandGroup']) {
      expect($('editorLayersPanel').contains($(g)), g).toBe(false);
    }
  });
  it('the first look: Stamp folded; the caret opens it; the open set is remembered', () => {
    expect(open('stamp')).toBe(false);
    branch('stamp').querySelector('.drawer-branch-caret').click();
    expect(open('stamp')).toBe(true);
    expect(JSON.parse(localStorage.getItem(DRAW_TREE_OPEN_KEY))).toContain('stamp');
  });
  it('no tab borrows a Layers list any more: the Brick slot keeps only its start hint', () => {
    setEditorTab('brick');
    expect([...$('brickLayersSlot').children].map((c) => c.id)).toEqual(['brickStartHint']);
    setEditorTab('artwork');
    expect($('drawLayersBody')).toBeNull();
  });
  // Fred 2026-11-24 (tool-row duplicates, the Brick tab's fix applied here): the Text / Expand cards repeated the tool
  // rail's Text / Expand buttons -- now only the ARMED tool's card shows; General, Layers, Stamp as before
  it('no tool card: every tool shows the same Stamp card (the tools\' settings are the context bar\'s)', () => {
    const shown = () => [...$('drawDrawerTree').querySelectorAll(':scope > .drawer-branch')].filter((s) => s.style.display !== 'none').map((s) => s.dataset.branch);
    expect(DRAW_DRAWER_TREE.filter((b) => b.armsTool)).toEqual([]);
    for (const m of ['select', 'draw', 'node', 'line', 'rect', 'circle', 'erase', 'cut', 'stripe', 'text', 'expand']) {
      setMode(m);
      expect(shown(), m).toEqual(['stamp']);
    }
  });
  it('the tree shows on the Draw tab only', () => {
    setEditorTab('lattice');
    expect($('drawDrawerTree').style.display).toBe('none');
    setEditorTab('artwork');
    expect($('drawDrawerTree').style.display).toBe('');
  });
});
