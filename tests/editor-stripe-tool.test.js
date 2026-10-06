/**
 * F27 item 3: the STRIPE tool (editor-stripe-tool.js) -- count/length math, the colour cycle, contour vs rail cut
 * kinds, re-stripe, one undo step, and the Fusion side (a striped rail and a striped contour arc sent AS DRAWN).
 * Same minimal svg.js-shaped element + editor mock as tests/cut-tool.test.js / editor-cut-tool-contour.test.js
 * (duplicated per their "small pure test helper, no shared import" convention).
 */
import { describe, it, expect } from 'vitest';
import {
  stripeAt, stripeRun, stripePlan, stripeCountFor, maxStripeCount, stripeColorCycle, stripePalette, defaultStripeColors,
  stripeCutPoints, primitiveLength, STRIPE_ATTR, STRIPE_SRC_ATTR, STRIPE_DEFAULTS, STRIPE_FALLBACK_COLORS,
  STRIPE_COLOR_PRESETS, applyStripeColorPreset, stripeSettings,
  STRIPE_PATTERNS, applyStripePattern, parseStripeRatio, ratioUnitSum, maxPatternRepeats, patternRepeatsFor,
  patternClamped, patternCutPoints,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-stripe-tool.js';
import { cutKindOf, minPieceLength, CUT_KIND } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-cut-tool.js';
import { chainOf } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-chains.js';
import { primitiveFromContourD, contourPrimitiveEnds } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-contour-cut.js';
import { generateSilhouette, primitiveToPathD } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import {
  BOUNDARY_REF_ATTR, CONTOUR_SEG_INDEX_ATTR, PATTERN_DEFAULTS, latticeColorPool,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { OVERRIDE_COLOR_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-piece-override.js';
import { buildSketchManifest, manifestFromShape } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { drawnFromPattern } from './helpers/drawn-lattice.js';
import { TOOLBAR_GROUPS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';
import { TOOL_PANELS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-drawer.js';
import { SNAP_POLICY } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-grid.js';
import { readFileSync } from 'node:fs';

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
    fill(c) { store.fill = c; return el; },
    clone() { return makeEl(type, { ...store }, layer); },
    insertAfter(other) { const list = layer.list; list.splice(list.indexOf(other) + 1, 0, el); return el; },
    remove() { const list = layer.list; list.splice(list.indexOf(el), 1); },
    store,
  };
  return el;
}
function makeEditor(pattern, layerId = 'R') {
  const layer = { list: [] };
  const editor = {
    _sketchLayer: { children: () => { const a = layer.list.slice(); a.toArray = () => a; return a; } },
    _layers: [{ id: layerId, pattern }], _activeLayer: layerId,
    _grid: { gridSnap: false, geometrySnap: false, spacing: 0.25 },
    commits: 0, pushState() { editor.commits++; }, _notifyChange() {},
    line(x1, y1, x2, y2, extra = {}) {
      const el = makeEl('line', { x1, y1, x2, y2, 'data-layer': layerId, ...extra }, layer);
      layer.list.push(el); return el;
    },
    path(d, extra = {}) {
      const el = makeEl('path', { d, 'data-layer': layerId, ...extra }, layer);
      layer.list.push(el); return el;
    },
    layer,
  };
  return editor;
}
const RAIL = { 'data-lattice': 'rail', 'data-lattice-gen': 'p', stroke: '#333', 'stroke-width': 0.07 };
const pts = (el) => [+el.store.x1, +el.store.y1, +el.store.x2, +el.store.y2];
const count = (n, extra = {}) => ({ ...STRIPE_DEFAULTS, colors: [null, null, null], count: n, ...extra });

describe('F27 item 3: count / length math', () => {
  it('Count drives: exactly the Count set (no odd/colour snapping, Fred), capped so no stripe < the stroke width', () => {
    expect(stripeCountFor(count(4), 10, 0.07)).toBe(4); // even is fine: "I don't really care if colours don't end the same"
    expect(stripeCountFor(count(5), 10, 0.07)).toBe(5);
    expect(stripeCountFor(count(0), 10, 0.07)).toBe(1); // at least one stripe
    expect(maxStripeCount(1, 0.07)).toBe(14); // floor(1 / 0.07)
    expect(stripeCountFor(count(50), 1, 0.07)).toBe(14);
    expect(1 / stripeCountFor(count(50), 1, 0.07)).toBeGreaterThanOrEqual(0.07);
  });
  it('Length drives: the NEAREST equal split (ties round up), Length floored to the stroke width', () => {
    const len = (l) => count(1, { drive: 'length', length: l });
    expect(stripeCountFor(len(2), 10, 0.07)).toBe(5);
    expect(stripeCountFor(len(3), 10, 0.07)).toBe(3); // 3.33 -> 3 stripes of 3.33, never a short last stripe
    expect(stripeCountFor(len(4), 10, 0.07)).toBe(3); // 2.5 -> 3 (ties round up)
    expect(stripeCountFor(len(40), 10, 0.07)).toBe(1);
    expect(stripeCountFor(len(0.01), 1, 0.07)).toBe(14); // floored to the stroke width -> the Count cap
    expect(stripeCountFor(len(0.0701), 1, 0.07)).toBe(14); // round(14.27)=14 and 1/14 >= 0.07
  });
  it('minPieceLength = the line\'s own stroke width (Fred: "The only distance it should use is the stroke width")', () => {
    const ed = makeEditor(null);
    expect(minPieceLength(ed.line(0, 0, 1, 0, { 'stroke-width': 0.3 }))).toBe(0.3);
    expect(minPieceLength(ed.line(0, 0, 1, 0))).toBeGreaterThan(0); // no stroke width: the plain-line floor
  });
});

describe('F27 item 3: the colour cycle and its defaults', () => {
  it('cycles A B (C) from the start, wherever the last stripe lands', () => {
    expect(stripeColorCycle(5, ['a', 'b'])).toEqual(['a', 'b', 'a', 'b', 'a']);
    expect(stripeColorCycle(4, ['a', 'b'])).toEqual(['a', 'b', 'a', 'b']);
    expect(stripeColorCycle(7, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a']);
  });
  it('defaults: the lattice\'s Rails/Ties/Nodes pool; a non-lattice layer: black / white / grey; C only when on', () => {
    const pattern = { colors: { rails: '#111111', ties: '#222222', nodes: '#333333' } };
    expect(defaultStripeColors(pattern)).toEqual(latticeColorPool(pattern));
    expect(defaultStripeColors(null)).toEqual([...STRIPE_FALLBACK_COLORS]);
    expect(STRIPE_FALLBACK_COLORS.slice(0, 2)).toEqual(['#000000', '#ffffff']);
    // a pool of 2 distinct colours is topped up to 3
    expect(defaultStripeColors({ colors: { rails: '#111111', ties: '#111111', nodes: '#333333' } })).toEqual(['#111111', '#333333', '#000000']);
    expect(stripePalette(count(3), pattern)).toEqual(['#111111', '#222222']);
    expect(stripePalette(count(3, { three: true }), pattern)).toEqual(['#111111', '#222222', '#333333']);
    expect(stripePalette(count(3, { colors: [null, '#abcdef', null] }), pattern)).toEqual(['#111111', '#abcdef']);
  });
});

describe('F32 item 1: colour presets', () => {
  it('declares Black/White and Blue/White, the blue being the lattice\'s own node colour, not retyped', () => {
    expect(STRIPE_COLOR_PRESETS).toEqual([
      { name: 'Black / White', colors: ['#000000', '#ffffff'] },
      { name: 'Blue / White', colors: [PATTERN_DEFAULTS.colors.nodes, '#ffffff'] },
    ]);
    expect(PATTERN_DEFAULTS.colors.nodes).toBe('#1a237e'); // the exact value Fred asked to reuse, not duplicate
  });

  it('applying a preset sets exactly those colours, through the same settings().colors[i] path a manual pick uses', () => {
    const editor = {};
    const s = stripeSettings(editor);
    s.colors = ['#remnant', '#remnant', '#remnant']; // a prior manual pick, incl. a leftover C
    s.three = true;
    applyStripeColorPreset(editor, STRIPE_COLOR_PRESETS[0]); // Black / White, 2 colours
    expect(s.colors).toEqual(['#000000', '#ffffff', null]); // 2-colour preset clears the stale C
    expect(s.three).toBe(false); // Fred: "a 2-colour preset turns Use C off"
  });

  it('a 3-colour preset would set C and turn Use C on (declared data drives it, not a hardcoded 2)', () => {
    const editor = {};
    const s = stripeSettings(editor);
    applyStripeColorPreset(editor, { name: 'Three', colors: ['#111111', '#222222', '#333333'] });
    expect(s.colors).toEqual(['#111111', '#222222', '#333333']);
    expect(s.three).toBe(true);
  });

  it('one call does all of it -- applying a preset is a single atomic settings update, not 3 separate picks', () => {
    const editor = {};
    const s = stripeSettings(editor);
    const writes = [];
    const spy = new Proxy(s.colors, { set(t, k, v) { writes.push([k, v]); t[k] = v; return true; } });
    s.colors = spy;
    applyStripeColorPreset(editor, STRIPE_COLOR_PRESETS[1]);
    expect(writes.length).toBe(3); // A, B, C (C cleared to null) -- all three, in the one call
  });
});

describe('F32 item 2: dash-ratio patterns', () => {
  it('declares Even/Dash/Long dash/Dash-dot once, Even a single-segment repeat (today\'s equal stripes)', () => {
    expect(STRIPE_PATTERNS).toEqual([
      { name: 'Even', ratio: [1] },
      { name: 'Dash', ratio: [3, 1] },
      { name: 'Long dash', ratio: [5, 1] },
      { name: 'Dash-dot', ratio: [3, 1, 1, 1] },
    ]);
  });
  it('applying a pattern sets ratio through the one declared path, a fresh mutable copy (not the frozen preset)', () => {
    const ed = makeEditor(null);
    const s = applyStripePattern(ed, STRIPE_PATTERNS[1]);
    expect(s.ratio).toEqual([3, 1]);
    s.ratio.push(9); // must not throw / must not mutate the declared preset
    expect(STRIPE_PATTERNS[1].ratio).toEqual([3, 1]);
  });
  it('parseStripeRatio: "3:1" / spaced / single -> arrays; empty, non-numeric, all-zero -> null', () => {
    expect(parseStripeRatio('3:1')).toEqual([3, 1]);
    expect(parseStripeRatio(' 2 : 3 : 2 ')).toEqual([2, 3, 2]);
    expect(parseStripeRatio('5')).toEqual([5]);
    expect(parseStripeRatio('')).toBeNull();
    expect(parseStripeRatio('abc')).toBeNull();
    expect(parseStripeRatio('0:-1')).toBeNull(); // no positive part survives
    expect(parseStripeRatio('0:1')).toEqual([1]); // the zero part is dropped, the valid one kept
  });
  it('ratio=[1] (Even) reduces EXACTLY to the pre-existing equal-stripe functions -- "byte for byte"', () => {
    expect(ratioUnitSum([1])).toBe(1);
    for (const [lineLen, minLen] of [[10, 0.07], [1, 0.07], [3.33, 0.1]]) {
      expect(maxPatternRepeats([1], lineLen, minLen)).toBe(maxStripeCount(lineLen, minLen));
    }
    for (const settings of [count(4), count(5), count(0), count(50), count(1, { drive: 'length', length: 2 }), count(1, { drive: 'length', length: 4 })]) {
      expect(patternRepeatsFor(settings, [1], 10, 0.07)).toBe(stripeCountFor(settings, 10, 0.07));
    }
    const prim = { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 8, y: 0 } };
    for (const n of [1, 3, 4, 7]) {
      expect(patternCutPoints(prim, [1], n)).toEqual(stripeCutPoints(prim, n));
    }
  });
  it('each declared ratio gives segment lengths in exactly that ratio and they sum to the line length', () => {
    const prim = { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 20, y: 0 } };
    for (const { ratio } of STRIPE_PATTERNS) {
      const reps = 3;
      const cuts = patternCutPoints(prim, ratio, reps);
      const xs = [0, ...cuts.map((p) => p.x), 20];
      const lens = xs.slice(1).map((x, i) => x - xs[i]);
      expect(lens).toHaveLength(ratio.length * reps);
      const unit = 20 / (ratioUnitSum(ratio) * reps);
      const expected = Array.from({ length: reps }, () => ratio).flat().map((r) => r * unit);
      expected.forEach((e, i) => expect(lens[i]).toBeCloseTo(e, 10));
      expect(lens.reduce((a, b) => a + b, 0)).toBeCloseTo(20, 10);
    }
  });
  it('a too-fine ratio is clamped: fewer repeats than requested, and patternClamped says so', () => {
    const ratio = [3, 1]; // unit sum 4, smallest part 1 -> one repeat needs 4x the stroke width
    const lineLen = 1, minLen = 0.07;
    const max = maxPatternRepeats(ratio, lineLen, minLen); // floor(1 / 0.28) = 3
    expect(max).toBe(3);
    expect(patternRepeatsFor(count(100), ratio, lineLen, minLen)).toBe(max); // 100 requested, capped to 3
    expect(patternClamped(count(100), ratio, lineLen, minLen)).toBe(true);
    expect(patternClamped(count(2), ratio, lineLen, minLen)).toBe(false); // 2 fits under the cap, not clamped
    // every resulting segment is still >= the stroke width
    const cuts = patternCutPoints({ type: 'L', p0: { x: 0, y: 0 }, p1: { x: lineLen, y: 0 } }, ratio, max);
    const xs = [0, ...cuts.map((p) => p.x), lineLen];
    const lens = xs.slice(1).map((x, i) => x - xs[i]);
    for (const len of lens) expect(len).toBeGreaterThanOrEqual(minLen - 1e-9);
  });
  it('stripeAt actually cuts a rail into the declared ratio (Dash 3:1), colours cycling as always (A B A B)', () => {
    const pattern = { spacing: 0.25, colors: { rails: '#c62828', ties: '#f9c80e', nodes: '#1a237e' } };
    const ed = makeEditor(pattern);
    const rail = ed.line(0, 1, 8, 1, RAIL);
    const stripes = stripeAt(ed, rail, count(2, { ratio: [3, 1] })); // 2 repeats of 3:1 over length 8 -> unit 1
    expect(stripes).toHaveLength(4);
    const lens = stripes.map((s) => Math.abs(+s.store.x2 - +s.store.x1));
    expect(lens.map((l) => Math.round(l * 1e9) / 1e9)).toEqual([3, 1, 3, 1]);
    expect(stripes.map((s) => s.store.stroke)).toEqual(['#c62828', '#f9c80e', '#c62828', '#f9c80e']);
    expect(ed.commits).toBe(1); // still one undo step
  });
  it('the hover/tap plan exposes ratio, reps and clamped for the panel to read', () => {
    const pattern = { spacing: 0.25, colors: { rails: '#c62828', ties: '#f9c80e', nodes: '#1a237e' } };
    const ed = makeEditor(pattern);
    const rail = ed.line(0, 1, 1, 1, RAIL); // short line, stroke width 0.07
    const plan = stripePlan(ed, rail, count(100, { ratio: [3, 1] }));
    expect(plan.ratio).toEqual([3, 1]);
    expect(plan.clamped).toBe(true);
    expect(plan.count).toBe(plan.reps * 2);
  });
});

describe('F27 item 3: striping a RAIL (structural cuts, the rail stays ONE chain)', () => {
  const pattern = { spacing: 0.25, colors: { rails: '#c62828', ties: '#f9c80e', nodes: '#1a237e' } };
  it('5 equal stripes, A B A B A as UI5 overrides, joints bit-identical, one chain, ONE undo step', () => {
    const ed = makeEditor(pattern);
    const rail = ed.line(0, 1, 4, 1, RAIL);
    expect(cutKindOf(rail)).toBe(CUT_KIND.rail);
    const stripes = stripeAt(ed, rail, count(5));
    expect(stripes).toHaveLength(5);
    expect(ed.commits).toBe(1);
    stripes.forEach((s, i) => { expect(+s.store.x1).toBeCloseTo(0.8 * i, 12); expect(+s.store.x2).toBeCloseTo(0.8 * (i + 1), 12); expect(s.store.y1).toBe(1); });
    for (let i = 0; i < 4; i++) expect([stripes[i].store.x2, stripes[i].store.y2]).toEqual([stripes[i + 1].store.x1, stripes[i + 1].store.y1]);
    expect(stripes.map((s) => s.store.stroke)).toEqual(['#c62828', '#f9c80e', '#c62828', '#f9c80e', '#c62828']);
    expect(stripes.map((s) => s.store[OVERRIDE_COLOR_ATTR])).toEqual(['#c62828', '#f9c80e', '#c62828', '#f9c80e', '#c62828']);
    expect(new Set(stripes.map((s) => s.store[STRIPE_ATTR])).size).toBe(1);
    expect(chainOf(ed, stripes[2]).segments.map((s) => s.el)).toEqual(stripes);
  });
  it('rail stripes may be shorter than one lattice cell (the only minimum is the stroke width)', () => {
    const ed = makeEditor(pattern);
    const rail = ed.line(0, 1, 1, 1, RAIL); // 4 cells long
    const stripes = stripeAt(ed, rail, count(10));
    expect(stripes).toHaveLength(10);
    expect(0.1).toBeLessThan(pattern.spacing); // shorter than one cell
    const ed2 = makeEditor(pattern);
    expect(stripeAt(ed2, ed2.line(0, 1, 1, 1, RAIL), count(100))).toHaveLength(14); // floor(1 / 0.07)
  });
  it('re-clicking ANY stripe re-stripes the whole run with the current settings (replaces its cuts), one undo step', () => {
    const ed = makeEditor(pattern);
    const rail = ed.line(0, 1, 4, 1, RAIL);
    const first = stripeAt(ed, rail, count(5));
    const id = first[0].store[STRIPE_ATTR];
    expect(stripeRun(ed, first[3])).toEqual(first);
    const again = stripeAt(ed, first[3], count(2, { three: true }));
    expect(ed.commits).toBe(2);
    expect(again).toHaveLength(2);
    expect(ed.layer.list).toHaveLength(2); // the 5 stripes were merged back, not added to
    expect(pts(again[0])).toEqual([0, 1, 2, 1]);
    expect(pts(again[1])).toEqual([2, 1, 4, 1]);
    expect(again.map((s) => s.store.stroke)).toEqual(['#c62828', '#f9c80e']);
    expect(again[0].store[STRIPE_ATTR]).toBe(id);
    const three = stripeAt(ed, again[1], count(7, { three: true }));
    expect(three.map((s) => s.store.stroke)).toEqual(['#c62828', '#f9c80e', '#1a237e', '#c62828', '#f9c80e', '#1a237e', '#c62828']);
  });
  it('a stripe run is only the CONTIGUOUS pieces: a scissors-split neighbour rail is not swept in', () => {
    const ed = makeEditor(pattern);
    const left = ed.line(0, 1, 2, 1, RAIL);
    const right = ed.line(2, 1, 4, 1, RAIL); // same chain, NOT striped
    const stripes = stripeAt(ed, left, count(3));
    expect(stripes).toHaveLength(3);
    expect(pts(right)).toEqual([2, 1, 4, 1]);
    expect(right.store[STRIPE_ATTR]).toBeUndefined();
    expect(stripeRun(ed, stripes[1])).toEqual(stripes);
  });
  it('the hover plan shows the SAME count/length the tap produces (the follower field reads it)', () => {
    const ed = makeEditor(pattern);
    const rail = ed.line(0, 1, 4, 1, RAIL);
    const plan = stripePlan(ed, rail, count(1, { drive: 'length', length: 1.1 }));
    expect(plan.count).toBe(4);
    expect(plan.stripeLength).toBeCloseTo(1, 12);
    expect(stripeCutPoints(plan.prim, plan.count).map((p) => p.x)).toEqual([1, 2, 3]);
  });
});

describe('F27 item 3: a plain line on a non-lattice layer', () => {
  it('stripes in black / white by default (Fred\'s image), written to the stroke (no override attr)', () => {
    const ed = makeEditor(null, 'P');
    const line = ed.line(0, 0, 3, 0, { stroke: '#123456', 'stroke-width': 0.1 });
    expect(cutKindOf(line)).toBe(CUT_KIND.line);
    const stripes = stripeAt(ed, line, count(3));
    expect(stripes.map((s) => s.store.stroke)).toEqual(['#000000', '#ffffff', '#000000']);
    expect(stripes.every((s) => s.store[OVERRIDE_COLOR_ATTR] === undefined)).toBe(true);
  });
});

// ── the contour: a COLOUR cut (geometry split, structure unchanged) ──
function drawContour(ed, shapeId = 'b1') {
  const primitives = generateSilhouette({ x: 0, y: 0, w: 7, h: 9 }, { preset: 'hourglass', seed: 42 }).primitives;
  return primitives.map((prim, i) => ed.path(primitiveToPathD(prim), { [BOUNDARY_REF_ATTR]: shapeId, [CONTOUR_SEG_INDEX_ATTR]: i, stroke: '#2e7d32', 'stroke-width': 0.07 }));
}

describe('F27 item 3: striping a CONTOUR arc (colour cut, one piece per stripe, all on the SAME circle)', () => {
  const contourPattern = () => ({ colors: { rails: '#c62828', ties: '#f9c80e', nodes: '#1a237e' }, contour: { segmentColors: [] } });
  it('N sub-arcs sharing the centre, equal sweeps, renumbered, colours in segmentColors[] too, one undo step', () => {
    const pattern = contourPattern();
    const ed = makeEditor(pattern);
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'A');
    const prim = primitiveFromContourD(segs[i].attr('d'));
    expect(cutKindOf(segs[i])).toBe(CUT_KIND.contour);
    const n0 = segs.length;
    const stripes = stripeAt(ed, segs[i], count(4));
    expect(ed.commits).toBe(1);
    expect(stripes).toHaveLength(4);
    expect(ed.layer.list).toHaveLength(n0 + 3);
    const prims = stripes.map((s) => primitiveFromContourD(s.attr('d')));
    for (const q of prims) {
      expect(q.type).toBe('A');
      expect(q.cx).toBeCloseTo(prim.cx, 2); expect(q.cy).toBeCloseTo(prim.cy, 2); expect(q.rx).toBeCloseTo(prim.rx, 2);
      expect(q.dTheta).toBeCloseTo(prim.dTheta / 4, 2);
    }
    // contiguous (through the d-string rounding), consecutive indices, later siblings shifted by 3
    for (let k = 0; k < 3; k++) {
      const [, e] = contourPrimitiveEnds(prims[k]), [s] = contourPrimitiveEnds(prims[k + 1]);
      expect(Math.hypot(e.x - s.x, e.y - s.y)).toBeLessThan(1e-2);
    }
    expect(stripes.map((s) => Number(s.attr(CONTOUR_SEG_INDEX_ATTR)))).toEqual([i, i + 1, i + 2, i + 3]);
    if (i + 1 < n0) expect(Number(segs[i + 1].attr(CONTOUR_SEG_INDEX_ATTR))).toBe(i + 4);
    const cols = ['#c62828', '#f9c80e', '#c62828', '#f9c80e'];
    expect(stripes.map((s) => s.store.stroke)).toEqual(cols);
    expect(pattern.contour.segmentColors.slice(i, i + 4)).toEqual(cols);
    // a contour stripe is never a rail override
    expect(stripes.every((s) => s.store[OVERRIDE_COLOR_ATTR] === undefined)).toBe(true);
  });
  it('re-stripe on a contour arc merges the run back and re-cuts it (count changes, the circle does not)', () => {
    const pattern = contourPattern();
    const ed = makeEditor(pattern);
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'A');
    const prim = primitiveFromContourD(segs[i].attr('d'));
    const n0 = segs.length;
    const first = stripeAt(ed, segs[i], count(5));
    const again = stripeAt(ed, first[2], count(3));
    expect(again).toHaveLength(3);
    expect(ed.layer.list).toHaveLength(n0 + 2);
    const total = again.reduce((sum, s) => sum + primitiveFromContourD(s.attr('d')).dTheta, 0);
    expect(total).toBeCloseTo(prim.dTheta, 2);
    expect(pattern.contour.segmentColors.slice(i, i + 3)).toEqual(['#c62828', '#f9c80e', '#c62828']);
  });
  it('10 stripes of an arc still share ONE centre (written at STRIPE_D_DIGITS; at 3 decimals they drift ~6e-3)', () => {
    const ed = makeEditor(contourPattern());
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'A');
    const original = segs[i].attr('d');
    const stripes = stripeAt(ed, segs[i], count(10));
    const prims = stripes.map((s) => primitiveFromContourD(s.attr('d')));
    for (const q of prims) expect(Math.hypot(q.cx - prims[0].cx, q.cy - prims[0].cy)).toBeLessThan(1e-4);
    expect(stripes.every((s) => s.store[STRIPE_SRC_ATTR] === original)).toBe(true);
    // re-stripe to ONE: the exact original segment back
    const one = stripeAt(ed, stripes[4], count(1));
    expect(one).toHaveLength(1);
    expect(one[0].attr('d')).toBe(original);
  });
  it('a contour LINE segment stripes the same way (straight halves)', () => {
    const ed = makeEditor(contourPattern());
    const segs = drawContour(ed);
    const i = segs.findIndex((s) => primitiveFromContourD(s.attr('d')).type === 'L');
    const len = primitiveLength(primitiveFromContourD(segs[i].attr('d')));
    const stripes = stripeAt(ed, segs[i], count(2));
    expect(stripes).toHaveLength(2);
    for (const s of stripes) expect(primitiveLength(primitiveFromContourD(s.attr('d')))).toBeCloseTo(len / 2, 2);
  });
});

