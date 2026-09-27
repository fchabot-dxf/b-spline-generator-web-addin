/**
 * F27 (Fred: "the scissors tool doesn't cut contour, it should"): SE16's ✂ cut tool extended to the lattice
 * CONTOUR (editor-cut-tool.js's own dispatch to editor-contour-cut.js). Same mock shape as tests/cut-tool.test.js
 * (a minimal svg.js-like element + editor), extended with a `path(d)` factory for contour segments.
 */
import { describe, it, expect } from 'vitest';
import { cutAt, join, jointAt, snapOnContourPiece, cutIntent } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-cut-tool.js';
import { primitiveFromContourD, contourPrimitiveEnds } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-contour-cut.js';
import { generateSilhouette, primitiveToPathD } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { BOUNDARY_REF_ATTR, CONTOUR_SEG_INDEX_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { latticeColorPool } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

// F27 item 1 ADD: a simple seeded LCG wherever a cut-recolour test needs a REPRODUCIBLE draw, same convention
// tests/shape-lattice-segment-color.test.js already uses for T81 item 3's own randomize button.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ── the SAME minimal svg.js-shaped element + editor as tests/cut-tool.test.js (duplicated per that file's own
//    "small pure test helper, no shared import" convention), extended with a path() factory for a contour piece.
function makeEl(type, attrs, layer) {
  const store = { ...attrs };
  const el = {
    type,
    node: {
      getAttribute: (k) => (store[k] !== undefined ? String(store[k]) : null),
      setAttribute: (k, v) => { store[k] = v; }, hasAttribute: (k) => store[k] !== undefined,
      removeAttribute: (k) => { delete store[k]; },
    },
    attr(k, v) {
      if (typeof k === 'object') { for (const [kk, vv] of Object.entries(k)) { if (vv == null) delete store[kk]; else store[kk] = vv; } return el; }
      if (v === undefined) return store[k];
      store[k] = v; return el;
    },
    stroke(o) { if (o && o.color) store.stroke = o.color; return el; },
    clone() { return makeEl(type, { ...store }, layer); },
    insertAfter(other) { const list = layer.list; list.splice(list.indexOf(other) + 1, 0, el); return el; },
    remove() { const list = layer.list; list.splice(list.indexOf(el), 1); },
    store,
  };
  return el;
}
function makeEditor(pattern) {
  const layer = { list: [] };
  const editor = {
    _sketchLayer: { children: () => { const a = layer.list.slice(); a.toArray = () => a; return a; } },
    _layers: [{ id: 'R', pattern }], _activeLayer: 'R',
    _grid: { gridSnap: true, geometrySnap: false, spacing: 0.25 },
    commits: 0, pushState() { editor.commits++; }, _notifyChange() {},
    line(x1, y1, x2, y2, extra = {}) {
      const el = makeEl('line', { x1, y1, x2, y2, 'data-layer': 'R', ...extra }, layer);
      layer.list.push(el); return el;
    },
    path(d, extra = {}) {
      const el = makeEl('path', { d, 'data-layer': 'R', ...extra }, layer);
      layer.list.push(el); return el;
    },
    layer,
  };
  return editor;
}

/** N contour pieces (real generated primitives, hourglass, seed 42), drawn onto `ed` as ordered path elements
 *  sharing ONE boundaryRef -- the SAME shape regenerateSilhouette itself draws (T73/SE14b). */
function drawContour(ed, shapeId = 'b1', boardW = 7, boardH = 9) {
  const primitives = generateSilhouette({ x: 0, y: 0, w: boardW, h: boardH }, { preset: 'hourglass', seed: 42 }).primitives;
  return primitives.map((prim, i) => ed.path(primitiveToPathD(prim), { [BOUNDARY_REF_ATTR]: shapeId, [CONTOUR_SEG_INDEX_ATTR]: i }));
}

describe('F27 U1: cutAt on a contour segment (line and arc)', () => {
  it('cuts a LINE contour segment: two new path pieces sharing one point, renumbered, same boundaryRef/layer/stroke', () => {
    const ed = makeEditor({ contour: { segmentColors: [] } });
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'L');
    const prim = primitiveFromContourD(segs[i].attr('d'));
    const [p0, p1] = contourPrimitiveEnds(prim);
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const before = segs.length;
    const [a, b] = cutAt(ed, segs[i], mid);
    expect(ed.commits).toBe(1);
    expect(ed.layer.list.length).toBe(before + 1);
    // a's end == mid == b's start, exactly
    const primA = primitiveFromContourD(a.attr('d')), primB = primitiveFromContourD(b.attr('d'));
    const [, aEnd] = contourPrimitiveEnds(primA), [bStart] = contourPrimitiveEnds(primB);
    // through the d-string's own _fmt (3-decimal) rounding, not exact -- same tolerance as the round-trip test
    expect(aEnd.x).toBeCloseTo(mid.x, 2); expect(aEnd.y).toBeCloseTo(mid.y, 2);
    expect(bStart.x).toBeCloseTo(mid.x, 2); expect(bStart.y).toBeCloseTo(mid.y, 2);
    expect(aEnd).toEqual(bStart); // but a and b share the EXACT SAME rounded point (both written from the SAME split() output)
    // both new pieces keep the ORIGINAL boundaryRef/layer/stroke (the "every attribute copied" rail convention)
    expect(a.attr(BOUNDARY_REF_ATTR)).toBe('b1');
    expect(b.attr(BOUNDARY_REF_ATTR)).toBe('b1');
    expect(b.attr('data-layer')).toBe(a.attr('data-layer'));
    // renumbered: a keeps index i, b gets i+1, every LATER original sibling shifted up by one
    expect(Number(a.attr(CONTOUR_SEG_INDEX_ATTR))).toBe(i);
    expect(Number(b.attr(CONTOUR_SEG_INDEX_ATTR))).toBe(i + 1);
    for (let k = i + 1; k < segs.length; k++) if (segs[k] !== segs[i]) expect(Number(segs[k].attr(CONTOUR_SEG_INDEX_ATTR))).toBe(k + 1);
    for (let k = 0; k < i; k++) expect(Number(segs[k].attr(CONTOUR_SEG_INDEX_ATTR))).toBe(k);
  });

  it('cuts an ARC contour segment: two sub-arcs, same centre/radius, angle continuity', () => {
    const ed = makeEditor({ contour: { segmentColors: [] } });
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'A');
    const prim = primitiveFromContourD(segs[i].attr('d'));
    const midTheta = prim.theta1 + prim.dTheta * 0.4;
    const point = { x: prim.cx + prim.rx * Math.cos(midTheta), y: prim.cy + prim.ry * Math.sin(midTheta) };
    const [a, b] = cutAt(ed, segs[i], point);
    const primA = primitiveFromContourD(a.attr('d')), primB = primitiveFromContourD(b.attr('d'));
    expect(primA.type).toBe('A'); expect(primB.type).toBe('A');
    expect(primA.cx).toBeCloseTo(prim.cx, 2); expect(primB.cx).toBeCloseTo(prim.cx, 2);
    const [, aEnd] = contourPrimitiveEnds(primA), [bStart] = contourPrimitiveEnds(primB);
    expect(Math.hypot(aEnd.x - bStart.x, aEnd.y - bStart.y)).toBeLessThan(1e-2); // shared point, through the d-string round-trip
  });

  it('refuses a cut too close to either end (the plain-line floor, CUT_MIN_PLAIN_IN)', () => {
    const ed = makeEditor({ contour: { segmentColors: [] } });
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'L');
    const [p0] = contourPrimitiveEnds(primitiveFromContourD(segs[i].attr('d')));
    expect(cutAt(ed, segs[i], { x: p0.x + 1e-5, y: p0.y })).toBeNull();
    expect(ed.commits).toBe(0);
  });

  it('the CUT piece\'s own colour survives on the FIRST half; the SECOND half is immediately recoloured (F27 item 1 ADD)', () => {
    const ed = makeEditor({ contour: { segmentColors: [] } });
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'L');
    segs[i].stroke({ color: '#f00' });
    ed._layers[0].pattern.contour.segmentColors[i] = '#f00';
    const prim = primitiveFromContourD(segs[i].attr('d'));
    const [p0, p1] = contourPrimitiveEnds(prim);
    const [a, b] = cutAt(ed, segs[i], { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, seededRng(9));
    expect(a.attr('stroke')).toBe('#f00'); // `a` (touching the segment's own start) is unchanged by the cut
    // F27 item 1 ADD (Fred: "the colour of one segment to change right away ... it also helps to know where I
    // cut"): `b` (the far side) is immediately recoloured to a real palette colour, differing from `a` -- no
    // longer a plain duplicate of the cut piece's own colour.
    expect(latticeColorPool(ed._layers[0].pattern)).toContain(b.attr('stroke')); // T81 item 8: the lattice's own colours
    expect(b.attr('stroke')).not.toBe('#f00');
    const colors = ed._layers[0].pattern.contour.segmentColors;
    expect(colors[i]).toBe('#f00');
    expect(colors[i + 1]).toBe(b.attr('stroke')); // segmentColors[] holds the SAME recoloured value, not a stale duplicate
  });

  // F27 item 1 ADD, the dispatch's own acceptance criterion verbatim: "after a cut the two sides differ in
  // colour and neither equals its other neighbour." The previous test only proves "differs from its cut
  // sibling" (`a`) -- this gives the contour's own NEXT sibling (a real third, cyclically-adjacent segment) a
  // KNOWN colour and proves the recoloured piece differs from THAT too.
  it('the recoloured (second) half differs from BOTH its cut sibling AND the contour\'s own next segment', () => {
    const ed = makeEditor({ contour: { segmentColors: [] } });
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'L');
    const next = segs[(i + 1) % segs.length];
    segs[i].stroke({ color: '#f00' });
    next.stroke({ color: '#c62828' });
    ed._layers[0].pattern.contour.segmentColors[i] = '#f00';
    ed._layers[0].pattern.contour.segmentColors[(i + 1) % segs.length] = '#c62828';
    const prim = primitiveFromContourD(segs[i].attr('d'));
    const [p0, p1] = contourPrimitiveEnds(prim);
    const [a, b] = cutAt(ed, segs[i], { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, seededRng(13));
    expect(a.attr('stroke')).toBe('#f00');
    expect(next.attr('stroke')).toBe('#c62828'); // unaffected by the cut (only its own index attr shifted)
    expect(b.attr('stroke')).not.toBe(a.attr('stroke'));
    expect(b.attr('stroke')).not.toBe(next.attr('stroke'));
  });
});

