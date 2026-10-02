/**
 * T82 item 2/5 (INSET-WINDOW-DESIGN.md): the inset window's own geometry + record normalization. 2D/3D
 * rendering and the drag UI live in main/frame-panel.js (DOM-coupled, not unit tested here); this file
 * covers the ONE declared geometry function every consumer reads, and the record's own no-clamp
 * normalization.
 *
 * T82 item 5 (Fred: "use the centre of frame... and make the window a centre point rect too"): the record
 * is `{enabled, cx, cy, w, h}` (centre from the board centre, +y UP) rather than the old `{enabled, x1, y1,
 * x2, y2}` (board-local, origin top-left, y down); `insetWindowGeometry` now also takes the board's own
 * width/height, to place that centre-based rect onto it. `fromOuter` below is this test file's own fixture
 * helper -- the exact inverse of `insetWindowOuterRect` -- so each case can still be written in the
 * familiar board-local outer-rect terms the OLD record shape used, with a single declared conversion
 * rather than every test hand-deriving cx/cy.
 */
import { describe, it, expect } from 'vitest';
import { insetWindowGeometry, insetWindowOuterRect, rectContains } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { normalizeFrameRecord, defaultFrameRecord, framePayload } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';

const WIDTH = 10, HEIGHT = 10;
/** The centre-based {cx, cy, w, h} for a given board-local outer rect (x1,y1)-(x2,y2) -- the exact inverse
 *  of insetWindowOuterRect, used only to build test fixtures in familiar board-local terms. */
function fromOuter(x1, y1, x2, y2, widthIn = WIDTH, heightIn = HEIGHT) {
  return { cx: (x1 + x2) / 2 - widthIn / 2, cy: heightIn / 2 - (y1 + y2) / 2, w: x2 - x1, h: y2 - y1 };
}

describe('insetWindowGeometry', () => {
  it('is null when disabled (the default)', () => {
    expect(insetWindowGeometry({ insetWindow: { enabled: false, ...fromOuter(1, 1, 4, 3) } }, 0.75, 0, WIDTH, HEIGHT)).toBeNull();
    expect(insetWindowGeometry(defaultFrameRecord(), 0.75, 0, WIDTH, HEIGHT)).toBeNull();
  });

  it('MEASURED: outer -> inner (frame_thickness in) -> hole (panelLip MORE in), on all 4 sides', () => {
    const rec = { insetWindow: { enabled: true, ...fromOuter(1, 1, 4, 3) } };
    const g = insetWindowGeometry(rec, 0.5, 0.25, WIDTH, HEIGHT);
    expect(g.outer).toEqual({ x1: 1, y1: 1, x2: 4, y2: 3 });
    expect(g.inner).toEqual({ x1: 1.5, y1: 1.5, x2: 3.5, y2: 2.5 });
    expect(g.hole).toEqual({ x1: 1.75, y1: 1.75, x2: 3.25, y2: 2.25 });
  });

  it('panelLip 0 (default): the hole equals the inner rectangle exactly', () => {
    const rec = { insetWindow: { enabled: true, ...fromOuter(0, 0, 5, 4) } };
    const g = insetWindowGeometry(rec, 0.75, 0, WIDTH, HEIGHT);
    expect(g.hole).toEqual(g.inner);
  });

  it('window bars <= 0 (too narrow for its own frame_thickness): null, no feature, not clamped into validity', () => {
    const rec = { insetWindow: { enabled: true, ...fromOuter(0, 0, 1.0, 3) } }; // 1in wide, ft=0.75 -> 2*ft=1.5 > 1.0
    expect(insetWindowGeometry(rec, 0.75, 0, WIDTH, HEIGHT)).toBeNull();
  });

  // MUTATION-TESTED (not vacuous): the bars check and the opening check are mathematically the SAME condition
  // for a uniform-thickness rectangle (inner.x2-inner.x1 === (x2-x1)-2*ft), kept as two guards only because
  // the design note states both explicitly -- removing BOTH together made this test and the one above fail
  // (confirmed directly, not assumed); removing either one ALONE is a no-op since the other still catches it.
  it('exactly AT the floor (2*ft) is still rejected (a strict >, not >=) -- a zero-width bar is not a bar', () => {
    const rec = { insetWindow: { enabled: true, ...fromOuter(0, 0, 1.5, 3) } }; // exactly 2*0.75
    expect(insetWindowGeometry(rec, 0.75, 0, WIDTH, HEIGHT)).toBeNull();
    const justOver = { insetWindow: { enabled: true, ...fromOuter(0, 0, 1.5 + 1e-6, 3) } };
    expect(insetWindowGeometry(justOver, 0.75, 0, WIDTH, HEIGHT)).not.toBeNull();
  });

  it('a lip wider than the opening collapses the hole to a point instead of inverting it', () => {
    const rec = { insetWindow: { enabled: true, ...fromOuter(0, 0, 2, 2) } }; // inner = 0.5..1.5 (1in opening)
    const g = insetWindowGeometry(rec, 0.75, 10, WIDTH, HEIGHT); // a huge lip
    expect(g).not.toBeNull();
    expect(g.hole.x2 - g.hole.x1).toBe(0);
    expect(g.hole.y2 - g.hole.y1).toBe(0);
  });

  it('NO CLAMPING (Fred: "then it\'s my responsibility"): a window far outside any board still produces real geometry', () => {
    const rec = { insetWindow: { enabled: true, ...fromOuter(-50, -50, 50, 50) } };
    const g = insetWindowGeometry(rec, 0.75, 0.25, WIDTH, HEIGHT);
    expect(g.outer).toEqual({ x1: -50, y1: -50, x2: 50, y2: 50 });
  });
});

