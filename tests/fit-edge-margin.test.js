/**
 * Fred 2026-10-09 (seat D's phone measure, the editor's Fit at 390 px: the board ran 11 px past BOTH screen edges and 11 of
 * 19 templates put a frame handle inside the 24 px OS edge-gesture zone, two at 3 px): on a coarse pointer Fit keeps the
 * fitted region's left / right edges FIT_EDGE_MARGIN_PX.coarse inside the visible canvas; a mouse keeps today's Fit.
 * editor-view.js edgeMarginZoom is the pure part (the live part is the matrix's layout row on the real page).
 */
import { describe, it, expect } from 'vitest';
import { edgeMarginZoom, FIT_EDGE_MARGIN_PX, viewboxFor, viewScale } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-view.js';

// the screen x of a model x under a view, in an svg box `el` ("meet": uniform scale, centred)
const screenX = (view, mW, mH, el, x) => {
  const vb = viewboxFor(view, mW, mH), s = viewScale(vb, el.width, el.height);
  return el.left + el.width / 2 + (x - view.cx) * s;
};

describe('FIT_EDGE_MARGIN_PX: a coarse pointer fits inside the edge-gesture zone, a mouse as before', () => {
  it('declared per pointer: coarse 28 px (outside a ~24 px OS zone), fine 0', () => {
    expect(FIT_EDGE_MARGIN_PX).toEqual({ fine: 0, coarse: 28 });
  });

  it('the measured phone case: a 7 x 9 board in a 412 px svg starting 11 px off-screen -> both edges 28 px inside', () => {
    const el = { left: -11, width: 412, height: 2000 }, visible = { left: 0, right: 390 }, base = { zoom: 1, cx: 3.5, cy: 4.5 };
    expect(screenX(base, 7, 9, el, 0)).toBeCloseTo(-11, 6); // today: the board's left edge off-screen
    const f = edgeMarginZoom(base, 7, 9, el, visible, 28);
    expect(f).toBeLessThan(1);
    const v = { ...base, zoom: base.zoom * f };
    expect(screenX(v, 7, 9, el, 0)).toBeCloseTo(28, 6);
    expect(screenX(v, 7, 9, el, 7)).toBeCloseTo(390 - 28, 6);
  });

  it('no margin (a mouse) or a board already inside: unchanged -- the margin never zooms IN', () => {
    const el = { left: -11, width: 412, height: 2000 }, visible = { left: 0, right: 390 }, base = { zoom: 1, cx: 3.5, cy: 4.5 };
    expect(edgeMarginZoom(base, 7, 9, el, visible, 0)).toBe(1);
    const roomy = { left: 0, width: 390, height: 300 }; // height-bound: the board is narrower than the screen
    expect(edgeMarginZoom(base, 7, 9, roomy, { left: 0, right: 390 }, 28)).toBe(1);
  });

  it("a frame's fitted region (narrower than the board) keeps ITS edges inside, not the board's", () => {
    const el = { left: 0, width: 390, height: 2000 }, visible = { left: 0, right: 390 };
    const base = { zoom: 7 / 5, cx: 3.5, cy: 4.5 }; // the frame region x 1..6 fitted to the width
    const f = edgeMarginZoom(base, 7, 9, el, visible, 28, 1, 6);
    const v = { ...base, zoom: base.zoom * f };
    expect(screenX(v, 7, 9, el, 1)).toBeCloseTo(28, 6);
    expect(screenX(v, 7, 9, el, 6)).toBeCloseTo(390 - 28, 6);
  });
});
