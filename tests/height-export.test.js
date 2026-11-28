/**
 * HEIGHT-PAINTER slice 2, step 6: EXPORT (core/height/export.js). 'Export heightmap' saves the active patch's COMPOSITE as a
 * 16-bit greyscale PNG (the same on-first-use library as the import) with the mapping range in the file name
 * (name_0-0.5in.png; a patch with carved heights: name_-0.2-0.5in.png, mid-grey = 0). Export -> import gives back the same
 * heights within 16-bit precision (the import reads the range back from the name).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PNG_LIB, decodePng16 } from './height-png16.js';
import { exportRange, heightsToLevels, exportFileName, exportHeightmapPng } from '../bspline-frame-builder/b-spline-gen/html/core/height/export.js';
import { patchComposite } from '../bspline-frame-builder/b-spline-gen/html/core/height/compose.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, importHeightmap, exportHeightmap, applyHeightGradient,
  fillHeight, selectHeightRect, clearHeightSelection, addPaintLayer, setHeightField,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';

describe('the range, the levels, the name', () => {
  it('the range always holds 0 (0 = transparent), widened outward to the 4 decimals the name carries', () => {
    expect(exportRange(Float32Array.from([0, 0.1, 0.5]))).toEqual({ lo: 0, hi: 0.5 });
    expect(exportRange(Float32Array.from([0.2, 0.3]))).toEqual({ lo: 0, hi: 0.3 });
    expect(exportRange(Float32Array.from([-0.12341, 0.25]))).toEqual({ lo: -0.1235, hi: 0.25 });
    expect(exportRange(new Float32Array(3))).toEqual({ lo: 0, hi: 0 });
  });
  it('levels: lo 0 -> black = 0, white = hi; lo < 0 -> mid-grey = 0; rows top first', () => {
    expect(Array.from(heightsToLevels(Float32Array.from([0, 0.25, 0.5, 0.5]), 2, 2, { lo: 0, hi: 0.5 }))).toEqual([65535, 65535, 0, 32768]);
    expect(Array.from(heightsToLevels(Float32Array.from([-0.2, 0.5]), 2, 1, { lo: -0.2, hi: 0.5 }))).toEqual([0, 65535]);
  });
  it('the file name carries the range', () => {
    expect(exportFileName('Rose 1', { lo: 0, hi: 0.5 })).toBe('Rose-1_0-0.5in.png');
    expect(exportFileName('rose', { lo: -0.2, hi: 0.5 })).toBe('rose_-0.2-0.5in.png');
  });
  it('a 16-bit greyscale PNG through the library\'s encode', async () => {
    const out = await exportHeightmapPng(Float32Array.from([0, 0.5]), 2, 1, 'r', { png16: async () => PNG_LIB });
    expect(out.fileName).toBe('r_0-0.5in.png');
    expect(decodePng16(out.bytes)).toMatchObject({ width: 2, height: 1, depth: 16, channels: 1 });
    expect(Array.from(decodePng16(out.bytes).data)).toEqual([0, 65535]);
  });
});

describe('round trip: export -> import, the same heights within 16-bit precision', () => {
  const saved = {};
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 2; P.heightIn = 1; P.heightLayers = DEFAULT.heightLayers;
    document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    window.svgEditor = { _undoStack: [], pushState() { this._undoStack.push({}); }, _notifyChange() {} };
    initHeightPanel({});
  });
  afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; vi.useRealTimers(); });

  const loaders = { png16: async () => PNG_LIB, image8: () => { throw new Error('no'); }, exr: () => { throw new Error('no'); } };
  async function roundTrip() {
    const src = activeHeightLayer();
    const before = Float32Array.from(patchComposite(src));
    const out = await exportHeightmap({ png16: async () => PNG_LIB, download: false });
    const layer = await importHeightmap({ name: out.fileName, bytes: out.bytes }, { asNewPatch: true, loaders });
    const back = patchComposite(activeHeightLayer());
    expect(activeHeightLayer().id).not.toBe(src.id);
    expect(layer.raster.cols).toBe(200);
    expect(back.length).toBe(before.length);
    const tol = (out.range.hi - out.range.lo) / 65535;
    let worst = 0;
    for (let k = 0; k < before.length; k++) worst = Math.max(worst, Math.abs(back[k] - before[k]));
    expect(worst).toBeLessThanOrEqual(tol);
    return { out, worst };
  }
  it('a raised gradient (two layers composited): black = 0', async () => {
    await newHeightPatch();
    await applyHeightGradient([-0.995, 0], [0.995, 0], { startIn: 0, endIn: 0.4321, falloff: 'smooth' });
    await addPaintLayer();
    selectHeightRect([-0.5, -0.2], [0.5, 0.2]);
    await fillHeight({ heightIn: 0.05 });
    setHeightField('layerBlend', 'add');
    clearHeightSelection();
    const { out } = await roundTrip();
    expect(out.fileName).toMatch(/_0-0\.\d+in\.png$/);
    expect(out.range.lo).toBe(0);
  });
  it('a carved area too: mid-grey = 0, both signs back', async () => {
    await newHeightPatch();
    await applyHeightGradient([-0.995, 0], [0.995, 0], { startIn: -0.25, endIn: 0.375, falloff: 'linear' }); // Float16-exact stops
    const { out } = await roundTrip();
    expect(out.fileName).toBe('Pixel-1_-0.25-0.375in.png');
  });
});
