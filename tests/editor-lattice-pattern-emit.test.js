/**
 * SE7b slice 2 — generatePattern: the DOM-touching half of SE7b, layered
 * on top of slice 1's pure computePattern. Uses a lightweight in-memory
 * sketch-layer mock (same idea as tests/editor-lattice.test.js's
 * mockSketchLayer / mockEditorForEmit, extended to support real
 * addLayer/setActiveLayer/emitSegment/emitNode round-tripping through
 * attr()/remove(), since generatePattern calls all of those for real —
 * not reimplemented here).
 *
 * SE7i (Fred: "I don't mind if all lattice geometry is in one layer" +
 * "regenerate should clear and use the same layer"): Generate/Regenerate
 * now write into the ACTIVE layer directly — no more auto-created Rails/
 * Ties/Nodes layers, no more PATTERN.layers, no more "restore the
 * previously-active layer" dance (there's nothing to restore FROM —
 * the active layer never changes). Ownership (`recolorOwnedKind`/
 * `rewidthOwnedKind`/`detachAllOwned`) is layer-scoped now, not id-
 * matched. The mock editor below seeds a real starter layer (id '0',
 * active) to match the REAL app's own invariant (layers.js's
 * initLayerControls always pre-creates "Layer 1" before any tool, incl.
 * Lattice, can run — BUG-10) — a bare `_layers: []` would never occur in
 * a real session.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  generatePattern, detachAllOwned, detachOwnership, OWNERSHIP_ATTR, PATTERN_DEFAULTS,
  nextSeed, recolorOwnedKind, rewidthOwnedKind,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { save, _migrateLegacyPatternOntoLayers } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';

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
      // Real svg.js shape: .stroke({color, width}) / .fill(hex) actually
      // paint — recorded into `store` (readable back via .attr('stroke'/
      // 'stroke-width'/'fill')) so SE7g's per-kind coloring AND SE7i's
      // per-kind widths are verifiable, same convention as
      // editor-color.test.js's mockAttrEl.
      stroke(v) {
        if (typeof v === 'object' && v !== null) {
          if ('color' in v) store.stroke = v.color;
          if ('width' in v) store['stroke-width'] = v.width;
        }
        return el;
      },
      fill(v) { if (v !== undefined) store.fill = v; return el; },
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
    // SE7i: seeded with a real starter layer — matches the real app's own
    // invariant (see file header). generatePattern reads getActiveLayer
    // (layers.js) directly now, no auto-create of its own.
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    _color: '#000', _strokeWidth: 0.02,
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

  it('writes rails/ties/nodes into the ACTIVE layer — no new layer is created (SE7i)', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 1, ties: { ...PATTERN_DEFAULTS.ties, density: 0.5 } };
    generatePattern(editor, pattern);

    expect(editor._layers).toHaveLength(1); // still just Layer 1 — Generate never creates one
    const emitted = editor._sketchLayer.children();
    expect(emitted.length).toBeGreaterThan(0); // non-vacuous: something WAS generated
    for (const el of emitted) expect(el.attr('data-layer')).toBe('0');
  });

  it('assigns PATTERN.id when absent, and every emitted element carries both data-lattice and the ownership tag', async () => {
    // T49: generatePattern is now async (boundary mode needs
    // shapeToPrimitives) -- board mode itself never hits a real await, so
    // this `await` doesn't change timing, only unwraps the Promise.
    const pattern = { ...PATTERN_DEFAULTS, seed: 2, ties: { ...PATTERN_DEFAULTS.ties, density: 0.5 } };
    expect(pattern.id).toBeUndefined();
    const { segments, nodePoints } = await generatePattern(editor, pattern);
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

  it('is exactly ONE undo step: pushState called once, notifyChange("commit") called once, regardless of element count', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 4, ties: { ...PATTERN_DEFAULTS.ties, density: 1 } };
    generatePattern(editor, pattern);
    expect(editor.pushStateCalls).toBe(1);
    expect(editor.notifyChangeCalls).toEqual(['commit']);
  });
});

describe('generatePattern: Regenerate (same PATTERN.id, SAME active layer)', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  it('produces byte-identical geometry to the first Generate when nothing changed', async () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 6, ties: { ...PATTERN_DEFAULTS.ties, density: 0.6 } };
    const first = await generatePattern(editor, pattern);
    const second = await generatePattern(editor, pattern);
    expect(second.segments).toEqual(first.segments);
    expect(second.nodePoints).toEqual(first.nodePoints);
  });

  it("does NOT touch hand-drawn content lacking data-lattice at all", () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 8 };
    generatePattern(editor, pattern);
    // Simulate a hand-drawn SE7a-unrelated shape (e.g. drawn with the pen
    // tool) sitting in the SAME layer — no data-lattice attribute.
    const handDrawn = editor._sketchLayer.line(0, 0, 1, 1);
    handDrawn.attr('data-layer', editor._activeLayer);
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

  /**
   * SE7i (Fred: "regenerate should clear and use the same layer" —
   * "including pieces moved by hand since"): the OLD rule stripped
   * OWNERSHIP_ATTR the instant a piece was dragged (editor-interaction.js's
   * handleEnd), so Regenerate would never touch it again. That hook is
   * retired this turn — a moved-but-still-owned piece is exactly what
   * Regenerate is now supposed to sweep away, regardless of where it
   * currently sits.
   */
  it('sweeps an owned piece that was MOVED BY HAND (still carries OWNERSHIP_ATTR, geometry changed) — the old detach-on-move rule is retired', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 11, ties: { ...PATTERN_DEFAULTS.ties, density: 1, columns: [2] } };
    generatePattern(editor, pattern);
    const tie = editor._sketchLayer.children().find((el) => el.attr('data-lattice') === 'tie');
    expect(tie.attr(OWNERSHIP_ATTR)).toBe(pattern.id); // sanity: still owned

    // Simulate a completed Select-mode drag WITHOUT stripping ownership —
    // exactly what handleEnd does today (post-retirement of the old hook).
    tie.attr('x1', 99); tie.attr('y1', 99);

    generatePattern(editor, pattern);

    expect(editor._sketchLayer.children()).not.toContain(tie); // swept away
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

