/**
 * 2026-10-08 (seat A, measured): the editor's top view (its own 384-wide noise heightmap + shading + the backdrop's
 * PNG encode) was ~0.5 s of a ~1.25 s phone Generate at 4x CPU, though its only reader is the editor's backdrop
 * (sync3DBackground). Now a rebuild with the editor closed only keeps its inputs; the backdrop paints them when it
 * next reads the canvas (editor open). Same inputs, same pixels -- pinned here byte for byte against the eager paint.
 *
 * The test environment has no 2D context (tests/stamp-mask-clear.test.js), so the canvas is a fake that records
 * every putImageData's bytes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { updateEditorTopView, flushEditorTopView } from '../bspline-frame-builder/b-spline-gen/html/core/render-topview.js';

const painted = [];
const ctx = {
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: (img) => painted.push(Uint8ClampedArray.from(img.data)),
  beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {},
  lost: false, isContextLost() { return this.lost; },
};
const listeners = {};
const canvas = { width: 0, height: 0, getContext: () => ctx, addEventListener: (ev, fn) => { listeners[ev] = fn; } };
const modal = { style: { display: 'none' } };
let syncs = 0;

beforeEach(() => {
  painted.length = 0; syncs = 0;
  document.getElementById = (id) => (id === 'svgEditorTopView' ? canvas : id === 'svgEditorModal' ? modal : null);
  window.svgEditor = { sync3DBackground: () => { syncs++; flushEditorTopView(); } };
  flushEditorTopView(); // no deferred paint left over from another test
  painted.length = 0;
});

const eager = () => { modal.style.display = 'flex'; updateEditorTopView(null, 0, 0); modal.style.display = 'none'; return painted.pop(); };

describe('the editor top view paints when the editor reads it, with the same pixels', () => {
  it('a rebuild with the editor closed paints nothing and leaves the backdrop alone', () => {
    updateEditorTopView(null, 0, 0);
    expect(painted.length).toBe(0);
    expect(syncs).toBe(0);
  });

  it('the editor-open read paints exactly the bytes an eager paint of the same board gives', () => {
    const want = eager();
    expect(want.length).toBeGreaterThan(1000);
    updateEditorTopView(null, 0, 0);
    window.svgEditor.sync3DBackground(); // what opening the editor does
    expect(painted).toHaveLength(1);
    expect(Buffer.from(painted[0]).equals(Buffer.from(want))).toBe(true);
  });

  it('the LAST closed rebuild wins: a board changed twice paints the latest, once', () => {
    const seed = P.seed;
    try {
      P.seed = 101; updateEditorTopView(null, 0, 0);
      P.seed = 202; updateEditorTopView(null, 0, 0);
      window.svgEditor.sync3DBackground();
      window.svgEditor.sync3DBackground(); // a second read has nothing left to paint
      expect(painted).toHaveLength(1);
      const got = painted.pop();
      const want = eager();
      expect(Buffer.from(got).equals(Buffer.from(want))).toBe(true);
      P.seed = 101;
      expect(Buffer.from(eager()).equals(Buffer.from(got))).toBe(false); // the seed really changes the pixels
    } finally { P.seed = seed; }
  });

  it('a canvas Chrome restored (cleared) is painted again with the last board: on the next read when closed', () => {
    updateEditorTopView(null, 0, 0);
    window.svgEditor.sync3DBackground();
    const first = painted.pop();
    expect(typeof listeners.contextrestored).toBe('function');
    listeners.contextrestored(); // editor closed: nothing painted yet
    expect(painted).toHaveLength(0);
    window.svgEditor.sync3DBackground();
    expect(painted).toHaveLength(1);
    expect(Buffer.from(painted[0]).equals(Buffer.from(first))).toBe(true);
  });

  it('... and at once (with the backdrop refreshed) when the editor is showing', () => {
    updateEditorTopView(null, 0, 0);
    window.svgEditor.sync3DBackground();
    painted.length = 0; syncs = 0;
    modal.style.display = 'flex';
    try {
      listeners.contextrestored();
      expect(painted).toHaveLength(1);
      expect(syncs).toBe(1);
    } finally { modal.style.display = 'none'; }
  });

  it('a read that finds the context lost paints the last board again instead of reading it as it is', () => {
    updateEditorTopView(null, 0, 0);
    window.svgEditor.sync3DBackground();
    painted.length = 0;
    window.svgEditor.sync3DBackground(); // intact canvas: nothing to paint
    expect(painted).toHaveLength(0);
    ctx.lost = true;
    try {
      window.svgEditor.sync3DBackground();
      expect(painted).toHaveLength(1);
    } finally { ctx.lost = false; }
  });

  it('with the editor showing, a rebuild paints at once and refreshes the backdrop', () => {
    modal.style.display = 'flex';
    try {
      updateEditorTopView(null, 0, 0);
      expect(painted).toHaveLength(1);
      expect(syncs).toBe(1);
    } finally { modal.style.display = 'none'; }
  });
});
