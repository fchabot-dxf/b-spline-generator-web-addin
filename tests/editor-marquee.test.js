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
import { updateMarquee, finalizeMarquee, clearMarquee } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-marquee.js';

function mockElement({ bbox, cls = '', line = null }) {
  const node = {
    getAttribute: (name) => (name === 'class' ? cls : null),
    parentNode: {}, // truthy — "still attached to the document"
  };
  // H20 item 2: an optional straight-line sampling stub (getTotalLength +
  // getPointAtLength, the exact API _sampleElement uses) so CROSSING-mode
  // tests can drive the real outline-sampling code path, not just bbox
  // overlap. `line` is { x1, y1, x2, y2 }.
  if (line) {
    const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
    const len = Math.hypot(dx, dy);
    node.getTotalLength = () => len;
    node.getPointAtLength = (t) => ({ x: line.x1 + (dx * t) / len, y: line.y1 + (dy * t) / len });
  }
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

/**
 * H20 item 2 (Fred: "box select should have the 2 way select mode,
 * include and exclude"), Fusion/CAD convention: drag direction picks
 * WINDOW (left-to-right, full containment only) vs CROSSING (right-to-
 * left, touches-or-encloses).
 */
describe('H20 item 2: WINDOW vs CROSSING mode by drag direction', () => {
  const BOX_0_10 = { x: 0, y: 0, x2: 10, y2: 10 };

  /** Minimal SVG.js-shaped stub for editor._handleLayer.rect(), just
   *  enough for updateMarquee's chained .move/.fill/.stroke/.attr/.size
   *  calls to no-op without throwing. */
  function mockHandleLayer() {
    const rectEl = {
      move: () => rectEl, fill: () => rectEl, stroke: () => rectEl,
      attr: () => rectEl, size: () => rectEl,
    };
    return { rect: () => rectEl };
  }

  it('updateMarquee sets WINDOW when dragging left-to-right (pt.x >= start.x)', () => {
    const editor = { _marqueeStart: { x: 0, y: 0 }, _handleLayer: mockHandleLayer() };
    updateMarquee(editor, { x: 10, y: 10 });
    expect(editor._marqueeMode).toBe('window');
  });

  it('updateMarquee sets CROSSING when dragging right-to-left (pt.x < start.x)', () => {
    const editor = { _marqueeStart: { x: 10, y: 0 }, _handleLayer: mockHandleLayer() };
    updateMarquee(editor, { x: 0, y: 10 });
    expect(editor._marqueeMode).toBe('crossing');
  });

  it('direction flips the mode mid-drag: dragging right then back past the start point switches WINDOW -> CROSSING', () => {
    const editor = { _marqueeStart: { x: 5, y: 0 }, _handleLayer: mockHandleLayer() };
    updateMarquee(editor, { x: 10, y: 10 }); // right of start -> WINDOW
    expect(editor._marqueeMode).toBe('window');
    updateMarquee(editor, { x: 0, y: 10 }); // now left of start -> CROSSING
    expect(editor._marqueeMode).toBe('crossing');
  });

  it('WINDOW mode: a piece only HALF inside the box is NOT selected', () => {
    // bbox spans x=5..15 -- half inside BOX_0_10 (x=0..10), half outside.
    const el = mockElement({ bbox: { x: 5, y: 2, w: 10, h: 2, x2: 15, y2: 4 }, line: { x1: 5, y1: 3, x2: 15, y2: 3 } });
    const editor = mockEditor([el], mockMarqueeRect(0, 0, 10, 10));
    editor._marqueeMode = 'window';
    const count = finalizeMarquee(editor);
    expect(count).toBe(0);
  });

  it('CROSSING mode: the SAME half-inside piece IS selected (touches, not fully enclosed)', () => {
    const el = mockElement({ bbox: { x: 5, y: 2, w: 10, h: 2, x2: 15, y2: 4 }, line: { x1: 5, y1: 3, x2: 15, y2: 3 } });
    const editor = mockEditor([el], mockMarqueeRect(0, 0, 10, 10));
    editor._marqueeMode = 'crossing';
    const count = finalizeMarquee(editor);
    expect(count).toBe(1);
    expect(editor._selectManyCalls[0]).toEqual([el]);
  });

  it('CROSSING mode: a piece whose bbox overlaps the box but whose actual outline never enters it is NOT selected (bbox-corner false positive, sharpened by sampling)', () => {
    // bbox = a 10x10 box from (5,5) to (15,15) -- its bbox overlaps
    // BOX_0_10's corner, but the sampled line itself runs along x=14..15,
    // entirely outside BOX_0_10 (x<=10) -- a diagonal element whose real
    // geometry never dips into the marquee despite the bbox corners touching.
    const el = mockElement({ bbox: { x: 5, y: 5, w: 10, h: 10, x2: 15, y2: 15 }, line: { x1: 14, y1: 5, x2: 15, y2: 15 } });
    const editor = mockEditor([el], mockMarqueeRect(0, 0, 10, 10));
    editor._marqueeMode = 'crossing';
    const count = finalizeMarquee(editor);
    expect(count).toBe(0);
  });

  it('a piece FULLY enclosed by the box is selected by BOTH modes', () => {
    const el = mockElement({ bbox: BBOX, line: { x1: 1, y1: 1, x2: 2, y2: 2 } });
    for (const mode of ['window', 'crossing']) {
      const editor = mockEditor([el], FULL_BOX);
      editor._marqueeMode = mode;
      expect(finalizeMarquee(editor), `mode=${mode}`).toBe(1);
    }
  });

  it('clearMarquee resets _marqueeMode', () => {
    const editor = { _marqueeMode: 'crossing', _marqueeRect: null, _marqueeStart: {}, _marqueeAdditive: true };
    clearMarquee(editor);
    expect(editor._marqueeMode).toBe(null);
  });
});
