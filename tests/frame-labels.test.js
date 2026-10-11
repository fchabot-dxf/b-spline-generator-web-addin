/**
 * Fred (2026-10-11): the two "Frame"s are named apart -- the WOOD frame (the board's milled frame) and the BRICK frame (the
 * brick bands along it) -- from ONE table, core/frame-labels.js FRAME_LABELS. Static page text carries
 * data-frame-label and is written by applyFrameLabels; code reads the table. Ids never change.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FRAME_LABELS, applyFrameLabels } from '../bspline-frame-builder/b-spline-gen/html/core/frame-labels.js';
import { EDITOR_TABS } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { BRICK_KIND_LAYERS } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { SVG_EXPORT_GROUPS } from '../bspline-frame-builder/b-spline-gen/html/editor/svg-export.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf-8');

describe('the wood frame and the brick frame, named from one table', () => {
  it('declared: Wood frame / Brick frame', () => {
    expect(FRAME_LABELS).toEqual({ wood: 'Wood frame', brick: 'Brick frame' });
  });

  it('the page: every data-frame-label names a table key; applyFrameLabels writes the text (ids unchanged)', () => {
    document.body.innerHTML = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
    const marked = [...document.querySelectorAll('[data-frame-label]')];
    expect(marked.length).toBeGreaterThanOrEqual(6);
    for (const el of marked) expect(Object.keys(FRAME_LABELS)).toContain(el.dataset.frameLabel);
    for (const el of marked) el.textContent = 'x';
    applyFrameLabels(document);
    expect(document.getElementById('editorTabFrame').textContent).toBe(FRAME_LABELS.wood); // the editor's top tab, id kept
    expect(document.getElementById('framePanelHeader').textContent).toContain(FRAME_LABELS.wood); // sidebar Board > Wood frame
    for (const el of marked) expect(el.textContent).toBe(FRAME_LABELS[el.dataset.frameLabel]);
  });

  it('no bare "Frame" label is left in the page text (a sweep of the visible text nodes)', () => {
    const body = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    expect(body).not.toMatch(/>\s*(🖼\s*)?(Frame|FRAME)\s*</);
  });

  it('code reads the table: the editor tab, the brick kind layer, the SVG file groups', () => {
    expect(EDITOR_TABS.find((t) => t.id === 'frame').label).toBe(FRAME_LABELS.wood);
    expect(BRICK_KIND_LAYERS.frame.name).toBe(FRAME_LABELS.brick);
    expect(SVG_EXPORT_GROUPS.find((g) => g.id === 'frame').label).toBe(FRAME_LABELS.wood);
  });
});
