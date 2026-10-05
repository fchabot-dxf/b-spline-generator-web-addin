/**
 * F35 item 24 (step 1, the icon sheet): one monochrome icon per Brick tool -- the tool's glyph + a miniature of
 * what it leaves on the board, laid by the real engine (editor/brick-tool-icons.js, editor-brick-tool.js
 * toolMiniBricks). currentColor only, so the button's idle / active colour drives it. Not wired yet (step 2).
 */
import { describe, it, expect } from 'vitest';
import { BRICK_TOOL_ICONS, brickToolIconSvg, RAISED_DEPTHS } from '../bspline-frame-builder/b-spline-gen/html/editor/brick-tool-icons.js';
import { toolMiniBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const TOOLS = ['brush', 'raisedBrush', 'wall', 'frame', 'scissors', 'stripe']; // main/brick-panel.js BRICK_TOOLS
const parse = (svg) => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('Brick tool icons', () => {
  it('one icon per Brick tool, in the editor icon box (24 units), at the asked size', () => {
    expect(Object.keys(BRICK_TOOL_ICONS)).toEqual(TOOLS);
    for (const id of TOOLS) {
      const svg = brickToolIconSvg(id, 40);
      expect(svg, id).toMatch(/^<svg[^>]*viewBox="0 0 24 24" width="40" height="40"/);
    }
    expect(brickToolIconSvg('nope')).toBe(null);
  });
  it('every miniature is laid by the engine: real parsed polygons, inside the 24 box', () => {
    for (const id of TOOLS) {
      const polys = [...parse(brickToolIconSvg(id)).querySelectorAll('polygon')];
      expect(polys.length, id).toBeGreaterThan(3);
      for (const p of polys) {
        for (const pair of p.getAttribute('points').split(' ')) {
          const [x, y] = pair.split(',').map(Number);
          expect(x).toBeGreaterThanOrEqual(-0.01); expect(x).toBeLessThanOrEqual(24.01);
          expect(y).toBeGreaterThanOrEqual(-0.01); expect(y).toBeLessThanOrEqual(24.01);
        }
      }
    }
    for (const kind of ['wall', 'run', 'runLong', 'band3', 'frame']) expect(toolMiniBricks(kind).length, kind).toBeGreaterThan(3);
  });
  it('monochrome: currentColor only (no fixed colour), so idle / active colour the whole icon', () => {
    for (const id of TOOLS) expect(brickToolIconSvg(id)).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
  });
  it('the tool metaphors: a brush on both brushes, scissors on Scissors, a gap in the cut run, hollow runs on Stripe', () => {
    expect(BRICK_TOOL_ICONS.brush.glyph).toBe(BRICK_TOOL_ICONS.raisedBrush.glyph.slice(0, BRICK_TOOL_ICONS.brush.glyph.length));
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

describe('sheet v2: the Raised brush depth treatments (Fred: "needs a bit more perspective")', () => {
  it('each declared treatment draws something UNDER the run (offset copies, a shadow band, side faces), still currentColor', () => {
    expect(Object.keys(RAISED_DEPTHS)).toEqual(['extrude', 'shadow', 'sides']);
    const flat = parse(brickToolIconSvg('raisedBrush', 20, { lifted: false })).querySelectorAll('*').length;
    for (const id of Object.keys(RAISED_DEPTHS)) {
      const svg = brickToolIconSvg('raisedBrush', 20, { lifted: false, depth: id });
      expect(parse(svg).querySelectorAll('*').length, id).toBeGreaterThan(flat);
      expect(svg, id).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
    }
    expect(brickToolIconSvg('raisedBrush')).toBe(brickToolIconSvg('raisedBrush', 20, null)); // no override = the declared icon
  });
});
