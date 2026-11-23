/**
 * HEIGHT-PAINTER options bar (Fred 2026-11-23, phone shot: "In height this space is dead, use it to display information or
 * input fields"). The Height tab fills the editor's shared top bar (#editorToolbarTop, the strip the Draw tab puts 'Grid ▾' in)
 * with the active tool's key controls, DECLARED in HEIGHT_OPTIONS_BAR (one row per HEIGHT_TOOLS id), each bound to the SAME
 * setting as its panel control, and the stock range line, short, from the same function that writes the panel's line.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { setHeightStockReport } from '../bspline-frame-builder/b-spline-gen/html/core/stock.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, heightBrush, heightToolSettings, setHeightTool, HEIGHT_TOOLS,
  HEIGHT_OPTIONS_BAR, heightStockLines, pickHeightGrey,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const saved = {};
beforeEach(() => {
  Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn, cz: P.carveZ });
  P.widthIn = 2; P.heightIn = 2; P.carveZ = 1.5; P.heightLayers = DEFAULT.heightLayers;
  document.body.innerHTML = '<div id="editorToolbarTop"><div id="editorHeightOptionsGroup" hidden><div id="editorHeightOptions"></div></div></div><div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
  _resetHeightPanelForTests();
  window.svgEditor = { _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() {}, _notifyChange() {} };
  setHeightStockReport(null);
  initHeightPanel({});
});
afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; P.carveZ = saved.cz; setHeightStockReport(null); delete window.svgEditor; setEditorTab('artwork'); });

const bar = () => document.getElementById('editorHeightOptions');
const row = (tool) => bar().querySelector(`[data-height-bar-tool="${tool}"]`);
const shown = (tool) => { setHeightTool(tool); const r = row(tool); return r && r.style.display !== 'none' ? r : null; };
const barNum = (tool, id) => row(tool).querySelector(`[data-height-bar="${id}"]`);
const panelNum = (id) => document.getElementById(`height_${id}`);
const barChoice = (tool, id, key) => row(tool).querySelector(`[data-height-choice="${id}:${key}"]`);

describe('the declared table', () => {
  it('has a row for tools of HEIGHT_TOOLS only, and each control item names a real control', () => {
    const toolIds = HEIGHT_TOOLS.map((t) => t.id);
    for (const [tool, items] of Object.entries(HEIGHT_OPTIONS_BAR)) {
      expect(toolIds, tool).toContain(tool);
      for (const it of items) if (it.control) expect(document.getElementById(`heightBar_${tool}_${it.control}`) || barChoice(tool, it.control, 'x') || row(tool).querySelector(`[data-height-control-bar="${it.control}"]`), `${tool}.${it.control}`).toBeTruthy();
    }
    for (const t of HEIGHT_TOOLS) expect(row(t.id), t.id).toBeTruthy(); // every tool has its row (the stock line at least)
  });
});

describe('the bar is no longer empty on the Height tab', () => {
  it('the group shows on the Height tab only (the shared top bar mechanism)', () => {
    const g = document.getElementById('editorHeightOptionsGroup');
    setEditorTab('height');
    expect(g.style.display).toBe('flex');
    setEditorTab('brick');
    expect(g.style.display).toBe('none');
    setEditorTab('artwork');
    expect(g.hidden).toBe(true); // artwork clears the inline display; its hidden attribute keeps it away
  });
  it('the brush row: size, mode, the grey chip, invert', () => {
    const r = shown('brush');
    expect(r).toBeTruthy();
    expect(barNum('brush', 'sizeIn')).toBeTruthy();
    expect(barChoice('brush', 'mode', 'set')).toBeTruthy();
    expect(r.querySelector('.height-bar-chip-text').textContent).toMatch(/^\d+% · [+-]\d\.\d\d in$/);
    expect(barChoice('brush', 'invert', 'true')).toBeTruthy();
  });
  it('only the active tool\'s row shows', () => {
    shown('brush');
    expect(row('wand').style.display).toBe('none');
    expect(shown('wand')).toBeTruthy();
    expect(row('brush').style.display).toBe('none');
  });
  it('the eraser row has no mode and no invert (their declared showWhen) and keeps the size', () => {
    const r = shown('eraser');
    expect(r.querySelector('[data-height-bar="sizeIn"]')).toBeTruthy();
    expect(r.querySelector('[data-height-choice^="mode:"]')).toBeNull();
    expect(r.querySelector('[data-height-choice^="invert:"]')).toBeNull();
  });
  it('the selection tools: Replace / Add / Subtract + feather; the wand adds tolerance + contiguous; gradient and fill their fields', () => {
    for (const t of ['selectRect', 'selectEllipse', 'selectLasso', 'wand']) {
      const r = shown(t);
      expect(r.querySelectorAll('[data-height-choice^="selCombine:"]').length, t).toBe(3);
      expect(barNum(t, 'featherIn'), t).toBeTruthy();
    }
    expect(barNum('wand', 'wandToleranceIn')).toBeTruthy();
    expect(row('wand').querySelector('[data-height-bar="wandContiguous"]').type).toBe('checkbox');
    expect(row('selectRect').querySelector('[data-height-bar="wandToleranceIn"]')).toBeNull();
    shown('gradient'); expect(barNum('gradient', 'gradStartIn')).toBeTruthy(); expect(barNum('gradient', 'gradEndIn')).toBeTruthy();
    shown('fill'); expect(barNum('fill', 'fillHeightIn')).toBeTruthy();
  });
  it('the eyedropper: the Sample choice and the picked height; move: a hint, Drop / Cancel only while a piece floats', () => {
    const r = shown('eyedropper');
    expect(r.querySelectorAll('[data-height-choice^="sampleFrom:"]').length).toBe(4);
    expect(r.querySelector('.height-bar-chip-text')).toBeTruthy();
    const m = shown('move');
    expect(m.querySelector('.height-bar-move-hint').style.display).not.toBe('none');
    for (const b of m.querySelectorAll('[data-height-bar-action]')) expect(b.style.display).toBe('none');
  });
});

describe('one setting, two views', () => {
  it('size: a number typed in the bar is the brush size the panel shows; the panel\'s change shows in the bar', () => {
    shown('brush');
    const n = barNum('brush', 'sizeIn');
    n.value = '0.8'; n.dispatchEvent(new Event('change', { bubbles: true }));
    expect(heightBrush().sizeIn).toBeCloseTo(0.8, 6);
    expect(panelNum('sizeIn').value).toBe('0.8');
    panelNum('sizeIn').value = '1.25'; panelNum('sizeIn').dispatchEvent(new Event('change', { bubbles: true }));
    expect(heightBrush().sizeIn).toBeCloseTo(1.25, 6);
    expect(n.value).toBe('1.25');
  });
  it('a number sits in the app own stepper (.cad-stepper, which adds its - / +) with the declared step', () => {
    for (const [tool, id, step] of [['brush', 'sizeIn', 0.05], ['wand', 'wandToleranceIn', 0.005], ['fill', 'fillOpacity', 0.05]]) {
      const n = barNum(tool, id);
      expect(n.closest('.cad-stepper'), id).not.toBeNull();
      expect(Number(n.step), id).toBeCloseTo(step, 6);
      expect(n.closest('[data-height-bar-tool]').querySelectorAll('[data-height-bar-step]').length).toBe(0); // no second stepper of our own
    }
  });
  it('mode and invert: a bar button changes the brush and the panel\'s active button follows (and back)', () => {
    shown('brush');
    barChoice('brush', 'mode', 'smooth').click();
    expect(heightBrush().mode).toBe('smooth');
    const panelBtn = (k) => document.querySelector(`#heightPanelBody [data-height-choice="mode:${k}"]`);
    expect(panelBtn('smooth').classList.contains('active')).toBe(true);
    panelBtn('lower').click();
    expect(barChoice('brush', 'mode', 'lower').classList.contains('active')).toBe(true);
    expect(barChoice('brush', 'mode', 'smooth').classList.contains('active')).toBe(false);
    barChoice('brush', 'invert', 'true').click();
    expect(heightBrush().invert).toBe(true);
  });
  it('the selection row and the wand: combine, feather, tolerance, contiguous are the tool settings the panel reads', () => {
    shown('wand');
    barChoice('wand', 'selCombine', 'add').click();
    expect(heightToolSettings('select').combine).toBe('add');
    expect(document.querySelector('#heightPanelBody [data-height-choice="selCombine:add"]').classList.contains('active')).toBe(true);
    const f = barNum('wand', 'featherIn'); f.value = '0.2'; f.dispatchEvent(new Event('change', { bubbles: true }));
    expect(heightToolSettings('select').featherIn).toBeCloseTo(0.2, 6);
    expect(panelNum('featherIn').value).toBe('0.2');
    const t = barNum('wand', 'wandToleranceIn'); t.value = '0.05'; t.dispatchEvent(new Event('change', { bubbles: true }));
    expect(heightToolSettings('wand').toleranceIn).toBeCloseTo(0.05, 6);
    const c = row('wand').querySelector('[data-height-bar="wandContiguous"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true }));
    expect(heightToolSettings('wand').contiguous).toBe(false);
    expect(panelNum('wandContiguous').checked).toBe(false);
  });
  it('the chip follows a grey pick and reads the height through the mapping', async () => {
    await newHeightPatch();
    expect(activeHeightLayer()).toBeTruthy();
    shown('brush');
    pickHeightGrey(0.6); // Range 0.25 in: 60 % grey = +0.05 in
    expect(row('brush').querySelector('.height-bar-chip-text').textContent).toBe('60% · +0.05 in');
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
    for (const t of HEIGHT_TOOLS) expect(row(t.id).lastElementChild.classList.contains('height-bar-stock'), t.id).toBe(true);
    shown('brush');
    expect(line().textContent).toBe('');
  });
});
