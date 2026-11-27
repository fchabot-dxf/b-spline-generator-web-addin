/**
 * HEIGHT-PAINTER slice 4 (Fred said yes 2026-11-23):
 *  1. the MAGIC WAND (a HEIGHT_TOOLS row with its own leading section): a tap selects the pixels whose height is within the
 *     tolerance of the tapped height -- Contiguous (4-connected flood fill) or everywhere; sampling the active layer or the
 *     whole board (the last built board heights, resampled onto the patch grid);
 *  2. SELECTION MODIFIERS on every selection tool: plain = replace, Shift = add (max), Alt = subtract (a (1 - b)); the
 *     Selection section's Replace / Add / Subtract row does the same on touch;
 *  3. the FEATHER PROFILE (the BRUSH_FALLOFFS): a fade running inward from the outline -- 0 on the outline, full strength
 *     `width` inside (core/falloff.js edgeFade, the STL crop edge's own math); Smooth (the default) stays the slice-2
 *     Gaussian feather (pinned in tests/height-feather-pin.test.js);
 *  4. LAYER RENAME: double-click the name or tap its pencil; Enter / blur commits (one undo step), Esc cancels.
 * Raster frame: pixel (c, r), row 0 = the patch's BOTTOM edge; editor y is down.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { edgeFade, brushFalloff } from '../bspline-frame-builder/b-spline-gen/html/core/falloff.js';
import { wandMask, combineMasks, profileFeatherMask, rectMask } from '../bspline-frame-builder/b-spline-gen/html/core/height/selection.js';
import { decodedRaster, f16Round } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { P, DEFAULT, setLastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, selectHeightRect, featherHeightSelection, heightSelection,
  fillHeight, setHeightField, setHeightTool, clearHeightSelection, HEIGHT_TOOLS, HEIGHT_TOOL_CONTROLS, addPaintLayer, activePatchLayer,
  setPatchLayerField, renameHeightPatch,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { heightBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-height-tool.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const count = (m) => m.reduce((s, v) => s + (v > 0.5 ? 1 : 0), 0);
const at = (m, c, r, cols = 200) => m[r * cols + c];

describe('core', () => {
  it('wandMask: contiguous = the 4-connected region within the tolerance; off = every matching pixel', () => {
    const cols = 7, rows = 3, v = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) { v[r * cols + 1] = 0.2; v[r * cols + 5] = 0.205; } // two ridges, 0.005 apart
    const near = wandMask(v, cols, rows, 1, 1, 0.01, true);
    expect(count(near)).toBe(3);
    expect(at(near, 5, 1, cols)).toBe(0);
    expect(count(wandMask(v, cols, rows, 1, 1, 0.01, false))).toBe(6);
    expect(count(wandMask(v, cols, rows, 1, 1, 0.001, false))).toBe(3); // 0.205 is past a 0.001 tolerance
    v[1 * cols + 3] = 0.2; // a bridge of the same height, only diagonal to nothing: 4-connected through row 1
    v[1 * cols + 2] = 0.2; v[1 * cols + 4] = 0.2;
    expect(count(wandMask(v, cols, rows, 1, 1, 0.01, true))).toBe(9);
  });
  it('combineMasks: replace, add = max, subtract = a (1 - b)', () => {
    const a = Float32Array.from([0.3, 0.8, 1, 0]), b = Float32Array.from([0.6, 0.25, 0, 1]);
    expect(Array.from(combineMasks(a, b, 'replace'))).toEqual(Array.from(b));
    expect(Array.from(combineMasks(a, b, 'add'))).toEqual([0.6, 0.8, 1, 1].map(Math.fround));
    expect(Array.from(combineMasks(a, b, 'subtract'))).toEqual([0.3 * 0.4, 0.8 * 0.75, 1, 0].map(Math.fround));
    expect(Array.from(combineMasks(null, b, 'add'))).toEqual(Array.from(b));
  });
  it('edgeFade (core/falloff.js, shared with the STL crop edge): 0 on the outline, full at the width, the profile between', () => {
    expect(edgeFade(0, 0.2, 'linear')).toBe(0);
    expect(edgeFade(0.2, 0.2, 'linear')).toBe(1);
    expect(edgeFade(0.5, 0.2, 'linear')).toBe(1);
    expect(edgeFade(0.05, 0.2, 'linear')).toBeCloseTo(0.25, 12);
    expect(edgeFade(0.05, 0.2, 'dome')).toBeCloseTo(brushFalloff(0.75, 1, 0, 'dome'), 12);
  });
  it('profileFeatherMask: the hard mask faded inward by its distance to the outline (outside the grid counts as outside)', () => {
    const cols = 41, rows = 41, m = rectMask(cols, rows, 5, 5, 35, 35);
    const f = profileFeatherMask(m, cols, rows, { pxPerInX: 100, pxPerInY: 100, widthIn: 0.1, profile: 'linear' });
    expect(at(f, 20, 20, cols)).toBe(1);                               // 15 px inside: past the 0.1 in width
    expect(at(f, 5, 20, cols)).toBeCloseTo(0.05, 6);                   // the edge pixel: 0.5 px from the outline
    expect(at(f, 10, 20, cols)).toBeCloseTo(0.55, 6);                  // 5.5 px inside
    expect(at(f, 4, 20, cols)).toBe(0);                                // outside stays out
    expect(at(f, 10, 10, cols)).toBeCloseTo(0.55, 6);                  // the nearest edge counts (a corner region)
    const whole = profileFeatherMask(new Float32Array(cols * rows).fill(1), cols, rows, { pxPerInX: 100, pxPerInY: 100, widthIn: 0.1, profile: 'linear' });
    expect(at(whole, 0, 20, cols)).toBeCloseTo(0.05, 6);               // the patch border is an outline
  });
});

describe('the panel', () => {
  const saved = {};
  let ed;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 2; P.heightIn = 2; P.heightLayers = DEFAULT.heightLayers;
    document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    ed = window.svgEditor = { _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() { this._undoStack.push({}); }, _notifyChange() {} };
    initHeightPanel({});
    setEditorTab('height');
  });
  afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; setEditorTab('artwork'); setLastResult(null); vi.useRealTimers(); });

  const edPt = ([X, Y]) => ({ x: X + 1, y: 1 - Y });
  const tap = async (p, e = {}) => { heightBrushHandler.start(ed, edPt(p), e); await heightBrushHandler.finish(ed); };
  const drag = async (p0, p1, e = {}) => { heightBrushHandler.start(ed, edPt(p0), e); heightBrushHandler.update(ed, edPt(p1), e); await heightBrushHandler.finish(ed); };
  /** two 0.2 in ridges: c 20..39 and c 140..159, every row */
  async function ridges() {
    await newHeightPatch();
    selectHeightRect([-0.8, -1], [-0.6, 1]); await fillHeight({ heightIn: 0.2 });
    selectHeightRect([0.4, -1], [0.6, 1]); await fillHeight({ heightIn: 0.2 });
    clearHeightSelection();
  }

  it('the Wand is a declared tool leading with its own section; its settings are declared controls', async () => {
    const wand = HEIGHT_TOOLS.find((t) => t.id === 'wand');
    expect(wand).toBeTruthy();
    expect(wand.leads[0]).toBe('wand');
    expect(document.querySelector('#editorToolbarHeight [data-height-tool="wand"]')).toBeTruthy();
    const ids = HEIGHT_TOOL_CONTROLS.filter((c) => c.group === 'wand').map((c) => c.id);
    // slice 5 (Fred 2026-11-23): Sample is one setting shared with the eyedropper ('sampleFrom', its own 'sample' section)
    expect(ids).toEqual(['wandToleranceIn', 'wandContiguous']);
    await newHeightPatch(); // the wand's section needs a patch (like the selection's)
    setHeightTool('wand');
    expect(document.getElementById('heightGroup_wand').hidden).toBe(false);
  });
  it('a wand tap on a ridge: contiguous selects that ridge only; contiguous off selects both', async () => {
    await ridges();
    setHeightTool('wand');
    setHeightField('wandToleranceIn', 0.01);
    await tap([-0.7, 0]);
    let m = heightSelection().mask;
    expect(count(m)).toBe(20 * 200);
    expect(at(m, 30, 10)).toBe(1); expect(at(m, 150, 10)).toBe(0);
    setHeightField('wandContiguous', false);
    await tap([-0.7, 0]);
    m = heightSelection().mask;
    expect(count(m)).toBe(40 * 200);
    expect(at(m, 150, 10)).toBe(1);
  });
  it('Sample: whole board reads the last built board heights resampled onto the patch', async () => {
    await newHeightPatch();
    const nx = 21, nz = 21, heights = new Float32Array(nx * nz); // the 2 x 2 in board, a step at X = 0
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) heights[j * nx + i] = i >= 10 ? 1 : 0;
    setLastResult({ heights, nx, nz });
    setHeightTool('wand');
    setHeightField('sampleFrom', 'board'); // slice 5: the shared Sample setting (was 'wandSample') setHeightField('wandToleranceIn', 0.01);
    await tap([0.5, 0]);
    const m = heightSelection().mask;
    expect(count(m)).toBe(100 * 200);
    expect(at(m, 100, 50)).toBe(1); expect(at(m, 99, 50)).toBe(0);
  });
  it('modifiers on a selection tool: Shift adds (union), Alt subtracts; plain replaces', async () => {
    await newHeightPatch();
    setHeightTool('selectRect');
    await drag([-0.5, -0.5], [0, 0]);
    expect(count(heightSelection().mask)).toBe(2500);
    await drag([-0.25, -0.25], [0.25, 0.25], { shiftKey: true });
    expect(count(heightSelection().mask)).toBe(2500 + 2500 - 625);
    await drag([-0.25, -0.25], [0.25, 0.25], { altKey: true });
    expect(count(heightSelection().mask)).toBe(2500 - 625);
    await drag([-0.25, -0.25], [0.25, 0.25]);
    expect(count(heightSelection().mask)).toBe(2500);
  });
  it('the touch row (Replace / Add / Subtract) does the same for every selection tool, the wand included', async () => {
    await ridges();
    setHeightTool('wand'); setHeightField('wandToleranceIn', 0.01);
    await tap([-0.7, 0]);
    setHeightField('selCombine', 'add');
    await tap([0.5, 0]);
    expect(count(heightSelection().mask)).toBe(40 * 200);
    setHeightTool('selectRect'); setHeightField('selCombine', 'subtract');
    await drag([-1, -1], [1, 0]); // the bottom half (rows 0..99... r 0..99)
    expect(count(heightSelection().mask)).toBe(40 * 100);
  });
  it('a Linear feather (a bevelled tile) and a Dome feather (a pillow) through a fill: the heights fade inward from the outline', async () => {
    await newHeightPatch();
    const profileOf = async (profile) => {
      selectHeightRect([-0.5, -0.5], [0.5, 0.5]); // c, r 50..149
      setHeightField('featherProfile', profile);
      featherHeightSelection(0.2);
      await fillHeight({ heightIn: 0.2 });
      const d = decodedRaster(activeHeightLayer().raster);
      return (c) => d[100 * 200 + c];
    };
    const lin = await profileOf('linear');
    expect(lin(100)).toBe(f16Round(0.2));
    expect(lin(50)).toBeCloseTo(0.2 * 0.025, 3);           // the edge pixel: 0.005 in inside
    expect(lin(60)).toBeCloseTo(0.2 * (0.105 / 0.2), 3);   // 10.5 px inside
    expect(lin(65) - lin(60)).toBeCloseTo(lin(60) - lin(55), 3); // a straight slope (the bevel), inside the 0.2 in width
    clearHeightSelection();
    await fillHeight({ heightIn: 0 });
    const dome = await profileOf('dome');
    expect(dome(60)).toBeCloseTo(0.2 * Math.sqrt(1 - (1 - 0.105 / 0.2) ** 2), 3);
    expect(dome(60)).toBeGreaterThan(lin(60) + 0.05);      // round shoulders (the pillow)
  });
  it('the feather profile is a declared control beside Feather; Custom opens the curve widget', () => {
    const ids = HEIGHT_TOOL_CONTROLS.filter((c) => c.group === 'select').map((c) => c.id);
    expect(ids.indexOf('featherProfile')).toBe(ids.indexOf('featherIn') + 1);
    expect(ids).toContain('featherCurve');
    const curve = () => document.querySelector('[data-height-control="featherCurve"]');
    setHeightField('featherProfile', 'custom'); setHeightTool('selectRect');
    expect(curve().hidden).toBe(false);
    setHeightField('featherProfile', 'linear'); setHeightTool('brush'); setHeightTool('selectRect');
    expect(curve().hidden).toBe(true);
  });
  // the rename UI moved to the editor layer stack's ⋯ menu (Fred 2026-11-24; tests/editor-layer-stack.test.js): these are
  // the writes it runs -- ONE undo step each, an unchanged / empty patch name writes nothing
  it('layer + patch rename (the stack\'s Rename writes): ONE undo step each; the panel\'s own layer rows are gone', async () => {
    await newHeightPatch();
    await addPaintLayer();
    const layerId = activePatchLayer().id;
    const steps = ed._undoStack.length;
    expect(document.querySelector('[data-patch-layer-pick]')).toBeNull();
    setPatchLayerField(layerId, 'name', 'Ridge');
    expect(activePatchLayer().name).toBe('Ridge');
    expect(ed._undoStack.length).toBe(steps + 1);
    const id = activeHeightLayer().id;
    expect(renameHeightPatch(id, 'Ridges')).toBe(true);
    expect(activeHeightLayer().name).toBe('Ridges');
    expect(ed._undoStack.length).toBe(steps + 2);
    expect(renameHeightPatch(id, 'Ridges')).toBe(false);
    expect(renameHeightPatch(id, '  ')).toBe(false);
    expect(ed._undoStack.length).toBe(steps + 2);
  });
});
