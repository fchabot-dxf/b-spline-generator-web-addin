/**
 * SE7b slice 2 — generatePattern: the DOM-touching half of SE7b, layered
 * on top of slice 1's pure computePattern. Uses a lightweight in-memory
 * sketch-layer mock (same idea as tests/editor-lattice.test.js's
 * mockSketchLayer / mockEditorForEmit, extended to support real
 * addLayer/setActiveLayer/emitSegment/emitNode round-tripping through
 * attr()/remove(), since generatePattern calls all of those for real —
 * not reimplemented here).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { generatePattern, detachAllOwned, detachOwnership, OWNERSHIP_ATTR, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { save } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';

function _makeMockEditor() {
  let elements = [];

  function makeElement(initial) {
    const store = { ...initial };
    const el = {
      node: {
        getAttribute: (k) => (store[k] !== undefined ? store[k] : null),
        hasAttribute: (k) => store[k] !== undefined,
      },
      attr(k, ...rest) {
        if (rest.length === 0) return store[k]; // getter: .attr('x1')
        const v = rest[0];
        if (v === null || v === undefined) delete store[k]; // setter clearing: .attr('x1', null) — "remove"
        else store[k] = v;
        return el;
      },
      stroke() { return el; },
      fill() { return el; },
      center(x, y) { store.cx = x; store.cy = y; return el; },
      addClass() { return el; },
      removeClass() { return el; },
      hasClass() { return false; },
      remove() { elements = elements.filter((e) => e !== el); },
    };
    return el;
  }

  const sketchLayer = {
    line(x1, y1, x2, y2) {
      const el = makeElement({ x1, y1, x2, y2 });
      elements.push(el);
      return el;
    },
    circle(d) {
      const el = makeElement({ r: d / 2 });
      elements.push(el);
      return el;
    },
    children() {
      const arr = elements.slice();
      arr.toArray = () => arr;
      return arr;
    },
    node: {}, // applyLayerState's early-return checks editor._sketchLayer truthiness only
  };

  const editor = {
    _mW: 4, _mH: 4,
    _sketchLayer: sketchLayer,
    _layers: [],
    _activeLayer: null,
    _strokeColor: '#000', _fillColor: '#000', _strokeWidth: 0.02,
    _selectedElements: [],
    pushStateCalls: 0,
    notifyChangeCalls: [],
    pushState() { editor.pushStateCalls++; },
    _notifyChange(kind) { editor.notifyChangeCalls.push(kind); },
  };
  return editor;
}

describe('generatePattern: first Generate', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  it('creates exactly 3 layers (Rails/Ties/Nodes) and stores their ids in PATTERN.layers', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 1, ties: { ...PATTERN_DEFAULTS.ties, density: 0.5 } };
    generatePattern(editor, pattern);

    expect(editor._layers).toHaveLength(3);
    const names = editor._layers.map((l) => l.name).sort();
    expect(names).toEqual(['Nodes', 'Rails', 'Ties']);
    expect(pattern.layers.rails).toBeDefined();
    expect(pattern.layers.ties).toBeDefined();
    expect(pattern.layers.nodes).toBeDefined();
    expect(editor._layers.some((l) => l.id === pattern.layers.rails)).toBe(true);
  });

  it('assigns PATTERN.id when absent, and every emitted element carries both data-lattice and the ownership tag', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 2, ties: { ...PATTERN_DEFAULTS.ties, density: 0.5 } };
    expect(pattern.id).toBeUndefined();
    const { segments, nodePoints } = generatePattern(editor, pattern);
    expect(pattern.id).toBeTruthy();

    const emittedRailsAndTies = editor._sketchLayer.children().filter((el) => el.attr('x1') !== undefined);
    expect(emittedRailsAndTies.length).toBe(segments.length);
    for (const el of emittedRailsAndTies) {
      expect(el.attr('data-lattice')).toMatch(/rail|tie/);
      expect(el.attr(OWNERSHIP_ATTR)).toBe(pattern.id);
    }
    const emittedNodes = editor._sketchLayer.children().filter((el) => el.attr('r') !== undefined);
    expect(emittedNodes.length).toBe(nodePoints.length);
    for (const el of emittedNodes) {
      expect(el.attr('data-lattice')).toBe('node');
      expect(el.attr(OWNERSHIP_ATTR)).toBe(pattern.id);
    }
  });

  it('rails land on the Rails layer, ties on Ties, nodes on Nodes (data-layer matches the right id)', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 3, rails: { every: 2, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 1 } };
    generatePattern(editor, pattern);
    const rails = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'rail');
    const ties = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'tie');
    const nodes = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'node');
    expect(rails.length).toBeGreaterThan(0);
    for (const el of rails) expect(el.attr('data-layer')).toBe(pattern.layers.rails);
    for (const el of ties) expect(el.attr('data-layer')).toBe(pattern.layers.ties);
    for (const el of nodes) expect(el.attr('data-layer')).toBe(pattern.layers.nodes);
  });

  it('is exactly ONE undo step: pushState called once, notifyChange("commit") called once, regardless of element count', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 4, ties: { ...PATTERN_DEFAULTS.ties, density: 1 } };
    generatePattern(editor, pattern);
    expect(editor.pushStateCalls).toBe(1);
    expect(editor.notifyChangeCalls).toEqual(['commit']);
  });

  it('stashes the pattern onto editor._latticePattern for persistence', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 5 };
    generatePattern(editor, pattern);
    expect(editor._latticePattern).toBe(pattern);
  });
});

describe('generatePattern: Regenerate (same PATTERN.id)', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  it('produces byte-identical geometry to the first Generate when nothing changed', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 6, ties: { ...PATTERN_DEFAULTS.ties, density: 0.6 } };
    const first = generatePattern(editor, pattern);
    const second = generatePattern(editor, pattern);
    expect(second.segments).toEqual(first.segments);
    expect(second.nodePoints).toEqual(first.nodePoints);
    // still exactly 3 layers — reused, not duplicated
    expect(editor._layers).toHaveLength(3);
  });

  it('reuses the SAME 3 layer ids across Regenerate, not new ones', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 7 };
    generatePattern(editor, pattern);
    const idsBefore = { ...pattern.layers };
    generatePattern(editor, pattern);
    expect(pattern.layers).toEqual(idsBefore);
  });

  it("does NOT touch hand-drawn content lacking data-lattice at all", () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 8 };
    generatePattern(editor, pattern);
    // Simulate a hand-drawn SE7a-unrelated shape (e.g. drawn with the pen
    // tool) sitting in the sketch layer — no data-lattice attribute.
    const handDrawn = editor._sketchLayer.line(0, 0, 1, 1);
    handDrawn.attr('data-layer', pattern.layers.rails);
    // no data-lattice, no ownership tag — a plain drawn line

    generatePattern(editor, pattern);
    expect(editor._sketchLayer.children()).toContain(handDrawn);
  });

  it('a detached tie (data-lattice="tie", ownership tag removed) is left completely untouched by Regenerate', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 9, ties: { ...PATTERN_DEFAULTS.ties, density: 1, columns: [1] } };
    generatePattern(editor, pattern);
    const tie = editor._sketchLayer.children().find((el) => el.attr('data-lattice') === 'tie');
    expect(tie).toBeDefined();
    // Simulate the handleEnd detach hook (slice 3): strip ownership.
    tie.attr(OWNERSHIP_ATTR, undefined);
    const attrsBefore = { x1: tie.attr('x1'), y1: tie.attr('y1'), x2: tie.attr('x2'), y2: tie.attr('y2') };

    generatePattern(editor, pattern);

    expect(editor._sketchLayer.children()).toContain(tie); // same element, not removed
    expect({ x1: tie.attr('x1'), y1: tie.attr('y1'), x2: tie.attr('x2'), y2: tie.attr('y2') }).toEqual(attrsBefore);
  });

  it('SA-LAYER-1-style regression guard: a detached tie at a given column blocks Regenerate from placing a fresh tie at the SAME start cell', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 10, ties: { ...PATTERN_DEFAULTS.ties, density: 1, columns: [3] } };
    generatePattern(editor, pattern);
    const tie = editor._sketchLayer.children().find((el) => el.attr('data-lattice') === 'tie');
    const detachedStart = { x1: tie.attr('x1'), y1: tie.attr('y1') };
    tie.attr(OWNERSHIP_ATTR, undefined); // detach

    generatePattern(editor, pattern);

    const tiesNow = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'tie');
    // Exactly the one detached tie remains at that start cell — Regenerate
    // did not ALSO place a fresh, newly-owned tie starting at the same spot.
    const atSameStart = tiesNow.filter((el) => el.attr('x1') === detachedStart.x1 && el.attr('y1') === detachedStart.y1);
    expect(atSameStart).toHaveLength(1);
    expect(atSameStart[0].attr(OWNERSHIP_ATTR)).toBeUndefined(); // still detached, not re-owned
  });
});

describe('data-lattice-pattern persistence (editor-io.js)', () => {
  // save()'s own lightweight mock shape, matching tests/b6-hidden-layer-
  // save.test.js exactly (save() only reads _draw/_sketchLayer.node.
  // innerHTML/_mW/_mH/_layers/_activeLayer — no svg.js instance needed,
  // per that file's own docstring).
  function mockSaveEditor(latticePattern) {
    return {
      _draw: {},
      _sketchLayer: { node: { innerHTML: '' } },
      _mW: 7, _mH: 9,
      _layers: [],
      _activeLayer: null,
      _latticePattern: latticePattern,
    };
  }

  it('save() writes data-lattice-pattern when editor._latticePattern is set', () => {
    const pattern = { ...PATTERN_DEFAULTS, id: 'lattice-1', seed: 3, layers: { rails: '0', ties: '1', nodes: '2' } };
    const out = save(mockSaveEditor(pattern));
    expect(out).toContain('data-lattice-pattern=');
    // XML-escaped like data-editor-layers (same _serialize*/entity pattern) —
    // the JSON quotes read back as &quot;.
    expect(out).toMatch(/&quot;id&quot;:&quot;lattice-1&quot;/);
  });

  it('save() writes nothing (no attribute at all) when no pattern has been generated', () => {
    const out = save(mockSaveEditor(null));
    expect(out).not.toContain('data-lattice-pattern');
  });

  it('the exact save() -> DOM round trip open() relies on: getAttribute + JSON.parse recovers the same PATTERN', () => {
    // Exercises the real encoding (_serializeLatticePatternAttr's escape)
    // against the real decoding (open()'s getAttribute+JSON.parse) via an
    // actual DOMParser — the same two-sided contract data-editor-layers
    // already relies on, proven directly rather than assumed symmetric.
    // (A full open()-level integration test would need the same heavy
    // clear()/svg()/setModelMetrics editor mock this suite doesn't build
    // anywhere yet — out of scope to construct fresh in this slice; this
    // targets the actual encode/decode contract precisely instead.)
    const pattern = { id: 'lattice-2', seed: 9, layers: { rails: 'r', ties: 't', nodes: 'n' } };
    const savedSvg = save(mockSaveEditor(pattern));

    const parsed = new DOMParser().parseFromString(savedSvg, 'image/svg+xml');
    const svgEl = parsed.querySelector('svg');
    const raw = svgEl.getAttribute('data-lattice-pattern');
    expect(raw).toBeTruthy();
    const restored = JSON.parse(raw);
    expect(restored).toEqual(pattern);
  });
});

