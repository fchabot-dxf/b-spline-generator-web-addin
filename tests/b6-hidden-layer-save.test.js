/**
 * B6 — regression guard: saving no longer drops a HIDDEN layer's geometry.
 *
 * Before the fix, `_visibleContent` stripped children whose `data-layer` was
 * a hidden layer before serializing — permanently losing that layer's
 * geometry on save/reopen (BUGS_OPEN B6). The current serializer
 * (`serializeEditor`, module-private in editor-io.js) takes the sketch
 * layer's innerHTML wholesale with no visibility filtering; visibility is
 * persisted separately in `data-editor-layers` and re-applied on reopen.
 * Exercised through `save()` (the only exported entry point) — no real
 * SVG.js instance needed, per its own docstring: the serializer only reads
 * `editor._sketchLayer.node.innerHTML`.
 */
import { describe, it, expect } from 'vitest';
import { save } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';

function mockEditor(innerHTML, layers) {
  return {
    _draw: {},
    _sketchLayer: { node: { innerHTML } },
    _mW: 7,
    _mH: 9,
    _layers: layers,
    _activeLayer: layers[0]?.id ?? null,
  };
}

describe('B6: save() keeps hidden-layer geometry', () => {
  it('a HIDDEN layer\'s child is still present in the saved SVG', () => {
    const innerHTML =
      '<path data-layer="0" d="M0 0 L1 1"/>' +   // visible layer
      '<path data-layer="1" d="M9 9 L8 8"/>';    // hidden layer
    const layers = [
      { id: '0', name: 'Layer 1', visible: true },
      { id: '1', name: 'Layer 2', visible: false },
    ];

    const out = save(mockEditor(innerHTML, layers));

    expect(out).toContain('M0 0 L1 1');
    expect(out).toContain('M9 9 L8 8'); // the hidden layer's geometry — the B6 assertion
  });

  it('the persisted data-editor-layers still records the layer as hidden (for reopen)', () => {
    const innerHTML = '<path data-layer="1" d="M9 9 L8 8"/>';
    const layers = [{ id: '1', name: 'Layer 2', visible: false }];

    const out = save(mockEditor(innerHTML, layers));

    // Visibility is tracked here, not by dropping geometry — both facts hold.
    // (The attribute value is XML-escaped, so the JSON quotes read as &quot;.)
    expect(out).toContain('data-editor-layers=');
    expect(out).toMatch(/&quot;visible&quot;:false/);
  });
});