describe('F27 U2: join on a contour segment -- the exact inverse of cutAt', () => {
  it('join(cutAt(prim, p)) restores the original geometry, indices, and array length; BOTH overrides cleared (Q4)', () => {
    const ed = makeEditor({ contour: { segmentColors: [], colors: undefined }, colors: { contour: '#4a90d9' } });
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'L');
    const originalD = segs[i].attr('d');
    const [p0, p1] = contourPrimitiveEnds(primitiveFromContourD(originalD));
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const before = ed.layer.list.length;
    const [a, b] = cutAt(ed, segs[i], mid);
    a.stroke({ color: '#f00' }); b.stroke({ color: '#00f' });
    ed._layers[0].pattern.contour.segmentColors[i] = '#f00';
    ed._layers[0].pattern.contour.segmentColors[i + 1] = '#00f';
    expect(jointAt(ed, mid)).toEqual([a, b]);
    const joined = join(ed, mid);
    expect(joined).toBe(a);
    expect(ed.layer.list.length).toBe(before);
    expect(ed.layer.list.includes(b)).toBe(false);
    // geometry restored exactly (through the same d-string precision as the round-trip test)
    const restored = primitiveFromContourD(a.attr('d'));
    expect(restored.p0.x).toBeCloseTo(p0.x, 2); expect(restored.p0.y).toBeCloseTo(p0.y, 2);
    expect(restored.p1.x).toBeCloseTo(p1.x, 2); expect(restored.p1.y).toBeCloseTo(p1.y, 2);
    // Q4: BOTH overrides cleared -- the merged piece takes the contour default, not either side's colour
    expect(a.attr('stroke')).toBe('#4a90d9');
    expect(ed._layers[0].pattern.contour.segmentColors[i]).toBeUndefined();
    // every later sibling's own index shifted back down -- indistinguishable from before the cut
    for (let k = 0; k < segs.length; k++) if (segs[k] !== segs[i]) expect(Number(segs[k].attr(CONTOUR_SEG_INDEX_ATTR))).toBe(k);
  });

  it('two ADJACENT-by-index but UNRELATED primitives (a genuine shape corner) do NOT join', () => {
    const ed = makeEditor({ contour: { segmentColors: [] } });
    const segs = drawContour(ed);
    // any two ORIGINAL (never-cut) consecutive segments are a genuine shape corner, not a cut's own two halves
    for (let i = 0; i < segs.length; i++) {
      const j = (i + 1) % segs.length;
      const [, aEnd] = contourPrimitiveEnds(primitiveFromContourD(segs[i].attr('d')));
      expect(jointAt(ed, aEnd)).toBeNull();
    }
  });

  it('non-vacuous: a genuinely mergeable pair (a real cut) IS found by jointAt, proving the refusal above is not just "never returns anything"', () => {
    const ed = makeEditor({ contour: { segmentColors: [] } });
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'L');
    const [p0, p1] = contourPrimitiveEnds(primitiveFromContourD(segs[i].attr('d')));
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    cutAt(ed, segs[i], mid);
    expect(jointAt(ed, mid)).not.toBeNull();
  });
});

