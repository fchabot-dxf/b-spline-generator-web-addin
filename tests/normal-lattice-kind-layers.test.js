import { describe, it, expect, beforeEach } from 'vitest';
import { emitSegment, emitNode } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';
import { _ensureKindLayers, LATTICE_KIND_LAYER_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

function makeMockEditor() {
  const elements = [];
  function makeEl(type, initial) {
    const store = { ...initial };
    const el = {
      type,
      node: { getAttribute: (k) => store[k] ?? null },
      attr(k, v) { if (v === undefined) return store[k]; store[k] = v; return el; },
      stroke(v) { if (v && typeof v === 'object') { if (v.color) store.stroke = v.color; if (v.width) store['stroke-width'] = v.width; } return el; },
      fill(v) { store.fill = v; return el; },
      center(x, y) { store.cx = x; store.cy = y; return el; },
      remove() { const i = elements.indexOf(el); if (i >= 0) elements.splice(i, 1); },
    };
    elements.push(el);
    return el;
  }
  return {
    _sketchLayer: {
      line(x1, y1, x2, y2) { return makeEl('line', { x1, y1, x2, y2 }); },
      circle(d) { return makeEl('circle', { r: d / 2 }); },
      children() { const a = elements.slice(); a.toArray = () => a; return a; },
    },
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    _nextLayerId: 1,
    _color: '#000',
    pushState() {},
    _notifyChange() {},
  };
}

describe('normal lattice kind layers separation', () => {
  it('splits pattern across Rails, Ties, and Nodes layers with correct tooling', () => {
    const editor = makeMockEditor();
    const pattern = { seed: 42 };
    const ids = _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);

    expect(ids.rails).toBeDefined();
    expect(ids.ties).toBeDefined();
    expect(ids.nodes).toBeDefined();

    const railsLayer = editor._layers.find((l) => l.id === ids.rails);
    const tiesLayer = editor._layers.find((l) => l.id === ids.ties);
    const nodesLayer = editor._layers.find((l) => l.id === ids.nodes);

    expect(railsLayer.name).toBe('Rails');
    expect(railsLayer.depth).toBe(0.15);
    expect(railsLayer.profile).toBe('vbit');
    expect(railsLayer.carve).toBe(false);

    expect(tiesLayer.name).toBe('Ties');
    expect(tiesLayer.depth).toBe(0.08);
    expect(tiesLayer.profile).toBe('vbit');

    expect(nodesLayer.name).toBe('Nodes');
    expect(nodesLayer.depth).toBe(0.12);
    expect(nodesLayer.profile).toBe('ballnose');
  });

  it('emitted segment receives data-layer of active kind layer', () => {
    const editor = makeMockEditor();
    const pattern = { seed: 42 };
    const ids = _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);

    editor._activeLayer = ids.rails;
    const railEl = emitSegment(editor, 'rail', { x: 0, y: 0 }, { x: 5, y: 0 }, 0.1);
    expect(railEl.attr('data-layer')).toBe(ids.rails);
    expect(railEl.attr('data-lattice')).toBe('rail');

    editor._activeLayer = ids.ties;
    const tieEl = emitSegment(editor, 'tie', { x: 2, y: -1 }, { x: 2, y: 1 }, 0.08);
    expect(tieEl.attr('data-layer')).toBe(ids.ties);
    expect(tieEl.attr('data-lattice')).toBe('tie');

    editor._activeLayer = ids.nodes;
    const nodeEl = emitNode(editor, { x: 2, y: 0 }, 0.06);
    expect(nodeEl.attr('data-layer')).toBe(ids.nodes);
    expect(nodeEl.attr('data-lattice')).toBe('node');
  });
});
