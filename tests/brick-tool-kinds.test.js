/**
 * Audit C1 (F35 item 16, Wall and Frame as their own tools): runBricks lays ONLY the element kinds it
 * is given -- picking Wall never brings Frame bands and vice versa; kinds it was not given stay on the
 * canvas untouched. Default (no kinds) = both, the original behaviour. Real draw path (drawBrick /
 * clearGenerated) into a jsdom container; the composer is stubbed to 2 wall bricks + 1 frame brick.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  const sq = (x, id) => ({ id, polygon: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 1, y: 0.3 }, { x, y: 0.3 }] });
  return { ...actual, generateBricks: vi.fn(() => ({ bricks: [sq(1, 'w1'), sq(3, 'w2')], frameBricks: [sq(5, 'f1')] })) };
});

import { runBricks, BRICK_KINDS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

/** A minimal SVG.js-shaped sketch layer over a real DOM node (polygon(...) -> chainable element). */
function fakeEditor() {
  const node = document.createElement('div');
  const wrap = (el) => {
    const api = {
      node: el,
      fill: () => api, stroke: () => api,
      attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
      addClass: (c) => { el.classList.add(c); return api; },
      removeClass: (c) => { el.classList.remove(c); return api; },
      hasClass: (c) => el.classList.contains(c),
    };
    return api;
  };
  return {
    _mW: 7, _mH: 9, _activeLayer: '0',
    _layers: [{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Bricks', visible: true }],
    _sketchLayer: {
      node,
      polygon: (pts) => { const el = document.createElement('polygon'); el.setAttribute('points', pts); node.appendChild(el); return wrap(el); },
      children: () => ({ toArray: () => [] }),
    },
  };
}
const ids = (editor, kind) => [...editor._sketchLayer.node.querySelectorAll(`[data-brick="${kind}"]`)].map((n) => n.getAttribute('data-brick-id'));

describe('runBricks lays only the kinds it is given (audit C1)', () => {
  it('declares the two kinds', () => { expect(BRICK_KINDS).toEqual(['wall', 'frame']); });

  it('default = both kinds, as before', () => {
    const ed = fakeEditor();
    const counts = runBricks(ed, P.brickSettings, null);
    expect(ids(ed, 'wall')).toEqual(['w1', 'w2']);
    expect(ids(ed, 'frame')).toEqual(['f1']);
    expect(counts).toEqual({ wallCount: 2, frameCount: 1 });
  });

  it("['wall'] on a fresh board: wall only, no frame bands", () => {
    const ed = fakeEditor();
    const counts = runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    expect(ids(ed, 'wall')).toEqual(['w1', 'w2']);
    expect(ids(ed, 'frame')).toEqual([]);
    expect(counts).toEqual({ wallCount: 2, frameCount: 0 });
  });

  it("['frame'] re-lays the bands and leaves the existing wall exactly as it was", () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    const wallBefore = ed._sketchLayer.node.querySelector('[data-brick="wall"]');
    runBricks(ed, P.brickSettings, null, { kinds: ['frame'] });
    expect(ids(ed, 'frame')).toEqual(['f1']);
    expect(ids(ed, 'wall')).toEqual(['w1', 'w2']);
    expect(ed._sketchLayer.node.querySelector('[data-brick="wall"]')).toBe(wallBefore); // same node, not redrawn
  });

  it('re-laying a kind replaces its own previous bricks (no duplicates)', () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    expect(ids(ed, 'wall')).toEqual(['w1', 'w2']);
  });
});
