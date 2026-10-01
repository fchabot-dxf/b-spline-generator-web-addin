/**
 * T81 item 5, PRIORITY BUG (Fred: "the yellow highlight is persistent even
 * after I released a moved tie"). Root cause (investigated first, then
 * fixed): the SELECTION HALO (editor-ui.js's updateSelectionHighlight,
 * #ffcc00) is a static clone of the piece taken at grab time (Select
 * sub-mode selects whatever lattice piece it just grabbed) -- every write
 * the lattice move code makes moves the REAL element, never the halo.
 * translateSelection/dragNode (the Select/Node-mode drag paths) already
 * refresh it every move tick; the lattice move path (_updateLatticeMove /
 * _finishLatticeMove) never did, on any exit path, so the halo stayed
 * glued to the piece's PRE-drag position for the whole gesture and beyond.
 *
 * REPRODUCE FIRST, with real pointer events, through the REAL canvas
 * handlers (getModeHandler) for BOTH tools this bug affects (rect Lattice
 * and Shape Lattice) -- the actual `select`/`updateSelectionHighlight`
 * (editor-ui.js) machinery runs for real; only the DOM-adjacent bits that
 * machinery defensively try/catches around (active-layer sync, toolbar
 * color sync) are left absent, which is exactly what those try/catches
 * are for.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getModeHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { select, selectAdd, updateSelectionHighlight } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';
import { LATTICE_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';

function makeMockEditor() {
  let elements = [];
  function makeElement(type, initial) {
    const store = { ...initial };
    // isConnected: true/false on .remove(), the same convention editor-grid.test.js's own mocks use for
    // the real source's "is this element still live" check (editor-grid.js's own _connected()).
    const node = { getAttribute: (k) => (store[k] !== undefined ? store[k] : null), hasAttribute: (k) => store[k] !== undefined, isConnected: true };
    const elObj = {
      type,
      node,
      attr(k, ...rest) {
        if (k && typeof k === 'object') { Object.assign(store, k); return elObj; }
        if (rest.length === 0) return store[k]; const v = rest[0]; if (v === null || v === undefined) delete store[k]; else store[k] = v; return elObj;
      },
      stroke(v) { if (typeof v === 'object' && v !== null) { if ('color' in v) store.stroke = v.color; if ('width' in v) store['stroke-width'] = v.width; } return elObj; },
      fill(v) { if (v !== undefined) store.fill = v; return elObj; },
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      clone() { return makeElement(type, { ...store }); }, // a REAL snapshot-at-this-instant, same as svg.js's own .clone()
      addClass() { return elObj; }, removeClass() { return elObj; }, hasClass() { return false; },
      back() { return elObj; },
      remove() { node.isConnected = false; elements = elements.filter((e) => e !== elObj); },
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
  // T81 item 5: a highlight clone (el.clone(), inside _renderHighlight) is
  // already an element of THIS SAME sketch layer the instant it's created
  // (makeElement always registers into the one shared `elements` array,
  // same as every other mock this session) -- marking it here, rather than
  // tracking a second array, means .remove() (already correct for every
  // OTHER element) tears a stale halo down for free, with no separate array
  // to fall out of sync with it.
  const highlightLayer = { add(e) { e._isHalo = true; return e; } };
  return {
    _sketchLayer: sketchLayer,
    _highlightLayer: highlightLayer,
    // T81 item 5: truthy + a working .viewbox() so _renderHighlight's own
    // `!editor._draw` guard passes AND the real getDynamicTolerance (used
    // for hit-testing) can call .viewbox() without throwing; no
    // #editorSVGContainer in the DOM makes it fall back to its own safe
    // default tolerance regardless of the exact viewbox values.
    _draw: { viewbox: () => ({ x: 0, y: 0, w: 10, h: 10 }) },
    _getDynamicTolerance: () => 0.02,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }], _activeLayer: '0',
    _grid: { spacing: 0.25, visible: true },
    _lattice: { ...LATTICE_DEFAULTS },
    _color: '#000', _strokeWidth: 0.02, _selectedElements: [],
    _select(el) { select(this, el); },
    _selectAdd(el) { selectAdd(this, el); },
    // Matches editor.js's own _deselect essentials (svg-selected class +
    // every highlight halo) -- select()/selectAdd() (editor-ui.js) both
    // call editor._deselect() themselves before setting the new selection.
    _deselect() {
      this._selectedElements = [];
      for (const h of this._selectionHighlights || []) { try { h.remove(); } catch (_) {} }
      this._selectionHighlights = [];
      this._selectionHighlight = null;
    },
    _updateSelectionHighlight() { updateSelectionHighlight(this); },
    _updateHandles() {}, // _afterSelectionChange (editor-ui.js) calls this unconditionally
    _setHover() {}, _getMousePoint: (e) => ({ x: e.x, y: e.y }), _getNearbyElement: () => null,
    pushState() {}, _notifyChange() {}, _onChange() {},
  };
}

function addTie(editor, x1, y1, x2, y2) {
  const el = editor._sketchLayer.line(x1, y1, x2, y2);
  el.attr({ 'data-lattice': 'tie', 'data-layer': '0' });
  return el;
}

function addRail(editor, x1, y1, x2, y2) {
  const el = editor._sketchLayer.line(x1, y1, x2, y2);
  el.attr({ 'data-lattice': 'rail', 'data-layer': '0', 'stroke-width': 0.05 });
  return el;
}

const haloItems = (editor) => editor._sketchLayer.children().toArray().filter((e) => e._isHalo);
const liveTies = (editor) => editor._sketchLayer.children().toArray().filter((e) => e.attr('data-lattice') === 'tie');

beforeEach(() => { document.body.innerHTML = ''; });

for (const [label, mode] of [['rect Lattice', 'lattice'], ['Shape Lattice', 'shapeLattice']]) {
  describe(`T81 item 5 (${label}): the selection halo tracks a moved tie, live and after release`, () => {
    const h = () => getModeHandler(mode);

    it('grabbing the tie selects it and draws a halo at its ORIGINAL position', () => {
      const editor = makeMockEditor();
      const tie = addTie(editor, 1, 1, 1, 3);
      h().start(editor, { x: 1, y: 2 }, { x: 1, y: 2 }); // body grab (midpoint, not an end) -> MOVE, not stretch

      expect(editor._selectedElements).toEqual([tie]);
      expect(haloItems(editor).length).toBe(1);
      expect(haloItems(editor)[0].attr('x1')).toBeCloseTo(1, 6);
      expect(haloItems(editor)[0].attr('y1')).toBeCloseTo(1, 6);
      expect(haloItems(editor)[0].attr('y2')).toBeCloseTo(3, 6);
    });

    it('MID-DRAG: the halo tracks the tie live, not frozen at the grab position (must fail before the fix)', () => {
      const editor = makeMockEditor();
      addTie(editor, 1, 1, 1, 3);
      h().start(editor, { x: 1, y: 2 }, { x: 1, y: 2 });

      h().update(editor, { x: 3, y: 2 }); // drag 2 units sideways

      expect(haloItems(editor).length).toBe(1); // the stale one was torn down, not stacked
      const live = haloItems(editor)[0];
      expect(live.attr('x1')).toBeCloseTo(3, 6);
      expect(live.attr('x1')).not.toBeCloseTo(1, 6); // NOT still at the grab-time position
    });

    it('AFTER RELEASE: the halo matches the tie\'s FINAL position, not its pre-drag one (Fred\'s own report)', async () => {
      const editor = makeMockEditor();
      const tie = addTie(editor, 1, 1, 1, 3);
      h().start(editor, { x: 1, y: 2 }, { x: 1, y: 2 });
      h().update(editor, { x: 3, y: 2 });

      await h().finish(editor);

      expect(haloItems(editor).length).toBe(1); // exactly one -- no leftover stale clone alongside a fresh one
      const finalHalo = haloItems(editor)[0];
      expect(finalHalo.attr('x1')).toBeCloseTo(tie.attr('x1'), 6);
      expect(finalHalo.attr('x2')).toBeCloseTo(tie.attr('x2'), 6);
      expect(finalHalo.attr('x1')).not.toBeCloseTo(1, 6); // NOT the pre-drag position -- this is the reported bug
    });

    it('a bare click with no actual movement leaves the (already-correct) halo alone, no crash', async () => {
      const editor = makeMockEditor();
      const tie = addTie(editor, 1, 1, 1, 3);
      h().start(editor, { x: 1, y: 2 }, { x: 1, y: 2 });

      await h().finish(editor); // no update() call -- a bare grab-and-release

      expect(haloItems(editor).length).toBe(1);
      expect(haloItems(editor)[0].attr('x1')).toBeCloseTo(tie.attr('x1'), 6);
    });

    it('every exit path clears the STALE halo the same way: pointercancel (via the same finish()) too', async () => {
      const editor = makeMockEditor();
      addTie(editor, 1, 1, 1, 3);
      h().start(editor, { x: 1, y: 2 }, { x: 1, y: 2 });
      h().update(editor, { x: 5, y: 2 });
      // handleEnd dispatches pointerup AND pointercancel to the SAME
      // handler.finish (editor-interaction.js) -- exercised directly here.
      await h().finish(editor);
      expect(haloItems(editor)[0].attr('x1')).toBeCloseTo(5, 6);
    });

    // T81 item 5 re-reported (Fred saw the yellow highlight persist again): the general case above was
    // genuinely fixed on 2026-09-27, but T81 item 7 (grab a rail end to change its length, same day, ~1h
    // later) added pruneAfterRailStretch -- removing a tie/node left past a shortened rail's new end --
    // without telling the selection/halo machinery. A tie pruned while SELECTED stays in
    // editor._selectedElements (now pointing at a detached element) and its halo clone is never torn down.
    // Reproduced via the one real-world path that can leave a PRUNED piece still selected at the moment of
    // pruning: grabbing a rail end that is ALREADY part of a multi-selection does not replace the
    // selection (editor-interaction.js only calls _select() when the hit is NOT already selected), so a
    // tie multi-selected alongside that rail rides along, selected, right up to the moment it is pruned.
    it('a MULTI-selected tie pruned by a rail-end stretch loses its halo too, not just its DOM element (must fail before the fix)', async () => {
      const editor = makeMockEditor();
      const rail = addRail(editor, 0.5, 1, 3, 1);
      addRail(editor, 0.5, 2, 3, 2);
      const farTie = addTie(editor, 2.5, 1, 2.5, 2); // on the rail's row at i=2.5 -> pruned once the rail shortens to i=2
      addTie(editor, 1, 1, 1, 2); // kept, well inside the shortened rail

      editor._select(rail);
      editor._selectAdd(farTie);
      expect(editor._selectedElements).toEqual([rail, farTie]);
      expect(haloItems(editor).length).toBe(2);

      // Grab the rail's own END (x=3,y=1): it's already selected, so this does NOT replace the selection.
      h().start(editor, { x: 3, y: 1 }, { x: 3, y: 1 });
      h().update(editor, { x: 2, y: 1 }); // shortens the rail past farTie at i=2.5
      await h().finish(editor);

      expect(liveTies(editor)).not.toContain(farTie); // pruned, as T81 item 7 intends
      expect(editor._selectedElements).not.toContain(farTie); // must not linger as a detached "selected" element
      expect(editor._selectedElements).toContain(rail);
      expect(haloItems(editor).length).toBe(1); // only the rail's own halo -- no orphaned clone for the pruned tie
    });
  });
}
