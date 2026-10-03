/**
 * H23 item 71 — core/stamp/decal-png.js (buildArtworkDecalPng), item 68's own spike promoted to a
 * real module. "The PNG respects the layer choice and opacity" (the brief's own wording).
 *
 * happy-dom (this suite's test environment) has no real Canvas 2D context --
 * `canvas.getContext('2d')` returns null here, confirmed directly -- so the actual RASTERIZATION
 * (renderSvgNative, which calls ctx.drawImage) has never had a vitest test anywhere in this repo
 * (there is no render-svg.test.js); it's only ever verified live, with real pixel sampling (items
 * 68/69's own WORK-LOG entries). This file follows that same split: buildDrapeSvg's own layer
 * filtering is REAL (pure string/DOM logic, drape-svg.test.js's own precedent), only the
 * canvas-touching half (document.createElement('canvas'), renderSvgNative) is faked, so what's
 * actually exercised here is buildArtworkDecalPng's OWN logic -- which layers it hands to
 * buildDrapeSvg, and what globalAlpha it sets before rendering -- not a re-test of either of
 * those two already-tested/already-measured pieces.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildArtworkDecalPng } from '../bspline-frame-builder/b-spline-gen/html/core/stamp/decal-png.js';

const SKETCH = `<svg xmlns="http://www.w3.org/2000/svg" width="672" height="864" viewBox="0 0 7 9" preserveAspectRatio="none">` +
  `<line data-layer="rails" x1="0" y1="1" x2="6" y2="1" stroke="#c62828" fill="none"/>` +
  `<line data-layer="ties" x1="1" y1="0" x2="1" y2="2" stroke="#f9c80e" fill="none"/>` +
  `</svg>`;

function fakeEditor(layers) {
  return { _mW: 7, _mH: 9, _layers: layers, save: () => SKETCH };
}

const QUALIFYING_LAYERS = [
  { id: 'rails', visible: true, showColor: true },
  { id: 'ties', visible: true, showColor: true },
];

let lastRenderedSvg = null;
let lastCtx = null;
let lastCanvasSize = null;

beforeEach(() => {
  lastRenderedSvg = null;
  lastCtx = null;
  lastCanvasSize = null;
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag !== 'canvas') return realCreateElement(tag);
    const ctx = { globalAlpha: 1 };
    const canvas = {
      _w: 0, _h: 0,
      get width() { return this._w; }, set width(v) { this._w = v; },
      get height() { return this._h; }, set height(v) { this._h = v; },
      getContext: () => { lastCtx = ctx; return ctx; },
      toDataURL: () => { lastCanvasSize = { w: canvas._w, h: canvas._h }; return 'data:image/png;base64,FAKE'; },
    };
    return canvas;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/stamp/render-svg.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // sanitizeSvgForRaster/prepareSvgForRaster stay REAL (pure string functions, no canvas) --
    // only the one function that actually touches the canvas (ctx.drawImage) is faked, capturing
    // what buildArtworkDecalPng handed it so the test can inspect both the filtered SVG and the
    // ctx's own globalAlpha at the moment of the (would-be) draw.
    renderSvgNative: vi.fn(async (ctx, svgString) => { lastRenderedSvg = svgString; lastCtx = ctx; }),
  };
});

describe('buildArtworkDecalPng', () => {
  it('with no layerIds filter: every qualifying layer reaches the rendered SVG', async () => {
    const editor = fakeEditor(QUALIFYING_LAYERS);
    const png = await buildArtworkDecalPng(editor, { dpi: 40 });
    expect(png).toBe('data:image/png;base64,FAKE');
    expect(lastRenderedSvg).toContain('data-layer="rails"');
    expect(lastRenderedSvg).toContain('data-layer="ties"');
  });

  it('a layer explicitly excluded (layerIds[id] === false) is dropped from the rendered SVG, the rest stay', () => {
    const editor = fakeEditor(QUALIFYING_LAYERS);
    return buildArtworkDecalPng(editor, { dpi: 40, layerIds: { ties: false } }).then(() => {
      expect(lastRenderedSvg).not.toContain('data-layer="ties"');
      expect(lastRenderedSvg).toContain('data-layer="rails"');
    });
  });

  it('a layer id MISSING from layerIds (never explicitly set) is still included — "included unless false"', async () => {
    const editor = fakeEditor(QUALIFYING_LAYERS);
    // layerIds only mentions 'rails'; 'ties' is absent, not false
    await buildArtworkDecalPng(editor, { dpi: 40, layerIds: { rails: true } });
    expect(lastRenderedSvg).toContain('data-layer="rails"');
    expect(lastRenderedSvg).toContain('data-layer="ties"');
  });

  it('every layer excluded (layerIds all false): buildDrapeSvg has nothing left, returns null WITHOUT ever touching the canvas', async () => {
    const editor = fakeEditor(QUALIFYING_LAYERS);
    const png = await buildArtworkDecalPng(editor, { layerIds: { rails: false, ties: false } });
    expect(png).toBeNull();
    expect(lastRenderedSvg).toBeNull(); // non-vacuous: render was never reached, not just "returned null anyway"
  });

  it('opacity 60 sets ctx.globalAlpha to 0.6 before rendering (default 100 -> 1)', async () => {
    const editor = fakeEditor(QUALIFYING_LAYERS);
    await buildArtworkDecalPng(editor, { dpi: 40, opacity: 60 });
    expect(lastCtx.globalAlpha).toBeCloseTo(0.6, 5);

    await buildArtworkDecalPng(editor, { dpi: 40 }); // opacity omitted -> default 100
    expect(lastCtx.globalAlpha).toBeCloseTo(1, 5);
  });

  it('opacity is clamped to [0,100] -- a stray 150 or -10 never produces alpha outside [0,1]', async () => {
    const editor = fakeEditor(QUALIFYING_LAYERS);
    await buildArtworkDecalPng(editor, { dpi: 40, opacity: 150 });
    expect(lastCtx.globalAlpha).toBeCloseTo(1, 5);
    await buildArtworkDecalPng(editor, { dpi: 40, opacity: -10 });
    expect(lastCtx.globalAlpha).toBeCloseTo(0, 5);
  });

  it('dpi sets the real pixel dimensions (board 7x9in, 40 dpi -> 280x360)', async () => {
    const editor = fakeEditor(QUALIFYING_LAYERS);
    await buildArtworkDecalPng(editor, { dpi: 40 });
    expect(lastCanvasSize).toEqual({ w: 280, h: 360 });
  });

  it('default dpi (150) is used when omitted', async () => {
    const editor = fakeEditor(QUALIFYING_LAYERS);
    await buildArtworkDecalPng(editor, {});
    expect(lastCanvasSize).toEqual({ w: 1050, h: 1350 });
  });

  it('no editor: returns null, never throws', async () => {
    await expect(buildArtworkDecalPng(null)).resolves.toBeNull();
  });
});
