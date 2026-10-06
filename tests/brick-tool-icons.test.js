/**
 * F35 item 24: one monochrome icon per Brick tool -- the tool's glyph + a miniature of what it leaves on the board,
 * laid by the real engine (editor/brick-tool-icons.js, editor-brick-tool.js toolMiniBricks). currentColor only, so
 * the button's idle / active colour drives it. Step 2 (Fred's picks): WIRED -- BRICK_TOOLS / PHOTO_TOOLS declare
 * `iconSvg`, the tool registry renders it; the Raised brush = the 3-brick run, MIDDLE brick raised.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BRICK_TOOL_ICONS, brickToolIconSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/brick-tool-icons.js';
import { PHOTO_TOOL_ICONS, photoToolIconSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/photo-tool-icons.js';
import { renderToolRegistry } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-tool-registry.js';
import { toolMiniBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const TOOLS = ['brush', 'raisedBrush', 'wall', 'frame', 'scissors', 'stripe']; // main/brick-panel.js BRICK_TOOLS
const parse = (svg) => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('Brick tool icons', () => {
  it('one icon per Brick tool, in the editor icon box (24 units), at the asked size', () => {
    expect(Object.keys(BRICK_TOOL_ICONS)).toEqual([...TOOLS, 'general']); // item 43: + the General tab's
    for (const id of TOOLS) {
      const svg = brickToolIconSvg(id, 40);
      expect(svg, id).toMatch(/^<svg[^>]*viewBox="0 0 24 24" width="40" height="40"/);
    }
    expect(brickToolIconSvg('nope')).toBe(null);
  });
  it('item 43: the General tab icon is a glyph only (three sliders), no miniature', () => {
    const svg = brickToolIconSvg('general', 18);
    expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 24 24" width="18" height="18"/);
    expect(svg).not.toMatch(/<polygon/);
    expect((svg.match(/<circle/g) || []).length).toBe(3);
  });
  it('every miniature is laid by the engine: real parsed polygons, inside the 24 box', () => {
    for (const id of TOOLS) {
      const polys = [...parse(brickToolIconSvg(id)).querySelectorAll('polygon')];
      expect(polys.length, id).toBeGreaterThanOrEqual(3); // the Raised brush: a 3-brick run
      for (const p of polys) {
        for (const pair of p.getAttribute('points').split(' ')) {
          const [x, y] = pair.split(',').map(Number);
          expect(x).toBeGreaterThanOrEqual(-0.01); expect(x).toBeLessThanOrEqual(24.01);
          expect(y).toBeGreaterThanOrEqual(-0.01); expect(y).toBeLessThanOrEqual(24.01);
        }
      }
    }
    for (const kind of ['wall', 'run', 'runLong', 'band3', 'frame']) expect(toolMiniBricks(kind).length, kind).toBeGreaterThan(3);
    expect(toolMiniBricks('row3')).toHaveLength(3);
  });
  it('monochrome: currentColor only (no fixed colour), so idle / active colour the whole icon', () => {
    for (const id of TOOLS) expect(brickToolIconSvg(id)).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
  });
  it('the tool metaphors: a brush on both brushes, scissors on Scissors, a gap in the cut run, hollow runs on Stripe', () => {
    expect(BRICK_TOOL_ICONS.raisedBrush.glyph).toBe(BRICK_TOOL_ICONS.brush.glyph); // the same paintbrush, no arrow
    expect(brickToolIconSvg('scissors')).toMatch(/<circle/);
    expect(brickToolIconSvg('stripe')).toMatch(/fill="none" stroke-width="1"/);
    const all = toolMiniBricks('runLong').length;
    const drawn = parse(brickToolIconSvg('scissors')).querySelectorAll('polygon').length;
    expect(drawn).toBeLessThan(all); // the cut leaves a gap
  });
  it('all six icons differ', () => {
    expect(new Set(TOOLS.map((id) => brickToolIconSvg(id))).size).toBe(6);
  });
});

describe('item 24 step 2: wired (Fred: Raised = 3 bricks, the middle one raised; the Photo toolbar too)', () => {
  it('the Raised brush: 3 bricks, the MIDDLE one highest with its side face, the paintbrush, no arrow', () => {
    const doc = parse(brickToolIconSvg('raisedBrush', 40));
    const polys = [...doc.querySelectorAll('polygon')];
    expect(polys).toHaveLength(3);
    const top = (p) => Math.min(...p.getAttribute('points').split(' ').map((q) => +q.split(',')[1]));
    const tops = polys.map(top); // drawn left to right
    expect(Math.min(...tops)).toBe(tops[1]);
    expect(tops.filter((t) => t === tops[1])).toHaveLength(1);
    expect(doc.querySelectorAll('rect[opacity]')).toHaveLength(1); // the side face
    expect(brickToolIconSvg('raisedBrush')).not.toMatch(/M20\.5 22v-6\.5/);
  });
  it('the Photo tools: one line icon each, in the same 24 box, currentColor only, all different', () => {
    expect(Object.keys(PHOTO_TOOL_ICONS)).toEqual(['crop', 'straighten', 'rotateFlip', 'levels', 'blur']);
    const svgs = Object.keys(PHOTO_TOOL_ICONS).map((id) => photoToolIconSvg(id, 20));
    for (const svg of svgs) {
      expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 24 24" width="20" height="20"/);
      expect(svg).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
      expect(parse(svg).querySelector('parsererror')).toBeNull();
    }
    expect(new Set(svgs).size).toBe(5);
    expect(photoToolIconSvg('nope')).toBe(null);
  });
  it('the registry renders a declared iconSvg (the text icon stays the fallback); every Brick + Photo tool declares one', () => {
    const box = document.createElement('div');
    renderToolRegistry(box, [{ id: 'a', buttonId: 'tA', label: 'A', icon: 'x', iconSvg: () => brickToolIconSvg('wall') }, { id: 'b', buttonId: 'tB', label: 'B', icon: 'y' }], () => {});
    expect(box.querySelector('#tA svg')).toBeTruthy();
    expect(box.querySelector('#tB').textContent).toBe('y');
    const brickPanel = readFileSync('bspline-frame-builder/b-spline-gen/html/main/brick-panel.js', 'utf-8');
    for (const id of Object.keys(BRICK_TOOL_ICONS)) expect(brickPanel).toContain(`iconSvg: () => brickToolIconSvg('${id}')`);
    const photoPanel = readFileSync('bspline-frame-builder/b-spline-gen/html/main/photo-panel.js', 'utf-8');
    for (const id of Object.keys(PHOTO_TOOL_ICONS)) expect(photoPanel).toContain(`iconSvg: () => photoToolIconSvg('${id}')`);
  });
  it('the Artwork-only bold-stroke rule no longer reaches a registry icon (it would turn the white icon dark)', () => {
    const css = readFileSync('bspline-frame-builder/styles/editor.css', 'utf-8');
    expect(css).toMatch(/\.tool-btn\.active:not\(\.tool-btn-registry\) svg \{/);
    expect(css.split(String.fromCharCode(10)).some((l) => l.startsWith('.tool-btn.active svg {'))).toBe(false); // the old unscoped rule is gone
    expect(css).toMatch(/\.tool-btn-registry\.active \{[^}]*color: white/);
  });
});
