/**
 * F15: formula fields for the remaining numeric fields, each through its REAL write path:
 *  - the stamp layer transform (tx/ty/rotation/scale): initTransform -> bindLayerOnlyNumber (layer fields, not P),
 *    scope = the stock names + the ACTIVE layer's own transform values;
 *  - Frame bottom (z) + the Frame tab's thickness: initFramePanel's change handlers (frame record), FRAME scope;
 *  - sculpt Strength / Hardness: the declared INPUT_PAIRS alias to P.sculpt{Top,Bot}Strength (bind()->applyParam,
 *    dead since the CAD restyle renamed the ids); the live write is checked in Chrome (formula_f15_shots.mjs).
 * Per field: a formula evaluates, a result is clamped to the declared range, a bad formula keeps the old value,
 * and the autocomplete lists the declared names.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P, INPUT_PAIRS, SLIDER_PAIRS } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { syncUItoParam } from '../bspline-frame-builder/b-spline-gen/html/core/ui-utils.js';
import { createDomBinders } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/_dom-binders.js';
import { initTransform } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/transform.js';
import {
  FORMULA_FIELDS, STAMP_TRANSFORM_FIELDS, attachFormulaFields,
} from '../bspline-frame-builder/b-spline-gen/html/main/formula-fields.js';
import { isFormulaField, popupLeft } from '../bspline-frame-builder/b-spline-gen/html/core/formula-field.js';
import { initFramePanel, setEditorTab, syncFramePanel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { getFrameRecord, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';

/** Type `text` into the field the way a user does (input events), then commit with Enter. */
function typeAndCommit(el, text) {
  el.focus();
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
/** The autocomplete names offered while typing `prefix`. */
function offered(el, prefix) {
  el.focus();
  el.value = prefix;
  try { el.setSelectionRange(prefix.length, prefix.length); } catch { /* happy-dom */ }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const names = [...document.querySelectorAll('.formula-dropdown li')].map((li) => li.dataset.name);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return names;
}

describe('F15 stamp layer transform: formulas through bindLayerOnlyNumber, over the active layer', () => {
  let root, layers, active;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = STAMP_TRANSFORM_FIELDS.map((f) => {
      const range = f.id === 'stampRotation' ? 'min="-180" max="180"' : f.id === 'stampScale' ? 'min="0.1"' : '';
      return `<input type="range" id="${f.id}Slider"><input type="number" id="${f.id}" value="0" ${range}>`;
    }).join('') + '<input type="checkbox" id="stampMirrorX"><input type="checkbox" id="stampMirrorY">';
    document.body.appendChild(root);
    P.widthIn = 7; P.heightIn = 9; P.carveZ = 0.5;
    layers = [{ tx: 1, ty: 0, rotation: 0, scale: 1 }, { tx: -2, ty: 0.5, rotation: 30, scale: 2 }];
    active = 0;
    const activeLayer = () => layers[active];
    const binders = createDomBinders({ activeLayer, requestRemask: () => {} });
    initTransform({ ...binders, activeLayer, registerSyncs: (_name, ...fns) => fns });
  });
  afterEach(() => { root.remove(); document.querySelectorAll('.formula-dropdown,.formula-preview').forEach((n) => n.remove()); });
  const $ = (id) => document.getElementById(id);

  it('every transform field is attached, through the one binder', () => {
    for (const f of STAMP_TRANSFORM_FIELDS) expect(isFormulaField($(f.id)), f.id).toBe(true);
    expect(STAMP_TRANSFORM_FIELDS.map((f) => f.field)).toEqual(['tx', 'ty', 'rotation', 'scale']);
  });

  it('a formula evaluates into the ACTIVE layer (stock names and the layer\'s own values)', () => {
    typeAndCommit($('stampTx'), 'width/2 - x');       // 3.5 - layer 0's own tx (1)
    expect(layers[0].tx).toBeCloseTo(2.5, 12);
    expect($('stampTxSlider').value).toBe('2.5');       // the slider follows, as for a typed number
    active = 1;                                        // the scope reads the NEW active layer live
    typeAndCommit($('stampRotation'), 'rotation * 2');
    expect(layers[1].rotation).toBe(60);
    expect(layers[0].rotation).toBe(0);
    typeAndCommit($('stampTy'), 'height / 18 + y');
    expect(layers[1].ty).toBeCloseTo(1, 12);
  });

  it('a formula result is clamped to the field range', () => {
    typeAndCommit($('stampRotation'), '90 * 3');
    expect(layers[0].rotation).toBe(180);
    typeAndCommit($('stampScale'), 'scale / 100');
    expect(layers[0].scale).toBe(0.1);
  });

  it('a bad formula keeps the old value', () => {
    typeAndCommit($('stampTx'), 'x + * 2');
    expect(layers[0].tx).toBe(1);
    typeAndCommit($('stampScale'), 'nope * 2');
    expect(layers[0].scale).toBe(1);
  });

  it('the autocomplete lists the declared names', () => {
    expect(offered($('stampTx'), 'ro')).toEqual(['rotation']);
    expect(offered($('stampScale'), 's')).toEqual(['scale']);
    expect(offered($('stampTy'), 'w')).toEqual(['width']);
  });
});

