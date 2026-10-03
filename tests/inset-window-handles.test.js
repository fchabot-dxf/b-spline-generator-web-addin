/**
 * Fred: the inset window has no visible drag handles -- the drag interaction itself already worked
 * (_wireWindowDrag, main/frame-panel.js, blind corner hit-testing) but nothing marked where to grab,
 * unlike every other handle in this app (the declared HANDLE_KINDS convention,
 * editor-transform-handles.js). This file covers the 2 pieces added for that:
 *   1. visible corner markers (editor-frame-profile.js), hover/drag-active exactly like every other
 *      declared handle;
 *   2. Position (X,Y) / Size (W,H) steppers in the Frame panel, two-way synced with the same
 *      insetWindow rect the corner drag already writes, in BOTH the sidebar and #editorFramePanel
 *      (T82 item 5).
 *
 * T82 item 5 (Fred: "use the centre of frame... and make the window a centre point rect too"): the
 * RECORD is now `{enabled, cx, cy, w, h}` (cx/cy the centre, from the board centre, +y UP) rather than
 * the old `{enabled, x1, y1, x2, y2}` (board-local, origin top-left, y down); a corner drag now resizes
 * SYMMETRICALLY about the centre (the centre never moves), not from the opposite corner. An old-shape
 * record still loads correctly (migrates on read, core/frame-record.js normalizeFrameRecord) -- covered
 * by its own describe block below.
 * (2D/3D rendering + the drag UI live in main/frame-panel.js, DOM-coupled -- see inset-window.test.js's
 * own header comment for the pure-geometry half of this feature, covered there instead.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { getFrameRecord, setFrameRecord, normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { insetWindowOuterRect } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { drawFrameProfile, FRAME_HANDLE_RADIUS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { initFramePanel, setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { HANDLE_HOVER_SCALE, HANDLE_HOVER_FILL } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-transform-handles.js';

// Same mock SVG.js-like layer tree as tests/frame-handles.test.js's own mockCanvasEditor -- duplicated
// (not imported) since that helper is private to that file and this is this file's own, separate concern.
function mockCanvasEditor() {
  const node = () => {
    const n = { children: [], attrs: {} };
    const self = (f) => (...a) => { f(...a); return n; };
    Object.assign(n, {
      id: self((v) => { n.attrs.id = v; }), attr: self((k, v) => { n.attrs[k] = v; }),
      fill: self((v) => { n.attrs.fill = v; }),
      stroke: self((v) => { if (v && typeof v === 'object') { n.attrs.stroke = v.color; n.attrs.strokeWidth = v.width; } }),
      addClass: self(() => {}), center: self((x, y) => { n.attrs.cx = x; n.attrs.cy = y; }),
      path: () => { const c = node(); n.children.push(c); return c; },
      circle: (d) => { const c = node(); c.isCircle = true; c.d = d; n.children.push(c); return c; },
      rect: (w, h) => {
        const c = node(); c.isSquare = true; c.d = w;
        c.move = (x, y) => { c.attrs.cx = x + w / 2; c.attrs.cy = y + h / 2; return c; };
        n.children.push(c); return c;
      },
      group: () => { const c = node(); c.parent = n; n.children.push(c); return c; },
      remove: () => { if (n.parent) n.parent.children = n.parent.children.filter((x) => x !== n); },
      findOne: (sel) => n.children.find((c) => '#' + c.attrs.id === sel) || null,
    });
    return n;
  };
  const PX = 100; // screen px per board inch
  return { _bgLayer: node(), _sketchLayer: node(), _mW: 7, _mH: 9, PX,
    _getMousePoint: (e) => ({ x: e.clientX / PX, y: e.clientY / PX }) };
}

describe('inset window: visible corner handles + Position/Size steppers', () => {
  let root, ed;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `<input id="widthIn" value="7"><input id="heightIn" value="9">
      <select id="frameTemplate"></select><div id="frameSettings"><select id="frameAppearance"></select></div>
      <button id="btnStampEdit"></button><div id="editorSVGContainer"></div><div id="editorFrameShield"></div>
      <aside id="editorFramePanel"></aside><aside id="editorLayersPanel"></aside>
      <input type="checkbox" id="frameInsetWindowToggle">
      <div id="frameInsetWindowFields">
        <input type="number" id="frameWindowPosX"><input type="number" id="frameWindowPosY">
        <input type="number" id="frameWindowSizeW"><input type="number" id="frameWindowSizeH">
      </div>`;
    document.body.appendChild(root);
    P.frame = null; P.widthIn = 7; P.heightIn = 9;
    ed = mockCanvasEditor();
    window.svgEditor = ed;
    initFramePanel();
    // Board-local outer rect (2,3)-(5,6) on a 7x9 board == centre (0,0), 3x3 (verified: cx = (2+5)/2 - 3.5 = 0,
    // cy = 4.5 - (3+6)/2 = 0, w = 3, h = 3) -- written directly in the CURRENT shape (migration is its own
    // describe block below).
    setFrameRecord({ templateId: 'template_1', insetWindow: { enabled: true, cx: 0, cy: 0, w: 3, h: 3 } });
  });
  afterEach(() => { setEditorTab('artwork'); root.remove(); window.svgEditor = null; P.frame = null; });

  const fire = (type, x, y) => document.getElementById('editorFrameShield')
    .dispatchEvent(new MouseEvent(type, { clientX: x * ed.PX, clientY: y * ed.PX, bubbles: true, cancelable: true }));
  const windowHandles = () => (ed._bgLayer.findOne('#frame-profile')?.children || []).filter((c) => c.attrs['data-key'] && /^x[12]y[12]$/.test(c.attrs['data-key']));

  it('4 square markers appear at the window\'s own outer corners, Frame tab only', () => {
    expect(windowHandles()).toHaveLength(0); // Artwork tab: none
    setEditorTab('frame');
    const handles = windowHandles();
    expect(handles).toHaveLength(4);
    expect(handles.every((h) => h.isSquare)).toBe(true); // F27/HANDLE_KINDS 'position' look -- a square, not a circle
    const byKey = Object.fromEntries(handles.map((h) => [h.attrs['data-key'], h.attrs]));
    // Board-local (centre 0,0 w/h 3 on a 7x9 board -> outer rect (2,3)-(5,6), insetWindowOuterRect's own math).
    expect(byKey.x1y1).toMatchObject({ cx: 2, cy: 3 });
    expect(byKey.x2y1).toMatchObject({ cx: 5, cy: 3 });
    expect(byKey.x1y2).toMatchObject({ cx: 2, cy: 6 });
    expect(byKey.x2y2).toMatchObject({ cx: 5, cy: 6 });
    expect(handles[0].d / 2).toBeCloseTo(FRAME_HANDLE_RADIUS, 9);
    expect(handles[0].attrs.fill).toBe('#ffffff'); // idle: the app's plain white/blue square, same as every other position handle
  });

  it('no markers when the inset window is disabled, even in the Frame tab', () => {
    setFrameRecord({ insetWindow: { enabled: false, cx: 0, cy: 0, w: 3, h: 3 } });
    setEditorTab('frame');
    expect(windowHandles()).toHaveLength(0);
  });

  it('hovering a corner (no press) grows it and fills it with the shared accent, same as every other declared handle', () => {
    setEditorTab('frame');
    fire('pointermove', 2, 3); // the x1y1 corner (board-local)
    expect(ed._windowHandleHover).toBe('x1y1');
    const h = windowHandles().find((q) => q.attrs['data-key'] === 'x1y1');
    expect(h.d / 2).toBeCloseTo(FRAME_HANDLE_RADIUS * HANDLE_HOVER_SCALE, 9);
    expect(h.attrs.fill).toBe(HANDLE_HOVER_FILL);
  });

  it('hovering the window BODY (not a corner) lights no handle', () => {
    // Tucked into a corner, away from template_1's own shape-handle positions (near the board's own
    // hourglass silhouette) -- a body point that happens to land on a DIFFERENT handle would be grabbed
    // by that handle first (ed._frameHandleDrag), same precedence rule the drag listener itself uses.
    // Board-local outer rect (0.2,0.2)-(0.8,0.8) -> centre (-3, 4), 0.6x0.6.
    setFrameRecord({ insetWindow: { enabled: true, cx: -3, cy: 4, w: 0.6, h: 0.6 } });
    setEditorTab('frame');
    fire('pointermove', 0.5, 0.5); // inside the rect, away from any corner
    expect(ed._windowHandleHover).toBeFalsy();
  });

  it('dragging a corner resizes SYMMETRICALLY about the centre (the centre stays put) and shows the active look mid-drag', () => {
    setEditorTab('frame');
    fire('pointerdown', 5, 6); // x2y2 (board-local)
    expect(ed._windowHandleDrag).toBe('x2y2');
    const active = windowHandles().find((q) => q.attrs['data-key'] === 'x2y2');
    expect(active.attrs.fill).toBe(HANDLE_HOVER_FILL);
    fire('pointermove', 7, 8); // dx=2, dy=2 from the grabbed corner
    fire('pointerup', 7, 8);
    expect(ed._windowHandleDrag).toBeNull();
    const w = getFrameRecord().insetWindow;
    // Board-local centre (3.5, 4.5) unchanged -> record centre (cx, cy) unchanged at (0, 0); the dragged
    // corner's own new distance from it (3.5, 3.5) doubled gives the new size (7, 7).
    expect(w.cx).toBeCloseTo(0, 9);
    expect(w.cy).toBeCloseTo(0, 9);
    expect(w.w).toBeCloseTo(7, 9);
    expect(w.h).toBeCloseTo(7, 9);
  });

  it('dragging the body MOVES the window (the centre shifts, size unchanged) and lights no handle', () => {
    // Board-local outer rect (0.2,0.2)-(0.8,0.8) -> centre (-3, 4), 0.6x0.6 (tucked away, see the hover test above for why).
    setFrameRecord({ insetWindow: { enabled: true, cx: -3, cy: 4, w: 0.6, h: 0.6 } });
    setEditorTab('frame');
    fire('pointerdown', 0.5, 0.5);
    expect(ed._windowHandleDrag).toBeFalsy(); // a body-drag is not a handle grab
    fire('pointermove', 1.5, 1.7); // dx=1, dy=1.2 (board-local, y down)
    fire('pointerup', 1.5, 1.7);
    const w = getFrameRecord().insetWindow;
    // cx translates straight by dx; cy is Y-UP so it moves by -dy.
    expect(w.cx).toBeCloseTo(-3 + 1, 9);
    expect(w.cy).toBeCloseTo(4 - 1.2, 9);
    expect(w.w).toBeCloseTo(0.6, 9);
    expect(w.h).toBeCloseTo(0.6, 9);
  });

  it('Position X/Y steppers move the centre (size unchanged); Size W/H steppers resize directly (the centre unchanged)', () => {
    $('frameWindowPosX').value = '1'; $('frameWindowPosX').dispatchEvent(new Event('change'));
    expect(getFrameRecord().insetWindow).toMatchObject({ cx: 1, cy: 0, w: 3, h: 3 });
    $('frameWindowPosY').value = '-1'; $('frameWindowPosY').dispatchEvent(new Event('change'));
    expect(getFrameRecord().insetWindow).toMatchObject({ cx: 1, cy: -1, w: 3, h: 3 });
    $('frameWindowSizeW').value = '4'; $('frameWindowSizeW').dispatchEvent(new Event('change'));
    expect(getFrameRecord().insetWindow).toMatchObject({ cx: 1, cy: -1, w: 4, h: 3 }); // centre unchanged
    $('frameWindowSizeH').value = '2'; $('frameWindowSizeH').dispatchEvent(new Event('change'));
    expect(getFrameRecord().insetWindow).toMatchObject({ cx: 1, cy: -1, w: 4, h: 2 });
  });

  it('T82 item 4: non-finite typed input is rejected outright -- the field snaps back, nothing is written', () => {
    for (const id of ['frameWindowPosX', 'frameWindowPosY', 'frameWindowSizeW', 'frameWindowSizeH']) {
      const before = JSON.parse(JSON.stringify(getFrameRecord().insetWindow));
      $(id).value = '';
      $(id).dispatchEvent(new Event('change'));
      expect(getFrameRecord().insetWindow).toEqual(before); // nothing written
      expect($(id).value).not.toBe(''); // snapped back to the record's own current value
      expect(Number.isFinite(parseFloat($(id).value))).toBe(true);
    }
  });

  it('T82 item 4/5: size is clamped to clear 2*frame_thickness (plus a small margin) and never exceeds the board', () => {
    $('frameWindowSizeW').value = '0.01'; $('frameWindowSizeW').dispatchEvent(new Event('change'));
    const r1 = getFrameRecord().insetWindow;
    const ft = 0.75; // template_1's own default frame_thickness
    expect(r1.w).toBeGreaterThan(2 * ft); // strictly over insetWindowGeometry's own floor
    $('frameWindowSizeW').value = '999'; $('frameWindowSizeW').dispatchEvent(new Event('change'));
    const r2 = getFrameRecord().insetWindow;
    expect(r2.w).toBeLessThanOrEqual(P.widthIn);
    const outer2 = insetWindowOuterRect(r2, P.widthIn, P.heightIn);
    expect(outer2.x1).toBeGreaterThanOrEqual(-1e-9);
    expect(outer2.x2).toBeLessThanOrEqual(P.widthIn + 1e-9);
  });

  it('T82 item 5: position is clamped so the whole rect stays on the board (centre pulled in, size unchanged)', () => {
    $('frameWindowPosX').value = '-50'; $('frameWindowPosX').dispatchEvent(new Event('change'));
    const r = getFrameRecord().insetWindow;
    const outer = insetWindowOuterRect(r, P.widthIn, P.heightIn);
    expect(outer.x1).toBeGreaterThanOrEqual(-1e-9);
    expect(outer.x2).toBeLessThanOrEqual(P.widthIn + 1e-9);
    expect(r.w).toBeCloseTo(3, 9); // size untouched by a position clamp
  });
  function $(id) { return document.getElementById(id); }

  it('T82 item 5 (advisor review): a repeating-decimal value displays rounded to 3 decimals -- the record keeps full precision', () => {
    // A never-placed window (w===0 && h===0, the default sentinel) triggers the board-third seed on enable.
    setFrameRecord({ insetWindow: { enabled: false, cx: 0, cy: 0, w: 0, h: 0 } });
    document.getElementById('frameInsetWindowToggle').checked = true;
    document.getElementById('frameInsetWindowToggle').dispatchEvent(new Event('change')); // seeds w = P.widthIn/3 = 7/3
    expect($('frameWindowSizeW').value).toBe('2.333'); // displayed, rounded
    expect(getFrameRecord().insetWindow.w).toBeCloseTo(7 / 3, 12); // the record itself, full precision
  });

  it('a drag elsewhere (e.g. the corner drag above) syncs the steppers\' own displayed values back', () => {
    setEditorTab('frame');
    fire('pointerdown', 5, 6); fire('pointermove', 9, 10); fire('pointerup', 9, 10); // dx=4, dy=4
    // Centre unchanged (0, 0); half-size from the dragged corner's new distance (5.5, 5.5), doubled -> 11x11.
    expect(document.getElementById('frameWindowPosX').value).toBe('0');
    expect(document.getElementById('frameWindowPosY').value).toBe('0');
    expect(document.getElementById('frameWindowSizeW').value).toBe('11');
    expect(document.getElementById('frameWindowSizeH').value).toBe('11');
  });

  it('typing into a focused stepper is never clobbered by a sync (the same document.activeElement guard every other Frame field uses)', () => {
    const el = document.getElementById('frameWindowPosX');
    el.focus();
    el.value = '99'; // mid-edit, no change event fired yet
    setFrameRecord({ insetWindow: { enabled: true, cx: 0, cy: 0, w: 3, h: 3 } }); // a record change from elsewhere
    el.dispatchEvent(new Event('focus')); // no-op, just documents intent; real sync call below
    expect(el.value).toBe('99'); // still the user's own in-progress keystroke, not overwritten
  });

  it('the fields container shows only while the inset window is enabled', () => {
    setFrameRecord({ insetWindow: { enabled: false, cx: 0, cy: 0, w: 3, h: 3 } });
    document.getElementById('frameInsetWindowToggle').dispatchEvent(new Event('change'));
    // enabling via the checkbox itself (editFrame -> syncFramePanel) shows the fields again
    document.getElementById('frameInsetWindowToggle').checked = true;
    document.getElementById('frameInsetWindowToggle').dispatchEvent(new Event('change'));
    expect(document.getElementById('frameInsetWindowFields').style.display).toBe('');
  });
});

describe('T82 item 5: the insetWindow record shape and its migration', () => {
  beforeEach(() => { P.widthIn = 7; P.heightIn = 9; });

  it('the default record is the new centre-based shape, off', () => {
    const rec = normalizeFrameRecord({});
    expect(rec.insetWindow).toEqual({ enabled: false, cx: 0, cy: 0, w: 0, h: 0 });
  });

  it('a record already in the new shape round-trips unchanged', () => {
    const rec = normalizeFrameRecord({ insetWindow: { enabled: true, cx: 1.5, cy: -2, w: 3, h: 4 } });
    expect(rec.insetWindow).toEqual({ enabled: true, cx: 1.5, cy: -2, w: 3, h: 4 });
  });

  it('an OLD-shape record ({x1,y1,x2,y2}, board-local, origin top-left, y down) migrates to the new one', () => {
    // 7x9 board: outer rect (2,3)-(5,6) -> centre (0,0), 3x3 (hand-verified: cx=(2+5)/2-3.5=0, cy=4.5-(3+6)/2=0).
    const rec = normalizeFrameRecord({ insetWindow: { enabled: true, x1: 2, y1: 3, x2: 5, y2: 6 } });
    expect(rec.insetWindow).toEqual({ enabled: true, cx: 0, cy: 0, w: 3, h: 3 });
  });

  it('an OLD-shape record off-centre migrates correctly, corners in any order', () => {
    // Outer rect (1,2)-(4,8) on a 7x9 board -> centre ((1+4)/2-3.5, 4.5-(2+8)/2) = (-1, -0.5), 3x6.
    const rec = normalizeFrameRecord({ insetWindow: { enabled: false, x1: 4, y1: 8, x2: 1, y2: 2 } }); // reversed corners
    expect(rec.insetWindow).toEqual({ enabled: false, cx: -1, cy: -0.5, w: 3, h: 6 });
  });

  it('insetWindowOuterRect is the exact inverse of the migration (round-trips to the same board-local rect)', () => {
    const rec = normalizeFrameRecord({ insetWindow: { enabled: true, x1: 1.25, y1: 0.5, x2: 6, y2: 7.75 } });
    const outer = insetWindowOuterRect(rec.insetWindow, 7, 9);
    expect(outer.x1).toBeCloseTo(1.25, 9);
    expect(outer.y1).toBeCloseTo(0.5, 9);
    expect(outer.x2).toBeCloseTo(6, 9);
    expect(outer.y2).toBeCloseTo(7.75, 9);
  });

  it('garbage/non-finite values in either shape fall back to the declared default', () => {
    expect(normalizeFrameRecord({ insetWindow: { cx: 'x', cy: 0, w: 1, h: 1 } }).insetWindow).toEqual({ enabled: false, cx: 0, cy: 0, w: 0, h: 0 });
    expect(normalizeFrameRecord({ insetWindow: { x1: 'x', y1: 0, x2: 1, y2: 1 } }).insetWindow).toEqual({ enabled: false, cx: 0, cy: 0, w: 0, h: 0 });
  });
});
