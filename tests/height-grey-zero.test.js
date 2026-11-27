/**
 * HEIGHT-PAINTER (Fred 2026-11-23): a patch uses either grey system -- Mid-grey = 0 (today) or Black = 0 -- as its own field
 * `greyZero` ('mid' | 'black'; absent = 'mid', so a saved board reads exactly as before). It is ONE mapping, through
 * compose.js mapImageValue / heightToGrey; only the palette, the eyedropper's marked swatch and the greyscale view move: a paint
 * layer stores inches, so no stored height changes and the pass never reads it (pinned).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { heightPass, _resetHeightCachesForTests } from '../bspline-frame-builder/b-spline-gen/html/core/height/layer.js';
import { encodeRaster, ensureRasterDecoded } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, setHeightField, setHeightTool, heightBrush, pickHeightGrey, fillHeight,
  HEIGHT_TOOL_CONTROLS, HEIGHT_OPTIONS_BAR,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { heightBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-height-tool.js';

const saved = {};
let ed;
beforeEach(async () => {
  Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 2; P.heightIn = 2; P.heightLayers = DEFAULT.heightLayers;
  document.body.innerHTML = '<div id="editorHeightOptions"></div><div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
  _resetHeightPanelForTests();
  ed = window.svgEditor = { _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() { this._undoStack.push({}); }, _notifyChange() {} };
  initHeightPanel({});
  setEditorTab('height');
  await newHeightPatch();
});
afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; setEditorTab('artwork'); });
const swatch = (pct) => document.querySelector(`#heightGreySwatches [data-height-grey="${pct}"]`);
const activeSwatches = () => [...document.querySelectorAll('#heightGreySwatches [data-height-grey].active')].map((b) => b.getAttribute('data-height-grey'));

describe('the grey system is a declared per-patch choice', () => {
  it('a patch-level choice beside the Range, with the image layers labels, also in the options bar', () => {
    const c = HEIGHT_TOOL_CONTROLS.find((x) => x.id === 'greyZero');
    const z = HEIGHT_TOOL_CONTROLS.find((x) => x.id === 'imageZero');
    expect(c).toMatchObject({ group: 'palette', target: 'greyMap', kind: 'choice' });
    expect(c.options.map((o) => o[0])).toEqual(['black', 'mid']);
    expect(c.options.map((o) => o[1])).toEqual(z.options.map((o) => o[1]));
    expect(c.options.map((o) => o[1])).toEqual(['Black = 0', 'Mid-grey = 0']);
    // the context bar's six-item rule (owner 2026-11-27): on the brush row it sits in the '⋯'
    expect(HEIGHT_OPTIONS_BAR.brush.find((i) => i.more).more.some((i) => i.control === 'greyZero')).toBe(true);
    expect(HEIGHT_OPTIONS_BAR.eyedropper.some((i) => i.control === 'greyZero')).toBe(true);
  });
  it('absent = mid (today): the palette reads mid-grey = 0 until the choice is made', () => {
    expect(activeHeightLayer().greyZero).toBeUndefined();
    expect(document.querySelector('#heightPanelBody [data-height-choice="greyZero:mid"]').classList.contains('active')).toBe(true);
    expect(pickHeightGrey(0.5)).toBeCloseTo(0, 12);
  });
});

describe('the palette in both grey systems (Range 0.25 in)', () => {
  it('100 % = +Range in both; 0 % = -Range in mid mode and 0 in black mode', () => {
    expect(swatch(100).textContent).toMatch(/0\.250 in/);
    expect(swatch(0).textContent).toMatch(/-0\.250 in/);
    expect(pickHeightGrey(1)).toBeCloseTo(0.25, 12);
    expect(pickHeightGrey(0)).toBeCloseTo(-0.25, 12);
    setHeightField('greyZero', 'black');
    expect(activeHeightLayer().greyZero).toBe('black');
    expect(swatch(100).textContent).toMatch(/0\.250 in/);
    expect(swatch(0).textContent).toMatch(/no change/);
    expect(pickHeightGrey(1)).toBeCloseTo(0.25, 12);
    expect(pickHeightGrey(0)).toBeCloseTo(0, 12);
    expect(pickHeightGrey(0.5)).toBeCloseTo(0.125, 12);
  });
  it('the eyedropper on a 0-height pixel marks 50 % in mid mode and 0 % in black mode', async () => {
    await fillHeight({ heightIn: 0 });
    const eyedrop = async () => { setHeightTool('eyedropper'); heightBrushHandler.start(ed, { x: 1, y: 1 }, {}); await heightBrushHandler.finish(ed); return heightBrush().targetIn; };
    expect(await eyedrop()).toBe(0);
    expect(activeSwatches()).toEqual(['50']);
    setHeightField('greyZero', 'black');
    expect(await eyedrop()).toBe(0);
    expect(activeSwatches()).toEqual(['0']);
  });
  it('the choice moves no stored height and is one undo step', () => {
    const h0 = activeHeightLayer().raster.h, steps = ed._undoStack.length;
    setHeightField('greyZero', 'black');
    expect(activeHeightLayer().raster.h).toBe(h0);
    expect(ed._undoStack.length).toBe(steps + 1);
  });
});

describe('a saved board is unchanged (the pin)', () => {
  it('the pass with greyZero (either value) and without is the same', async () => {
    const cols = 60, rows = 40, d = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const q = Math.hypot(c - 20, r - 20) / 12; if (q < 1) d[r * cols + c] = 0.2 * Math.sqrt(1 - q * q); if (c >= 40 && c <= 50) d[r * cols + c] = -0.05; }
    const raster = await encodeRaster(d, cols, rows);
    await ensureRasterDecoded(raster);
    const rec = { id: 'p', enabled: true, position: { x: 0, y: 0 }, rotation: 0, sizeIn: { w: 0.6, h: 0.4 }, raster };
    const grid = { nx: 31, nz: 21, widthIn: 1, heightIn: 0.8 };
    _resetHeightCachesForTests();
    const a = heightPass(rec, grid);
    for (const z of ['black', 'mid']) {
      _resetHeightCachesForTests();
      const b = heightPass({ ...rec, greyZero: z }, grid);
      expect(Array.from(b.mask.body)).toEqual(Array.from(a.mask.body));
      expect(Array.from(b.mask.isStamped)).toEqual(Array.from(a.mask.isStamped));
    }
    expect(a.mask.isStamped.some((v) => v)).toBe(true);
  });
});
