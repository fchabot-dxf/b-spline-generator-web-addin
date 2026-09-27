/**
 * T81 item 6, PRIORITY BUG (Fred: "I can't seem to select contour segment").
 * Investigated first: shapeLatticeHandler.start's own contour-segment-tap
 * branch (editor-interaction.js) resolved which segment was hit
 * (hitTestSegment) and opened the floating style bar (openSegmentStyleBar),
 * but never called editor._select/_selectAdd on the segment itself -- so it
 * never reached editor._selectedElements, the Selected-piece panel never
 * showed it, and per-segment colour (which reads that panel's own
 * selection) had no way to reach a segment via a plain tap. The rail/tie/
 * node branch two checks earlier in the SAME function already does both
 * (select AND arm its own gesture) -- this bug was that dual behavior
 * missing for contour alone.
 *
 * Driven through the REAL canvas handler (getModeHandler('shapeLattice'))
 * and the REAL selection machinery (editor-ui.js's select/selectAdd/
 * updateSelectionHighlight), same convention tests/lattice-drag-
 * highlight.test.js (T81 item 5) already established, combined with
 * tests/shape-lattice-segment-color.test.js's own real-contour-generation
 * harness (regenerateSilhouette, CONTOUR_SEG_INDEX_ATTR).
 */
import { describe, it, expect } from 'vitest';
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';
import { getModeHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { select, selectAdd, updateSelectionHighlight } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';
import { regenerateSilhouette, currentPattern, currentShape, _shapeContourRegion } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import { CONTOUR_SEG_INDEX_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { generateSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { primitiveSegmentMap } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';

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
        if (k && typeof k === 'object') { Object.assign(store, k); return elObj; }
        if (rest.length === 0) return store[k]; const v = rest[0]; if (v === null || v === undefined) delete store[k]; else store[k] = v; return elObj;
      },
      stroke(v) { if (typeof v === 'object' && v !== null) { if ('color' in v) store.stroke = v.color; if ('width' in v) store['stroke-width'] = v.width; } return elObj; },
      fill(v) { if (v !== undefined) store.fill = v; return elObj; },
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      clone() { return makeElement(type, { ...store }); },
      addClass() { return elObj; }, removeClass() { return elObj; }, hasClass() { return false; },
      back() { return elObj; },
      remove() { elements = elements.filter((e) => e !== elObj); },
    };
    elements.push(elObj);
    return elObj;
  }
  const sketchLayer = {
    line(x1, y1, x2, y2) { return makeElement('line', { x1, y1, x2, y2 }); },
    circle(d) { return makeElement('circle', { r: d / 2 }); },
    path(d) { return makeElement('path', { d }); },
    add(e) { elements.push(e); return e; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: {},
  };
  const highlightLayer = { add(e) { e._isHalo = true; return e; } };
  return {
    _mW: 7, _mH: 9, _sketchLayer: sketchLayer,
    _highlightLayer: highlightLayer,
    _draw: { viewbox: () => ({ x: 0, y: 0, w: 10, h: 10 }) },
    _getDynamicTolerance: () => 0.05,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }], _activeLayer: '0',
    _lattice: { drawKind: 'select' },
    _color: '#000', _strokeWidth: 0.02, _selectedElements: [], _paramHandles: [],
    _select(el) { select(this, el); },
    _selectAdd(el) { selectAdd(this, el); },
    _deselect() {
      this._selectedElements = [];
      for (const h of this._selectionHighlights || []) { try { h.remove(); } catch (_) {} }
      this._selectionHighlights = [];
      this._selectionHighlight = null;
    },
    _updateSelectionHighlight() { updateSelectionHighlight(this); },
    _updateHandles() {},
    _setHover() {}, _getMousePoint: (e) => ({ x: e.x, y: e.y }), _getNearbyElement: () => null,
    pushState() {}, _notifyChange() {}, _onChange() {},
    // Real method, not a reimplementation -- setColor calls this._commitStyleChange().
    _commitStyleChange: VectorEditor.prototype._commitStyleChange,
  };
}

const sortedSegs = (editor) => editor._sketchLayer.children().toArray()
  .filter((e) => e.node.hasAttribute(CONTOUR_SEG_INDEX_ATTR))
  .sort((a, b) => Number(a.attr(CONTOUR_SEG_INDEX_ATTR)) - Number(b.attr(CONTOUR_SEG_INDEX_ATTR)));

