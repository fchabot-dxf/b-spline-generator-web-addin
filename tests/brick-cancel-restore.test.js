/**
 * Audit B1 (Fred's Brick tab): Cancel -> Discard put the bricks back but kept the discarded brick
 * SETTINGS (every Brick-tab change saves them at once, outside the editor's undo stack), so the panel
 * showed them over the restored bricks and the next Generate re-laid them. Opening the editor now
 * snapshots P.brickSettings next to P.editorSvg (svg-source.js), and Cancel restores it IN PLACE
 * (app-init.js restoreBrickSettings) -- other modules hold the same object (editor._brickSettings).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { SvgEditorSnapshot, restoreBrickSettings } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { initSvgSource } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/svg-source.js';
import { createStampCtx } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/_shared.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="svgEditorModal" style="display:none"></div><button id="btnStampEdit"></button><span id="stampFileName"></span>';
  P.activeLayerIdx = 0;
  P.editorSvg = null;
  P.stampLayers = [{ id: 0, enabled: false }];
  P.brickSettings.pattern = 'stretcher';
  P.brickSettings.seed = 1;
  window.svgEditor = { _layers: [{ id: '1', name: 'Layer 1', visible: true }], _activeLayer: '1', open() {} };
});

describe('opening the editor snapshots the brick settings', () => {
  it('a deep copy, so later Brick-tab edits do not change the snapshot', () => {
    initSvgSource(createStampCtx(null));
    document.getElementById('btnStampEdit').click();
    expect(SvgEditorSnapshot.brickSettings.pattern).toBe('stretcher');
    P.brickSettings.pattern = 'basketweave';
    P.brickSettings.grout.widthIn = 0.2;
    expect(SvgEditorSnapshot.brickSettings.pattern).toBe('stretcher');
    expect(SvgEditorSnapshot.brickSettings.grout.widthIn).not.toBe(0.2);
  });
});

describe('restoreBrickSettings (the Cancel/Discard path)', () => {
  it('puts the entry settings back in the SAME object and tells the panel', () => {
    const entry = JSON.parse(JSON.stringify(P.brickSettings));
    const same = P.brickSettings;
    P.brickSettings.pattern = 'basketweave';
    P.brickSettings.seed = 99;
    P.brickSettings.addedLater = true;
    let told = 0;
    document.addEventListener('brickSettingsRestored', () => { told++; }, { once: true });
    restoreBrickSettings(entry);
    expect(P.brickSettings).toBe(same);
    expect(P.brickSettings.pattern).toBe('stretcher');
    expect(P.brickSettings.seed).toBe(1);
    expect('addedLater' in P.brickSettings).toBe(false);
    expect(told).toBe(1);
  });
  it('no snapshot: leaves the settings alone', () => {
    P.brickSettings.pattern = 'flemish';
    restoreBrickSettings(null);
    expect(P.brickSettings.pattern).toBe('flemish');
  });
});
