/**
 * SE10 / T26 — editor/layers.js's shared renderLayerList: one row per
 * layer, right visibility/active state, and (via renderLayersPanel, the
 * function every layer mutation already calls) the editor's own Layers
 * panel and the Vector Stamping sidebar's compact layer browser never
 * disagree — same data, same render, same handlers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  renderLayerList, renderLayersPanel,
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
});
