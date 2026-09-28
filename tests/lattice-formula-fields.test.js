/**
 * FORMULA-FIELDS R5: the declared per-panel scope (lattice-formula-fields.js) shared by the Lattice
 * Pattern panel (properties-lattice.js) and the Shape Lattice panel (properties-shape-lattice.js),
 * plus the per-piece override width field (lattice-piece-panel.js).
 *
 * Real elements + real init functions (same fixture shape as tests/properties-lattice.test.js /
 * tests/properties-shape-lattice.test.js), extended with the fields those tests don't need
 * (Size, rails/ties counts, widths) so a formula can actually be typed and committed against them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initLatticeProperties } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-lattice.js';
import { initShapeLatticeProperties } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import { mountSelectedPiecePanel } from '../bspline-frame-builder/b-spline-gen/html/editor/lattice-piece-panel.js';
import { latticeScope } from '../bspline-frame-builder/b-spline-gen/html/editor/lattice-formula-fields.js';
import { PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

/** Same lightweight-but-real `_sketchLayer`/`_handleLayer` mock shape as
 *  tests/properties-lattice.test.js / tests/properties-shape-lattice.test.js
 *  (so generatePattern/generateSilhouette actually run, not stubs) — the
 *  union of both, since this file drives both panels. `pushState` counts
 *  calls (a plain no-op in those files) so a formula commit's undo-step
 *  count can be asserted directly. */
