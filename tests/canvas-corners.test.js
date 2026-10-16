/**
 * The canvases' corners, declared (main/canvas-corners.js; Fred 2026-10-14, desktop: the 2D/3D toggle sat on top of the
 * heights HUD, both pinned top-left). A corner with several items is one stack, in the declared order: they can never
 * collide. Runs on the REAL palette markup.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CANVAS_CORNERS, applyCanvasCorners, cornerPos } from '../bspline-frame-builder/b-spline-gen/html/main/canvas-corners.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);

beforeEach(() => {
  document.body.innerHTML = BODY;
  // main/view-mode-toggle.js renderPill's own pin (top-left, absolute), on both hosts
  for (const host of ['previewArea', 'editorCanvasContainer']) {
    const pill = document.createElement('div');
    pill.className = 'view-mode-toggle';
    pill.style.cssText = 'position:absolute; top:10px; left:10px;';
    $(host).appendChild(pill);
  }
});

describe('the canvas corners', () => {
  it('every declared item is on the page', () => {
    expect(applyCanvasCorners()).toEqual([]);
  });
  it('top-left: the 2D/3D toggle, THEN the heights readout, in one stack (no longer both pinned at the same spot)', () => {
    applyCanvasCorners();
    for (const [host, hud] of [['previewArea', 'canvasTotalHeights'], ['editorCanvasContainer', 'editorCanvasTotalHeights']]) {
      const stack = $(host).querySelector(':scope > .canvas-corner-stack[data-corner="top-left"]');
      expect([...stack.children].map((c) => c.id || c.className), host).toEqual(['view-mode-toggle', hud]);
      for (const c of stack.children) { expect(c.style.position, c.id).toBe('static'); expect(c.style.top, c.id).toBe(''); }
      expect(stack.style.flexDirection).toBe('column');
    }
  });
  it('a corner a component places itself (the view cube, Fit) is declared, and no stack is put there', () => {
    applyCanvasCorners();
    for (const [host, corners] of Object.entries(CANVAS_CORNERS)) {
      for (const [corner, items] of Object.entries(corners)) {
        if (Array.isArray(items)) continue;
        expect($(host).querySelector(`.canvas-corner-stack[data-corner="${corner}"]`), `${host} ${corner}`).toBeNull();
      }
    }
    expect(CANVAS_CORNERS.previewArea['top-right'].own).toMatch(/view cube/);
  });
  it('a click-through readout stays click-through (the height inspector); the toggle takes clicks', () => {
    applyCanvasCorners();
    expect($('heightInspector').style.pointerEvents).toBe('none');
    expect($('previewArea').querySelector('.view-mode-toggle').style.pointerEvents).toBe('auto');
  });
  it('a bottom corner sits above the job timeline strip (--job-strip-height), a top one does not', () => {
    expect(cornerPos('bottom-left')).toContain('bottom:calc(10px + var(--job-strip-height, 0px))');
    expect(cornerPos('top-left')).toContain('top:10px;');
  });
  it('the heights HUD is a floating label (Fred 2026-10-16): no panel/background markup, no "Model Heights"/"Base H" visible text -- just "H <total>"', () => {
    for (const id of ['canvasTotalHeights', 'editorCanvasTotalHeights']) {
      const el = $(id);
      expect(el.classList.contains('heights-hud'), id).toBe(true);
      expect(el.style.background, id).toBe('');
      expect(el.style.padding, id).toBe('');
      expect(el.style.border, id).toBe('');
      expect(el.textContent.replace(/\s+/g, ' ').trim(), id).toMatch(/^H 0\.000"$/);
    }
  });
  it('the readout\'s base height is kept in its own title tooltip (nothing lost when the visible Base line was removed)', () => {
    expect($('canvasTotalHeights').hasAttribute('title')).toBe(true);
    expect($('editorCanvasTotalHeights').hasAttribute('title')).toBe(true);
  });
  it('applying twice moves nothing twice', () => {
    applyCanvasCorners(); applyCanvasCorners();
    expect($('previewArea').querySelectorAll('.canvas-corner-stack[data-corner="top-left"]').length).toBe(1);
    expect($('previewArea').querySelector('.canvas-corner-stack[data-corner="top-left"]').children.length).toBe(2);
  });
  it('the app applies them once the 2D/3D toggle exists (main.js, right after initViewModeToggle)', () => {
    const main = readFileSync('bspline-frame-builder/b-spline-gen/html/main/main.js', 'utf8');
    expect(main).toMatch(/initViewModeToggle\(\);\s*applyCanvasCorners\(\);/);
  });
});
