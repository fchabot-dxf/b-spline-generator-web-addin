/**
 * 2026-10-10 (Fred: the photo as its own LAYER): Surface > Photo, rendered from main/photo-layer-section.js
 * PHOTO_CONTROLS -- the declaration against the real markup, Fred's picks, and the MIRRORED image edits: the same state
 * and the same undo steps as the editor's Photo tab, both views following each other.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/patterns.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadPhotoPatterns: vi.fn(() => Promise.resolve([{ id: 'p1', name: 'P1', image: 'data:image/png;base64,P1', settings: {} }])) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/state.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ensurePhotoDecoded: vi.fn(() => Promise.resolve(null)) };
});

import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initPhotoPanel } from '../bspline-frame-builder/b-spline-gen/html/main/photo-panel.js';
import { PHOTO_CONTROLS, PHOTO_GROUPS, renderPhotoLayerSection, bindPhotoLayerSection } from '../bspline-frame-builder/b-spline-gen/html/main/photo-layer-section.js';
import { takeUndoParts, restoreUndoParts } from '../bspline-frame-builder/b-spline-gen/html/editor/undo-parts.js';
import { NoiseTweaks } from '../bspline-frame-builder/b-spline-gen/html/core/noise/index.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const doc = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html');
const PANEL = doc.getElementById('editorPhotoPanel').outerHTML;

describe('PHOTO_CONTROLS against the real markup', () => {
  it('every Photo-tab control it names exists there; the section\'s own ids are not in the static markup (no twins)', () => {
    for (const c of PHOTO_CONTROLS) {
      expect(['2d', '3d', 'both'].includes(c.home), c.id).toBe(true);
      for (const id of c.ids2d || []) expect(doc.getElementById(id), `${c.id}: ${id}`).not.toBeNull();
      if (c.home !== '2d') expect(c.kind, c.id).toBeTruthy();
      if (c.home === 'both') expect((c.ids2d || []).length && (c.ids3d || []).length, c.id).toBeTruthy();
    }
    const own = PHOTO_CONTROLS.filter((c) => c.home !== '2d').flatMap((c) => c.ids3d || []);
    for (const id of own) expect(doc.getElementById(id), id).toBeNull();
    expect(doc.querySelector('.cad-sidebar .panel-photo #photoLayerBody')).not.toBeNull();
    for (const c of PHOTO_CONTROLS.filter((x) => x.group)) expect(PHOTO_GROUPS.some((g) => g.id === c.group), c.id).toBe(true);
  });
  it('Fred\'s picks (2026-10-10): mirrored = relief, flip, blur, brightness, contrast; crop / levels / straighten / Rotate 90 stay in the tab; ONE rotation here', () => {
    const home = (h) => PHOTO_CONTROLS.filter((c) => c.home === h).map((c) => c.id).sort();
    expect(home('both')).toEqual(['blur', 'brightness', 'contrast', 'flip', 'relief']);
    for (const id of ['crop', 'levels', 'straighten', 'rotate90']) expect(home('2d'), id).toContain(id);
    const rotation = PHOTO_CONTROLS.find((c) => c.id === 'rotation');
    expect([rotation.home, rotation.steps]).toEqual(['3d', [-90, 90]]);
    // every effect param of the photo is in the section, once
    expect(PHOTO_CONTROLS.filter((c) => c.tweak).map((c) => c.tweak).sort()).toEqual(NoiseTweaks.photo.map((t) => t.key).sort());
  });
  it('rendered into the real page: every control once, every id unique', () => {
    document.body.innerHTML = BODY;
    renderPhotoLayerSection(document.getElementById('photoLayerBody'));
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dup).toEqual([]);
    for (const c of PHOTO_CONTROLS.filter((x) => x.home !== '2d')) for (const id of c.ids3d || []) expect(document.getElementById(id), id).not.toBeNull();
    for (const id of ['photoLayer', 'photoFilterAmount', 'photoFilterAmountSlider', 'photoLayerTweak_repeat']) expect(document.getElementById(id), id).not.toBeNull();
    const rows = [...document.querySelectorAll('#photoLayerBody .tweak-row')].map((r) => r.dataset.tweakKey);
    expect(rows).toEqual(['depth', 'scale', 'offsetX', 'offsetY', 'rotation']);
  });
});

describe('the mirrored image edits: one state, one undo step, both views follow', () => {
  let ed;
  beforeEach(() => {
    localStorage.clear();
    Object.assign(P, DEFAULT, { photoImageDataUrl: 'data:image/png;base64,X', photoEdits: [], photoPatternId: null, carveZ: 0.125, filterTweaks: {}, photoLayer: true });
    document.body.innerHTML = PANEL + '<div id="editorToolbarPhoto"></div><div id="photoLayerBody"></div>';
    renderPhotoLayerSection(document.getElementById('photoLayerBody'));
    ed = { _undoStack: [], _redoStack: [], _notifyChange: () => {} };
    ed._snapshotState = () => ({ svg: '', parts: takeUndoParts() });
    ed.pushState = () => { ed._undoStack.push(ed._snapshotState()); };
    window.svgEditor = ed;
    initPhotoPanel({ onChange: () => {} });
    bindPhotoLayerSection();
    ed.pushState();
  });
  const $ = (id) => document.getElementById(id);
  const drag = (id, v) => { const s = $(id); s.value = String(v); s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); };

  it('Blur here: the edit list, the Photo tab\'s Blur shows it, ONE step', () => {
    drag('photo3dBlurSlider', 3);
    expect(P.photoEdits).toEqual([{ op: 'blur', params: { radius: 3 } }]);
    expect(Number($('photoBlur').value)).toBe(3);
    expect(ed._undoStack.length).toBe(2);
  });
  it('Brightness in the Photo tab: the section follows', () => {
    drag('photoBrightnessSlider', 0.25);
    expect(Number($('photo3dBrightness').value)).toBe(0.25);
    expect($('photo3dBrightnessSlider').max).toBe($('photoBrightnessSlider').max); // one declared range: the tab's
    expect(Number($('photo3dContrast').value)).toBe(0);
  });
  it('Carved here = the tab\'s Carved (the invert edit); Raised takes it back; a step each', () => {
    $('photo3dReliefCarved').click();
    expect(P.photoEdits.some((s) => s.op === 'invert')).toBe(true);
    expect($('photoBtnReliefCarved').classList.contains('active')).toBe(true);
    expect($('photo3dReliefCarved').classList.contains('active')).toBe(true);
    $('photo3dReliefRaised').click();
    expect(P.photoEdits.some((s) => s.op === 'invert')).toBe(false);
    expect(ed._undoStack.length).toBe(3);
  });
  it('Flip H here appends the same flip step as the tab\'s button', () => {
    $('photo3dFlipH').click();
    expect(P.photoEdits).toEqual([{ op: 'flip', params: { axis: 'h' } }]);
    expect(ed._undoStack.length).toBe(2);
  });
  it('Rotation steps -90 / +90 turn the photo ON THE BOARD (its rotation param), held to -180..180', () => {
    const plus = document.querySelector('[data-photo-step="rotation:90"]');
    plus.click(); expect(P.filterTweaks.photo.rotation).toBe(90);
    plus.click(); expect(P.filterTweaks.photo.rotation).toBe(-180);
    plus.click(); expect(P.filterTweaks.photo.rotation).toBe(-90);
    expect(P.photoEdits).toEqual([]); // not the image edit (Rotate 90 stays in the Photo tab)
  });
  it('Repeat is a checkbox over the photo\'s repeat param (0 / 1)', () => {
    const box = $('photoLayerTweak_repeat');
    box.checked = true; box.dispatchEvent(new Event('change'));
    expect(P.filterTweaks.photo.repeat).toBe(1);
  });
  it('a pattern pick turns the photo LAYER on, and the editor\'s Undo of that pick turns it back off', async () => {
    P.photoLayer = false; ed._undoStack.length = 0; ed.pushState();
    await new Promise((r) => setTimeout(r, 0)); // the pattern row renders once the (mocked) list resolves
    document.querySelector('#photoPatternRow button').click();
    expect(P.photoLayer).toBe(true);
    expect(ed._undoStack.length).toBe(2);
    ed._redoStack.push(ed._undoStack.pop()); restoreUndoParts(ed._undoStack[ed._undoStack.length - 1].parts);
    expect(P.photoLayer).toBe(false);
  });
  it('no Max Height in either photo panel (Fred, 2026-10-10: it is the board\'s Z, edited in Board only)', () => {
    expect(PHOTO_CONTROLS.some((c) => /height/i.test(c.id + ' ' + (c.label || '')))).toBe(false);
    expect(document.getElementById('photoReliefHeightSlider')).toBeNull();
    expect(document.getElementById('photoReliefHeight')).toBeNull();
  });
  it('a pattern pick sets the board Z from the pattern, UNCLAMPED; its Undo puts the old Z back exactly', async () => {
    P.carveZ = 1.5; P.photoLayer = false; ed._undoStack.length = 0; ed.pushState();
    await new Promise((r) => setTimeout(r, 0));
    document.querySelector('#photoPatternRow button').click();
    expect(P.carveZ).toBe(0.125); // the mocked pattern has no relief: the declared default
    ed._redoStack.push(ed._undoStack.pop()); restoreUndoParts(ed._undoStack[ed._undoStack.length - 1].parts);
    expect(P.carveZ).toBe(1.5);
  });
  it('the layer OFF greys every photo-only control (the switch and Edit image stay live) and says why; ON ungreys', async () => {
    const box = $('photoLayer');
    P.photoLayer = false; box.checked = false; box.dispatchEvent(new Event('change'));
    await new Promise((r) => queueMicrotask(r));
    for (const id of ['photoFilterAmount', 'photoFilterAmountSlider', 'photo3dReliefCarved', 'photo3dFlipH', 'photo3dBlurSlider', 'photoLayerTweak_repeat']) expect($(id).disabled, id).toBe(true);
    expect([...document.querySelectorAll('#photoLayerBody .tweak-row input')].every((e) => e.disabled)).toBe(true);
    expect($('photoLayer').disabled).toBe(false);
    expect($('photoLayerEditImage').disabled).toBe(false);
    expect($('photoLayerOffNote').hidden).toBe(false);
    P.photoLayer = true; box.checked = true; box.dispatchEvent(new Event('change'));
    await new Promise((r) => queueMicrotask(r));
    expect($('photoFilterAmount').disabled).toBe(false);
    expect([...document.querySelectorAll('#photoLayerBody .tweak-row input')].some((e) => e.disabled)).toBe(false);
    expect($('photoLayerOffNote').hidden).toBe(true);
  });
});
