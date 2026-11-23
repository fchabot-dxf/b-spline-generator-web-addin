/**
 * Fred 2026-11-23 ("have you tried erasing? it doesnt work"): E in the Height tab clicked the FIRST [data-key="e"] button in
 * the editor modal -- Draw's #toolErase, hidden in that tab -- so it armed the vector eraser ('erase' mode): the Height rail
 * still showed the Brush, the brush ring froze, and a drag over a painted stroke left every height as it was (measured in
 * the real app: the raster's hash and the undo depth unchanged). Now the Height Eraser declares E (HEIGHT_TOOLS `key`) and a
 * key clicks the button ON SCREEN: E in the Height tab arms the Height Eraser and its drag erases; E in Draw is still Draw's.
 * Read from the REAL page markup and the editor's own key handler (editor-interaction.js initInteraction).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import {
  initHeightPanel, newHeightPatch, activePatchLayer, _resetHeightPanelForTests, heightTool, paintHeightStroke, whenHeightIdle,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { decodedRaster, ensureRasterDecoded } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { initInteraction, getModeHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { registerModeTools } from '../bspline-frame-builder/b-spline-gen/html/editor/tools/mode-tools.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const MODAL = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html').getElementById('svgEditorModal').outerHTML;

const saved = {};
let ed;
beforeEach(() => {
  Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 2; P.heightIn = 2; P.heightLayers = DEFAULT.heightLayers;
  try { localStorage.clear(); } catch (_) { /* none */ }
  document.body.innerHTML = MODAL; // the real editor modal: Draw's tool row (#toolErase, E) and the Height panel
  document.getElementById('svgEditorModal').style.display = 'flex'; // open
  _resetHeightPanelForTests();
  ed = window.svgEditor = {
    _undoStack: [], _currentMode: 'select', _draw: { node: document.createElement('div') }, _selectedElements: [],
    setMode(m) { this._currentMode = m; }, pushState() { this._undoStack.push({}); }, _notifyChange() {},
  };
  registerModeTools(ed); // Draw's buttons -> ed.setMode (#toolErase -> 'erase')
  initHeightPanel({});
  initInteraction(ed);   // the editor's keyboard shortcuts (window keydown)
});
afterEach(() => {
  ed._artworkLocked = true; // initInteraction's window listeners outlive the test: leave this editor inert
  P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h;
  delete window.svgEditor;
  setEditorTab('artwork');
});
const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
const layerHeights = async () => { await whenHeightIdle(); const l = activePatchLayer(); await ensureRasterDecoded(l.raster); return decodedRaster(l.raster); };

describe('E in the Height tab is the Height Eraser (Fred 2026-11-23)', () => {
  it('E arms the Height Eraser (not Draw\'s vector eraser) and a drag over a stroke takes its heights back to 0', async () => {
    setEditorTab('height');
    await newHeightPatch();
    // a raised stroke across the middle (board y = 0 -> raster row 100 of 200), hard edge
    await paintHeightStroke([[-0.6, 0], [0.6, 0]], { mode: 'raise', amountIn: 0.1, hardness: 1, sizeIn: 0.2 });
    const before = await layerHeights();
    expect(before[100 * 200 + 100]).toBeGreaterThan(0.09);
    press('e');
    expect(ed._currentMode).toBe('heightBrush'); // was 'erase': Draw's vector eraser, which never touches a height
    expect(heightTool()).toBe('eraser');
    // the same drag the editor runs for the armed mode (its own mode handler), along the stroke: editor y = 1 is board y = 0
    const h = getModeHandler(ed._currentMode);
    h.start(ed, { x: 0.4, y: 1 }, {});
    for (let x = 0.45; x <= 1.6; x += 0.05) h.update(ed, { x, y: 1 }, {});
    await h.finish(ed);
    const after = await layerHeights();
    for (const c of [60, 100, 140]) expect(after[100 * 200 + c], `col ${c}`).toBe(0);
  });
  it('E in the Draw tab is still Draw\'s eraser (the Height rail is hidden there)', () => {
    setEditorTab('height');
    setEditorTab('artwork');
    press('e');
    expect(ed._currentMode).toBe('erase');
    expect(heightTool()).toBe('brush');
  });
});
