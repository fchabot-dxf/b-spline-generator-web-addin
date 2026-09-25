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
  isCarved, isExported, showsColor, isOnVisibleLayer,
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

  // MOB4 layer-row AMEND ("C1 — soft segmented"): the tool summary now
  // renders inline after the name in EVERY row, sidebar and editor panel
  // alike — previously compact-only. `compact` still sets the .compact
  // class (kept for the empty-state copy / call-site identification).
  it('renders a "· <tool>" summary inline after the name in BOTH compact and non-compact rows', () => {
    const editor = mockEditor([mockLayer('0', { profile: 'ballnose', depth: 0.12 })], '0');
    renderLayerList(container, editor, { compact: true });
    const compactRow = container.querySelector('.layer-row');
    expect(compactRow.classList.contains('compact')).toBe(true);
    expect(compactRow.querySelector('.layer-tool-summary')?.textContent).toBe(' · Ball .12"');
    // The summary is nested INSIDE .layer-name (so the whole thing
    // ellipsis-truncates as one unit), not a separate row-level flex item.
    expect(compactRow.querySelector('.layer-name .layer-tool-summary')).toBeTruthy();

    renderLayerList(container, editor, { compact: false });
    const plainRow = container.querySelector('.layer-row');
    expect(plainRow.classList.contains('compact')).toBe(false);
    expect(plainRow.querySelector('.layer-tool-summary')?.textContent).toBe(' · Ball .12"');
  });

  it('rows render top-to-bottom in REVERSE array order (top of the list = top of z-order = last in _layers)', () => {
    const editor = mockEditor([mockLayer('0'), mockLayer('1'), mockLayer('2')], '0');
    renderLayerList(container, editor);
    const ids = Array.from(container.querySelectorAll('.layer-row')).map(r => r.dataset.layerId);
    expect(ids).toEqual(['2', '1', '0']);
  });

  // T27: carve ("3D") / showColor (palette) — the two remaining real
  // toggles (drape3d dropped), in BOTH compact and non-compact rows.
  it('carve/showColor render as real buttons with .active + aria-pressed reflecting the layer, in BOTH compact and non-compact rows', () => {
    const editor = mockEditor([
      mockLayer('0', { carve: false, showColor: false }),
    ], '0');

    for (const compact of [false, true]) {
      renderLayerList(container, editor, { compact });
      const row = container.querySelector('.layer-row');
      const carveBtn = row.querySelector('.layer-carve');
      const colorBtn = row.querySelector('.layer-showcolor');

      expect(carveBtn.classList.contains('active')).toBe(false); // carve:false
      expect(carveBtn.getAttribute('aria-pressed')).toBe('false');
      expect(carveBtn.textContent).toBe('3D');
      expect(colorBtn.classList.contains('active')).toBe(false); // showColor:false
      expect(colorBtn.getAttribute('aria-pressed')).toBe('false');
      expect(colorBtn.querySelector('svg')).toBeTruthy(); // T27: SVG icon, not a "■" glyph
      expect(row.querySelector('.layer-drape3d')).toBeNull(); // T27: dropped entirely
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

  // T27: the two toggles are wired exactly like the eye — clicking in
  // either list updates the shared data, so BOTH re-renders agree. One
  // test per toggle, each driven via a real click, not data.
  it('clicking 3D carve in the EDITOR panel updates the SIDEBAR row too', () => {
    const editor = mockEditor([mockLayer('0', { carve: true })], '0');
    renderLayersPanel(editor);

    editorList.querySelector('.layer-carve').click();

    expect(editor._layers[0].carve).toBe(false);
    expect(stampList.querySelector('.layer-carve').classList.contains('active')).toBe(false);
  });

  it('clicking the palette showColor button in the EDITOR panel updates the SIDEBAR row too', () => {
    const editor = mockEditor([mockLayer('0', { showColor: true })], '0');
    renderLayersPanel(editor);

    editorList.querySelector('.layer-showcolor').click();

    expect(editor._layers[0].showColor).toBe(false);
    expect(stampList.querySelector('.layer-showcolor').classList.contains('active')).toBe(false);
  });

  // T27's own explicit verify item: "toggling 👁 back on restores
  // carve/showColor unchanged" — visible is the master, but hiding a
  // layer must never reset its OTHER two stored values.
  it('hiding then re-showing a layer (👁) leaves its carve/showColor VALUES unchanged', () => {
    const editor = mockEditor([mockLayer('0', { carve: false, showColor: false })], '0');
    renderLayersPanel(editor);

    editorList.querySelector('.layer-visibility').click(); // hide
    expect(editor._layers[0].visible).toBe(false);
    expect(editor._layers[0].carve).toBe(false);
    expect(editor._layers[0].showColor).toBe(false);
    // The carve/showColor buttons still reflect the raw stored value while hidden.
    expect(editorList.querySelector('.layer-carve').classList.contains('active')).toBe(false);
    expect(editorList.querySelector('.layer-showcolor').classList.contains('active')).toBe(false);

    editorList.querySelector('.layer-visibility').click(); // show again
    expect(editor._layers[0].visible).toBe(true);
    expect(editor._layers[0].carve).toBe(false);    // preserved exactly
    expect(editor._layers[0].showColor).toBe(false); // preserved exactly
  });
});

// T27: the declared truth table every gate rewires to — visible is the
// master; carve/showColor only take effect when it's true.
describe('isCarved / isExported / showsColor — the declared truth table', () => {
  const cases = [
    { visible: true,  carve: true,  showColor: true,  wantCarved: true,  wantExported: true,  wantShows: true  },
    { visible: true,  carve: false, showColor: true,  wantCarved: false, wantExported: true,  wantShows: true  },
    { visible: true,  carve: true,  showColor: false, wantCarved: true,  wantExported: true,  wantShows: false },
    { visible: true,  carve: false, showColor: false, wantCarved: false, wantExported: true,  wantShows: false },
    { visible: false, carve: true,  showColor: true,  wantCarved: false, wantExported: false, wantShows: false },
    { visible: false, carve: false, showColor: false, wantCarved: false, wantExported: false, wantShows: false },
  ];
  cases.forEach(({ visible, carve, showColor, wantCarved, wantExported, wantShows }) => {
    it(`visible=${visible} carve=${carve} showColor=${showColor} -> isCarved=${wantCarved} isExported=${wantExported} showsColor=${wantShows}`, () => {
      const layer = { visible, carve, showColor };
      expect(isCarved(layer)).toBe(wantCarved);
      expect(isExported(layer)).toBe(wantExported);
      expect(showsColor(layer)).toBe(wantShows);
    });
  });
});

/**
 * SE7h add-on (Fred: generated Rails/Ties/Nodes pieces were unclickable
 * in Select/Node modes — generatePattern restores whatever layer was
 * active BEFORE Generate ran, so its own new layers are never the
 * active one, and isEditableByLayer only ever allows the active layer
 * through). isOnVisibleLayer is the relaxed check hit-testing/marquee
 * use in those two modes instead: "is the element's own layer simply
 * visible" — independent of which layer happens to be active.
 */
describe('isOnVisibleLayer (SE7h add-on)', () => {
  function mockElement(layerId) {
    return { attr: (name) => (name === 'data-layer' ? layerId : undefined) };
  }

  it('true for an element on the ACTIVE layer (unchanged case)', () => {
    const editor = { _activeLayer: '0', _layers: [{ id: '0', visible: true }] };
    expect(isOnVisibleLayer(editor, mockElement('0'))).toBe(true);
  });

  it('true for an element on a VISIBLE layer that is NOT the active one — the whole point of this add-on', () => {
    const editor = { _activeLayer: '0', _layers: [{ id: '0', visible: true }, { id: 'rails', visible: true }] };
    expect(isOnVisibleLayer(editor, mockElement('rails'))).toBe(true);
  });

  it('false for an element on a HIDDEN layer, even though it is not the active one either', () => {
    const editor = { _activeLayer: '0', _layers: [{ id: '0', visible: true }, { id: 'rails', visible: false }] };
    expect(isOnVisibleLayer(editor, mockElement('rails'))).toBe(false);
  });

  it('a layer with no `visible` field at all defaults to true (the same "missing = true" convention as isCarved/isExported/showsColor)', () => {
    const editor = { _activeLayer: '0', _layers: [{ id: '0' }, { id: 'rails' }] };
    expect(isOnVisibleLayer(editor, mockElement('rails'))).toBe(true);
  });

  it('an element whose data-layer names NO layer record at all (legacy/pre-layers content) is always testable', () => {
    const editor = { _activeLayer: '0', _layers: [{ id: '0', visible: true }] };
    expect(isOnVisibleLayer(editor, mockElement('some-unknown-id'))).toBe(true);
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

  // T27: applyLayerState now gates this class on showsColor(layer), the
  // compound helper — visible is the master here too, so a hidden layer
  // gets .layer-no-color even with showColor:true stored on it.
  it('a HIDDEN layer gets .layer-no-color regardless of its own showColor:true (visible is the master)', () => {
    const child = mockChild('0');
    const editor = {
      _activeLayer: '0',
      _layers: [mockLayer('0', { visible: false, showColor: true })],
      _sketchLayer: { children: () => [child] },
      _selectedElements: [],
    };

    applyLayerState(editor);

    expect(child._classes.has('layer-hidden')).toBe(true);
    expect(child._classes.has('layer-no-color')).toBe(true);
  });
});
