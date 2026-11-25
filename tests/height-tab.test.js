/**
 * HEIGHT-PAINTER slice 1: the editor's Height tab (main/editor-tabs.js EDITOR_TABS) and its patches ON THE SHARED editor
 * canvas (the advisor's amendment 2, Fred: "tabs content carry over visually"): each patch is a shaded image in the editor's
 * own coordinate space (board inches, y down -- the same group the photo footprint draws in), visible in EVERY tab, faded
 * outside the Height tab; only the Height tab's brush mode ('heightBrush', declared in its `modes`) paints.
 * The panel's controls render from ONE declared table (HEIGHT_CONTROLS).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { EDITOR_TABS, setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { getModeHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { SNAP_POLICY } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-grid.js';
import { heightBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-height-tool.js';
import { dropForeignModeOnTabChange } from '../bspline-frame-builder/b-spline-gen/html/main/global-events.js';
import { INACTIVE_LAYER_OPACITY } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  HEIGHT_CONTROLS, initHeightPanel, newHeightPatch, activeHeightLayer, syncHeightOverlay, whenHeightIdle, _resetHeightPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';

const NS = 'http://www.w3.org/2000/svg';
function editorOnCanvas() {
  const svg = document.createElementNS(NS, 'svg');
  const bg = document.createElementNS(NS, 'g'); bg.id = 'bg-layer';
  const sketch = document.createElementNS(NS, 'g'); sketch.id = 'sketch-layer';
  svg.append(bg, sketch);
  document.getElementById('editorSVGContainer').appendChild(svg);
  // the real editor's layers are svg.js elements: { node, attr(k, v) } (as tests/editor-tab-focus.test.js mocks them)
  const layerOf = (node) => ({ node, attr(k, v) { if (v == null) node.removeAttribute(k); else node.setAttribute(k, String(v)); return this; } });
  return {
    _sketchLayer: layerOf(sketch), _currentMode: 'select', _undoStack: [],
    setMode: vi.fn(function (m) { this._currentMode = m; }),
    pushState() { this._undoStack.push({}); }, _notifyChange() {},
  };
}
const saved = {};
beforeEach(() => {
  Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 4; P.heightIn = 6; P.heightLayers = DEFAULT.heightLayers;
  document.body.innerHTML = `<div id="svgEditorModal" style="display:flex"><div id="editorCanvasContainer"><div id="editorSVGContainer"></div></div>
    <aside id="editorHeightPanel"><div id="heightPanelBody"></div></aside><div id="editorToolbarHeight"></div>
    <button id="editorTabHeight"></button><button id="editorTabArtwork"></button></div>`;
  _resetHeightPanelForTests();
  window.svgEditor = editorOnCanvas();
  initHeightPanel({});
});
afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; setEditorTab('artwork'); });

describe('the tab is declared', () => {
  it('EDITOR_TABS has the Height tab, with its own panel, rail and brush mode', () => {
    const t = EDITOR_TABS.find((x) => x.id === 'height');
    expect(t).toMatchObject({ label: 'Height', buttonId: 'editorTabHeight', panelId: 'editorHeightPanel', toolbarId: 'editorToolbarHeight' });
    expect(t.modes).toEqual(['select', 'heightBrush']);
    expect(EDITOR_TABS.filter((x) => x.id !== 'height').some((x) => x.modes.includes('heightBrush'))).toBe(false);
    expect(getModeHandler('heightBrush')).toBe(heightBrushHandler);
    expect(SNAP_POLICY.heightBrush).toBe('none'); // a freehand tool never snaps
  });
  it('its controls render from HEIGHT_CONTROLS: one element per entry, the brush mode in the rail too', () => {
    // Fred 2026-11-22: no presets -- the Brush section is Mode, then Tip, then Falloff (+ its curve), then size, hardness, ...
    // Fred 2026-11-23 (slice 5): Invert, a toggle at the top of the Brush section
    expect(HEIGHT_CONTROLS.map((c) => c.id)).toEqual([
      'invert', 'mode', 'tip', 'falloff', 'customCurve', 'sizeIn', 'hardness', 'opacity', 'flow', 'spacing', 'amountIn', 'targetIn', 'pressureSize', 'pressureOpacity',
      'posX', 'posY', 'rotation', 'sizeW', 'sizeH', 'raise', 'blend', 'zOffset', 'placement',
    ]);
    // Fred 2026-11-22 ("No rigid"): a height patch always follows the terrain -- no Level / rigid choice
    expect(document.querySelector('[data-height-choice^="surface:"]')).toBeNull();
    for (const c of HEIGHT_CONTROLS) expect(document.getElementById(`height_${c.id}`), c.id).toBeTruthy();
    const rail = [...document.querySelectorAll('#editorToolbarHeight [data-height-choice]')].map((b) => b.getAttribute('data-height-choice'));
    // Fred 2026-11-22 (slice 3b): "a simple brush tool with the different brushes inside of it in the right panel" -- ONE
    // Brush tool on the rail, its modes a row in the panel; erase is its own Eraser tool ("we need an eraser too")
    expect(rail).toEqual([]);
    expect([...document.querySelectorAll('#heightPanelBody [data-height-choice^="mode:"]')].map((b) => b.getAttribute('data-height-choice')))
      .toEqual(['mode:raise', 'mode:lower', 'mode:set', 'mode:smooth']);
  });
  it('entering the tab arms the brush mode; leaving it drops the mode (global-events.js, from the declared modes)', () => {
    const ed = window.svgEditor;
    setEditorTab('height');
    expect(ed._currentMode).toBe('heightBrush');
    dropForeignModeOnTabChange('artwork');
    expect(ed._currentMode).toBe('select');
  });
});

describe('the patch on the shared editor canvas', () => {
  it('drawn in the editor coordinates by its position / rotation / size, in the Height tab AND in Draw (faded there)', async () => {
    await newHeightPatch();
    P.heightLayers = [{ ...activeHeightLayer(), position: { x: 0.5, y: 1 }, rotation: 30, sizeIn: { w: 1, h: 2 } }];
    setEditorTab('height');
    syncHeightOverlay();
    const g = document.querySelector('#heightPatches');
    expect(g).toBeTruthy();
    expect(g.parentNode).toBe(window.svgEditor._sketchLayer.node.parentNode); // the shared canvas, not a second view
    const patch = g.querySelector(`[data-height-patch="${activeHeightLayer().id}"]`);
    expect(patch.getAttribute('transform')).toBe('translate(2.5 2) rotate(-30)'); // x = W/2 + 0.5, y = H/2 - 1 (y down)
    const img = patch.querySelector('image');
    expect([img.getAttribute('x'), img.getAttribute('y'), img.getAttribute('width'), img.getAttribute('height')]).toEqual(['-0.5', '-1', '1', '2']);
    expect(g.getAttribute('opacity')).toBeNull();          // in focus
    expect(g.previousSibling).toBe(window.svgEditor._sketchLayer.node); // on top of the drawing in its own tab
    setEditorTab('artwork');
    syncHeightOverlay();
    const g2 = document.querySelector('#heightPatches');
    expect(g2).toBe(g);                                     // a tab switch keeps it
    expect(g2.querySelector(`[data-height-patch="${activeHeightLayer().id}"]`)).toBeTruthy();
    expect(Number(g2.getAttribute('opacity'))).toBe(INACTIVE_LAYER_OPACITY);
    expect(g2.nextSibling).toBe(window.svgEditor._sketchLayer.node); // under the drawing elsewhere
  });
  it('the outline strokes follow the canvas box: drawn while the phone drawer covers it (scale 1), redrawn when the box resizes', async () => {
    // measured on origin/main (390 x 844): drawn with the box 0 high the CTM scale reads 1 (1 screen px = 1 inch) -> a 1.5 in
    // outline, and nothing redrew it when the drawer came down
    const boxes = [];
    vi.stubGlobal('ResizeObserver', class { constructor(cb) { this.cb = cb; boxes.push(this); } observe() {} disconnect() {} });
    try {
      _resetHeightPanelForTests(); initHeightPanel({});
      expect(boxes.length).toBe(1);
      await newHeightPatch();
      setEditorTab('height');
      syncHeightOverlay();
      const g = document.querySelector('#heightPatches');
      let scale = 1; // px per inch under the canvas's own transform: 1 while the box has no height
      g.getScreenCTM = () => ({ a: scale });
      syncHeightOverlay();
      const outline = () => Number(g.querySelector('rect.height-patch-outline').getAttribute('stroke-width'));
      expect(outline()).toBeCloseTo(1.5, 6);
      scale = 47.7; // the drawer came down: the box is tall again
      boxes[0].cb([]);
      expect(outline()).toBeCloseTo(1.5 / 47.7, 6);
    } finally { vi.unstubAllGlobals(); }
  });
  it('an editor session sees a stroke (app-init.js editorSessionFingerprint: [3D] then takes the Apply way, the rebuild)', async () => {
    const { editorSessionFingerprint } = await import('../bspline-frame-builder/b-spline-gen/html/main/app-init.js');
    await newHeightPatch();
    const before = editorSessionFingerprint();
    expect(before).not.toMatch(activeHeightLayer().raster.data.slice(0, 12)); // by hash, not the text
    setEditorTab('height');
    const ed = window.svgEditor;
    heightBrushHandler.start(ed, { x: 2, y: 3 }, { pointerType: 'pen', pressure: 1 });
    await heightBrushHandler.finish(ed);
    await whenHeightIdle();
    expect(editorSessionFingerprint()).not.toBe(before);
  });
  it('the brush paints in the Height tab (one commit on release); the same gesture in another tab paints nothing', async () => {
    const ed = window.svgEditor;
    await newHeightPatch();
    const h0 = activeHeightLayer().raster.h;
    setEditorTab('artwork');
    heightBrushHandler.start(ed, { x: 2, y: 3 }, { pointerType: 'mouse', pressure: 0.5 });
    heightBrushHandler.update(ed, { x: 2.3, y: 3 }, { pointerType: 'mouse', pressure: 0.5 });
    await heightBrushHandler.finish(ed);
    await whenHeightIdle();
    expect(activeHeightLayer().raster.h).toBe(h0);
    setEditorTab('height');
    const steps = ed._undoStack.length;
    heightBrushHandler.start(ed, { x: 2, y: 3 }, { pointerType: 'mouse', pressure: 0.5 });
    heightBrushHandler.update(ed, { x: 2.3, y: 3 }, { pointerType: 'mouse', pressure: 0.5 });
    await heightBrushHandler.finish(ed);
    await whenHeightIdle();
    expect(activeHeightLayer().raster.h).not.toBe(h0);
    expect(ed._undoStack.length).toBe(steps + 1);
  });
});
