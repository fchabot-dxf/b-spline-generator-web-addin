/**
 * HEIGHT-PAINTER slice 2, step 5: HEIGHTMAP IMPORT as an IMAGE layer (core/height/import.js). 8-bit PNG / JPG / WebP through
 * the browser's own decoder; a 16-bit PNG through a small library loaded ON FIRST USE from a pinned CDN URL (the 16 bits
 * kept); EXR through three r128's EXRLoader (pinned, on first use). The layer keeps the NORMALISED grey 0..1 at the patch's
 * pixel grid and a LIVE mapping { zero: 'black' | 'mid', whiteIn, darkIn }: a new mapping re-composites, never re-imports.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { png16Bytes, PNG_LIB } from './height-png16.js';
import {
  HEIGHTMAP_LIB_URLS, sniffHeightmap, decodeHeightmap, resampleToGrid, mappingFromName,
} from '../bspline-frame-builder/b-spline-gen/html/core/height/import.js';
import { encodeRaster, decodeRaster, decodedRaster, RASTER_ENC_U16 } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { patchComposite, mapImageValue } from '../bspline-frame-builder/b-spline-gen/html/core/height/compose.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, activePatchLayer, _resetHeightPanelForTests, importHeightmap, setHeightField,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';

/** The browser decoder's stand-in: an RGBA picture (the shape the app reads from a canvas). */
const image8 = (w, h, greys) => async () => ({ width: w, height: h, rgba: Uint8ClampedArray.from(greys.flatMap((g) => [g, g, g, 255])) });
const noCdn = () => { throw new Error('the CDN library must not load for this file'); };

describe('the libraries are pinned and load on first use only', () => {
  it('exact versions on jsDelivr; nothing is loaded at import time', () => {
    expect(HEIGHTMAP_LIB_URLS.png).toBe('https://cdn.jsdelivr.net/npm/fast-png@6.2.0/+esm');
    expect(HEIGHTMAP_LIB_URLS.exr).toBe('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/EXRLoader.js');
    expect(HEIGHTMAP_LIB_URLS.fflate).toBe('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/fflate.min.js');
    expect(document.querySelectorAll('script[src*="EXRLoader"], script[src*="fflate"]').length).toBe(0);
  });
  it('sniffs the file: 16-bit PNG by its IHDR bit depth, EXR by its magic, anything else = the browser', () => {
    expect(sniffHeightmap('a.png', png16Bytes(2, 1, [0, 65535]))).toBe('png16');
    const png8 = png16Bytes(2, 1, [0, 1]); png8[24] = 8;
    expect(sniffHeightmap('a.png', png8)).toBe('image8');
    expect(sniffHeightmap('a.exr', Uint8Array.from([0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0]))).toBe('exr');
    expect(sniffHeightmap('a.jpg', Uint8Array.from([0xff, 0xd8, 0xff]))).toBe('image8');
  });
});

describe('decode -> normalised grey (row 0 = the image top)', () => {
  it('an 8-bit picture: grey / 255, exactly; the 16-bit library is not loaded', async () => {
    const out = await decodeHeightmap('h.png', new Uint8Array(4), { image8: image8(3, 1, [0, 51, 255]), png16: noCdn, exr: noCdn });
    expect(out).toMatchObject({ width: 3, height: 1, bits: 8 });
    expect(Array.from(out.values)).toEqual([0, Math.fround(51 / 255), 1]);
  });
  it('a 16-bit PNG keeps 16 bits: a 65536-level ramp reads back as 65536 distinct levels, each q / 65535', async () => {
    const W = 256, H = 256, ramp = Array.from({ length: W * H }, (_, k) => k);
    const out = await decodeHeightmap('ramp.png', png16Bytes(W, H, ramp), { png16: async () => PNG_LIB, image8: noCdn, exr: noCdn });
    expect(out).toMatchObject({ width: 256, height: 256, bits: 16 });
    expect(new Set(out.values).size).toBe(65536);
    expect(out.values[1]).toBe(Math.fround(1 / 65535));
    expect(out.values[65535]).toBe(1);
  });
  it('an EXR (three r128 EXRLoader\'s parse shape: RGBA floats, rows bottom-up): its R channel, normalised, top row first', async () => {
    const exr = { parse: () => ({ width: 2, height: 2, data: Float32Array.from([0, 9, 9, 1, 1, 9, 9, 1, 2, 9, 9, 1, 4, 9, 9, 1]), format: 1023, type: 1015 }) };
    const out = await decodeHeightmap('h.exr', Uint8Array.from([0x76, 0x2f, 0x31, 0x01]), { exr: async () => exr, png16: noCdn, image8: noCdn });
    expect(out).toMatchObject({ width: 2, height: 2, bits: 32 });
    expect(Array.from(out.values)).toEqual([0.5, 1, 0, 0.25]); // bottom row (0, 1) is the image's last row
  });
});

describe('resampling to the patch grid (raster frame: row 0 = the bottom)', () => {
  it('the same size: exact, rows flipped', () => {
    expect(Array.from(resampleToGrid(Float32Array.from([1, 2, 3, 4, 5, 6]), 3, 2, 3, 2))).toEqual([4, 5, 6, 1, 2, 3]);
  });
  it('half the size: the area mean; twice: between the samples', () => {
    expect(Array.from(resampleToGrid(Float32Array.from([0, 2, 4, 6]), 4, 1, 2, 1))).toEqual([1, 5]);
    const up = resampleToGrid(Float32Array.from([0, 1]), 2, 1, 4, 1);
    expect(Array.from(up)).toEqual([0, 0.25, 0.75, 1]);
  });
});

