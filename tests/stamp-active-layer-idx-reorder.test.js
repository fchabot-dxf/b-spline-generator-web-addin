/**
 * H22 item 3 — the two "adjacent, not confirmed broken" position-based
 * lookups named in H22 item 2's sweep: main/stamp/_shared.js's
 * activeEditorLayer() and core/state.js's updateP layer-sync both read
 * `window.svgEditor._layers[P.activeLayerIdx]` directly. Unlike the two
 * bugs actually fixed in H22 items 2/3 (a DIFFERENT array's index reused
 * against `_layers`), this is the SAME array indexed by a value
 * (`P.activeLayerIdx`) that main/stamp/layer.js's syncFromEditor keeps
 * live by recomputing `_layers.findIndex(id)` on every `editorLayersChanged`
 * event — which editor/layers.js's renderLayersPanel dispatches after
 * every roster change, INCLUDING reorder (H22 item 1's own drag-to-reorder
 * ends by calling renderLayersPanel). So the real question is empirical:
 * does a REAL drag-to-reorder (not a hand-edited array) leave
 * P.activeLayerIdx pointing at the layer that's actually active, even
 * though its ARRAY POSITION just changed?
 *
 * Per the dispatch: test each, fix only if it fails.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { updateP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { createStampCtx } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/_shared.js';
import { initLayer } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/layer.js';
import { renderLayersPanel } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';

function mockLayer(id, overrides = {}) {
  return { id, name: `Layer ${id}`, visible: true, profile: 'vbit', depth: 0.25, ...overrides };
}

function fireHandle(row, type, opts = {}) {
  const handle = row.querySelector('.layer-handle');
  handle.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0,
    clientX: 10, clientY: opts.clientY ?? 0,
  }));
}

function stubRect(el, top, height) {
  el.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 100, width: 100 });
}

function findRow(container, id) {
  return Array.from(container.querySelectorAll('.layer-row')).find(r => r.dataset.layerId === id);
}

/** Drags sourceId's row onto targetId's row (top half = before, bottom half = after). */
function dragRow(container, sourceId, targetId, above) {
  const sourceRow = findRow(container, sourceId);
  const targetRow = findRow(container, targetId);
  stubRect(targetRow, 100, 40);
  document.elementFromPoint = () => targetRow;
  fireHandle(sourceRow, 'pointerdown', { clientY: 10 });
  fireHandle(sourceRow, 'pointermove', { clientY: above ? 105 : 130 });
  fireHandle(sourceRow, 'pointerup', { clientY: above ? 105 : 130 });
}

describe('P.activeLayerIdx stays correct across a REAL drag-to-reorder (H22 item 3)', () => {
  let container, editor;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'editorLayersList';
    document.body.appendChild(container);

    editor = {
      _layers: [mockLayer('0'), mockLayer('1'), mockLayer('2')],
      _activeLayer: '1',
      pushState: vi.fn(),
      _onChange: vi.fn(),
    };
    window.svgEditor = editor;
    renderLayersPanel(editor);

    const ctx = createStampCtx({});
    initLayer(ctx); // registers the editorLayersChanged listener + runs an initial sync
  });

  afterEach(() => {
    container.remove();
    delete document.elementFromPoint;
    delete window.svgEditor;
  });

  it('activeEditorLayer()/activeLayer() (_shared.js) still resolve the TRUE active layer after its array position changes', () => {
    expect(P.activeLayerIdx).toBe(1); // baseline: layer '1' starts at position 1

    // Drag layer '0' onto layer '1' (drop above it): reorderLayer's own
    // splice/reinsert moves '1' from array index 1 to index 0, WITHOUT '1'
    // itself being the one dragged.
    dragRow(container, '0', '1', true);
    expect(editor._layers.map(l => l.id)).toEqual(['1', '0', '2']);
    expect(P.activeLayerIdx).toBe(0); // resynced: '1' is now at index 0, not 1

    const ctx = createStampCtx({});
    const activeLayer = ctx.activeLayer();
    expect(activeLayer).toBeTruthy();
    expect(activeLayer.id).toBe('1'); // still the layer that was actually active
    expect(window.svgEditor._layers[P.activeLayerIdx].id).toBe('1'); // P.activeLayerIdx itself was resynced
  });

  it('updateP\'s layer-sync (core/state.js) writes the TRUE active layer\'s record after a reorder, not whichever layer now sits at the stale index', () => {
    dragRow(container, '0', '1', true); // same reorder as above -- '1' shifts from index 1 to 0

    updateP('stampDepth', 0.6);

    const active = editor._layers.find(l => l.id === '1');
    const others = editor._layers.filter(l => l.id !== '1');
    expect(active.depth).toBe(0.6);
    others.forEach(l => expect(l.depth).not.toBe(0.6));
  });
});
