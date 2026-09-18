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