describe('the stored values and the LIVE mapping', () => {
  it('u16 storage keeps a 16-bit level exactly (q / 65535)', async () => {
    const v = Float32Array.from([0, 1 / 65535, 32768 / 65535, 1]);
    const r = await encodeRaster(v, 4, 1, RASTER_ENC_U16);
    expect(r.enc).toBe('u16-deflate-b64');
    expect(Array.from(await decodeRaster(r))).toEqual(Array.from(v));
  });
  it('black = 0: v x whiteIn; mid = 0: (v - 0.5) x 2 x (whiteIn above, darkIn below)', () => {
    expect(mapImageValue(0.5, { zero: 'black', whiteIn: 0.4, darkIn: 0.1 })).toBeCloseTo(0.2, 12);
    expect(mapImageValue(0.75, { zero: 'mid', whiteIn: 0.4, darkIn: 0.1 })).toBeCloseTo(0.2, 12);
    expect(mapImageValue(0.25, { zero: 'mid', whiteIn: 0.4, darkIn: 0.1 })).toBeCloseTo(-0.05, 12);
  });
  it('the mapping range a file name carries (an export\'s): name_0-0.5in.png, name_-0.2-0.5in.png', () => {
    expect(mappingFromName('rose_0-0.5in.png')).toEqual({ zero: 'black', whiteIn: 0.5, darkIn: 0.5 });
    expect(mappingFromName('rose_-0.2-0.5in.png')).toEqual({ zero: 'mid', whiteIn: 0.5, darkIn: 0.2 });
    expect(mappingFromName('rose.png')).toBeNull();
  });
});

describe('the panel: Import heightmap', () => {
  const saved = {};
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 2.56; P.heightIn = 3; P.heightLayers = DEFAULT.heightLayers;
    document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    window.svgEditor = { _undoStack: [], pushState() { this._undoStack.push({}); }, _notifyChange() {} };
    initHeightPanel({});
  });
  afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; vi.useRealTimers(); });

  const W = 256, H = 256, ramp = Array.from({ length: W * H }, (_, k) => k);
  const loaders = { png16: async () => PNG_LIB, image8: noCdn, exr: noCdn };
  it('as a new patch sized to the image (fit in the board, 100 px/in): an image layer of normalised values, 16 bits kept, ONE step', async () => {
    const steps = window.svgEditor._undoStack.length;
    await importHeightmap({ name: 'ramp.png', bytes: png16Bytes(W, H, ramp) }, { asNewPatch: true, loaders });
    expect(window.svgEditor._undoStack.length).toBe(steps + 1);
    const rec = activeHeightLayer();
    expect(rec.sizeIn).toEqual({ w: 2.56, h: 2.56 });
    expect(rec.layers).toHaveLength(1);
    const layer = rec.layers[0];
    expect(layer).toMatchObject({ kind: 'image', name: 'ramp.png', visible: true, opacity: 1, blend: 'normal' });
    expect(layer.raster).toMatchObject({ cols: 256, rows: 256, enc: 'u16-deflate-b64' });
    const v = decodedRaster(layer.raster);
    expect(new Set(v).size).toBe(65536); // not quantised to 256
    expect(v[255 * 256]).toBe(0); // image row 0 = the patch's top = raster row 255
    expect(v[1]).toBe(Math.fround((255 * 256 + 1) / 65535));
  });
  it('the mapping changes the heights at once, the stored values (and their hash) stay: no re-import', async () => {
    await importHeightmap({ name: 'ramp.png', bytes: png16Bytes(W, H, ramp) }, { asNewPatch: true, loaders });
    const h0 = activePatchLayer().raster.h;
    const k = 100 * 256 + 7, v = decodedRaster(activePatchLayer().raster)[k];
    expect(patchComposite(activeHeightLayer())[k]).toBeCloseTo(v * 0.25, 7); // the default: black = 0, white = 0.25 in
    setHeightField('imageWhiteIn', 0.5);
    expect(patchComposite(activeHeightLayer())[k]).toBeCloseTo(v * 0.5, 7);
    setHeightField('imageZero', 'mid');
    setHeightField('imageDarkIn', 0.1);
    const mid = patchComposite(activeHeightLayer())[k];
    expect(mid).toBeCloseTo((v - 0.5) * 2 * (v >= 0.5 ? 0.5 : 0.1), 7);
    expect(activePatchLayer().raster.h).toBe(h0);
  });
  it('into the active patch: resampled to its grid, above the active layer; an 8-bit file never loads the 16-bit library', async () => {
    P.widthIn = 0.04; P.heightIn = 0.02;
    await newHeightPatch(); // 4 x 2 px
    await importHeightmap({ name: 'g.png', bytes: new Uint8Array(4) }, { asNewPatch: false, loaders: { image8: image8(4, 2, [0, 51, 102, 153, 204, 255, 0, 255]), png16: noCdn, exr: noCdn } });
    const rec = activeHeightLayer();
    expect(rec.layers.map((l) => l.kind)).toEqual(['paint', 'image']);
    expect(Array.from(decodedRaster(rec.layers[1].raster))).toEqual([204, 255, 0, 255, 0, 51, 102, 153].map((g) => Math.fround(g / 255)));
  });
  it('a file name with an export range sets the mapping', async () => {
    await importHeightmap({ name: 'rose_0-0.5in.png', bytes: png16Bytes(2, 2, [0, 65535, 0, 65535]) }, { asNewPatch: true, loaders });
    expect(activePatchLayer().mapping).toEqual({ zero: 'black', whiteIn: 0.5, darkIn: 0.5 });
  });
});
