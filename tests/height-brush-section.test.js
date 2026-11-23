/**
 * HEIGHT-PAINTER slice 3c (Fred 2026-11-22: "I'd rather not have presets like that, we just pick square or round and pick
 * separately a falloff profile"). The Brush section of the Height panel, top to bottom: the MODE row (raise / lower / set /
 * smooth; not for the Eraser), the TIP row (Round | Square | Chisel, each with a drawn footprint), the FALLOFF row (the
 * BRUSH_FALLOFFS profiles, each with a drawn profile; Custom opens the curve widget), then size, hardness, opacity, flow,
 * spacing, amount / set-to-height, Build up (a checkbox, default ON = the slice-1 build-up), and the tip extras (roundness,
 * angle, turn with the stroke) only for Square / Chisel. No presets: a bevel is Square + Linear, picked by hand.
 * Kept from slice 3b: ONE Brush tool + the Eraser on the rail, Alt flips raise <-> lower, the active tool's section first.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as BRUSH from '../bspline-frame-builder/b-spline-gen/html/core/height/brush.js';
import { decodedRaster, f16Round } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, setHeightField, heightBrush, paintHeightStroke, HEIGHT_TOOLS,
  setHeightTool, fillHeight, whenHeightIdle,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { heightBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-height-tool.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const { BRUSH_DEFAULTS, BRUSH_FALLOFFS, BRUSH_TIPS, createStroke } = BRUSH;

describe('buildUp (core/height/brush.js)', () => {
  // slice 3b, measured: with build-up (slice 1) a chisel stroke's sides saturate; buildUp false keeps the cross-section
  const stroke = (buildUp) => {
    const raster = { cols: 101, rows: 41, data: new Float32Array(101 * 41) };
    const b = { ...BRUSH_DEFAULTS, mode: 'set', targetIn: 1, sizeIn: 0.6, falloff: 'linear', hardness: 0, buildUp };
    const s = createStroke(raster, b, { pxPerInX: 100, pxPerInY: 100 });
    s.addPoint(20, 20); s.addPoint(80, 20);
    return (c, r) => raster.data[r * 101 + c];
  };
  it('false: a pixel holds the highest single dab (the profile survives the stroke); absent / true: dabs build up', () => {
    const keep = stroke(false), build = stroke(undefined);
    expect(keep(50, 30)).toBeCloseTo(1 - 0.1 / 0.3, 5);
    expect(build(50, 30)).toBeGreaterThan(keep(50, 30) + 0.2);
    expect(keep(50, 20)).toBeCloseTo(1, 5);
  });
});

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

const hidden = (el) => { for (let n = el; n; n = n.parentElement) if (n.hidden) return true; return false; };
const controlsIn = (groupId) => [...document.querySelectorAll(`#${groupId} [data-height-control]`)].map((w) => w.getAttribute('data-height-control'));
const choice = (id, key) => document.querySelector(`[data-height-choice="${id}:${key}"]`);

describe('the Brush section: no presets, Tip and Falloff picked separately', () => {
  it('no preset table, no picker, no Modified note (Fred 2026-11-22: no presets)', () => {
    expect(BRUSH.BRUSH_PRESETS).toBeUndefined();
    expect(BRUSH.brushPresetOf).toBeUndefined();
    expect(document.querySelector('[data-height-brush-preset]')).toBeNull();
    expect(document.querySelector('#heightGroup_brush .icon-grid-picker')).toBeNull();
    expect(document.getElementById('heightBrushPresetNote')).toBeNull();
  });
  it('top to bottom: Mode, Tip, Falloff (+ its curve), size, hardness, opacity, flow, spacing, amount / set, ..., Build up', () => {
    const ids = controlsIn('heightGroup_brush');
    // Fred 2026-11-23 (slice 5): the Invert toggle heads the section
    expect(ids[0]).toBe('invert');
    expect(ids.slice(1, 12)).toEqual(['mode', 'tip', 'falloff', 'customCurve', 'sizeIn', 'hardness', 'opacity', 'flow', 'spacing', 'amountIn', 'targetIn']);
    expect(ids).toContain('buildUp');
    expect(ids.indexOf('buildUp')).toBeGreaterThan(ids.indexOf('targetIn'));
    // the tip extras: their own group right after, only for a square / chisel tip
    expect(controlsIn('heightGroup_tip')).toEqual(['roundness', 'angle', 'followStroke']);
    expect(hidden(document.getElementById('heightGroup_tip'))).toBe(true);
    for (const t of ['square', 'chisel']) { choice('tip', t).click(); expect(hidden(document.getElementById('heightGroup_tip')), t).toBe(false); }
    choice('tip', 'round').click();
    expect(hidden(document.getElementById('heightGroup_tip'))).toBe(true);
  });
  it('each Tip and each Falloff option shows a drawn icon (with its name)', () => {
    for (const k of Object.keys(BRUSH_TIPS)) { const b = choice('tip', k); expect(b.querySelector('svg'), k).toBeTruthy(); expect(b.textContent).toMatch(BRUSH_TIPS[k].label); }
    for (const k of Object.keys(BRUSH_FALLOFFS)) { const b = choice('falloff', k); expect(b.querySelector('svg'), k).toBeTruthy(); expect(b.textContent).toMatch(BRUSH_FALLOFFS[k].label); }
  });
  it('Build up: a checkbox, ON by default (slice 1), never switched by a tip or falloff choice', () => {
    expect(BRUSH_DEFAULTS.buildUp).toBe(true);
    expect(document.getElementById('height_buildUp').checked).toBe(true);
    choice('tip', 'chisel').click(); choice('falloff', 'linear').click();
    expect(heightBrush().buildUp).toBe(true);
    expect(document.getElementById('height_buildUp').checked).toBe(true);
  });
  it('a bevel by hand: Square + Linear, hardness 0.3 -- a dab is a chamfer in the stored raster', async () => {
    choice('tip', 'square').click(); choice('falloff', 'linear').click(); setHeightField('hardness', 0.3);
    await newHeightPatch(); // 200 x 200
    await paintHeightStroke([[0, 0]], { mode: 'set', targetIn: 0.2, sizeIn: 0.6 });
    const d = decodedRaster(activeHeightLayer().raster), px = (c, r) => d[r * 200 + c];
    expect(px(99, 99)).toBe(f16Round(0.2));
    expect(px(120, 99)).toBe(px(120, 120));
    expect(px(120, 99)).toBeGreaterThan(0.05); expect(px(120, 99)).toBeLessThan(0.15);
  });
  it('a Chisel stroke with Turn with the stroke and Build up off: a thin straight-sided ridge along the drag', async () => {
    await newHeightPatch();
    choice('tip', 'chisel').click(); choice('falloff', 'linear').click();
    setHeightField('hardness', 0); setHeightField('followStroke', true); setHeightField('buildUp', false); setHeightField('sizeIn', 0.6);
    await paintHeightStroke([[-0.5, 0], [0.5, 0]], { mode: 'raise', amountIn: 0.1 });
    const d = decodedRaster(activeHeightLayer().raster), at = (c, r) => d[r * 200 + c];
    expect(at(100, 99)).toBeGreaterThan(0.05);
    expect(at(100, 130)).toBe(0);
    expect(at(100, 99) - at(100, 96)).toBeGreaterThan(0);
  });
});

describe('kept from slice 3b', () => {
  it('ONE Brush tool + the Eraser on the rail; the mode row is raise / lower / set / smooth; the Eraser hides it', () => {
    const rail = document.getElementById('editorToolbarHeight');
    expect([...rail.querySelectorAll('[data-height-tool]')].map((b) => b.getAttribute('data-height-tool'))).toEqual(HEIGHT_TOOLS.map((t) => t.id));
    expect(rail.querySelectorAll('[data-height-choice]').length).toBe(0);
    expect([...document.querySelectorAll('#heightGroup_brush [data-height-choice^="mode:"]')].map((b) => b.getAttribute('data-height-choice')))
      .toEqual(['mode:raise', 'mode:lower', 'mode:set', 'mode:smooth']);
    setHeightTool('eraser');
    expect(hidden(document.getElementById('heightGroup_brush'))).toBe(false);
    expect(hidden(document.querySelector('[data-height-control="mode"]'))).toBe(true);
    expect(hidden(document.querySelector('[data-height-control="tip"]'))).toBe(false);
  });
  it('the active tool\'s section comes first (leads + CSS order)', async () => {
    const first = () => [...document.getElementById('heightPanelBody').children].filter((c) => !c.hidden && c.id.startsWith('heightGroup_'))
      .sort((a, b) => Number(a.style.order) - Number(b.style.order))[0].id;
    expect(first()).toBe('heightGroup_brush');
    await newHeightPatch();
    for (const [tool, group] of [['eraser', 'heightGroup_brush'], ['move', 'heightGroup_move'], ['selectLasso', 'heightGroup_select'], ['gradient', 'heightGroup_gradient'], ['fill', 'heightGroup_fill']]) {
      setHeightTool(tool);
      expect(first(), tool).toBe(group);
    }
  });
  const at = (c, r) => decodedRaster(activeHeightLayer().raster)[r * 200 + c];
  const drag = async (e) => {
    const ed = window.svgEditor;
    heightBrushHandler.start(ed, { x: 0.5, y: 1 }, e);
    heightBrushHandler.update(ed, { x: 1.5, y: 1 }, e);
    await heightBrushHandler.finish(ed);
    await whenHeightIdle();
  };
  it('the Eraser with a Chisel tip erases a thin line to 0 and leaves the rest', async () => {
    await newHeightPatch();
    await fillHeight({ heightIn: 0.2 });
    setEditorTab('height');
    setHeightTool('eraser');
    choice('tip', 'chisel').click();
    setHeightField('followStroke', true); setHeightField('sizeIn', 0.6); setHeightField('hardness', 1);
    await drag({ pointerType: 'mouse' });
    expect(at(100, 99)).toBe(0);
    expect(at(100, 130)).toBe(f16Round(0.2));
    expect(at(10, 99)).toBe(f16Round(0.2));
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
    expect(at(100, 99)).toBeCloseTo(0, 2);
  });
});
