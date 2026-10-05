/**
 * T86 item 16(b) reopened: at 1.25 in+ the wall and the frame showed the board through their bricks. MEASURED with
 * every laid polygon drawn over the editor shot (T1, 1.5 in): every grey patch lay INSIDE a brick -- the brick's
 * fill <pattern> (tile = its bounding box) held a 1 x 1 <image> in user units, a 1-inch square, so anything longer
 * than an inch was painted only for its first inch. The image square now covers the brick's longest side.
 */
import { describe, it, expect } from 'vitest';
import { repaintBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const NS = 'http://www.w3.org/2000/svg';

function paintedImage(points) {
  const svg = document.createElementNS(NS, 'svg');
  const g = document.createElementNS(NS, 'g');
  svg.appendChild(g);
  document.body.appendChild(svg);
  const brick = document.createElementNS(NS, 'polygon');
  for (const [k, v] of [['data-brick-gen', '1'], ['data-brick', 'wall'], ['data-brick-set', '1'],
    ['data-brick-sample', brickSetById(1).samples[0].id], ['data-brick-flip', '0'], ['points', points]]) brick.setAttribute(k, v);
  g.appendChild(brick);
  repaintBricks({ _sketchLayer: { node: g } });
  const id = brick.getAttribute('fill').match(/^url\(#(.+)\)$/)[1];
  const image = svg.querySelector(`#${id} image`);
  const out = { id, w: Number(image.getAttribute('width')), h: Number(image.getAttribute('height')) };
  svg.remove();
  return out;
}

describe('a brick fill covers the whole brick (T86 item 16(b))', () => {
  it('a 1.5 x 0.4 in brick gets an image square of at least 1.5 in', () => {
    const { w, h } = paintedImage('0,0 1.5,0 1.5,0.4 0,0.4');
    expect(w).toBeGreaterThanOrEqual(1.5);
    expect(h).toBeGreaterThanOrEqual(1.5);
  });
  it('a 3 in brick gets a 3 in square', () => {
    const { w } = paintedImage('0,0 3,0 3,1 0,1');
    expect(w).toBeGreaterThanOrEqual(3);
  });
  it('a 3/4 in brick keeps today\'s 1 in pattern (same id form, same look)', () => {
    const { id, w, h } = paintedImage('0,0 0.75,0 0.75,0.25 0,0.25');
    expect([w, h]).toEqual([1, 1]);
    expect(id).toMatch(/^brickfill-1_[A-Za-z0-9_]+_0-\d+$/);
  });
});
