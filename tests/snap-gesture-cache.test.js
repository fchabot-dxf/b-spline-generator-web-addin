/**
 * editor-snap-resolver.js's SNAP GESTURE cache (seat A 2026-10-11, matrix blind row "Brush stroke": 390 px, CPU x4,
 * 62-217 ms frozen before its card; the profile named geometrySnapTargets -- getNodes over every sketch element on
 * the pointerdown AND each pointermove). Inside one press the targets are built once; the answers never change.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const COUNT = vi.hoisted(() => ({ getNodes: 0 }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-hit.js', async (orig) => {
  const m = await orig();
  return { ...m, getNodes: (el) => { COUNT.getNodes++; return m.getNodes(el); } };
});
import { geometrySnapTargets, nearestGeometrySnap, beginSnapGesture, endSnapGesture } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-snap-resolver.js';

// a minimal svg.js-shaped line (tests/cut-tool.test.js's shape) on a layer whose DOM node lists its children
function makeEditor() {
  const list = [];
  const editor = {
    _sketchLayer: {
      children: () => { const a = list.slice(); a.toArray = () => a; return a; },
      node: { get children() { return list.map((el) => el.node); } },
    },
    _layers: [{ id: 'R' }], _activeLayer: 'R',
    line(x1, y1, x2, y2) {
      const store = { x1, y1, x2, y2, 'data-layer': 'R' };
      const el = { type: 'line', store, node: { getAttribute: (k) => (store[k] !== undefined ? String(store[k]) : null), hasAttribute: (k) => store[k] !== undefined },
        attr(k) { return store[k]; } };
      list.push(el); return el;
    },
    list,
  };
  return editor;
}

let ed;
beforeEach(() => {
  ed = makeEditor();
  ed.line(0, 0, 4, 0); ed.line(2, -1, 2, 3); ed.line(0, 2, 4, 2);
  COUNT.getNodes = 0;
});

describe('the snap gesture cache', () => {
  it('outside a press: built on every call, as before', () => {
    geometrySnapTargets(ed); geometrySnapTargets(ed);
    expect(COUNT.getNodes).toBe(6);
  });

  it('inside a press: built ONCE across the down and every move, the same answers', () => {
    const plain = [0.1, 1.9, 3.95].map((x) => nearestGeometrySnap({ x, y: 0.05 }, ed, 0.2));
    COUNT.getNodes = 0;
    beginSnapGesture(ed);
    const cached = [0.1, 1.9, 3.95].map((x) => nearestGeometrySnap({ x, y: 0.05 }, ed, 0.2));
    expect(COUNT.getNodes).toBe(3);
    expect(cached).toEqual(plain);
    endSnapGesture(ed);
    geometrySnapTargets(ed);
    expect(COUNT.getNodes).toBe(6); // the press ended: nothing kept
  });

  it('an element added mid-press, or another excluded element, rebuilds -- never a stale target', () => {
    beginSnapGesture(ed);
    const before = geometrySnapTargets(ed);
    const added = ed.line(10, 10, 12, 10);
    const after = geometrySnapTargets(ed);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContainEqual({ x: 12, y: 10 });
    expect(geometrySnapTargets(ed, added)).not.toContainEqual({ x: 12, y: 10 });
    endSnapGesture(ed);
  });

  it('a layer with no DOM node is never cached', () => {
    delete ed._sketchLayer.node;
    beginSnapGesture(ed);
    geometrySnapTargets(ed); geometrySnapTargets(ed);
    expect(COUNT.getNodes).toBe(6);
    endSnapGesture(ed);
  });
});
