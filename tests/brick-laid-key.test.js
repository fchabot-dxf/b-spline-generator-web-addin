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
  // item 22 step 3: the key lives on each laid element's RECORD
  commitEdit: vi.fn((editor) => { keyAtCommit = editor._sketchLayer.node.querySelector('[data-brick-record="wall-full"]')?.getAttribute('data-brick-laid'); }),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, generateBricks: vi.fn(() => ({ bricks: [], frameBricks: [] })) };
});

import { runBricks, brickRecordNode, BRICK_LAID_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { save } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

function fakeEditor() {
  const node = document.createElement('div');
  const wrap = (el) => { const api = { node: el, attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
    addClass: (c) => { el.classList.add(c); return api; }, removeClass: (c) => { el.classList.remove(c); return api; }, hasClass: (c) => el.classList.contains(c) }; return api; };
  return {
    _draw: {}, _mW: 7, _mH: 9,
    _activeLayer: '0',
    _layers: [{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Bricks', holdsBricks: true, visible: true }],
    _sketchLayer: { node, children: () => ({ toArray: () => [] }),
      group: () => { const el = document.createElementNS('http://www.w3.org/2000/svg', 'g'); node.appendChild(el); return wrap(el); } },
  };
}

describe('runBricks stamps the laid key on each laid ELEMENT (item 22 step 3)', () => {
  it('before its undo commit, so the pushed snapshot holds it -- on every laid element, not on the layer', () => {
    const editor = fakeEditor();
    runBricks(editor, P.brickSettings, null, { laidKey: 'K1' });
    expect(keyAtCommit).toBe('K1');
    expect(brickRecordNode(editor, 'wall').getAttribute(BRICK_LAID_ATTR)).toBe('K1');
    expect(brickRecordNode(editor, 'frame').getAttribute(BRICK_LAID_ATTR)).toBe('K1');
    expect(editor._layers[1].brickLaidKey).toBeUndefined(); // no shared layer key any more
  });
  it('a lay of ONE element re-keys only that element', () => {
    const editor = fakeEditor();
    runBricks(editor, P.brickSettings, null, { laidKey: 'K1' });
    runBricks(editor, P.brickSettings, null, { laidKey: 'K2', kinds: ['frame'] });
    expect(brickRecordNode(editor, 'frame').getAttribute(BRICK_LAID_ATTR)).toBe('K2');
    expect(brickRecordNode(editor, 'wall').getAttribute(BRICK_LAID_ATTR)).toBe('K1');
  });
  it('without a laidKey (live preview paths) leaves the keys of the elements alone', () => {
    const editor = fakeEditor();
    runBricks(editor, P.brickSettings, null, { laidKey: 'OLD' });
    runBricks(editor, P.brickSettings, null);
    expect(brickRecordNode(editor, 'wall').getAttribute(BRICK_LAID_ATTR)).toBe('OLD');
  });
  it('the key is saved with the drawing (the record is part of it)', () => {
    const editor = fakeEditor();
    runBricks(editor, P.brickSettings, null, { laidKey: 'K9' });
    expect(save(editor)).toContain('data-brick-laid="K9"');
  });
});

describe('the shared layer key is RETIRED (item 22 step 5): records carry the keys; old boards migrate on load', () => {
  it('a layer still holding an old key does not write it back into the roster', () => {
    const editor = { _draw: {}, _sketchLayer: { node: { innerHTML: '' } }, _mW: 7, _mH: 9, _activeLayer: '1',
      _layers: [{ id: '1', name: 'Bricks', holdsBricks: true, visible: true, brickLaidKey: '{"pattern":"herringbone"}' }] };
    const out = save(editor);
    expect(out).not.toMatch(/brickLaidKey/); // item 22 step 5: the shared key is retired
  });
  it('a layer that never laid bricks has no key field', () => {
    const editor = { _draw: {}, _sketchLayer: { node: { innerHTML: '' } }, _mW: 7, _mH: 9, _activeLayer: '0',
      _layers: [{ id: '0', name: 'Layer 1', visible: true }] };
    expect(save(editor)).not.toMatch(/brickLaidKey/);
  });
});
