/**
 * F35 (Fred, perf: "the app lags once a brick layer exists" -- the quick win: "skip brick regen on
 * non-brick commits"). regenerateOwnedBrickElements (editor-brick-tool.js) used to remove-and-
 * redraw every brush-owned brick on EVERY editorCommit, even one that never touched a brick spine
 * (e.g. an unrelated artwork edit). A cheap fingerprint of exactly the spine content this function
 * reads (element id, endpoints, stripe id, settings JSON) now skips that work when none of it
 * changed -- the redraw would be byte-identical, so skipping is exact, not a heuristic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { regenerateOwnedBrickElements, BRICKS_LAYER_NAME, BRICK_ATTR, BRICK_ELEMENT_ATTR, BRICK_SETTINGS_ATTR, BRICK_OWNER_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const SETTINGS = JSON.stringify({ setId: 1, scale: 1, suppression: 0, clumping: 0, seed: 1, reliefIn: 0.125, profile: 'bricks', orientation: 'stretcher', grout: { widthIn: 0.06 } });

function makeSpineLine(elementId, x1, y1, x2, y2, settingsJson = SETTINGS) {
  const attrs = { [BRICK_ATTR]: 'brush-spine', [BRICK_ELEMENT_ATTR]: elementId, [BRICK_SETTINGS_ATTR]: settingsJson };
  const coords = { x1, y1, x2, y2 };
  return {
    type: 'line',
    node: { getAttribute: (k) => (k in coords ? coords[k] : (attrs[k] ?? null)) },
    attr: (k) => attrs[k] ?? null,
  };
}

function makeMockEditor() {
  let elements = [];
  let polygonCalls = 0;
  const sketchLayer = {
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    polygon() {
      polygonCalls++;
      const el = {
        type: 'polygon', _attrs: {},
        fill() { return el; }, stroke() { return el; },
        attr(k, ...rest) { if (rest.length === 0) return el._attrs[k]; el._attrs[k] = rest[0]; return el; },
        remove() { elements = elements.filter((e) => e !== el); },
      };
      elements.push(el);
      return el;
    },
    node: { closest: () => null },
  };
  return {
    editor: {
      _sketchLayer: sketchLayer,
      _layers: [{ id: 'L1', name: BRICKS_LAYER_NAME }],
    },
    addSpine(elementId, x1, y1, x2, y2, settingsJson) {
      elements.push(makeSpineLine(elementId, x1, y1, x2, y2, settingsJson));
    },
    ownedCount: () => elements.filter((e) => e.attr(BRICK_OWNER_ATTR)).length,
    polygonCallCount: () => polygonCalls,
  };
}

describe('regenerateOwnedBrickElements: skips redraw when the spine content is unchanged', () => {
  let mock;
  beforeEach(() => { mock = makeMockEditor(); });

  it('a bare Bricks layer with no spine content is a cheap no-op both times', () => {
    regenerateOwnedBrickElements(mock.editor);
    expect(mock.polygonCallCount()).toBe(0);
    regenerateOwnedBrickElements(mock.editor);
    expect(mock.polygonCallCount()).toBe(0);
  });

  it('draws real brick polygons for a real spine, then SKIPS an identical second call entirely', () => {
    mock.addSpine('e1', 0, 0, 2, 0);
    regenerateOwnedBrickElements(mock.editor);
    const firstCount = mock.ownedCount();
    expect(firstCount).toBeGreaterThan(0);
    const callsAfterFirst = mock.polygonCallCount();

    regenerateOwnedBrickElements(mock.editor); // identical spine -- must not touch anything
    expect(mock.polygonCallCount()).toBe(callsAfterFirst); // zero NEW polygon() calls
    expect(mock.ownedCount()).toBe(firstCount); // the same bricks are still there
  });

  it('a genuinely different spine (moved endpoint) DOES redraw, not silently skipped forever', () => {
    const moved = makeMockEditor();
    moved.addSpine('e1', 0, 0, 2, 0.5); // a different position than the other tests' own 0,0 -> 2,0
    regenerateOwnedBrickElements(moved.editor);
    expect(moved.polygonCallCount()).toBeGreaterThan(0);
  });

  it('a different settings snapshot on the SAME endpoints also redraws (not just position matters)', () => {
    const differentSettings = JSON.stringify({ setId: 1, scale: 2, suppression: 0, clumping: 0, seed: 1, reliefIn: 0.125, profile: 'bricks', orientation: 'stretcher', grout: { widthIn: 0.06 } });
    const reSettled = makeMockEditor();
    reSettled.addSpine('e1', 0, 0, 2, 0, differentSettings);
    regenerateOwnedBrickElements(reSettled.editor);
    expect(reSettled.polygonCallCount()).toBeGreaterThan(0);
  });
});
