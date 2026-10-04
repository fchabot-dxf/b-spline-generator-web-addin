/**
 * Audit v2 N1: after a reload / project load, every brick drew NOTHING -- its fill pointed at a <pattern> in
 * the editor's outer <defs>, which the saved document does not carry. editor-io.js open() now calls
 * repaintBricks, which re-derives each brick's fill (and its pattern) from the brick's own attributes.
 */
import { describe, it, expect } from 'vitest';
import { repaintBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const NS = 'http://www.w3.org/2000/svg';
describe('repaintBricks (N1)', () => {
  it('a restored brick whose pattern is gone is painted again from its set / sample / flip', () => {
    const svg = document.createElementNS(NS, 'svg');
    const g = document.createElementNS(NS, 'g');
    svg.appendChild(g);
    document.body.appendChild(svg);
    const sample = brickSetById(1).samples[0].id;
    const brick = document.createElementNS(NS, 'polygon');
    for (const [k, v] of [['data-brick-gen', '1'], ['data-brick', 'wall'], ['data-brick-set', '1'], ['data-brick-sample', sample],
      ['data-brick-flip', '0'], ['fill', 'url(#brickfill-gone-7)'], ['points', '0,0 1,0 1,0.3 0,0.3']]) brick.setAttribute(k, v);
    const spine = document.createElementNS(NS, 'line'); // a brush spine is not a painted brick
    spine.setAttribute('data-brick', 'brush-spine');
    g.append(brick, spine);
    expect(svg.querySelector('#brickfill-gone-7')).toBeNull();
    expect(repaintBricks({ _sketchLayer: { node: g } })).toBe(1);
    const id = brick.getAttribute('fill').match(/^url\(#(.+)\)$/)[1];
    expect(svg.querySelector(`#${id}`)?.tagName.toLowerCase()).toBe('pattern');
    expect(spine.hasAttribute('fill')).toBe(false);
    svg.remove();
  });
  it('no sketch layer -> 0, no throw', () => {
    expect(repaintBricks(null)).toBe(0);
    expect(repaintBricks({})).toBe(0);
  });
});
