/**
 * Item 74f (advisor; seat D's Photo audit, measured: crop / levels / brightness / blur / relief changed the 3D but the
 * editor's Undo did not take them back -- only the Photo panel's own Undo button did): the photo rides in every editor undo
 * entry (main/photo-panel.js part 'photo') and each photo gesture is ONE editor step. Behaviour on the real Photo panel
 * markup with an editor stub that keeps the real undo-entry shape (parts).
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

import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initPhotoPanel } from '../bspline-frame-builder/b-spline-gen/html/main/photo-panel.js';
import { takeUndoParts, restoreUndoParts } from '../bspline-frame-builder/b-spline-gen/html/editor/undo-parts.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const PANEL = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html').getElementById('editorPhotoPanel').outerHTML;
const SMALL = 'data:image/png;base64,SMALL';

let ed, onChange;
const undo = () => { ed._redoStack.push(ed._undoStack.pop()); restoreUndoParts(ed._undoStack[ed._undoStack.length - 1].parts); };
beforeEach(() => {
  localStorage.clear();
  Object.assign(P, DEFAULT, { photoImageDataUrl: SMALL, photoEdits: [], photoPatternId: null, carveZ: 0.125 });
  document.body.innerHTML = PANEL + '<div id="editorToolbarPhoto"></div>';
  ed = { _undoStack: [], _redoStack: [], _notifyChange: () => {} };
  ed._snapshotState = () => ({ svg: '', parts: takeUndoParts() });
  ed.pushState = () => { ed._undoStack.push(ed._snapshotState()); };
  window.svgEditor = ed;
  onChange = vi.fn();
  initPhotoPanel({ onChange });
  ed.pushState(); // the opening entry
});

describe('item 74f: a photo edit is ONE editor undo step', () => {
  it('Rotate: one step; Undo takes the edit back', () => {
    document.getElementById('photoBtnRotate').click();
    expect(ed._undoStack.length).toBe(2);
    expect(P.photoEdits.map((s) => s.op)).toEqual(['rotate90']);
    undo();
    expect(P.photoEdits).toEqual([]);
  });

  it('a brightness drag: no step per tick, ONE on release; Undo -> the slider and the edit back', () => {
    const slider = document.getElementById('photoBrightnessSlider');
    for (const v of ['0.1', '0.2', '0.3']) { slider.value = v; slider.dispatchEvent(new Event('input')); }
    expect(ed._undoStack.length).toBe(1);
    slider.dispatchEvent(new Event('change'));
    expect(ed._undoStack.length).toBe(2);
    undo();
    expect(P.photoEdits).toEqual([]);
    expect(Number(document.getElementById('photoBrightness').value)).toBe(0);
  });

  it('relief Carved: one step; Undo -> Raised again', () => {
    document.getElementById('photoBtnReliefCarved').click();
    expect(ed._undoStack.length).toBe(2);
    undo();
    expect(P.photoEdits.some((s) => s.op === 'invert')).toBe(false);
    expect(document.getElementById('photoBtnReliefRaised').classList.contains('active')).toBe(true);
  });

  it("the panel's own Undo button still pops the last edit, and is a step of its own", () => {
    document.getElementById('photoBtnRotate').click();
    document.getElementById('photoBtnUndo').click();
    expect(P.photoEdits).toEqual([]);
    expect(ed._undoStack.length).toBe(3);
  });

  it('an Undo of something else leaves the photo alone (no restore, no rebuild)', () => {
    document.getElementById('photoBtnRotate').click();
    ed.pushState(); // an unrelated canvas step, the photo unchanged
    onChange.mockClear();
    undo();
    expect(P.photoEdits.map((s) => s.op)).toEqual(['rotate90']);
    expect(onChange).not.toHaveBeenCalled();
  });
});
