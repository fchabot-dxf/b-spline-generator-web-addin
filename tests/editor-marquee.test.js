/**
 * SE7h add-on (Fred: generated Rails/Ties/Nodes pieces were unclickable
 * in Select/Node modes) — finalizeMarquee's own layer-class filter used
 * to exclude BOTH `.layer-hidden` and `.inactive-layer`, so a drag-select
 * silently skipped anything not on the currently active layer (the same
 * root cause as getNearbyElement's isEditableByLayer-only check). Now it
 * only excludes `.layer-hidden` — a marquee can pick up any VISIBLE
 * layer's content, matching the click-select fix in editor-hit.js.
 */
import { describe, it, expect } from 'vitest';
import { finalizeMarquee } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-marquee.js';

function mockElement({ bbox, cls = '' }) {
  const node = {
    getAttribute: (name) => (name === 'class' ? cls : null),
    parentNode: {}, // truthy — "still attached to the document"
  };
  return {
    node,
    bbox: () => bbox,
    matrix: () => null,
  };
}

function mockMarqueeRect(x, y, w, h) {
  const values = { x, y, width: w, height: h };
  return {
    attr: (name) => values[name],
  };
}

function mockEditor(elements, rect) {
  const selectManyCalls = [];
  return {
    _marqueeStart: { x: 0, y: 0 }, // truthy — a real drag happened
    _marqueeRect: rect,
    _marqueeAdditive: false,
    _handleLayer: null,
    _sketchLayer: { children: () => ({ toArray: () => elements }) },
    _selectMany: (els) => selectManyCalls.push(els),
    _selectManyCalls: selectManyCalls,
  };
}

const FULL_BOX = mockMarqueeRect(0, 0, 10, 10); // covers every element's bbox below
const BBOX = { x: 1, y: 1, w: 1, h: 1, x2: 2, y2: 2 };

describe('finalizeMarquee: layer-class filtering (SE7h add-on)', () => {
  it('picks a plain (no special class) element, as before', () => {
    const el = mockElement({ bbox: BBOX });
    const editor = mockEditor([el], FULL_BOX);
    const count = finalizeMarquee(editor);
    expect(count).toBe(1);
    expect(editor._selectManyCalls[0]).toEqual([el]);
  });

  it('non-vacuous: still EXCLUDES a `.layer-hidden` element (the eye toggled off)', () => {
    const el = mockElement({ bbox: BBOX, cls: 'layer-hidden' });
    const editor = mockEditor([el], FULL_BOX);
    const count = finalizeMarquee(editor);
    expect(count).toBe(0);
  });

  it('INCLUDES an `.inactive-layer` element (visible, just not the active layer) — the actual fix', () => {
    const el = mockElement({ bbox: BBOX, cls: 'inactive-layer' });
    const editor = mockEditor([el], FULL_BOX);
    const count = finalizeMarquee(editor);
    expect(count).toBe(1);
    expect(editor._selectManyCalls[0]).toEqual([el]);
  });

  it('an element that is BOTH inactive-layer and layer-hidden is still excluded (hidden wins)', () => {
    const el = mockElement({ bbox: BBOX, cls: 'inactive-layer layer-hidden' });
    const editor = mockEditor([el], FULL_BOX);
    const count = finalizeMarquee(editor);
    expect(count).toBe(0);
  });
});
