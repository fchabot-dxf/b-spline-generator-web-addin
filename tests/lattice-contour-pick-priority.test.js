/**
 * T81 item 6 re-reported (Fred: "I can't seem to select contour segment"). The GENERATED Shape Lattice
 * case (tapping directly ON a parametric segment, nothing else competing) was already fixed and is covered
 * by tests/shape-lattice-segment-select.test.js. This file covers the gap that fix didn't reach: a
 * HAND-PICKED boundary ("Pick shape…" in Shape Lattice, or Box Lattice's own only kind of boundary) has no
 * `shape.segments` for the analytic `_contourSegmentNear` to work from, so it returned null forever and a
 * nearby rail/tie/node ALWAYS won the pick-priority arbitration -- and Box Lattice's own press handler
 * (`latticeHandler.start`) had no such arbitration AT ALL, committing to any in-range rail/tie/node
 * unconditionally. Root cause and fix: `_boundaryNear` (editor-interaction.js) generalizes the distance
 * check to read the ACTUAL drawn boundary element(s) via `_findBoundaryElements` +
 * `primitiveFromContourD`/`nearestOnContourPrimitive` (the same machinery `_contourPieceAt` already used
 * to resolve a confirmed tap, just reused here for the DISTANCE a priority decision needs) when the shape
 * isn't 'generated'; `_contourWinsPick` is the ONE declared comparison, used by latticeHandler.start,
 * shapeLatticeHandler.start and _pickSelectable (the main Select tool) alike.
 *
 * Driven through the REAL canvas handlers (getModeHandler) and the REAL selection machinery
 * (editor-ui.js's select/selectAdd/updateSelectionHighlight), same convention established for T81 item 5.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getModeHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { select, selectAdd, updateSelectionHighlight } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';
import { BOUNDARY_REF_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

function makeMockEditor(mW = 10, mH = 10) {
  let elements = [];
  function makeElement(type, initial) {
    const store = { ...initial };
    const elObj = {
      type,
      node: { getAttribute: (k) => (store[k] !== undefined ? store[k] : null), hasAttribute: (k) => store[k] !== undefined },
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
  const editor = {
    _mW: mW, _mH: mH, _sketchLayer: sketchLayer, _highlightLayer: highlightLayer,
    _draw: { viewbox: () => ({ x: 0, y: 0, w: mW, h: mH }) },
    _getDynamicTolerance: () => 0.05,
    _layers: [{ id: '0', name: 'Layer 1', visible: true, pattern: {} }],
    _activeLayer: '0',
    _lattice: { drawKind: 'select' },
    _grid: { spacing: 0.25, visible: true },
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
    _setHover() {}, _getMousePoint: (e) => ({ x: e.x, y: e.y }),
    // A minimal stand-in for the real editor._getNearbyElement (editor-hit.js): nearest-segment distance,
    // same shape tests/cut-tool.test.js's own mock already uses -- it must find a plain boundary (a path,
    // for a straight "M x y L x y" `d` -- the same shape a hand-picked boundary is always drawn as) the
    // same as any other element (no LATTICE_ATTR filter), matching the real one's own behaviour, since
    // latticeHandler.start's/selectHandler's own fallback path depends on it.
    _getNearbyElement(pt, tol) {
      let best = null, bestD = tol;
      for (const el of sketchLayer.children().toArray()) {
        let a, b;
        if (el.type === 'line') {
          a = { x: parseFloat(el.attr('x1')), y: parseFloat(el.attr('y1')) };
          b = { x: parseFloat(el.attr('x2')), y: parseFloat(el.attr('y2')) };
        } else if (el.type === 'path') {
          const m = /M\s*([\d.-]+)\s+([\d.-]+)\s*L\s*([\d.-]+)\s+([\d.-]+)/.exec(el.attr('d') || '');
          if (!m) continue;
          a = { x: +m[1], y: +m[2] }; b = { x: +m[3], y: +m[4] };
        } else continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(a.x + t * dx - pt.x, a.y + t * dy - pt.y);
        if (d <= bestD) { bestD = d; best = el; }
      }
      return best;
    },
    pushState() {}, _notifyChange() {}, _onChange() {},
  };
  return editor;
}

function addRail(editor, x1, y1, x2, y2, strokeWidth = 0.05) {
  const el = editor._sketchLayer.line(x1, y1, x2, y2);
  el.attr({ 'data-lattice': 'rail', 'data-layer': '0', 'stroke-width': strokeWidth });
  return el;
}

/** A hand-picked boundary (Box Lattice's only kind; Shape Lattice's own "Pick shape…"): a single PATH
 *  element (a real boundary is always a path, read via primitiveFromContourD -- a 'line' type has no `d`
 *  attribute at all and _boundaryNear's own prim lookup would silently find nothing) tagged with
 *  BOUNDARY_REF_ATTR and no shape.segments anywhere -- this is the shape _contourSegmentNear never
 *  handled. A straight line at y=0 so its own distance-to-point math is trivial to reason about. */
