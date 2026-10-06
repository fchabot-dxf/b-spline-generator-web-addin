/**
 * Item 69 (seat E, measured live): a stamp setting changed from the sidebar (blur, V-bit angle, smoothing, fillet,
 * transform) wrote the live editor layer but never reached the saved drawing's layer roster (P.editorSvg
 * data-editor-layers), so a reload restored the old values -- and the mask reads the layer, so a board with stamp art
 * carved a different 3D (blur 4 -> 0, V-bit 120 -> 90; 3D hash changed). The write now goes through the editor's own
 * change pipeline ('tooling': serialize + persist). Live: change -> reload -> same values, same 3D hash.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P, updateP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { CHANGE_PIPELINE, CHANGE_PIPELINE_IN_EDITOR, runChangePipeline } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { createDomBinders } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/_dom-binders.js';

describe('item 69: a sidebar layer-tooling change is persisted through the editor change pipeline', () => {
  let layer;
  beforeEach(() => {
    layer = { id: '0', blur: 0, tx: 0 };
    window.svgEditor = { _layers: [layer], _notifyChange: vi.fn() };
    P.activeLayerIdx = 0;
  });
  afterEach(() => { window.svgEditor = undefined; });

  it("'tooling' is a declared kind in both tables: serialize + persist, no remask (the sidebar remasks itself)", () => {
    expect(CHANGE_PIPELINE.tooling).toEqual(['serialize', 'persist']);
    expect(CHANGE_PIPELINE_IN_EDITOR.tooling).toEqual(['serialize', 'persist']);
  });

  it("the 'tooling' run serializes then persists, and never remasks", async () => {
    const calls = [];
    await runChangePipeline('tooling', {
      serialize: async () => { calls.push('serialize'); return '<svg/>'; },
      persist: () => calls.push('persist'),
      remask: async () => calls.push('remask'),
    });
    expect(calls).toEqual(['serialize', 'persist']);
  });

  it('a P-mirrored tooling key (stampBlur) writes the active layer and asks the editor for a tooling change', () => {
    updateP('stampBlur', 4);
    expect(layer.blur).toBe(4);
    expect(window.svgEditor._notifyChange).toHaveBeenCalledWith('tooling');
  });

  it('a layer-only field (the transform Tx) does the same', () => {
    document.body.innerHTML = '<input id="tTx" type="number" value="0"><input id="tTxSlider" type="range" value="0">';
    const B = createDomBinders({ activeLayer: () => null, activeEditorLayer: () => layer, requestRemask: () => {} });
    B.bindLayerOnlyNumber('tTx', 'tTxSlider', 'tx');
    const num = document.getElementById('tTx');
    num.value = '0.4'; num.dispatchEvent(new Event('input'));
    expect(layer.tx).toBe(0.4);
    expect(window.svgEditor._notifyChange).toHaveBeenCalledWith('tooling');
  });
});