function makeMockEditor() {
  let elements = [];
  function makeElement(type, initial) {
    const store = { ...initial };
    const elObj = {
      type,
      node: { getAttribute: (k) => (store[k] !== undefined ? store[k] : null), hasAttribute: (k) => store[k] !== undefined },
      attr(k, ...rest) {
        if (rest.length === 0) return store[k];
        const v = rest[0];
        if (v === null || v === undefined) delete store[k]; else store[k] = v;
        return elObj;
      },
      stroke(v) {
        if (typeof v === 'object' && v !== null) {
          if ('color' in v) store.stroke = v.color;
          if ('width' in v) store['stroke-width'] = v.width;
        }
        return elObj;
      },
      fill(v) { if (v !== undefined) store.fill = v; return elObj; },
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      addClass() { return elObj; },
      removeClass() { return elObj; },
      hasClass() { return false; },
      remove() { elements = elements.filter((e) => e !== elObj); },
      clone() { return makeElement(type, { ...store }); },
    };
    return elObj;
  }
  const sketchLayer = {
    line(x1, y1, x2, y2) { const e = makeElement('line', { x1, y1, x2, y2 }); elements.push(e); return e; },
    circle(d) { const e = makeElement('circle', { r: d / 2 }); elements.push(e); return e; },
    path(d) { const e = makeElement('path', { d }); elements.push(e); return e; },
    add(e) { elements.push(e); return e; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: {},
  };
  let handleElements = [];
  const handleLayer = {
    circle(d) { const e = makeElement('circle', { r: d / 2 }); handleElements.push(e); return e; },
    clear() { handleElements = []; },
    children() { const arr = handleElements.slice(); arr.toArray = () => arr; return arr; },
  };
  return {
    _mW: 4, _mH: 6,
    _sketchLayer: sketchLayer,
    _handleLayer: handleLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    _color: '#000', _strokeWidth: 0.02, _selectedElements: [], _pointerType: 'mouse',
    pushState() { this._pushCount = (this._pushCount || 0) + 1; },
    _notifyChange() {},
  };
}

function activeLayerPattern(editor) {
  return editor._layers.find((l) => l.id === editor._activeLayer)?.pattern;
}

const LATTICE_DOM = `
  <input id="latticeSizeWidth" type="number" min="0" step="0.25" placeholder="auto">
  <input id="latticeSizeHeight" type="number" min="0" step="0.25" placeholder="auto">
  <div role="group" id="latticeRailsAnchorGroup">
    <button id="latticeRailsAnchorStart"></button>
    <button id="latticeRailsAnchorCenter" class="active"></button>
    <button id="latticeRailsAnchorEnd"></button>
  </div>
  <input id="latticeRailsSpacing" type="number" min="0" step="0.05" value="1">
  <input id="latticeRailsSpacingCount" type="number" min="1" step="1" placeholder="fill">
  <button id="latticeTiesModeCount"></button><button id="latticeTiesModeDensity"></button>
  <div id="latticeTiesCountFields"></div><div id="latticeTiesDensityFields"></div>
  <input id="latticeTiesCountMin" type="number" min="1" step="1" value="8">
  <input id="latticeTiesCountMax" type="number" min="1" step="1" value="13">
  <button id="latticeTiesSpanModeCells"></button><button id="latticeTiesSpanModeRails"></button>
  <input id="latticeTiesDensity" type="range" min="0" max="1" step="0.05" value="0.4">
  <input id="latticeTiesSpanMin" type="number" min="1" step="1" value="1">
  <input id="latticeTiesSpanMax" type="number" min="1" step="1" value="3">
  <select id="latticeTiesAnchor"><option value="free" selected>free</option></select>
  <input id="latticeTiesRailSnapRows" type="number" min="0" step="1" value="1">
  <input id="latticeTiesOneEnded" type="number" min="0" step="1" value="1">
  <input id="latticeTiesMinSpacing" type="number" min="0" step="0.05" value="0.5">
  <input id="latticeNodesEnds" type="checkbox" checked>
  <input id="latticeNodesCrossings" type="checkbox" checked>
  <input id="latticeNodesRailEnds" type="checkbox">
  <input id="latticeSeed" type="number" value="42">
  <button id="latticeGenerate"></button>
  <button id="latticeUnprotectAll"></button>
  <button id="latticeColorRails"></button><button id="latticeColorTies"></button><button id="latticeColorNodes"></button>
  <input id="latticeWidthRails" type="number" min="0" step="0.05" value="0.1">
  <input id="latticeWidthTies" type="number" min="0" step="0.05" value="0.1">
  <input id="latticeWidthNodes" type="number" min="0" step="0.05" value="0.2">
  <input id="latticeWidthLinked" type="number" min="0" step="0.05" value="0.1">
  <button id="latticeWidthLinkToggle"></button>
  <div id="latticeWidthUnlinkedFields"></div><div id="latticeWidthLinkedRow"></div>
  <button id="latticeOrientHorizontal" class="active"></button><button id="latticeOrientVertical"></button>
  <button id="toolLattice"></button>
  <div id="editorLatticePanelBody"></div>
`;

describe('lattice panels — formula fields (R5)', () => {
  let container, editor;
  const type = (input, text) => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const enter = (input) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const preview = () => document.querySelector('.formula-preview');

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = LATTICE_DOM;
    document.body.appendChild(container);
    editor = makeMockEditor();
  });
  afterEach(() => {
    container.remove();
    document.querySelectorAll('.color-mosaic-popover, .formula-preview, .formula-dropdown').forEach((n) => n.remove());
  });

  describe('latticeScope — live values', () => {
    it('width/height resolve the REAL boundary size (never null), reading a live currentPattern', () => {
      let pattern = { size: { width: null, height: null } };
      const scope = latticeScope(editor, () => pattern);
      // editor._mW=4, _mH=6 with size unset -> inset-auto default (never throws, never NaN).
      expect(Number.isFinite(scope.find((d) => d.name === 'width').get())).toBe(true);
      expect(Number.isFinite(scope.find((d) => d.name === 'height').get())).toBe(true);

      pattern = { size: { width: 3, height: 5 } };
      expect(scope.find((d) => d.name === 'width').get()).toBe(3);
      expect(scope.find((d) => d.name === 'height').get()).toBe(5);
    });

    it('stroke/railwidth/tiewidth/nodewidth/minspacing read the pattern live, falling back to PATTERN_DEFAULTS', () => {
      let pattern = {};
      const scope = latticeScope(editor, () => pattern);
      const get = (n) => scope.find((d) => d.name === n).get();
      expect(get('stroke')).toBe(PATTERN_DEFAULTS.widths.rails);
      expect(get('railwidth')).toBe(PATTERN_DEFAULTS.widths.rails);
      expect(get('tiewidth')).toBe(PATTERN_DEFAULTS.widths.ties);
      expect(get('nodewidth')).toBe(PATTERN_DEFAULTS.widths.nodeDiameter);
      expect(get('minspacing')).toBe(PATTERN_DEFAULTS.ties.minSpacing);

      pattern = { widths: { rails: 0.3, ties: 0.15, nodeDiameter: 0.4 }, ties: { minSpacing: 0.75 } };
      expect(get('stroke')).toBe(0.3);
      expect(get('railwidth')).toBe(0.3);
      expect(get('tiewidth')).toBe(0.15);
      expect(get('nodewidth')).toBe(0.4);
      expect(get('minspacing')).toBe(0.75);
    });

    it('R7: `spacing` is repointed to rails.spacing (rail-to-rail), not the retired grid-step pattern.spacing', () => {
      let pattern = {};
      const scope = latticeScope(editor, () => pattern);
      const get = (n) => scope.find((d) => d.name === n).get();
      expect(get('spacing')).toBe(PATTERN_DEFAULTS.rails.spacing);

      pattern = { rails: { spacing: 2.5 }, spacing: 0.5 }; // pattern.spacing (grid step) present but IGNORED here
      expect(get('spacing')).toBe(2.5);
    });

    it('R7: ties count + density read the [min,max] pair and scalar live (rail count/every/offset names retired with their UI)', () => {
      const pattern = { ties: { count: [2, 5], density: 0.7 } };
      const scope = latticeScope(editor, () => pattern);
      const get = (n) => scope.find((d) => d.name === n).get();
      expect([get('tiecountmin'), get('tiecountmax')]).toEqual([2, 5]);
      expect(get('tiedensity')).toBe(0.7);
      expect(scope.map((d) => d.name)).not.toContain('railcountmin');
      expect(scope.map((d) => d.name)).not.toContain('railevery');
      expect(scope.map((d) => d.name)).not.toContain('railoffset');
    });

    it('an `extra` list is appended without disturbing the shared names', () => {
      const scope = latticeScope(editor, () => ({}), [{ name: 'contourstroke', get: () => 1 }]);
      expect(scope.map((d) => d.name)).toContain('contourstroke');
      expect(scope.map((d) => d.name)).toContain('width');
    });
  });

  describe('box Lattice panel — formula-capable fields', () => {
    it('a formula in Size Width commits and re-projects IMMEDIATELY (one pushState, existing handler runs)', () => {
      initLatticeProperties(editor);
      const w = document.getElementById('latticeSizeWidth');
      type(w, 'width*2');
      enter(w);
      // editor._mW=4 with no size set -> auto-inset default (CONTOUR_SIZE_INSET_IN=0.5 each side) = 4 - 1 = 3.
      expect(w.value).toBe('6');
      expect(editor._pushCount).toBe(1);
      expect(activeLayerPattern(editor).size.width).toBe(6);
    });

    it('a formula in a DEFERRED field (Rails Count, R7) commits to a plain number but waits for Generate, same as typing', () => {
      initLatticeProperties(editor);
      const count = document.getElementById('latticeRailsSpacingCount');
      type(count, 'spacing*3'); // spacing defaults to 1in -> 3
      enter(count);
      expect(count.value).toBe('3');
      expect(editor._pushCount || 0).toBe(0); // no Generate yet -- deferred, exactly like a plain typed number today
      document.getElementById('latticeGenerate').click();
      expect(activeLayerPattern(editor).rails.spacingCount).toBe(3);
    });

    it('range clamp holds on a lattice field (Rails Count, R7, min="1")', () => {
      initLatticeProperties(editor);
      const count = document.getElementById('latticeRailsSpacingCount');
      type(count, '-spacing'); // -1, below the declared min="1"
      expect(preview().textContent).toMatch(/-1.*→.*1.*min/);
      enter(count);
      expect(count.value).toBe('1');
    });

    it('bad formula keeps the old value and never reaches the panel', () => {
      initLatticeProperties(editor);
      const w = document.getElementById('latticeSizeWidth');
      type(w, '5');
      w.dispatchEvent(new Event('change', { bubbles: true }));
      const before = activeLayerPattern(editor).size.width;
      type(w, 'nosuchname/2');
      enter(w);
      expect(activeLayerPattern(editor).size.width).toBe(before);
    });

    it('after Generate mutates the pattern, the SAME scope thunk reads the FRESH values (no stale snapshot)', () => {
      initLatticeProperties(editor);
      const widthEl = document.getElementById('latticeWidthRails');
      type(widthEl, 'stroke+0.1');
      enter(widthEl);
      expect(widthEl.value).toBe('0.35'); // 0.25 (PATTERN_DEFAULTS.widths.rails) + 0.1
      // Prove liveness: change the pattern directly (as Regenerate/another field would), then re-evaluate the
      // SAME kind of formula again -- it must pick up the NEW value, not the one read the first time.
      activeLayerPattern(editor).widths.rails = 0.5;
      type(widthEl, 'stroke+0.1');
      enter(widthEl);
      expect(widthEl.value).toBe('0.6');
    });

    it('still works after switching the active layer (SE7i per-layer settings)', () => {
      initLatticeProperties(editor);
      editor._layers.push({ id: '1', name: 'Layer 2', visible: true, pattern: { ...PATTERN_DEFAULTS, widths: { ...PATTERN_DEFAULTS.widths, rails: 0.9 } } });
      editor._activeLayer = '1';
      document.dispatchEvent(new CustomEvent('editorLayersChanged', { detail: { editor } }));
      const widthEl = document.getElementById('latticeWidthRails');
      type(widthEl, 'stroke+1');
      enter(widthEl);
      expect(widthEl.value).toBe('1.9'); // layer 2's own 0.9, not layer 1's 0.1
    });
  });

  describe('Shape Lattice panel — same shared scope, its own DOM ids', () => {
    const SHAPE_DOM = LATTICE_DOM.replace(/id="lattice/g, 'id="shapeLattice').replace('editorLatticePanelBody', 'editorShapeLatticePanelBody')
      + '<div id="shapeLatticeEndRule"></div><div id="shapeLatticeEndRuleRow"></div>'
      + '<input id="shapeLatticeContourShow" type="checkbox" checked>'
      + '<input id="shapeLatticeContourWidth" type="number" min="0" step="0.05" placeholder="auto">'
      + '<button id="shapeLatticeColorContour"></button>';

    beforeEach(() => {
      container.innerHTML = SHAPE_DOM;
    });

    it('a formula in the Shape Lattice Size Width commits over the SAME scope shape', () => {
      initShapeLatticeProperties(editor);
      const w = document.getElementById('shapeLatticeSizeWidth');
      type(w, 'width*2');
      enter(w);
      expect(w.value).toBe('6');
      expect(activeLayerPattern(editor).size.width).toBe(6);
    });

    it('Contour Width (panel-only field) is formula-capable over the base scope', () => {
      initShapeLatticeProperties(editor);
      const cw = document.getElementById('shapeLatticeContourWidth');
      type(cw, 'stroke/2');
      enter(cw);
      expect(cw.value).toBe(String(PATTERN_DEFAULTS.widths.rails / 2)); // 0.125
    });
  });

  describe('per-piece override width (lattice-piece-panel.js)', () => {
    it('the width field is formula-capable when a scope is supplied', () => {
      const body = document.getElementById('editorLatticePanelBody');
      const scope = [{ name: 'width', get: () => 10 }];
      mountSelectedPiecePanel(editor, body, scope);
      const input = body.querySelector('.lattice-piece-width');
      type(input, 'width/4');
      enter(input);
      expect(input.value).toBe('2.5');
    });

    it('mounting with NO scope (omitted, backward compatible) never crashes and leaves the field a plain number field', () => {
      const body = document.getElementById('editorLatticePanelBody');
      expect(() => mountSelectedPiecePanel(editor, body)).not.toThrow();
      expect(body.querySelector('.lattice-piece-width').type).toBe('number');
    });
  });
});
