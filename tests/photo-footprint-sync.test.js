/**
 * 2026-10-10 (the blind gate, MEASURED on main 84d505c: "Photo: blur slider release" / "Rotate 90" froze 63-67 ms before
 * their card): the photo footprint (main/photo-footprint.js) redrew on every photo edit by asking for the PROCESSED
 * photo, which ran the edit pipeline (applyPhotoEdits: the blur) synchronously in the tap, before the 'backdrop' card.
 * On an edit it now reads the processed image only when it is ready (core/photo/state.js peekProcessedPhotoImage) and
 * redraws after the backdrop repaint (core/render-topview.js 'editorTopViewUpdated'), which processes it behind its card.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/codec.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, decodeImageToGrey: vi.fn(async () => ({ data: new Float32Array(40 * 30).fill(0.5), w: 40, h: 30 })) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/ops.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, applyPhotoEdits: vi.fn(actual.applyPhotoEdits) };
});
import { ensurePhotoDecoded, getProcessedPhotoImage, peekProcessedPhotoImage, _resetPhotoStateForTests } from '../bspline-frame-builder/b-spline-gen/html/core/photo/state.js';
import { applyPhotoEdits } from '../bspline-frame-builder/b-spline-gen/html/core/photo/ops.js';

const URL = 'data:x';
beforeAll(async () => { _resetPhotoStateForTests(); await ensurePhotoDecoded(URL); });

describe('peekProcessedPhotoImage never runs the edit pipeline', () => {
  it('ready -> the processed image; edits changed since -> null, with no processing; processed again -> served', () => {
    const a = { photoImageDataUrl: URL, photoEdits: [] };
    const img = getProcessedPhotoImage(a);
    expect(peekProcessedPhotoImage(a)).toBe(img);
    expect(peekProcessedPhotoImage({ ...a, photoEdits: [] })).toBe(img); // an equal list (a new array): the same key
    applyPhotoEdits.mockClear();
    const b = { photoImageDataUrl: URL, photoEdits: [{ op: 'blur', params: { radius: 3 } }] };
    expect(peekProcessedPhotoImage(b)).toBe(null);
    expect(applyPhotoEdits).not.toHaveBeenCalled();
    const imgB = getProcessedPhotoImage(b); // what the backdrop repaint does, behind its card
    expect(applyPhotoEdits).toHaveBeenCalledTimes(1);
    expect(peekProcessedPhotoImage(b)).toBe(imgB);
    expect(peekProcessedPhotoImage({ photoImageDataUrl: 'data:other', photoEdits: [] })).toBe(null);
  });
});

describe('the wiring (source): the edit path peeks, the repaint redraws', () => {
  const H = 'bspline-frame-builder/b-spline-gen/html/';
  it("photo-panel's notifyChange asks the footprint not to process; the footprint redraws on 'editorTopViewUpdated'", () => {
    const panel = readFileSync(H + 'main/photo-panel.js', 'utf8');
    const notify = panel.slice(panel.indexOf('function notifyChange('), panel.indexOf('function notifyChange(') + 400);
    expect(notify).toContain('syncPhotoFootprint({ process: false })');
    expect(readFileSync(H + 'main/photo-footprint.js', 'utf8')).toMatch(/'editorTopViewUpdated'\]\) document\.addEventListener/);
    const tv = readFileSync(H + 'core/render-topview.js', 'utf8');
    const run = tv.slice(tv.indexOf('export function refreshEditorTopView'), tv.indexOf('export function refreshEditorTopView') + 900);
    expect(run.indexOf("new CustomEvent('editorTopViewUpdated')")).toBeGreaterThan(run.indexOf('updateEditorTopView(..._lastTopView)'));
  });
});
