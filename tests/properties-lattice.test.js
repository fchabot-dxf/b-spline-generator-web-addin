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
    // SE7i: the real app ALWAYS has a layer by the time the Lattice panel
    // can be used at all (layers.js's initLayerControls pre-creates
    // "Layer 1" synchronously — BUG-10) — seeded here to match that real
    // invariant, not left empty. Settings now live on THIS layer's own
    // `.pattern` (properties-lattice.js's _currentPattern), so a mock with
    // no real layer object would never actually persist anything a real
    // editor session couldn't reproduce.
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    _color: '#000',
    _strokeWidth: 0.02,
    _selectedElements: [],
    pushState() {},
    _notifyChange() {},
  };
}

/** SE7i: editor._latticePattern retired — settings live on the active
 *  layer's own `.pattern` now. Test helper mirroring properties-lattice.
 *  js's own _currentPattern lookup (by id, not by array position), so
 *  assertions read the SAME place the real code writes to. */
function activeLayerPattern(editor) {
  return editor._layers.find((l) => l.id === editor._activeLayer)?.pattern;
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
    expect(activeLayerPattern(editor).seed).toBe(Number(seedField.value));
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

  it('the Generate button label flips to Regenerate after the first press', async () => {
    // T49: generatePattern (and this click handler) are now async — board
    // mode itself never hits a real await inside generatePattern, but
    // `await`ing ANY promise (even an already-settled one) still defers
    // by at least one microtask per spec, so syncGenerateLabel() no
    // longer runs synchronously within the click dispatch. A macrotask
    // flush (setTimeout 0) is the robust way to wait past every pending
    // microtask without hand-counting how many ticks await desugars to.
    initLatticeProperties(editor);
    const btn = document.getElementById('latticeGenerate');
    expect(btn.textContent).toBe('Generate');
    btn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    expect(activeLayerPattern(editor).colors.rails).toBe(targetHex);
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

describe('initLatticeProperties (SE7h): orientation toggle', () => {
  let container, editor;

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <input id="latticeRailsEvery" type="number" value="2">
      <input id="latticeRailsOffset" type="number" value="0">
      <input id="latticeTiesDensity" type="range" value="0">
      <input id="latticeSeed" type="number" value="42">
      <button id="latticeGenerate"></button>
      <button id="latticeDetachAll"></button>
      <button id="latticeColorRails"></button>
      <button id="latticeColorTies"></button>
      <button id="latticeColorNodes"></button>
      <button id="latticeOrientHorizontal" class="active"></button>
      <button id="latticeOrientVertical"></button>
      <button id="toolLattice"></button>
    `;
    document.body.appendChild(container);
    editor = makeMockEditor();
  });

  afterEach(() => {
    container.remove();
  });

  it('Horizontal is active by default (a fresh pattern reads PATTERN_DEFAULTS.orientation)', () => {
    initLatticeProperties(editor);
    expect(document.getElementById('latticeOrientHorizontal').classList.contains('active')).toBe(true);
    expect(document.getElementById('latticeOrientVertical').classList.contains('active')).toBe(false);
  });

  it('clicking Vertical activates it, deactivates Horizontal, and regenerates (PATTERN.orientation === "vertical")', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeOrientVertical').click();
    expect(document.getElementById('latticeOrientVertical').classList.contains('active')).toBe(true);
    expect(document.getElementById('latticeOrientHorizontal').classList.contains('active')).toBe(false);
    expect(activeLayerPattern(editor).orientation).toBe('vertical');
    expect(activeLayerPattern(editor).id).toBeTruthy(); // it DID generate, not just flip a flag
  });

  it('non-vacuous: the rail geometry actually changes shape when orientation flips (proves it really regenerated, not just relabeled)', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeGenerate').click();
    const railBefore = editor._sketchLayer.children().find((e) => e.attr('data-lattice') === 'rail');
    const beforeGeom = { x1: railBefore.attr('x1'), y1: railBefore.attr('y1'), x2: railBefore.attr('x2'), y2: railBefore.attr('y2') };

    document.getElementById('latticeOrientVertical').click();
    const railAfter = editor._sketchLayer.children().find((e) => e.attr('data-lattice') === 'rail');
    const afterGeom = { x1: railAfter.attr('x1'), y1: railAfter.attr('y1'), x2: railAfter.attr('x2'), y2: railAfter.attr('y2') };
    expect(afterGeom).not.toEqual(beforeGeom);
  });

  it('flipping orientation does NOT roll a new seed (a re-projection, not a reshuffle — SE7g: only Generate rolls)', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeGenerate').click();
    const seedAfterGenerate = activeLayerPattern(editor).seed;

    document.getElementById('latticeOrientVertical').click();
    expect(activeLayerPattern(editor).seed).toBe(seedAfterGenerate);

    document.getElementById('latticeOrientHorizontal').click();
    expect(activeLayerPattern(editor).seed).toBe(seedAfterGenerate);
  });

  it('clicking Horizontal after Vertical flips back (PATTERN.orientation === "horizontal")', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeOrientVertical').click();
    document.getElementById('latticeOrientHorizontal').click();
    expect(activeLayerPattern(editor).orientation).toBe('horizontal');
    expect(document.getElementById('latticeOrientHorizontal').classList.contains('active')).toBe(true);
  });
});

/**
 * SE7h ADD-ON 2 (Fred: "add a check box for nodes at rail end") — wired
 * exactly like latticeNodesEnds/Crossings: unchecked by default
 * (PATTERN_DEFAULTS.nodes.railEnds), read into PATTERN.nodes.railEnds on
 * Generate, reflected back on syncFieldsFromPattern.
 */
describe('initLatticeProperties (SE7h add-on 2): "at rail ends" checkbox', () => {
  let container, editor;

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <input id="latticeRailsEvery" type="number" value="2">
      <input id="latticeRailsOffset" type="number" value="0">
      <!-- T56: ties mode toggle — these two tests isolate "railEnds
           behavior alone, ties fully suppressed" via density:0, which
           only has any effect once mode:'density' is actually selected
           (mode defaults to 'count', which ignores density entirely). -->
      <button id="latticeTiesModeCount" class="active"></button>
      <button id="latticeTiesModeDensity"></button>
      <input id="latticeTiesDensity" type="range" value="0">
      <input id="latticeNodesEnds" type="checkbox" checked>
      <input id="latticeNodesCrossings" type="checkbox" checked>
      <input id="latticeNodesRailEnds" type="checkbox">
      <input id="latticeSeed" type="number" value="42">
      <button id="latticeGenerate"></button>
      <button id="latticeDetachAll"></button>
      <button id="toolLattice"></button>
    `;
    document.body.appendChild(container);
    editor = makeMockEditor();
  });

  afterEach(() => {
    container.remove();
  });

  it('unchecked by default (a fresh pattern reads PATTERN_DEFAULTS.nodes.railEnds === false)', () => {
    initLatticeProperties(editor);
    expect(document.getElementById('latticeNodesRailEnds').checked).toBe(false);
    expect(PATTERN_DEFAULTS.nodes.railEnds).toBe(false);
  });

  it('checking it and pressing Generate writes PATTERN.nodes.railEnds = true, and a node lands at a rail end', () => {
    initLatticeProperties(editor);
    // syncFieldsFromPattern (run at init) already reflected the fresh
    // pattern's default density (0.4) onto the field, clobbering this
    // fixture's own value="0" — zero it again here so ties can't also
    // contribute end/crossing nodes and blur what's under test. T56:
    // density only takes effect in mode:'density' (default is 'count',
    // which ignores it) — select that mode explicitly.
    document.getElementById('latticeTiesModeDensity').click();
    document.getElementById('latticeTiesDensity').value = '0';
    document.getElementById('latticeNodesRailEnds').checked = true;
    document.getElementById('latticeGenerate').click();
    expect(activeLayerPattern(editor).nodes.railEnds).toBe(true);
    const rail = editor._sketchLayer.children().find((e) => e.attr('data-lattice') === 'rail');
    const nodes = editor._sketchLayer.children().filter((e) => e.attr('data-lattice') === 'node');
    expect(rail).toBeDefined();
    expect(nodes.length).toBeGreaterThan(0); // non-vacuous: railEnds actually produced a node, not just a flag
    expect(nodes.some((n) => n.attr('cx') === rail.attr('x1'))).toBe(true); // one sits at the rail's own start
  });

  it('non-vacuous: leaving it unchecked produces no nodes at all (ends/crossings have nothing to attach to with density:0)', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeTiesModeDensity').click(); // T56: density is a no-op outside mode:'density'
    document.getElementById('latticeTiesDensity').value = '0';
    document.getElementById('latticeGenerate').click();
    const node = editor._sketchLayer.children().find((e) => e.attr('data-lattice') === 'node');
    expect(node).toBeUndefined();
  });
});

