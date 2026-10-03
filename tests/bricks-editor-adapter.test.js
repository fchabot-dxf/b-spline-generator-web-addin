/**
 * F35 item 1 — editor/editor-brick-tool.js: the one pure, DOM-free piece of
 * the brick-tab adapter (primitivesToPolyline). The rest (ensureBricksLayer,
 * runWallTool/runFrameTool, brickBrushHandler) is svg.js/DOM-dependent, like
 * main/photo-panel.js's own DOM wiring, and verified live instead (see
 * WORK-LOG-fb-app.md's F35 item 1 entry for the headless-Chrome pass).
 */
import { describe, it, expect } from 'vitest';
import { primitivesToPolyline } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

describe('primitivesToPolyline: contour-from-frame.js primitives -> a flat polyline + corner indices', () => {
  it('a square made of 4 L primitives becomes 4 points, each its own corner', () => {
    const square = [
      { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 4, y: 0 } },
      { type: 'L', p0: { x: 4, y: 0 }, p1: { x: 4, y: 4 } },
      { type: 'L', p0: { x: 4, y: 4 }, p1: { x: 0, y: 4 } },
      { type: 'L', p0: { x: 0, y: 4 }, p1: { x: 0, y: 0 } },
    ];
    const { points, cornerIndices } = primitivesToPolyline(square);
    expect(points).toEqual([
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 },
    ]);
    expect(cornerIndices).toEqual([0, 1, 2, 3]);
  });

  it('an empty/undefined primitives list produces an empty polyline, not a throw', () => {
    expect(primitivesToPolyline([])).toEqual({ points: [], cornerIndices: [] });
    expect(primitivesToPolyline(undefined)).toEqual({ points: [], cornerIndices: [] });
  });

  it('an A (arc) primitive is subdivided into multiple points along the true arc, not collapsed to its endpoints', () => {
    // A quarter circle, radius 2, centered at origin, 0 -> 90 degrees.
    const arc = [{ type: 'A', cx: 0, cy: 0, rx: 2, ry: 2, theta1: 0, dTheta: Math.PI / 2 }];
    const { points, cornerIndices } = primitivesToPolyline(arc);
    expect(cornerIndices).toEqual([0]);
    expect(points.length).toBeGreaterThan(2); // genuinely subdivided, not just 2 endpoints
    // Every sampled point must actually sit ON the declared circle (radius 2 from origin) --
    // this is the property a lazy "just return the 2 endpoints" implementation would still
    // pass for the FIRST point but not catch a wrong radius/center for interior points.
    for (const p of points) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(2, 9);
    }
    // First sampled point is the arc's own start (theta1=0 -> (2,0)); the true end
    // (theta=90deg -> (0,2)) is NOT included (that's the START of whatever primitive
    // follows, consistent with the L-primitive case only emitting its OWN start point).
    expect(points[0]).toEqual({ x: 2, y: 0 });
  });

  it('mixed L + A primitives concatenate in order, corner indices tracking each primitive\'s own start', () => {
    const mixed = [
      { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 2, y: 0 } },
      { type: 'A', cx: 2, cy: 2, rx: 2, ry: 2, theta1: -Math.PI / 2, dTheta: Math.PI / 2 },
    ];
    const { points, cornerIndices } = primitivesToPolyline(mixed);
    expect(cornerIndices[0]).toBe(0); // the L's own start
    expect(cornerIndices[1]).toBe(1); // the A's own start, right after the L's single point
    expect(points.length).toBe(1 + 16); // 1 for the straight edge + ARC_STEPS for the arc
  });
});