async function generatedEditor() {
  const editor = makeMockEditor();
  const p = currentPattern(editor);
  regenerateSilhouette(editor, p);
  const segs = sortedSegs(editor);
  return { editor, p, segs };
}

/** A point genuinely ON segment `segIndex`'s own drawn curve -- for an arc,
 *  the actual midpoint ALONG the curve (via its center/radius/angular
 *  span), not the chord midpoint, which can sag well outside any
 *  reasonable pick tolerance for a tightly-curved arc (measured: 0.18in for
 *  this hourglass's own shoulder arc, more than getDynamicTolerance's own
 *  default). Recomputed from `editor`/`p` the SAME way shapeLatticeHandler.
 *  start's own contour-tap branch does (generateSilhouette + _shapeContour
 *  Region), so this is exactly the geometry the handler will hit-test
 *  against, not a second, possibly-diverging copy of it. */
function midOf(editor, p, segIndex) {
  const shape = currentShape(p);
  const region = _shapeContourRegion(editor, p);
  const { primitives } = generateSilhouette(region, shape);
  const map = primitiveSegmentMap(shape.segments);
  const primIndex = map.indexOf(segIndex);
  const prim = primitives[primIndex];
  if (prim.type === 'L') return { x: (prim.p0.x + prim.p1.x) / 2, y: (prim.p0.y + prim.p1.y) / 2 };
  const theta = prim.theta1 + prim.dTheta * 0.5;
  return { x: prim.cx + prim.rx * Math.cos(theta), y: prim.cy + prim.ry * Math.sin(theta) };
}

/** One real tap on segment `segIndex`: `pt` doubles as the raw event's own
 *  `{x,y}` (this mock's own _getMousePoint reads `e.x`/`e.y`, matching
 *  every other lattice-drag test this session), plus `clientX`/`clientY`
 *  (openSegmentStyleBar's own positioning) and any extra event fields. */
function tapSegment(editor, p, segIndex, extra = {}) {
  const pt = midOf(editor, p, segIndex);
  const e = { x: pt.x, y: pt.y, clientX: 100, clientY: 100, ...extra };
  getModeHandler('shapeLattice').start(editor, pt, e);
}

describe('T81 item 6: tapping a Shape Lattice contour segment SELECTS it (not just the style bar)', () => {
  it('a tap on a segment adds it to editor._selectedElements (the Selected-piece panel\'s own source)', async () => {
    const { editor, p, segs } = await generatedEditor();
    expect(segs.length).toBeGreaterThan(2); // non-vacuous

    tapSegment(editor, p, 1);

    expect(editor._selectedElements).toEqual([segs[1]]);
  });

  it('the style bar still opens on the SAME tap (unchanged) -- selection is ADDED, not swapped in for it', async () => {
    document.body.innerHTML = '';
    const { editor, p, segs } = await generatedEditor();

    tapSegment(editor, p, 0);

    expect(editor._selectedElements).toEqual([segs[0]]);
    expect(document.querySelector('.shape-lattice-segment-bar')).toBeTruthy();
  });

  it('the selection halo is genuinely drawn (editor-ui.js\'s real machinery ran, not a stub)', async () => {
    const { editor, p } = await generatedEditor();

    tapSegment(editor, p, 0);

    const halo = editor._sketchLayer.children().toArray().find((e) => e._isHalo);
    expect(halo).toBeTruthy();
  });

  it('shift-tapping a SECOND segment adds to the selection (multi-select), matching rail/tie/node\'s own tap behaviour', async () => {
    const { editor, p, segs } = await generatedEditor();
    tapSegment(editor, p, 0);
    expect(editor._selectedElements).toEqual([segs[0]]);

    tapSegment(editor, p, 1, { shiftKey: true });

    expect(editor._selectedElements).toEqual([segs[0], segs[1]]);
  });

  it('a tap on an ARC segment (not just a straight one) is also selected', async () => {
    const { editor, p, segs } = await generatedEditor();
    // The hourglass's own shoulder/waist/hip segments are arcs; a corner
    // horn (segment 0) is a straight line -- pick one from the middle of
    // the list, genuinely an 'A' primitive, not just re-testing the
    // straight case.
    const arcSeg = segs.find((s) => /[Aa]\s/.test(s.attr('d')));
    expect(arcSeg).toBeTruthy(); // non-vacuous: the hourglass genuinely has arcs
    const arcIndex = Number(arcSeg.attr(CONTOUR_SEG_INDEX_ATTR));

    tapSegment(editor, p, arcIndex);

    expect(editor._selectedElements).toEqual([arcSeg]);
  });
});
