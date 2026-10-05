/**
 * Audit B1-B3 (Fred's Brick tab): the settings the Wall/Frame bricks were laid with live ON the
 * Bricks layer (`brickLaidKey`), so undo/redo, Cancel and reload all carry them.
 * - runBricks stamps the key BEFORE its undo commit (so the snapshot that commit pushes holds it);
 * - editor-io.js persists it in data-editor-layers (so a reload still knows it).
 * Panel-side behaviour (pending derived from it, Cancel restoring settings) is in
 * brick-discrete-controls-regen.test.js.
 */
import { describe, it, expect, vi } from 'vitest';

let keyAtCommit = 'never committed';
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({
  commitEdit: vi.fn((editor) => { keyAtCommit = editor._layers.find((l) => l.name === 'Bricks')?.brickLaidKey; }),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, generateBricks: vi.fn(() => ({ bricks: [], frameBricks: [] })) };
});

import { runBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { save } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

function fakeEditor() {
  return {
    _mW: 7, _mH: 9,
    _activeLayer: '0',
    _layers: [{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Bricks', holdsBricks: true, visible: true }],
    _sketchLayer: { node: { querySelectorAll: () => [], innerHTML: '' }, children: () => ({ toArray: () => [] }),
      group: () => { const api = { node: {}, attr: () => api, addClass: () => api, removeClass: () => api, hasClass: () => false }; return api; }, // item 22: element records
  },
  };
}

describe('runBricks stamps the laid key on the Bricks layer', () => {
  it('before its undo commit, so the pushed snapshot holds it', () => {
    const editor = fakeEditor();
    runBricks(editor, P.brickSettings, null, { laidKey: 'K1' });
    expect(keyAtCommit).toBe('K1');
    expect(editor._layers[1].brickLaidKey).toBe('K1');
  });
  it('without a laidKey (live preview paths) leaves the layer key alone', () => {
    const editor = fakeEditor();
    editor._layers[1].brickLaidKey = 'OLD';
    runBricks(editor, P.brickSettings, null);
    expect(editor._layers[1].brickLaidKey).toBe('OLD');
  });
});

describe('the laid key survives save -> reload (data-editor-layers)', () => {
  it('is written into the persisted layer roster', () => {
    const editor = { _draw: {}, _sketchLayer: { node: { innerHTML: '' } }, _mW: 7, _mH: 9, _activeLayer: '1',
      _layers: [{ id: '1', name: 'Bricks', holdsBricks: true, visible: true, brickLaidKey: '{"pattern":"herringbone"}' }] };
    const out = save(editor);
    expect(out).toMatch(/&quot;brickLaidKey&quot;:&quot;\{\\&quot;pattern\\&quot;:\\&quot;herringbone\\&quot;\}&quot;/);
  });
  it('a layer that never laid bricks has no key field', () => {
    const editor = { _draw: {}, _sketchLayer: { node: { innerHTML: '' } }, _mW: 7, _mH: 9, _activeLayer: '0',
      _layers: [{ id: '0', name: 'Layer 1', visible: true }] };
    expect(save(editor)).not.toMatch(/brickLaidKey/);
  });
});