describe('F15 Frame bottom + thickness: formulas through the frame panel', () => {
  let root;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `<input id="widthIn" value="7"><input id="heightIn" value="9">
      <select id="frameTemplate"></select><div id="frameSettings"><select id="frameAppearance"></select>
        <input type="number" id="frameBottomZ" value="-1" step="0.125">
        <input type="number" id="frameTrimOffset" step="0.0625"></div>
      <button id="btnStampEdit"></button><div id="editorFrameShield"></div>
      <aside id="editorFramePanel"><select id="editorFrameTemplate"></select>
        <div id="editorFrameThicknessRow"><input type="number" id="editorFrameThickness" step="0.0625"></div>
        <button id="editorFrameGenerate"></button><button id="editorFrameUndo" disabled></button></aside>
      <aside id="editorLayersPanel"></aside><div id="fusion-status"></div>`;
    document.body.appendChild(root);
    P.frame = null; P.widthIn = 7; P.heightIn = 9; P.carveZ = 0.5;
    window.svgEditor = null;
    initFramePanel();
    setFrameRecord({ templateId: 'template_1' });
    syncFramePanel(); // what a template change does: the template's min/max land on the fields
    attachFormulaFields(document);
  });
  afterEach(() => {
    setEditorTab('artwork'); root.remove(); P.frame = null;
    document.querySelectorAll('.formula-dropdown,.formula-preview').forEach((n) => n.remove());
  });
  const $ = (id) => document.getElementById(id);

  it('both fields are attached with the FRAME scope', () => {
    for (const id of ['frameBottomZ', 'editorFrameThickness']) {
      expect(isFormulaField($(id)), id).toBe(true);
      expect(FORMULA_FIELDS.find((f) => f.id === id).section).toBe('FRAME');
    }
  });

  it('a formula evaluates into the frame record', () => {
    typeAndCommit($('frameBottomZ'), '-height / 9 - trim');   // -1 - 0.25
    expect(getFrameRecord().frameBottomZ).toBeCloseTo(-1.25, 12);
    typeAndCommit($('editorFrameThickness'), 'width / 10');
    expect(getFrameRecord().params.frame_thickness).toBeCloseTo(0.7, 12);
    typeAndCommit($('frameBottomZ'), 'bottom - thickness');   // the frame's own current values
    expect(getFrameRecord().frameBottomZ).toBeCloseTo(-1.95, 12);
  });

  it('the thickness result is clamped to the template range (0.25 .. 1.5)', () => {
    typeAndCommit($('editorFrameThickness'), 'width');
    expect(getFrameRecord().params.frame_thickness).toBe(1.5);
    typeAndCommit($('editorFrameThickness'), 'width / 100');
    expect(getFrameRecord().params.frame_thickness).toBe(0.25);
  });

  it('a bad formula keeps the old value', () => {
    typeAndCommit($('frameBottomZ'), 'height +');
    expect(getFrameRecord().frameBottomZ).toBe(-1);
    typeAndCommit($('editorFrameThickness'), 'thick * 2');
    expect(getFrameRecord().params.frame_thickness).toBeUndefined();
  });

  it('the autocomplete lists the declared names', () => {
    expect(offered($('frameBottomZ'), 'th')).toEqual(['thickness']);
    expect(offered($('editorFrameThickness'), 'b')).toEqual(['bottom']);
    expect(offered($('frameBottomZ'), 't')).toEqual(['trim', 'thickness']);
  });
});

