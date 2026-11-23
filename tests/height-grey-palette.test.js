/**
 * HEIGHT-PAINTER slice 5 (Fred 2026-11-23: "I thought I selected the value in a palette" -- a classic heightmap editor):
 *  1. a GREYSCALE VIEW (View: Lit | Greyscale; core/height/shade.js's second declared look): the composite height as grey
 *     through the patch's grey mapping; a 0 pixel (unpainted = transparent, compose.js) shows the mapping's zero grey under a\n *     faint checker (coordinator 2026-11-23: a painted 0 and an unpainted pixel are the same thing; no new channel);
 *  2. a GREY PALETTE beside the Brush: 11 swatches (0..100 %) and a ramp; a pick sets the Set target and the mode to Set.
 *     The mapping (Fred 2026-11-23: "black as carve and white as raise") is the slice-2 image-layer mapping FIXED at mid-grey
 *     = 0 (core/height/compose.js mapImageValue + its inverse heightToGrey) with ONE Range per patch (record field
 *     greyRangeIn, absent = 0.25 in): black = -Range, white = +Range; it never changes a pixel;
 *  3. the EYEDROPPER (a rail tool, I on a keyboard): a tap reads the height (Sample: active layer | whole board, the wand's
 *     own setting), sets the Set target, and returns to the Brush in Set mode.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shadeRaster, HEIGHT_LOOKS } from '../bspline-frame-builder/b-spline-gen/html/core/height/shade.js';
import { mapImageValue, heightToGrey, IMAGE_MAPPING_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/core/height/compose.js';
import { decodedRaster, f16Round } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, setHeightField, setHeightTool, heightTool, heightBrush,
  paintHeightStroke, fillHeight, selectHeightRect, clearHeightSelection, HEIGHT_TOOLS, HEIGHT_TOOL_CONTROLS, heightToolSettings, pickHeightGrey,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { heightBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-height-tool.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

describe('core', () => {
  it('heightToGrey is mapImageValue backwards (Black = 0 and Mid-grey = 0)', () => {
    const black = { zero: 'black', whiteIn: 0.4, darkIn: 0.25 }, mid = { zero: 'mid', whiteIn: 0.4, darkIn: 0.1 };
    for (const g of [0, 0.25, 0.6, 1]) {
      expect(heightToGrey(mapImageValue(g, black), black)).toBeCloseTo(g, 12);
      expect(heightToGrey(mapImageValue(g, mid), mid)).toBeCloseTo(g, 12);
    }
    expect(heightToGrey(-0.05, mid)).toBeCloseTo(0.25, 12);
    expect(heightToGrey(0.1, null)).toBeCloseTo(0.1 / IMAGE_MAPPING_DEFAULTS.whiteIn, 12);
  });
  it('HEIGHT_LOOKS: lit and grey; grey draws the height through the mapping, a 0 pixel as the zero grey under a faint checker', () => {
    expect(Object.keys(HEIGHT_LOOKS)).toEqual(['lit', 'grey']);
    const cols = 4, rows = 1, d = Float32Array.from([0, 0.1, 0.25, -0.05]);
    const px = shadeRaster(d, cols, rows, 4, 1, 100, 100, undefined, undefined, undefined, undefined, undefined, { look: 'grey', mapping: { zero: 'black', whiteIn: 0.25, darkIn: 0.25 } });
    const at = (x) => Array.from(px.slice(x * 4, x * 4 + 4));
    expect(at(1)).toEqual([102, 102, 102, 255]);    // 0.1 / 0.25 = 40 % grey, opaque
    expect(at(2)).toEqual([255, 255, 255, 255]);    // the white end
    expect(at(3)).toEqual([0, 0, 0, 255]);          // below black: black (never transparent: it is painted)
    expect(at(0)[3]).toBe(255);                     // 0 (no effect): opaque, the zero grey (black) under the faint checker ...
    expect(at(0)[0]).toBeGreaterThan(0);            // ... so it never reads as the painted black of pixel 3
    expect(at(0)[0]).toBeLessThan(48);
    const mid = shadeRaster(Float32Array.from([0, 0]), 2, 1, 2, 1, 100, 100, undefined, undefined, undefined, undefined, undefined, { look: 'grey', mapping: { zero: 'mid', whiteIn: 0.25, darkIn: 0.25 } });
    expect(mid[0]).toBeGreaterThan(127); expect(mid[0]).toBeLessThan(160); // Mid-grey = 0: the zero grey is mid-grey
  });
});

describe('the panel', () => {
  const saved = {};
  let ed;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 2; P.heightIn = 2; P.heightLayers = DEFAULT.heightLayers;
    document.body.innerHTML = '<div id="svgEditorModal" style="display:flex"><div id="heightPanelBody"></div><div id="editorToolbarHeight"></div></div>';
    _resetHeightPanelForTests();
    ed = window.svgEditor = { _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() { this._undoStack.push({}); }, _notifyChange() {} };
    initHeightPanel({});
    setEditorTab('height');
  });
  afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; setEditorTab('artwork'); vi.useRealTimers(); });
  const swatch = (pct) => document.querySelector(`[data-height-grey="${pct}"]`);

  it('the View choice (Lit | Greyscale) is declared UI state', () => {
    const c = HEIGHT_TOOL_CONTROLS.find((x) => x.id === 'viewLook');
    expect(c.options.map((o) => o[0])).toEqual(['lit', 'grey']);
    expect(heightToolSettings('view').look).toBe('lit');
    setHeightField('viewLook', 'grey');
    expect(heightToolSettings('view').look).toBe('grey');
  });
  it('the palette: 11 swatches with their grey and inches (mid-grey = no change, Range 0.25 in by default); a pick = Set at that height', async () => {
    await newHeightPatch();
    const pcts = [...document.querySelectorAll('[data-height-grey]')].map((b) => Number(b.getAttribute('data-height-grey')));
    expect(pcts).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(swatch(60).textContent).toMatch(/60\s*%/);
    expect(swatch(60).textContent).toMatch(/0\.050/);       // (0.6 - 0.5) x 2 x 0.25
    expect(swatch(60).style.background).toMatch(/153/); // rgb(153, 153, 153)
    expect(swatch(50).textContent).toMatch(/no change/);  // mid-grey = 0 (Fred: black carves, white raises)
    expect(swatch(0).textContent).toMatch(/-0\.250/);
    expect(swatch(100).textContent).toMatch(/0\.250/);
    swatch(60).click();
    expect(heightBrush().mode).toBe('set');
    expect(heightBrush().targetIn).toBeCloseTo(0.05, 12);
    expect(swatch(60).classList.contains('active')).toBe(true);
    await paintHeightStroke([[-0.5, 0], [0.5, 0]], { hardness: 1, sizeIn: 0.2 });
    expect(decodedRaster(activeHeightLayer().raster)[99 * 200 + 100]).toBe(f16Round(heightBrush().targetIn));
    pickHeightGrey(0.37); // the ramp's continuous pick: below mid-grey = below the surface
    expect(heightBrush().targetIn).toBeCloseTo((0.37 - 0.5) * 2 * 0.25, 12);
  });
  it('the Range is the patch\'s own (one setting; no Black = 0 choice): it relabels the palette, one undo step, no pixel changes', async () => {
    expect(HEIGHT_TOOL_CONTROLS.filter((c) => c.group === 'palette').map((c) => c.id)).toEqual(['greyRangeIn']);
    await newHeightPatch();
    await fillHeight({ heightIn: 0.1 });
    expect(activeHeightLayer().greyRangeIn).toBeUndefined(); // absent = 0.25 in (the labels above)
    const h0 = activeHeightLayer().raster.h, steps = ed._undoStack.length;
    setHeightField('greyRangeIn', 0.5);
    expect(activeHeightLayer().greyRangeIn).toBe(0.5);
    expect(activeHeightLayer().raster.h).toBe(h0);
    expect(ed._undoStack.length).toBe(steps + 1);
    expect(swatch(100).textContent).toMatch(/0\.500/);
    expect(swatch(0).textContent).toMatch(/-0\.500/);
    expect(swatch(50).textContent).toMatch(/no change/);
    swatch(0).click();
    expect(heightBrush().targetIn).toBeCloseTo(-0.5, 12);
  });
  it('the Eyedropper (rail + I): a tap on a ridge sets the Set target to its height, marks the grey, returns to the Brush', async () => {
    const eye = HEIGHT_TOOLS.find((t) => t.id === 'eyedropper');
    expect(eye).toBeTruthy();
    expect(document.querySelector('#editorToolbarHeight [data-height-tool="eyedropper"]').getAttribute('data-key')).toBe('i');
    await newHeightPatch();
    selectHeightRect([-0.8, -1], [-0.6, 1]); await fillHeight({ heightIn: 0.2 }); clearHeightSelection();
    setHeightTool('eyedropper');
    expect(eye.leads).toContain('sample');
    heightBrushHandler.start(ed, { x: 0.3, y: 1 }, {}); // board (-0.7, 0): on the ridge
    await heightBrushHandler.finish(ed);
    expect(heightTool()).toBe('brush');
    expect(heightBrush().mode).toBe('set');
    expect(heightBrush().targetIn).toBe(f16Round(0.2));
    expect(swatch(90).classList.contains('active')).toBe(true); // 0.5 + 0.2 / (2 x 0.25) = 90 %
    await paintHeightStroke([[0, -0.5], [0, 0.5]], { hardness: 1, sizeIn: 0.2 });
    expect(decodedRaster(activeHeightLayer().raster)[100 * 200 + 99]).toBe(f16Round(0.2));
  });
  it('one Sample setting for the wand and the eyedropper (Active layer | Whole board)', () => {
    const c = HEIGHT_TOOL_CONTROLS.find((x) => x.id === 'sampleFrom');
    expect(c.group).toBe('sample');
    expect(c.options.map((o) => o[0])).toEqual(['layer', 'board']);
    expect(HEIGHT_TOOLS.find((t) => t.id === 'wand').leads).toContain('sample');
    expect(HEIGHT_TOOL_CONTROLS.some((x) => x.id === 'wandSample')).toBe(false);
  });
});
