/**
 * FB-APP F9 items 2-3: the frame shape HANDLES of the editor's Frame tab, read
 * from the ONE binding table (template_data.py FRAME_HANDLES -> frame-defs
 * `handles`). Seeded handles write the frame record's `seeds` and never a
 * parameter; a param-bound handle writes its (existing) param. The preview
 * (cut profile -> editor, trim, 3D) follows both; reload keeps them; a
 * template change resets the seeds.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  normalizeFrameRecord, getFrameRecord, setFrameRecord, framePayload,
} from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameHandles, handleDragPatch, frameHandleTable, frameSeedGeometry } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { generateSilhouette, paramsFromShapeModel } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { initFramePanel, setEditorTab, HANDLE_HIT_PX, frameHistoryDepth, undoFrame } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { FRAME_HANDLE_RADIUS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { HANDLE_HOVER_SCALE, HANDLE_HOVER_FILL } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-transform-handles.js';

const BOARD = { widthIn: 7, heightIn: 9 };
const tplOf = (defs, id) => defs.templates.find((t) => t.id === id);
const clone = (x) => JSON.parse(JSON.stringify(x));
const profile = (defs, rec) => frameCutProfile(defs, rec, BOARD);
/** Drag handle `key` by (dx, dy) board inches: the patch a drag writes. */
function drag(defs, rec, key, dx, dy) {
  const prof = profile(defs, rec);
  const h = frameHandles(tplOf(defs, rec.templateId), prof).find((q) => q.key === key);
  return { h, patch: handleDragPatch(rec, h, { x: h.anchor.x + dx, y: h.anchor.y + dy }, prof.region) };
}

describe('the binding table is the ONE source', () => {
  it.each(['template_1', 'template_2'])('%s: the handles drawn are exactly the declared ones, all seeded today', (id) => {
    const rec = normalizeFrameRecord({ templateId: id });
    const table = frameHandleTable(tplOf(FRAME_DEFS, id));
    expect(table.length).toBe(id === 'template_1' ? 5 : 4); // F20: T1 has a Shoulder AND a Hip; F27 item 2: + one radius handle each
    expect(table.every((h) => h.binding === 'seeded')).toBe(true); // no Frame Builder param controls the shape (phases/p02_*)
    expect(frameHandles(tplOf(FRAME_DEFS, id), profile(FRAME_DEFS, rec)).map((h) => h.key)).toEqual(table.map((h) => h.key));
  });

  it('a handle removed from the table is not drawn (nothing else declares handles)', () => {
    const defs = clone(FRAME_DEFS);
    tplOf(defs, 'template_1').handles = tplOf(defs, 'template_1').handles.filter((h) => h.key !== 'cornerRadiusBottom');
    const rec = normalizeFrameRecord({ templateId: 'template_1' }, defs);
    expect(frameHandles(tplOf(defs, 'template_1'), profile(defs, rec)).map((h) => h.key)).toEqual(['waistReach', 'cornerRadiusTop', 'waistCenterY', 'waistRadius']);
  });
});

describe('seeded handle: the record + the payload, never a parameter', () => {
  it.each([['template_1', 'waistReach', -0.4, 0], ['template_2', 'neckLength', 0, 0.5]])('%s %s', (id, key, dx, dy) => {
    const rec = normalizeFrameRecord({ templateId: id });
    const { h, patch } = drag(FRAME_DEFS, rec, key, dx, dy);
    const next = normalizeFrameRecord({ ...rec, ...patch });
    expect(next.seeds[key]).toBeCloseTo(h.valueFromWorld({ x: h.anchor.x + dx, y: h.anchor.y + dy }), 12);
    expect(next.params).toEqual({}); // nothing written to a parameter
    const payload = framePayload(FRAME_DEFS, next);
    expect(payload.seeds).toEqual(next.seeds);
    const frameParams = tplOf(FRAME_DEFS, id).params.filter((p) => p.owner === 'frame').map((p) => p.name).sort();
    expect(Object.keys(payload.params).sort()).toEqual(frameParams); // no new parameter name
    // the preview follows the seed (editor profile == the 3D / trim source)
    expect(profile(FRAME_DEFS, next).params[key]).toBeCloseTo(next.seeds[key], 9);
    expect(profile(FRAME_DEFS, next).pathD).not.toBe(profile(FRAME_DEFS, rec).pathD);
  });

  it('the gate keeps only declared seeded keys', () => {
    const rec = normalizeFrameRecord({ templateId: 'template_1', seeds: { waistReach: 0.3, neckWidth: 0.4, bogus: 1, cornerRadius: 'x' } });
    expect(rec.seeds).toEqual({ waistReach: 0.3 });
  });
});

