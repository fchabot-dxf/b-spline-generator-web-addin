/**
 * The 2D editor's top floaters (the [2D | 3D] pill, the Height readout) stay off the raised phone drawer (Fred, 390 shots:
 * they covered the drawer's tool row). editor/canvas-floaters.js decides, editor.js sets the class, editor.css hides.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { floatersHaveNoRoom, FLOATER_ROOM_PX, CANVAS_NO_ROOM_CLASS } from '../bspline-frame-builder/b-spline-gen/html/editor/canvas-floaters.js';

const css = readFileSync('bspline-frame-builder/styles/editor.css', 'utf8');
const editorJs = readFileSync('bspline-frame-builder/b-spline-gen/html/editor/editor.js', 'utf8');

describe('canvas floaters vs the phone drawer', () => {
  it('no room once the fixed drawer rises within the declared room of the canvas top (390x844 measured: full drawer top 101, canvas top ~100)', () => {
    expect(floatersHaveNoRoom({ drawerTop: 101, canvasTop: 100, drawerFixed: true })).toBe(true);
    expect(floatersHaveNoRoom({ drawerTop: 100 + FLOATER_ROOM_PX - 1, canvasTop: 100, drawerFixed: true })).toBe(true);
    expect(floatersHaveNoRoom({ drawerTop: 100 + FLOATER_ROOM_PX, canvasTop: 100, drawerFixed: true })).toBe(false);
    expect(floatersHaveNoRoom({ drawerTop: 422, canvasTop: 100, drawerFixed: true })).toBe(false); // half
    expect(floatersHaveNoRoom({ drawerTop: 748, canvasTop: 100, drawerFixed: true })).toBe(false); // peek
  });
  it('a drawer that is not a fixed bottom sheet (landscape, desktop) never hides them', () => {
    expect(floatersHaveNoRoom({ drawerTop: 0, canvasTop: 100, drawerFixed: false })).toBe(false);
  });
  it('the room covers the pill: inset + a 28 px target + margin', () => {
    expect(FLOATER_ROOM_PX).toBeGreaterThanOrEqual(10 + 28 + 10);
  });
  it('editor.js applies the class from the drawer / canvas rects, and editor.css hides both floaters under it', () => {
    expect(editorJs).toContain('floatersHaveNoRoom(');
    expect(editorJs).toContain('classList.toggle(CANVAS_NO_ROOM_CLASS');
    const rule = css.match(new RegExp(String.raw`#editorCanvasContainer\.${CANVAS_NO_ROOM_CLASS} \.view-mode-toggle,\s*#editorCanvasContainer\.${CANVAS_NO_ROOM_CLASS} \.heights-hud \{([^}]*)\}`));
    expect(rule, 'the hiding rule').not.toBeNull();
    expect(rule[1]).toMatch(/visibility:\s*hidden/);
    expect(rule[1]).toMatch(/pointer-events:\s*none/);
  });
});
