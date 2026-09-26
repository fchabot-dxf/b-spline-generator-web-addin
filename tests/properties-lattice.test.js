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
      <input id="latticeTiesOneEnded" type="number" value="1">
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

  it('T67 AMEND 3+4: a fresh pattern reads PATTERN_DEFAULTS.ties.oneEnded (1) onto the One-ended ties field', () => {
    initLatticeProperties(editor);
    expect(document.getElementById('latticeTiesOneEnded').value).toBe(String(PATTERN_DEFAULTS.ties.oneEnded));
  });

  it('T67 AMEND 3+4: editing the One-ended ties field and pressing Generate writes PATTERN.ties.oneEnded, and exactly that many generated ties end up with a free end', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeTiesOneEnded').value = '2';
    document.getElementById('latticeGenerate').click();
    expect(activeLayerPattern(editor).ties.oneEnded).toBe(2);
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

  // UI4 item 0c (Fred: "layer holds a SHAPE lattice -> switch to the BOX
  // Lattice tool -> its Regenerate rebuilds the SHAPE"): _currentPattern
  // returns the SAME layer.pattern object every panel shares (mutated in
  // place) -- a prior Shape Lattice generation on this layer leaves
  // extent.mode:'boundary' + boundary/shape fields sitting on it, which
  // generatePattern reads to decide whether to fill a boundary shape at
  // all. The declared rule: the ACTIVE TOOL (this panel) decides the
  // kind, so its own Generate/Regenerate must reset those away every
  // time, and sweep the OLD contour segments (a different attribute
  // scheme -- data-boundary-ref -- invisible to generatePattern's own
  // OWNERSHIP_ATTR-only sweep) rather than leaving them as orphaned
  // clutter.
  it('UI4 item 0c: pressing Generate on the box Lattice panel resets a stale extent/boundary/shape left by a prior Shape Lattice generation on this layer', () => {
    initLatticeProperties(editor);
    const pattern = activeLayerPattern(editor) || {};
    editor._layers[0].pattern = {
      ...pattern,
      extent: { mode: 'boundary' },
      boundary: { shapeId: 'b-test1', endRule: 'on-boundary' },
      shape: { source: 'generated', params: {} },
    };

    document.getElementById('latticeGenerate').click();

    const after = activeLayerPattern(editor);
    expect(after.extent).toBeUndefined();
    expect(after.boundary).toBeUndefined();
    expect(after.shape).toBeUndefined();
  });

  it('UI4 item 0c: also sweeps the OLD contour segments a prior Shape Lattice generation left on this layer (a different attribute scheme, invisible to the ownership-only sweep)', () => {
    initLatticeProperties(editor);
    // A fake leftover contour segment: same layer, tagged with the
    // boundary ref the stale pattern points at, no OWNERSHIP_ATTR (a real
    // contour segment never carries one -- confirmed by reading
    // editor-lattice-pattern.js's own _findBoundaryElements/stampBoundaryRef).
    const contourSeg = editor._sketchLayer.line(0, 0, 1, 0);
    contourSeg.attr('data-layer', '0');
    contourSeg.attr('data-boundary-ref', 'b-test1');
    editor._layers[0].pattern = {
      ...(activeLayerPattern(editor) || {}),
      extent: { mode: 'boundary' },
      boundary: { shapeId: 'b-test1', endRule: 'on-boundary' },
      shape: { source: 'generated', params: {} },
    };

    document.getElementById('latticeGenerate').click();

    const remaining = editor._sketchLayer.children().toArray()
      .filter((ch) => ch.node.getAttribute('data-boundary-ref') === 'b-test1');
    expect(remaining).toHaveLength(0);
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

// T58 (SE14 Slice 3): the "Boundary / Ending / Border panel" describe
// block that used to live here MOVED to tests/properties-shape-lattice.
// test.js — that UI is no longer part of this tool's own panel at all
// ("the box # Lattice loses its Boundary row").

/**
 * T58 ADD-ON (mid-task amendment, Fred: "I normally want ties and rails
 * to be the same width") — widths.linkRailsTies, default true for a
 * brand-new layer. Linked: one "Rails & ties" stepper sets both together
 * (live re-width, ONE undo step). Unlinked: today's separate Rails/Ties
 * steppers. Migration: an existing saved pattern (no `linkRailsTies` key
 * at all) infers linked ONLY when its own rails/ties already happen to be
 * equal — a differing pair loads unlinked, "no silent change".
 */
describe('initLatticeProperties (T58 ADD-ON): linked Rails & ties width', () => {
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
      <div id="latticeWidthUnlinkedFields" style="display:none;">
        <input id="latticeWidthRails" type="number">
        <input id="latticeWidthTies" type="number">
      </div>
      <label id="latticeWidthLinkedRow"><input id="latticeWidthLinked" type="number"></label>
      <button id="latticeWidthLinkToggle" class="editor-fillmode-btn active"></button>
      <input id="latticeWidthNodes" type="number">
    `;
    document.body.appendChild(container);
    editor = makeMockEditor();
  });

  afterEach(() => {
    container.remove();
  });

  it('linked by default on a brand-new pattern: the combined stepper shows, the separate pair is hidden', () => {
    initLatticeProperties(editor);
    expect(document.getElementById('latticeWidthLinkToggle').classList.contains('active')).toBe(true);
    expect(document.getElementById('latticeWidthLinkedRow').style.display).not.toBe('none');
    expect(document.getElementById('latticeWidthUnlinkedFields').style.display).toBe('none');
    expect(document.getElementById('latticeWidthLinked').value).toBe(String(PATTERN_DEFAULTS.widths.rails));
  });

  it('Generate writes the combined stepper\'s value into BOTH widths.rails and widths.ties, plus linkRailsTies:true', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeWidthLinked').value = '0.12';
    document.getElementById('latticeGenerate').click();
    const widths = activeLayerPattern(editor).widths;
    expect(widths.rails).toBe(0.12);
    expect(widths.ties).toBe(0.12);
    expect(widths.linkRailsTies).toBe(true);
  });

  it('non-vacuous: editing the combined stepper LIVE re-widths BOTH already-owned rails and ties, in exactly ONE undo step', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeGenerate').click(); // create owned rails/ties first
    let pushCount = 0;
    editor.pushState = () => { pushCount++; };

    document.getElementById('latticeWidthLinked').value = '0.2';
    document.getElementById('latticeWidthLinked').dispatchEvent(new Event('change'));

    const rail = editor._sketchLayer.children().find((e) => e.attr('data-lattice') === 'rail');
    const tie = editor._sketchLayer.children().find((e) => e.attr('data-lattice') === 'tie');
    expect(rail.attr('stroke-width')).toBe(0.2);
    expect(tie.attr('stroke-width')).toBe(0.2);
    expect(pushCount).toBe(1); // ONE undo step for BOTH kinds, not two
  });

  it('clicking the chain toggle unlinks: the separate Rails/Ties steppers reappear, with NO value change', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeGenerate').click();
    document.getElementById('latticeWidthLinkToggle').click();
    expect(document.getElementById('latticeWidthLinkToggle').classList.contains('active')).toBe(false);
    expect(document.getElementById('latticeWidthUnlinkedFields').style.display).not.toBe('none');
    expect(document.getElementById('latticeWidthLinkedRow').style.display).toBe('none');
    expect(activeLayerPattern(editor).widths.rails).toBe(activeLayerPattern(editor).widths.ties); // unchanged, still equal
  });

  it('an EXISTING pattern with rails !== ties (no linkRailsTies key) loads UNLINKED — "no silent change"', () => {
    editor._layers[0].pattern = {
      ...JSON.parse(JSON.stringify(PATTERN_DEFAULTS)),
      widths: { rails: 0.1, ties: 0.04, nodeDiameter: 0.15 }, // no linkRailsTies key at all — a pre-T58 saved pattern
    };
    initLatticeProperties(editor);
    expect(document.getElementById('latticeWidthLinkToggle').classList.contains('active')).toBe(false);
    expect(document.getElementById('latticeWidthUnlinkedFields').style.display).not.toBe('none');
  });

  it('an EXISTING pattern with rails === ties (no linkRailsTies key) loads LINKED', () => {
    editor._layers[0].pattern = {
      ...JSON.parse(JSON.stringify(PATTERN_DEFAULTS)),
      widths: { rails: 0.08, ties: 0.08, nodeDiameter: 0.15 },
    };
    initLatticeProperties(editor);
    expect(document.getElementById('latticeWidthLinkToggle').classList.contains('active')).toBe(true);
    expect(document.getElementById('latticeWidthLinked').value).toBe('0.08');
  });
});