describe('detachAllOwned: the bulk "Detach all" panel action (SE7i: layer-scoped, not id-matched)', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  it('strips ownership from every element on the given LAYER, leaves others alone', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 20, ties: { ...PATTERN_DEFAULTS.ties, density: 1 } };
    generatePattern(editor, pattern);
    const ownedBefore = editor._sketchLayer.children().filter((el) => el.attr(OWNERSHIP_ATTR) === pattern.id);
    expect(ownedBefore.length).toBeGreaterThan(0); // sanity — Generate must have actually made owned content

    const count = detachAllOwned(editor, editor._activeLayer);

    expect(count).toBe(ownedBefore.length);
    const stillOwned = editor._sketchLayer.children().filter((el) => el.attr(OWNERSHIP_ATTR));
    expect(stillOwned).toHaveLength(0);
    // nothing was removed or moved — same element count, same geometry
    expect(editor._sketchLayer.children()).toHaveLength(ownedBefore.length);
  });

  it('is exactly one undo step (not one per detached element)', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 21, ties: { ...PATTERN_DEFAULTS.ties, density: 1 } };
    generatePattern(editor, pattern);
    editor.pushStateCalls = 0;
    editor.notifyChangeCalls = [];

    detachAllOwned(editor, editor._activeLayer);

    expect(editor.pushStateCalls).toBe(1);
    expect(editor.notifyChangeCalls).toEqual(['commit']);
  });

  it('does nothing (no undo push) when nothing is owned on that layer', () => {
    const count = detachAllOwned(editor, 'layer-nonexistent');
    expect(count).toBe(0);
    expect(editor.pushStateCalls).toBe(0);
    expect(editor.notifyChangeCalls).toEqual([]);
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

/**
 * SE7g (Fred: "the generate button needs to automatically use a new
 * seed"): nextSeed() is the ONE seed-rolling function Generate now calls
 * on every press, replacing the standalone Reroll button.
 */
describe('nextSeed (SE7g)', () => {
  it('returns an integer in [0, 1_000_000)', () => {
    for (let i = 0; i < 20; i++) {
      const s = nextSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1_000_000);
    }
  });

  it('non-vacuous: repeated calls are not all the same value (it is actually random, not a constant)', () => {
    const draws = new Set(Array.from({ length: 20 }, () => nextSeed()));
    expect(draws.size).toBeGreaterThan(1);
  });
});

/**
 * SE7g AMEND (Fred): per-kind colors — PATTERN.colors declared with
 * defaults, generatePattern paints each kind from its own entry.
 */
describe('PATTERN_DEFAULTS.colors (SE7g amend)', () => {
  it('declares the three default kind colors', () => {
    expect(PATTERN_DEFAULTS.colors).toEqual({ rails: '#c62828', ties: '#f9c80e', nodes: '#1a237e' });
  });
});

/**
 * SE7i (Section 2, "Widths"): PATTERN.widths declared with defaults
 * derived from LATTICE_STYLE's own proportions — see editor-lattice-
 * pattern.js's own comment on why these are absolute inches, not factors.
 */
describe('PATTERN_DEFAULTS.widths (SE7i)', () => {
  it('declares the three default kind widths, derived from LATTICE_STYLE × the default spacing (0.25)', () => {
    expect(PATTERN_DEFAULTS.widths.rails).toBeCloseTo(0.07, 10);
    expect(PATTERN_DEFAULTS.widths.ties).toBeCloseTo(0.055, 10);
    expect(PATTERN_DEFAULTS.widths.nodeRadius).toBeCloseTo(0.075, 10);
  });
});

describe('generatePattern: per-kind colors (SE7g amend)', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  it('paints rails/ties with their own PATTERN.colors stroke, and nodes with their own fill', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, seed: 30,
      rails: { every: 2, offset: 0 },
      ties: { ...PATTERN_DEFAULTS.ties, density: 1 },
      colors: { rails: '#111111', ties: '#222222', nodes: '#333333' },
    };
    generatePattern(editor, pattern);

    const rails = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'rail');
    const ties = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'tie');
    const nodes = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'node');
    expect(rails.length).toBeGreaterThan(0);
    expect(ties.length).toBeGreaterThan(0);
    expect(nodes.length).toBeGreaterThan(0);
    for (const el of rails) expect(el.attr('stroke')).toBe('#111111');
    for (const el of ties) expect(el.attr('stroke')).toBe('#222222');
    for (const el of nodes) expect(el.attr('fill')).toBe('#333333');
  });

  it('falls back to PATTERN_DEFAULTS.colors when PATTERN.colors is absent', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, seed: 31,
      rails: { every: 2, offset: 0 },
      ties: { ...PATTERN_DEFAULTS.ties, density: 1 },
    };
    delete pattern.colors;
    generatePattern(editor, pattern);
    const rail = editor._sketchLayer.children().find((el) => el.attr('data-lattice') === 'rail');
    expect(rail.attr('stroke')).toBe(PATTERN_DEFAULTS.colors.rails);
  });

  it('restores editor._color to whatever it was before Generate ran (does not leak the last kind\'s color)', () => {
    editor._color = '#abcdef';
    const pattern = { ...PATTERN_DEFAULTS, seed: 32 };
    generatePattern(editor, pattern);
    expect(editor._color).toBe('#abcdef');
  });

  it('a partial PATTERN.colors (only rails set) still fills in ties/nodes from defaults', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, seed: 33,
      ties: { ...PATTERN_DEFAULTS.ties, density: 1 },
      colors: { rails: '#444444' },
    };
    generatePattern(editor, pattern);
    const rail = editor._sketchLayer.children().find((el) => el.attr('data-lattice') === 'rail');
    const tie = editor._sketchLayer.children().find((el) => el.attr('data-lattice') === 'tie');
    expect(rail.attr('stroke')).toBe('#444444');
    expect(tie.attr('stroke')).toBe(PATTERN_DEFAULTS.colors.ties);
  });
});

