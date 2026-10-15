/**
 * editor-snap-resolver.js's IDLE-WARM snap targets (seat D 2026-10-14; the gate's blind row "Brush stroke": a 60 ms
 * task at POINTERDOWN, the press's first build). The targets are built in an idle slice and kept while nothing they read
 * changes; a press starts on them. The answers are the same as a fresh build, and never stale.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const COUNT = vi.hoisted(() => ({ getNodes: 0 }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-hit.js', async (orig) => {
  const m = await orig();
  return { ...m, getNodes: (el) => { COUNT.getNodes++; return m.getNodes(el); } };
});
import { geometrySnapTargets, nearestGeometrySnap, beginSnapGesture, endSnapGesture, watchSnapTargets, SNAP_WARM } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-snap-resolver.js';

const NS = 'http://www.w3.org/2000/svg';
// svg.js-shaped lines over REAL DOM nodes (the warm set watches the sketch layer's node)
function makeEditor() {
  const g = document.createElementNS(NS, 'g');
  document.body.appendChild(g);
  const list = [];
  return {
    _sketchLayer: { node: g, children: () => { const a = list.slice(); a.toArray = () => a; return a; } },
    _layers: [{ id: 'R' }], _activeLayer: 'R',
    line(x1, y1, x2, y2) {
      const node = document.createElementNS(NS, 'line');
      for (const [k, v] of Object.entries({ x1, y1, x2, y2, 'data-layer': 'R' })) node.setAttribute(k, String(v));
      g.appendChild(node);
      const el = { type: 'line', node, attr: (k) => { const v = node.getAttribute(k); return v != null && !Number.isNaN(Number(v)) ? Number(v) : v; } };
      list.push(el); return el;
    },
    list,
  };
}
const idle = () => new Promise((r) => setTimeout(r, SNAP_WARM.fallbackDelayMs + 50)); // happy-dom: no requestIdleCallback
const pts = (ts) => ts.map((t) => [t.x, t.y]);

let ed;
beforeEach(() => {
  document.body.innerHTML = '';
  ed = makeEditor();
  ed.line(0, 0, 4, 0); ed.line(2, -1, 2, 3); ed.line(0, 2, 4, 2);
  COUNT.getNodes = 0;
});

describe('the idle-warm snap targets', () => {
  it('once warm, a call builds nothing and answers exactly as a fresh build', async () => {
    const fresh = pts(geometrySnapTargets(ed));
    watchSnapTargets(ed);
    await idle();
    COUNT.getNodes = 0;
    expect(pts(geometrySnapTargets(ed))).toEqual(fresh);
    expect(COUNT.getNodes).toBe(0);
  });

  it('a press starts on them: its down and moves build nothing', async () => {
    watchSnapTargets(ed);
    await idle();
    COUNT.getNodes = 0;
    beginSnapGesture(ed);
    const hits = [0.1, 1.9, 3.95].map((x) => nearestGeometrySnap({ x, y: 0.05 }, ed, 0.2));
    endSnapGesture(ed);
    expect(COUNT.getNodes).toBe(0);
    expect(hits.every(Boolean)).toBe(true);
  });

  it('never stale: an element moved THIS tick, or a layer hidden, is read at once', async () => {
    watchSnapTargets(ed);
    await idle();
    ed.list[0].node.setAttribute('x2', '6'); // no await: the observer has not run yet
    expect(pts(geometrySnapTargets(ed))).toContainEqual([6, 0]);
    ed._layers[0].visible = false;
    expect(geometrySnapTargets(ed)).toEqual([]);
  });

  it('an excluded element (a drag) is never served from the warm set', async () => {
    watchSnapTargets(ed);
    await idle();
    COUNT.getNodes = 0;
    const t = geometrySnapTargets(ed, ed.list[0]);
    expect(COUNT.getNodes).toBe(2);
    expect(t.some((p) => p.el === ed.list[0])).toBe(false);
  });
});
