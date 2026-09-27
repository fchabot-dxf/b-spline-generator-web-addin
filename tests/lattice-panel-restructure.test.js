/**
 * RAIL-SPACING R7 — the lattice panels' own section restructure (data + wiring only; the ENGINE side
 * is tests/editor-lattice-pattern-rail-spacing.test.js). Rulings (Fred, NEXT-SESSION-reg-addin.md):
 *   - Box Lattice: Boundary -> Rails -> Ties -> Nodes.
 *   - Shape Lattice: Boundary -> Contour -> Rails -> Ties -> Nodes (Contour is its own section,
 *     right after Boundary — Shape/Segments, seat C's own SHAPE-PARAMS territory, stay untouched
 *     and first).
 *   - Boundary = Size W x H only. Rails = Orientation + Anchor + Spacing + optional Count.
 *   - Seed HIDDEN (not deleted); Generate still re-rolls.
 *   - Old grid-step Spacing select + Every/Offset + old count-range rail fields REMOVED from the UI.
 *   - "Draw boundary" toggle: already gone (lane2's L1 survey) — confirmed here, not built.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initLatticeProperties } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-lattice.js';
import { initShapeLatticeProperties } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import { PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

const PALETTE_PATH = resolve(__dirname, '../bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html');
// Only the markup matters — drop <link>/<script> so happy-dom never tries to fetch them (same
// technique tests/formula.test.js already uses for this same file).
const PALETTE_HTML = readFileSync(PALETTE_PATH, 'utf8')
  .replace(/<link\b[^>]*>/gi, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
const DOC = new DOMParser().parseFromString(PALETTE_HTML, 'text/html');

function sectionTitles(panelBodyId) {
  const body = DOC.getElementById(panelBodyId);
  // Every section's own title is a direct-child <span style="font-weight:600;"> (or the FIRST
  // such span inside a direct-child div) — the SAME convention every section in both panels
  // already follows (T74 AMEND 4's own audit, quoted in the HTML, calls this out explicitly).
  return [...body.children]
    .map((child) => child.querySelector(':scope > span[style*="font-weight:600"]'))
    .filter(Boolean)
    .map((span) => span.textContent.trim());
}

describe('R7: real markup — panel section order', () => {
  it('Box Lattice: Boundary -> Rails -> Ties -> Nodes (Fred\'s own order)', () => {
    const titles = sectionTitles('editorLatticePanelBody');
    const order = ['Boundary', 'Rails', 'Ties', 'Nodes'].map((t) => titles.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b)); // strictly ascending -> exactly this order
  });

  it('Shape Lattice: Boundary -> Contour -> Rails -> Ties -> Nodes, Contour right after Boundary', () => {
    const titles = sectionTitles('editorShapeLatticePanelBody');
    const order = ['Boundary', 'Contour', 'Rails', 'Ties', 'Nodes'].map((t) => titles.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Contour immediately follows Boundary — no other NAMED section between them (F12: Shape and
    // Segments are sub-blocks INSIDE Contour, not sections).
    const iBoundary = titles.indexOf('Boundary'), iContour = titles.indexOf('Contour');
    expect(iContour).toBe(iBoundary + 1);
  });

  it('F12 (Fred: "shape goes in contour", "segment too"): Shape + Segments are INSIDE Contour, not sections of their own', () => {
    const titles = sectionTitles('editorShapeLatticePanelBody');
    expect(titles).not.toContain('Shape');
    expect(titles).not.toContain('Segments');
    const contour = [...DOC.getElementById('editorShapeLatticePanelBody').children]
      .find((c) => c.querySelector(':scope > span[style*="font-weight:600"]')?.textContent.trim() === 'Contour');
    // in Fred's order: the checkbox, the stroke, the shape preset + sliders, then Segments
    const ids = ['shapeLatticeContourShow', 'shapeLatticeContourWidth', 'shapePresetHourglass', 'shapeParam-waistReach',
      'shapeParam-cornerRadiusTop', 'shapeParam-bodyRadius', 'shapeSegmentIndex'];
    const nodes = ids.map((id) => DOC.getElementById(id));
    for (const [i, n] of nodes.entries()) expect(contour.contains(n), ids[i]).toBe(true);
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & 4, `${ids[i - 1]} before ${ids[i]}`).toBeTruthy(); // FOLLOWING
    }
  });

  it('F12 (Fred): the shape seed field is hidden (kept, saved, same id); the dice still rolls a new shape', () => {
    const seed = DOC.getElementById('shapeSeed');
    expect(seed).not.toBeNull();
    expect(seed.closest('label').getAttribute('style')).toMatch(/display:\s*none/);
    expect(DOC.getElementById('shapeReroll').getAttribute('style') || '').not.toMatch(/display:\s*none/);
  });

  it('the OLD grid-step Spacing select + Every/Offset + seeded count-range rail fields are REMOVED, in both panels', () => {
    for (const prefix of ['lattice', 'shapeLattice']) {
      for (const id of [`${prefix}Spacing`, `${prefix}RailsModeCount`, `${prefix}RailsModeEvery`,
        `${prefix}RailsCountMin`, `${prefix}RailsCountMax`, `${prefix}RailsEvery`, `${prefix}RailsOffset`]) {
        expect(DOC.getElementById(id), id).toBeNull();
      }
    }
  });

  it('the NEW Anchor/Spacing/Count fields exist, in both panels', () => {
    for (const prefix of ['lattice', 'shapeLattice']) {
      for (const id of [`${prefix}RailsAnchorStart`, `${prefix}RailsAnchorCenter`, `${prefix}RailsAnchorEnd`,
        `${prefix}RailsSpacing`, `${prefix}RailsSpacingCount`]) {
        expect(DOC.getElementById(id), id).not.toBeNull();
      }
    }
  });

  it('Boundary is Size W x H ONLY — no other numeric field lives in that section, in either panel', () => {
    for (const [bodyId, prefix] of [['editorLatticePanelBody', 'lattice'], ['editorShapeLatticePanelBody', 'shapeLattice']]) {
      const body = DOC.getElementById(bodyId);
      const section = [...body.children].find((c) => c.querySelector(':scope > span[style*="font-weight:600"]')?.textContent.trim() === 'Boundary');
      const inputs = [...section.querySelectorAll('input')].map((i) => i.id);
      expect(inputs.sort()).toEqual([`${prefix}SizeHeight`, `${prefix}SizeWidth`].sort());
    }
  });

  it('Seed is hidden (display:none) but its field/id is NOT deleted, in both panels', () => {
    for (const [id, sectionTitle] of [['latticeSeed', 'Seed'], ['shapeLatticeSeed', 'Fill seed']]) {
      const input = DOC.getElementById(id);
      expect(input, id).not.toBeNull();
      let section = input.parentElement;
      while (section && !section.querySelector(':scope > span[style*="font-weight:600"]')) section = section.parentElement;
      expect(section.querySelector('span').textContent.trim()).toBe(sectionTitle);
      expect(section.getAttribute('style') || '').toMatch(/display:\s*none/);
    }
  });

  it('the "Draw boundary" toggle is confirmed already gone (lane2\'s L1 survey) — nothing built here', () => {
    expect(DOC.querySelector('[id*="drawBoundary" i], [id*="DrawBoundary"]')).toBeNull();
    expect(PALETTE_HTML).not.toMatch(/>\s*Draw boundary\s*</i);
  });
});

// ---------------------------------------------------------------------------
// Wiring: fields -> pattern keys, seed hidden but Generate still re-rolls,
// old patterns byte-identical, for BOTH panels.
// ---------------------------------------------------------------------------
// Same lightweight-but-real _sketchLayer/_handleLayer mock shape as
// tests/lattice-formula-fields.test.js (so generatePattern/generateSilhouette actually run, not stubs).
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
    pushState() {},
    _notifyChange() {},
  };
}
function activeLayerPattern(editor) {
  return editor._layers.find((l) => l.id === editor._activeLayer)?.pattern;
}

const BOX_FIXTURE = `
  <input id="latticeSizeWidth" type="number"><input id="latticeSizeHeight" type="number">
  <button id="latticeOrientHorizontal" class="active"></button><button id="latticeOrientVertical"></button>
  <div role="group" id="latticeRailsAnchorGroup">
    <button id="latticeRailsAnchorStart"></button><button id="latticeRailsAnchorCenter" class="active"></button><button id="latticeRailsAnchorEnd"></button>
  </div>
  <input id="latticeRailsSpacing" type="number" value="1"><input id="latticeRailsSpacingCount" type="number">
  <button id="latticeTiesModeCount" class="active"></button><button id="latticeTiesModeDensity"></button>
  <div id="latticeTiesCountFields"></div><div id="latticeTiesDensityFields"></div>
  <input id="latticeTiesCountMin" type="number" value="8"><input id="latticeTiesCountMax" type="number" value="13">
  <button id="latticeTiesSpanModeCells" class="active"></button><button id="latticeTiesSpanModeRails"></button>
  <input id="latticeTiesDensity" type="range" value="0.4">
  <input id="latticeTiesSpanMin" type="number" value="1"><input id="latticeTiesSpanMax" type="number" value="3">
  <select id="latticeTiesAnchor"><option value="free" selected>free</option></select>
  <input id="latticeTiesRailSnapRows" type="number" value="1"><input id="latticeTiesOneEnded" type="number" value="1">
  <input id="latticeTiesMinSpacing" type="number" value="0.5">
  <input id="latticeNodesEnds" type="checkbox" checked><input id="latticeNodesCrossings" type="checkbox" checked><input id="latticeNodesRailEnds" type="checkbox">
  <input id="latticeSeed" type="number" value="42">
  <button id="latticeGenerate"></button><button id="latticeDetachAll"></button>
  <button id="latticeColorRails"></button><button id="latticeColorTies"></button><button id="latticeColorNodes"></button>
  <input id="latticeWidthRails" type="number"><input id="latticeWidthTies" type="number"><input id="latticeWidthNodes" type="number">
  <input id="latticeWidthLinked" type="number">
  <button id="toolLattice"></button>
  <div id="editorLatticePanelBody"></div>
`;

describe('R7 wiring — box Lattice panel', () => {
  let container, editor;
  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = BOX_FIXTURE;
    document.body.appendChild(container);
    editor = makeMockEditor();
  });
  afterEach(() => { container.remove(); document.querySelectorAll('.color-mosaic-popover').forEach((p) => p.remove()); });

  it('Anchor click + Spacing/Count fields -> pattern.rails on Generate', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeRailsAnchorStart').click();
    document.getElementById('latticeRailsSpacing').value = '2';
    document.getElementById('latticeRailsSpacing').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('latticeRailsSpacingCount').value = '5';
    document.getElementById('latticeRailsSpacingCount').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('latticeGenerate').click();
    const rails = activeLayerPattern(editor).rails;
    expect(rails.mode).toBe('spacing');
    expect(rails.anchor).toBe('start');
    expect(rails.spacing).toBe(2);
    expect(rails.spacingCount).toBe(5);
  });

  it('empty Count -> spacingCount null (fill the boundary)', () => {
    initLatticeProperties(editor);
    document.getElementById('latticeGenerate').click();
    expect(activeLayerPattern(editor).rails.spacingCount).toBeNull();
  });

  it('Seed field is still wired: clicking Generate re-rolls it even though its section is hidden', () => {
    initLatticeProperties(editor);
    const seed = document.getElementById('latticeSeed');
    const before = seed.value;
    document.getElementById('latticeGenerate').click();
    expect(seed.value).not.toBe(before);
    expect(activeLayerPattern(editor).seed).toBe(Number(seed.value));
  });

  it('an OLD saved pattern (rails.mode absent, {every,offset} shape) loads without crashing and keeps its OWN values until Generate is clicked', () => {
    editor._layers[0].pattern = { ...PATTERN_DEFAULTS, rails: { every: 3, offset: 1 } };
    initLatticeProperties(editor);
    document.getElementById('toolLattice').click(); // triggers syncFieldsFromPattern
    // Loading alone must not silently rewrite the stored rails object.
    expect(activeLayerPattern(editor).rails).toEqual({ every: 3, offset: 1 });
    // Clicking Generate applies THIS panel's current fields (mode:'spacing' from here on — the
    // panel has no 'every'/'count' UI left to express the old mode any more).
    document.getElementById('latticeGenerate').click();
    expect(activeLayerPattern(editor).rails.mode).toBe('spacing');
  });
});

describe('R7 wiring — Shape Lattice panel (same guarantees, its own ids)', () => {
  let container, editor;
  const SHAPE_FIXTURE = BOX_FIXTURE
    .replace(/id="lattice/g, 'id="shapeLattice')
    .replace('editorLatticePanelBody', 'editorShapeLatticePanelBody')
    + '<button id="shapeLatticeColorContour"></button>'
    + '<input id="shapeLatticeContourShow" type="checkbox" checked>'
    + '<input id="shapeLatticeContourWidth" type="number">'
    + '<div id="shapeLatticeEndRuleRow"></div><div id="shapeLatticeEndRule"></div>';

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = SHAPE_FIXTURE;
    document.body.appendChild(container);
    editor = makeMockEditor();
  });
  afterEach(() => { container.remove(); document.querySelectorAll('.color-mosaic-popover').forEach((p) => p.remove()); });

  it('Anchor/Spacing/Count -> pattern.rails on Generate', () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeLatticeRailsAnchorEnd').click();
    document.getElementById('shapeLatticeRailsSpacing').value = '1.5';
    document.getElementById('shapeLatticeRailsSpacing').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('shapeLatticeGenerate').click();
    const rails = activeLayerPattern(editor).rails;
    expect(rails.mode).toBe('spacing');
    expect(rails.anchor).toBe('end');
    expect(rails.spacing).toBe(1.5);
  });

  it('Seed (Fill seed) still re-rolls on Generate despite being hidden', () => {
    initShapeLatticeProperties(editor);
    const seed = document.getElementById('shapeLatticeSeed');
    const before = seed.value;
    document.getElementById('shapeLatticeGenerate').click();
    expect(seed.value).not.toBe(before);
  });
});
