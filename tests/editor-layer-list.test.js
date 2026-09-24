/**
 * SE10 / T26 — editor/layers.js's shared renderLayerList: one row per
 * layer, right visibility/active state, and (via renderLayersPanel, the
 * function every layer mutation already calls) the editor's own Layers
 * panel and the Vector Stamping sidebar's compact layer browser never
 * disagree — same data, same render, same handlers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  renderLayerList, renderLayersPanel, applyLayerState,
} from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';

function mockEditor(layers, activeLayer) {
  return { _layers: layers, _activeLayer: activeLayer, _sketchLayer: null };
}

function mockLayer(id, overrides = {}) {
  return { id, name: `Layer ${id}`, visible: true, profile: 'vbit', depth: 0.25, ...overrides };
}

describe('renderLayerList', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { container.remove(); });

  it('renders exactly one .layer-row per layer', () => {
    const editor = mockEditor([mockLayer('0'), mockLayer('1'), mockLayer('2')], '1');
    renderLayerList(container, editor);
    expect(container.querySelectorAll('.layer-row').length).toBe(3);
  });

  it('marks the active layer\'s row .active, and only that one', () => {
    const editor = mockEditor([mockLayer('0'), mockLayer('1'), mockLayer('2')], '1');
    renderLayerList(container, editor);
    const rows = Array.from(container.querySelectorAll('.layer-row'));
    const activeRows = rows.filter(r => r.classList.contains('active'));
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].dataset.layerId).toBe('1');
  });

  it('reflects each layer\'s visible flag on its eye button (is-hidden class)', () => {
    const editor = mockEditor([
      mockLayer('0', { visible: true }),
      mockLayer('1', { visible: false }),
    ], '0');
    renderLayerList(container, editor);
    const rows = Array.from(container.querySelectorAll('.layer-row'));
    const visRow = rows.find(r => r.dataset.layerId === '0');
    const hiddenRow = rows.find(r => r.dataset.layerId === '1');
    expect(visRow.querySelector('.layer-visibility').classList.contains('is-hidden')).toBe(false);
    expect(hiddenRow.querySelector('.layer-visibility').classList.contains('is-hidden')).toBe(true);
  });

  it('shows an empty-state message and zero rows when there are no layers', () => {
    const editor = mockEditor([], null);
    renderLayerList(container, editor);
    expect(container.querySelectorAll('.layer-row').length).toBe(0);
    expect(container.querySelector('.layers-empty')).toBeTruthy();
  });

  it('compact:true adds the .compact class and a .layer-tool-summary read-out; compact:false (default) has neither', () => {
    const editor = mockEditor([mockLayer('0', { profile: 'ballnose', depth: 0.12 })], '0');
    renderLayerList(container, editor, { compact: true });
    const compactRow = container.querySelector('.layer-row');
    expect(compactRow.classList.contains('compact')).toBe(true);
    expect(compactRow.querySelector('.layer-tool-summary')?.textContent).toBe('Ball .12"');

    renderLayerList(container, editor, { compact: false });
    const plainRow = container.querySelector('.layer-row');
    expect(plainRow.classList.contains('compact')).toBe(false);
    expect(plainRow.querySelector('.layer-tool-summary')).toBeNull();
  });

  it('rows render top-to-bottom in REVERSE array order (top of the list = top of z-order = last in _layers)', () => {
    const editor = mockEditor([mockLayer('0'), mockLayer('1'), mockLayer('2')], '0');
    renderLayerList(container, editor);
    const ids = Array.from(container.querySelectorAll('.layer-row')).map(r => r.dataset.layerId);
    expect(ids).toEqual(['2', '1', '0']);
  });

  // SE10 AMEND 4/5: carve (⛏) / drape3d (3D) / showColor (■) — all three
  // real toggles, in BOTH compact and non-compact rows (amend 5 dropped
  // the earlier compact-only-badge design for drape3d/showColor).
  it('carve/drape3d/showColor render as real buttons with .active + aria-pressed reflecting the layer, in BOTH compact and non-compact rows', () => {
    const editor = mockEditor([
      mockLayer('0', { carve: false, drape3d: true, showColor: false }),
    ], '0');

    for (const compact of [false, true]) {
      renderLayerList(container, editor, { compact });
      const row = container.querySelector('.layer-row');
      const carveBtn = row.querySelector('.layer-carve');
      const drapeBtn = row.querySelector('.layer-drape3d');
      const colorBtn = row.querySelector('.layer-showcolor');

      expect(carveBtn.classList.contains('active')).toBe(false); // carve:false
      expect(carveBtn.getAttribute('aria-pressed')).toBe('false');
      expect(drapeBtn.classList.contains('active')).toBe(true);  // drape3d:true
      expect(drapeBtn.getAttribute('aria-pressed')).toBe('true');
      expect(colorBtn.classList.contains('active')).toBe(false); // showColor:false
      expect(colorBtn.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('a not-carved layer\'s tool summary gets the .not-carved (dimmed) class; a carved one does not', () => {
    const editor = mockEditor([
      mockLayer('0', { carve: false }),
      mockLayer('1', { carve: true }),
    ], '0');
    renderLayerList(container, editor, { compact: true });
    const row0 = container.querySelector('.layer-row[data-layer-id="0"]');
    const row1 = container.querySelector('.layer-row[data-layer-id="1"]');
    expect(row0.querySelector('.layer-tool-summary').classList.contains('not-carved')).toBe(true);
    expect(row1.querySelector('.layer-tool-summary').classList.contains('not-carved')).toBe(false);
  });
});

describe('renderLayersPanel: the editor panel and the sidebar never disagree', () => {
  let editorList, stampList;
  beforeEach(() => {
    editorList = document.createElement('div');
    editorList.id = 'editorLayersList';
    stampList = document.createElement('div');
    stampList.id = 'stampLayersList';
    document.body.appendChild(editorList);
    document.body.appendChild(stampList);
  });
  afterEach(() => {
    editorList.remove();
    stampList.remove();
  });

  it('both lists render the same rows from one renderLayersPanel call', () => {
    const editor = mockEditor([mockLayer('0'), mockLayer('1')], '0');
    renderLayersPanel(editor);
    expect(editorList.querySelectorAll('.layer-row').length).toBe(2);
    expect(stampList.querySelectorAll('.layer-row').length).toBe(2);
    // The editor panel's rows are NOT compact; the sidebar's are.
    expect(editorList.querySelector('.layer-row.compact')).toBeNull();
    expect(stampList.querySelector('.layer-row.compact')).not.toBeNull();
  });

  it('clicking the eye in the SIDEBAR list updates the EDITOR panel\'s row too (and vice versa) — proven by driving the real click handler, not by asserting on data alone', () => {
    const editor = mockEditor([mockLayer('0', { visible: true })], '0');
    renderLayersPanel(editor);

    const stampEye = stampList.querySelector('.layer-row[data-layer-id="0"] .layer-visibility');
    stampEye.click(); // calls setLayerVisible(editor, '0', false) -> re-renders BOTH lists

    const editorEye = editorList.querySelector('.layer-row[data-layer-id="0"] .layer-visibility');
    expect(editorEye.classList.contains('is-hidden')).toBe(true);
    expect(editor._layers[0].visible).toBe(false);

    // And the reverse direction.
    const editorEyeAgain = editorList.querySelector('.layer-row[data-layer-id="0"] .layer-visibility');
    editorEyeAgain.click(); // back to visible
    const stampEyeAfter = stampList.querySelector('.layer-row[data-layer-id="0"] .layer-visibility');
    expect(stampEyeAfter.classList.contains('is-hidden')).toBe(false);
    expect(editor._layers[0].visible).toBe(true);
  });

  it('clicking a row in the sidebar activates that layer, reflected as .active in BOTH lists', () => {
    const editor = mockEditor([mockLayer('0'), mockLayer('1')], '0');
    renderLayersPanel(editor);

    const stampRow1 = stampList.querySelector('.layer-row[data-layer-id="1"]');
    stampRow1.click();

    expect(editor._activeLayer).toBe('1');
    expect(editorList.querySelector('.layer-row[data-layer-id="1"]').classList.contains('active')).toBe(true);
    expect(stampList.querySelector('.layer-row[data-layer-id="1"]').classList.contains('active')).toBe(true);
    expect(editorList.querySelector('.layer-row[data-layer-id="0"]').classList.contains('active')).toBe(false);
  });

  // SE10 AMEND: the three new toggles are wired exactly like the eye —
  // clicking in either list updates the shared data, so BOTH re-renders
  // agree. One test per toggle, each driven via a real click, not data.
  it('clicking ⛏ carve in the EDITOR panel updates the SIDEBAR row too', () => {
    const editor = mockEditor([mockLayer('0', { carve: true })], '0');
    renderLayersPanel(editor);

    editorList.querySelector('.layer-carve').click();

    expect(editor._layers[0].carve).toBe(false);
    expect(stampList.querySelector('.layer-carve').classList.contains('active')).toBe(false);
  });

  it('clicking 3D drape3d in the SIDEBAR updates the EDITOR panel row too', () => {
    const editor = mockEditor([mockLayer('0', { drape3d: false })], '0');
    renderLayersPanel(editor);

    stampList.querySelector('.layer-drape3d').click();

    expect(editor._layers[0].drape3d).toBe(true);
    expect(editorList.querySelector('.layer-drape3d').classList.contains('active')).toBe(true);
  });

  it('clicking ■ showColor in the EDITOR panel updates the SIDEBAR row too', () => {
    const editor = mockEditor([mockLayer('0', { showColor: true })], '0');
    renderLayersPanel(editor);

    editorList.querySelector('.layer-showcolor').click();

    expect(editor._layers[0].showColor).toBe(false);
    expect(stampList.querySelector('.layer-showcolor').classList.contains('active')).toBe(false);
  });
});

// SE10 AMEND 5: showColor off -> a display-only .layer-no-color class on
// the layer's live SVG children (applyLayerState), never a rewrite of
// their own stored stroke/fill — turning it back on removes the class
// and the element's original color shows again untouched.
describe('applyLayerState: showColor drives .layer-no-color on the SVG canvas', () => {
  function mockChild(layerId) {
    const classes = new Set();
    return {
      attr: (name) => (name === 'data-layer' ? layerId : undefined),
      addClass: (c) => classes.add(c),
      removeClass: (c) => classes.delete(c),
      hasClass: (c) => classes.has(c),
      _classes: classes,
    };
  }

  it('adds .layer-no-color to a showColor:false layer\'s children, and NOT to a showColor:true layer\'s', () => {
    const noColorChild = mockChild('0');
    const colorChild = mockChild('1');
    const editor = {
      _activeLayer: '0',
      _layers: [
        mockLayer('0', { showColor: false }),
        mockLayer('1', { showColor: true }),
      ],
      _sketchLayer: { children: () => [noColorChild, colorChild] },
      _selectedElements: [],
    };

    applyLayerState(editor);

    expect(noColorChild._classes.has('layer-no-color')).toBe(true);
    expect(colorChild._classes.has('layer-no-color')).toBe(false);
  });

  it('removing the class again once showColor flips back to true — never touches any unrelated class', () => {
    const child = mockChild('0');
    child.addClass('user-custom-marker'); // a class applyLayerState has no opinion on — must survive both calls
    const editor = {
      _activeLayer: '0',
      _layers: [mockLayer('0', { showColor: false })],
      _sketchLayer: { children: () => [child] },
      _selectedElements: [],
    };

    applyLayerState(editor);
    expect(child._classes.has('layer-no-color')).toBe(true);

    editor._layers[0].showColor = true;
    applyLayerState(editor);
    expect(child._classes.has('layer-no-color')).toBe(false);
    expect(child._classes.has('user-custom-marker')).toBe(true); // untouched by this change
  });
});