describe('param-bound handle (the code path a proven binding takes)', () => {
  it('writes the bound param in inches (fraction x basis), the payload carries it, no seed', () => {
    const defs = clone(FRAME_DEFS);
    // a synthetic binding onto an existing frame-owned param, only to exercise the path
    tplOf(defs, 'template_1').handles.find((h) => h.key === 'cornerRadiusTop').binding = { param: 'frame_thickness' };
    const rec = normalizeFrameRecord({ templateId: 'template_1' }, defs);
    const { h, patch } = drag(defs, rec, 'cornerRadiusTop', 0.2, 0);
    const next = normalizeFrameRecord({ ...rec, ...patch }, defs);
    const region = profile(defs, rec).region;
    const v = h.valueFromWorld({ x: h.anchor.x + 0.2, y: h.anchor.y });
    expect(next.params.frame_thickness).toBeCloseTo(v * region.w / 2, 12);
    expect(next.seeds).toEqual({});
    expect(framePayload(defs, next).params.frame_thickness).toBeCloseTo(v * region.w / 2, 12);
    expect(profile(defs, next).params.cornerRadiusTop).toBeCloseTo(v, 9);
  });
});

describe('drag -> record -> reload, and a template change resets the seeds', () => {
  beforeEach(() => { P.frame = null; });
  afterEach(() => { P.frame = null; });
  it('keeps the seed through save/reload and resets it on a template change', () => {
    setFrameRecord({ templateId: 'template_1' });
    setFrameRecord(drag(FRAME_DEFS, getFrameRecord(), 'waistCenterY', 0, 0.6).patch);
    const seeds = getFrameRecord().seeds;
    expect(Object.keys(seeds)).toEqual(['waistCenterY']);
    const saved = JSON.parse(JSON.stringify({ P: persistableP() }));
    P.frame = null; P.frame = saved.P.frame;
    expect(getFrameRecord().seeds).toEqual(seeds);
    setFrameRecord({ wood: 'x', frameBottomZ: -2 }); // any other edit keeps them
    expect(getFrameRecord().seeds).toEqual(seeds);
    setFrameRecord({ templateId: 'template_2' });
    expect(getFrameRecord().seeds).toEqual({});
  });

  it('the reset is the declared rule, not a side effect of disjoint keys (two templates sharing a key)', () => {
    const t2 = tplOf(FRAME_DEFS, 'template_2');
    const saved = t2.handles;
    t2.handles = [...saved, { key: 'waistReach', label: 'shared', basis: 'hw', binding: 'seeded' }];
    try {
      setFrameRecord({ templateId: 'template_1', seeds: { waistReach: 0.3 } });
      expect(getFrameRecord().seeds).toEqual({ waistReach: 0.3 });
      setFrameRecord({ templateId: 'template_2' });
      expect(getFrameRecord().seeds).toEqual({});
    } finally { t2.handles = saved; }
  });
});

