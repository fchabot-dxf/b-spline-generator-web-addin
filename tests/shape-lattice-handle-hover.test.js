/**
 * T81 item 1 (Fred screenshot: the Shape Lattice shoulder/hip/waist handles
 * give no hover feedback). Driven through the REAL Shape Lattice canvas
 * handler (getModeHandler, editor-interaction.js) and the REAL render
 * (renderShapeLatticeHandles / editor-interaction.js's own updateHandles),
 * on the same lightweight mock the generator/add-tools tests use, plus a
 * `_handleLayer` mock for the handle circles + segment overlay.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { generatePattern } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { regenerateSilhouette, currentPattern } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import { getModeHandler, updateHandles } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { HANDLE_HOVER_SCALE, HANDLE_HOVER_FILL, HANDLE_KINDS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-transform-handles.js';
import { setMode } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';

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

  // The handle layer: same store/attr shape as sketchLayer's own elements,
  // just a separate surface (matches editor._handleLayer's real, distinct role).
  let handleEls = [];
  function makeHandleEl(type, d) {
    const store = { d };
    const h = {
      type,
      attr(k, ...rest) {
        if (k && typeof k === 'object') { Object.assign(store, k); return h; }
        if (rest.length === 0) return store[k]; store[k] = rest[0]; return h;
      },
      fill(v) { store.fill = v; return h; },
      stroke(v) { if (v && typeof v === 'object') { store.stroke = v.color; store['stroke-width'] = v.width; store.opacity = v.opacity; } return h; },
      center(x, y) { store.cx = x; store.cy = y; return h; },
      store,
    };
    handleEls.push(h);
    return h;
  }
  const handleLayer = {
    circle(d) { return makeHandleEl('circle', d); },
    // F27 item 2: a position handle is a square (drawParamHandle): rect(2r, 2r).move(x - r, y - r);
    // its centre and "diameter" (the side) read back off it
    rect(w, h) {
      const el = makeHandleEl('rect', w);
      el.move = (x, y) => { el.store.cx = x + w / 2; el.store.cy = y + h / 2; return el; };
      return el;
    },
    path(d) { return makeHandleEl('path', d); },
    clear() { handleEls = []; },
    items: () => handleEls,
  };

  return {
    _mW: mW, _mH: mH, _sketchLayer: sketchLayer, _handleLayer: handleLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }], _activeLayer: '0', _nextLayerId: 1,
    _color: '#000', _strokeWidth: 0.02, _selectedElements: [], _paramHandles: [],
    _currentMode: 'shapeLattice',
    _lattice: { drawKind: 'select' },
    _select(el) { this._selectedElements = [el]; }, _selectAdd() {}, _deselect() { this._selectedElements = []; },
    _setHover() {}, _getMousePoint: (e) => ({ x: e.x, y: e.y }), _getNearbyElement: () => null,
    _updateSelectionHighlight() {},
    pushState() {}, _notifyChange() {},
    _updateHandles() { updateHandles(this); },
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
  editor._updateHandles();
  return editor;
}

// F27 item 2: a handle's mark is a square (position) or a circle (radius)
const handleCircle = (editor, key) => {
  const rec = editor._paramHandles.find((r) => r.key === key);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  return editor._handleLayer.items().find((e) => (e.type === 'circle' || e.type === 'rect')
    && near(e.store.cx, rec.hx) && near(e.store.cy, rec.hy));
};
const overlayPaths = (editor) => editor._handleLayer.items().filter((e) => e.type === 'path');
const cssState = () => Array.from(document.getElementById('editorSVGContainer').classList)
  .filter((c) => c.startsWith('handle-hover'));

const h = getModeHandler('shapeLattice');

beforeEach(() => { document.body.innerHTML = '<div id="editorSVGContainer"></div>'; });

describe("T81 item 1: hovering a Shape Lattice handle", () => {
  it('idle: base size/colour, no cursor class, no segment overlay', async () => {
    const editor = await shapeLatticeEditor();
    h.hover(editor, { x: -100, y: -100 }); // nowhere near any handle
    expect(editor._shapeHandleHover).toBeNull();
    const c = handleCircle(editor, 'waistReach');
    expect(c.store.fill).toBe('#ffffff');
    expect(c.store.stroke).toBe(HANDLE_KINDS.position.stroke); // a position square wears the app's own handle border (Fred)
    expect(cssState()).toEqual([]);
    expect(overlayPaths(editor).length).toBe(0);
  });

  it('hovering a handle grows it, fills it with the shared accent, sets the grab cursor, and highlights the segment it controls', async () => {
    const editor = await shapeLatticeEditor();
    const rec = editor._paramHandles.find((r) => r.key === 'waistReach');
    const idleRadius = handleCircle(editor, 'waistReach').store.d / 2;

    h.hover(editor, { x: rec.hx, y: rec.hy });

    expect(editor._shapeHandleHover).toBe('waistReach');
    const c = handleCircle(editor, 'waistReach');
    expect(c.store.d / 2).toBeCloseTo(idleRadius * HANDLE_HOVER_SCALE, 6);
    expect(c.store.fill).toBe(HANDLE_HOVER_FILL);
    expect(cssState()).toEqual(['handle-hover-ready']);

    // "the segment it controls" -- an overlay in the accent colour, matching
    // the LIVE waist segment's own drawn `d` (segment index 2). (F27 item 2:
    // these look tests use the Waist reach, a POSITION handle -- a white
    // square when idle; the Shoulder is a blue radius circle, see below.)
    // Fred: "How about highlighting the geometry it control" -- the param moves BOTH sides, so the
    // waist AND its mirror (hourglass: segment 2 and 8) light up.
    const seg = (i) => editor._sketchLayer.children().toArray().find((e) => e.attr('data-contour-seg') === i);
    expect(seg(2)).toBeTruthy();
    expect(seg(8)).toBeTruthy();
    const overlays = overlayPaths(editor);
    expect(overlays.map((o) => o.store.d).sort()).toEqual([seg(2).attr('d'), seg(8).attr('d')].sort());
    for (const o of overlays) expect(o.store.stroke).toBe(HANDLE_HOVER_FILL);
  });

  it('moving off the handle clears the hover look and the overlay', async () => {
    const editor = await shapeLatticeEditor();
    const rec = editor._paramHandles.find((r) => r.key === 'waistReach');
    h.hover(editor, { x: rec.hx, y: rec.hy });
    expect(editor._shapeHandleHover).toBe('waistReach');

    h.hover(editor, { x: -100, y: -100 });

    expect(editor._shapeHandleHover).toBeNull();
    expect(handleCircle(editor, 'waistReach').store.fill).toBe('#ffffff');
    expect(cssState()).toEqual([]);
    expect(overlayPaths(editor).length).toBe(0);
  });

  it('pressing a handle shows the SAME active look for the whole drag (Touch has no hover) and the grabbing cursor', async () => {
    const editor = await shapeLatticeEditor();
    const rec = editor._paramHandles.find((r) => r.key === 'waistReach');
    h.hover(editor, { x: rec.hx, y: rec.hy }); // the real flow: hover, then press

    h.start(editor, { x: rec.hx, y: rec.hy }, { x: rec.hx, y: rec.hy });
    expect(editor._shapeLatticeDragKey).toBe('waistReach');
    expect(cssState()).toEqual(['handle-hover-active']);
    let c = handleCircle(editor, 'waistReach');
    expect(c.store.fill).toBe(HANDLE_HOVER_FILL);

    h.update(editor, { x: rec.hx - 0.05, y: rec.hy }); // regenerateSilhouette's own end re-renders handles
    c = handleCircle(editor, 'waistReach');
    expect(c.store.fill).toBe(HANDLE_HOVER_FILL); // still active mid-drag

    await h.finish(editor);
    expect(editor._shapeLatticeDragKey).toBeNull();
    // hover state was never cleared during the drag -- back to plain hover, not idle.
    expect(cssState()).toEqual(['handle-hover-ready']);
  });

  it('a DIFFERENT handle (Hip) highlights the hip segment, not the shoulder', async () => {
    const editor = await shapeLatticeEditor();
    const rec = editor._paramHandles.find((r) => r.key === 'cornerRadiusBottom');
    h.hover(editor, { x: rec.hx, y: rec.hy });
    const hipSeg = editor._sketchLayer.children().toArray().find((e) => e.attr('data-contour-seg') === 3);
    expect(overlayPaths(editor).map((o) => o.store.d)).toContain(hipSeg.attr('d'));
  });

  it('switching mode away from Shape Lattice clears the hover and the cursor (same rule as the snap/grid hover)', async () => {
    const editor = await shapeLatticeEditor();
    const rec = editor._paramHandles.find((r) => r.key === 'waistReach');
    h.hover(editor, { x: rec.hx, y: rec.hy });
    expect(editor._shapeHandleHover).toBe('waistReach');
    expect(cssState()).toEqual(['handle-hover-ready']);

    setMode(editor, 'select');

    expect(editor._shapeHandleHover).toBeNull();
    expect(cssState()).toEqual([]);
  });
});

describe('F27 item 2: Shape Lattice handles are drawn by their declared KIND', () => {
  it('radius handles (Shoulder, Hip, Waist radius) are accent circles; position handles (Waist reach, Waist position) the app\'s white/blue squares', async () => {
    const editor = await shapeLatticeEditor();
    const kinds = Object.fromEntries(editor._paramHandles.map((r) => [r.key, r.handleKind]));
    expect(kinds).toEqual({ waistReach: 'position', cornerRadiusTop: 'radius', cornerRadiusBottom: 'radius',
      waistCenterY: 'position', waistRadius: 'radius' });
    expect(HANDLE_KINDS.radius.shape).toBe('circle');
    expect(HANDLE_KINDS.position.shape).toBe('square');
    for (const r of editor._paramHandles) {
      const mark = handleCircle(editor, r.key);
      expect(mark, r.key).toBeTruthy();
      expect(mark.type).toBe(r.handleKind === 'radius' ? 'circle' : 'rect');
      expect(mark.store.fill).toBe(HANDLE_KINDS[r.handleKind].fill);
      expect(mark.store['data-kind']).toBe(r.handleKind);
    }
    // Fred's ruling: the radius accent IS the editor's existing blue accent (the hover fill), not a new colour
    expect(HANDLE_KINDS.radius.fill).toBe(HANDLE_HOVER_FILL);
    expect(HANDLE_KINDS.position.fill).toBe('#ffffff');
  });

  it('hovering a radius circle keeps its shape and grows it (T81 item 1 look on top of the kind)', async () => {
    const editor = await shapeLatticeEditor();
    const rec = editor._paramHandles.find((r) => r.key === 'cornerRadiusTop');
    const idle = handleCircle(editor, 'cornerRadiusTop');
    expect(idle.type).toBe('circle');
    const idleD = idle.store.d;
    h.hover(editor, { x: rec.hx, y: rec.hy });
    const c = handleCircle(editor, 'cornerRadiusTop');
    expect(c.type).toBe('circle');
    expect(c.store.d).toBeCloseTo(idleD * HANDLE_HOVER_SCALE, 6);
    expect(c.store.stroke).toBe('#ffffff');
  });
});

describe('F27 item 2 arc pull (Fred: "more intuitive to pull the arc than the arc center"): Shape Lattice arcs', () => {
  const at = (a, t, d = 0) => { const th = a.theta1 + a.dTheta * t; return { x: a.cx + (a.rx + d) * Math.cos(th), y: a.cy + (a.rx + d) * Math.sin(th) }; };
  const rec = (editor, key) => editor._paramHandles.find((r) => r.key === key);
  const segEl = (editor, i) => editor._sketchLayer.children().toArray().find((e) => e.attr('data-contour-seg') === i);
  const bar = () => document.querySelector('.shape-lattice-segment-bar');

  it('hovering an arc away from its dot (the mirrored LEFT shoulder) highlights both sides; the cursor stays the normal pointer', async () => {
    const editor = await shapeLatticeEditor();
    const top = rec(editor, 'cornerRadiusTop');
    h.hover(editor, at(top.arcs[1], 0.3, 0.02));
    expect(editor._shapeHandleHover).toBe('cornerRadiusTop');
    expect(overlayPaths(editor).map((o) => o.store.d).sort()).toEqual([segEl(editor, 1).attr('d'), segEl(editor, 9).attr('d')].sort());
    expect(Array.from(document.getElementById('editorSVGContainer').classList).sort()).toEqual(['handle-axis-plain', 'handle-hover-ready']);
  });

  it('a TAP on an arc is today\'s segment tap exactly: the segment is selected, the style bar opens, nothing reshaped, no undo step', async () => {
    const editor = await shapeLatticeEditor();
    let pushes = 0;
    editor.pushState = () => { pushes++; };
    const p = currentPattern(editor);
    const params0 = JSON.stringify(p.shape.params);
    const q = at(rec(editor, 'cornerRadiusTop').arcs[1], 0.5);
    h.start(editor, q, { x: q.x, y: q.y });
    expect(editor._selectedElements).toEqual([segEl(editor, 9)]);
    expect(bar()).toBeTruthy();
    expect(overlayPaths(editor).length).toBe(2); // pressed: lit (Touch has no hover)
    h.update(editor, { x: q.x + 0.02, y: q.y }); // a wobble inside the click threshold
    await h.finish(editor);
    expect(JSON.stringify(p.shape.params)).toBe(params0);
    expect(pushes).toBe(0);
    expect(bar()).toBeTruthy(); // still open, as a tap leaves it
    expect(editor._shapeArcPress).toBeNull();
    expect(editor._isDrawing).toBe(false);
  });

  it('a DRAG past the click threshold on the mirrored LEFT arc reshapes it under the pointer: one param, one undo step, the style bar gone', async () => {
    const editor = await shapeLatticeEditor();
    let pushes = 0;
    editor.pushState = () => { pushes++; };
    const p = currentPattern(editor);
    const top = rec(editor, 'cornerRadiusTop');
    const from = at(top.arcs[1], 0.5), to = at(top.arcs[1], 0.5, -0.25);
    h.start(editor, from, { x: from.x, y: from.y });
    h.update(editor, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    h.update(editor, to);
    expect(bar()).toBeNull();
    expect(editor._shapeLatticeDragKey).toBe('cornerRadiusTop');
    expect(Object.keys(p.shape.params)).toEqual(['cornerRadiusTop']);
    const a1 = rec(editor, 'cornerRadiusTop').arcs[1];
    expect(Math.hypot(to.x - a1.cx, to.y - a1.cy)).toBeCloseTo(a1.rx, 6); // the drawn left arc passes under the pointer
    expect(rec(editor, 'cornerRadiusTop').arcs[0].rx).toBeCloseTo(a1.rx, 9); // the right one mirrors it
    expect(overlayPaths(editor).length).toBe(2); // lit for the whole drag
    await h.finish(editor);
    expect(pushes).toBe(1);
    expect(editor._shapeLatticeDragKey).toBeNull();
  });

  it('the waist is a CAD circle: dragging its dot moves the pinch about a FIXED centre (both params written); the square sits at that centre', async () => {
    const editor = await shapeLatticeEditor();
    const p = currentPattern(editor);
    const w = rec(editor, 'waistRadius'), sq = rec(editor, 'waistReach');
    const c0 = { x: w.arcs[0].cx, y: w.arcs[0].cy };
    expect(sq.hx).toBeCloseTo(Math.min(c0.x, editor._mW), 9);
    expect(sq.hy).toBeCloseTo(c0.y, 9);
    expect(w.hx).toBeCloseTo(c0.x - w.arcs[0].rx, 9); // the dot on the pinch
    h.start(editor, { x: w.hx, y: w.hy }, { x: w.hx, y: w.hy });
    // Fred: "I still can't select contour segment" -- a press on the dot is armed like a press on its
    // arc (a tap selects the waist segment), and only a move past the click threshold pulls the radius.
    expect(editor._shapeArcPress && editor._shapeArcPress.key).toBe('waistRadius');
    expect((editor._selectedElements || []).map((el) => el.attr('data-contour-seg'))).toEqual([w.segment]);
    h.update(editor, { x: w.hx - 0.2, y: w.hy });
    expect(editor._shapeLatticeDragKey).toBe('waistRadius');
    expect(Object.keys(p.shape.params).sort()).toEqual(['waistRadius', 'waistReach']);
    const a1 = rec(editor, 'waistRadius').arcs[0];
    expect(a1.cx).toBeCloseTo(c0.x, 9);
    expect(a1.cy).toBeCloseTo(c0.y, 9);
    expect(a1.rx).toBeCloseTo(w.arcs[0].rx + 0.2, 9);
    await h.finish(editor);
  });

  it('the waistReach square slides the waist with its radius held, even where the pattern left the radius to its default', async () => {
    const editor = await shapeLatticeEditor();
    const p = currentPattern(editor);
    expect(p.shape.params.waistRadius).toBeUndefined(); // non-vacuous: the derived default
    const sq = rec(editor, 'waistReach'), r0 = rec(editor, 'waistRadius').arcs[0].rx;
    h.start(editor, { x: sq.hx, y: sq.hy }, { x: sq.hx, y: sq.hy });
    h.update(editor, { x: sq.hx - 0.1, y: sq.hy });
    const a1 = rec(editor, 'waistRadius').arcs[0];
    expect(a1.rx).toBeCloseTo(r0, 9);
    expect(a1.cx).toBeCloseTo(sq.hx - 0.1, 9);
    await h.finish(editor);
  });

  it('a position square in reach wins over an arc (bottle: the Shoulder height square sits where the neck arc starts)', async () => {
    const editor = makeMockEditor(7, 9);
    const p = currentPattern(editor);
    Object.assign(p, { seed: 17, spacing: 0.25, extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'bottle', seed: 17, params: {}, segments: null } });
    regenerateSilhouette(editor, p);
    await generatePattern(editor, p);
    editor._updateHandles();
    const sq = rec(editor, 'neckLength');
    const start = at(rec(editor, 'skeletonX').arcs[0], 0);
    expect(Math.hypot(start.x - sq.hx, start.y - sq.hy)).toBeLessThan(sq.hitR); // non-vacuous: both in reach
    h.hover(editor, { x: sq.hx, y: sq.hy });
    expect(editor._shapeHandleHover).toBe('neckLength');
    h.start(editor, { x: sq.hx, y: sq.hy }, { x: sq.hx, y: sq.hy });
    expect(editor._shapeLatticeDragKey).toBe('neckLength');
    await h.finish(editor);
  });

  it('a straight segment is not a grip: hovering a horn lights nothing', async () => {
    const editor = await shapeLatticeEditor();
    const p = currentPattern(editor);
    const params0 = JSON.stringify(p.shape.params);
    const top = rec(editor, 'cornerRadiusTop').arcs[0];
    const horn = { x: at(top, 0).x, y: at(top, 0).y - 0.4 }; // up the right horn, clear of the shoulder arc
    h.hover(editor, horn);
    expect(editor._shapeHandleHover).toBeNull();
    expect(overlayPaths(editor).length).toBe(0);
    expect(JSON.stringify(p.shape.params)).toBe(params0);
  });
});
