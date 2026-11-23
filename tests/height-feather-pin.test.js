/**
 * HEIGHT-PAINTER slice 4: the PIN. The selection's Feather with its default profile ('smooth', or no profile chosen) is the
 * slice-2 feather byte for byte (a separable Gaussian, core/height/selection.js featherMask), and a fill through it stores
 * the same raster. The hashes were measured on main @ 73a7e10c BEFORE the slice-4 code (sha256 of the Float32 bytes,
 * first 16 hex; the stored raster's h).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, selectHeightRect, selectHeightEllipse, featherHeightSelection,
  heightSelection, fillHeight,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';

const hashOf = (f32) => createHash('sha256').update(Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)).digest('hex').slice(0, 16);
const saved = {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 2; P.heightIn = 1.5; P.heightLayers = DEFAULT.heightLayers;
  document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
  _resetHeightPanelForTests();
  window.svgEditor = { _undoStack: [], pushState() { this._undoStack.push({}); }, _notifyChange() {} };
  initHeightPanel({});
});
afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; vi.useRealTimers(); });

describe('Feather, default profile = the slice-2 feather, byte for byte', () => {
  it('a rectangle feathered 0.1 in: the mask hash measured on main', async () => {
    await newHeightPatch(); // 200 x 150
    selectHeightRect([-0.6, -0.4], [0.3, 0.5]);
    featherHeightSelection(0.1);
    expect(hashOf(heightSelection().mask)).toBe('d8d43b1362b9afb7');
  });
  it('an ellipse feathered 0.05 in, then a fill through it: the stored raster h measured on main', async () => {
    await newHeightPatch();
    selectHeightEllipse([-0.8, -0.6], [0.7, 0.4]);
    featherHeightSelection(0.05);
    expect(hashOf(heightSelection().mask)).toBe('43a144cad60e1aec');
    await fillHeight({ heightIn: 0.3 });
    expect(activeHeightLayer().raster.h).toBe('ft2keosk8x');
  });
});
