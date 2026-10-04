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

import { runBricks, BRICK_KINDS, brushExclusions, dropExcludedWallBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
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

describe('turn 195: an engine throw keeps the previous bricks', () => {
  it('runBricks throws, and the wall/frame already on the canvas are untouched', () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null);
    const before = ed._sketchLayer.node.innerHTML;
    generateBricks.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(() => runBricks(ed, P.brickSettings, null)).toThrow('boom');
    expect(ed._sketchLayer.node.innerHTML).toBe(before);
  });
});

describe('F35 item 20: the Wall flows around brush strokes (exclusions)', () => {
  const brush = (ed, pts) => {
    const el = document.createElement('polygon');
    el.setAttribute('points', pts); el.setAttribute('data-brick-gen', '1'); el.setAttribute('data-brick', 'brush');
    ed._sketchLayer.node.appendChild(el);
  };
  it('brushExclusions: one polygon per brush brick, board inches; none without brush bricks', () => {
    const ed = fakeEditor();
    expect(brushExclusions(ed)).toEqual([]);
    brush(ed, '1,0 2,0 2,0.3 1,0.3');
    expect(brushExclusions(ed)).toEqual([{ polygon: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 0.3 }, { x: 1, y: 0.3 }] }]);
  });
  it('overlap = any overlap, not just the centre (measured live: a row 0.02 in off-centre stayed)', () => {
    // wall 4.28..4.48 vs brush 4.40..4.60 (the live numbers): centres outside each other, still overlapping
    const wall = { id: 'w', polygon: [{ x: 2.57, y: 4.28 }, { x: 3.32, y: 4.28 }, { x: 3.32, y: 4.48 }, { x: 2.57, y: 4.48 }] };
    const stroke = { polygon: [{ x: 2.48, y: 4.40 }, { x: 3.25, y: 4.40 }, { x: 3.25, y: 4.60 }, { x: 2.48, y: 4.60 }] };
    expect(dropExcludedWallBricks([wall], [stroke])).toEqual([]);
    // just touching nothing: a brick fully clear of the stroke stays
    const clear = { id: 'c', polygon: [{ x: 2.57, y: 4.0 }, { x: 3.32, y: 4.0 }, { x: 3.32, y: 4.2 }, { x: 2.57, y: 4.2 }] };
    expect(dropExcludedWallBricks([clear], [stroke])).toHaveLength(1);
  });
  it('the stub drops a wall piece whose centre is inside an exclusion, keeps the rest', () => {
    const sq = (x, id) => ({ id, polygon: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 1, y: 0.3 }, { x, y: 0.3 }] });
    const kept = dropExcludedWallBricks([sq(1, 'a'), sq(3, 'b')], [{ polygon: sq(0.9, 'x').polygon.map((p) => ({ x: p.x * 1.2, y: p.y * 1.5 })) }]);
    expect(kept.map((b) => b.id)).toEqual(['b']);
    expect(dropExcludedWallBricks([sq(1, 'a')], [])).toHaveLength(1);
  });
  it('a Wall lay with a brush stroke on the canvas: exclusions reach the engine, the covered piece is gone', () => {
    const ed = fakeEditor();
    brush(ed, '0.9,-0.1 2.1,-0.1 2.1,0.4 0.9,0.4'); // covers w1 (x 1..2)
    generateBricks.mockClear();
    runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    expect(generateBricks.mock.calls[0][0].exclusions).toHaveLength(1);
    expect(ids(ed, 'wall')).toEqual(['w2']);
  });
  it('the engine saying it applied them itself (exclusionsApplied) bypasses the stub', () => {
    const ed = fakeEditor();
    brush(ed, '0.9,-0.1 2.1,-0.1 2.1,0.4 0.9,0.4');
    const sq = (x, id) => ({ id, polygon: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 1, y: 0.3 }, { x, y: 0.3 }] });
    generateBricks.mockImplementationOnce(() => ({ bricks: [sq(1, 'w1'), sq(3, 'w2')], frameBricks: [], exclusionsApplied: true }));
    runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    expect(ids(ed, 'wall')).toEqual(['w1', 'w2']);
  });
});
