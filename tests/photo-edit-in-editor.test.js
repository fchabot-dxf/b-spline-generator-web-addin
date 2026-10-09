/**
 * 2026-10-08 (seat A; seat D measured the Photo straighten drag at 4.9 - 8.5 s a drag, phone 4x CPU). Two causes:
 *  1. The Photo tab (inside the editor) called back on every slider step straight into a FULL rebuild -- the 3D the
 *     editor hides (F35 item 18 (4), "no 3D while editing"; the frame mesh alone 1.4 s of a 2.2 s step). Now
 *     core/in-editor-3d.js IN_EDITOR_3D 'photo': editor open -> repaint the editor's backdrop only (render-topview.js
 *     refreshEditorTopView, at most once per animation frame); closed -> the full rebuild.
 *  2. The photo cache (core/photo/state.js) built its string key -- url + JSON of the edits -- for every SAMPLED
 *     PIXEL: 1.1 s of one 384-wide backdrop paint. Now the same url / edits objects skip it.
 * MEASURED in the browser (seeded phone runs, editor open, a 10-step drag): no rebuild during the drag, the backdrop
 * after it byte-identical to a full rebuild's (and to main's), release -> idle 0.33 s (was ~0.85 s).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { IN_EDITOR_3D, inEditor3dAction } from '../bspline-frame-builder/b-spline-gen/html/core/in-editor-3d.js';
import { updateEditorTopView, refreshEditorTopView, flushEditorTopView } from '../bspline-frame-builder/b-spline-gen/html/core/render-topview.js';
import { ensurePhotoDecoded, getProcessedPhotoImage, _resetPhotoStateForTests } from '../bspline-frame-builder/b-spline-gen/html/core/photo/state.js';
import * as ops from '../bspline-frame-builder/b-spline-gen/html/core/photo/ops.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/codec.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, decodeImageToGrey: vi.fn(async () => ({ data: new Float32Array(16).fill(0.5), w: 4, h: 4 })) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/ops.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, applyPhotoEdits: vi.fn(actual.applyPhotoEdits) };
});

const modal = { style: { display: 'none' } };
const painted = [];
const ctx = {
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: (img) => painted.push(Uint8ClampedArray.from(img.data)),
  beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, isContextLost: () => false,
};
const canvas = { width: 0, height: 0, getContext: () => ctx, addEventListener() {} };
let frames = [];
const realGetById = document.getElementById.bind(document);

beforeEach(() => {
  document.getElementById = (id) => (id === 'svgEditorModal' ? modal : id === 'svgEditorTopView' ? canvas : realGetById(id));
  window.svgEditor = { sync3DBackground: () => flushEditorTopView() };
  frames = [];
  globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  painted.length = 0;
});
afterEach(() => { document.getElementById = realGetById; modal.style.display = 'none'; delete globalThis.requestAnimationFrame; });

describe('a photo change made in the editor reaches its backdrop, not the 3D (F35 item 18 (4))', () => {
  it("IN_EDITOR_3D 'photo': editor open -> the backdrop; closed -> the full rebuild", () => {
    expect(IN_EDITOR_3D.photo).toEqual({ inEditor: 'backdrop', inEditorDrag: 'none', closed: 'rebuild' });
    modal.style.display = 'flex';
    expect(inEditor3dAction('photo')).toBe('backdrop');
    expect(inEditor3dAction('photo', { drag: true })).toBe('none'); // Fred 2026-10-09: a drag tick repaints on release
    modal.style.display = 'none';
    expect(inEditor3dAction('photo')).toBe('rebuild');
  });

  it("main.js's photo callback reads it: the backdrop refresh, else the rebuild", () => {
    const src = readFileSync('bspline-frame-builder/b-spline-gen/html/main/main.js', 'utf8');
    const at = src.indexOf('initPhotoPanel({');
    const block = src.slice(at, src.indexOf('});', at));
    expect(block).toMatch(/const action = inEditor3dAction\('photo', opts\);/);
    expect(block).toMatch(/if \(action === 'backdrop'\) refreshEditorTopView\(\);\s*else if \(action === 'rebuild'\) scheduleRebuild\(/);
  });

  it('the backdrop refresh paints once per animation frame, with the latest params', () => {
    modal.style.display = 'flex';
    const seed = P.seed;
    try {
      updateEditorTopView(null, 0, 0); // a rebuild's inputs (the editor open: painted at once)
      painted.length = 0;
      P.seed = 101; refreshEditorTopView();
      P.seed = 202; refreshEditorTopView();
      P.seed = 303; refreshEditorTopView(); // three steps of one drag inside one frame
      expect(painted).toHaveLength(0);
      expect(frames).toHaveLength(1);
      frames.shift()();
      expect(painted).toHaveLength(1);
      const got = painted.pop();
      updateEditorTopView(null, 0, 0); // P.seed 303 painted directly
      expect(Buffer.from(got).equals(Buffer.from(painted.pop()))).toBe(true);
    } finally { P.seed = seed; }
  });
});

describe("the photo cache's per-pixel check", () => {
  beforeEach(() => { _resetPhotoStateForTests(); ops.applyPhotoEdits.mockClear(); });

  it('the same url / edits objects build the key once over many samples', async () => {
    await ensurePhotoDecoded('data:px');
    const params = { photoImageDataUrl: 'data:px', photoEdits: [{ op: 'invert', params: {} }] };
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      for (let i = 0; i < 1000; i++) getProcessedPhotoImage(params);
      expect(stringify.mock.calls.length).toBeLessThanOrEqual(1);
    } finally { stringify.mockRestore(); }
    expect(ops.applyPhotoEdits).toHaveBeenCalledTimes(1);
  });

  it('a new edits array: same contents reuse the image, new contents re-process it; a re-decode re-processes', async () => {
    await ensurePhotoDecoded('data:px2');
    const edits = [{ op: 'invert', params: {} }];
    const first = getProcessedPhotoImage({ photoImageDataUrl: 'data:px2', photoEdits: edits });
    expect(getProcessedPhotoImage({ photoImageDataUrl: 'data:px2', photoEdits: JSON.parse(JSON.stringify(edits)) })).toBe(first);
    expect(ops.applyPhotoEdits).toHaveBeenCalledTimes(1);
    const params = { photoImageDataUrl: 'data:px2', photoEdits: [] };
    getProcessedPhotoImage(params);
    expect(ops.applyPhotoEdits).toHaveBeenCalledTimes(2);
    // a fresh decode of the SAME url (another photo in between): the very same params objects must re-process
    await ensurePhotoDecoded('data:other');
    await ensurePhotoDecoded('data:px2');
    getProcessedPhotoImage(params);
    expect(ops.applyPhotoEdits).toHaveBeenCalledTimes(3);
  });
});
