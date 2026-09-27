/**
 * T81 item 7 (Fred: "I'd like to be able to adjust length of rails in
 * lattice tool, by grabbing the ends"). The stretch is SE7k's existing
 * end-stretch (editor-interaction.js), reached from the lattice [Select]
 * icon tool; editor-rail-end-stretch.js adds the end handle on hover, the
 * lattice-boundary limit, the stroke-width minimum (Fred's ruling: "The
 * only distance it should use is the stroke width."), the GEOM boundary
 * snap, and removal of ties/nodes left past the new end -- all in one undo
 * step.
 *
 * Driven through the REAL canvas handlers (getModeHandler) for both tools,
 * rect Lattice ('lattice') and Shape Lattice ('shapeLattice'), on the same
 * lightweight mock the other lattice interaction tests use.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getModeHandler, updateHandles } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { LATTICE_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';
import { generatePattern, OWNERSHIP_ATTR, PATTERN_DEFAULTS, _resolveExtent } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { regenerateSilhouette, currentPattern } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import { HANDLE_HOVER_FILL, HANDLE_HOVER_SCALE } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-transform-handles.js';
import { railEndTarget } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-rail-end-stretch.js';

function makeMockEditor(mW = 4, mH = 4) {
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
  // The handle layer: records what updateHandles draws (circles/paths), wiped by clear().
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
    // F27 item 2: radius handles are diamonds (a polygon), centred on the mean of its 4 points
    polygon(pts) { return mkHandle('polygon', { points: pts, cx: pts.reduce((a, p) => a + p[0], 0) / pts.length, cy: pts.reduce((a, p) => a + p[1], 0) / pts.length }); },
    rect() { return mkHandle('rect', {}); },
    all: () => handles,
  };
  let pushes = 0;
  const editor = {
    _mW: mW, _mH: mH, _sketchLayer: sketchLayer, _handleLayer: handleLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }], _activeLayer: '0', _nextLayerId: 1,
    _grid: { spacing: 0.25, visible: true },
    _lattice: { ...LATTICE_DEFAULTS, drawKind: 'select' },
    _currentMode: 'lattice',
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
const endHandles = (editor) => editor._handleLayer.all().filter((h) => h.store['data-rail-end-handle']);

function addLine(editor, kind, x1, y1, x2, y2, extra = {}) {
  const el = editor._sketchLayer.line(x1, y1, x2, y2);
  el.attr({ 'data-lattice': kind, 'data-layer': '0', 'stroke-width': 0.05, ...extra });
  return el;
}
function addNode(editor, x, y) {
  const el = editor._sketchLayer.circle(0.1);
  el.attr({ 'data-lattice': 'node', 'data-layer': '0' });
  el.center(x, y);
  return el;
}

/** One real press / move / release through the given tool's handler. */
async function gesture(editor, mode, from, to = from) {
  const h = getModeHandler(mode);
  h.start(editor, from, from);
  if (to !== from) h.update(editor, to);
  if (editor._isDrawing) await h.finish(editor);
}

/**
 * rect Lattice fixture: two rails (rows y=1 and y=2, x 0.5..3), a tie at
 * x=2.5 and one at x=1 joining them, a node at every tie end.
 */
function rectFixture() {
  const editor = makeMockEditor();
  const rail = addLine(editor, 'rail', 0.5, 1, 3, 1);
  const rail2 = addLine(editor, 'rail', 0.5, 2, 3, 2);
  const farTie = addLine(editor, 'tie', 2.5, 1, 2.5, 2);
  const nearTie = addLine(editor, 'tie', 1, 1, 1, 2);
  const nodes = {
    farOnRail: addNode(editor, 2.5, 1), farOnRail2: addNode(editor, 2.5, 2),
    nearOnRail: addNode(editor, 1, 1), nearOnRail2: addNode(editor, 1, 2),
  };
  return { editor, rail, rail2, farTie, nearTie, nodes };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="editorStatusHint"></div><div id="editorSVGContainer"></div>';
});

