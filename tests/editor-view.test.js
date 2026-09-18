/**
 * SE2 — pure math for the SVG editor's zoom/pan view record. No svg.js/DOM
 * dependency: viewboxFor and zoomAbout take/return plain {zoom,cx,cy} and
 * {x,y,w,h} objects, so they're tested directly here rather than through
 * the DOM event handlers that call them.
 */
import { describe, it, expect } from 'vitest';
import {
  viewboxFor,
  zoomAbout,
  clampZoom,
  viewScale,
  screenToModelDelta,
  ZOOM_MIN,
  ZOOM_MAX,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-view.js';

const MW = 7;
const MH = 9;

describe('viewboxFor', () => {
  it('zoom 1 shows the whole board', () => {
    const view = { zoom: 1, cx: MW / 2, cy: MH / 2 };
    expect(viewboxFor(view, MW, MH)).toEqual({ x: 0, y: 0, w: MW, h: MH });
  });

  it('zoom 2 centered on the board shows the middle quarter', () => {
    const view = { zoom: 2, cx: MW / 2, cy: MH / 2 };
    const vb = viewboxFor(view, MW, MH);
    expect(vb.w).toBeCloseTo(MW / 2);
    expect(vb.h).toBeCloseTo(MH / 2);
    expect(vb.x).toBeCloseTo(MW / 4);
    expect(vb.y).toBeCloseTo(MH / 4);
  });
});

describe('clampZoom', () => {
  it('clamps below ZOOM_MIN and above ZOOM_MAX', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(5)).toBe(5);
  });
});

describe('zoomAbout', () => {
  // Screen -> model mapping using the exact px/viewbox.width/clientWidth
  // relationship already established in editor-hit.js's getDynamicTolerance,
  // so this test reflects the same convention the app itself uses, without
  // needing svg.js or a real DOM.
  function screenToModel(view, screenPt, clientWidth, clientHeight) {
    const vb = viewboxFor(view, MW, MH);
    return {
      x: vb.x + (screenPt.x / clientWidth) * vb.w,
      y: vb.y + (screenPt.y / clientHeight) * vb.h,
    };
  }

  it('keeps the cursor\'s model point fixed on screen after zooming in', () => {
    const clientWidth = 800;
    const clientHeight = 800 * MH / MW;
    const view0 = { zoom: 1, cx: MW / 2, cy: MH / 2 };
    const screenPt = { x: 200, y: 150 }; // off-center, so this actually exercises the shift

    const modelBefore = screenToModel(view0, screenPt, clientWidth, clientHeight);
    const view1 = zoomAbout(view0, modelBefore, 2); // zoom in 2x
    const modelAfter = screenToModel(view1, screenPt, clientWidth, clientHeight);

    expect(view1.zoom).toBeCloseTo(2);
    expect(modelAfter.x).toBeCloseTo(modelBefore.x, 9);
    expect(modelAfter.y).toBeCloseTo(modelBefore.y, 9);
  });

  it('keeps the cursor\'s model point fixed on screen after zooming out', () => {
    const clientWidth = 640;
    const clientHeight = 640 * MH / MW;
    const view0 = { zoom: 4, cx: 3, cy: 5 };
    const screenPt = { x: 480, y: 100 };

    const modelBefore = screenToModel(view0, screenPt, clientWidth, clientHeight);
    const view1 = zoomAbout(view0, modelBefore, 0.5); // zoom out 2x
    const modelAfter = screenToModel(view1, screenPt, clientWidth, clientHeight);

    expect(view1.zoom).toBeCloseTo(2);
    expect(modelAfter.x).toBeCloseTo(modelBefore.x, 9);
    expect(modelAfter.y).toBeCloseTo(modelBefore.y, 9);
  });

  it('clamps the resulting zoom to [ZOOM_MIN, ZOOM_MAX] instead of exceeding it', () => {
    const view0 = { zoom: 1, cx: MW / 2, cy: MH / 2 };
    const zoomedOut = zoomAbout(view0, { x: MW / 2, y: MH / 2 }, 0.01);
    expect(zoomedOut.zoom).toBe(ZOOM_MIN);

    const view1 = { zoom: ZOOM_MAX, cx: MW / 2, cy: MH / 2 };
    const zoomedIn = zoomAbout(view1, { x: MW / 2, y: MH / 2 }, 100);
    expect(zoomedIn.zoom).toBe(ZOOM_MAX);
  });
});

