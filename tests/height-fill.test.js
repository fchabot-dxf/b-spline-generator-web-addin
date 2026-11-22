/**
 * HEIGHT-PAINTER slice 2, step 4: the FILL tool (core/height/fill.js): set the selection (or the whole layer) to an exact
 * height, with opacity (h (1 - a) + target a, a = opacity x the mask), ONE undo step.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyFill, FILL_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/core/height/fill.js';
import { rectMask } from '../bspline-frame-builder/b-spline-gen/html/core/height/selection.js';
import { f16Round, decodedRaster } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, setHeightField, setHeightTool, selectHeightRect,
  fillHeight, HEIGHT_TOOLS,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { heightBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-height-tool.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const f = Math.fround;
describe('applyFill', () => {
  it('the exact height inside the mask at opacity 1; outside untouched', () => {
    const d = new Float32Array(20).fill(0.1);
    applyFill(d, 0.37, 1, rectMask(5, 4, 1, 1, 3, 2));
    expect(d[1 * 5 + 1]).toBe(f(0.37)); expect(d[2 * 5 + 3]).toBe(f(0.37));
    expect(d[0]).toBe(f(0.1)); expect(d[3 * 5 + 4]).toBe(f(0.1));
  });
  it('opacity mixes toward the height; no mask = the whole layer; a soft mask scales it', () => {
    const d = new Float32Array(4).fill(0.2);
    applyFill(d, 0.6, 0.5, null);
    expect(Array.from(d)).toEqual(Array(4).fill(f(f(0.2) * 0.5 + 0.6 * 0.5)));
    const e = new Float32Array(2);
    applyFill(e, 1, 1, Float32Array.from([0.25, 0]));
    expect(Array.from(e)).toEqual([0.25, 0]);
  });
  it('declared defaults', () => expect(FILL_DEFAULTS).toEqual({ heightIn: 0.1, opacity: 1 }));
});

describe('the panel: fill the selection, one step', () => {
  const saved = {};
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 2; P.heightIn = 1; P.heightLayers = DEFAULT.heightLayers;
    document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    window.svgEditor = { _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() { this._undoStack.push({}); }, _notifyChange() {} };
    initHeightPanel({});
  });
  afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; setEditorTab('artwork'); vi.useRealTimers(); });

  it('Fill (the button path): the exact stored height inside a rectangle selection, nothing outside, ONE step', async () => {
    await newHeightPatch(); // 200 x 100
    selectHeightRect([-1, -0.5], [0, 0.5]); // c 0..99
    setHeightField('fillHeightIn', 0.37);
    const ed = window.svgEditor, steps = ed._undoStack.length;
    await fillHeight();
    expect(ed._undoStack.length).toBe(steps + 1);
    const d = decodedRaster(activeHeightLayer().raster);
    expect(d[50 * 200 + 10]).toBe(f16Round(0.37));
    expect(d[0]).toBe(f16Round(0.37));
    expect(d[50 * 200 + 150]).toBe(0);
  });
  it('the Fill tool: a tap on the patch fills (no selection = the whole layer)', async () => {
    expect(HEIGHT_TOOLS.map((t) => t.id)).toContain('fill');
    await newHeightPatch();
    setHeightField('fillHeightIn', -0.2);
    setEditorTab('height');
    setHeightTool('fill');
    const ed = window.svgEditor;
    heightBrushHandler.start(ed, { x: 1, y: 0.5 }, {});
    await heightBrushHandler.finish(ed);
    const d = decodedRaster(activeHeightLayer().raster);
    expect(d.every((v) => v === f16Round(-0.2))).toBe(true);
  });
  it('opacity 0.5 over a painted area moves half way (Photoshop semantics, one step)', async () => {
    await newHeightPatch();
    await fillHeight({ heightIn: 0.2 });
    await fillHeight({ heightIn: 0.6, opacity: 0.5 });
    const d = decodedRaster(activeHeightLayer().raster);
    expect(d[1234]).toBe(f16Round(f16Round(0.2) * 0.5 + 0.6 * 0.5));
  });
});