/**
 * SE7i (Section 2, "Widths"): the size-editing mirror of the colors tests
 * above — generator-only (the hand-drawn tool keeps LATTICE_STYLE's own
 * proportions, untouched by PATTERN.widths).
 */
describe('generatePattern: per-kind widths (SE7i)', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  it('sizes rails/ties stroke-width and node radius from PATTERN.widths', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, seed: 34,
      rails: { every: 2, offset: 0 },
      ties: { ...PATTERN_DEFAULTS.ties, density: 1 },
      widths: { rails: 0.11, ties: 0.09, nodeRadius: 0.2 },
    };
    generatePattern(editor, pattern);

    const rails = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'rail');
    const ties = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'tie');
    const nodes = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'node');
    expect(rails.length).toBeGreaterThan(0);
    expect(ties.length).toBeGreaterThan(0);
    expect(nodes.length).toBeGreaterThan(0);
    for (const el of rails) expect(el.attr('stroke-width')).toBe(0.11);
    for (const el of ties) expect(el.attr('stroke-width')).toBe(0.09);
    for (const el of nodes) expect(el.attr('r')).toBe(0.2);
  });

  it('falls back to PATTERN_DEFAULTS.widths when PATTERN.widths is absent', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 35, rails: { every: 2, offset: 0 } };
    delete pattern.widths;
    generatePattern(editor, pattern);
    const rail = editor._sketchLayer.children().find((el) => el.attr('data-lattice') === 'rail');
    expect(rail.attr('stroke-width')).toBeCloseTo(PATTERN_DEFAULTS.widths.rails, 10);
  });

  it('a partial PATTERN.widths (only rails set) still fills in ties/nodeRadius from defaults', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, seed: 36,
      ties: { ...PATTERN_DEFAULTS.ties, density: 1 },
      widths: { rails: 0.3 },
    };
    generatePattern(editor, pattern);
    const rail = editor._sketchLayer.children().find((el) => el.attr('data-lattice') === 'rail');
    const tie = editor._sketchLayer.children().find((el) => el.attr('data-lattice') === 'tie');
    expect(rail.attr('stroke-width')).toBe(0.3);
    expect(tie.attr('stroke-width')).toBeCloseTo(PATTERN_DEFAULTS.widths.ties, 10);
  });
});

