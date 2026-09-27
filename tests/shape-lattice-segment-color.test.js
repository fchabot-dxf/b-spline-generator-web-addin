/**
 * T73 (SE14b) — the Shape Lattice contour drawn as N selectable,
 * per-segment-colourable elements. Covers the dispatch's own explicit
 * acceptance tests: N drawn segments = N manifest contour entities;
 * recolour one -> only it changes; regenerate (same count) keeps it;
 * regenerate (count change, preset swap) resets it; the show-contour
 * checkbox off hides all segments, not just one.
 *
 * Mock editor: same lightweight-but-real shape properties-shape-
 * lattice.test.js's own `makeMockEditor` already established (`.path()`
 * elements exposing `node.hasAttribute`/`attr`/`stroke`/`clone`, real
 * `regenerateSilhouette`/`generatePattern` run against it), PLUS
 * `_updateSelectionHighlight` (editor-color.test.js's own requirement —
 * `VectorEditor.prototype.setColor` calls it unconditionally).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';
import {
  regenerateSilhouette, regenerateSilhouetteAndFill, randomizeSegmentColors, currentPattern, currentShape,
} from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import {
  PATTERN_DEFAULTS, CONTOUR_SEG_INDEX_ATTR, hasContourSegmentColor, clearContourSegmentColor,
  resolvePatternLayer, latticeColorPool,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { buildSketchManifest } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { pickColorDiffering } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-color.js';
import { setFrameProfileProvider } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';

function makeMockEditor() {
  let elements = [];
  function makeElement(type, initial) {
    const store = { ...initial };
    const elObj = {
      type,
      node: {
        getAttribute: (k) => (store[k] !== undefined ? store[k] : null),
        hasAttribute: (k) => store[k] !== undefined,
      },
      attr(k, ...rest) {
        if (rest.length === 0) return store[k];
        const v = rest[0];
        if (v === null || v === undefined) delete store[k];
        else store[k] = v;
        return elObj;
      },
      stroke(v) {
        if (typeof v === 'object' && v !== null) {
          if ('color' in v) store.stroke = v.color;
          if ('width' in v) store['stroke-width'] = v.width;
        }
        return elObj;
      },
      fill(v) { if (v !== undefined) store.fill = v; return elObj; },
      // T81 item 3: randomizeSegmentColors goes through regenerateSilhouetteAndFill
      // -> generatePattern, which emits lattice nodes via emitNode's own
      // .circle(d).center(x,y) chain -- this mock's own generator tests
      // never needed .center() before (contour-only), so it's added here.
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      addClass() { return elObj; },
      removeClass() { return elObj; },
      hasClass() { return false; },
      remove() { elements = elements.filter((e) => e !== elObj); },
      clone() { return makeElement(type, { ...store }); },
    };
    return elObj;
  }
  const sketchLayer = {
    line(x1, y1, x2, y2) { const e = makeElement('line', { x1, y1, x2, y2 }); elements.push(e); return e; },
    circle(d) { const e = makeElement('circle', { r: d / 2 }); elements.push(e); return e; },
    path(d) { const e = makeElement('path', { d }); elements.push(e); return e; },
    add(e) { elements.push(e); return e; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: {},
  };
  return {
    _mW: 4, _mH: 6,
    _sketchLayer: sketchLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    _color: '#000',
    _strokeWidth: 0.02,
    _selectedElements: [],
    pushState() {},
    _onChange() {},
    _notifyChange() {},
    _updateSelectionHighlight() {},
    // Real method, not a reimplementation -- setColor calls
    // this._commitStyleChange(), matching editor-color.test.js's own
    // mockStyleEditor convention.
    _commitStyleChange: VectorEditor.prototype._commitStyleChange,
  };
}

function sortedSegs(editor) {
  return editor._sketchLayer.children()
    .filter((e) => e.node.hasAttribute(CONTOUR_SEG_INDEX_ATTR))
    .sort((a, b) => Number(a.attr(CONTOUR_SEG_INDEX_ATTR)) - Number(b.attr(CONTOUR_SEG_INDEX_ATTR)));
}

describe('T73 (SE14b): Shape Lattice contour as N selectable, per-segment-colourable segments', () => {
  it('N drawn segments = N manifest contour entities', () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p);
    const segEls = sortedSegs(editor);
    expect(segEls.length).toBeGreaterThan(0); // non-vacuous
    const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
    const manifest = buildSketchManifest(p, region, {});
    const contourEntities = manifest.entities.filter((e) => /^seg\d+$/.test(e.id));
    expect(segEls.length).toBe(contourEntities.length);
  });

  it('recolouring one segment via the normal select tool + setColor changes ONLY that segment', () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p);
    const segEls = sortedSegs(editor);
    expect(segEls.length).toBeGreaterThan(1); // non-vacuous: more than one to distinguish
    const defaultColor = PATTERN_DEFAULTS.colors.contour;
    expect(segEls[2].attr('stroke')).toBe(defaultColor); // baseline, before recolor

    editor._selectedElements = [segEls[2]];
    VectorEditor.prototype.setColor.call(editor, '#ff00ff');

    expect(segEls[2].attr('stroke')).toBe('#ff00ff');
    for (let i = 0; i < segEls.length; i++) {
      if (i === 2) continue;
      expect(segEls[i].attr('stroke')).toBe(defaultColor);
    }
    expect(p.contour.segmentColors[2]).toBe('#ff00ff');
  });

  it('a regenerate with the SAME segment count keeps the per-segment colour override', () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p);
    const segEls = sortedSegs(editor);
    editor._selectedElements = [segEls[1]];
    VectorEditor.prototype.setColor.call(editor, '#123456');

    currentShape(p).params = { waistReach: 0.8 }; // same preset -> same topology/segment count
    regenerateSilhouette(editor, p);
    const segElsAfter = sortedSegs(editor);
    expect(segElsAfter.length).toBe(segEls.length); // non-vacuous: count genuinely unchanged
    expect(segElsAfter[1].attr('stroke')).toBe('#123456');
  });

  it('a regenerate with a DIFFERENT segment count (preset swap) resets per-segment colour overrides', () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p); // hourglass: 12 segments
    const segEls = sortedSegs(editor);
    editor._selectedElements = [segEls[0]];
    VectorEditor.prototype.setColor.call(editor, '#abcdef');
    expect(p.contour.segmentColors[0]).toBe('#abcdef');

    currentShape(p).preset = 'bottle'; // bottle: 10 segments -- a genuinely different count
    regenerateSilhouette(editor, p);
    const segElsAfter = sortedSegs(editor);
    expect(segElsAfter.length).not.toBe(segEls.length); // non-vacuous: topology genuinely changed
    expect(p.contour.segmentColors).toEqual([]);
    expect(segElsAfter[0].attr('stroke')).toBe(PATTERN_DEFAULTS.colors.contour);
  });

  it('the "show contour" checkbox off hides ALL N drawn segments, not just one', () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p);
    const segEls = sortedSegs(editor);
    expect(segEls.length).toBeGreaterThan(1); // non-vacuous: more than one to hide
    for (const el of segEls) expect(el.attr('display')).not.toBe('none');

    p.contour = { ...p.contour, show: false };
    regenerateSilhouette(editor, p);
    const segElsAfter = sortedSegs(editor);
    expect(segElsAfter.length).toBe(segEls.length); // same elements, not removed
    for (const el of segElsAfter) expect(el.attr('display')).toBe('none');
  });
});

describe('H2 (SEG-COLOR-PANEL): hasContourSegmentColor / clearContourSegmentColor', () => {
  it('reports no override on a freshly-generated segment, then true once one is set', () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p);
    const segEls = sortedSegs(editor);
    expect(hasContourSegmentColor(editor, segEls[1])).toBe(false);

    editor._selectedElements = [segEls[1]];
    VectorEditor.prototype.setColor.call(editor, '#ff00ff');
    expect(hasContourSegmentColor(editor, segEls[1])).toBe(true);
    // non-vacuous: an UNTOUCHED sibling segment still reads as not-overridden
    expect(hasContourSegmentColor(editor, segEls[0])).toBe(false);
  });

  it('clearing DELETES the stored entry (not just overwrites it with the default) and repaints the element', () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p);
    const segEls = sortedSegs(editor);
    editor._selectedElements = [segEls[1]];
    VectorEditor.prototype.setColor.call(editor, '#ff00ff');
    expect(p.contour.segmentColors[1]).toBe('#ff00ff');

    clearContourSegmentColor(editor, segEls[1], PATTERN_DEFAULTS.colors.contour);

    expect(segEls[1].attr('stroke')).toBe(PATTERN_DEFAULTS.colors.contour);
    expect(hasContourSegmentColor(editor, segEls[1])).toBe(false);
    // the real assertion "cleared" makes beyond hasContourSegmentColor: the
    // array slot is gone, not merely holding a copy of today's default —
    // so a LATER change to the pattern's own Contour colour would still
    // reach this segment (unlike a pinned override).
    expect(1 in p.contour.segmentColors).toBe(false);
  });

  it('is a no-op on an element that is not a contour segment', () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p);
    const rail = editor._sketchLayer.line(0, 0, 1, 0);
    expect(hasContourSegmentColor(editor, rail)).toBe(false);
    expect(() => clearContourSegmentColor(editor, rail, '#000')).not.toThrow();
  });

  // Live-CDP-only finding (this mock's own `attr()` never coerces, so it
  // could never have caught this): svg.js's REAL `.attr()` auto-coerces a
  // numeric-looking attribute value to an actual JS number. A caller that
  // reads `el.attr('data-layer')` directly (as `_storeContourSegmentColor`
  // already did, pre-H2, and as this file's own new
  // hasContourSegmentColor/clearContourSegmentColor now also do) can hand
  // resolvePatternLayer a NUMBER while every layer's `.id` is a STRING —
  // this reproduces that exact mismatch directly against
  // resolvePatternLayer's own layer array, independent of svg.js/the mock.
  it('resolves a layer even when layerId arrives as a NUMBER (svg.js attr() coercion) against string layer ids', () => {
    const editor = {
      _layers: [
        { id: '0', pattern: { contour: { segmentColors: ['seeded'] } } },
        { id: '1', patternOwner: '0' },
      ],
    };
    expect(resolvePatternLayer(editor, 1)).toBe(editor._layers[0]); // numeric patternOwner-holder lookup
    expect(resolvePatternLayer(editor, '1')).toBe(editor._layers[0]); // string form still works
    expect(resolvePatternLayer(editor, 0)).toBe(editor._layers[0]); // numeric direct-pattern-holder lookup
  });
});

// T81 item 3 (Fred: "in shape lattice contour, add a randomize segment
// color button"). A simple seeded LCG, not Math.random, wherever a test
// needs a REPRODUCIBLE sequence (the algorithm's own correctness); the
// "each click gives a new draw" test uses the real default (Math.random)
// on purpose, to prove that's actually wired through.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const POOL = ['#c62828', '#f9c80e', '#1a237e'];

// build a cyclic sequence the way randomizeSegmentColors does: each vs its predecessor, the last also vs the first
function cyclicDraw(pool, n, rng) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(pickColorDiffering(pool, [i > 0 ? out[i - 1] : null, i === n - 1 && n > 1 ? out[0] : null], rng));
  return out;
}

describe('T81 item 8: pickColorDiffering -- ONE helper, explicit pool, neighbour constraints', () => {
  it('every draw comes from the given pool, never an arbitrary hex', () => {
    for (let seed = 1; seed <= 20; seed++) expect(POOL).toContain(pickColorDiffering(POOL, [], seededRng(seed)));
  });

  it('differs from every non-null neighbour when the pool allows it', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(pickColorDiffering(POOL, ['#c62828', '#f9c80e'], seededRng(seed))).toBe('#1a237e');
      expect(pickColorDiffering(POOL, ['#c62828', null], seededRng(seed))).not.toBe('#c62828');
    }
  });

  it('3 colours: no two cyclically-adjacent equal for every loop length, odd ones included', () => {
    for (const n of [2, 3, 4, 5, 7, 12, 13]) {
      for (let seed = 1; seed <= 20; seed++) {
        const out = cyclicDraw(POOL, n, seededRng(seed));
        for (let i = 1; i < n; i++) expect(out[i], `n=${n} seed=${seed} i=${i}`).not.toBe(out[i - 1]);
        expect(out[n - 1], `n=${n} seed=${seed} wrap`).not.toBe(out[0]);
      }
    }
  });

  it('<3 distinct colours relaxes (first neighbour wins, then anything) instead of stalling; duplicates in the pool count once', () => {
    const two = ['#111', '#222', '#111'];
    expect(pickColorDiffering(two, ['#111', '#222'], seededRng(1))).toBe('#222');
    expect(pickColorDiffering(['#111'], ['#111'], seededRng(1))).toBe('#111');
    expect(pickColorDiffering([], ['#111'], seededRng(1))).toBeNull();
  });

  it('the same rng sequence gives the same draw (deterministic)', () => {
    expect(cyclicDraw(POOL, 12, seededRng(7))).toEqual(cyclicDraw(POOL, 12, seededRng(7)));
  });
});

describe('T81 item 3: randomizeSegmentColors -- through the EXISTING per-segment colour path', () => {
  afterEach(() => setFrameProfileProvider(() => null));

  it('assigns every drawn segment a palette colour, no two neighbours equal, applied to the LIVE elements', async () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p);
    const segEls = sortedSegs(editor);
    expect(segEls.length).toBeGreaterThan(2); // non-vacuous

    await randomizeSegmentColors(editor, seededRng(3));

    expect(p.contour.segmentColors.length).toBe(segEls.length);
    const segElsAfter = sortedSegs(editor);
    const pool = latticeColorPool(p);
    expect(pool.length).toBe(3); // non-vacuous: the defaults' own three distinct kind colours
    for (let i = 0; i < segElsAfter.length; i++) {
      // T81 item 8: ONLY the lattice's own Rails/Ties/Nodes colours, not the 32-colour app palette
      expect(pool).toContain(segElsAfter[i].attr('stroke'));
      // the SAME field regenerateSilhouette's own per-segment loop reads --
      // not a second, direct DOM write this function invented on its own.
      expect(segElsAfter[i].attr('stroke')).toBe(p.contour.segmentColors[i]);
    }
    for (let i = 1; i < segElsAfter.length; i++) expect(segElsAfter[i].attr('stroke')).not.toBe(segElsAfter[i - 1].attr('stroke'));
    expect(segElsAfter[segElsAfter.length - 1].attr('stroke')).not.toBe(segElsAfter[0].attr('stroke')); // wrap-around
  });

  it('each click gives a NEW draw (the real default, Math.random -- not a fixed sequence)', async () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p);
    expect(sortedSegs(editor).length).toBeGreaterThanOrEqual(10); // non-vacuous

    // a 3-colour pool leaves ~2 choices per segment, so compare several clicks, not just two:
    // all five identical has a ~(1/2)^40 chance
    const draws = [];
    for (let k = 0; k < 5; k++) {
      await randomizeSegmentColors(editor);
      draws.push(JSON.stringify(p.contour.segmentColors));
    }
    expect(new Set(draws).size).toBeGreaterThan(1);
  });

  it('one undo step reverts all (ONE pushState/_notifyChange commit, not one per segment)', async () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p);
    let pushCount = 0, commitCount = 0;
    editor.pushState = () => { pushCount++; };
    editor._notifyChange = (kind) => { if (kind === 'commit') commitCount++; };

    await randomizeSegmentColors(editor, seededRng(4));

    expect(pushCount).toBe(1);
    expect(commitCount).toBe(1);
  });

  it('a KINK segment (1 topology segment -> 2 drawn primitives) still gets exactly one colour per DRAWN segment, not per topology segment', async () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p);
    const shape = currentShape(p);
    const topologyCount = shape.segments.length;
    shape.segments[0] = { ...shape.segments[0], style: 'kink', bulge: 0.4, user: true };
    regenerateSilhouette(editor, p);
    const segEls = sortedSegs(editor);
    expect(segEls.length).toBe(topologyCount + 1); // non-vacuous: the kink genuinely added one drawn primitive

    await randomizeSegmentColors(editor, seededRng(5));

    expect(p.contour.segmentColors.length).toBe(segEls.length);
    for (const el of sortedSegs(editor)) expect(latticeColorPool(p)).toContain(el.attr('stroke'));
  });

  it('works when the contour is Offset-from-frame, not just the Shape preset', async () => {
    setFrameProfileProvider(() => ({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }) }));
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    p.contour = { ...PATTERN_DEFAULTS.contour, fromFrame: { ...PATTERN_DEFAULTS.contour.fromFrame, on: true } };
    regenerateSilhouette(editor, p);
    const segEls = sortedSegs(editor);
    expect(segEls.length).toBeGreaterThan(2); // non-vacuous: the frame-offset contour genuinely drew segments

    await randomizeSegmentColors(editor, seededRng(6));

    const segElsAfter = sortedSegs(editor);
    expect(segElsAfter.length).toBe(segEls.length);
    expect(p.contour.segmentColors.length).toBe(segEls.length);
    for (const el of segElsAfter) expect(latticeColorPool(p)).toContain(el.attr('stroke'));
  });

  it('T81 item 8: draws ONLY the pattern\'s CURRENT Rails/Ties/Nodes colours (Fred: "only use the colors set for rail node and tie")', async () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    p.colors = { ...PATTERN_DEFAULTS.colors, rails: '#010101', ties: '#020202', nodes: '#030303' };
    regenerateSilhouette(editor, p);
    const segEls = sortedSegs(editor);
    expect(segEls.length).toBeGreaterThan(2); // non-vacuous

    await randomizeSegmentColors(editor, seededRng(11));

    const allowed = ['#010101', '#020202', '#030303'];
    for (const c of p.contour.segmentColors) expect(allowed).toContain(c);
    const out = p.contour.segmentColors;
    for (let i = 1; i < out.length; i++) expect(out[i]).not.toBe(out[i - 1]);
    expect(out[out.length - 1]).not.toBe(out[0]);
  });

  it('a fresh, never-generated pattern is a no-op (nothing to colour yet)', async () => {
    const editor = makeMockEditor();
    const p = currentPattern(editor);
    await expect(randomizeSegmentColors(editor, seededRng(1))).resolves.not.toThrow();
    expect(p.contour?.segmentColors ?? []).toEqual([]);
  });
});
