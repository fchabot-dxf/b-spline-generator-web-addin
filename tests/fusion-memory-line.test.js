/**
 * The Fusion memory line (core/fusion-memory-line.js): the add-in's reading before each Send / BUILD
 * (fb_shared/fusion_memory.py) -> one line at the bottom of both palettes. Detection only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { paintFusionMemory } from '../bspline-frame-builder/b-spline-gen/html/core/fusion-memory-line.js';

const line = () => document.getElementById('fusion-memory-line');
beforeEach(() => { document.body.innerHTML = '<div id="fusion-memory-line" class="fusion-memory-line" hidden></div>'; });

describe('the line', () => {
  it('hidden while Fusion is fine (and for an unknown reading)', () => {
    paintFusionMemory({ gb: 5.7, level: 'ok', text: '' });
    expect(line().hidden).toBe(true);
    paintFusionMemory({ gb: null, level: 'ok', text: '' });
    expect(line().hidden).toBe(true);
  });
  it('above the soft threshold: shown, amber, the add-in\'s own words', () => {
    paintFusionMemory({ gb: 13.4, level: 'soft', text: 'Fusion is using 13 GB: save and restart Fusion soon' });
    expect(line().hidden).toBe(false);
    expect(line().dataset.level).toBe('soft');
    expect(line().textContent).toBe('Fusion is using 13 GB: save and restart Fusion soon');
  });
  it('above the hard threshold: red; back under it: hidden again', () => {
    paintFusionMemory({ gb: 30, level: 'hard', text: 'Fusion is using 30 GB: save and restart Fusion soon' });
    expect(line().dataset.level).toBe('hard');
    paintFusionMemory({ gb: 4, level: 'ok', text: '' });
    expect(line().hidden).toBe(true);
    expect(line().dataset.level).toBe(undefined);
  });
});

describe('wired in both palettes', () => {
  it('the B-Spline palette: the element, the stylesheet, main.js paints the add-in\'s fusion_memory', () => {
    const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
    const main = readFileSync('bspline-frame-builder/b-spline-gen/html/main/main.js', 'utf8');
    expect(html).toContain('<div id="fusion-memory-line" class="fusion-memory-line" hidden');
    expect(html).toContain('href="../../styles/fusion-memory.css"');
    expect(main).toMatch(/if \(action === 'fusion_memory'\) \{\s*\n?\s*try \{ paintFusionMemory\(/);
  });
  it('the CAM palette: the element, the stylesheet, the shared module, its handler', () => {
    const html = readFileSync('bspline-frame-builder/CAM-builder/ui/html/cam_builder_palette.html', 'utf8');
    expect(html).toContain('<div id="fusion-memory-line" class="fusion-memory-line" hidden');
    expect(html).toContain('href="../../../styles/fusion-memory.css"');
    expect(html).toContain('<script type="module" src="../../../b-spline-gen/html/core/fusion-memory-line.js"></script>');
    expect(html).toContain("if (action === 'fusion_memory') { if (window.paintFusionMemory) window.paintFusionMemory(payload); return; }");
  });
});