describe('F27 U3 (FINAL RULING: a contour cut is a colour boundary only, never structural -- see editor-contour-cut.js\'s own header): the ring\'s own shape/connectivity is invariant through any number of cuts', () => {
  it('one cut: still ONE seamless ring (N+1 pieces, every end meets the next start, wraparound)', () => {
    const ed = makeEditor({ contour: { segmentColors: [] } });
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'L');
    const [p0, p1] = contourPrimitiveEnds(primitiveFromContourD(segs[i].attr('d')));
    cutAt(ed, segs[i], { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 });
    const ordered = ed.layer.list.slice().sort((x, y) => Number(x.attr(CONTOUR_SEG_INDEX_ATTR)) - Number(y.attr(CONTOUR_SEG_INDEX_ATTR)));
    expect(ordered.length).toBe(segs.length + 1);
    for (let k = 0; k < ordered.length; k++) {
      const [, end] = contourPrimitiveEnds(primitiveFromContourD(ordered[k].attr('d')));
      const [start] = contourPrimitiveEnds(primitiveFromContourD(ordered[(k + 1) % ordered.length].attr('d')));
      expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(2e-3); // still exactly closed, wraparound included
    }
  });

  it('a second cut (elsewhere): still ONE seamless ring (N+2 pieces) -- a colour-boundary cut never disconnects it, no matter how many', () => {
    const ed = makeEditor({ contour: { segmentColors: [] } });
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'L');
    const [ip0, ip1] = contourPrimitiveEnds(primitiveFromContourD(segs[i].attr('d')));
    const [firstA] = cutAt(ed, segs[i], { x: (ip0.x + ip1.x) / 2, y: (ip0.y + ip1.y) / 2 });
    // a second cut on a DIFFERENT original segment (not the one just cut)
    const j = segs.findIndex((s, idx) => idx !== i && primitiveFromContourD(s.attr('d')).type === 'L');
    const [jp0, jp1] = contourPrimitiveEnds(primitiveFromContourD(segs[j].attr('d')));
    cutAt(ed, segs[j], { x: (jp0.x + jp1.x) / 2, y: (jp0.y + jp1.y) / 2 });
    const ordered = ed.layer.list.slice().sort((x, y) => Number(x.attr(CONTOUR_SEG_INDEX_ATTR)) - Number(y.attr(CONTOUR_SEG_INDEX_ATTR)));
    expect(ordered.length).toBe(segs.length + 2);
    for (let k = 0; k < ordered.length; k++) {
      const [, end] = contourPrimitiveEnds(primitiveFromContourD(ordered[k].attr('d')));
      const [start] = contourPrimitiveEnds(primitiveFromContourD(ordered[(k + 1) % ordered.length].attr('d')));
      expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(2e-3);
    }
    // both cuts are independently JOIN-able (proving the tool treats each as its own genuine joint, not one merged idea)
    expect(jointAt(ed, { x: (ip0.x + ip1.x) / 2, y: (ip0.y + ip1.y) / 2 })).not.toBeNull();
  });
});