/** T49: a stand-alone `.attr()`-only element -- the same plain-adapter
 *  contract every SE13 test file uses (mockEl elsewhere), enough for
 *  stampBoundaryRef (reads/writes one attribute) without needing a real
 *  sketchLayer-hosted element. */
function mockPickTarget(attrs = {}) {
  const store = { ...attrs };
  return { attr: (k, ...rest) => (rest.length === 0 ? store[k] : (store[k] = rest[0], undefined)) };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('initLatticeProperties (T49, SE13 Slice 3): Boundary / Ending / Border panel', () => {
  let container, editor;

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <input id="latticeRailsEvery" type="number" value="2">
      <input id="latticeTiesDensity" type="range" value="0">
      <input id="latticeSeed" type="number" value="42">
      <button id="latticeGenerate"></button>
      <button id="latticeDetachAll"></button>
      <button id="toolLattice"></button>
      <div role="group">
        <button id="latticeBoundaryBoard" class="editor-fillmode-btn active"></button>
        <button id="latticeBoundaryShape" class="editor-fillmode-btn"></button>
      </div>
      <button id="latticePickShape"></button>
      <span id="latticeBoundaryStatus"></span>
      <select id="latticeEndRule"></select>
      <input id="latticeBorderEnabled" type="checkbox">
      <input id="latticeBorderWidth" type="number">
      <button id="latticeBorderColor"></button>
      <button id="latticeBorderColorAuto" class="editor-fillmode-btn active"></button>
    `;
    document.body.appendChild(container);
    editor = makeMockEditor();
  });

  afterEach(() => {
    container.remove();
    document.querySelectorAll('.color-mosaic-popover').forEach((p) => p.remove());
  });

  it('Board is active by default; clicking Shape then Generate writes extent.mode = "boundary"', async () => {
    initLatticeProperties(editor);
    expect(document.getElementById('latticeBoundaryBoard').classList.contains('active')).toBe(true);
    document.getElementById('latticeBoundaryShape').click();
    expect(document.getElementById('latticeBoundaryShape').classList.contains('active')).toBe(true);
    document.getElementById('latticeGenerate').click();
    await flush();
    expect(activeLayerPattern(editor).extent).toEqual({ mode: 'boundary' });
  });

  it('the Ending select is populated from the 4 declared rules and defaults to "inset"', () => {
    initLatticeProperties(editor);
    const select = document.getElementById('latticeEndRule');
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['on-boundary', 'inset', 'joint', 'loose']);
    expect(select.value).toBe('inset');
  });

  it('Pick shape arms editor._boundaryPickCallback; invoking it stamps data-boundary-ref, sets PATTERN.boundary.shapeId, and switches to Shape mode', () => {
    initLatticeProperties(editor);
    document.getElementById('latticePickShape').click();
    expect(typeof editor._boundaryPickCallback).toBe('function');

    const target = mockPickTarget();
    expect(target.attr('data-boundary-ref')).toBeUndefined();
    editor._boundaryPickCallback(target);

    const id = target.attr('data-boundary-ref');
    expect(id).toBeTruthy();
    expect(activeLayerPattern(editor).boundary.shapeId).toBe(id);
    expect(document.getElementById('latticeBoundaryShape').classList.contains('active')).toBe(true);
    expect(document.getElementById('latticeBoundaryStatus').textContent).toMatch(/linked/i);
  });

  it('picking the SAME already-stamped element again reuses its existing id (idempotent, no re-stamp)', () => {
    initLatticeProperties(editor);
    const target = mockPickTarget({ 'data-boundary-ref': 'b-existing' });
    document.getElementById('latticePickShape').click();
    editor._boundaryPickCallback(target);
    expect(target.attr('data-boundary-ref')).toBe('b-existing');
    expect(activeLayerPattern(editor).boundary.shapeId).toBe('b-existing');
  });

  it('a click on empty canvas (no hit) cancels the pick without touching PATTERN.boundary', () => {
    initLatticeProperties(editor);
    document.getElementById('latticePickShape').click();
    editor._boundaryPickCallback(null);
    expect(document.getElementById('latticeBoundaryStatus').textContent).toMatch(/cancel/i);
    expect(activeLayerPattern(editor)?.boundary?.shapeId ?? null).toBeNull();
  });

  it('Border enabled/width checkboxes write PATTERN.boundary.border on Generate', async () => {
    initLatticeProperties(editor);
    document.getElementById('latticeBorderEnabled').checked = true;
    document.getElementById('latticeBorderWidth').value = '0.1';
    document.getElementById('latticeGenerate').click();
    await flush();
    const border = activeLayerPattern(editor).boundary.border;
    expect(border.enabled).toBe(true);
    expect(border.width).toBe(0.1);
  });

  it('an empty Border width field means "auto" (null), not 0 or NaN', async () => {
    initLatticeProperties(editor);
    document.getElementById('latticeBorderEnabled').checked = true;
    document.getElementById('latticeGenerate').click();
    await flush();
    expect(activeLayerPattern(editor).boundary.border.width).toBeNull();
  });

  it('the Border color swatch: picking a color sets an explicit override; clicking "auto" resets it to null', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeBorderColor').click();
    const targetHex = '#1a237e';
    document.querySelector(`.color-mosaic-cell[title="${targetHex}"]`).click();
    expect(activeLayerPattern(editor).boundary.border.color).toBe(targetHex);
    expect(document.getElementById('latticeBorderColorAuto').classList.contains('active')).toBe(false);

    document.getElementById('latticeBorderColorAuto').click();
    expect(activeLayerPattern(editor).boundary.border.color).toBeNull();
    expect(document.getElementById('latticeBorderColorAuto').classList.contains('active')).toBe(true);
  });
});