describe('T81 item 7 (rect Lattice, [Select]): hovering a rail END shows the shared end handle', () => {
  it('on the end: one handle at the end, in the T81 item 1 hover look, grab cursor', () => {
    const { editor, rail } = rectFixture();
    getModeHandler('lattice').hover(editor, { x: 3, y: 1 });
    expect(editor._railEndHover).toEqual({ el: rail, end: 'b' });
    const hs = endHandles(editor);
    expect(hs.length).toBe(1);
    expect(hs[0].store.cx).toBeCloseTo(3, 9);
    expect(hs[0].store.cy).toBeCloseTo(1, 9);
    expect(hs[0].store.fill).toBe(HANDLE_HOVER_FILL);
    expect(document.getElementById('editorSVGContainer').classList.contains('handle-hover-ready')).toBe(true);
  });

  it('on the body (mid-rail): no end handle, no grab cursor', () => {
    const { editor } = rectFixture();
    getModeHandler('lattice').hover(editor, { x: 1.75, y: 1 });
    expect(editor._railEndHover).toBeFalsy();
    expect(endHandles(editor).length).toBe(0);
    expect(document.getElementById('editorSVGContainer').classList.contains('handle-hover-ready')).toBe(false);
  });

  it('leaving the end removes the handle again', () => {
    const { editor } = rectFixture();
    const h = getModeHandler('lattice');
    h.hover(editor, { x: 3, y: 1 });
    h.hover(editor, { x: 1.75, y: 3.5 });
    expect(endHandles(editor).length).toBe(0);
  });

  it('while the end is dragged the handle is held (grabbing cursor) and rides the end; release drops it', async () => {
    const { editor, rail } = rectFixture();
    const h = getModeHandler('lattice');
    h.start(editor, { x: 3, y: 1 }, { x: 3, y: 1 });
    expect(document.getElementById('editorSVGContainer').classList.contains('handle-hover-active')).toBe(true);
    h.update(editor, { x: 3.5, y: 1.1 });
    expect(endHandles(editor)[0].store.cx).toBeCloseTo(num(rail, 'x2'), 9);
    expect(endHandles(editor)[0].store.cx).toBeCloseTo(3.5, 9);
    await h.finish(editor);
    expect(editor._railEndDrag).toBe(null);
    expect(document.getElementById('editorSVGContainer').classList.contains('handle-hover-active')).toBe(false);
  });

  it('the other end works the same way, and the handle is drawn grown (HANDLE_HOVER_SCALE x the 0.05in floor here)', () => {
    const { editor, rail } = rectFixture();
    getModeHandler('lattice').hover(editor, { x: 0.5, y: 1 });
    expect(editor._railEndHover).toEqual({ el: rail, end: 'a' });
    expect(endHandles(editor)[0].store['data-rail-end-handle']).toBe('a');
    expect(endHandles(editor)[0].store.r).toBeGreaterThanOrEqual(0.05 * HANDLE_HOVER_SCALE - 1e-9);
  });
});