describe('F27 item 3: Fusion side (sent AS DRAWN) -- a striped rail and a striped contour arc', () => {
  const REGION = { x: 0, y: 0, w: 7, h: 9 };
  const BOX = { id: 'p', spacing: 0.25, rails: { mode: 'every', every: 4, offset: 0 },
    ties: { mode: 'density', density: 1, anchor: 'free', spanMin: 1, spanMax: 2, railSnapRows: 0 },
    nodes: { ends: true, crossings: true, railEnds: false }, widths: { rails: 0.07, ties: 0.05, nodeDiameter: 0.15, linkRailsTies: true } };

  it('a rail striped into 5 on the canvas -> 5 rail Slots on one line, 4 Collinear + 4 explicit Coincident joints', () => {
    const drawn = drawnFromPattern(BOX, REGION);
    const r = drawn.rails[1];
    // stripe the drawn rail through the REAL tool on the mock canvas, then read the pieces back as Send does
    const ed = makeEditor({ ...BOX, colors: PATTERN_DEFAULTS.colors });
    const railEl = ed.line(r.p1.x, r.p1.y, r.p2.x, r.p2.y, RAIL);
    const stripes = stripeAt(ed, railEl, count(5));
    const pieces = stripes.map((s) => ({ p1: { x: +s.store.x1, y: +s.store.y1 }, p2: { x: +s.store.x2, y: +s.store.y2 }, overrideWidth: null }));
    const rails = [drawn.rails[0], ...pieces, ...drawn.rails.slice(2)];
    const m = buildSketchManifest(BOX, REGION, { drawn: { ...drawn, rails } });
    const ids = ['rail1', 'rail2', 'rail3', 'rail4', 'rail5'];
    for (const id of ids) expect(m.entities.find((e) => e.id === id)).toBeTruthy();
    const joints = m.constraints.filter((c) => c.type === 'Coincident' && ids.includes(c.targets[0].split(':')[0]) && ids.includes(c.targets[1].split(':')[0]));
    expect(joints.map((c) => c.targets)).toEqual([['rail1:E', 'rail2:S'], ['rail2:E', 'rail3:S'], ['rail3:E', 'rail4:S'], ['rail4:E', 'rail5:S']]);
    expect(m.constraints.filter((c) => c.type === 'Collinear' && ids.includes(c.targets[0]))).toHaveLength(4);
    for (const id of ids) expect(m.dimensions.find((d) => d.target === id).expression).toBe('stroke_width');
  });

  it('a contour arc striped into 3 -> 3 ArcCenterSlots on the SAME centre/radius/width, sweeps partitioning the arc, a Coincident at each seam', () => {
    const shape = { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null };
    const strokeWidth = PATTERN_DEFAULTS.widths.rails;
    const fresh = generateSilhouette(REGION, shape);
    const idx = fresh.primitives.findIndex((p) => p.type === 'A');
    const prim = fresh.primitives[idx];
    // stripe that arc through the REAL tool (its d-string round trip included), read the pieces back like Send
    const ed = makeEditor({ colors: PATTERN_DEFAULTS.colors, contour: { segmentColors: [] } });
    const els = fresh.primitives.map((p, i) => ed.path(primitiveToPathD(p), { [BOUNDARY_REF_ATTR]: 'b1', [CONTOUR_SEG_INDEX_ATTR]: i, 'stroke-width': strokeWidth }));
    stripeAt(ed, els[idx], count(3));
    const drawnPrimitives = ed.layer.list.slice().sort((a, b) => a.attr(CONTOUR_SEG_INDEX_ATTR) - b.attr(CONTOUR_SEG_INDEX_ATTR))
      .map((el) => primitiveFromContourD(el.attr('d')));
    expect(drawnPrimitives).toHaveLength(fresh.primitives.length + 2);
    const segments = drawnPrimitives.map((p) => (p.type === 'A'
      ? { style: 'curve', bulge: 0, dir: 'out', cornerRadius: 0 } : { style: 'straight', bulge: 0, dir: 'out', cornerRadius: 0 }));
    const m = manifestFromShape(shape, REGION, { widthMode: 'slot', strokeWidth, silhouette: { ...fresh, primitives: drawnPrimitives, segments, corners: [] }, noMirror: true });
    const ents = [idx, idx + 1, idx + 2].map((k) => m.entities.find((e) => e.id === `seg${k}`));
    for (const e of ents) {
      expect(e.type).toBe('ArcCenterSlot');
      // one centre: the stripes are written at STRIPE_D_DIGITS, so the re-derived centres agree to ~1e-5, not
      // the ~1e-3 a 3-decimal d-string gives a short sub-arc
      expect(Math.hypot(e.center[0] - ents[0].center[0], e.center[1] - ents[0].center[1])).toBeLessThan(1e-4);
      expect(Math.hypot(e.center[0] - prim.cx, e.center[1] - prim.cy)).toBeLessThan(2e-3); // = the original arc's
      expect(e.radius).toBeCloseTo(ents[0].radius, 4);
      expect(e.width).toBe(ents[0].width);
    }
    expect(ents.reduce((s, e) => s + e.sweepDeg, 0)).toBeCloseTo((prim.dTheta * 180) / Math.PI, 1);
    for (const k of [idx, idx + 1]) { // manifest seg ids are 0-based (seg<primitive index>)
      expect(m.constraints.some((c) => c.type === 'Coincident' && c.targets.includes(`seg${k}:E`) && c.targets.includes(`seg${k + 1}:S`))).toBe(true);
    }
  });
});

