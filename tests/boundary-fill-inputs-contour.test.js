/**
 * Fred ("Stripe tool on contour doesn't stick, I see the stripe for a second after confirm then it turns back to
 * normal colour"): a stripe / scissors cut on the contour splits a segment without changing the shape, so it must
 * not read as a new boundary (which refilled the whole lattice). boundaryFillInputs keys the contour's pieces as
 * the segments they came from; a real reshape still changes the key.
 */
import { describe, it, expect } from 'vitest';
import { boundaryFillInputs } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

const REF = 'b-test';
function piece(d, i, extra = {}) {
  const attrs = { d, 'data-boundary-ref': REF, 'data-contour-seg': String(i), 'stroke-width': '0.25', ...extra };
  return { type: 'path', node: { getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs, textContent: null } };
}
function editorWith(ds, extra = {}) {
  const els = ds.map((d, i) => piece(d, i, extra[i]));
  return { _sketchLayer: { children: () => ({ toArray: () => els }) } };
}
const pattern = { boundary: { shapeId: REF }, extent: { mode: 'boundary' }, rails: { every: 2 } };

const WHOLE = ['M 0.625 0.625 L 6.375 0.625', 'M 6.375 0.625 L 6.375 2.713', 'M 6.375 2.713 A 0.602 0.602 0 0 1 5.773 3.315'];

describe('boundaryFillInputs: contour colour cuts are not a boundary change', () => {
  it('a straight segment striped into 3 keys the same as the whole segment', () => {
    const striped = ['M 0.625 0.625 L 2.542 0.625', 'M 2.542 0.625 L 4.458 0.625', 'M 4.458 0.625 L 6.375 0.625', WHOLE[1], WHOLE[2]];
    expect(boundaryFillInputs(editorWith(striped), pattern)).toBe(boundaryFillInputs(editorWith(WHOLE), pattern));
  });

  it('an arc cut in two keys the same as the whole arc', () => {
    const cut = [WHOLE[0], WHOLE[1], 'M 6.375 2.713 A 0.602 0.602 0 0 1 6.198683 3.138683', 'M 6.198683 3.138683 A 0.602 0.602 0 0 1 5.773 3.315'];
    expect(boundaryFillInputs(editorWith(cut), pattern)).toBe(boundaryFillInputs(editorWith(WHOLE), pattern));
  });

  it('a genuine corner never merges, and a moved end, a new radius or a moved piece still changes the key', () => {
    const base = boundaryFillInputs(editorWith(WHOLE), pattern);
    expect(boundaryFillInputs(editorWith(['M 0.625 0.625 L 6.5 0.625', 'M 6.5 0.625 L 6.375 2.713', WHOLE[2]]), pattern)).not.toBe(base);
    expect(boundaryFillInputs(editorWith([WHOLE[0], WHOLE[1], 'M 6.375 2.713 A 0.7 0.7 0 0 1 5.773 3.315']), pattern)).not.toBe(base);
    expect(boundaryFillInputs(editorWith(WHOLE, { 1: { transform: 'matrix(1,0,0,1,0.5,0)' } }), pattern)).not.toBe(base);
    expect(boundaryFillInputs(editorWith(WHOLE, { 0: { 'stroke-width': '0.3' } }), pattern)).not.toBe(base);
  });
});
