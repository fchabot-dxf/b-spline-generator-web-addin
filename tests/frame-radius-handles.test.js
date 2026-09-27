/**
 * F27 item 2 (Fred screenshot, Frame tab, Hourglass: the waist's arc radius
 * "can never be set anywhere, it needs a handle, and handle for position
 * should be a different color or shape than handle for radii").
 *
 * (a) every frame-shape arc's radius has a handle (the arc inventory below);
 *     the new ones (T1 waist, T2 body) sit at their arc's CENTRE like Shoulder/
 *     Hip (Fred: "please use center"; a flat waist's centre past the frame
 *     edge parks the diamond on that edge), a horizontal drag moves the
 *     centre, clamped to the true geometric limit, seeded in the record (no
 *     new Fusion parameter), and [Send frame] carries the new radius in the
 *     seed geometry.
 * (b) handle KINDS are declared data (HANDLE_KINDS, editor-transform-
 *     handles.js): position = a white square with the app's blue selection-
 *     handle border; radius = a circle in the editor's existing blue accent;
 *     the drag direction is the CURSOR on hover, left-right or up-down by
 *     the handle's axis (Fred's rulings).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P, setIsFusionMode } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { normalizeFrameRecord, setFrameRecord, framePayload } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameHandles, handleDragPatch } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import {
  HANDLE_KINDS, HANDLE_HOVER_FILL, APP_HANDLE_STROKE, handleKindVisual, drawParamHandle, setHandleCursor,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-transform-handles.js';
import { initFramePanel, sendFrame } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const BOARDS = [[7, 9], [12, 6], [5.51, 1.97]];
const prof = (rec, W = 7, H = 9) => frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
const handlesOf = (rec, W = 7, H = 9) => frameHandles(tplOf(rec.templateId), prof(rec, W, H));
const handle = (rec, key, W, H) => handlesOf(rec, W, H).find((h) => h.key === key);
const hwOf = (p) => p.region.w / 2;

/**
 * The ARC INVENTORY (WORK-LOG F27 item 2): every arc of each template's cut
 * profile (right side; the left is its exact mirror, one param drives both)
 * and the handle that sets its radius. Before F27 item 2 the T1 waist (prim 2)
 * and the T2 body (prim 2) had none.
 */
const ARC_RADIUS_HANDLE = {
  template_1: { 1: 'cornerRadiusTop', 2: 'waistRadius', 3: 'cornerRadiusBottom' }, // shoulder, WAIST (new), hip
  template_2: { 1: 'skeletonX', 2: 'bodyRadius' }, // neck (radius = skeletonX - neckWidth), BODY (new)
};

describe('(a) the arc inventory: every frame arc has a radius handle', () => {
  it.each(Object.keys(ARC_RADIUS_HANDLE))('%s: every arc (both sides) is set by a declared radius handle', (id) => {
    for (const [W, H] of BOARDS) {
      const rec = normalizeFrameRecord({ templateId: id });
      const p = prof(rec, W, H);
      const n = p.primitives.length;
      const arcs = p.primitives.map((q, i) => (q.type === 'A' ? i : -1)).filter((i) => i >= 0);
      const right = arcs.filter((i) => i < n / 2);
      expect(right.map(String)).toEqual(Object.keys(ARC_RADIUS_HANDLE[id]));
      const hs = Object.fromEntries(handlesOf(rec, W, H).map((h) => [h.key, h]));
      for (const i of right) {
        const key = ARC_RADIUS_HANDLE[id][i];
        expect(hs[key]?.handleKind, `${id} ${W}x${H} prim ${i}`).toBe('radius');
        // the handle's param really sets THIS arc's radius (and its mirror's)
        const v0 = p.params[key], r = hs[key].range;
        const v1 = v0 + (r.max - v0) * 0.3 > v0 + 1e-6 ? v0 + (r.max - v0) * 0.3 : v0 - (v0 - r.min) * 0.3;
        const next = normalizeFrameRecord({ ...rec, seeds: { [key]: v1 } });
        const p1 = prof(next, W, H);
        expect(p1.defects).toEqual([]);
        expect(Math.abs(p1.primitives[i].rx - p.primitives[i].rx), `${id} ${key}`).toBeGreaterThan(1e-6);
        const mirror = n - 2 - i;
        expect(p1.primitives[mirror].rx).toBeCloseTo(p1.primitives[i].rx, 9);
      }
    }
  });
});

