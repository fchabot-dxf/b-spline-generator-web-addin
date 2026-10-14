import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { updateCanvasHeights } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

describe('CANVAS-HEIGHTS: live base and total height measurement on canvas', () => {
  let root;

  beforeEach(() => {
    root = document.createElement('div');
    root.id = 'test-root';
    root.innerHTML = `
      <div id="previewArea">
        <div id="canvasTotalHeights">
          <span id="canvasBaseHeight">0.000</span>
          <span id="canvasTotalHeight">0.000</span>
        </div>
        <div id="heightInspector">
          <span id="inspectorBaseHeight">0.000</span>
          <span id="inspectorTotalHeight">0.000</span>
        </div>
      </div>
      <div id="editorCanvasContainer">
        <div id="editorCanvasTotalHeights">
          <span id="editorCanvasBaseHeight">0.000</span>
          <span id="editorCanvasTotalHeight">0.000</span>
        </div>
      </div>
    `;
    document.body.appendChild(root);
  });

  afterEach(() => {
    root?.remove();
  });

  it('updates canvas and inspector elements with base height and total height', () => {
    const baseHeights = new Float32Array([0.1, 0.5, 0.85, 0.2]); // span = 0.85 - 0.1 = 0.750
    const heights = new Float32Array([0.0, 0.6, 1.25, 0.1]); // span = 1.25 - 0.0 = 1.250

    updateCanvasHeights(baseHeights, heights, null);

    expect(document.getElementById('canvasBaseHeight').textContent).toBe('0.750');
    expect(document.getElementById('canvasTotalHeight').textContent).toBe('1.250');
    expect(document.getElementById('editorCanvasBaseHeight').textContent).toBe('0.750');
    expect(document.getElementById('editorCanvasTotalHeight').textContent).toBe('1.250');
    expect(document.getElementById('inspectorBaseHeight').textContent).toBe('0.750');
    expect(document.getElementById('inspectorTotalHeight').textContent).toBe('1.250');
  });

  it('includes bottom offset points when thicken is active', () => {
    const baseHeights = new Float32Array([0.2, 0.4]); // span = 0.200
    const heights = new Float32Array([0.3, 0.7]); // top span = 0.400
    // bottom offset surface points with z = -0.25
    const thickenData = {
      offsetPts: new Float32Array([
        0, 0, -0.25,
        1, 1, 0.1,
      ]),
    };

    updateCanvasHeights(baseHeights, heights, thickenData);

    expect(document.getElementById('canvasBaseHeight').textContent).toBe('0.200');
    // total span from -0.25 to 0.7 = 0.950
    expect(document.getElementById('canvasTotalHeight').textContent).toBe('0.950');
  });

  it('handles flat zero terrains gracefully', () => {
    const baseHeights = new Float32Array([0, 0, 0]);
    const heights = new Float32Array([0, 0, 0]);

    updateCanvasHeights(baseHeights, heights, null);

    expect(document.getElementById('canvasBaseHeight').textContent).toBe('0.000');
    expect(document.getElementById('canvasTotalHeight').textContent).toBe('0.000');
  });
});