describe('F15 sculpt Strength / Hardness: bound to P through the declared alias', () => {
  it('the inputs are the P keys\' fields (bind() and syncUItoParam both read INPUT_PAIRS)', () => {
    expect(INPUT_PAIRS.sculptTopStrength).toBe('sculptTopHardness');
    expect(INPUT_PAIRS.sculptBotStrength).toBe('sculptBotHardness');
    expect(SLIDER_PAIRS.sculptTopStrength).toBe('sculptTopHardnessSlider');
    expect(SLIDER_PAIRS.sculptBotStrength).toBe('sculptBotHardnessSlider');
    const root = document.createElement('div');
    root.innerHTML = '<input type="range" id="sculptTopHardnessSlider"><input type="number" id="sculptTopHardness">';
    document.body.appendChild(root);
    syncUItoParam('sculptTopStrength', 0.05);   // P -> the field (undo / load)
    expect(document.getElementById('sculptTopHardness').value).toBe('0.05');
    expect(document.getElementById('sculptTopHardnessSlider').value).toBe('0.05');
    root.remove();
  });

  it('declared in the SCULPT sections with a "strength" name reading P', () => {
    for (const [id, key, section] of [['sculptTopHardness', 'sculptTopStrength', 'SCULPT TOP'],
      ['sculptBotHardness', 'sculptBotStrength', 'SCULPT BOTTOM']]) {
      const f = FORMULA_FIELDS.find((q) => q.id === id);
      expect(f.section).toBe(section);
      const d = f.scope.find((n) => n.name === 'strength');
      P[key] = 0.042;
      expect(d.get()).toBe(0.042);
    }
  });
});

describe('F15: the formula popups stay on screen', () => {
  it('a popup under a field near the right edge is pulled back inside the viewport', () => {
    expect(popupLeft(100, 150, 390)).toBe(100);          // room: under the field
    expect(popupLeft(330, 150, 390)).toBe(236);          // the phone case: 390 - 150 - 4
    expect(popupLeft(-20, 150, 390)).toBe(4);            // never off the left edge either
    expect(popupLeft(10, 500, 390)).toBe(4);             // wider than the screen: pinned left
  });
});

describe('F15: the Strength / Hardness markup declares the brush\'s real range', () => {
  it('number + slider share 0.001 .. 0.1 (dZ = -screenDY * strength, in/px), holding the P defaults', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const html = readFileSync(resolve(__dirname, '../bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html'), 'utf8');
    const doc = new DOMParser().parseFromString(html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, ''), 'text/html');
    for (const [id, dflt] of [['sculptTopHardness', 0.03], ['sculptBotHardness', 0.008]]) {
      for (const el of [doc.getElementById(id), doc.getElementById(`${id}Slider`)]) {
        expect([el.getAttribute('min'), el.getAttribute('max'), el.getAttribute('step')], el.id).toEqual(['0.001', '0.1', '0.001']);
        expect(Number(el.getAttribute('value')), el.id).toBe(dflt);
      }
    }
  });
});
