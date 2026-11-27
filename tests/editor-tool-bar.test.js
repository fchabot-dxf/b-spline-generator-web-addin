/**
 * The editor's CONTEXT BAR (owner 2026-11-27: "go over all features and tools and see how to move some of the tool settings
 * over there"): main/editor-tool-bar.js -- ONE declared table (EDITOR_TOOL_BAR, per tab and tool), ONE sync. A TOOL's settings
 * (the next stroke, the selection) show in the strip at the top of the canvas and change with the tool; a LAYER's settings stay
 * in the side panel; a setting shows in ONE place. Owner rule: "5-6 at most per context" -- every row <= 6 items, the rest in
 * its '⋯'. The REAL palette body.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EDITOR_TOOL_BAR, TOOL_BAR_MAX_ITEMS, toolBarItems, toolBarItemCount, toolBarHostIds, initEditorToolBar, syncToolBar, openToolBarMore, activeToolBarKey,
} from '../bspline-frame-builder/b-spline-gen/html/main/editor-tool-bar.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { initLatticeSideColumn, LATTICE_KIND_ROW_IDS } from '../bspline-frame-builder/b-spline-gen/html/editor/lattice-side-column.js';
import { mountSelectedPiecePanel, PIECE_COLOUR_IDS } from '../bspline-frame-builder/b-spline-gen/html/editor/lattice-piece-panel.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);
const bar = () => $('editorToolBar');
const activeRow = () => [...bar().querySelectorAll('[data-tool-bar-row]')].find((r) => r.style.display !== 'none') || null;
const inBar = (id) => !!activeRow() && activeRow().contains($(id));
const SIDE_PANELS = ['editorLayersPanel', 'editorBrickPanel', 'editorHeightPanel', 'editorFramePanel', 'editorStripePanel', 'editorLatticePanel', 'editorShapeLatticePanel'];
const inSidePanel = (id) => SIDE_PANELS.some((p) => $(p) && $(p).contains($(id)));
const setMode = (m) => { window.svgEditor._currentMode = m; document.dispatchEvent(new CustomEvent('editorModeChanged', { detail: { mode: m, editor: window.svgEditor } })); };
const flat = (items) => items.flatMap((i) => (i.more ? flat(i.more) : [i]));

describe('the declared table (owner: "5-6 at most per context")', () => {
  it('every declared row shows at most six items on the bar -- a \'⋯\' and the tab\'s end items included', () => {
    for (const [tab, tools] of Object.entries(EDITOR_TOOL_BAR)) {
      for (const tool of Object.keys(tools)) expect(toolBarItemCount(toolBarItems(tab, tool)), `${tab}:${tool}`).toBeLessThanOrEqual(TOOL_BAR_MAX_ITEMS);
    }
    expect(TOOL_BAR_MAX_ITEMS).toBe(6);
  });
  it('a row lists a hosted group once, and a \'⋯\' only at the row\'s top level, never empty', () => {
    for (const [tab, tools] of Object.entries(EDITOR_TOOL_BAR)) {
      for (const [tool, items] of Object.entries(tools)) {
        const ids = flat(items).filter((i) => i.host).map((i) => i.host);
        expect(new Set(ids).size, `${tab}:${tool}`).toBe(ids.length);
        for (const m of items.filter((i) => i.more)) { expect(m.more.length, `${tab}:${tool}`).toBeGreaterThan(0); expect(m.more.some((i) => i.more)).toBe(false); }
        expect(items.filter((i) => i.more).length, `${tab}:${tool}`).toBeLessThanOrEqual(1);
      }
    }
  });
  it('the Draw tab\'s, the Stripe tool\'s and the Brick tab\'s markup hosts are in the real palette', () => {
    const doc = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html');
    const built = /^(editor(Shape)?Lattice(KindRow|PieceColour)|heightCtl_|heightSel|heightFillApply|brickSubTools_|brickHeightPickRow_|brickBlocksRow_|brickWallAreaRow)/;
    for (const id of toolBarHostIds()) if (!built.test(id)) expect(doc.getElementById(id), id).not.toBeNull();
  });
});

describe('the bar in the real editor', () => {
  beforeEach(() => {
    document.body.innerHTML = BODY.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
    window.svgEditor = { _currentMode: 'select', _lattice: { drawKind: 'select' } };
    initEditorToolBar();
    setEditorTab('artwork');
  });
  afterEach(() => { setEditorTab('artwork'); delete window.svgEditor; });

  it('Draw, Select: Stroke, Colour, Style (and the Font group) are in the bar, none in the side panel', () => {
    expect(activeToolBarKey()).toBe('select');
    for (const id of ['editorStrokeGroup', 'editorColorGroup', 'editorFillModeGroup', 'editorFontGroup']) {
      expect(inBar(id), id).toBe(true);
      expect(inSidePanel(id), id).toBe(false);
    }
    expect($('editorToolBarGroup').hidden).toBe(false);
  });
  it('a tool switch swaps the row: Text -> Font + Colour; Expand -> its group; Eraser -> the stroke width only; Cut -> no bar', () => {
    setMode('text');
    expect(inBar('editorFontGroup')).toBe(true); expect(inBar('editorColorGroup')).toBe(true); expect(inBar('editorStrokeGroup')).toBe(false);
    expect(inBar('editorSymbolKeyboardToggle')).toBe(true);
    setMode('expand');
    expect(inBar('editorExpandGroup')).toBe(true); expect(inBar('editorFontGroup')).toBe(false);
    expect($('editorFontGroup').closest('#editorToolBarParked')).not.toBeNull(); // parked, hidden -- never back in a panel
    setMode('erase');
    expect(inBar('editorStrokeGroup')).toBe(true); expect(inBar('editorColorGroup')).toBe(false);
    setMode('cut');
    expect(activeRow()).toBeNull();
    expect($('editorToolBarGroup').hidden).toBe(true);
  });
  it('a moved control is the same element (its id, its wiring): one #editorStrokeWidth, its value kept', () => {
    $('editorStrokeWidth').value = '0.85';
    setMode('draw'); setMode('text'); setMode('line');
    expect(document.querySelectorAll('#editorStrokeWidth').length).toBe(1);
    expect($('editorStrokeWidth').value).toBe('0.85');
    expect(inBar('editorStrokeWidth')).toBe(true);
  });
  it('Stripe (Draw and Lattice): By Count / Length, the count, the pattern, the colours on the bar; the ratio, Use C, the presets in its \'⋯\'', () => {
    for (const tab of ['artwork', 'lattice']) {
      setEditorTab(tab);
      setMode('stripe');
      for (const id of ['stripeDriveRow', 'stripeCountRow', 'stripePatternPresets', 'stripeColorSwatches']) expect(inBar(id), `${tab} ${id}`).toBe(true);
      const sheet = openToolBarMore();
      for (const id of ['stripePatternRatioRow', 'stripeColoursHead', 'stripeColorPresets']) expect(sheet.contains($(id)), `${tab} ${id}`).toBe(true);
      expect(sheet.hidden).toBe(false);
      expect($('stripeThree').closest('.tool-bar-more-sheet')).toBe(sheet);
      expect($('editorStripePanel').classList.contains('hidden')).toBe(true); // no side column of its own
    }
  });
  it('the \'⋯\' sheet closes on a click outside it, on Esc, and on a tool switch', () => {
    setMode('stripe');
    let sheet = openToolBarMore();
    document.body.click();
    expect(sheet.hidden).toBe(true);
    sheet = openToolBarMore();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(sheet.hidden).toBe(true);
    sheet = openToolBarMore();
    setMode('select');
    expect(sheet.hidden).toBe(true);
  });
  it('Lattice: the add-kind row (Select / Rail / Tie / Node) and the selected piece\'s Colour / Reset are in the bar; the piece Width stays in the panel', () => {
    const editor = window.svgEditor;
    mountSelectedPiecePanel(editor, $('editorLatticePanelBody'));
    initLatticeSideColumn(editor);
    setEditorTab('lattice');
    setMode('lattice');
    expect(inBar(LATTICE_KIND_ROW_IDS.lattice)).toBe(true);
    expect($(LATTICE_KIND_ROW_IDS.lattice).querySelectorAll('button.tool-btn').length).toBe(4);
    expect(inBar(PIECE_COLOUR_IDS.editorLatticePanelBody)).toBe(true);
    const width = $('editorLatticePanelBody').querySelector('.lattice-piece-width-row');
    expect(width && !activeRow().contains(width)).toBe(true);
    setMode('shapeLattice');
    expect(inBar(LATTICE_KIND_ROW_IDS.shapeLattice)).toBe(true);
    expect(inBar(LATTICE_KIND_ROW_IDS.lattice)).toBe(false);
  });
  it('a tab without rows (the Wood frame) shows no bar and parks every hosted group', () => {
    setEditorTab('frame');
    expect($('editorToolBarGroup').hidden).toBe(true);
    for (const id of ['editorStrokeGroup', 'stripeCountRow']) expect($(id).closest('#editorToolBarParked'), id).not.toBeNull();
    syncToolBar();
    expect(activeRow()).toBeNull();
  });
});
