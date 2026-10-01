/**
 * T82 item 2 (INSET-WINDOW-DESIGN.md): the inset window's own geometry + record normalization. 2D/3D rendering
 * and the drag UI live in main/frame-panel.js (DOM-coupled, not unit tested here); this file covers the ONE
 * declared geometry function every consumer reads, and the record's own no-clamp normalization.
 */
import { describe, it, expect } from 'vitest';
import { insetWindowGeometry, rectContains } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { normalizeFrameRecord, defaultFrameRecord, framePayload } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';

describe('insetWindowGeometry', () => {
  it('is null when disabled (the default)', () => {
    expect(insetWindowGeometry({ insetWindow: { enabled: false, x1: 1, y1: 1, x2: 4, y2: 3 } }, 0.75, 0)).toBeNull();
    expect(insetWindowGeometry(defaultFrameRecord(), 0.75, 0)).toBeNull();
  });

  it('MEASURED: outer -> inner (frame_thickness in) -> hole (panelLip MORE in), on all 4 sides', () => {
    const rec = { insetWindow: { enabled: true, x1: 1, y1: 1, x2: 4, y2: 3 } };
    const g = insetWindowGeometry(rec, 0.5, 0.25);
    expect(g.outer).toEqual({ x1: 1, y1: 1, x2: 4, y2: 3 });
    expect(g.inner).toEqual({ x1: 1.5, y1: 1.5, x2: 3.5, y2: 2.5 });
    expect(g.hole).toEqual({ x1: 1.75, y1: 1.75, x2: 3.25, y2: 2.25 });
  });

  it('panelLip 0 (default): the hole equals the inner rectangle exactly', () => {
    const rec = { insetWindow: { enabled: true, x1: 0, y1: 0, x2: 5, y2: 4 } };
    const g = insetWindowGeometry(rec, 0.75, 0);
    expect(g.hole).toEqual(g.inner);
  });

  it('window bars <= 0 (too narrow for its own frame_thickness): null, no feature, not clamped into validity', () => {
    const rec = { insetWindow: { enabled: true, x1: 0, y1: 0, x2: 1.0, y2: 3 } }; // 1in wide, ft=0.75 -> 2*ft=1.5 > 1.0
    expect(insetWindowGeometry(rec, 0.75, 0)).toBeNull();
  });

  // MUTATION-TESTED (not vacuous): the bars check and the opening check are mathematically the SAME condition
  // for a uniform-thickness rectangle (inner.x2-inner.x1 === (x2-x1)-2*ft), kept as two guards only because
  // the design note states both explicitly -- removing BOTH together made this test and the one above fail
  // (confirmed directly, not assumed); removing either one ALONE is a no-op since the other still catches it.
  it('exactly AT the floor (2*ft) is still rejected (a strict >, not >=) -- a zero-width bar is not a bar', () => {
    const rec = { insetWindow: { enabled: true, x1: 0, y1: 0, x2: 1.5, y2: 3 } }; // exactly 2*0.75
    expect(insetWindowGeometry(rec, 0.75, 0)).toBeNull();
    const justOver = { insetWindow: { enabled: true, x1: 0, y1: 0, x2: 1.5 + 1e-6, y2: 3 } };
    expect(insetWindowGeometry(justOver, 0.75, 0)).not.toBeNull();
  });

  it('a lip wider than the opening collapses the hole to a point instead of inverting it', () => {
    const rec = { insetWindow: { enabled: true, x1: 0, y1: 0, x2: 2, y2: 2 } }; // inner = 0.5..1.5 (1in opening)
    const g = insetWindowGeometry(rec, 0.75, 10); // a huge lip
    expect(g).not.toBeNull();
    expect(g.hole.x2 - g.hole.x1).toBe(0);
    expect(g.hole.y2 - g.hole.y1).toBe(0);
  });

  it('NO CLAMPING (Fred: "then it\'s my responsibility"): a window far outside any board still produces real geometry', () => {
    const rec = { insetWindow: { enabled: true, x1: -50, y1: -50, x2: 50, y2: 50 } };
    const g = insetWindowGeometry(rec, 0.75, 0.25);
    expect(g.outer).toEqual({ x1: -50, y1: -50, x2: 50, y2: 50 });
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
    expect(r.insetWindow).toEqual({ enabled: false, x1: 0, y1: 0, x2: 0, y2: 0 });
  });

  it('normalizes a non-object/garbage insetWindow back to the default (never a half-valid record)', () => {
    expect(normalizeFrameRecord({ insetWindow: 'nonsense' }).insetWindow).toEqual({ enabled: false, x1: 0, y1: 0, x2: 0, y2: 0 });
    expect(normalizeFrameRecord({ insetWindow: { x1: 'nope', y1: 1, x2: 2, y2: 2 } }).insetWindow)
      .toEqual({ enabled: false, x1: 0, y1: 0, x2: 0, y2: 0 });
  });

  it('MEASURED, non-vacuous: sorts a rect dragged past its own opposite corner (x1>x2) without being asked to clamp it', () => {
    const out = normalizeFrameRecord({ insetWindow: { enabled: true, x1: 5, y1: 1, x2: 2, y2: 4 } });
    expect(out.insetWindow).toEqual({ enabled: true, x1: 2, y1: 1, x2: 5, y2: 4 });
  });

  it('NOT clamped against the board or the frame (Fred\'s own ruling) -- an absurd rect round-trips exactly', () => {
    const out = normalizeFrameRecord({ insetWindow: { enabled: true, x1: -999, y1: -999, x2: 999, y2: 999 } });
    expect(out.insetWindow).toEqual({ enabled: true, x1: -999, y1: -999, x2: 999, y2: 999 });
  });

  it('framePayload carries insetWindow for every template, off by default (byte-identical path when unset)', () => {
    for (const tpl of FRAME_DEFS.templates) {
      const rec = normalizeFrameRecord({ templateId: tpl.id });
      const payload = framePayload(FRAME_DEFS, rec);
      expect(payload.insetWindow).toEqual({ enabled: false, x1: 0, y1: 0, x2: 0, y2: 0 });
    }
  });
});
