/**
 * HEIGHT-PAINTER slice 5 (Fred 2026-11-23: "with carving we need a warning about the surface thickness"): a DETECTION-ONLY
 * range readout from the REAL built heights (lastResult.heights' min / max against the stock 0..P.carveZ -- not the 3D view's
 * H readout). core/carve-range.js carveRangeReport computes it (one function); the Height panel's #heightCarveRange renders
 * it (one place), after every build (editorTopViewUpdated). Nothing is clamped, blocked or changed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { carveRangeReport } from '../bspline-frame-builder/b-spline-gen/html/core/carve-range.js';
import { P, DEFAULT, setLastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initHeightPanel, _resetHeightPanelForTests } from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';

describe('carveRangeReport', () => {
  it('inside the stock: the plain readout (how far the deepest point sits above the floor, the highest under the top)', () => {
    const r = carveRangeReport(Float32Array.from([0.06, 0.7, 1.38]), 1.5);
    expect(r).toMatchObject({ warn: false, min: Math.fround(0.06), max: Math.fround(1.38) });
    expect(r.text).toBe('Deepest point 0.06 in above the carve floor / highest 0.12 in under the stock top');
  });
  it('below the floor and / or above the top: the warnings', () => {
    expect(carveRangeReport(Float32Array.from([-0.04, 0.7, 1.2]), 1.5)).toMatchObject({ warn: true, text: 'Carves 0.04 in below the carve floor / highest 0.30 in under the stock top' });
    expect(carveRangeReport(Float32Array.from([0.2, 1.53]), 1.5)).toMatchObject({ warn: true, text: 'Deepest point 0.20 in above the carve floor / 0.03 in above the stock top (will be cut flat)' });
    expect(carveRangeReport(Float32Array.from([-0.1, 1.6]), 1.5).text).toBe('Carves 0.10 in below the carve floor / 0.10 in above the stock top (will be cut flat)');
  });
  it('no heights: nothing to say', () => {
    expect(carveRangeReport(null, 1.5)).toBeNull();
    expect(carveRangeReport(new Float32Array(0), 1.5)).toBeNull();
  });
});

describe('the Height panel renders it, after every build', () => {
  const saved = {};
  beforeEach(() => {
    Object.assign(saved, { hl: P.heightLayers, cz: P.carveZ });
    P.heightLayers = DEFAULT.heightLayers; P.carveZ = 1.5;
    document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    window.svgEditor = { _undoStack: [], pushState() {}, _notifyChange() {} };
    setLastResult(null);
    initHeightPanel({});
  });
  afterEach(() => { P.heightLayers = saved.hl; P.carveZ = saved.cz; setLastResult(null); delete window.svgEditor; });
  it('a build below the floor shows the warning (warning colour); a build inside shows the plain readout', () => {
    const el = () => document.getElementById('heightCarveRange');
    expect(el().hidden).toBe(true); // no build yet
    setLastResult({ heights: Float32Array.from([-0.04, 0.5, 1.2]), nx: 3, nz: 1 });
    document.dispatchEvent(new CustomEvent('editorTopViewUpdated'));
    expect(el().hidden).toBe(false);
    expect(el().textContent).toMatch(/^Carves 0\.04 in below the carve floor/);
    expect(el().classList.contains('stl-error')).toBe(true);
    setLastResult({ heights: Float32Array.from([0.06, 0.5, 1.38]), nx: 3, nz: 1 });
    document.dispatchEvent(new CustomEvent('editorTopViewUpdated'));
    expect(el().textContent).toBe('Deepest point 0.06 in above the carve floor / highest 0.12 in under the stock top');
    expect(el().classList.contains('stl-error')).toBe(false);
  });
});
