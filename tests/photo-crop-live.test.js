/**
 * Live, non-destructive crop (Fred 2026-10-10: "crop doesn't preview, why an Apply crop?" + "keep the original so we can
 * uncrop"). main/photo-panel.js: ONE crop op upserted at its declared place (straighten -> crop -> the rest), never
 * appended (each Apply used to add one, so crops compounded); the fields preview on input, a change is ONE editor undo
 * step; Reset crop = the whole photo, its own step; the stored photo is always the original. A saved list of appended
 * crops is never rewritten on load.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/patterns.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadPhotoPatterns: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/state.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ensurePhotoDecoded: vi.fn(() => Promise.resolve(null)) };
});

import { P, DEFAULT, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initPhotoPanel, editableCrop, withCrop, CROP_FULL, CROP_BOX, cropHit, cropDrag } from '../bspline-frame-builder/b-spline-gen/html/main/photo-panel.js';
import { takeUndoParts, restoreUndoParts } from '../bspline-frame-builder/b-spline-gen/html/editor/undo-parts.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const PANEL = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html').getElementById('editorPhotoPanel').outerHTML;
const ORIGINAL = 'data:image/png;base64,ORIGINAL';

let ed;
const undo = () => { ed._redoStack.push(ed._undoStack.pop()); restoreUndoParts(ed._undoStack[ed._undoStack.length - 1].parts); };
const field = (id) => document.getElementById(id);
const type = (id, v) => { field(id).value = String(v); field(id).dispatchEvent(new Event('input')); };
const commit = (id) => field(id).dispatchEvent(new Event('change'));
const crops = () => P.photoEdits.filter((s) => s.op === 'crop');
function boot(edits = []) {
  Object.assign(P, DEFAULT, { photoImageDataUrl: ORIGINAL, photoEdits: edits, photoPatternId: null, carveZ: 0.125 });
  document.body.innerHTML = PANEL + '<div id="editorToolbarPhoto"></div>';
  ed = { _undoStack: [], _redoStack: [], _notifyChange: () => {} };
  ed._snapshotState = () => ({ svg: '', parts: takeUndoParts() });
  ed.pushState = () => { ed._undoStack.push(ed._snapshotState()); };
  window.svgEditor = ed;
  initPhotoPanel({ onChange: vi.fn() });
  ed.pushState(); // the opening entry
}
beforeEach(() => { localStorage.clear(); boot(); });

describe('withCrop / editableCrop: one crop op at its declared place', () => {
  it('an edit REPLACES the crop (never compounds); it sits right after straighten, before the rest', () => {
    let s = [{ op: 'straighten', params: { degrees: 3 } }, { op: 'rotate90', params: { dir: 1 } }];
    s = withCrop(s, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    s = withCrop(s, { x: 0.2, y: 0, w: 0.6, h: 1 });
    expect(s.map((x) => x.op)).toEqual(['straighten', 'crop', 'rotate90']);
    expect(editableCrop(s)).toEqual({ x: 0.2, y: 0, w: 0.6, h: 1 }); // the last edit, not the first one cropped again
    expect(withCrop([], { x: 0.1, y: 0, w: 0.5, h: 1 }).map((x) => x.op)).toEqual(['crop']); // no straighten: first
  });
  it('the full image = no crop op at all', () => {
    expect(withCrop([{ op: 'crop', params: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }], CROP_FULL)).toEqual([]);
  });
  it('a legacy list of appended crops reads composed exactly; after a rotate / flip, as the whole photo', () => {
    const legacy = [{ op: 'crop', params: { x: 0.5, y: 0, w: 0.5, h: 1 } }, { op: 'levels', params: {} }, { op: 'crop', params: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } }];
    expect(editableCrop(legacy)).toEqual({ x: 0.75, y: 0.5, w: 0.25, h: 0.5 });
    expect(editableCrop([{ op: 'rotate90', params: { dir: 1 } }, { op: 'crop', params: { x: 0.1, y: 0, w: 0.5, h: 1 } }])).toEqual(CROP_FULL);
  });
});

describe('the live crop fields: preview on input, ONE undo step per gesture', () => {
  it('typing previews (the state follows each input, no step); the change is one step; Undo takes it back', () => {
    type('photoCropW', 90); type('photoCropW', 80); type('photoCropW', 70);
    expect(crops()).toHaveLength(1);
    expect(crops()[0].params.w).toBeCloseTo(0.7, 9);
    expect(ed._undoStack.length).toBe(1); // no step while typing
    commit('photoCropW');
    expect(ed._undoStack.length).toBe(2);
    undo();
    expect(crops()).toHaveLength(0);
    expect(Number(field('photoCropW').value)).toBe(100); // the field follows the undo
  });
  it('two gestures = two steps, still ONE crop op (the second replaces the first)', () => {
    type('photoCropX', 10); commit('photoCropX');
    type('photoCropX', 20); commit('photoCropX');
    expect(ed._undoStack.length).toBe(3);
    expect(crops()).toEqual([{ op: 'crop', params: { x: 0.2, y: 0, w: 1, h: 1 } }]);
  });
  it('the Apply button is gone; Reset crop is the whole photo again, as its own step', () => {
    expect(field('photoBtnApplyCrop')).toBeNull();
    type('photoCropW', 50); commit('photoCropW');
    field('photoBtnResetCrop').click();
    expect(crops()).toHaveLength(0);
    expect(Number(field('photoCropW').value)).toBe(100);
    expect(ed._undoStack.length).toBe(3);
    undo();
    expect(crops()[0].params.w).toBeCloseTo(0.5, 9);
  });
});

describe('non-destructive: the original photo is kept; a save / reload can uncrop', () => {
  it('a crop never touches the stored photo; the saved project holds the ORIGINAL + the op; reloaded, it widens back', () => {
    type('photoCropX', 25); type('photoCropW', 50); commit('photoCropW');
    expect(P.photoImageDataUrl).toBe(ORIGINAL);
    const saved = JSON.parse(JSON.stringify(persistableP()));
    expect(saved.photoImageDataUrl).toBe(ORIGINAL);
    expect(saved.photoEdits).toEqual([{ op: 'crop', params: { x: 0.25, y: 0, w: 0.5, h: 1 } }]);
    boot(saved.photoEdits); // the reload: the panel reads the saved list
    expect(Number(field('photoCropX').value)).toBe(25);
    expect(Number(field('photoCropW').value)).toBe(50);
    field('photoBtnResetCrop').click();
    expect(P.photoEdits).toEqual([]);
    expect(P.photoImageDataUrl).toBe(ORIGINAL);
  });
  it('a legacy project (appended crops) loads UNCHANGED -- the list is rewritten only by an edit', () => {
    const legacy = [{ op: 'crop', params: { x: 0.5, y: 0, w: 0.5, h: 1 } }, { op: 'crop', params: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } }];
    boot(JSON.parse(JSON.stringify(legacy)));
    expect(P.photoEdits).toEqual(legacy);
    expect(Number(field('photoCropX').value)).toBe(75); // shown as the one composed crop
    type('photoCropW', 20); commit('photoCropW');
    expect(crops()).toHaveLength(1);
  });
});

describe('the crop BOX on the preview canvas (advisor + Fred, option 2): exact in photo fractions', () => {
  it('declared: finger-sized grabs on a coarse pointer (>= 28 px), a minimum crop side', () => {
    expect(CROP_BOX.handlePx).toEqual({ fine: 16, coarse: 28 });
    expect(CROP_BOX.minFrac).toBe(0.02);
  });
  it('cropHit: corners win within the grab size, the body moves, outside is nothing', () => {
    const r = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    expect(cropHit(r, 0.21, 0.19, 0.05, 0.05)).toBe('nw');
    expect(cropHit(r, 0.7, 0.7, 0.05, 0.05)).toBe('se');
    expect(cropHit(r, 0.45, 0.45, 0.05, 0.05)).toBe('move');
    expect(cropHit(r, 0.05, 0.9, 0.05, 0.05)).toBe(null);
  });
  it('cropDrag: a corner moves only its two edges; move keeps the size; all inside the photo, never under the minimum', () => {
    const r = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    const se = cropDrag(r, 'se', 0.1, -0.1);
    expect(se.x).toBe(0.2); expect(se.y).toBe(0.2); expect(se.w).toBeCloseTo(0.6, 9); expect(se.h).toBeCloseTo(0.4, 9);
    expect(cropDrag(r, 'move', 0.5, -0.5)).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 }); // clamped inside
    const nw = cropDrag(r, 'nw', 0.9, 0.9); // past the opposite corner
    expect(nw.w).toBeCloseTo(0.02, 9); expect(nw.h).toBeCloseTo(0.02, 9);
  });

  const canvasAt = () => {
    const c = field('photoPreviewCanvas');
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 });
    return c;
  };
  const pointer = (c, type, x, y) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));

  it('a corner drag: the box and the fields follow each tick (no step); the release is ONE step', () => {
    const c = canvasAt();
    pointer(c, 'pointerdown', 199, 99); // the bottom-right corner of the full photo
    pointer(c, 'pointermove', 150, 80);
    pointer(c, 'pointermove', 100, 50);
    expect(ed._undoStack.length).toBe(1); // ticks: no step
    expect(Number(field('photoCropW').value)).toBeCloseTo(50.5, 0);
    expect(Number(field('photoCropH').value)).toBeCloseTo(51, 0);
    pointer(c, 'pointerup', 100, 50);
    expect(ed._undoStack.length).toBe(2);
    expect(crops()).toHaveLength(1);
    undo();
    expect(crops()).toHaveLength(0);
  });
  it('fields -> box: a typed crop is where the box starts; moving the body keeps that size', () => {
    type('photoCropW', 50); type('photoCropH', 50); commit('photoCropH');
    const c = canvasAt();
    pointer(c, 'pointerdown', 50, 25); // inside the 0..100 x 0..50 px box
    pointer(c, 'pointermove', 100, 50);
    pointer(c, 'pointerup', 100, 50);
    expect(crops()[0].params).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(Number(field('photoCropX').value)).toBe(25);
  });
  it('outside the Crop tab the canvas is no box: a drag on it does nothing', async () => {
    const { setPhotoTab } = await import('../bspline-frame-builder/b-spline-gen/html/main/photo-panel.js');
    setPhotoTab('adjust');
    const c = canvasAt();
    pointer(c, 'pointerdown', 199, 99); pointer(c, 'pointermove', 100, 50); pointer(c, 'pointerup', 100, 50);
    expect(crops()).toHaveLength(0);
    expect(ed._undoStack.length).toBe(1);
    setPhotoTab('source');
  });
});
