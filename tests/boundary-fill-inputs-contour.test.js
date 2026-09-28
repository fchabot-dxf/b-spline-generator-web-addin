/**
 * Fred ("Stripe tool on contour doesn't stick, I see the stripe for a second after confirm then it turns back to
 * normal colour"): a stripe / scissors cut on the contour splits a segment without changing the shape, so it must
 * not read as a new boundary (which refilled the whole lattice). boundaryFillInputs keys the contour's pieces as
 * the segments they came from; a real reshape still changes the key.
 */
import { describe, it, expect } from 'vitest';
import { boundaryFillInputs, contourPiecesKey } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

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

describe('contourPiecesKey (the frame-linked contour check: stripes must not read as a changed contour)', () => {
  const k = (ds) => contourPiecesKey(ds.map((d) => ({ d })));
  it('a striped segment keys the same as the fresh generator output; a real change does not', () => {
    const striped = ['M 0.625 0.625 L 2.542 0.625', 'M 2.542 0.625 L 4.458 0.625', 'M 4.458 0.625 L 6.375 0.625', WHOLE[1],
      'M 6.375 2.713 A 0.602 0.602 0 0 1 6.198683 3.138683', 'M 6.198683 3.138683 A 0.602 0.602 0 0 1 5.773 3.315'];
    expect(k(striped)).toBe(k(WHOLE));
    expect(k(['M 0.625 0.625 L 6.375 0.7', WHOLE[1], WHOLE[2]])).not.toBe(k(WHOLE));
  });
});

describe('audit batch 2: a scissors cut writes at CONTOUR_D_DIGITS, so a cut arc still keys as the uncut arc', async () => {
  const { primitiveFromContourD, splitContourPrimitive, CONTOUR_D_DIGITS } = await import('../bspline-frame-builder/b-spline-gen/html/editor/editor-contour-cut.js');
  const { primitiveToPathD } = await import('../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js');
  it('200 cuts on shallow and corner arcs: every cut arc keys the same as the whole (the audit probe: 95/200 failed at 3 digits)', () => {
    const k = (ds) => contourPiecesKey(ds.map((d) => ({ d })));
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let fails = 0;
    for (let n = 0; n < 200; n++) {
      const r = n % 2 ? 3 + rnd() * 3 : 0.25 + rnd() * 1.25;       // shallow big arcs and corner arcs
      const sweep = n % 2 ? 0.3 + rnd() * 0.4 : Math.PI / 2;
      const a0 = rnd() * Math.PI * 2, cx = 3 + rnd(), cy = 4 + rnd();
      const P = (t) => ({ x: +(cx + r * Math.cos(t)).toFixed(3), y: +(cy + r * Math.sin(t)).toFixed(3) });
      const s = P(a0), e = P(a0 + sweep);
      const whole = `M ${s.x} ${s.y} A ${r.toFixed(3)} ${r.toFixed(3)} 0 0 1 ${e.x} ${e.y}`;
      const prim = primitiveFromContourD(whole);
      const t = a0 + sweep * (0.2 + 0.6 * rnd());
      const cut = { x: prim.cx + prim.rx * Math.cos(t), y: prim.cy + prim.rx * Math.sin(t) };
      const [h1, h2] = splitContourPrimitive(prim, cut);
      if (k([primitiveToPathD(h1, CONTOUR_D_DIGITS), primitiveToPathD(h2, CONTOUR_D_DIGITS)]) !== k([whole])) fails++;
    }
    expect(fails).toBe(0);
  });
});
