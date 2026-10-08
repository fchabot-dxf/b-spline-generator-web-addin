/**
 * Audit v2 N1: after a reload / project load, every brick drew NOTHING -- its fill pointed at a <pattern> in
 * the editor's outer <defs>, which the saved document does not carry. editor-io.js open() calls repaintBricks.
 * Fred 2026-10-08 ("Yes, grey only"): a restored brick comes back NEUTRAL grey (whatever fill it was saved with --
 * an old photo pattern, a set colour); its height greys follow from its layer's mask (tests/brick-height-grey.test.js).
 */
import { describe, it, expect } from 'vitest';
import { repaintBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { NEUTRAL_BRICK_GREY } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/height-grey.js';

const NS = 'http://www.w3.org/2000/svg';
describe('repaintBricks (N1)', () => {
  it('a restored brick (an old photo pattern or set colour) is painted neutral grey; a brush spine is left alone', () => {
    const svg = document.createElementNS(NS, 'svg');
    const g = document.createElementNS(NS, 'g');
    svg.appendChild(g);
    document.body.appendChild(svg);
    const brick = (fill) => {
      const b = document.createElementNS(NS, 'polygon');
      for (const [k, v] of [['data-brick-gen', '1'], ['data-brick', 'wall'], ['data-brick-set', '1'], ['data-layer', '2'],
        ['fill', fill], ['points', '0,0 1,0 1,0.3 0,0.3']]) b.setAttribute(k, v);
      return b;
    };
    const a = brick('url(#brickfill-gone-7)'), b = brick('#aa4433');
    const spine = document.createElementNS(NS, 'line'); // a brush spine is not a painted brick
    spine.setAttribute('data-brick', 'brush-spine');
    g.append(a, b, spine);
    expect(repaintBricks({ _sketchLayer: { node: g }, _layers: [{ id: 2 }] })).toBe(2);
    expect(a.getAttribute('fill')).toBe(NEUTRAL_BRICK_GREY);
    expect(b.getAttribute('fill')).toBe(NEUTRAL_BRICK_GREY);
    expect(spine.hasAttribute('fill')).toBe(false);
    svg.remove();
  });
  it('no sketch layer -> 0, no throw', () => {
    expect(repaintBricks(null)).toBe(0);
    expect(repaintBricks({})).toBe(0);
  });
});
