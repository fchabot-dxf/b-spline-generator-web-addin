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
import { describe, it, expect } from 'vitest';
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';
import { regenerateSilhouette, currentPattern, currentShape } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import { PATTERN_DEFAULTS, CONTOUR_SEG_INDEX_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { buildSketchManifest } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';

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