describe('recolorOwnedKind (SE7g amend, SE7i: layer-scoped): recolor owned pieces in place, no reseed', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  it('recolors every OWNED element of the given kind on the ACTIVE layer, leaves other kinds alone', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, seed: 40,
      rails: { every: 2, offset: 0 },
      ties: { ...PATTERN_DEFAULTS.ties, density: 1 },
    };
    generatePattern(editor, pattern);
    const railsBefore = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'rail');
    const tiesBefore = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'tie');
    expect(railsBefore.length).toBeGreaterThan(0);
    expect(tiesBefore.length).toBeGreaterThan(0);
    const tieColorBefore = tiesBefore[0].attr('stroke');

    const count = recolorOwnedKind(editor, editor._activeLayer, 'rails', '#999999');

    expect(count).toBe(railsBefore.length);
    for (const el of railsBefore) expect(el.attr('stroke')).toBe('#999999');
    // Non-vacuous: ties were NOT touched by a rails-only recolor.
    for (const el of tiesBefore) expect(el.attr('stroke')).toBe(tieColorBefore);
  });

  it('recolors nodes via fill, not stroke', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 41, rails: { every: 2, offset: 0 } };
    generatePattern(editor, pattern);
    const nodesBefore = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'node');
    expect(nodesBefore.length).toBeGreaterThan(0);

    recolorOwnedKind(editor, editor._activeLayer, 'nodes', '#00ff00');
    for (const el of nodesBefore) expect(el.attr('fill')).toBe('#00ff00');
  });

  it('a DETACHED piece of that kind keeps its own color — untouched', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, seed: 42,
      rails: { every: 2, offset: 0 },
    };
    generatePattern(editor, pattern);
    const rail = editor._sketchLayer.children().find((el) => el.attr('data-lattice') === 'rail');
    const originalColor = rail.attr('stroke');
    rail.attr(OWNERSHIP_ATTR, undefined); // detach, same mechanic as SE7b's own detach tests

    const count = recolorOwnedKind(editor, editor._activeLayer, 'rails', '#ffffff');

    expect(rail.attr('stroke')).toBe(originalColor);
    // The detached rail must not be counted either.
    const stillOwnedRails = editor._sketchLayer.children().filter(
      (el) => el.attr('data-lattice') === 'rail' && el.attr(OWNERSHIP_ATTR)
    );
    expect(count).toBe(stillOwnedRails.length);
  });

  it('is exactly one undo step (not one per recolored element)', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 43, rails: { every: 2, offset: 0 } };
    generatePattern(editor, pattern);
    editor.pushStateCalls = 0;
    editor.notifyChangeCalls = [];

    recolorOwnedKind(editor, editor._activeLayer, 'rails', '#101010');

    expect(editor.pushStateCalls).toBe(1);
    expect(editor.notifyChangeCalls).toEqual(['commit']);
  });

  it('does nothing (no undo push) when nothing of that kind is owned yet on that layer', () => {
    const count = recolorOwnedKind(editor, 'layer-nonexistent', 'rails', '#101010');
    expect(count).toBe(0);
    expect(editor.pushStateCalls).toBe(0);
    expect(editor.notifyChangeCalls).toEqual([]);
  });
});