describe('(a) the new radius handles sit at their arc CENTRE (Fred: "please use center") and drag the radius', () => {
  const CASES = [['template_1', 'waistRadius', 2], ['template_2', 'bodyRadius', 2]];

  it.each(CASES)('%s %s: the handle is at the arc\'s centre (or, past the frame edge, parked ON the edge on the centre\'s line), a horizontal radius handle', (id, key, prim) => {
    for (const [W, H] of BOARDS) {
      const rec = normalizeFrameRecord({ templateId: id });
      const p = prof(rec, W, H), a = p.primitives[prim];
      const h = handle(rec, key, W, H);
      expect(h.axis).toBe('x');
      expect(h.handleKind).toBe('radius');
      expect(h.anchor.y).toBeCloseTo(a.cy, 9);
      const edge = p.region.x + p.region.w;
      expect(h.anchor.x).toBeCloseTo(Math.min(a.cx, edge), 9);
    }
  });

  it.each(CASES)('%s %s: a horizontal drag moves the centre (the radius changes, the arc stays valid), only a seed is written', (id, key, prim) => {
    const rec = normalizeFrameRecord({ templateId: id });
    const p0 = prof(rec), h = handle(rec, key), a = p0.primitives[prim];
    const radii = [];
    for (const d of [-0.15, 0.15]) {
      const pt = { x: h.anchor.x + d, y: h.anchor.y };
      const patch = handleDragPatch(rec, h, pt, p0.region);
      expect(Object.keys(patch)).toEqual(['seeds']);
      const next = normalizeFrameRecord({ ...rec, ...patch });
      expect(next.params).toEqual({}); // never a parameter (Fred's ruling: no new Fusion params)
      expect(Object.keys(next.seeds)).toEqual([key]);
      const p1 = prof(next), a1 = p1.primitives[prim];
      expect(p1.defects).toEqual([]);
      if (h.range && next.seeds[key] > h.range.min && next.seeds[key] < h.range.max) expect(a1.cx).toBeCloseTo(pt.x, 6); // the centre follows the pointer
      radii.push(a1.rx);
    }
    expect((radii[0] - a.rx) * (radii[1] - a.rx)).toBeLessThan(0); // the two directions change the radius in opposite senses
  });

  it('T1 waist: a flat waist parks its diamond on the frame edge; grabbing it there is no jump, pulling it in tightens the waist', () => {
    const rec0 = normalizeFrameRecord({ templateId: 'template_1' });
    const h0 = handle(rec0, 'waistRadius');
    const flat = normalizeFrameRecord({ ...rec0, seeds: { waistRadius: h0.range.max } });
    const p = prof(flat), a = p.primitives[2], edge = p.region.x + p.region.w;
    expect(a.cx).toBeGreaterThan(edge); // non-vacuous: the centre really is off the frame
    const h = handle(flat, 'waistRadius');
    expect(h.anchor.x).toBeCloseTo(edge, 9);
    expect(h.valueFromWorld({ x: edge, y: h.anchor.y })).toBeCloseTo(flat.seeds.waistRadius, 9);
    expect(h.valueFromWorld({ x: edge + 1, y: h.anchor.y })).toBeCloseTo(flat.seeds.waistRadius, 9);
    const tighter = normalizeFrameRecord({ ...flat, ...handleDragPatch(flat, h, { x: edge - 0.5, y: h.anchor.y }, p.region) });
    expect(prof(tighter).primitives[2].rx).toBeLessThan(a.rx);
    expect(prof(tighter).defects).toEqual([]);
  });

  it.each(CASES)('%s %s: a drag past the geometry stops AT the true limit (not the Generate band), with a valid outline', (id, key) => {
    for (const [W, H] of BOARDS) {
      const rec = normalizeFrameRecord({ templateId: id });
      const p0 = prof(rec, W, H), h = handle(rec, key, W, H);
      const values = [];
      for (const far of [{ x: 1e4, y: h.anchor.y }, { x: -1e4, y: h.anchor.y }, { x: h.anchor.x, y: -1e4 }, { x: h.anchor.x, y: 1e4 }]) {
        const v = h.valueFromWorld(far);
        expect(v).toBeGreaterThanOrEqual(h.range.min - 1e-12);
        expect(v).toBeLessThanOrEqual(h.range.max + 1e-12);
        values.push(v);
        const next = normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, far, p0.region) });
        expect(prof(next, W, H).defects, `${id} ${W}x${H} ${JSON.stringify(far)}`).toEqual([]);
      }
      // both ends of the declared feasible range are reachable by a manual drag
      expect(values.some((v) => v === h.range.min) || values.some((v) => v === h.range.max)).toBe(true);
    }
  });

  it('T1 waist: the pinch (waist reach) stays put while the radius changes -- the radius handle is not a position handle', () => {
    const rec = normalizeFrameRecord({ templateId: 'template_1' });
    const pinch0 = handle(rec, 'waistReach').anchor;
    const h = handle(rec, 'waistRadius');
    const next = normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, { x: h.anchor.x - 0.2, y: h.anchor.y - 0.1 }, prof(rec).region) });
    expect(next.seeds.waistRadius).not.toBeCloseTo(prof(rec).params.waistRadius, 4);
    const pinch1 = handle(next, 'waistReach').anchor;
    expect(pinch1.x).toBeCloseTo(pinch0.x, 12);
    expect(pinch1.y).toBeCloseTo(pinch0.y, 12);
    expect(frameInnerProfile(FRAME_DEFS, next, { widthIn: 7, heightIn: 9 }).defects).toEqual([]);
  });
});

