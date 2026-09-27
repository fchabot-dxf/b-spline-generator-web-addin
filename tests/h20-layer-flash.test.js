/**
 * H20 item 5 (Fred: "selecting a layer should signal or highlight what
 * geometry it is momentarily but not forever, since it is distracting if
 * I'm working on the canvas").
 *
 * Checked for a persistent active-layer highlight/dim to remove first:
 * NONE exists — `applyLayerState`'s own `.inactive-layer` class has
 * carried no opacity since Fred 2026-09-24 (`styles/editor.css`'s own
 * comment confirms it), only `pointer-events: none`. So this is a pure
 * addition (`flashLayerGeometry`, `layers.js`), not a removal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flashLayerGeometry, LAYER_FLASH_COLOR, LAYER_FLASH_DURATION_MS } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';

function makeMockEl(id, layerId, strokeWidth = 0.02) {
  const attrs = { 'data-layer': layerId, id, 'stroke-width': String(strokeWidth) };
  const clones = [];
  const el = {
    node: { getAttribute: (k) => (attrs[k] ?? null) },
    attr: (k) => attrs[k] ?? null,
    clone() {
      const cloneAttrs = {};
      const cloneNode = { style: {} };
      const c = {
        node: cloneNode,
        removed: false,
        fill() { return c; },
        stroke(opts) { c.strokeOpts = opts; return c; },
        attr(k, v) { if (v === undefined) return cloneAttrs[k]; cloneAttrs[k] = v; return c; },
        back() { c.wasBacked = true; return c; },
        remove() { c.removed = true; },
      };
      clones.push(c);
      return c;
    },
    _clones: clones,
  };
  return el;
}

function makeEditor(elements) {
  const added = [];
  return {
    _sketchLayer: { children: () => { const a = elements.slice(); a.toArray = () => a; return a; } },
    _highlightLayer: { add: (el) => added.push(el) },
    _highlightLayerAdded: added,
    _selectedElement: null,
    _selectedElements: [],
  };
}

describe('H20 item 5: flashLayerGeometry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); delete window.matchMedia; });

  it('clones only the TARGET layer\'s elements into the highlight layer, in the selection colour', () => {
    const target = makeMockEl('a', 'L1');
    const other = makeMockEl('b', 'L2');
    const editor = makeEditor([target, other]);

    flashLayerGeometry(editor, 'L1');

    expect(editor._highlightLayerAdded).toHaveLength(1);
    expect(target._clones).toHaveLength(1);
    expect(other._clones).toHaveLength(0);
    expect(target._clones[0].strokeOpts.color).toBe(LAYER_FLASH_COLOR);
  });

  it('the highlight is gone after LAYER_FLASH_DURATION_MS', () => {
    const target = makeMockEl('a', 'L1');
    const editor = makeEditor([target]);

    flashLayerGeometry(editor, 'L1');
    const clone = target._clones[0];
    expect(clone.removed).toBe(false);

    vi.advanceTimersByTime(LAYER_FLASH_DURATION_MS);
    expect(clone.removed).toBe(true);
  });

  it('is NOT gone before the duration elapses (non-vacuous: proves the timer length actually matters)', () => {
    const target = makeMockEl('a', 'L1');
    const editor = makeEditor([target]);

    flashLayerGeometry(editor, 'L1');
    vi.advanceTimersByTime(LAYER_FLASH_DURATION_MS - 1);
    expect(target._clones[0].removed).toBe(false);
  });

  it('re-clicking the SAME layer before the flash ends restarts it (old highlight removed, new one added, timer resets)', () => {
    const target = makeMockEl('a', 'L1');
    const editor = makeEditor([target]);

    flashLayerGeometry(editor, 'L1');
    const firstClone = target._clones[0];
    vi.advanceTimersByTime(500); // halfway through
    flashLayerGeometry(editor, 'L1'); // re-trigger

    expect(firstClone.removed).toBe(true); // old one torn down immediately
    const secondClone = target._clones[1];
    expect(secondClone.removed).toBe(false);

    // The ORIGINAL timer's remaining 500ms must NOT clear the NEW flash —
    // proves the timer was actually reset, not just left running.
    vi.advanceTimersByTime(500);
    expect(secondClone.removed).toBe(false);

    vi.advanceTimersByTime(500); // the new flash's own full duration
    expect(secondClone.removed).toBe(true);
  });

  it('switching to a DIFFERENT layer mid-flash cancels the old one', () => {
    const layerA = makeMockEl('a', 'L1');
    const layerB = makeMockEl('b', 'L2');
    const editor = makeEditor([layerA, layerB]);

    flashLayerGeometry(editor, 'L1');
    const aClone = layerA._clones[0];
    vi.advanceTimersByTime(300);
    flashLayerGeometry(editor, 'L2');

    expect(aClone.removed).toBe(true); // L1's flash cancelled
    expect(layerB._clones).toHaveLength(1);
    expect(layerB._clones[0].removed).toBe(false);
  });

  it('respects prefers-reduced-motion: no CSS transition is set (shows briefly, disappears abruptly)', () => {
    window.matchMedia = (q) => ({ matches: q.includes('reduce') });
    const target = makeMockEl('a', 'L1');
    const editor = makeEditor([target]);

    flashLayerGeometry(editor, 'L1');
    const clone = target._clones[0];
    expect(clone.node.style.transition).toBeUndefined();

    // Still shows briefly, then disappears after the same duration.
    vi.advanceTimersByTime(LAYER_FLASH_DURATION_MS);
    expect(clone.removed).toBe(true);
  });

  it('WITHOUT reduced motion, a transition IS set (the fade — non-vacuous contrast with the test above)', () => {
    window.matchMedia = (q) => ({ matches: false });
    const target = makeMockEl('a', 'L1');
    const editor = makeEditor([target]);

    flashLayerGeometry(editor, 'L1');
    // The transition/opacity write happens on the next animation frame
    // (so the browser sees the starting opacity before it changes).
    vi.runOnlyPendingTimers();
    const clone = target._clones[0];
    expect(clone.node.style.transition).toContain(String(LAYER_FLASH_DURATION_MS));
  });

  it('does NOT change element selection', () => {
    const target = makeMockEl('a', 'L1');
    const editor = makeEditor([target]);
    editor._selectedElements = ['pre-existing'];

    flashLayerGeometry(editor, 'L1');

    expect(editor._selectedElements).toEqual(['pre-existing']);
  });

  it('a layer with no geometry on it is a clean no-op', () => {
    const editor = makeEditor([]);
    expect(() => flashLayerGeometry(editor, 'L1')).not.toThrow();
    expect(editor._highlightLayerAdded).toHaveLength(0);
  });
});
