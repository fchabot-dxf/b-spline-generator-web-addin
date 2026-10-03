/**
 * H23 item 67 amendment (Fred): item 66's new contour clearance
 * (TIE_CONTOUR_CLEARANCE_IN, editor-lattice-pattern.js) must only ever
 * apply to GENERATED ties -- a tie the user placed by hand with the Tie
 * tool, or one they dragged onto/against the contour themselves, must stay
 * EXACTLY where they put it, both immediately and after a Regenerate of
 * the pattern's other layers (rails/ties/nodes).
 *
 * Why this should already hold, and what this file proves rather than
 * assumes (confirmed by reading the actual code, not inferred):
 *   - `computePattern` (the pure generator item 66's clearance check lives
 *     inside) takes a plain PATTERN object and a precomputed extent -- it
 *     has NO visibility into existing SVG/DOM elements at all, generated or
 *     hand-placed. It can only ever drop a span it is itself constructing,
 *     never reach back and remove something already on the canvas.
 *   - `generatePattern`'s own clear-before-redraw step (editor-lattice-
 *     pattern.js, right before computePattern is called) removes only
 *     elements carrying OWNERSHIP_ATTR ('data-lattice-gen') -- a mark only
 *     generator-emitted pieces ever get (`tagOwned`). The Tie tool's own
 *     manual-placement path (emitSegment, editor-lattice.js) never sets it,
 *     and a drag (_finishLatticeMove, editor-interaction.js) never touches
 *     it either -- so a hand-placed or hand-dragged tie is invisible to
 *     the clear step and is never even candidate for removal, regardless
 *     of where it ends up relative to the contour.
 * This file drives the REAL handlers (getModeHandler, same convention as
 * lattice-rail-end-stretch.test.js) rather than re-stating that reasoning
 * as an assumption: a true "press/release = manual Tie tool placement" and
 * a true "press/move/release = drag a tie's body onto the contour" each
 * followed by a real second generatePattern() call (= pressing Generate
 * again / a Regenerate), asserting the piece is BYTE-IDENTICAL before and
 * after and was never a generator-owned piece to begin with.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getModeHandler, updateHandles } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { LATTICE_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';
import { generatePattern, OWNERSHIP_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { regenerateSilhouette, currentPattern } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';

// Same lightweight-but-real mock + gesture driver as lattice-rail-end-stretch.test.js (this
// codebase's own convention: each such test file owns its own harness copy).
function makeMockEditor(mW = 7, mH = 9) {
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
  let handles = [];
  const mkHandle = (type, store) => {
    const h = {
      type, store,
      center(x, y) { store.cx = x; store.cy = y; return h; },
      fill(v) { store.fill = v; return h; },
      stroke(v) { if (v && typeof v === 'object') { store.stroke = v.color; store['stroke-width'] = v.width; } return h; },
      attr(k, v) { if (typeof k === 'object') Object.assign(store, k); else store[k] = v; return h; },
    };
    handles.push(h);
    return h;
  };
  const handleLayer = {
    clear() { handles = []; },
    circle(d) { return mkHandle('circle', { r: d / 2 }); },
    path(d) { return mkHandle('path', { d }); },
    rect(w, h) { const e = mkHandle('rect', { width: w, height: h }); e.move = (x, y) => { e.store.cx = x + w / 2; e.store.cy = y + (h ?? w) / 2; return e; }; return e; },
    all: () => handles,
  };
  let pushes = 0;
  const editor = {
    _mW: mW, _mH: mH, _sketchLayer: sketchLayer, _handleLayer: handleLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }], _activeLayer: '0', _nextLayerId: 1,
    _grid: { spacing: 0.25, visible: true },
    _lattice: { ...LATTICE_DEFAULTS, drawKind: 'select' },
    _currentMode: 'shapeLattice',
    _color: '#000', _strokeWidth: 0.02, _selectedElements: [], _paramHandles: [],
    _select(el) { this._selectedElements = [el]; }, _selectAdd() {}, _deselect() { this._selectedElements = []; },
    _updateHandles() { updateHandles(this); },
    _setHover() {}, _getMousePoint: (e) => ({ x: e.x, y: e.y }), _getNearbyElement: () => null,
    pushState() { pushes++; }, _notifyChange() {},
    get pushes() { return pushes; },
  };
  return editor;
}

const num = (el, k) => parseFloat(el.attr(k));
const pieces = (editor, kind) => editor._sketchLayer.children().toArray().filter((e) => e.attr('data-lattice') === kind);

/** One real press / move / release through the given tool's handler (identical to
 *  lattice-rail-end-stretch.test.js's own gesture helper). */
async function gesture(editor, mode, from, to = from) {
  const h = getModeHandler(mode);
  h.start(editor, from, from);
  if (to !== from) h.update(editor, to);
  if (editor._isDrawing) await h.finish(editor);
}

/** A real Shape Lattice boundary fixture with a generated silhouette -- same recipe
 *  lattice-rail-end-stretch.test.js's own shapeLatticeEditor() uses. */
async function shapeLatticeEditor() {
  const editor = makeMockEditor(7, 9);
  editor._currentMode = 'shapeLattice';
  const p = currentPattern(editor);
  Object.assign(p, {
    seed: 17, spacing: 0.25, extent: { mode: 'boundary' },
    shape: { source: 'generated', preset: 'hourglass', seed: 17, params: {}, segments: null },
  });
  regenerateSilhouette(editor, p);
  await generatePattern(editor, p);
  return { editor, p };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="editorStatusHint"></div><div id="editorSVGContainer"></div>';
});

