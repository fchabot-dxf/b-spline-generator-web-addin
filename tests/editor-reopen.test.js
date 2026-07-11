/**
 * RO1 — editor reopen-persistence regression.
 *
 * Bug: draw -> Apply -> close -> reopen showed a BLANK editor. Root cause:
 * the reopen path (svg-source.js "Edit" button) called
 *   svgEditor.open(ctx.activeLayer().svg, ...)
 * but in the unified model ctx.activeLayer() returns an EDITOR layer
 * (id/name/tooling — NO `.svg`), so open() received `undefined` and took its
 * empty-editor branch. Fix: reopen restores the unified source of truth via
 * editorRestoreSvg() (P.editorSvg, with a legacy stamp-svg fallback).
 *
 * This drives the REAL initSvgSource reopen handler and the REAL
 * ctx.activeLayer() (createStampCtx) with a mocked window.svgEditor, so a
 * revert to open(currentLayer.svg) fails here. No svg.js/browser needed —
 * the full modal lifecycle was also proven end-to-end in headless Chromium
 * during diagnosis. Run: `npm test`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { editorRestoreSvg } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { createStampCtx } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/_shared.js';
import { initSvgSource } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/svg-source.js';

// A saved editor document, as draw+Apply persists to P.editorSvg.
const SAVED =
  '<svg xmlns="http://www.w3.org/2000/svg" width="672" height="864" viewBox="0 0 7 9" ' +
  'data-editor-layers="[{&quot;id&quot;:&quot;1&quot;}]">' +
  '<path fill="#000000" data-layer="1" d="M1 1 L3 1 L3 3 L1 3 Z"/></svg>';

// The object ctx.activeLayer() returns in the unified model: an editor layer
// (identity + CNC tooling, produced by layers.js) — crucially NO `.svg`.
const editorLayer = (id = '1') => ({ id, name: 'Layer 1', visible: true, depth: 1, profile: 'vbit', angle: 60 });

let openCalls;
beforeEach(() => {
  document.body.innerHTML =
    '<div id="svgEditorModal" style="display:none"></div>' +
    '<button id="btnStampEdit"></button>' +
    '<span id="stampFileName"></span>';
  P.activeLayerIdx = 0;
  P.editorSvg = null;
  P.stampLayers = [{ id: 0, svg: null, mask: null, enabled: false }];
  openCalls = [];
  window.svgEditor = { _layers: [editorLayer('1')], _activeLayer: '1', open(svg) { openCalls.push(svg); } };
});

describe('RO1: editor reopen restores the drawing', () => {
  it('root cause — ctx.activeLayer() is an editor layer with no .svg', () => {
    const ctx = createStampCtx(null);
    const layer = ctx.activeLayer();
    expect(layer).toBeTruthy();
    expect('svg' in layer).toBe(false);   // reading .svg -> undefined
    expect(layer.svg).toBeUndefined();
  });

  it('reopen opens the persisted editor document, not undefined', () => {
    const ctx = createStampCtx(null);
    initSvgSource(ctx, null);

    // draw+Apply have persisted the drawing to the unified source of truth.
    P.editorSvg = SAVED;

    // Reopen via the real user path (the Edit button handler).
    document.getElementById('btnStampEdit').click();

    expect(openCalls.length).toBe(1);
    expect(openCalls[0]).toBe(SAVED);            // fixed: restores content
    expect(openCalls[0]).not.toBeUndefined();    // pre-fix passed undefined -> blank
  });

  it('editorRestoreSvg: P.editorSvg > legacy stamp svg > null', () => {
    P.editorSvg = SAVED;
    expect(editorRestoreSvg()).toBe(SAVED);

    P.editorSvg = null;
    P.stampLayers = [{ id: 0, svg: '<svg>legacy</svg>' }];
    expect(editorRestoreSvg()).toBe('<svg>legacy</svg>');

    P.stampLayers = [{ id: 0, svg: null }];
    expect(editorRestoreSvg()).toBeNull();
  });
});
