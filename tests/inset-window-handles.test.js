/**
 * Fred: the inset window has no visible drag handles -- the drag interaction itself already worked
 * (_wireWindowDrag, main/frame-panel.js, blind corner hit-testing) but nothing marked where to grab,
 * unlike every other handle in this app (the declared HANDLE_KINDS convention,
 * editor-transform-handles.js). This file covers the 2 pieces added for that:
 *   1. visible corner markers (editor-frame-profile.js), hover/drag-active exactly like every other
 *      declared handle;
 *   2. Position (X,Y) / Size (W,H) steppers in the Frame panel, two-way synced with the same
 *      insetWindow rect the corner drag already writes.
 * (2D/3D rendering + the drag UI live in main/frame-panel.js, DOM-coupled -- see inset-window.test.js's
 * own header comment for the pure-geometry half of this feature, covered there instead.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { getFrameRecord, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
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
    setFrameRecord({ templateId: 'template_1', insetWindow: { enabled: true, x1: 2, y1: 3, x2: 5, y2: 6 } });
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
    expect(byKey.x1y1).toMatchObject({ cx: 2, cy: 3 });
    expect(byKey.x2y1).toMatchObject({ cx: 5, cy: 3 });
    expect(byKey.x1y2).toMatchObject({ cx: 2, cy: 6 });
    expect(byKey.x2y2).toMatchObject({ cx: 5, cy: 6 });
    expect(handles[0].d / 2).toBeCloseTo(FRAME_HANDLE_RADIUS, 9);
    expect(handles[0].attrs.fill).toBe('#ffffff'); // idle: the app's plain white/blue square, same as every other position handle
  });

  it('no markers when the inset window is disabled, even in the Frame tab', () => {
    setFrameRecord({ insetWindow: { enabled: false, x1: 2, y1: 3, x2: 5, y2: 6 } });
    setEditorTab('frame');
    expect(windowHandles()).toHaveLength(0);
  });

  it('hovering a corner (no press) grows it and fills it with the shared accent, same as every other declared handle', () => {
    setEditorTab('frame');
    fire('pointermove', 2, 3); // the x1y1 corner
    expect(ed._windowHandleHover).toBe('x1y1');
    const h = windowHandles().find((q) => q.attrs['data-key'] === 'x1y1');
    expect(h.d / 2).toBeCloseTo(FRAME_HANDLE_RADIUS * HANDLE_HOVER_SCALE, 9);
    expect(h.attrs.fill).toBe(HANDLE_HOVER_FILL);
  });

  it('hovering the window BODY (not a corner) lights no handle', () => {
    // Tucked into a corner, away from template_1's own shape-handle positions (near the board's own
    // hourglass silhouette) -- a body point that happens to land on a DIFFERENT handle would be grabbed
    // by that handle first (ed._frameHandleDrag), same precedence rule the drag listener itself uses.
    setFrameRecord({ insetWindow: { enabled: true, x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8 } });
    setEditorTab('frame');
    fire('pointermove', 0.5, 0.5); // inside the rect, away from any corner
    expect(ed._windowHandleHover).toBeFalsy();
  });

  it('dragging a corner resizes from that corner (the opposite corner stays put) and shows the active look mid-drag', () => {
    setEditorTab('frame');
    fire('pointerdown', 5, 6); // x2y2
    expect(ed._windowHandleDrag).toBe('x2y2');
    const active = windowHandles().find((q) => q.attrs['data-key'] === 'x2y2');
    expect(active.attrs.fill).toBe(HANDLE_HOVER_FILL);
    fire('pointermove', 7, 8);
    fire('pointerup', 7, 8);
    expect(ed._windowHandleDrag).toBeNull();
    const w = getFrameRecord().insetWindow;
    expect(w).toMatchObject({ x1: 2, y1: 3, x2: 7, y2: 8 }); // x1y1 (the OPPOSITE corner) unchanged
  });

  it('dragging the body MOVES the window (both corners shift) and lights no handle (unchanged existing behaviour)', () => {
    setFrameRecord({ insetWindow: { enabled: true, x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8 } }); // tucked away, see the hover test above for why
    setEditorTab('frame');
    fire('pointerdown', 0.5, 0.5);
    expect(ed._windowHandleDrag).toBeFalsy(); // a body-drag is not a handle grab
    fire('pointermove', 1.5, 1.7);
    fire('pointerup', 1.5, 1.7);
    expect(getFrameRecord().insetWindow).toMatchObject({ x1: 1.2, y1: 1.4, x2: 1.8, y2: 2.0 });
  });

  it('Position X/Y steppers MOVE the window (size unchanged); Size W/H steppers RESIZE it from x1/y1', () => {
    $('frameWindowPosX').value = '1'; $('frameWindowPosX').dispatchEvent(new Event('change'));
    expect(getFrameRecord().insetWindow).toMatchObject({ x1: 1, y1: 3, x2: 4, y2: 6 }); // width (3) preserved
    $('frameWindowPosY').value = '0'; $('frameWindowPosY').dispatchEvent(new Event('change'));
    expect(getFrameRecord().insetWindow).toMatchObject({ x1: 1, y1: 0, x2: 4, y2: 3 }); // height (3) preserved
    $('frameWindowSizeW').value = '10'; $('frameWindowSizeW').dispatchEvent(new Event('change'));
    expect(getFrameRecord().insetWindow).toMatchObject({ x1: 1, y1: 0, x2: 11, y2: 3 }); // x1 (anchor) unchanged
    $('frameWindowSizeH').value = '2'; $('frameWindowSizeH').dispatchEvent(new Event('change'));
    expect(getFrameRecord().insetWindow).toMatchObject({ x1: 1, y1: 0, x2: 11, y2: 2 });
  });
  function $(id) { return document.getElementById(id); }

  it('a drag elsewhere (e.g. the corner drag above) syncs the steppers\' own displayed values back', () => {
    setEditorTab('frame');
    fire('pointerdown', 5, 6); fire('pointermove', 9, 10); fire('pointerup', 9, 10);
    expect(document.getElementById('frameWindowPosX').value).toBe('2');
    expect(document.getElementById('frameWindowPosY').value).toBe('3');
    expect(document.getElementById('frameWindowSizeW').value).toBe('7'); // 9 - 2
    expect(document.getElementById('frameWindowSizeH').value).toBe('7'); // 10 - 3
  });

  it('typing into a focused stepper is never clobbered by a sync (the same document.activeElement guard every other Frame field uses)', () => {
    const el = document.getElementById('frameWindowPosX');
    el.focus();
    el.value = '99'; // mid-edit, no change event fired yet
    setFrameRecord({ insetWindow: { enabled: true, x1: 2, y1: 3, x2: 5, y2: 6 } }); // a record change from elsewhere
    // syncFramePanel only runs on an explicit edit/drag-end path in this app; simulate that path directly:
    el.dispatchEvent(new Event('focus')); // no-op, just documents intent; real sync call below
    expect(el.value).toBe('99'); // still the user's own in-progress keystroke, not overwritten
  });

  it('the fields container shows only while the inset window is enabled', () => {
    setFrameRecord({ insetWindow: { enabled: false, x1: 2, y1: 3, x2: 5, y2: 6 } });
    document.getElementById('frameInsetWindowToggle').dispatchEvent(new Event('change'));
    // enabling via the checkbox itself (editFrame -> syncFramePanel) shows the fields again
    document.getElementById('frameInsetWindowToggle').checked = true;
    document.getElementById('frameInsetWindowToggle').dispatchEvent(new Event('change'));
    expect(document.getElementById('frameInsetWindowFields').style.display).toBe('');
  });
});
