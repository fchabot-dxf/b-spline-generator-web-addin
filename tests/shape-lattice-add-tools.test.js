/**
 * T80 item 2 (Fred: "where are add geometry tools"): Shape Lattice's icon
 * row gets [Select][Rail][Tie][Node] like the box Lattice tool, drawing
 * through the SAME latticeHandler (one add path). A hand rail is clipped to
 * the silhouette exactly as a generated rail on that row is. Hand-added
 * pieces follow the box Lattice rule on Regenerate: they carry no ownership
 * mark, so Regenerate (which replaces only owned pieces) keeps them.
 *
 * Driven through the real Shape Lattice canvas handler (getModeHandler)
 * with press/move/release, on the same lightweight mock the lattice
 * generator tests use.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { generatePattern, OWNERSHIP_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { regenerateSilhouette, currentPattern } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import { getModeHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { LATTICE_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';

function makeMockEditor(mW, mH) {
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
  return {
    _mW: mW, _mH: mH, _sketchLayer: sketchLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }], _activeLayer: '0', _nextLayerId: 1,
    _grid: { spacing: 0.25, visible: true },
    _lattice: { ...LATTICE_DEFAULTS },
    _color: '#000', _strokeWidth: 0.02, _selectedElements: [], _paramHandles: [],
    _select(el) { this._selectedElements = [el]; }, _selectAdd() {}, _deselect() { this._selectedElements = []; },
    _setHover() {}, _getMousePoint: (e) => ({ x: e.x, y: e.y }), _getNearbyElement: () => null,
    pushState() {}, _notifyChange() {},
  };
}

async function shapeLatticeEditor() {
  const editor = makeMockEditor(7, 9);
  const p = currentPattern(editor);
  Object.assign(p, {
    seed: 17, spacing: 0.25, extent: { mode: 'boundary' },
    shape: { source: 'generated', preset: 'hourglass', seed: 17, params: {}, segments: null },
  });
  regenerateSilhouette(editor, p);
  await generatePattern(editor, p);
  return { editor, p };
}

const pieces = (editor, kind) => editor._sketchLayer.children().toArray().filter((e) => e.attr('data-lattice') === kind);
const handPieces = (editor, kind) => pieces(editor, kind).filter((e) => !e.node.hasAttribute(OWNERSHIP_ATTR));
const num = (el, k) => parseFloat(el.attr(k));

/** One real gesture through the Shape Lattice canvas handler. */
async function gesture(editor, from, to = from) {
  const h = getModeHandler('shapeLattice');
  h.start(editor, from, from);
  if (to !== from) h.update(editor, to);
  if (editor._isDrawing) await h.finish(editor);
}

/** The generated rail with the shortest span = the one across the waist. */
function waistRail(editor) {
  return pieces(editor, 'rail').filter((e) => e.node.hasAttribute(OWNERSHIP_ATTR))
    .sort((a, b) => Math.abs(num(a, 'x2') - num(a, 'x1')) - Math.abs(num(b, 'x2') - num(b, 'x1')))[0];
}

beforeEach(() => { document.body.innerHTML = '<div id="editorStatusHint"></div>'; });