describe('detachOwnership: the shared strip-the-tag primitive (T21 slice 3)', () => {
  function ownedEl(id) {
    const store = { [OWNERSHIP_ATTR]: id };
    return { attr: (k, ...rest) => (rest.length ? (rest[0] == null ? (delete store[k], undefined) : (store[k] = rest[0])) : store[k]) };
  }

  it('strips the ownership attribute from every element that carries it', () => {
    const a = ownedEl('lattice-1');
    const b = ownedEl('lattice-1');
    const count = detachOwnership([a, b]);
    expect(count).toBe(2);
    expect(a.attr(OWNERSHIP_ATTR)).toBeUndefined();
    expect(b.attr(OWNERSHIP_ATTR)).toBeUndefined();
  });

  it('leaves an element with no ownership tag alone (count 0 for it)', () => {
    const unowned = { attr: () => undefined };
    expect(detachOwnership([unowned])).toBe(0);
  });

  it('tolerates a mixed batch (some owned, some not) and null/undefined entries', () => {
    const owned = ownedEl('lattice-1');
    const unowned = { attr: () => undefined };
    expect(detachOwnership([owned, unowned, null, undefined])).toBe(1);
    expect(owned.attr(OWNERSHIP_ATTR)).toBeUndefined();
  });

  it('handles an empty or missing list without throwing', () => {
    expect(detachOwnership([])).toBe(0);
    expect(detachOwnership(undefined)).toBe(0);
  });
});

