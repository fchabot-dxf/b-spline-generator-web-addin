/**
 * SE8e / SA-TEXT-4 — Expand used to be a one-way trip: `data-original-
 * text-svg` (the pre-expand `<text>`'s own markup, base64-encoded via
 * encodeSnapshot at expand time) survived save/reopen but was read back
 * exactly once, by editor-expand-trace.js, only to re-run Expand at a
 * different detail setting — never to restore an editable `<text>`. No
 * code path anywhere decoded it into a live text node (the audit's own
 * repo-wide grep confirmed zero such sites).
 *
 * `unexpand` closes that gap: decode (decodeSnapshot — the exact inverse
 * of encodeSnapshot, never a second decoder), parse the markup back into
 * a real DOM node, adopt it, and compose the expanded path's CURRENT
 * transform (whatever moving/rotating it since expansion accumulated)
 * onto the snapshot's OWN transform (whatever the text had AT expand
 * time) — so a moved expansion comes back where it NOW is.
 *
 * Real happy-dom (document.createElementNS / innerHTML) does the actual
 * markup parsing here — no mock stands in for that part. `window.SVG.adopt`
 * IS mocked (a small wrapper matching svg.js's real contract: .attr()
 * reads/writes DOM attributes, .matrix() parses `transform`) since real
 * svg.js isn't loaded in this test environment (same limitation as every
 * other SVG.js-dependent path in this repo — see carve-text-roundtrip.test.js's
 * own note).
 */
import { describe, it, expect } from 'vitest';
import { isUnexpandable, unexpand } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-expand-commit.js';
import { encodeSnapshot } from '../bspline-frame-builder/b-spline-gen/html/core/svg-utils.js';
import { multiplyMatrix, matrixToString } from '../bspline-frame-builder/b-spline-gen/html/editor/handle-edit.js';

function mockAdopt(node) {
  return {
    node,
    type: node.tagName.toLowerCase(),
    attr(name, val) {
      if (val === undefined) return node.getAttribute(name);
      if (val === null) { node.removeAttribute(name); return this; }
      node.setAttribute(name, val);
      return this;
    },
    matrix() {
      const t = node.getAttribute('transform');
      if (!t) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      const m = /matrix\(([^)]+)\)/.exec(t);
      if (!m) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      const [a, b, c, d, e, f] = m[1].split(',').map(Number);
      return { a, b, c, d, e, f };
    },
    remove() { node.remove(); },
  };
}

function mockExpandedEl(attrs, matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) {
  const state = { ...attrs };
  const el = {
    attr(name, val) {
      if (val === undefined) return state[name];
      state[name] = val;
      return el;
    },
    matrix: () => matrix,
    remove: () => { state.__removed = true; },
    _state: state,
  };
  return el;
}

function mockEditor() {
  const sketchNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const calls = { select: [], pushState: 0, notifyChange: [] };
  const editor = {
    _sketchLayer: { node: sketchNode },
    _select: (el) => calls.select.push(el),
    pushState: () => { calls.pushState++; },
    _notifyChange: (kind) => calls.notifyChange.push(kind),
  };
  return { editor, sketchNode, calls };
}

function withMockSvg(fn) {
  const prevSVG = globalThis.window.SVG;
  globalThis.window.SVG = { adopt: mockAdopt };
  try { return fn(); } finally { globalThis.window.SVG = prevSVG; }
}

describe('isUnexpandable', () => {
  it('true only when data-original-text-svg is present', () => {
    expect(isUnexpandable(mockExpandedEl({ 'data-original-text-svg': 'abc' }))).toBe(true);
    expect(isUnexpandable(mockExpandedEl({}))).toBe(false);
    expect(isUnexpandable(mockExpandedEl({ 'data-original-svg': 'abc' }))).toBe(false); // a shape, not text
    expect(isUnexpandable(null)).toBe(false);
  });
});

