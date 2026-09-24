/**
 * SE11 — buildDrapeSvg (core/preview/drape-svg.js), the pure filter
 * deciding which vector elements drape onto the 3D relief.
 *
 * Rule (ROADMAP "Layer toggles FINAL" + "👁 is the master"): a layer
 * drapes when visible && carve && showColor (missing field = true, since
 * seat B's T26/SE10 hasn't landed real fields on editor._layers yet).
 * Pure-black (#000000) elements never drape (advisor's declared default
 * — DRAPE_SKIP_COLORS) so an uncoloured layer doesn't paint black lines
 * over the relief just because it's visible+carved.
 *
 * sketchSvg is exactly editor.save()'s own output shape: a full
 * `<svg viewBox="0 0 mW mH">` document with `data-layer` on each child —
 * built by hand here (not via a live editor) so this file has no DOM/
 * svg.js dependency beyond DOMParser/XMLSerializer, which happy-dom
 * already supports (same as editor-io.js's getLayerSvg, exercised by
 * tests/editor-serialization.test.js).
 */
import { describe, it, expect } from 'vitest';
import { buildDrapeSvg, DRAPE_SKIP_COLORS } from '../bspline-frame-builder/b-spline-gen/html/core/preview/drape-svg.js';

const SKETCH = `<svg xmlns="http://www.w3.org/2000/svg" width="672" height="864" viewBox="0 0 7 9" preserveAspectRatio="none">` +
  `<line data-layer="rails" x1="0" y1="1" x2="6" y2="1" stroke="#c62828" fill="none"/>` +
  `<line data-layer="ties" x1="1" y1="0" x2="1" y2="2" stroke="#f9c80e" fill="none"/>` +
  `<circle data-layer="nodes" cx="1" cy="1" r="0.1" fill="#1a237e" stroke="none"/>` +
  `<line data-layer="black-layer" x1="2" y1="2" x2="3" y2="3" stroke="#000000" fill="none"/>` +
  `</svg>`;

const ALL_QUALIFY = [
  { id: 'rails', visible: true, carve: true, showColor: true },
  { id: 'ties', visible: true, carve: true, showColor: true },
  { id: 'nodes', visible: true, carve: true, showColor: true },
  { id: 'black-layer', visible: true, carve: true, showColor: true },
];

function layerIdsIn(svg) {
  if (!svg) return [];
  const matches = [...svg.matchAll(/data-layer="([^"]+)"/g)];
  return matches.map(m => m[1]);
}

describe('DRAPE_SKIP_COLORS', () => {
  it('is exactly pure black', () => {
    expect(DRAPE_SKIP_COLORS).toEqual(['#000000']);
  });
});

describe('buildDrapeSvg — truth table', () => {
  it('all qualifying layers, black layer skipped by color: rails/ties/nodes kept, black-layer dropped', () => {
    const svg = buildDrapeSvg(ALL_QUALIFY, SKETCH);
    expect(layerIdsIn(svg).sort()).toEqual(['nodes', 'rails', 'ties']);
    expect(svg).not.toContain('#000000');
  });

  it('hidden layer (visible:false) is excluded even though carve/showColor are true', () => {
    const layers = ALL_QUALIFY.map(l => l.id === 'rails' ? { ...l, visible: false } : l);
    const svg = buildDrapeSvg(layers, SKETCH);
    expect(layerIdsIn(svg)).not.toContain('rails');
    expect(layerIdsIn(svg).sort()).toEqual(['nodes', 'ties']);
  });

  it('carve:false excludes a layer even though it is visible and showColor', () => {
    const layers = ALL_QUALIFY.map(l => l.id === 'ties' ? { ...l, carve: false } : l);
    const svg = buildDrapeSvg(layers, SKETCH);
    expect(layerIdsIn(svg)).not.toContain('ties');
    expect(layerIdsIn(svg).sort()).toEqual(['nodes', 'rails']);
  });

  it('showColor:false excludes a layer even though it is visible and carved', () => {
    const layers = ALL_QUALIFY.map(l => l.id === 'nodes' ? { ...l, showColor: false } : l);
    const svg = buildDrapeSvg(layers, SKETCH);
    expect(layerIdsIn(svg)).not.toContain('nodes');
    expect(layerIdsIn(svg).sort()).toEqual(['rails', 'ties']);
  });

  it('missing visible/carve/showColor fields default to true (seat B has not landed T26/SE10 yet)', () => {
    const bareLayers = [{ id: 'rails' }, { id: 'ties' }, { id: 'nodes' }, { id: 'black-layer' }];
    const svg = buildDrapeSvg(bareLayers, SKETCH);
    expect(layerIdsIn(svg).sort()).toEqual(['nodes', 'rails', 'ties']);
  });

  it('returns "" when no layer qualifies (all hidden)', () => {
    const layers = ALL_QUALIFY.map(l => ({ ...l, visible: false }));
    expect(buildDrapeSvg(layers, SKETCH)).toBe('');
  });

  it('returns "" when qualifying layers exist but every element in them is black', () => {
    const onlyBlackQualifies = [{ id: 'black-layer', visible: true, carve: true, showColor: true }];
    expect(buildDrapeSvg(onlyBlackQualifies, SKETCH)).toBe('');
  });

  it('returns "" for empty/missing sketchSvg', () => {
    expect(buildDrapeSvg(ALL_QUALIFY, '')).toBe('');
    expect(buildDrapeSvg(ALL_QUALIFY, null)).toBe('');
  });

  it('preserves the sketch\'s own board-sized viewBox/width/height', () => {
    const svg = buildDrapeSvg(ALL_QUALIFY, SKETCH);
    expect(svg).toContain('viewBox="0 0 7 9"');
    expect(svg).toContain('width="672"');
    expect(svg).toContain('height="864"');
  });

  it('keeps each element\'s own color (does not force one color for all)', () => {
    const svg = buildDrapeSvg(ALL_QUALIFY, SKETCH);
    expect(svg).toContain('#c62828');
    expect(svg).toContain('#f9c80e');
    expect(svg).toContain('#1a237e');
  });

  it('non-vacuous: an element colored anything other than black is NOT skipped (the black check is specific, not "skip everything")', () => {
    const svg = buildDrapeSvg(ALL_QUALIFY, SKETCH);
    // rails is #c62828, not black — must survive the same filter that drops black-layer.
    expect(layerIdsIn(svg)).toContain('rails');
  });
});