describe('F27 item 3: the tool is registered like the scissors (button + shortcut next to it, panel, drawer tab)', () => {
  const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf-8');
  it('#toolStripe sits right after #toolCut, shortcut S, and S is no other tool\'s key', () => {
    expect(html.indexOf('id="toolStripe"')).toBeGreaterThan(html.indexOf('id="toolCut"'));
    expect(html.slice(html.indexOf('id="toolCut"'), html.indexOf('id="toolStripe"')).match(/<button /g)).toHaveLength(1);
    expect(html.match(/data-key="s"/g)).toHaveLength(1);
    expect(html).toMatch(/id="toolStripe"[^>]*data-key="s"/);
  });
  it('panel shown only in stripe mode; a declared tool panel (the Art tabs: mounted under Layers, no drawer tab); the tool places its own cuts (no pointer snap)', () => {
    expect(TOOLBAR_GROUPS.editorStripePanel(undefined, null, 'stripe')).toBe(true);
    expect(TOOLBAR_GROUPS.editorStripePanel('stripe', null, 'cut')).toBe(false);
    expect(TOOL_PANELS.stripe).toEqual({ panelId: 'editorStripePanel' });
    expect(SNAP_POLICY.stripe).toBe('none');
    for (const id of ['editorStripePanel', 'stripeCount', 'stripeLength', 'stripeThree', 'stripeColorA', 'stripeColorB', 'stripeColorC', 'stripeColorsReset']) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});