describe('T81 item 7 (rect Lattice, [Select]): dragging a rail end changes its length', () => {
  it('lengthens along its own axis only; the other end stays put; one undo step', async () => {
    const { editor, rail } = rectFixture();
    await gesture(editor, 'lattice', { x: 3, y: 1 }, { x: 3.5, y: 1.3 }); // off-axis wobble is ignored
    expect(num(rail, 'x1')).toBeCloseTo(0.5, 9);
    expect(num(rail, 'y1')).toBeCloseTo(1, 9);
    expect(num(rail, 'x2')).toBeCloseTo(3.5, 9);
    expect(num(rail, 'y2')).toBeCloseTo(1, 9);
    expect(editor.pushes).toBe(1);
  });

  it('shortening past a tie REMOVES that tie and its node left behind; ties still on the rail keep their joints; says so', async () => {
    const { editor, rail, farTie, nearTie, nodes } = rectFixture();
    await gesture(editor, 'lattice', { x: 3, y: 1 }, { x: 2, y: 1 });
    expect(num(rail, 'x2')).toBeCloseTo(2, 9);
    const ties = pieces(editor, 'tie');
    expect(ties).not.toContain(farTie);
    expect(ties).toContain(nearTie);
    expect(num(nearTie, 'y1')).toBeCloseTo(1, 9); // joint untouched
    const ns = pieces(editor, 'node');
    expect(ns).not.toContain(nodes.farOnRail);   // the removed tie's joint with THIS rail -> removed
    expect(ns).not.toContain(nodes.farOnRail2);  // its joint with rail 2: on rail 2's body only, joins nothing now -> removed
    expect(ns).toContain(nodes.nearOnRail);      // the kept tie's joints stay
    expect(ns).toContain(nodes.nearOnRail2);
    expect(document.getElementById('editorStatusHint').textContent).toMatch(/removed 1 tie and 2 nodes/);
    expect(editor.pushes).toBe(1); // stretch + removal = ONE undo step
  });

  it('a removed tie\'s node that is still a joint of something else (another tie crossing there) is kept', async () => {
    const { editor, farTie, nodes } = rectFixture();
    const crossing = addLine(editor, 'tie', 2.5, 1.5, 2.5, 3); // another tie whose END is that node on rail 2
    await gesture(editor, 'lattice', { x: 3, y: 1 }, { x: 2, y: 1 });
    expect(pieces(editor, 'tie')).not.toContain(farTie);
    expect(pieces(editor, 'tie')).toContain(crossing);
    expect(pieces(editor, 'node')).toContain(nodes.farOnRail2);
  });

  it('lengthening back does not resurrect anything and removes nothing', async () => {
    const { editor, farTie } = rectFixture();
    await gesture(editor, 'lattice', { x: 3, y: 1 }, { x: 3.75, y: 1 });
    expect(pieces(editor, 'tie')).toContain(farTie);
    expect(pieces(editor, 'node').length).toBe(4);
  });

  it('cannot go past the lattice boundary (the board extent Generate uses)', async () => {
    const { editor, rail } = rectFixture();
    const ext = _resolveExtent(editor, PATTERN_DEFAULTS);
    const maxX = ext.iMax * 0.25;
    expect(maxX).toBeLessThan(10);
    await gesture(editor, 'lattice', { x: 3, y: 1 }, { x: 10, y: 1 });
    expect(num(rail, 'x2')).toBeCloseTo(maxX, 9);
    await gesture(editor, 'lattice', { x: 0.5, y: 1 }, { x: -6, y: 1 });
    expect(num(rail, 'x1')).toBeCloseTo(ext.iMin * 0.25, 9);
  });

  it("shortest length is the rail's own STROKE WIDTH, not one lattice cell (Fred's ruling)", async () => {
    const { editor, rail } = rectFixture();
    rail.attr('stroke-width', 0.1);
    for (const t of pieces(editor, 'tie')) t.remove();
    await gesture(editor, 'lattice', { x: 3, y: 1 }, { x: 0.25, y: 1 }); // tries to pass the fixed end at 0.5
    expect(num(rail, 'x1')).toBeCloseTo(0.5, 9);
    expect(num(rail, 'x2') - num(rail, 'x1')).toBeCloseTo(0.1, 9); // < one cell (0.25)
  });

  it('a bare click on the end changes nothing and pushes no undo step', async () => {
    const { editor, rail } = rectFixture();
    await gesture(editor, 'lattice', { x: 3, y: 1 });
    expect(num(rail, 'x2')).toBeCloseTo(3, 9);
    expect(editor.pushes).toBe(0);
    expect(editor._railEndDrag).toBe(null);
  });

  it('a generated rail keeps its ownership mark (SE7i: Regenerate re-sweeps hand-moved owned pieces)', async () => {
    const { editor, rail } = rectFixture();
    rail.attr(OWNERSHIP_ATTR, 'p1');
    await gesture(editor, 'lattice', { x: 3, y: 1 }, { x: 2, y: 1 });
    expect(rail.attr(OWNERSHIP_ATTR)).toBe('p1');
  });
});

describe('T81 item 7: GEOM snap onto the boundary crossing (railEndTarget)', () => {
  const move = () => ({ railEnd: { span: [2.3, 17.6] } });
  it('clamps into the span either way', () => {
    expect(railEndTarget(move(), 30, 0.4, false)).toBe(17.6);
    expect(railEndTarget(move(), -3, 0.4, false)).toBe(2.3);
    expect(railEndTarget(move(), 9, 0.4, false)).toBe(9);
  });
  it('GEOM on: a target within tolerance of the boundary lands exactly on it; GEOM off: it does not', () => {
    expect(railEndTarget(move(), 17, 0.4, true)).toBe(17);
    expect(railEndTarget(move(), 17.3, 0.4, true)).toBe(17.6);
    expect(railEndTarget(move(), 17.3, 0.4, false)).toBe(17.3);
    expect(railEndTarget(move(), 2.5, 0.4, true)).toBe(2.3);
  });
  it('no span (nothing resolvable) = no limit', () => {
    expect(railEndTarget({ railEnd: { span: null } }, 99, 0.4, true)).toBe(99);
  });
});

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