/**
 * T5 — the editor root is created with no `preserveAspectRatio` override
 * (`editor/init.js`: `window.SVG().addTo(...).size('100%','100%')`), so it
 * renders under SVG's default `xMidYMid meet`: ONE uniform scale on both
 * axes, letterboxed on whichever axis the container is proportionally
 * larger on. `_panBy` (editor-interaction.js) and `getDynamicTolerance`
 * (editor-hit.js) used to divide `clientWidth`/`clientHeight` PER AXIS
 * instead — correct on the binding axis, wrong on the letterboxed one.
 * Confirmed no `preserveAspectRatio="none"` override exists on the live
 * editor root (only on export/save SVG strings in editor-io.js, a
 * different, unrelated surface) — `grep -rn "preserveAspectRatio" editor/`.
 */
describe('viewScale — proves the old per-axis formula disagreed with the real (letterboxed) render', () => {
  const vb = { w: MW, h: MH }; // 7 x 9 board

  // The formula _panBy/getDynamicTolerance used before this fix — kept here
  // ONLY as a reference to prove the disagreement, not imported from product
  // code (it no longer exists there).
  function oldPerAxisDelta(clientW, clientH, dxPx, dyPx) {
    return { dx: dxPx * vb.w / clientW, dy: dyPx * vb.h / clientH };
  }

  it('a TALL container (letterboxed on height) — old dy formula was 51.8% off', () => {
    const clientW = 300, clientH = 800; // width is the binding axis
    const s = viewScale(vb, clientW, clientH);
    expect(s).toBeCloseTo(clientW / vb.w); // width wins (smaller ratio)

    const correct = screenToModelDelta(vb, clientW, clientH, 100, 100);
    const old = oldPerAxisDelta(clientW, clientH, 100, 100);

    expect(old.dx).toBeCloseTo(correct.dx); // binding axis: old formula agreed
    expect(old.dy).not.toBeCloseTo(correct.dy, 1); // letterboxed axis: it didn't
    expect(old.dy / correct.dy).toBeCloseTo(0.4821, 3); // ~51.8% too small
  });

  it('a WIDE container (letterboxed on width) — old dx formula was 74.1% off', () => {
    const clientW = 1200, clientH = 400; // height is the binding axis
    const s = viewScale(vb, clientW, clientH);
    expect(s).toBeCloseTo(clientH / vb.h);

    const correct = screenToModelDelta(vb, clientW, clientH, 100, 100);
    const old = oldPerAxisDelta(clientW, clientH, 100, 100);

    expect(old.dy).toBeCloseTo(correct.dy); // binding axis: agreed
    expect(old.dx).not.toBeCloseTo(correct.dx, 1); // letterboxed axis: didn't
    expect(old.dx / correct.dx).toBeCloseTo(0.2593, 3); // ~74.1% too small
  });

  it('a container matching the board aspect exactly — old and new formulas agree on both axes', () => {
    const clientW = 700, clientH = 900; // same 7:9 ratio as the board — no letterboxing
    const correct = screenToModelDelta(vb, clientW, clientH, 50, 30);
    const old = oldPerAxisDelta(clientW, clientH, 50, 30);
    expect(old.dx).toBeCloseTo(correct.dx);
    expect(old.dy).toBeCloseTo(correct.dy);
  });
});

describe('screenToModelDelta', () => {
  it('round-trips: converting a pan delta and scaling back by viewScale returns the pixel delta', () => {
    const vb = { w: MW, h: MH };
    const clientW = 460, clientH = 600; // the docked-palette scenario from the dispatch
    const s = viewScale(vb, clientW, clientH);
    const { dx, dy } = screenToModelDelta(vb, clientW, clientH, 37, 51);
    expect(dx * s).toBeCloseTo(37);
    expect(dy * s).toBeCloseTo(51);
  });

  it('uses the SAME scale for both axes regardless of which is letterboxed', () => {
    const vb = { w: MW, h: MH };
    const tall = screenToModelDelta(vb, 300, 800, 10, 10);
    // Equal pixel deltas on both axes must produce equal model deltas too,
    // since the scale is uniform (this would fail under the old per-axis
    // formula whenever the container isn't the board's exact aspect).
    expect(tall.dx).toBeCloseTo(tall.dy);
  });
});