describe('unexpand', () => {
  it('round-trip: restores the same text content/font/size, strips the stale sentinel, no transform when nothing moved', () => {
    withMockSvg(() => {
      const snapshot = encodeSnapshot('<text x="2" y="3" font-family="Arial" font-size="4">Hello</text>');
      const el = mockExpandedEl({ 'data-original-text-svg': snapshot, 'data-layer': '2' });
      const { editor, sketchNode, calls } = mockEditor();

      const restored = unexpand(editor, el);

      expect(restored).not.toBeNull();
      expect(restored.node.tagName.toLowerCase()).toBe('text');
      expect(restored.node.getAttribute('x')).toBe('2');
      expect(restored.node.getAttribute('y')).toBe('3');
      expect(restored.node.getAttribute('font-family')).toBe('Arial');
      expect(restored.node.getAttribute('font-size')).toBe('4');
      expect(restored.node.textContent).toBe('Hello');
      expect(restored.node.getAttribute('data-layer')).toBe('2');
      // The stale expand sentinel belongs to the removed path, not the
      // restored text — a future re-expand must take a FRESH snapshot.
      expect(restored.node.getAttribute('data-original-text-svg')).toBeNull();
      expect(restored.node.getAttribute('transform')).toBeNull(); // identity composed -> no transform written
      expect(sketchNode.contains(restored.node)).toBe(true);

      expect(el._state.__removed).toBe(true);
      expect(calls.select).toEqual([restored]);
      expect(calls.pushState).toBe(1);
      expect(calls.notifyChange).toEqual(['commit']);
    });
  });

  it('a moved expansion comes back at the moved position (expanded path\'s CURRENT transform composed on top)', () => {
    withMockSvg(() => {
      const snapshot = encodeSnapshot('<text x="0" y="0">Hi</text>'); // no transform at expand time
      const movedMatrix = { a: 1, b: 0, c: 0, d: 1, e: 5, f: -2 }; // translate(5,-2) since expansion
      const el = mockExpandedEl({ 'data-original-text-svg': snapshot }, movedMatrix);
      const { editor } = mockEditor();

      const restored = unexpand(editor, el);

      expect(restored.node.getAttribute('transform')).toBe('matrix(1,0,0,1,5,-2)');
    });
  });

  it('composes CORRECTLY when the original text ALSO had its own pre-expand transform (not just overwritten)', () => {
    withMockSvg(() => {
      // The text itself was rotated before being expanded.
      const origMatrix = { a: 0.866, b: 0.5, c: -0.5, d: 0.866, e: 1, f: 1 };
      const snapshot = encodeSnapshot(`<text x="0" y="0" transform="${matrixToString(origMatrix)}">Hi</text>`);
      const sinceMatrix = { a: 1, b: 0, c: 0, d: 1, e: 5, f: -2 }; // moved again after expansion
      const el = mockExpandedEl({ 'data-original-text-svg': snapshot }, sinceMatrix);
      const { editor } = mockEditor();

      const restored = unexpand(editor, el);

      const expected = multiplyMatrix(sinceMatrix, origMatrix); // delta (since) x m0 (orig) — SE7s's own convention
      expect(restored.node.getAttribute('transform')).toBe(matrixToString(expected));
      // Non-vacuous: this is NOT the same as just keeping the original's
      // own transform unchanged (proves the "since" half actually composed).
      expect(restored.node.getAttribute('transform')).not.toBe(matrixToString(origMatrix));
    });
  });

  it('a path without the sentinel attr: no-op (nothing selected/removed/pushed)', () => {
    withMockSvg(() => {
      const el = mockExpandedEl({}); // no data-original-text-svg
      const { editor, calls } = mockEditor();

      const result = unexpand(editor, el);

      expect(result).toBeNull();
      expect(el._state.__removed).toBeUndefined();
      expect(calls.select).toEqual([]);
      expect(calls.pushState).toBe(0);
      expect(calls.notifyChange).toEqual([]);
    });
  });
});