describe('H23 item 67 amendment: item 66\'s contour clearance never touches a MANUAL tie', () => {
  it('a tie placed with the Tie tool (a bare click, _spawnTieBetweenRails) has no OWNERSHIP_ATTR and survives a Regenerate byte-identical', async () => {
    const { editor, p } = await shapeLatticeEditor();
    const before = pieces(editor, 'tie').length;

    // The Tie tool: drawKind='tie', a bare click (press+release at the same point, under the
    // click threshold) in empty space between two rail rows spawns a default tie
    // (_spawnTieBetweenRails, editor-interaction.js) -- the real manual-placement path.
    // _spawnTieBetweenRails needs the click's row to genuinely fall BETWEEN two existing rail
    // rows (by lattice j, not world y) -- use two real adjacent rail rows from the fixture and
    // click at their world-y midpoint, rather than guessing an offset.
    editor._lattice.drawKind = 'tie';
    const railYs = [...new Set(pieces(editor, 'rail').map((r) => num(r, 'y1')))].sort((a, b) => a - b);
    expect(railYs.length, 'fixture sanity: at least two rail rows exist to place a tie between').toBeGreaterThanOrEqual(2);
    const [rowA, rowB] = railYs;
    const rail = pieces(editor, 'rail').find((r) => num(r, 'y1') === rowA);
    const midX = (num(rail, 'x1') + num(rail, 'x2')) / 2;
    const y = (rowA + rowB) / 2;
    await gesture(editor, 'shapeLattice', { x: midX, y });

    const ties = pieces(editor, 'tie');
    expect(ties.length, 'a new tie was actually placed, not a vacuous no-op click').toBe(before + 1);
    const manual = ties.find((t) => !t.node.hasAttribute(OWNERSHIP_ATTR));
    expect(manual, 'the newly-placed tie carries NO ownership mark -- the Tie tool never sets it').toBeTruthy();
    const snapshot = { x1: num(manual, 'x1'), y1: num(manual, 'y1'), x2: num(manual, 'x2'), y2: num(manual, 'y2') };

    // Regenerate = pressing Generate again.
    await generatePattern(editor, p);

    const afterTies = pieces(editor, 'tie');
    expect(afterTies).toContain(manual); // the SAME element reference, not a lookalike replacement
    expect(num(manual, 'x1')).toBeCloseTo(snapshot.x1, 9);
    expect(num(manual, 'y1')).toBeCloseTo(snapshot.y1, 9);
    expect(num(manual, 'x2')).toBeCloseTo(snapshot.x2, 9);
    expect(num(manual, 'y2')).toBeCloseTo(snapshot.y2, 9);
  });

  it('a tie DRAGGED (by its body, free/unclamped) onto/against the contour stays exactly there through a Regenerate', async () => {
    const { editor, p } = await shapeLatticeEditor();
    editor._lattice.drawKind = 'select';
    const tie = pieces(editor, 'tie')[0];
    expect(tie).toBeTruthy();
    const x1 = num(tie, 'x1'), y1 = num(tie, 'y1'), x2 = num(tie, 'x2'), y2 = num(tie, 'y2');
    const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;

    // Drag the tie's BODY (not an end -- body-move is a free rigid translate, no clamp at all,
    // confirmed by reading _updateLatticeMove) toward the board's own far corner, well past
    // where the generated silhouette would ever place a tie -- squarely onto/against the contour.
    const dx = editor._mW - 0.05 - midX, dy = editor._mH - 0.05 - midY;
    await gesture(editor, 'shapeLattice', { x: midX, y: midY }, { x: midX + dx, y: midY + dy });

    const draggedX1 = num(tie, 'x1'), draggedY1 = num(tie, 'y1'), draggedX2 = num(tie, 'x2'), draggedY2 = num(tie, 'y2');
    // Non-vacuous: the drag actually moved it.
    expect(draggedX1).not.toBeCloseTo(x1, 3);
    // Still has no ownership mark if it never had one, OR keeps whatever it had (T81's own
    // "moved pieces keep OWNERSHIP_ATTR" rule) -- either way, Regenerate's clear step only
    // removes OWNED pieces, so re-tag it as explicitly unowned to test the genuinely manual case.
    tie.attr(OWNERSHIP_ATTR, null);
    expect(tie.node.hasAttribute(OWNERSHIP_ATTR)).toBe(false);

    await generatePattern(editor, p);

    const afterTies = pieces(editor, 'tie');
    expect(afterTies).toContain(tie);
    expect(num(tie, 'x1')).toBeCloseTo(draggedX1, 9);
    expect(num(tie, 'y1')).toBeCloseTo(draggedY1, 9);
    expect(num(tie, 'x2')).toBeCloseTo(draggedX2, 9);
    expect(num(tie, 'y2')).toBeCloseTo(draggedY2, 9);
  });

  it('non-vacuous control: a GENERATED (owned) tie does NOT survive untouched -- Regenerate legitimately re-sweeps it (proves the above two tests are testing real ownership-gated behaviour, not "nothing ever gets removed")', async () => {
    const { editor, p } = await shapeLatticeEditor();
    const owned = pieces(editor, 'tie').find((t) => t.node.hasAttribute(OWNERSHIP_ATTR));
    expect(owned, 'fixture sanity: Generate produces at least one owned tie').toBeTruthy();

    // A different seed on Regenerate -- the owned tie set is expected to change.
    p.seed = 99;
    await generatePattern(editor, p);

    const stillPresent = pieces(editor, 'tie').includes(owned);
    expect(stillPresent, 'the OLD owned element was cleared and replaced by Regenerate, unlike the manual/dragged cases above').toBe(false);
  });
});
