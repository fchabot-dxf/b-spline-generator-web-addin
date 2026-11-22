/**
 * HEIGHT-PAINTER slice 3b (Fred 2026-11-22: "I was more expecting a simple brush tool with the different brushes inside of
 * it in the right panel, with the falloff and the different chisel and bevel tools or profiles"):
 *  - ONE Brush tool on the rail; the modes (raise / lower / set / smooth / erase) are a row in the panel's Brush section;
 *  - a BRUSH PICKER at the top of that section: the declared core/height/brush.js BRUSH_PRESETS as icon tiles through the
 *    app's one picker (main/icon-select.js mountIconGrid); a pick sets the tip and its profile, never the size / opacity /
 *    amount; editing a setting afterwards leaves no tile highlighted and the note says "Modified (from <preset>)";
 *  - the tip settings show only for a non-round tip (the group's declared showWhen).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BRUSH_PRESETS, BRUSH_DEFAULTS, brushPresetOf, createStroke } from '../bspline-frame-builder/b-spline-gen/html/core/height/brush.js';

describe('buildUp (core/height/brush.js)', () => {
  // measured first: with build-up (slice 1), a chisel stroke's sides saturate -- the panel's chisel stroke test read
  // "expected 0 to be greater than 0" (the sides as high as the middle); buildUp false keeps the dab's cross-section
  const stroke = (buildUp) => {
    const raster = { cols: 101, rows: 41, data: new Float32Array(101 * 41) };
    const b = { ...BRUSH_DEFAULTS, mode: 'set', targetIn: 1, sizeIn: 0.6, falloff: 'linear', hardness: 0, buildUp };
    const s = createStroke(raster, b, { pxPerInX: 100, pxPerInY: 100 });
    s.addPoint(20, 20); s.addPoint(80, 20);
    return (c, r) => raster.data[r * 101 + c];
  };
  it('false: a pixel holds the highest single dab (the profile survives the stroke); absent / true: dabs build up', () => {
    const keep = stroke(false), build = stroke(undefined);
    expect(keep(50, 30)).toBeCloseTo(1 - 0.1 / 0.3, 5); // 10 px off the line: exactly the linear profile there
    expect(build(50, 30)).toBeGreaterThan(keep(50, 30) + 0.2);
    expect(keep(50, 20)).toBeCloseTo(1, 5);
  });
});
import { decodedRaster, f16Round } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, setHeightField, heightBrush, paintHeightStroke, HEIGHT_TOOLS,
  setHeightTool, fillHeight, whenHeightIdle,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { heightBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-height-tool.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const saved = {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 2; P.heightIn = 2; P.heightLayers = DEFAULT.heightLayers;
  document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
  _resetHeightPanelForTests();
  window.svgEditor = { _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() { this._undoStack.push({}); }, _notifyChange() {} };
  initHeightPanel({});
});
afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; setEditorTab('artwork'); vi.useRealTimers(); });

const tile = (id) => document.getElementById(`heightBrushPreset_${id}`);
const activeTiles = () => [...document.querySelectorAll('[data-height-brush-preset].active')].map((b) => b.getAttribute('data-height-brush-preset'));
const hidden = (el) => { for (let n = el; n; n = n.parentElement) if (n.hidden) return true; return false; };

describe('the declared presets', () => {
  it('BRUSH_PRESETS: one table with the brushes Fred named; each sets the tip and its profile only', () => {
    const ids = Object.keys(BRUSH_PRESETS);
    for (const want of ['softRound', 'hardRound', 'dome', 'spike', 'plateau', 'square', 'bevel', 'chisel', 'custom']) expect(ids).toContain(want);
    for (const p of Object.values(BRUSH_PRESETS)) {
      expect(typeof p.label).toBe('string');
      expect(Object.keys(p.brush).sort()).toEqual(['angle', 'buildUp', 'falloff', 'followStroke', 'hardness', 'roundness', 'tip']);
    }
    expect(BRUSH_PRESETS.bevel.brush).toMatchObject({ tip: 'square', falloff: 'linear', hardness: 0.3 });
    expect(BRUSH_PRESETS.chisel.brush).toMatchObject({ tip: 'chisel', followStroke: true });
    expect(BRUSH_PRESETS.custom.brush.falloff).toBe('custom');
    expect(brushPresetOf(BRUSH_DEFAULTS)).toBe('softRound'); // a session starts on a named brush
  });
});

describe('the rail and the panel', () => {
  it('ONE Brush tool on the rail: only the HEIGHT_TOOLS buttons, no per-mode buttons; the modes are a row in the Brush section', () => {
    const rail = document.getElementById('editorToolbarHeight');
    expect([...rail.querySelectorAll('[data-height-tool]')].map((b) => b.getAttribute('data-height-tool'))).toEqual(HEIGHT_TOOLS.map((t) => t.id));
    expect(rail.querySelectorAll('[data-height-choice]').length).toBe(0);
    // Fred 2026-11-22 ("we need an eraser too"): erase is its own rail tool, so the Brush's mode row is raise / lower / set / smooth
    const modes = [...document.querySelectorAll('#heightGroup_brush [data-height-choice^="mode:"]')].map((b) => b.getAttribute('data-height-choice'));
    expect(modes).toEqual(['mode:raise', 'mode:lower', 'mode:set', 'mode:smooth']);
    expect(HEIGHT_TOOLS.map((t) => t.id).slice(0, 2)).toEqual(['brush', 'eraser']);
  });
  it('the Eraser shares the Brush section (picker + settings) without its mode row', () => {
    setHeightTool('eraser');
    expect(hidden(document.getElementById('heightGroup_brush'))).toBe(false);
    expect(hidden(document.querySelector('[data-height-control="mode"]'))).toBe(true);
    expect(hidden(tile('chisel'))).toBe(false);
    setHeightTool('brush');
    expect(hidden(document.querySelector('[data-height-control="mode"]'))).toBe(false);
  });
  it('the picker is the app\'s icon grid at the top of the Brush section: a tile (with its drawn icon) per preset', () => {
    const group = document.getElementById('heightGroup_brush');
    const picker = group.querySelector('.icon-grid-picker');
    expect(picker).toBeTruthy();
    expect(group.querySelector('[data-height-control]').compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy(); // the picker comes first
    for (const id of Object.keys(BRUSH_PRESETS)) {
      expect(tile(id), id).toBeTruthy();
      expect(tile(id).querySelector('svg'), id).toBeTruthy();
    }
    expect(activeTiles()).toEqual(['softRound']);
  });
});

describe('picking', () => {
  it('Chisel: its tip + profile; size / opacity / amount kept; the tip settings now show', () => {
    setHeightField('sizeIn', 0.8); setHeightField('opacity', 0.6); setHeightField('amountIn', 0.07);
    const tipGroup = document.getElementById('heightGroup_tip');
    expect(hidden(tipGroup)).toBe(true); // a round tip: no tip settings
    tile('chisel').click();
    expect(heightBrush()).toMatchObject({ ...BRUSH_PRESETS.chisel.brush, sizeIn: 0.8, opacity: 0.6, amountIn: 0.07 });
    expect(activeTiles()).toEqual(['chisel']);
    expect(hidden(tipGroup)).toBe(false);
  });
  it('an edit after a pick: no tile highlighted, the note says Modified (from the preset)', () => {
    tile('bevel').click();
    expect(activeTiles()).toEqual(['bevel']);
    setHeightField('hardness', 0.55);
    expect(activeTiles()).toEqual([]);
    expect(document.getElementById('heightBrushPresetNote').textContent).toMatch(/Modified.*Bevel/);
    tile('bevel').click();
    expect(activeTiles()).toEqual(['bevel']);
    expect(document.getElementById('heightBrushPresetNote').textContent).toBe('');
  });
  it('Custom keeps its curve editable without leaving the preset', () => {
    tile('custom').click();
    expect(activeTiles()).toEqual(['custom']);
    setHeightField('customCurve', [[0, 1], [0.5, 0.2], [1, 0]]);
    expect(activeTiles()).toEqual(['custom']);
  });
  it('a Chisel stroke (turn with the stroke) lays a thin straight-sided ridge along the drag', async () => {
    await newHeightPatch(); // 200 x 200
    tile('chisel').click();
    setHeightField('sizeIn', 0.6);
    await paintHeightStroke([[-0.5, 0], [0.5, 0]], { mode: 'raise', amountIn: 0.1 }); // along X through row ~99.5
    const d = decodedRaster(activeHeightLayer().raster), at = (c, r) => d[r * 200 + c];
    expect(at(100, 99)).toBeGreaterThan(0.05);   // on the line
    expect(at(100, 130)).toBe(0);                // a round 0.6 in dab would reach 30 px off the line; the blade does not
    expect(at(100, 99) - at(100, 96)).toBeGreaterThan(0); // the sides slope (the chisel's linear profile)
  });
});

describe('the Eraser tool and Alt', () => {
  const at = (c, r) => decodedRaster(activeHeightLayer().raster)[r * 200 + c];
  const drag = async (e) => {
    const ed = window.svgEditor;
    heightBrushHandler.start(ed, { x: 0.5, y: 1 }, e); // board (-0.5, 0) -> (0.5, 0): along row ~99.5
    heightBrushHandler.update(ed, { x: 1.5, y: 1 }, e);
    await heightBrushHandler.finish(ed);
    await whenHeightIdle();
  };
  it('the Eraser with the Chisel picked erases a thin line to 0 (transparent) and leaves the rest', async () => {
    await newHeightPatch();
    await fillHeight({ heightIn: 0.2 });
    setEditorTab('height');
    setHeightTool('eraser');
    tile('chisel').click();
    setHeightField('sizeIn', 0.6); setHeightField('hardness', 1);
    await drag({ pointerType: 'mouse' });
    expect(at(100, 99)).toBe(0);
    expect(at(100, 130)).toBe(f16Round(0.2)); // the blade's width, not a 0.6 in round dab
    expect(at(10, 99)).toBe(f16Round(0.2));   // past the stroke's end
  });
  it('Alt while painting with the Brush flips Raise to Lower for that stroke only', async () => {
    await newHeightPatch();
    setEditorTab('height');
    setHeightTool('brush');
    setHeightField('mode', 'raise'); setHeightField('amountIn', 0.1); setHeightField('hardness', 1);
    await drag({ pointerType: 'mouse', altKey: true });
    expect(at(100, 99)).toBeLessThan(-0.05);
    expect(heightBrush().mode).toBe('raise');
    await drag({ pointerType: 'mouse' });
    expect(at(100, 99)).toBeCloseTo(0, 2); // a raise stroke over it: back up
  });
});