describe('detachAllOwned: the bulk "Detach all" panel action', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  it('strips ownership from every element owned by the given pattern id, leaves others alone', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 20, ties: { ...PATTERN_DEFAULTS.ties, density: 1 } };
    generatePattern(editor, pattern);
    const ownedBefore = editor._sketchLayer.children().filter((el) => el.attr(OWNERSHIP_ATTR) === pattern.id);
    expect(ownedBefore.length).toBeGreaterThan(0); // sanity — Generate must have actually made owned content

    const count = detachAllOwned(editor, pattern.id);

    expect(count).toBe(ownedBefore.length);
    const stillOwned = editor._sketchLayer.children().filter((el) => el.attr(OWNERSHIP_ATTR) === pattern.id);
    expect(stillOwned).toHaveLength(0);
    // nothing was removed or moved — same element count, same geometry
    expect(editor._sketchLayer.children()).toHaveLength(ownedBefore.length);
  });

  it('is exactly one undo step (not one per detached element)', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 21, ties: { ...PATTERN_DEFAULTS.ties, density: 1 } };
    generatePattern(editor, pattern);
    editor.pushStateCalls = 0;
    editor.notifyChangeCalls = [];

    detachAllOwned(editor, pattern.id);

    expect(editor.pushStateCalls).toBe(1);
    expect(editor.notifyChangeCalls).toEqual(['commit']);
  });

  it('does nothing (no undo push) when nothing is owned', () => {
    const count = detachAllOwned(editor, 'lattice-nonexistent');
    expect(count).toBe(0);
    expect(editor.pushStateCalls).toBe(0);
    expect(editor.notifyChangeCalls).toEqual([]);
  });
});

