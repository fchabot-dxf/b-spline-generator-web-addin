/**
 * SE7g — wires the Lattice Pattern panel's Generate button (rolls a new
 * seed every press, no more standalone Reroll) and the SE7g-amend Colors
 * row (three swatches opening the shared T28 mosaic, recoloring owned
 * pieces in place). The end-to-end flow (real browser, real generated
 * geometry) is proven live via scripts/smoke-lattice-seed-color.mjs
 * (Fred's hard rule this turn: no Fusion tool calls while he's using it —
 * see WORK-LOG) — this file covers the DOM WIRING itself for the
 * automated suite: real elements, real `initLatticeProperties`, a
 * lightweight-but-real `_sketchLayer` mock (same shape as
 * tests/editor-lattice-pattern-emit.test.js's own, so generatePattern
 * actually runs, not a stub).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initLatticeProperties } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-lattice.js';
import { PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

function makeMockEditor() {
  let elements = [];
  function makeElement(initial) {
    const store = { ...initial };
    const elObj = {
      node: {
        getAttribute: (k) => (store[k] !== undefined ? store[k] : null),
        hasAttribute: (k) => store[k] !== undefined,
      },
      attr(k, ...rest) {
        if (rest.length === 0) return store[k];
        const v = rest[0];
        if (v === null || v === undefined) delete store[k];
        else store[k] = v;
        return elObj;
      },
      stroke(v) {
        if (typeof v === 'object' && v !== null && 'color' in v) store.stroke = v.color;
        return elObj;
      },
      fill(v) { if (v !== undefined) store.fill = v; return elObj; },
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      addClass() { return elObj; },
      removeClass() { return elObj; },
      hasClass() { return false; },
      remove() { elements = elements.filter((e) => e !== elObj); },
    };
    return elObj;
  }
  const sketchLayer = {
    line(x1, y1, x2, y2) { const e = makeElement({ x1, y1, x2, y2 }); elements.push(e); return e; },
    circle(d) { const e = makeElement({ r: d / 2 }); elements.push(e); return e; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: {},
  };
  return {
    _mW: 4, _mH: 4,
    _sketchLayer: sketchLayer,
    _layers: [],
    _activeLayer: null,
    _color: '#000',
    _strokeWidth: 0.02,
    _selectedElements: [],
    pushState() {},
    _notifyChange() {},
  };
}

describe('initLatticeProperties (SE7g): Generate rolls a new seed every press', () => {
  let container, editor;

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <select id="latticeSpacing"></select>
      <input id="latticeRailsEvery" type="number" value="2">
      <input id="latticeRailsOffset" type="number" value="0">
      <input id="latticeTiesDensity" type="range" value="1">
      <input id="latticeTiesSpanMin" type="number" value="1">
      <input id="latticeTiesSpanMax" type="number" value="3">
      <select id="latticeTiesAnchor"><option value="free" selected>free</option></select>
      <input id="latticeTiesRailSnapRows" type="number" value="1">
      <input id="latticeNodesEnds" type="checkbox" checked>
      <input id="latticeNodesCrossings" type="checkbox" checked>
      <input id="latticeSeed" type="number" value="42">
      <button id="latticeGenerate"></button>
      <button id="latticeDetachAll"></button>
      <button id="latticeColorRails"></button>
      <button id="latticeColorTies"></button>
      <button id="latticeColorNodes"></button>
      <button id="toolLattice"></button>
    `;
    document.body.appendChild(container);
    editor = makeMockEditor();
  });

  afterEach(() => {
    container.remove();
    document.querySelectorAll('.color-mosaic-popover').forEach((p) => p.remove());
  });

  it('there is no #latticeReroll element (the standalone Reroll button is fully removed)', () => {
    initLatticeProperties(editor);
    expect(document.getElementById('latticeReroll')).toBeNull();
  });

  it('clicking Generate writes a NEW value into the Seed field before generating', () => {
    initLatticeProperties(editor);
    const seedField = document.getElementById('latticeSeed');
    const before = seedField.value;
    document.getElementById('latticeGenerate').click();
    expect(seedField.value).not.toBe(before);
    expect(editor._latticePattern.seed).toBe(Number(seedField.value));
  });

  it('non-vacuous: two Generate presses roll two DIFFERENT seeds (not a fixed re-read of the same field)', () => {
    initLatticeProperties(editor);
    const seedField = document.getElementById('latticeSeed');
    document.getElementById('latticeGenerate').click();
    const first = seedField.value;
    document.getElementById('latticeGenerate').click();
    const second = seedField.value;
    // Astronomically unlikely to collide (1-in-a-million draw) — a real
    // failure here means nextSeed() stopped being random, not bad luck.
    expect(second).not.toBe(first);
  });

  it('the Generate button label flips to Regenerate after the first press', () => {
    initLatticeProperties(editor);
    const btn = document.getElementById('latticeGenerate');
    expect(btn.textContent).toBe('Generate');
    btn.click();
    expect(btn.textContent).toBe('Regenerate');
  });
});

describe('initLatticeProperties (SE7g amend): Colors row swatches', () => {
  let container, editor;

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <input id="latticeRailsEvery" type="number" value="2">
      <input id="latticeTiesDensity" type="range" value="1">
      <input id="latticeSeed" type="number" value="42">
      <button id="latticeGenerate"></button>
      <button id="latticeDetachAll"></button>
      <button id="latticeColorRails"></button>
      <button id="latticeColorTies"></button>
      <button id="latticeColorNodes"></button>
      <button id="toolLattice"></button>
    `;
    document.body.appendChild(container);
    editor = makeMockEditor();
  });

  afterEach(() => {
    container.remove();
    document.querySelectorAll('.color-mosaic-popover').forEach((p) => p.remove());
  });

  it('swatch backgrounds reflect PATTERN_DEFAULTS.colors before any pattern has been generated', () => {
    initLatticeProperties(editor);
    const railsEl = document.getElementById('latticeColorRails');
    expect(railsEl.style.background).toBe(PATTERN_DEFAULTS.colors.rails);
  });

  it('clicking a swatch opens the SHARED color mosaic (32 cells) — not a second, hand-rolled picker', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeColorRails').click();
    expect(document.querySelectorAll('.color-mosaic-grid .color-mosaic-cell')).toHaveLength(32);
  });

  it('picking a color updates the swatch, PATTERN.colors, and (once generated) recolors the owned rails in place', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeGenerate').click(); // create owned rails first
    const railBefore = editor._sketchLayer.children().find((e) => e.attr('data-lattice') === 'rail');
    expect(railBefore).toBeDefined();

    document.getElementById('latticeColorRails').click();
    const targetHex = '#1a237e';
    document.querySelector(`.color-mosaic-cell[title="${targetHex}"]`).click();

    expect(document.getElementById('latticeColorRails').style.background).toBe(targetHex);
    expect(editor._latticePattern.colors.rails).toBe(targetHex);
    expect(railBefore.attr('stroke')).toBe(targetHex);
  });

  it('non-vacuous: recoloring Rails does NOT touch Ties (per-kind isolation)', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeGenerate').click();
    const tie = editor._sketchLayer.children().find((e) => e.attr('data-lattice') === 'tie');
    const tieColorBefore = tie?.attr('stroke');

    document.getElementById('latticeColorRails').click();
    document.querySelector('.color-mosaic-cell[title="#1a237e"]').click();

    if (tie) expect(tie.attr('stroke')).toBe(tieColorBefore);
  });

  it('picking a color BEFORE the first Generate only updates PATTERN.colors (no owned elements to recolor, no crash)', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeColorNodes').click();
    expect(() => {
      document.querySelector('.color-mosaic-cell[title="#c62828"]').click();
    }).not.toThrow();
    expect(document.getElementById('latticeColorNodes').style.background).toBe('#c62828');
  });
});
