/**
 * Feature types on screen (owner 2026-11-27): Vector (code: draw / artwork), Pixel (code: height), Mesh (code: stl), Lattice,
 * Bricks. Words only: ids, stored keys and tab ids are unchanged. A NEW item is named by its type; a SAVED name is kept.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LAYER_TYPES } from '../bspline-frame-builder/b-spline-gen/html/main/layer-stack.js';
import { EDITOR_TABS } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { typedLayerName } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { newHeightLayer, normaliseHeightLayer } from '../bspline-frame-builder/b-spline-gen/html/core/height/layer.js';
import { createStlLayer } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const tab = (id) => EDITOR_TABS.find((t) => t.id === id);

describe('type names on screen', () => {
  it('the stack\'s type labels (and the tabs they open) read Vector / Pixel / Mesh', () => {
    expect(LAYER_TYPES.draw).toMatchObject({ label: 'Vector', tabLabel: 'Vector' });
    expect(LAYER_TYPES.height).toMatchObject({ label: 'Pixel', tabLabel: 'Pixel' });
    expect(LAYER_TYPES.stl.label).toBe('Mesh');
    expect(LAYER_TYPES.lattice.label).toBe('Lattice');
  });
  it('the editor tab labels and the tab strip buttons read Vector / Pixel / Mesh, ids kept', () => {
    expect(tab('artwork').label).toBe('Vector');
    expect(tab('height').label).toBe('Pixel');
    expect(tab('stl').label).toBe('Mesh');
    expect(HTML).toMatch(/id="editorTabArtwork"[^>]*>Vector</);
    expect(HTML).toMatch(/id="editorTabHeight"[^>]*>Pixel</);
  });
  it('the Surface STL panel is the Mesh settings', () => {
    expect(HTML).toContain('MESH SETTINGS');
    expect(HTML).not.toContain('STL STAMP');
  });
});

describe('new items are named by type; saved names stay', () => {
  it('a new drawing layer is Vector 1, a new Pixel patch starts Pixel, a nameless Mesh is Mesh', async () => {
    expect(typedLayerName([])).toBe('Vector 1');
    expect(typedLayerName([{ name: 'Vector 1' }])).toBe('Vector 2');
    expect((await newHeightLayer({ widthIn: 2, heightIn: 2 })).name).toBe('Pixel');
    const soup = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 1]);
    expect(createStlLayer({ soup, board: { widthIn: 2, heightIn: 2 } }).record.name).toBe('Mesh');
    expect(typedLayerName([], 'Mesh')).toBe('Mesh 1');
  });
  it('a saved board keeps its stored names', async () => {
    const rec = await newHeightLayer({ widthIn: 2, heightIn: 2 }, 'Height 1');
    expect(normaliseHeightLayer(rec).name).toBe('Height 1');
    expect(LAYER_TYPES.height.name({ ref: { name: 'Height 1' } })).toBe('Height 1');
    expect(LAYER_TYPES.stl.name({ ref: { name: 'STL' } })).toBe('STL');
    expect(LAYER_TYPES.draw.name({ ref: { name: 'Layer 1' } })).toBe('Layer 1');
  });
});