function addHandPickedBoundary(editor, shapeId, x1, y1, x2, y2, strokeWidth = 0.02) {
  const el = editor._sketchLayer.path(`M ${x1} ${y1} L ${x2} ${y2}`);
  el.attr({ [BOUNDARY_REF_ATTR]: shapeId, 'data-layer': '0', 'stroke-width': strokeWidth });
  editor._layers[0].pattern = { ...editor._layers[0].pattern, boundary: { shapeId }, extent: { mode: 'boundary' } };
  return el;
}

beforeEach(() => { document.body.innerHTML = ''; });

for (const [label, mode] of [['Box Lattice', 'lattice'], ['Shape Lattice', 'shapeLattice']]) {
  describe(`T81 item 6 re-reported (${label}): a HAND-PICKED boundary wins the pick when it's genuinely closer`, () => {
    const h = () => getModeHandler(mode);

    // getDynamicTolerance falls back to a fixed 0.1 world units with no #editorSVGContainer in the DOM
    // (editor-hit.js, confirmed directly) -- every distance below is deliberately kept inside that window,
    // on BOTH sides of the comparison, so the rail is a genuine competing candidate in every case (not
    // merely out of range, which would pass regardless of whether the fix exists).
    it('a tap ON the boundary, with a rail crossing nearby (within range), selects the boundary -- not the rail (must fail before the fix)', () => {
      const editor = makeMockEditor();
      const boundary = addHandPickedBoundary(editor, 'b1', 0, 0, 5, 0); // the contour: a flat line at y=0
      const rail = addRail(editor, 0, 0.08, 5, 0.08); // 0.08 away: within the 0.1 tolerance, a real candidate

      h().start(editor, { x: 2.5, y: 0 }, { x: 2.5, y: 0 });

      expect(editor._selectedElements).toEqual([boundary]);
      expect(editor._selectedElements).not.toContain(rail);
    });

    it('a tap near the shared point, with the rail drawn reaching the boundary (realistic: rails are drawn ending ON the contour), still picks the boundary when it is the closer one', () => {
      const editor = makeMockEditor();
      const boundary = addHandPickedBoundary(editor, 'b1', 0, 0, 5, 0);
      // The rail's own END sits exactly on the boundary's line (as a real clipped rail would, slightly off
      // the tap's own x so the two distances differ) and its body runs down from there. A thin stroke
      // (0.02, matching the boundary's) so neither one's own visual width alone decides this -- the point
      // of this test is the CENTRELINE/edge comparison, not "is the tap literally inside a fat rail".
      const rail = addRail(editor, 2.52, 0, 2.52, 0.08, 0.02);

      h().start(editor, { x: 2.5, y: 0.015 }, { x: 2.5, y: 0.015 }); // edge 0.005 from the boundary, 0.01 from the rail

      expect(editor._selectedElements).toEqual([boundary]);
      expect(editor._selectedElements).not.toContain(rail);
    });

    it('regression guard: a tap genuinely closer to the rail than to the boundary still selects the rail (UI4 item 0)', () => {
      const editor = makeMockEditor();
      addHandPickedBoundary(editor, 'b1', 0, 0, 5, 0);
      const rail = addRail(editor, 2.52, 0, 2.52, 0.08);

      h().start(editor, { x: 2.52, y: 0.06 }, { x: 2.52, y: 0.06 }); // ON the rail's own centreline, 0.06 from the boundary

      expect(editor._selectedElements).toEqual([rail]);
    });
  });
}

describe('T81 item 6 re-reported (main Select tool): the SAME pick-priority rule', () => {
  // _pickSelectable's own bug (editor-interaction.js): its FIRST check trusts the generic
  // editor._getNearbyElement's plain centreline-distance search outright whenever that search's own
  // winner is a lattice piece -- never reconsidering it against the contour's own VISIBLE EDGE (stroke
  // width included). A thin rail just barely closer by raw centreline, against a much WIDER boundary
  // stroke whose edge the tap already sits inside, is a minimal case where the two disagree -- exactly
  // the condition the fix's edge-distance arbitration exists for (must fail before the fix).
  it('a tap whose raw centreline distance favours a thin rail, but whose VISIBLE EDGE is inside a wider boundary, selects the boundary via the global Select tool', () => {
    const editor = makeMockEditor();
    const boundary = addHandPickedBoundary(editor, 'b1', 0, 0, 5, 0, 0.15); // a fat boundary stroke
    const rail = addRail(editor, 0, 0.05, 5, 0.05, 0.001); // raw centreline CLOSER, but a hairline stroke

    getModeHandler('select').start(editor, { x: 2.5, y: 0.06 }, { x: 2.5, y: 0.06 });

    expect(editor._selectedElements).toEqual([boundary]);
    expect(editor._selectedElements).not.toContain(rail);
  });
});