/**
 * SE7i (Section 2, "Widths"): the size-editing mirror of recolorOwnedKind
 * above — same layer-scoped ownership filter, same "no reseed, one undo
 * step" contract.
 */
describe('rewidthOwnedKind (SE7i): re-width owned pieces in place, no reseed', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  it('re-widths every OWNED element of the given kind on the ACTIVE layer, leaves other kinds alone', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, seed: 50,
      rails: { every: 2, offset: 0 },
      ties: { ...PATTERN_DEFAULTS.ties, density: 1 },
    };
    generatePattern(editor, pattern);
    const railsBefore = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'rail');
    const tiesBefore = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'tie');
    expect(railsBefore.length).toBeGreaterThan(0);
    expect(tiesBefore.length).toBeGreaterThan(0);
    const tieWidthBefore = tiesBefore[0].attr('stroke-width');

    const count = rewidthOwnedKind(editor, editor._activeLayer, 'rails', 0.5);

    expect(count).toBe(railsBefore.length);
    for (const el of railsBefore) expect(el.attr('stroke-width')).toBe(0.5);
    for (const el of tiesBefore) expect(el.attr('stroke-width')).toBe(tieWidthBefore); // untouched
  });

  it('re-widths nodes via the `r` (radius) attribute', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 51, rails: { every: 2, offset: 0 } };
    generatePattern(editor, pattern);
    const nodesBefore = editor._sketchLayer.children().filter((el) => el.attr('data-lattice') === 'node');
    expect(nodesBefore.length).toBeGreaterThan(0);

    rewidthOwnedKind(editor, editor._activeLayer, 'nodes', 0.25);
    for (const el of nodesBefore) expect(el.attr('r')).toBe(0.25);
  });

  it('a DETACHED piece of that kind keeps its own width — untouched', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 52, rails: { every: 2, offset: 0 } };
    generatePattern(editor, pattern);
    const rail = editor._sketchLayer.children().find((el) => el.attr('data-lattice') === 'rail');
    const originalWidth = rail.attr('stroke-width');
    rail.attr(OWNERSHIP_ATTR, undefined);

    rewidthOwnedKind(editor, editor._activeLayer, 'rails', 0.9);

    expect(rail.attr('stroke-width')).toBe(originalWidth);
  });

  it('is exactly one undo step (not one per re-widthed element)', () => {
    const pattern = { ...PATTERN_DEFAULTS, seed: 53, rails: { every: 2, offset: 0 } };
    generatePattern(editor, pattern);
    editor.pushStateCalls = 0;
    editor.notifyChangeCalls = [];

    rewidthOwnedKind(editor, editor._activeLayer, 'rails', 0.12);

    expect(editor.pushStateCalls).toBe(1);
    expect(editor.notifyChangeCalls).toEqual(['commit']);
  });

  it('does nothing (no undo push) when nothing of that kind is owned yet on that layer', () => {
    const count = rewidthOwnedKind(editor, 'layer-nonexistent', 'rails', 0.12);
    expect(count).toBe(0);
    expect(editor.pushStateCalls).toBe(0);
    expect(editor.notifyChangeCalls).toEqual([]);
  });
});

