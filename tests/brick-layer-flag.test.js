/**
 * F35 item 22 slice 1 (advisor: option B): a layer HOLDS the bricks by a declared, persisted flag
 * (`holdsBricks`), never by its name -- the 'Bricks' NAME special case is retired. The name stays only as the
 * default a new brick layer gets, and as the migration of a board saved before the flag (the one place it is
 * read).
 */
import { describe, it, expect } from 'vitest';
import {
  isBricksLayer, bricksLayerOf, migrateLegacyBricksLayer, addLayer, BRICKS_LAYER_NAME,
} from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { save } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';

describe('item 22 slice 1: the brick layer is declared, not named', () => {
  it('the flag decides -- a layer merely NAMED "Bricks" is an ordinary layer; a renamed brick layer still is one', () => {
    expect(isBricksLayer({ name: 'Bricks' })).toBe(false);
    expect(isBricksLayer({ name: 'Mortar', holdsBricks: true })).toBe(true);
    const editor = { _layers: [{ id: '0', name: 'Bricks' }, { id: '1', name: 'Wall stuff', holdsBricks: true }] };
    expect(bricksLayerOf(editor).id).toBe('1');
    expect(bricksLayerOf({ _layers: [{ id: '0', name: 'Layer 1' }] })).toBeNull();
  });

  it('addLayer({holdsBricks}) declares it (a new brick layer keeps the default name)', () => {
    const editor = { _layers: [], _activeLayer: null };
    const layer = addLayer(editor, { name: BRICKS_LAYER_NAME, holdsBricks: true, skipUndo: true });
    expect(layer.holdsBricks).toBe(true);
    expect(addLayer(editor, { name: 'Art', skipUndo: true }).holdsBricks).toBeUndefined();
  });

  it('migration: a board saved before the flag -> its "Bricks" layer becomes the brick layer; nothing else changes', () => {
    expect(migrateLegacyBricksLayer({ name: 'Bricks' }).holdsBricks).toBe(true);
    expect(migrateLegacyBricksLayer({ name: 'Layer 1' }).holdsBricks).toBeUndefined();
    // an explicit flag always wins (a user's own layer called "Bricks" saved AFTER the flag existed)
    expect(migrateLegacyBricksLayer({ name: 'Bricks', holdsBricks: false }).holdsBricks).toBe(false);
  });

  it('the flag is saved with the layer roster (reload keeps it, renamed or not)', () => {
    const out = save({ _draw: {}, _sketchLayer: { node: { innerHTML: '' } }, _mW: 7, _mH: 9,
      _layers: [{ id: '1', name: 'Mortar', visible: true, holdsBricks: true }], _activeLayer: '1' });
    expect(out).toMatch(/&quot;holdsBricks&quot;:true/);
  });
});