describe('insetWindowOuterRect', () => {
  it('is the exact inverse of fromOuter (this file\'s own fixture helper) -- round-trips any rect', () => {
    for (const [x1, y1, x2, y2] of [[1, 1, 4, 3], [0, 0, 5, 4], [-50, -50, 50, 50], [2.25, -3.5, 6.75, 1.125]]) {
      const rec = fromOuter(x1, y1, x2, y2);
      const outer = insetWindowOuterRect(rec, WIDTH, HEIGHT);
      expect(outer.x1).toBeCloseTo(x1, 9);
      expect(outer.y1).toBeCloseTo(y1, 9);
      expect(outer.x2).toBeCloseTo(x2, 9);
      expect(outer.y2).toBeCloseTo(y2, 9);
    }
  });

  it('a centred window (cx=cy=0) sits at the exact board centre regardless of board size', () => {
    for (const [widthIn, heightIn] of [[10, 10], [7, 9], [12, 6]]) {
      const outer = insetWindowOuterRect({ cx: 0, cy: 0, w: 2, h: 3 }, widthIn, heightIn);
      expect(outer.x1).toBeCloseTo(widthIn / 2 - 1, 9);
      expect(outer.x2).toBeCloseTo(widthIn / 2 + 1, 9);
      expect(outer.y1).toBeCloseTo(heightIn / 2 - 1.5, 9);
      expect(outer.y2).toBeCloseTo(heightIn / 2 + 1.5, 9);
    }
  });
});

describe('rectContains', () => {
  it('inclusive on the boundary, false outside', () => {
    const r = { x1: 0, y1: 0, x2: 2, y2: 2 };
    expect(rectContains(r, 1, 1)).toBe(true);
    expect(rectContains(r, 0, 0)).toBe(true);
    expect(rectContains(r, 2, 2)).toBe(true);
    expect(rectContains(r, 2.01, 1)).toBe(false);
    expect(rectContains(r, 1, -0.01)).toBe(false);
  });
});

describe('frame-record.js: insetWindow normalization', () => {
  it('defaults to disabled, a zero rect', () => {
    const r = defaultFrameRecord();
    expect(r.insetWindow).toEqual({ enabled: false, cx: 0, cy: 0, w: 0, h: 0 });
  });

  it('normalizes a non-object/garbage insetWindow back to the default (never a half-valid record)', () => {
    expect(normalizeFrameRecord({ insetWindow: 'nonsense' }).insetWindow).toEqual({ enabled: false, cx: 0, cy: 0, w: 0, h: 0 });
    expect(normalizeFrameRecord({ insetWindow: { cx: 'nope', cy: 1, w: 2, h: 2 } }).insetWindow)
      .toEqual({ enabled: false, cx: 0, cy: 0, w: 0, h: 0 });
  });

  it('a record already in the current shape round-trips exactly, no clamping (Fred\'s own ruling)', () => {
    const out = normalizeFrameRecord({ insetWindow: { enabled: true, cx: -999, cy: 999, w: 1998, h: 1998 } });
    expect(out.insetWindow).toEqual({ enabled: true, cx: -999, cy: 999, w: 1998, h: 1998 });
  });

  describe('migration from the OLD shape ({x1, y1, x2, y2}, board-local, origin top-left, y down)', () => {
    it('converts using the board\'s CURRENT width/height (P.widthIn/P.heightIn)', async () => {
      const { P } = await import('../bspline-frame-builder/b-spline-gen/html/core/state.js');
      P.widthIn = 10; P.heightIn = 10;
      const out = normalizeFrameRecord({ insetWindow: { enabled: true, x1: 1, y1: 1, x2: 4, y2: 3 } });
      expect(out.insetWindow).toEqual({ enabled: true, ...fromOuter(1, 1, 4, 3) });
    });

    it('MEASURED, non-vacuous: sorts a rect dragged past its own opposite corner (x1>x2) before converting, same as the OLD normalizer did', async () => {
      const { P } = await import('../bspline-frame-builder/b-spline-gen/html/core/state.js');
      P.widthIn = 10; P.heightIn = 10;
      const out = normalizeFrameRecord({ insetWindow: { enabled: true, x1: 5, y1: 1, x2: 2, y2: 4 } });
      expect(out.insetWindow).toEqual({ enabled: true, ...fromOuter(2, 1, 5, 4) });
    });

    it('garbage old-shape values fall back to the declared default, same as the new shape', () => {
      expect(normalizeFrameRecord({ insetWindow: { x1: 'nope', y1: 1, x2: 2, y2: 2 } }).insetWindow)
        .toEqual({ enabled: false, cx: 0, cy: 0, w: 0, h: 0 });
    });
  });

  it('framePayload carries insetWindow for every template, off by default (byte-identical path when unset)', () => {
    for (const tpl of FRAME_DEFS.templates) {
      const rec = normalizeFrameRecord({ templateId: tpl.id });
      const payload = framePayload(FRAME_DEFS, rec);
      expect(payload.insetWindow).toEqual({ enabled: false, cx: 0, cy: 0, w: 0, h: 0 });
    }
  });
});
