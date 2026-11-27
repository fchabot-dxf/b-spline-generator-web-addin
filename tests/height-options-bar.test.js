/**
 * HEIGHT-PAINTER options bar (Fred 2026-11-23, phone shot: "In height this space is dead, use it to display information or
 * input fields") -- since 2026-11-27 the Height tab's rows of the editor's CONTEXT BAR (main/editor-tool-bar.js, one table:
 * EDITOR_TOOL_BAR.height = HEIGHT_OPTIONS_BAR, one row per HEIGHT_TOOLS id): the active tool's settings, at most six items
 * (the '⋯' and the stock line included), the rest in the row's '⋯' sheet. A setting shows in ONE place (owner): the brush's
 * settings are no longer a side-panel section too. The stock range line ends every row, from the panel's own function.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { setHeightStockReport } from '../bspline-frame-builder/b-spline-gen/html/core/stock.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, heightBrush, heightToolSettings, setHeightTool, HEIGHT_TOOLS,
  HEIGHT_OPTIONS_BAR, heightStockLines, pickHeightGrey, selectHeightRect, heightSelection,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { openToolBarMore, toolBarItems, toolBarItemCount, TOOL_BAR_MAX_ITEMS } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tool-bar.js';

const saved = {};
beforeEach(() => {
  Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn, cz: P.carveZ });
  P.widthIn = 2; P.heightIn = 2; P.carveZ = 1.5; P.heightLayers = DEFAULT.heightLayers;
  document.body.innerHTML = '<div id="editorToolbarTop"><div id="editorToolBarGroup" hidden><div id="editorToolBar"></div></div><div id="editorToolBarParked" hidden></div></div>'
    + '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div><div id="editorCanvasContainer"></div>';
  _resetHeightPanelForTests();
  window.svgEditor = { _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() {}, _notifyChange() {} };
  setHeightStockReport(null);
  initHeightPanel({});
  setEditorTab('height');
});
afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; P.carveZ = saved.cz; setHeightStockReport(null); delete window.svgEditor; setEditorTab('artwork'); });

const bar = () => document.getElementById('editorToolBar');
const row = (tool) => bar().querySelector(`[data-height-bar-tool="${tool}"]`);
const shown = (tool) => { setHeightTool(tool); const r = row(tool); return r && r.style.display !== 'none' ? r : null; };
const barNum = (tool, id) => row(tool).querySelector(`[data-height-bar="${id}"]`);
const barChoice = (tool, id, key) => row(tool).querySelector(`[data-height-choice="${id}:${key}"]`);
const inPanel = (el) => !!el && document.getElementById('heightPanelBody').contains(el);
const flat = (items) => items.flatMap((i) => (i.more ? flat(i.more) : [i]));

describe('the declared table', () => {
  it('has a row for tools of HEIGHT_TOOLS only, each control item names a real control, and no row shows more than six items', () => {
    const toolIds = HEIGHT_TOOLS.map((t) => t.id);
    for (const [tool, items] of Object.entries(HEIGHT_OPTIONS_BAR)) {
      expect(toolIds, tool).toContain(tool);
      for (const it of items) if (it.control) expect(row(tool).querySelector(`[data-height-control-bar="${it.control}"]`), `${tool}.${it.control}`).toBeTruthy();
      expect(toolBarItemCount(toolBarItems('height', tool)), tool).toBeLessThanOrEqual(TOOL_BAR_MAX_ITEMS);
    }
    for (const t of HEIGHT_TOOLS) expect(row(t.id), t.id).toBeTruthy(); // every tool has its row (the stock line at least)
  });
});

describe('the Height rows', () => {
  it('the group shows with the Height tool\'s row (the shared context bar)', () => {
    const g = document.getElementById('editorToolBarGroup');
    expect(g.style.display).toBe('flex');
    setEditorTab('frame');
    expect(g.style.display).toBe('none');
  });
  it('the brush row: Size, Mode, the grey chip, Opacity on the bar; Invert, Hardness, Flow, Spacing ... in its \'⋯\' (Tip / Falloff: the panel\'s)', () => {
    const r = shown('brush');
    expect(r).toBeTruthy();
    expect(barNum('brush', 'sizeIn')).toBeTruthy();
    expect(barChoice('brush', 'mode', 'set')).toBeTruthy();
    expect(barNum('brush', 'opacity')).toBeTruthy();
    expect(r.querySelector('.height-bar-chip-text').textContent).toMatch(/^\d+% · [+-]\d\.\d\d in$/);
    const sheet = openToolBarMore();
    expect(sheet.hidden).toBe(false);
    expect(r.contains(sheet)).toBe(true);
    for (const id of ['hardness', 'flow', 'spacing', 'pressureSize', 'pressureOpacity', 'buildUp', 'invert', 'amountIn', 'targetIn']) {
      expect(sheet.contains(document.getElementById(`heightCtl_${id}`)), id).toBe(true);
    }
    // the visual choices stay in the side panel (owner 2026-11-27): the brush's Tip & falloff section, its pickers
    for (const id of ['tip', 'falloff']) expect(inPanel(document.querySelector(`[data-height-control="${id}"]`)), id).toBe(true);
    expect(r.querySelector('[data-height-choice^="tip:"], [data-height-choice^="falloff:"]')).toBeNull();
    expect(sheet.querySelector('[data-height-choice="invert:true"]')).toBeTruthy();
    expect(sheet.querySelector('[data-height-control-bar="greyZero"]')).toBeTruthy();
  });
  it('only the active tool\'s row shows; a tool switch swaps it', () => {
    shown('brush');
    expect(row('wand').style.display).toBe('none');
    expect(shown('wand')).toBeTruthy();
    expect(row('brush').style.display).toBe('none');
  });
  it('the eraser row: the size and the brush\'s own settings; no mode, no invert (their declared showWhen)', () => {
    const r = shown('eraser');
    expect(r.querySelector('[data-height-bar="sizeIn"]')).toBeTruthy();
    expect(r.querySelector('[data-height-choice^="mode:"]')).toBeNull();
    openToolBarMore();
    expect(r.contains(document.getElementById('heightCtl_hardness'))).toBe(true);
    expect(r.querySelector('[data-height-choice^="invert:"]')).toBeNull();
  });
  it('the selection tools: New + Feather on each row; Clear / Invert hosted (one node); the wand adds tolerance + contiguous; gradient and fill their fields', () => {
    for (const t of ['marquee', 'selectLasso', 'wand']) {
      const r = shown(t);
      expect(r, t).toBeTruthy();
      expect(r.querySelectorAll('[data-height-choice^="selCombine:"]').length, t).toBe(3);
      expect(barNum(t, 'featherIn'), t).toBeTruthy();
      openToolBarMore();
      expect(r.contains(document.getElementById('heightSelClear')), t).toBe(true);
      expect(r.contains(document.getElementById('heightSelInvert')), t).toBe(true);
    }
    expect(document.querySelectorAll('#heightSelClear').length).toBe(1);
    expect(barChoice('marquee', 'selShape', 'ellipse')).toBeTruthy();
    expect(barNum('wand', 'wandToleranceIn')).toBeTruthy();
    expect(row('wand').querySelector('[data-height-bar="wandContiguous"]').type).toBe('checkbox');
    expect(row('marquee').querySelector('[data-height-bar="wandToleranceIn"]')).toBeNull();
    shown('gradient'); expect(barNum('gradient', 'gradStartIn')).toBeTruthy(); expect(barNum('gradient', 'gradEndIn')).toBeTruthy();
    expect(barChoice('gradient', 'gradType', 'radial')).toBeTruthy(); expect(barChoice('gradient', 'gradMode', 'max')).toBeTruthy();
    shown('fill'); expect(barNum('fill', 'fillHeightIn')).toBeTruthy();
    expect(row('fill').contains(document.getElementById('heightFillApply'))).toBe(true);
  });
  it('the eyedropper: the Sample choice and the picked height; Select (move): a hint, Drop / Cancel only while a piece floats', () => {
    const r = shown('eyedropper');
    expect(r.querySelectorAll('[data-height-choice^="sampleFrom:"]').length).toBe(4);
    expect(r.querySelector('.height-bar-chip-text')).toBeTruthy();
    const m = shown('move');
    expect(m.querySelector('.height-bar-move-hint').style.display).not.toBe('none');
    for (const b of m.querySelectorAll('[data-height-bar-action^="move"]')) expect(b.style.display).toBe('none');
  });
});

describe('one setting, one place', () => {
  it('size: a number typed in the bar is the brush size; the panel holds no second Size', () => {
    shown('brush');
    const n = barNum('brush', 'sizeIn');
    n.value = '0.8'; n.dispatchEvent(new Event('change', { bubbles: true }));
    expect(heightBrush().sizeIn).toBeCloseTo(0.8, 6);
    expect(inPanel(document.getElementById('height_sizeIn'))).toBe(false);
    expect(document.getElementById('heightGroup_brush')).toBeTruthy();
    expect(inPanel(document.getElementById('heightGroup_brush'))).toBe(false);
  });
  it('the side panel shows none of the tools\' compact settings: no Brush, Selection, Wand, Sample, Gradient or Fill section', () => {
    for (const g of ['brush', 'select', 'wand', 'sample', 'gradient', 'fill']) expect(inPanel(document.getElementById(`heightGroup_${g}`)), g).toBe(false);
    for (const id of ['hardness', 'opacity', 'flow', 'gradOpacity', 'fillHeightIn', 'wandToleranceIn', 'sampleFrom', 'selCombine', 'featherIn']) {
      expect(inPanel(document.querySelector(`[data-height-control="${id}"]`)), id).toBe(false);
    }
  });
  it('the visual choices are the side panel\'s, each in its tool\'s section: Tip & falloff (brush), Gradient curve, Feather profile (selection tools)', async () => {
    await newHeightPatch();
    const shownInPanel = (id) => { const w = document.querySelector(`[data-height-control="${id}"]`); return inPanel(w) && !w.closest('[hidden]') && w.closest('.drawer-branch').style.display !== 'none'; };
    shown('brush'); for (const id of ['tip', 'falloff']) expect(shownInPanel(id), id).toBe(true);
    shown('gradient'); expect(shownInPanel('gradFalloff')).toBe(true);
    for (const t of ['marquee', 'selectLasso', 'wand', 'move']) { shown(t); expect(shownInPanel('featherProfile'), t).toBe(true); }
    shown('fill'); expect(shownInPanel('featherProfile')).toBe(false); // no selection, no selection tool
  });
  it('a hosted control in the \'⋯\' writes the same brush value its panel section did (Hardness); the panel\'s Tip pick shows the tip extras', () => {
    shown('brush');
    openToolBarMore();
    const h = document.getElementById('height_hardness');
    expect(row('brush').contains(h)).toBe(true);
    h.value = '0.3'; h.dispatchEvent(new Event('change', { bubbles: true }));
    expect(heightBrush().hardness).toBeCloseTo(0.3, 6);
    document.querySelector('#heightPanelBody [data-height-choice="tip:square"]').click();
    expect(heightBrush().tip).toBe('square');
    expect(document.querySelector('[data-height-control="roundness"]').hidden).toBe(false); // the square tip's extras show
  });
  it('a number sits in the app own stepper (.cad-stepper, which adds its - / +) with the declared step', () => {
    for (const [tool, id, step] of [['brush', 'sizeIn', 0.05], ['wand', 'wandToleranceIn', 0.005], ['fill', 'fillOpacity', 0.05]]) {
      shown(tool);
      const n = barNum(tool, id);
      expect(n.closest('.cad-stepper'), id).not.toBeNull();
      expect(Number(n.step), id).toBeCloseTo(step, 6);
      expect(n.closest('[data-height-bar-tool]').querySelectorAll('[data-height-bar-step]').length).toBe(0); // no second stepper of our own
    }
  });
  it('mode and invert: a bar button changes the brush and its active state follows', () => {
    shown('brush');
    barChoice('brush', 'mode', 'smooth').click();
    expect(heightBrush().mode).toBe('smooth');
    expect(barChoice('brush', 'mode', 'smooth').classList.contains('active')).toBe(true);
    barChoice('brush', 'mode', 'lower').click();
    expect(barChoice('brush', 'mode', 'lower').classList.contains('active')).toBe(true);
    expect(barChoice('brush', 'mode', 'smooth').classList.contains('active')).toBe(false);
    openToolBarMore();
    barChoice('brush', 'invert', 'true').click();
    expect(heightBrush().invert).toBe(true);
  });
  it('the wand row: combine, feather, tolerance, contiguous are the tool settings', () => {
    shown('wand');
    barChoice('wand', 'selCombine', 'add').click();
    expect(heightToolSettings('select').combine).toBe('add');
    expect(barChoice('wand', 'selCombine', 'add').classList.contains('active')).toBe(true);
    const f = barNum('wand', 'featherIn'); f.value = '0.2'; f.dispatchEvent(new Event('change', { bubbles: true }));
    expect(heightToolSettings('select').featherIn).toBeCloseTo(0.2, 6);
    const t = barNum('wand', 'wandToleranceIn'); t.value = '0.05'; t.dispatchEvent(new Event('change', { bubbles: true }));
    expect(heightToolSettings('wand').toleranceIn).toBeCloseTo(0.05, 6);
    const c = row('wand').querySelector('[data-height-bar="wandContiguous"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true }));
    expect(heightToolSettings('wand').contiguous).toBe(false);
  });
  it('Invert and Clear from the bar act on the selection', async () => {
    await newHeightPatch();
    shown('marquee');
    selectHeightRect([-0.5, -0.5], [0, 0]);
    const before = Array.from(heightSelection().mask);
    openToolBarMore();
    document.getElementById('heightSelInvert').click();
    expect(heightSelection().mask[0]).toBe(1 - before[0]);
    document.getElementById('heightSelClear').click();
    expect(heightSelection()).toBeNull();
  });
  it('the chip follows a grey pick and reads the height through the mapping', async () => {
    await newHeightPatch();
    expect(activeHeightLayer()).toBeTruthy();
    shown('brush');
    pickHeightGrey(0.6); // Range 0.25 in: 60 % grey = +0.05 in
    expect(row('brush').querySelector('.height-bar-chip-text').textContent).toBe('60% · +0.05 in');
  });
  it('every brush setting the panel section had is in the brush row (on the bar or in its \'⋯\') or in its visual section, never both', () => {
    const ids = new Set(flat(HEIGHT_OPTIONS_BAR.brush).map((i) => i.control || (i.host || '').replace(/^heightCtl_/, '')));
    for (const id of ['invert', 'mode', 'sizeIn', 'hardness', 'opacity', 'flow', 'spacing', 'amountIn', 'targetIn', 'pressureSize', 'pressureOpacity', 'buildUp']) expect(ids.has(id), id).toBe(true);
    for (const id of ['tip', 'falloff', 'customCurve', 'roundness', 'angle', 'followStroke']) {
      expect(ids.has(id), id).toBe(false);
      expect(inPanel(document.querySelector(`[data-height-control="${id}"]`)), id).toBe(true);
    }
  });
});

describe('the visual pickers (main/icon-select.js mountIconGrid: the Brick tab\'s picker)', () => {
  it.each([['tip', 'brush'], ['falloff', 'brush'], ['gradFalloff', 'gradient'], ['featherProfile', 'marquee']])('%s: a chip opens one tile per option with its icon; a pick writes the value the buttons did', async (id, tool) => {
    await newHeightPatch();
    shown(tool);
    const chip = document.getElementById(`height_${id}Chip`);
    expect(chip).toBeTruthy();
    const grid = document.getElementById(`height_${id}`);
    const tiles = [...grid.querySelectorAll('[data-height-choice]')];
    expect(tiles.length).toBeGreaterThan(2);
    chip.click();
    expect(grid.style.display).toBe('grid');
    for (const t of tiles) expect(t.querySelector('svg'), t.getAttribute('data-height-choice')).toBeTruthy();
    const pick = tiles[tiles.length - 1];
    const [, key] = pick.getAttribute('data-height-choice').split(':');
    pick.click();
    const target = id === 'gradFalloff' ? heightToolSettings('gradient').falloff : id === 'featherProfile' ? heightToolSettings('select').featherProfile : heightBrush()[id];
    expect(String(target)).toBe(key);
    expect(pick.classList.contains('active')).toBe(true);
    expect(grid.style.display).toBe('none'); // the pick closes the grid
  });
});

describe('the stock line: the panel\'s function, shortened', () => {
  const board = (min, max, count = 0, maxOver = 0, maxUnder = 0) => ({ count, maxOver, maxUnder, min, max, carveZ: 1.5 });
  const line = (tool = 'brush') => row(tool).querySelector('.height-bar-stock');
  it('inside: the room, short; the panel line is the long form of the same report', () => {
    setHeightStockReport({ board: board(0.2, 1.44), patches: {} });
    shown('brush');
    expect(line().textContent).toBe('↓0.20 in floor · ↑0.06 in top');
    expect(line().classList.contains('stl-error')).toBe(false);
    expect(heightStockLines().short).toBe(line().textContent);
    expect(heightStockLines().text).toBe(document.getElementById('heightCarveRange').textContent);
  });
  it('a board that leaves the stock: warning colour on the bar and on the panel, together', () => {
    setHeightStockReport({ board: board(-0.04, 1.2, 3, 0, 0.04), patches: {} });
    shown('fill');
    expect(line('fill').textContent).toBe('⚠ ↓-0.04 in floor · ↑0.30 in top');
    expect(line('fill').classList.contains('stl-error')).toBe(true);
    expect(document.getElementById('heightCarveRange').classList.contains('stl-error')).toBe(true);
    expect(heightStockLines().warn).toBe(true);
  });
  it('every tool row ends with the stock line, and it is empty before any build', () => {
    for (const t of HEIGHT_TOOLS) { shown(t.id); expect(row(t.id).lastElementChild.classList.contains('height-bar-stock'), t.id).toBe(true); }
    shown('brush');
    expect(line().textContent).toBe('');
  });
});