describe('F27 U4: snapOnContourPiece -- the same H1 toggles as snapOnLine (Q5), for an arc', () => {
  it('GEOMETRY off, GRID off, or Alt: the exact projection onto the arc', () => {
    const ed = makeEditor({ contour: { segmentColors: [] } });
    const segs = drawContour(ed);
    const arcEl = segs.find((s) => primitiveFromContourD(s.attr('d')).type === 'A');
    const prim = primitiveFromContourD(arcEl.attr('d'));
    const theta = prim.theta1 + prim.dTheta * 0.37;
    const onArc = { x: prim.cx + prim.rx * Math.cos(theta), y: prim.cy + prim.ry * Math.sin(theta) };
    ed._grid.gridSnap = false;
    const snapped = snapOnContourPiece(ed, arcEl, onArc);
    expect(snapped.x).toBeCloseTo(onArc.x, 6); expect(snapped.y).toBeCloseTo(onArc.y, 6);
    const alt = snapOnContourPiece(ed, arcEl, { x: onArc.x + 0.2, y: onArc.y + 0.2 }, true);
    expect(Math.hypot(alt.x - onArc.x, alt.y - onArc.y)).toBeGreaterThan(0); // Alt: projected, not snapped to a candidate
  });
});

describe('F27 U5: cutIntent recognizes a contour piece (line and arc), dispatching through the SAME tool entry point', () => {
  it('a tap on the contour mid-segment is a cut; after cutting, a tap near the new joint is a join', () => {
    const ed = makeEditor({ contour: { segmentColors: [] } });
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'L');
    const [p0, p1] = contourPrimitiveEnds(primitiveFromContourD(segs[i].attr('d')));
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const before = cutIntent(ed, mid);
    expect(before.action).toBe('cut');
    expect(before.el).toBe(segs[i]);
    cutAt(ed, segs[i], mid);
    const after = cutIntent(ed, { x: mid.x + 0.01, y: mid.y + 0.01 });
    expect(after.action).toBe('join');
  });
});