describe('(a) [Send frame]: a changed radius reaches Fusion in the seed geometry (no parameter)', () => {
  let root;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `<input id="widthIn" value="7"><input id="heightIn" value="9">
      <select id="frameTemplate"></select><div id="frameSettings"><select id="frameAppearance"></select></div>
      <button id="btnSendFrame" disabled></button><div id="frameSendHint"></div><div id="fusion-status" hidden></div>`;
    document.body.appendChild(root);
    P.frame = null; P.widthIn = 7; P.heightIn = 9;
    window.adsk = { fusionSendData: vi.fn() };
    initFramePanel();
    setIsFusionMode(true);
  });
  afterEach(() => { root.remove(); delete window.adsk; setIsFusionMode(false); P.frame = null; });

  const sent = () => {
    const calls = window.adsk.fusionSendData.mock.calls.filter(([a]) => a === 'send_frame');
    return JSON.parse(calls[calls.length - 1][1]);
  };
  /** The radius of the circle through an Arc3Point seed's three points. */
  const r3 = ([a, b, c]) => {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    const s = (p) => p[0] * p[0] + p[1] * p[1];
    const ux = (s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d;
    const uy = (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d;
    return Math.hypot(a[0] - ux, a[1] - uy);
  };

  it('T1: dragging the waist radius sends it: seed_rad_waist_R/L = the new radius (in), both waist arcs on it; no new param', () => {
    setFrameRecord({ templateId: 'template_1' });
    const rec = normalizeFrameRecord(P.frame);
    const p0 = prof(rec), h = handle(rec, 'waistRadius');
    setFrameRecord(handleDragPatch(rec, h, { x: h.anchor.x - 0.2, y: h.anchor.y }, p0.region));
    const rw = normalizeFrameRecord(P.frame).seeds.waistRadius * hwOf(p0);
    expect(Math.abs(rw - p0.primitives[2].rx)).toBeGreaterThan(0.05);
    expect(sendFrame()).toBe(true);
    const s = sent();
    expect(s.seeds).toEqual({ waistRadius: normalizeFrameRecord(P.frame).seeds.waistRadius });
    expect(Object.keys(s.params).sort()).toEqual(Object.keys(framePayload(FRAME_DEFS, normalizeFrameRecord({ templateId: 'template_1' })).params).sort());
    expect(s.seedGeometry.seed_rad_waist_R.radius).toBeCloseTo(rw, 9);
    expect(s.seedGeometry.seed_rad_waist_L.radius).toBeCloseTo(rw, 9);
    expect(r3(s.seedGeometry.arc_waist_R.points)).toBeCloseTo(rw, 6);
    expect(r3(s.seedGeometry.arc_waist_L.points)).toBeCloseTo(rw, 6);
  });

  it('T2: dragging the body radius sends it: both hip/body seed arcs carry the new radius', () => {
    setFrameRecord({ templateId: 'template_2' });
    const rec = normalizeFrameRecord(P.frame);
    const p0 = prof(rec), h = handle(rec, 'bodyRadius'), a = p0.primitives[2];
    setFrameRecord(handleDragPatch(rec, h, { x: h.anchor.x - 0.2, y: h.anchor.y }, p0.region)); // centre moves in: a bigger body arc
    const rb = normalizeFrameRecord(P.frame).seeds.bodyRadius * hwOf(p0);
    expect(Math.abs(rb - a.rx)).toBeGreaterThan(0.05);
    sendFrame();
    const s = sent();
    expect(Object.keys(s.seeds)).toEqual(['bodyRadius']);
    expect(r3(s.seedGeometry.arc_hip_R.points)).toBeCloseTo(rb, 6);
    expect(r3(s.seedGeometry.arc_hip_L.points)).toBeCloseTo(rb, 6);
  });
});

