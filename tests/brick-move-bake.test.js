/**
 * F35 item 65 (Fred: moving / transforming bricks by hand in the editor did not update the 3D). MEASURED live: a
 * Select-tool move stores transform="matrix(1,0,0,1,dx,dy)" on the laid piece and leaves its `points` as laid, while
 * every brick reader (the height mask first) reads `points` -- the 3D kept the brick where it was laid. The one hook:
 * editor.js _notifyChange('commit') bakes a laid piece's transform into its points (layers.js bakeBrickTransforms),
 * and the gesture's own undo step is refreshed to match.
 */
import { describe, it, expect } from 'vitest';
import { bakeBrickTransforms } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
function layerWith(nodes) {
  const g = document.createElementNS(SVG_NS, 'g');
  for (const attrs of nodes) {
    const n = document.createElementNS(SVG_NS, attrs.tag || 'polygon');
    for (const [k, v] of Object.entries(attrs)) if (k !== 'tag') n.setAttribute(k, v);
    g.appendChild(n);
  }
  return g;
}
const pts = (n) => n.getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number));
const SQUARE = '0,0 1,0 1,1 0,1';

describe('bakeBrickTransforms: a laid piece keeps its moved place in its points', () => {
  it('a move (matrix translate) shifts the points and drops the transform', () => {
    const g = layerWith([{ 'data-brick-gen': '1', 'data-brick': 'wall', points: SQUARE, transform: 'matrix(1,0,0,1,0.5,0)' }]);
    expect(bakeBrickTransforms({ _sketchLayer: { node: g } })).toBe(1);
    const n = g.firstChild;
    expect(n.hasAttribute('transform')).toBe(false);
    expect(pts(n)).toEqual([[0.5, 0], [1.5, 0], [1.5, 1], [0.5, 1]]);
  });
  it('translate(x y) and a rotation matrix are baked the same way', () => {
    const g = layerWith([
      { 'data-brick-gen': '1', 'data-brick': 'frame', points: SQUARE, transform: 'translate(2 3)' },
      { 'data-brick-gen': '1', 'data-brick': 'brush', points: SQUARE, transform: 'matrix(0,1,-1,0,0,0)' }, // +90 deg
    ]);
    expect(bakeBrickTransforms({ _sketchLayer: { node: g } })).toBe(2);
    expect(pts(g.children[0])).toEqual([[2, 3], [3, 3], [3, 4], [2, 4]]);
    expect(pts(g.children[1]).map(([x, y]) => [Math.round(x * 1e9) / 1e9 + 0, Math.round(y * 1e9) / 1e9 + 0])).toEqual([[0, 0], [0, 1], [-1, 1], [-1, 0]]);
  });
  it('art, a Brush spine and an untransformed piece are left alone', () => {
    const g = layerWith([
      { points: SQUARE, transform: 'matrix(1,0,0,1,5,5)' }, // art
      { tag: 'line', 'data-brick': 'brush-spine', x1: 0, y1: 0, x2: 1, y2: 0, transform: 'translate(1 1)' },
      { 'data-brick-gen': '1', 'data-brick': 'wall', points: SQUARE },
    ]);
    expect(bakeBrickTransforms({ _sketchLayer: { node: g } })).toBe(0);
    expect(g.children[0].getAttribute('transform')).toBe('matrix(1,0,0,1,5,5)');
    expect(g.children[1].getAttribute('transform')).toBe('translate(1 1)');
    expect(g.children[2].getAttribute('points')).toBe(SQUARE);
  });
});

describe("the hook: editor.js _notifyChange('commit')", () => {
  function fakeEditor(g) {
    const snap = () => ({ svg: g.innerHTML, layers: [], activeLayer: null });
    const ed = {
      _sketchLayer: { node: g, children: () => { const a = []; a.toArray = () => a; return a; } },
      _layers: [], _undoStack: [], _redoStack: [], _snapshotState: snap, _onChange: null,
    };
    return ed;
  }
  it("a commit after a move bakes the piece and folds the bake into the gesture's own undo step", () => {
    const g = layerWith([{ 'data-brick-gen': '1', 'data-brick': 'wall', points: SQUARE, transform: 'matrix(1,0,0,1,0.5,0)' }]);
    const ed = fakeEditor(g);
    const pushed = ed._snapshotState(); // the move's own pushState, taken before the commit hooks
    ed._undoStack.push(pushed); ed._lastPushedState = pushed;
    VectorEditor.prototype._notifyChange.call(ed, 'commit');
    expect(g.firstChild.hasAttribute('transform')).toBe(false);
    expect(pts(g.firstChild)[0]).toEqual([0.5, 0]);
    expect(ed._undoStack).toHaveLength(1);
    expect(ed._undoStack[0].svg).not.toContain('transform');
    expect(ed._undoStack[0].svg).toContain('0.5,0');
  });
  it('a commit whose undo top is not its own step (after an undo) bakes but leaves the history alone', () => {
    const g = layerWith([{ 'data-brick-gen': '1', 'data-brick': 'wall', points: SQUARE, transform: 'matrix(1,0,0,1,0.5,0)' }]);
    const ed = fakeEditor(g);
    const older = { svg: '<older/>', layers: [], activeLayer: null };
    ed._undoStack.push(older); ed._lastPushedState = { svg: 'popped' };
    VectorEditor.prototype._notifyChange.call(ed, 'commit');
    expect(g.firstChild.hasAttribute('transform')).toBe(false);
    expect(ed._undoStack[0]).toBe(older);
  });
});
