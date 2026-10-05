/**
 * Bricks re-laid onto a HIDDEN Bricks layer showed on the canvas while the layer still said hidden
 * (measured live: 0/329 shown after Hide, 329/329 after a re-lay): new elements never got the layer's
 * classes until the next full applyLayerState. Every brick-tool draw now joins the layer through one
 * helper that also applies its state (editor-brick-tool.js onBricksLayer -> layers.js applyLayerStateTo).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  const brick = (id) => ({ id, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.3 }], sampleId: '', flip: false });
  return { ...actual, generateBricks: vi.fn(() => ({ bricks: [brick(1), brick(2)], frameBricks: [brick(3)] })) };
});

import { runBricks, runBricksOutlinePreview } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { applyLayerStateTo } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

function fakeEditor({ bricksVisible }) {
  const elements = [];
  const make = () => {
    const el = { _attrs: {}, _classes: new Set(),
      attr(k, ...r) { if (!r.length) return el._attrs[k]; el._attrs[k] = r[0]; return el; },
      fill() { return el; }, stroke() { return el; },
      addClass(c) { el._classes.add(c); return el; }, removeClass(c) { el._classes.delete(c); return el; } };
    elements.push(el);
    return el;
  };
  return {
    elements,
    _mW: 7, _mH: 9, _activeLayer: '0',
    _layers: [{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Bricks', holdsBricks: true, visible: bricksVisible }],
    _sketchLayer: { polygon: make, line: make, group: make, node: { querySelectorAll: () => [] }, children: () => ({ toArray: () => elements, forEach: (f) => elements.forEach(f) }) },
  };
}
const hidden = (el) => el._classes.has('layer-hidden');

describe('bricks drawn onto the Bricks layer take its current state', () => {
  it('a hidden Bricks layer: every newly laid brick is hidden', () => {
    const ed = fakeEditor({ bricksVisible: false });
    runBricks(ed, P.brickSettings, null);
    expect(ed.elements.filter((e) => e._attrs['data-brick']).length).toBe(3); // the bricks (item 22's records aside)
    expect(ed.elements.every(hidden)).toBe(true);
  });
  it('a visible Bricks layer: none hidden', () => {
    const ed = fakeEditor({ bricksVisible: true });
    runBricks(ed, P.brickSettings, null);
    expect(ed.elements.some(hidden)).toBe(false);
  });
  it('the slow-drag outline preview follows the same rule', () => {
    const ed = fakeEditor({ bricksVisible: false });
    runBricksOutlinePreview(ed);
    expect(ed.elements.length).toBe(1);
    expect(hidden(ed.elements[0])).toBe(true);
  });
  it('the Bricks layer is not the active one: new bricks are dimmed like the rest of it (inactive-layer)', () => {
    const ed = fakeEditor({ bricksVisible: true });
    runBricks(ed, P.brickSettings, null);
    expect(ed.elements.every((e) => e._classes.has('inactive-layer'))).toBe(true);
  });
});

describe('applyLayerStateTo (one element) matches the full applyLayerState rule', () => {
  it('unhiding the layer then re-applying shows the element', () => {
    const ed = fakeEditor({ bricksVisible: false });
    runBricks(ed, P.brickSettings, null);
    ed._layers[1].visible = true;
    applyLayerStateTo(ed, ed.elements[0]);
    expect(hidden(ed.elements[0])).toBe(false);
  });
});