describe('(b) handle kinds are declared data, and render distinct', () => {
  it('the ONE table: position = the app\'s white/blue square, radius = circle in the editor\'s existing blue accent (Fred)', () => {
    expect(HANDLE_KINDS).toEqual({
      position: { shape: 'square', fill: '#ffffff', stroke: APP_HANDLE_STROKE },
      radius: { shape: 'circle', fill: HANDLE_HOVER_FILL },
    });
    expect(APP_HANDLE_STROKE).toBe('#0066cc');
  });

  it('every frame handle declares its kind: the radius ones are exactly the arc inventory', () => {
    for (const id of Object.keys(ARC_RADIUS_HANDLE)) {
      const hs = handlesOf(normalizeFrameRecord({ templateId: id }));
      expect(hs.every((h) => h.handleKind === 'position' || h.handleKind === 'radius')).toBe(true);
      expect(hs.filter((h) => h.handleKind === 'radius').map((h) => h.key).sort()).toEqual(Object.values(ARC_RADIUS_HANDLE[id]).sort());
    }
  });

  it('drawParamHandle: a square for position, a circle for radius; hover keeps the shape', () => {
    const el = (type, a) => { const e = { type, a, fill(v) { e.f = v; return e; }, stroke(v) { e.s = v; return e; }, center(x, y) { e.c = [x, y]; return e; }, move(x, y) { e.m = [x, y]; return e; } }; return e; };
    const layer = { circle: (d) => el('circle', d), rect: (w, h) => el('rect', [w, h]) };
    const pos = drawParamHandle(layer, handleKindVisual('position', 0.1, '#5d4037', false), 1, 2, 0.03);
    expect([pos.type, pos.a, pos.m, pos.f, pos.s.color]).toEqual(['rect', [0.2, 0.2], [0.9, 1.9], '#ffffff', APP_HANDLE_STROKE]);
    const rad = drawParamHandle(layer, handleKindVisual('radius', 0.1, '#5d4037', false), 1, 2, 0.03);
    expect([rad.type, rad.a, rad.c, rad.f, rad.s.color]).toEqual(['circle', 0.2, [1, 2], HANDLE_HOVER_FILL, '#5d4037']);
    expect(handleKindVisual('position', 0.1, '#5d4037', true)).toMatchObject({ shape: 'square', fill: HANDLE_HOVER_FILL });
    expect(handleKindVisual(undefined, 0.1, '#5d4037', false)).toMatchObject({ shape: 'square', fill: '#ffffff' }); // unknown -> position
  });

  it('the cursor shows the drag direction (Fred: "Use updown for one and left right the other ... Changing cursor on hover")', () => {
    document.body.innerHTML = '<div id="editorSVGContainer"></div>';
    const cls = () => Array.from(document.getElementById('editorSVGContainer').classList).sort();
    setHandleCursor('hover', 'x');
    expect(cls()).toEqual(['handle-axis-x', 'handle-hover-ready']);
    setHandleCursor('active', 'y');
    expect(cls()).toEqual(['handle-axis-y', 'handle-hover-active']);
    setHandleCursor('hover'); // no axis (a rail end): plain grab
    expect(cls()).toEqual(['handle-hover-ready']);
    setHandleCursor(null, 'x');
    expect(cls()).toEqual([]);
    for (const id of Object.keys(ARC_RADIUS_HANDLE)) {
      for (const h of handlesOf(normalizeFrameRecord({ templateId: id }))) expect(h.axis, `${id} ${h.key}`).toMatch(/^[xy]$/);
    }
  });
});