/** The generated rail with the most tie ENDS sitting on it, and its right end. */
function busiestRail(editor) {
  const ties = pieces(editor, 'tie');
  const onRow = (rail) => ties.filter((t) => [num(t, 'y1'), num(t, 'y2')].some((y) => Math.abs(y - num(rail, 'y1')) < 1e-6)
    && num(t, 'x1') >= Math.min(num(rail, 'x1'), num(rail, 'x2')) - 1e-6 && num(t, 'x1') <= Math.max(num(rail, 'x1'), num(rail, 'x2')) + 1e-6);
  const rails = pieces(editor, 'rail').filter((r) => r.node.hasAttribute(OWNERSHIP_ATTR));
  rails.sort((a, b) => onRow(b).length - onRow(a).length);
  const rail = rails[0];
  const rightEnd = num(rail, 'x2') > num(rail, 'x1') ? 'b' : 'a';
  return { rail, rightEnd, tiesOn: onRow(rail) };
}
const xOf = (rail, end) => num(rail, end === 'a' ? 'x1' : 'x2');

describe('T81 item 7 (Shape Lattice, [Select]): rail end drag', () => {
  it('hovering a rail end shows the end handle (param handles still win where they are)', async () => {
    const { editor } = await shapeLatticeEditor();
    const { rail, rightEnd } = busiestRail(editor);
    getModeHandler('shapeLattice').hover(editor, { x: xOf(rail, rightEnd), y: num(rail, 'y1') });
    expect(editor._railEndHover && editor._railEndHover.el).toBe(rail);
    expect(endHandles(editor).length).toBe(1);
  });

  it('cannot be dragged past the silhouette: clipped exactly where a drawn rail on that row stops', async () => {
    const { editor } = await shapeLatticeEditor();
    const { rail, rightEnd } = busiestRail(editor);
    const edge = xOf(rail, rightEnd); // the generated end = the row's clip (T80 item 2's same clip)
    const y = num(rail, 'y1');
    await gesture(editor, 'shapeLattice', { x: edge, y }, { x: 6.9, y });
    expect(xOf(rail, rightEnd)).toBeCloseTo(edge, 6);
    expect(num(rail, 'y1')).toBeCloseTo(y, 9);
  });

  it('contour HIDDEN (no T73 contour clamp): still stops at the silhouette, via the same clip drawn rails get', async () => {
    const { editor, p } = await shapeLatticeEditor();
    p.contour = { ...(p.contour || {}), show: false };
    await generatePattern(editor, p);
    const { rail, rightEnd } = busiestRail(editor);
    const edge = xOf(rail, rightEnd);
    const y = num(rail, 'y1');
    await gesture(editor, 'shapeLattice', { x: edge, y }, { x: 6.9, y });
    expect(xOf(rail, rightEnd)).toBeLessThanOrEqual(edge + 1e-6);
    expect(xOf(rail, rightEnd)).toBeLessThan(6.5);
  });

  it('shortening removes the ties left past the new end (and only those), one undo step', async () => {
    const { editor } = await shapeLatticeEditor();
    const { rail, rightEnd, tiesOn } = busiestRail(editor);
    expect(tiesOn.length).toBeGreaterThan(0);
    const fixedX = xOf(rail, rightEnd === 'a' ? 'b' : 'a');
    const edge = xOf(rail, rightEnd);
    const newEnd = Math.round(((fixedX + edge) / 2) / 0.25) * 0.25;
    const past = tiesOn.filter((t) => num(t, 'x1') > newEnd + 1e-6);
    const kept = tiesOn.filter((t) => num(t, 'x1') <= newEnd + 1e-6);
    expect(past.length).toBeGreaterThan(0);
    const before = editor.pushes;
    const y = num(rail, 'y1');
    await gesture(editor, 'shapeLattice', { x: edge, y }, { x: newEnd, y });
    expect(xOf(rail, rightEnd)).toBeCloseTo(newEnd, 9);
    const ties = pieces(editor, 'tie');
    for (const t of past) expect(ties).not.toContain(t);
    for (const t of kept) expect(ties).toContain(t);
    expect(editor.pushes - before).toBe(1);
    expect(document.getElementById('editorStatusHint').textContent).toMatch(/Rail shortened: removed \d+ tie/);
  });
});
