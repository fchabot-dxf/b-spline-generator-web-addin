/**
 * T80 item 3 (Fred: "duplicating a tie should also duplicate its node").
 * Duplicate (= copySelection + pasteClipboard, editor-context-menu.js's
 * 'duplicate' entry AND the plain Ctrl+C/V path -- one shared mechanism) now
 * carries a selected tie's own end nodes along, offset with it. The "owned
 * children" identity (tieEndNodes, editor-lattice-chains.js) is a plain
 * world-point match, the same one the chain tie-move already reads its own
 * attached nodes through -- so it applies identically to a board-mode tie or
 * a Shape Lattice tie anchored at a fractional contour crossing.
 *
 * A real (happy-dom) SVG subtree, not a hand-rolled attr-store mock: copy/
 * paste round-trips through actual outerHTML/innerHTML parsing. `window.SVG`
 * is a tiny stand-in (no real svg.js in this test env, this codebase's own
 * convention) whose `.translate()` bakes the offset directly into the raw
 * attrs -- worldPoint's own identity fallback (no `.matrix()`) then reads
 * that baked position back exactly, so "offset with it" can be asserted on
 * plain x1/y1/x2/y2/cx/cy without decoding a transform matrix.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { copySelection, pasteClipboard } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { tieEndNodes } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-chains.js';

const SVGNS = 'http://www.w3.org/2000/svg';

// One stable wrapper object per DOM node (a WeakMap keyed on the node, not a
// fresh object per `.children()` call) -- matching real svg.js's own "one
// cached instance per node" behavior, which is what the Set-by-identity
// dedup in copySelection (editor-interaction.js) relies on: the SAME node
// reached via two different ties' tieEndNodes() must compare equal.
const _wrapCache = new WeakMap();
function wrap(node) {
  if (_wrapCache.has(node)) return _wrapCache.get(node);
  const w = {
    node,
    attr(k, v) {
      if (k && typeof k === 'object') {
        for (const [kk, vv] of Object.entries(k)) { if (vv == null) node.removeAttribute(kk); else node.setAttribute(kk, String(vv)); }
        return this;
      }
      if (v === undefined) return node.getAttribute(k);
      if (v === null) node.removeAttribute(k); else node.setAttribute(k, String(v));
      return this;
    },
    remove() { if (node.parentNode) node.parentNode.removeChild(node); },
    // T80 item 3's own tiny svg.js stand-in for pasteClipboard's `.translate()`
    // call: bakes the offset straight into the raw attrs (no transform
    // matrix) -- worldPoint's own no-`.matrix()` = identity fallback then
    // reads that baked position back exactly.
    translate(dx, dy) {
      if (node.hasAttribute('cx')) {
        node.setAttribute('cx', parseFloat(node.getAttribute('cx')) + dx);
        node.setAttribute('cy', parseFloat(node.getAttribute('cy')) + dy);
      } else {
        node.setAttribute('x1', parseFloat(node.getAttribute('x1')) + dx);
        node.setAttribute('y1', parseFloat(node.getAttribute('y1')) + dy);
        node.setAttribute('x2', parseFloat(node.getAttribute('x2')) + dx);
        node.setAttribute('y2', parseFloat(node.getAttribute('y2')) + dy);
      }
    },
  };
  _wrapCache.set(node, w);
  return w;
}

function makeMockEditor() {
  const group = document.createElementNS(SVGNS, 'g');
  const sketchLayer = {
    node: group,
    children() {
      const arr = Array.from(group.children).map(wrap);
      arr.toArray = () => arr;
      return arr;
    },
  };
  const editor = {
    _sketchLayer: sketchLayer, _selectedElements: [], _clipboard: null,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }], _activeLayer: '0',
    pushState() {}, _notifyChange() {}, _onChange: null,
    _select(el) { editor._selectedElements = [el]; },
    _selectAdd(el) { editor._selectedElements = [...editor._selectedElements, el]; },
    _selectMany(els) { editor._selectedElements = els.slice(); },
    _deselect() { editor._selectedElements = []; },
  };
  return editor;
}

function addEl(editor, tag, kind, attrs) {
  const node = document.createElementNS(SVGNS, tag);
  node.setAttribute('data-lattice', kind);
  node.setAttribute('data-layer', '0');
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  editor._sketchLayer.node.appendChild(node);
  return wrap(node);
}
const addTie = (editor, x1, y1, x2, y2) => addEl(editor, 'line', 'tie', { x1, y1, x2, y2 });
const addNode = (editor, cx, cy) => addEl(editor, 'circle', 'node', { cx, cy });
const addRail = (editor, x1, y1, x2, y2) => addEl(editor, 'line', 'rail', { x1, y1, x2, y2 });

const nodesOf = (editor) => editor._sketchLayer.children().toArray().filter((e) => e.attr('data-lattice') === 'node');
const tiesOf = (editor) => editor._sketchLayer.children().toArray().filter((e) => e.attr('data-lattice') === 'tie');
const num = (el, k) => parseFloat(el.attr(k));

beforeEach(() => {
  // pasteClipboard adopts the freshly-parsed node through window.SVG.adopt --
  // routed through the SAME cached `wrap()` every other reference to that
  // node uses, so identity-based dedup keeps working after a paste too.
  window.SVG = { adopt: wrap };
});

function duplicate(editor) { copySelection(editor); pasteClipboard(editor); }

describe('T80 item 3: tieEndNodes -- the declared "owned children" of a tie', () => {
  it('reports the node(s) sitting exactly at the tie\'s own two endpoints, none more', () => {
    const editor = makeMockEditor();
    const tie = addTie(editor, 0, 0, 0, 1);
    const nA = addNode(editor, 0, 0);
    const nB = addNode(editor, 0, 1);
    addNode(editor, 5, 5); // unrelated -- must not match
    const owned = tieEndNodes(editor, tie).map((o) => o.el.node);
    expect(owned.length).toBe(2);
    expect(owned).toEqual(expect.arrayContaining([nA.node, nB.node]));
  });

  it('a bare tie (no node at either end) owns nothing', () => {
    const editor = makeMockEditor();
    const tie = addTie(editor, 0, 0, 0, 1);
    expect(tieEndNodes(editor, tie)).toEqual([]);
  });

  it('is a no-op for a rail (or any non-tie) -- item 3 is tie-specific, per Fred\'s own ask', () => {
    const editor = makeMockEditor();
    const rail = addRail(editor, 0, 0, 1, 0);
    addNode(editor, 0, 0);
    expect(tieEndNodes(editor, rail)).toEqual([]);
  });

  it('matches an exact FRACTIONAL endpoint (a Shape Lattice tie anchored at a contour crossing) -- no rounding', () => {
    const editor = makeMockEditor();
    const tie = addTie(editor, 2.5, 3.7300001, 2.5, 5);
    const n = addNode(editor, 2.5, 3.7300001);
    expect(tieEndNodes(editor, tie).map((o) => o.el.node)).toEqual([n.node]);
  });
});

describe('T80 item 3: Duplicate carries a selected tie\'s own end nodes along', () => {
  it('duplicating ONE tie (nodes not explicitly selected) also duplicates its 2 end nodes, offset with it', () => {
    const editor = makeMockEditor();
    const tie = addTie(editor, 1, 1, 1, 2);
    addNode(editor, 1, 1);
    addNode(editor, 1, 2);
    editor._select(tie);

    duplicate(editor);

    expect(tiesOf(editor).length).toBe(2);
    expect(nodesOf(editor).length).toBe(4); // the 2 originals + 2 new
    const newTie = tiesOf(editor).find((t) => t.node !== tie.node);
    const dx = num(newTie, 'x1') - 1, dy = num(newTie, 'y1') - 1;
    expect([dx, dy]).not.toEqual([0, 0]); // genuinely offset
    const newNodes = nodesOf(editor).filter((n) => !(num(n, 'cx') === 1 && (num(n, 'cy') === 1 || num(n, 'cy') === 2)));
    expect(newNodes.length).toBe(2);
    // "attached to the new tie": the new tie's own two ends coincide with the two new nodes' centers.
    const newEnds = [[num(newTie, 'x1'), num(newTie, 'y1')], [num(newTie, 'x2'), num(newTie, 'y2')]];
    const newNodePts = newNodes.map((n) => [num(n, 'cx'), num(n, 'cy')]);
    for (const end of newEnds) expect(newNodePts).toEqual(expect.arrayContaining([[expect.closeTo(end[0]), expect.closeTo(end[1])]]));
  });

  it('multi-select: 2 ties sharing 1 node duplicate that node ONCE, not stacked', () => {
    const editor = makeMockEditor();
    const tie1 = addTie(editor, 0, 0, 0, 1);
    const tie2 = addTie(editor, 0, 1, 0, 2);
    addNode(editor, 0, 0);
    const shared = addNode(editor, 0, 1); // tie1's b-end == tie2's a-end
    addNode(editor, 0, 2);
    editor._selectMany([tie1, tie2]);
    expect(tieEndNodes(editor, tie1).map((o) => o.el.node)).toContain(shared.node);
    expect(tieEndNodes(editor, tie2).map((o) => o.el.node)).toContain(shared.node);

    duplicate(editor);

    expect(tiesOf(editor).length).toBe(4); // 2 original + 2 new
    expect(nodesOf(editor).length).toBe(6); // 3 original + 3 new (NOT 4: the shared one copied once)
  });

  it('the tie AND one of its own end nodes explicitly selected together: still one copy of that node', () => {
    const editor = makeMockEditor();
    const tie = addTie(editor, 0, 0, 0, 1);
    const nA = addNode(editor, 0, 0);
    addNode(editor, 0, 1);
    editor._selectMany([tie, nA]);

    duplicate(editor);

    expect(tiesOf(editor).length).toBe(2);
    expect(nodesOf(editor).length).toBe(4); // 2 original + 2 new (nA not doubled)
  });

  it('a bare tie with no nodes duplicates alone -- no extra elements, no crash', () => {
    const editor = makeMockEditor();
    const tie = addTie(editor, 3, 3, 3, 4);
    editor._select(tie);
    duplicate(editor);
    expect(tiesOf(editor).length).toBe(2);
    expect(nodesOf(editor).length).toBe(0);
  });

  it('duplicating a RAIL does not pull in its end node (item 3 is tie-specific)', () => {
    const editor = makeMockEditor();
    const rail = addRail(editor, 0, 0, 5, 0);
    addNode(editor, 0, 0);
    editor._select(rail);
    duplicate(editor);
    expect(editor._sketchLayer.children().toArray().filter((e) => e.attr('data-lattice') === 'rail').length).toBe(2);
    expect(nodesOf(editor).length).toBe(1); // untouched
  });

  it('works identically for a Shape Lattice tie anchored at a fractional contour crossing', () => {
    const editor = makeMockEditor();
    const tie = addTie(editor, 2.5, 3.7300001, 2.5, 5.1);
    addNode(editor, 2.5, 3.7300001);
    addNode(editor, 2.5, 5.1);
    editor._select(tie);

    duplicate(editor);

    expect(tiesOf(editor).length).toBe(2);
    expect(nodesOf(editor).length).toBe(4);
  });
});
