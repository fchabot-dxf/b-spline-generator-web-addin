/**
 * F31 item 2c (Fred: "on the Flask the side can sometimes be one piece, I'd want a manual
 * toggle"; the advisor's own design: "reuse the Frame tab's existing round handle style... a tap
 * toggles; a joined joint shows a filled circle, a split one hollow"). The DOM-coupled half of the
 * feature (pure geometry is tests/frame-join-markers.test.js, record normalization is
 * tests/joined-miters-record.test.js): the on-canvas marker, tap-to-toggle (ONE undo step,
 * mirrored pairs together), hover, and the "needs a N in blank" info line. Same mock SVG.js-like
 * layer tree as tests/inset-window-handles.test.js's own mockCanvasEditor (duplicated, not
 * imported -- that helper is private to that file).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { getFrameRecord, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { drawFrameProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { initFramePanel, setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

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

describe('F31 item 2c: joinable-joint markers, tap-to-toggle, blank-width info', () => {
  let root, ed;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `<input id="widthIn" value="7"><input id="heightIn" value="9">
      <select id="frameTemplate"></select><div id="frameSettings"><select id="frameAppearance"></select></div>
      <button id="btnStampEdit"></button><div id="editorSVGContainer"></div><div id="editorFrameShield"></div>
      <aside id="editorFramePanel"></aside><aside id="editorLayersPanel"></aside>
      <div id="frameFitWarning"></div><div id="frameJoinInfo"></div>`;
    document.body.appendChild(root);
    P.frame = null; P.widthIn = 7; P.heightIn = 9;
    ed = mockCanvasEditor();
    window.svgEditor = ed;
    initFramePanel();
    setFrameRecord({ templateId: 'template_15' });
    setEditorTab('frame');
    drawFrameProfile(ed);
  });
  afterEach(() => { setEditorTab('artwork'); root.remove(); window.svgEditor = null; P.frame = null; });

  const fire = (type, x, y) => document.getElementById('editorFrameShield').parentElement
    .dispatchEvent(new PointerEvent(type, { clientX: x * ed.PX, clientY: y * ed.PX, bubbles: true, cancelable: true, pointerId: 1 }));

  it('a marker exists at each declared joinable joint\'s own real anchor, Frame tab only', () => {
    expect(ed._frameJoinMarkers).toHaveLength(2);
    setEditorTab('artwork');
    drawFrameProfile(ed);
    expect(ed._frameJoinMarkers).toEqual([]);
    setEditorTab('frame');
  });

  it('tapping a marker toggles IT AND ITS MIRROR together, one undo step, and info line appears', () => {
    const [jm] = ed._frameJoinMarkers;
    expect(getFrameRecord().joinedMiters).toEqual([]);
    fire('pointerdown', jm.anchor.x, jm.anchor.y);
    const after = getFrameRecord();
    expect(after.joinedMiters.sort()).toEqual([jm.id, jm.mirror].sort());
    const info = document.getElementById('frameJoinInfo');
    expect(info.style.display).not.toBe('none');
    expect(info.textContent).toMatch(/One piece: needs a .+ in blank\./);
  });

  it('tapping the SAME marker again un-joins both (a clean toggle, not a one-way switch)', () => {
    const [jm] = ed._frameJoinMarkers;
    fire('pointerdown', jm.anchor.x, jm.anchor.y);
    fire('pointerup', jm.anchor.x, jm.anchor.y);
    drawFrameProfile(ed);
    fire('pointerdown', jm.anchor.x, jm.anchor.y);
    expect(getFrameRecord().joinedMiters).toEqual([]);
    const info = document.getElementById('frameJoinInfo');
    expect(info.style.display).toBe('none');
  });

  it('tapping the mirror side toggles the SAME pair (either marker reaches both ids)', () => {
    const [jmA, jmB] = ed._frameJoinMarkers;
    fire('pointerdown', jmB.anchor.x, jmB.anchor.y);
    expect(getFrameRecord().joinedMiters.sort()).toEqual([jmA.id, jmB.id].sort());
  });

  it('a tap elsewhere on the canvas (not on a marker) does not toggle anything', () => {
    fire('pointerdown', -100, -100); // far outside the board/profile entirely
    expect(getFrameRecord().joinedMiters).toEqual([]);
  });

  it('a template with no declared joinable joints (Template 1) shows no markers and never crashes a tap', () => {
    setFrameRecord({ templateId: 'template_1' });
    drawFrameProfile(ed);
    expect(ed._frameJoinMarkers).toEqual([]);
    expect(() => fire('pointerdown', 0, 0)).not.toThrow();
  });
});
