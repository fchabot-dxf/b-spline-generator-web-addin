/**
 * Audit C7 (Fred's Brick tab): switching carving off on the Bricks layer's own Layers row was silently
 * turned back on by the next Generate (applyBrickLayerTooling forced layer.carve = true). The layer's
 * carve is the user's toggle; a Generate keeps it. The brick-owned tooling (depth from Relief/Max
 * Height, flat profile) is still written on every run.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, generateBricks: vi.fn(() => ({ bricks: [], frameBricks: [] })) };
});

import { runBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const fakeEditor = (bricksLayer) => ({
  _mW: 7, _mH: 9, _activeLayer: '0',
  _layers: [{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Bricks', holdsBricks: true, visible: true, ...bricksLayer }],
  _sketchLayer: { node: { querySelectorAll: () => [] }, children: () => ({ toArray: () => [] }),
    group: () => { const api = { node: {}, attr: () => api, addClass: () => api, removeClass: () => api, hasClass: () => false }; return api; }, // item 22: element records
  },
});

describe('Generate keeps the Bricks layer carve toggle', () => {
  it('carving switched off on the layer row stays off after a Generate', () => {
    const editor = fakeEditor({ carve: false });
    runBricks(editor, P.brickSettings, null, { laidKey: 'K' });
    expect(editor._layers[1].carve).toBe(false);
  });
  it('carving on stays on', () => {
    const editor = fakeEditor({ carve: true });
    runBricks(editor, P.brickSettings, null, { laidKey: 'K' });
    expect(editor._layers[1].carve).toBe(true);
  });
  it('the brick-owned depth is still written from the settings (Carved = negative)', () => {
    const editor = fakeEditor({ carve: true, depth: 9 });
    runBricks(editor, { ...P.brickSettings, invert: true, reliefIn: 0.2 }, null);
    expect(editor._layers[1].depth).toBe(-0.2);
    expect(editor._layers[1].profile).toBe('flat');
  });
});