describe('T80 item 2: Rail / Tie / Node add tools in Shape Lattice', () => {
  it('a rail dragged across the whole board at the waist is clipped to the shape -- same ends as the generated rail on that row', async () => {
    const { editor } = await shapeLatticeEditor();
    const gen = waistRail(editor);
    const y = num(gen, 'y1');
    editor._lattice.drawKind = 'rail';
    await gesture(editor, { x: 0.25, y }, { x: 6.75, y });
    const drawn = handPieces(editor, 'rail');
    expect(drawn.length).toBe(1);
    const xs = (e) => [num(e, 'x1'), num(e, 'x2')].sort((a, b) => a - b);
    expect(xs(drawn[0])[0]).toBeCloseTo(xs(gen)[0], 6);
    expect(xs(drawn[0])[1]).toBeCloseTo(xs(gen)[1], 6);
    expect(xs(drawn[0])[1] - xs(drawn[0])[0]).toBeLessThan(6.5 - 1); // really clipped, not board-wide
  });

  it('a rail CLICK at the waist spawns the whole row inside the shape (same clip)', async () => {
    const { editor } = await shapeLatticeEditor();
    const gen = waistRail(editor);
    const y = num(gen, 'y1');
    const ends = [num(gen, 'x1'), num(gen, 'x2')].sort((a, b) => a - b);
    gen.remove(); // an empty row to click on (a click ON a rail grabs it instead)
    editor._lattice.drawKind = 'rail';
    await gesture(editor, { x: (ends[0] + ends[1]) / 2, y });
    const drawn = handPieces(editor, 'rail');
    expect(drawn.length).toBe(1);
    const xs = [num(drawn[0], 'x1'), num(drawn[0], 'x2')].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(ends[0], 6);
    expect(xs[1]).toBeCloseTo(ends[1], 6);
  });

  it('a rail drawn wholly outside the shape adds nothing', async () => {
    const { editor } = await shapeLatticeEditor();
    const top = Math.min(...pieces(editor, 'rail').map((e) => num(e, 'y1')));
    editor._lattice.drawKind = 'rail';
    const y = Math.max(0.25, top - 2);
    expect(y).toBeLessThan(top - 0.5);
    await gesture(editor, { x: 0.25, y: 0 }, { x: 6.75, y: 0 });
    expect(handPieces(editor, 'rail').length).toBe(0);
  });

  it('a tie drag adds a tie (snapped to rails, like the box Lattice tool)', async () => {
    const { editor } = await shapeLatticeEditor();
    for (const e of [...pieces(editor, 'tie'), ...pieces(editor, 'node')]) e.remove(); // clear space to start in
    const gen = waistRail(editor);
    const x = (num(gen, 'x1') + num(gen, 'x2')) / 2;
    const rows = [...new Set(pieces(editor, 'rail').map((e) => num(e, 'y1')))].sort((a, b) => a - b);
    const k = rows.indexOf(num(gen, 'y1'));
    editor._lattice.drawKind = 'tie';
    // starts between two rails (on a rail it would grab it); the END snaps to a rail, as in the box tool
    await gesture(editor, { x, y: (rows[k] + rows[k + 1]) / 2 }, { x, y: rows[k + 1] + 0.05 });
    const ties = handPieces(editor, 'tie');
    expect(ties.length).toBe(1);
    expect(num(ties[0], 'x1')).toBeCloseTo(num(ties[0], 'x2'), 9);
    expect(num(ties[0], 'y2')).toBeCloseTo(rows[k + 1], 9);
  });

  it('a node click adds a node', async () => {
    const { editor } = await shapeLatticeEditor();
    const gen = waistRail(editor);
    editor._lattice.drawKind = 'node';
    await gesture(editor, { x: (num(gen, 'x1') + num(gen, 'x2')) / 2, y: num(gen, 'y1') - 0.5 });
    expect(handPieces(editor, 'node').length).toBe(1);
  });

  it('Select still adds nothing on empty space', async () => {
    const { editor } = await shapeLatticeEditor();
    const before = editor._sketchLayer.children().length;
    editor._lattice.drawKind = 'select';
    await gesture(editor, { x: 0.1, y: 0.1 });
    expect(editor._sketchLayer.children().length).toBe(before);
  });

  it('Regenerate keeps hand-added pieces (the box Lattice rule: only owned pieces are replaced)', async () => {
    const { editor, p } = await shapeLatticeEditor();
    const gen = waistRail(editor);
    editor._lattice.drawKind = 'node';
    await gesture(editor, { x: (num(gen, 'x1') + num(gen, 'x2')) / 2, y: num(gen, 'y1') - 0.5 });
    const node = handPieces(editor, 'node')[0];
    await generatePattern(editor, p);
    expect(editor._sketchLayer.children().toArray()).toContain(node);
  });
});