describe('save() persists a layer\'s own .pattern inside data-editor-layers (SE7i)', () => {
  function mockSaveEditor(layers) {
    return {
      _draw: {},
      _sketchLayer: { node: { innerHTML: '' } },
      _mW: 7, _mH: 9,
      _layers: layers,
      _activeLayer: layers[0]?.id ?? null,
    };
  }

  it('a layer with a pattern round-trips it through data-editor-layers, XML-escaped like every other field', () => {
    const layers = [{ id: '0', name: 'Layer 1', visible: true, pattern: { id: 'lattice-1', seed: 3 } }];
    const out = save(mockSaveEditor(layers));
    expect(out).toContain('data-editor-layers=');
    expect(out).toMatch(/&quot;pattern&quot;:\{&quot;id&quot;:&quot;lattice-1&quot;/);
    expect(out).not.toContain('data-lattice-pattern'); // the OLD file-level attribute is gone entirely
  });

  it('a layer with NO pattern yet omits the field entirely (not a null placeholder)', () => {
    const layers = [{ id: '0', name: 'Layer 1', visible: true }];
    const out = save(mockSaveEditor(layers));
    expect(out).not.toMatch(/&quot;pattern&quot;/);
  });
});

/**
 * SE7i MIGRATION: an OLD file's document-level data-lattice-pattern
 * attaches onto whichever layer(s) actually hold that pattern's generated
 * pieces — _migrateLegacyPatternOntoLayers is editor-io.js's own extracted
 * decision function (called from open(), which needs much heavier DOM
 * machinery this suite doesn't build), so the migration DECISION is
 * tested directly here with the same lightweight _sketchLayer shape the
 * rest of this file already uses.
 */
describe('_migrateLegacyPatternOntoLayers (SE7i migration)', () => {
  function mockMigrationEditor(children, layers) {
    return {
      _sketchLayer: { children: () => { const arr = children.slice(); arr.toArray = () => arr; return arr; } },
      _layers: layers,
    };
  }
  function ownedChild(layerId) {
    const store = { 'data-layer': layerId, [OWNERSHIP_ATTR]: 'lattice-old' };
    return { node: { getAttribute: (k) => store[k] ?? null, hasAttribute: (k) => store[k] !== undefined } };
  }

  it('attaches a COPY of the legacy pattern to the one layer holding its generated pieces', () => {
    const legacy = { id: 'lattice-old', seed: 7 };
    const layers = [{ id: 'rails-layer', name: 'Rails', visible: true }, { id: 'other', name: 'Layer 1', visible: true }];
    const editor = mockMigrationEditor([ownedChild('rails-layer')], layers);

    _migrateLegacyPatternOntoLayers(editor, legacy);

    expect(editor._layers.find((l) => l.id === 'rails-layer').pattern).toEqual(legacy);
    expect(editor._layers.find((l) => l.id === 'other').pattern).toBeUndefined();
  });

  it('attaches an INDEPENDENT copy to EACH layer under the old 3-layer-per-pattern model (Rails/Ties/Nodes)', () => {
    const legacy = { id: 'lattice-old', seed: 8 };
    const layers = [{ id: 'r' }, { id: 't' }, { id: 'n' }];
    const editor = mockMigrationEditor([ownedChild('r'), ownedChild('t'), ownedChild('n')], layers);

    _migrateLegacyPatternOntoLayers(editor, legacy);

    expect(layers[0].pattern).toEqual(legacy);
    expect(layers[1].pattern).toEqual(legacy);
    expect(layers[2].pattern).toEqual(legacy);
    // Independent copies, not the same object reference — mutating one
    // later must not silently change the others.
    layers[0].pattern.seed = 999;
    expect(layers[1].pattern.seed).toBe(8);
  });

  it('does nothing when there is no legacy pattern to migrate', () => {
    const layers = [{ id: 'r' }];
    const editor = mockMigrationEditor([ownedChild('r')], layers);
    _migrateLegacyPatternOntoLayers(editor, null);
    expect(layers[0].pattern).toBeUndefined();
  });

  it('is skipped entirely once ANY layer already carries its own .pattern (a document saved after this migration shipped)', () => {
    const legacy = { id: 'lattice-old', seed: 9 };
    const layers = [{ id: 'r', pattern: { id: 'already-here', seed: 1 } }, { id: 't' }];
    const editor = mockMigrationEditor([ownedChild('r'), ownedChild('t')], layers);

    _migrateLegacyPatternOntoLayers(editor, legacy);

    expect(layers[0].pattern).toEqual({ id: 'already-here', seed: 1 }); // untouched
    expect(layers[1].pattern).toBeUndefined(); // NOT migrated either — the whole pass is skipped
  });

  it('a layer with NO owned pieces at all never gets the legacy pattern attached', () => {
    const legacy = { id: 'lattice-old', seed: 10 };
    const layers = [{ id: 'empty-layer' }];
    const editor = mockMigrationEditor([], layers);
    _migrateLegacyPatternOntoLayers(editor, legacy);
    expect(layers[0].pattern).toBeUndefined();
  });
});
