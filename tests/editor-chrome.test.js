/**
 * Redesign phase 3 (Fred's mockups + his phone shot: "the second top row wraps over ~3 lines and wastes canvas"): the
 * editor's permanent rows hold TOOLS only. main/editor-chrome.js MOVES the rest (ids, handlers kept): the selection
 * actions into a floating bar shown only with a selection, Fit into the canvas corner, the grid settings into one
 * "Grid ▾" popover; the touch row keeps Cancel (while drawing), Paste / Select all are the long-press menu's.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { SELECTION_BAR, SELECTION_BAR_MODES, CANVAS_CORNER, GRID_POPOVER, TOUCH_ROW, initEditorChrome, syncSelectionBar, syncTouchRow, syncCanvasCorner } from '../bspline-frame-builder/b-spline-gen/html/main/editor-chrome.js';
import { CONTEXT_MENU_ITEMS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-context-menu.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);
const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t });

describe('the editor chrome: tools-only rows', () => {
  beforeEach(() => {
    document.body.innerHTML = BODY;
    for (const id of ['toolDelete', 'toolResetTransform', 'toolFit']) document.getElementById(id).style.display = 'none'; // as the Art tabs leave them before the move
    window.svgEditor = { _selectedElements: [], _isDrawing: false, _currentMode: 'select' };
    window.requestAnimationFrame = (cb) => cb();
    initEditorChrome();
  });

  it('the selection actions are MOVED into the selection bar (same elements, ids kept), hidden with nothing selected', () => {
    const bar = $('editorSelectionBar');
    for (const id of SELECTION_BAR) expect($(id).parentElement, id).toBe(bar);
    expect([...bar.children].map((b) => b.id)).toEqual([...SELECTION_BAR]);
    expect(bar.style.display).toBe('none');
    expect($('editorToolbarArtwork').contains($('toolDelete'))).toBe(false);
    for (const id of SELECTION_BAR) expect($(id).style.display, id).toBe(''); // a moved button is shown in the bar
    expect($('toolFit').style.display).toBe('');
  });

  it('a selection shows the bar, placed above it inside the canvas host; deselecting hides it', () => {
    const bar = $('editorSelectionBar'), host = bar.parentElement;
    host.getBoundingClientRect = () => rect(0, 0, 390, 600);
    bar.getBoundingClientRect = () => rect(0, 0, 200, 48);
    window.svgEditor._selectedElements = [{ node: { getBoundingClientRect: () => rect(100, 300, 200, 400) } }];
    syncSelectionBar();
    expect(bar.style.display).toBe('flex');
    expect(parseFloat(bar.style.top)).toBeLessThan(300); // above the selection
    expect(parseFloat(bar.style.left)).toBeGreaterThanOrEqual(4);
    window.svgEditor._currentMode = 'draw'; // a drawing tool: the stroke just drawn is selected, the canvas stays clear
    document.dispatchEvent(new CustomEvent('editorModeChanged'));
    expect(bar.style.display).toBe('none');
    expect(SELECTION_BAR_MODES).toEqual(['select', 'node', 'brickElementSelect']);
    window.svgEditor._currentMode = 'select';
    window.svgEditor._selectedElements = [];
    document.dispatchEvent(new CustomEvent('editorSelectionChanged'));
    expect(bar.style.display).toBe('none');
  });

  it('Fit is in the canvas corner (and stays in the long-press menu)', () => {
    for (const id of CANVAS_CORNER) expect($(id).parentElement.id).toBe('editorCanvasCorner');
    expect(CONTEXT_MENU_ITEMS.some((i) => i.id === 'fit-view')).toBe(true);
  });

  it('the corner sits in the VISIBLE canvas: inside #editorSVGContainer, above the phone drawer\x27s top', () => {
    const corner = $('editorCanvasCorner'), host = corner.parentElement;
    host.getBoundingClientRect = () => rect(0, 100, 390, 844);
    $('editorSVGContainer').getBoundingClientRect = () => rect(0, 130, 360, 844); // a side panel takes the right 30 px
    corner.getBoundingClientRect = () => rect(0, 0, 34, 34);
    const drawer = $('editorMobileDrawer');
    drawer.getClientRects = () => [1]; drawer.getBoundingClientRect = () => rect(0, 748, 390, 844);
    syncCanvasCorner();
    const left = parseFloat(corner.style.left), top = parseFloat(corner.style.top);
    expect(left + 34).toBeLessThanOrEqual(360);  // inside the canvas, not under the panel
    expect(100 + top + 34).toBeLessThanOrEqual(748); // above the drawer
  });
  it('the grid settings are one "Grid ▾" button + a popover holding the same controls', () => {
    const group = $(GRID_POPOVER.group), pop = $('editorGridPopover');
    expect($('editorGridButton').textContent).toBe('Grid ▾');
    for (const id of GRID_POPOVER.moves) expect(pop.contains($(id)), id).toBe(true);
    expect([...group.children].map((c) => c.id)).toEqual(['editorGridButton', 'editorGridPopover']); // no label, no divider
    expect(pop.style.display).toBe('none');
    $('editorGridButton').click();
    expect(pop.style.display).toBe('flex');
    document.body.click();
    expect(pop.style.display).toBe('none');
  });

  it('the touch row: Paste / Select all are the long-press menu\'s; Cancel only while a pen path is drawn', () => {
    for (const id of TOUCH_ROW.menuOnly) expect($(id).style.display).toBe('none');
    expect(CONTEXT_MENU_ITEMS.map((i) => i.id)).toEqual(expect.arrayContaining(['paste', 'select-all']));
    expect($('editorTouchCancel').style.display).toBe('none');
    window.svgEditor._isDrawing = true;
    syncTouchRow();
    expect($('editorTouchCancel').style.display).toBe('');
  });
});
