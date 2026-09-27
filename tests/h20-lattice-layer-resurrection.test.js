/**
 * H20 item 6, PRIORITY with item 4 (Fred: "I've been trying to delete
 * layers and after a few layers they just come back").
 *
 * REPRODUCED FIRST, measured live (not assumed from the report): generated
 * a Shape Lattice (Rails/Contour/Ties/Nodes), deleted Ties then Nodes via
 * the REAL delete button (both correctly stayed gone), then toggled a
 * layer's visibility (an ordinary "commit" action, nothing to do with the
 * lattice) — Ties and Nodes both came BACK with brand-new ids. Root cause
 * (found by reading the code, confirmed by the live repro): `removeLayer`
 * never told the owning pattern a kind was gone, so `_ensureKindLayers`
 * (called by both `generatePattern`'s refill and `regenerateSilhouette`)
 * treated the missing layer as "never created yet" and recreated it.
 *
 * Fix: `removeLayer` (layers.js) fires a new `onLayerRemoved` hook BEFORE
 * splicing the layer out; this file's own handler marks the owning
 * pattern's `removedKinds[kind] = true` using the DECLARED identity T80
 * item 4 established — `pattern.layers` (the map saved with the pattern,
 * survives 3D/eye toggles, renames, reordering) — and `_ensureKindLayers`
 * now skips recreating any kind marked removed. Once every non-rails kind
 * is removed, the pattern itself is dropped from the rails layer.
 *
 * Same `makeMockEditor()` shape as tests/editor-lattice-kind-layers.test.js
 * (this file's own sibling, testing `_ensureKindLayers` directly), extended
 * with a real DOM-rendered delete button (same technique as
 * tests/h20-layer-delete-undo.test.js) so `removeLayer` runs for real, not
 * reimplemented.
 */
import { describe, it, expect } from 'vitest';
import { _ensureKindLayers } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { renderLayersPanel } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';

function makeMockEditor() {
  return {
    _sketchLayer: { children() { const a = []; a.toArray = () => a; return a; }, node: {}, clear() {} },
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    pushState() {},
    _notifyChange() {},
    _deselect() {},
  };
}

function deleteLayerViaRealButton(editor, id) {
  document.body.innerHTML = '<div id="editorLayersList"></div>';
  renderLayersPanel(editor);
  const btn = document.querySelector(`[data-layer-id="${id}"] .layer-delete`);
  expect(btn, `delete button for layer ${id}`).toBeTruthy();
  btn.click();
}

describe('H20 item 6: a deleted lattice kind-layer stays deleted through a later refill', () => {
  it('deleting Ties, then re-running _ensureKindLayers for the same kinds, does NOT recreate it', () => {
    const editor = makeMockEditor();
    const pattern = {};
    const ids = _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    expect(editor._layers.map((l) => l.name).sort()).toEqual(['Nodes', 'Rails', 'Ties']);

    deleteLayerViaRealButton(editor, ids.ties);
    expect(editor._layers.some((l) => l.name === 'Ties')).toBe(false);
    expect(pattern.removedKinds.ties).toBe(true);
    expect(pattern.layers.ties).toBeUndefined();

    // Simulate the exact trigger the live repro found: a LATER refill
    // (generatePattern's own call, reproduced here directly) must not
    // bring it back.
    const idsAfter = _ensureKindLayers(editor, pattern, editor._activeLayer, ['rails', 'ties', 'nodes']);
    expect(editor._layers.some((l) => l.name === 'Ties')).toBe(false);
    expect(idsAfter.ties).toBeUndefined();
    // Nodes, never deleted, is untouched.
    expect(editor._layers.some((l) => l.name === 'Nodes')).toBe(true);
  });

  it('the FULL repro sequence: delete Ties, delete Nodes, then a refill resurrects NEITHER (must fail before the fix -- see mutation test in WORK-LOG)', () => {
    const editor = makeMockEditor();
    const pattern = {};
    const ids = _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);

    deleteLayerViaRealButton(editor, ids.ties);
    deleteLayerViaRealButton(editor, ids.nodes);
    expect(editor._layers.map((l) => l.name)).toEqual(['Rails']);

    _ensureKindLayers(editor, pattern, editor._activeLayer, ['rails', 'ties', 'nodes']);
    expect(editor._layers.map((l) => l.name)).toEqual(['Rails']);
  });

  it('_ensureKindLayers for contour also respects removedKinds (regenerateSilhouette\'s own path)', () => {
    const editor = makeMockEditor();
    const pattern = {};
    const idsFirst = _ensureKindLayers(editor, pattern, '0', ['contour']);
    expect(editor._layers.some((l) => l.name === 'Contour')).toBe(true);

    deleteLayerViaRealButton(editor, idsFirst.contour);
    expect(pattern.removedKinds.contour).toBe(true);

    const idsAfter = _ensureKindLayers(editor, pattern, editor._activeLayer, ['contour']);
    expect(idsAfter.contour).toBeUndefined();
    expect(editor._layers.some((l) => l.name === 'Contour')).toBe(false);
  });

  it('deleting EVERY non-rails kind drops the pattern entirely -- rails becomes a plain layer again', () => {
    const editor = makeMockEditor();
    const pattern = {};
    const ids = _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    _ensureKindLayers(editor, pattern, '0', ['contour']); // add contour to the same pattern
    const contourId = pattern.layers.contour;

    deleteLayerViaRealButton(editor, ids.ties);
    deleteLayerViaRealButton(editor, ids.nodes);
    const railsLayer = editor._layers.find((l) => l.id === ids.rails);
    expect(railsLayer.pattern, 'pattern survives while contour is still present').toBe(pattern);

    deleteLayerViaRealButton(editor, contourId);
    expect(railsLayer.pattern, 'pattern is dropped once every non-rails kind is gone').toBeUndefined();
  });

  it('deleting a NON-lattice layer (no .pattern anywhere) is a no-op for the hook -- doesn\'t throw, doesn\'t touch unrelated patterns', () => {
    const editor = makeMockEditor();
    const pattern = {};
    _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    editor._layers.push({ id: 'plain', name: 'Plain Layer', visible: true });

    expect(() => deleteLayerViaRealButton(editor, 'plain')).not.toThrow();
    expect(pattern.removedKinds).toBeUndefined();
    expect(editor._layers.some((l) => l.name === 'Rails')).toBe(true);
  });
});