// ---------------------------------------------------------------- the Frame tab UI
function mockCanvasEditor() {
  const node = () => {
    const n = { children: [], attrs: {} };
    const self = (f) => (...a) => { f(...a); return n; };
    Object.assign(n, {
      id: self((v) => { n.attrs.id = v; }), attr: self((k, v) => { n.attrs[k] = v; }),
      // T81 item 1: fill/stroke/circle now capture their own argument (idle
      // fill='#ffffff', a bare `.circle()` with no args, etc. never read
      // these before -- an additive change, nothing existing asserted on
      // them, so no other test's expectations shift).
      fill: self((v) => { n.attrs.fill = v; }),
      stroke: self((v) => { if (v && typeof v === 'object') { n.attrs.stroke = v.color; n.attrs.strokeWidth = v.width; } }),
      addClass: self(() => {}), center: self((x, y) => { n.attrs.cx = x; n.attrs.cy = y; }),
      path: () => { const c = node(); n.children.push(c); return c; },
      circle: (d) => { const c = node(); c.isCircle = true; c.d = d; n.children.push(c); return c; },
      // F27 item 2: a position handle's square (drawParamHandle): rect(2r, 2r).move(x - r, y - r)
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

describe('Frame tab: dragging a handle through the shield', () => {
  let root, ed;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `<input id="widthIn" value="7"><input id="heightIn" value="9">
      <select id="frameTemplate"></select><div id="frameSettings"><select id="frameAppearance"></select></div>
      <button id="btnStampEdit"></button><div id="editorSVGContainer"></div><div id="editorFrameShield"></div>
      <aside id="editorFramePanel"></aside><aside id="editorLayersPanel"></aside>`;
    document.body.appendChild(root);
    P.frame = null; P.widthIn = 7; P.heightIn = 9;
    ed = mockCanvasEditor();
    window.svgEditor = ed;
    initFramePanel();
    setFrameRecord({ templateId: 'template_1' });
  });
  afterEach(() => { setEditorTab('artwork'); root.remove(); window.svgEditor = null; P.frame = null; });

  const fire = (type, x, y) => document.getElementById('editorFrameShield')
    .dispatchEvent(new MouseEvent(type, { clientX: x * ed.PX, clientY: y * ed.PX, bubbles: true, cancelable: true }));

  it('handles show in the Frame tab only; a press on one + a move writes the seed; a far press does nothing', () => {
    expect(ed._frameHandles || []).toEqual([]); // Artwork tab: no handles
    setEditorTab('frame');
    const handles = ed._frameHandles;
    expect(handles.map((h) => h.key)).toEqual(['waistReach', 'cornerRadiusTop', 'cornerRadiusBottom', 'waistCenterY', 'waistRadius']);
    const g = ed._bgLayer.findOne('#frame-profile');
    // F27 item 2: the two position handles are squares, the three radius handles circles
    expect(g.children.filter((c) => c.isSquare)).toHaveLength(2);
    expect(g.children.filter((c) => c.isCircle)).toHaveLength(3);

    const far = HANDLE_HIT_PX / ed.PX + 0.05;
    fire('pointerdown', handles[0].anchor.x + far, handles[0].anchor.y);
    fire('pointermove', handles[0].anchor.x - 0.5, handles[0].anchor.y);
    fire('pointerup', 0, 0);
    expect(getFrameRecord().seeds).toEqual({});

    const h = handles[0], to = { x: h.anchor.x - 0.4, y: h.anchor.y };
    fire('pointerdown', h.anchor.x + 0.05, h.anchor.y);
    fire('pointermove', to.x, to.y);
    fire('pointerup', to.x, to.y);
    expect(getFrameRecord().seeds.waistReach).toBeCloseTo(h.valueFromWorld(to), 9);
    expect(ed._frameHandles.find((q) => q.key === 'waistReach').anchor.x).toBeCloseTo(to.x, 6); // the handle followed
  });

  // T81 item 1 (Fred: "add visual feedback to these handles on hover"):
  // Frame had no idle-hover path at all before this (confirmed by reading
  // _wireHandleDrag pre-item-1: pointerdown/move-while-dragging/up only) --
  // the SAME declared look (handleHoverVisual) Shape Lattice's own param
  // handles use, per the dispatch's "same look everywhere."
  const cssState = () => Array.from(document.getElementById('editorSVGContainer').classList).filter((c) => c.startsWith('handle-hover'));
  const circleFor = (key) => {
    const h = ed._frameHandles.find((q) => q.key === key);
    return ed._bgLayer.findOne('#frame-profile').children.find((c) => (c.isCircle || c.isSquare) && Math.abs(c.attrs.cx - h.anchor.x) < 1e-9 && Math.abs(c.attrs.cy - h.anchor.y) < 1e-9);
  };

  it('idle: base radius/colour, no cursor class', () => {
    setEditorTab('frame');
    const c = circleFor('waistReach');
    expect(c.d / 2).toBeCloseTo(FRAME_HANDLE_RADIUS, 9);
    expect(c.attrs.fill).toBe('#ffffff');
    expect(cssState()).toEqual([]);
  });

  it('hovering a handle (no press) grows it, fills it with the shared accent, and sets the grab cursor', () => {
    setEditorTab('frame');
    const h = ed._frameHandles.find((q) => q.key === 'waistReach');
    fire('pointermove', h.anchor.x, h.anchor.y);
    expect(ed._frameHandleHover).toBe('waistReach');
    const c = circleFor('waistReach');
    expect(c.d / 2).toBeCloseTo(FRAME_HANDLE_RADIUS * HANDLE_HOVER_SCALE, 9);
    expect(c.attrs.fill).toBe(HANDLE_HOVER_FILL);
    expect(cssState()).toEqual(['handle-hover-ready']);
    expect(getFrameRecord().seeds).toEqual({}); // a hover writes nothing
  });

  it('hovering a handle highlights the outline it controls, both sides (Fred: "How about highlighting the geometry it control")', () => {
    setEditorTab('frame');
    const g0 = ed._bgLayer.findOne('#frame-profile');
    const idlePaths = g0.children.filter((c) => !c.isCircle && !c.isSquare).length;
    const h = ed._frameHandles.find((q) => q.key === 'waistRadius');
    fire('pointermove', h.anchor.x, h.anchor.y);
    expect(ed._frameHandleHover).toBe('waistRadius');
    const g = ed._bgLayer.findOne('#frame-profile');
    expect(g.children.filter((c) => !c.isCircle && !c.isSquare).length).toBe(idlePaths + 2); // the waist arc + its mirror
    fire('pointermove', h.anchor.x + 5, h.anchor.y + 5);
    expect(ed._bgLayer.findOne('#frame-profile').children.filter((c) => !c.isCircle && !c.isSquare).length).toBe(idlePaths);
  });

  it('a second finger during a handle drag (a pinch) puts the frame back and ends the drag; only the dragging finger ever moves the handle (Fred: "Zooming shouldn\'t move geometry inadvertently")', () => {
    setEditorTab('frame');
    ed._activePointers = new Map();
    const firePtr = (type, x, y, id) => {
      const ev = new MouseEvent(type, { clientX: x * ed.PX, clientY: y * ed.PX, bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'pointerId', { value: id });
      document.getElementById('editorFrameShield').dispatchEvent(ev);
    };
    const before = JSON.stringify(getFrameRecord());
    const h = ed._frameHandles.find((q) => q.key === 'waistReach');
    firePtr('pointerdown', h.anchor.x, h.anchor.y, 1);
    firePtr('pointermove', h.anchor.x - 0.3, h.anchor.y, 1);
    expect(JSON.stringify(getFrameRecord())).not.toBe(before); // non-vacuous: the drag really moved it
    firePtr('pointermove', h.anchor.x - 0.6, h.anchor.y, 2); // another finger's move: ignored
    const mid = JSON.stringify(getFrameRecord());
    firePtr('pointermove', h.anchor.x - 0.3, h.anchor.y, 1);
    expect(JSON.stringify(getFrameRecord())).toBe(mid);
    firePtr('pointerdown', h.anchor.x + 2, h.anchor.y + 2, 2); // second finger lands: a pinch
    expect(JSON.stringify(getFrameRecord())).toBe(before);
    expect(ed._frameHandleDrag).toBeNull();
    expect(ed._activePointers.has(1)).toBe(true); // the editor's pinch gets the first finger too
    firePtr('pointermove', h.anchor.x - 1, h.anchor.y, 1);
    expect(JSON.stringify(getFrameRecord())).toBe(before); // the pinch never drags the frame
  });

  it('moving off a handle clears the hover look', () => {
    setEditorTab('frame');
    const h = ed._frameHandles.find((q) => q.key === 'waistReach');
    fire('pointermove', h.anchor.x, h.anchor.y);
    expect(ed._frameHandleHover).toBe('waistReach');
    fire('pointermove', h.anchor.x + 5, h.anchor.y + 5);
    expect(ed._frameHandleHover).toBeNull();
    expect(circleFor('waistReach').attrs.fill).toBe('#ffffff');
    expect(cssState()).toEqual([]);
  });

  it('pressing a handle shows the SAME active look for the whole drag (Touch has no hover), then drops it on release', () => {
    setEditorTab('frame');
    const h = ed._frameHandles.find((q) => q.key === 'waistReach');
    fire('pointermove', h.anchor.x, h.anchor.y); // the real flow: hover, then press
    fire('pointerdown', h.anchor.x + 0.05, h.anchor.y);
    expect(ed._frameHandleDrag).toBe('waistReach');
    expect(cssState()).toEqual(['handle-hover-active']);
    expect(circleFor('waistReach').attrs.fill).toBe(HANDLE_HOVER_FILL);

    fire('pointermove', h.anchor.x - 0.3, h.anchor.y);
    expect(circleFor('waistReach').attrs.fill).toBe(HANDLE_HOVER_FILL); // still active mid-drag

    fire('pointerup', h.anchor.x - 0.3, h.anchor.y);
    expect(ed._frameHandleDrag).toBeNull();
    // still hovering the handle it was just released on -- plain hover, not idle.
    expect(cssState()).toEqual(['handle-hover-ready']);
  });

  it('leaving the Frame tab clears the hover and the cursor (same rule the rest of the editor applies to its own hover state)', () => {
    setEditorTab('frame');
    const h = ed._frameHandles.find((q) => q.key === 'waistReach');
    fire('pointermove', h.anchor.x, h.anchor.y);
    expect(cssState()).toEqual(['handle-hover-ready']);

    setEditorTab('artwork');

    expect(ed._frameHandleHover).toBeNull();
    expect(cssState()).toEqual([]);
  });
});

describe('F27 item 2 arc pull (Fred: "more intuitive to pull the arc than the arc center"): the Frame tab, real pointer events', () => {
  let root, ed;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `<input id="widthIn" value="7"><input id="heightIn" value="9">
      <select id="frameTemplate"></select><div id="frameSettings"><select id="frameAppearance"></select></div>
      <button id="btnStampEdit"></button><div id="editorSVGContainer"></div><div id="editorFrameShield"></div>
      <aside id="editorFramePanel"></aside><aside id="editorLayersPanel"></aside>`;
    document.body.appendChild(root);
    P.frame = null; P.widthIn = 7; P.heightIn = 9;
    ed = mockCanvasEditor();
    window.svgEditor = ed;
    initFramePanel();
    while (undoFrame()) { /* a fresh history */ }
    setFrameRecord({ templateId: 'template_1' });
    setEditorTab('frame');
  });
  afterEach(() => { setEditorTab('artwork'); root.remove(); window.svgEditor = null; P.frame = null; });

  const fire = (type, x, y) => document.getElementById('editorFrameShield')
    .dispatchEvent(new MouseEvent(type, { clientX: x * ed.PX, clientY: y * ed.PX, bubbles: true, cancelable: true }));
  const onArc = (a, t, d = 0) => { const th = a.theta1 + a.dTheta * t; return { x: a.cx + (a.rx + d) * Math.cos(th), y: a.cy + (a.rx + d) * Math.sin(th) }; };
  const highlights = () => ed._bgLayer.findOne('#frame-profile').children.filter((c) => !c.isCircle && !c.isSquare).length;
  const cls = () => Array.from(document.getElementById('editorSVGContainer').classList).sort();

  it('hovering an arc ANYWHERE (here the mirrored left waist, away from its dot) lights that arc on both sides; the cursor stays the normal pointer', () => {
    const idle = highlights();
    const h = ed._frameHandles.find((q) => q.key === 'waistRadius');
    const q = onArc(h.arcs[1], 0.25, 0.03); // the LEFT waist arc, 0.03 in off the curve
    fire('pointermove', q.x, q.y);
    expect(ed._frameHandleHover).toBe('waistRadius');
    expect(highlights()).toBe(idle + 2); // the waist arc + its mirror
    expect(cls()).toEqual(['handle-axis-plain', 'handle-hover-ready']);
    fire('pointermove', 3.5, 1); // the top middle, nothing there
    expect(ed._frameHandleHover).toBeNull();
    expect(highlights()).toBe(idle);
  });

  it('dragging the mirrored LEFT shoulder arc: the arc follows the pointer, only the seed is written, ONE undo step', () => {
    const h = ed._frameHandles.find((q) => q.key === 'cornerRadiusTop');
    const left = h.arcs[1];
    const from = onArc(left, 0.5), to = onArc(left, 0.5, 0.08);
    const depth0 = frameHistoryDepth();
    fire('pointerdown', from.x, from.y);
    expect(ed._frameHandleDrag).toBe('cornerRadiusTop');
    expect(highlights()).toBeGreaterThan(0); // Touch has no hover: the press itself lights it
    fire('pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2);
    fire('pointermove', to.x, to.y);
    fire('pointerup', to.x, to.y);
    expect(frameHistoryDepth()).toBe(depth0 + 1);
    expect(Object.keys(getFrameRecord().seeds)).toEqual(['cornerRadiusTop']);
    expect(getFrameRecord().params).toEqual({});
    const a1 = ed._frameProfile.primitives[h.mirrorSegment];
    expect(Math.hypot(to.x - a1.cx, to.y - a1.cy)).toBeCloseTo(a1.rx, 6); // the left arc under the pointer
    expect(ed._frameProfile.primitives[h.segment].rx).toBeCloseTo(a1.rx, 9); // and the right one mirrors it
    undoFrame();
    expect(getFrameRecord().seeds).toEqual({});
  });

  it('the waist dot, dragged: the pinch follows, the centre (the waistReach square) stays put; both seeds written', () => {
    const dot = ed._frameHandles.find((q) => q.key === 'waistRadius').anchor;
    const sq = ed._frameHandles.find((q) => q.key === 'waistReach').anchor;
    fire('pointerdown', dot.x, dot.y);
    expect(ed._frameHandleDrag).toBe('waistRadius');
    fire('pointermove', dot.x - 0.25, dot.y);
    fire('pointerup', dot.x - 0.25, dot.y);
    expect(Object.keys(getFrameRecord().seeds).sort()).toEqual(['waistRadius', 'waistReach']);
    expect(ed._frameHandles.find((q) => q.key === 'waistRadius').anchor.x).toBeCloseTo(dot.x - 0.25, 9);
    expect(ed._frameHandles.find((q) => q.key === 'waistReach').anchor.x).toBeCloseTo(sq.x, 9);
  });

  it('a position square in reach wins over an arc (T2: the Shoulder height square sits where the neck arc starts)', () => {
    setFrameRecord({ templateId: 'template_2', seeds: {} });
    setEditorTab('frame');
    const sq = ed._frameHandles.find((q) => q.key === 'neckLength');
    const neck = ed._frameHandles.find((q) => q.key === 'skeletonX');
    const start = onArc(neck.arcs[0], 0);
    expect(Math.hypot(start.x - sq.anchor.x, start.y - sq.anchor.y)).toBeLessThan(1e-6); // non-vacuous: both in reach
    fire('pointerdown', sq.anchor.x, sq.anchor.y);
    expect(ed._frameHandleDrag).toBe('neckLength');
    fire('pointerup', sq.anchor.x, sq.anchor.y);
  });
});

describe('F20 SHOULDER-HIP: the T1 frame has a Shoulder and a Hip handle, seeded separately', () => {
  const T1 = () => tplOf(FRAME_DEFS, 'template_1');
  it('the table: Shoulder (top corner) and Hip (bottom corner), seeded; no combined corner', () => {
    const t = frameHandleTable(T1());
    expect(t.map((h) => [h.key, h.label, h.binding])).toEqual([
      ['waistReach', 'Waist reach', 'seeded'], ['cornerRadiusTop', 'Shoulder', 'seeded'],
      ['cornerRadiusBottom', 'Hip', 'seeded'], ['waistCenterY', 'Waist position', 'seeded'],
      ['waistRadius', 'Waist radius', 'seeded']]); // F27 item 2
    expect(T1().handleMigrations).toEqual({ cornerRadius: ['cornerRadiusTop', 'cornerRadiusBottom'] });
  });

  it('dragging the Shoulder moves only the shoulder arcs (seed geometry); the Hip only the hip arcs', () => {
    const rec = normalizeFrameRecord({ templateId: 'template_1' });
    const geo0 = frameSeedGeometry(T1(), profile(FRAME_DEFS, rec), 7, 9);
    const moved = (key, dx) => {
      const { patch } = drag(FRAME_DEFS, rec, key, dx, 0);
      const next = normalizeFrameRecord({ ...rec, ...patch });
      expect(Object.keys(next.seeds)).toEqual([key]);             // one seed, never a parameter
      expect(next.params).toEqual({});
      const geo = frameSeedGeometry(T1(), profile(FRAME_DEFS, next), 7, 9);
      return Object.keys(geo).filter((id) => JSON.stringify(geo[id]) !== JSON.stringify(geo0[id]) && /shoulder|hip/.test(id)).sort();
    };
    const shoulder = moved('cornerRadiusTop', -0.3), hip = moved('cornerRadiusBottom', -0.3);
    expect(shoulder.length).toBeGreaterThan(0);
    expect(shoulder.every((id) => /shoulder/.test(id))).toBe(true);
    expect(hip.length).toBeGreaterThan(0);
    expect(hip.every((id) => /hip/.test(id))).toBe(true);
  });

  it('migration: a frame saved with the ONE corner radius seed keeps its exact shape (it becomes both corners)', () => {
    const old = normalizeFrameRecord({ templateId: 'template_1', seeds: { waistReach: 0.4, cornerRadius: 0.2 } });
    expect(old.seeds).toEqual({ waistReach: 0.4, cornerRadiusTop: 0.2, cornerRadiusBottom: 0.2 });
    // the pre-F20 shape: the shared cornerRadius overridden (both corners default to it)
    const prof = profile(FRAME_DEFS, old);
    const was = generateSilhouette(prof.region, { preset: 'hourglass',
      params: { ...paramsFromShapeModel('hourglass', T1().shapeModel, prof.region), waistReach: 0.4, cornerRadius: 0.2 } });
    expect(prof.primitives).toEqual(was.primitives);
    // an explicit new key wins over the migrated one
    expect(normalizeFrameRecord({ templateId: 'template_1', seeds: { cornerRadius: 0.2, cornerRadiusBottom: 0.3 } }).seeds)
      .toEqual({ cornerRadiusTop: 0.2, cornerRadiusBottom: 0.3 });
  });
});