describe('generatePattern: restores the previously-active layer (T20/T21 note)', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  it('restores the layer that was active before Generate, not left on Nodes', () => {
    // First Generate creates the 3 layers; second Generate simulates the
    // user having switched to a DIFFERENT (non-pattern) layer in between.
    const pattern = { ...PATTERN_DEFAULTS, seed: 22 };
    generatePattern(editor, pattern);
    const userLayer = { id: 'user-layer-1', name: 'My Drawing', visible: true };
    editor._layers.push(userLayer);
    editor._activeLayer = userLayer.id;

    generatePattern(editor, pattern); // Regenerate

    expect(editor._activeLayer).toBe(userLayer.id);
  });

  it('a first Generate on a totally fresh editor (no previous active layer) is left on Nodes, not forced to null', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 23 };
    expect(editor._activeLayer).toBeNull();

    generatePattern(editor, pattern);

    expect(editor._activeLayer).toBe(pattern.layers.nodes);
    expect(editor._activeLayer).not.toBeNull();
  });
});

describe('PATTERN.margin (SE7c): the board extent is inset so nothing sits on the edge', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); }); // _mW = 4, _mH = 4

  it('with the default margin (1), no rail/tie endpoint or node centre sits at x/y = 0 or the board size', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 24, rails: { every: 2, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, density: 1 } };
    generatePattern(editor, pattern);

    const segments = editor._sketchLayer.children().filter((el) => el.attr('x1') !== undefined);
    expect(segments.length).toBeGreaterThan(0); // non-vacuous: there IS content to check
    for (const el of segments) {
      for (const attr of ['x1', 'y1', 'x2', 'y2']) {
        expect(el.attr(attr)).not.toBe(0);
        expect(el.attr(attr)).not.toBe(editor._mW); // mW === mH === 4 here
      }
    }

    const nodes = editor._sketchLayer.children().filter((el) => el.attr('r') !== undefined);
    expect(nodes.length).toBeGreaterThan(0);
    for (const el of nodes) {
      expect(el.attr('cx')).not.toBe(0);
      expect(el.attr('cx')).not.toBe(editor._mW);
      expect(el.attr('cy')).not.toBe(0);
      expect(el.attr('cy')).not.toBe(editor._mH);
    }
  });

  it('non-vacuous: margin 0 DOES reproduce the original edge-touching rail (proves the default margin is what excludes it, not something else)', () => {
    const edgeEditor = _makeMockEditor();
    const edgePattern = { ...PATTERN_DEFAULTS, seed: 24, margin: 0, rails: { every: 2, offset: 0 } };
    generatePattern(edgeEditor, edgePattern);
    const edgeRails = edgeEditor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'rail');
    const hasEdgeRail = edgeRails.some((el) => el.attr('y1') === 0 || el.attr('y1') === edgeEditor._mH);
    expect(hasEdgeRail).toBe(true); // j=0 and j=mH/spacing are both "every 2" rows when margin doesn't exclude them

    const insetEditor = _makeMockEditor();
    const insetPattern = { ...PATTERN_DEFAULTS, seed: 24, rails: { every: 2, offset: 0 } }; // margin defaults to 1
    generatePattern(insetEditor, insetPattern);
    const insetRails = insetEditor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'rail');
    const hasEdgeRailInset = insetRails.some((el) => el.attr('y1') === 0 || el.attr('y1') === insetEditor._mH);
    expect(hasEdgeRailInset).toBe(false);
  });
});
