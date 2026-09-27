/**
 * F27 item 2 (Fred screenshot, Frame tab, Hourglass: the waist's arc radius
 * "can never be set anywhere, it needs a handle, and handle for position
 * should be a different color or shape than handle for radii").
 *
 * (a) every frame-shape arc's radius has a handle (the arc inventory below);
 *     the new ones (T1 waist, T2 body) sit ON their arc, a drag re-solves the
 *     radius whose arc passes under the pointer, clamped to the true
 *     geometric limit, seeded in the record (no new Fusion parameter), and
 *     [Send frame] carries the new radius in the seed geometry.
 * (b) handle KINDS are declared data (HANDLE_KINDS, editor-transform-
 *     handles.js): position = round white, radius = diamond in the editor's
 *     existing blue accent (Fred's ruling).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P, setIsFusionMode } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { normalizeFrameRecord, setFrameRecord, framePayload } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameHandles, handleDragPatch } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { radiusThroughPoint } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import {
  HANDLE_KINDS, HANDLE_HOVER_FILL, HANDLE_DIAMOND_SCALE, handleKindVisual, drawParamHandle,
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

describe('(a) the new radius handles sit ON their arc and drag the radius', () => {
  const CASES = [['template_1', 'waistRadius', 2], ['template_2', 'bodyRadius', 2]];

  it.each(CASES)('%s %s: the handle is on the arc (not its centre), clear of every other handle', (id, key, prim) => {
    for (const [W, H] of BOARDS) {
      const rec = normalizeFrameRecord({ templateId: id });
      const a = prof(rec, W, H).primitives[prim];
      const hs = handlesOf(rec, W, H), h = hs.find((q) => q.key === key);
      expect(Math.hypot(h.anchor.x - a.cx, h.anchor.y - a.cy)).toBeCloseTo(a.rx, 9);
      // inside the arc's own angular span
      const t = Math.atan2(h.anchor.y - a.cy, h.anchor.x - a.cx);
      let rel = t - a.theta1; rel -= 2 * Math.PI * Math.floor((rel + Math.PI) / (2 * Math.PI));
      if (a.dTheta < 0) rel = -rel;
      if (rel < 0) rel += 2 * Math.PI;
      expect(rel).toBeGreaterThan(0);
      expect(rel).toBeLessThan(Math.abs(a.dTheta));
      for (const o of hs) if (o !== h) expect(Math.hypot(o.anchor.x - h.anchor.x, o.anchor.y - h.anchor.y)).toBeGreaterThan(0.1);
    }
  });

  it.each(CASES)('%s %s: a drag along the normal changes the radius, the arc passes under the pointer, only a seed is written', (id, key, prim) => {
    const rec = normalizeFrameRecord({ templateId: id });
    const p0 = prof(rec), h = handle(rec, key), a = p0.primitives[prim];
    const n = { x: (h.anchor.x - a.cx) / a.rx, y: (h.anchor.y - a.cy) / a.rx }; // the arc's normal at the handle (away from its centre)
    const radii = [];
    for (const d of [-0.15, 0.15]) {
      const pt = { x: h.anchor.x + n.x * d, y: h.anchor.y + n.y * d };
      const patch = handleDragPatch(rec, h, pt, p0.region);
      expect(Object.keys(patch)).toEqual(['seeds']);
      const next = normalizeFrameRecord({ ...rec, ...patch });
      expect(next.params).toEqual({}); // never a parameter (Fred's ruling: no new Fusion params)
      expect(Object.keys(next.seeds)).toEqual([key]);
      const p1 = prof(next), a1 = p1.primitives[prim];
      expect(p1.defects).toEqual([]);
      expect(Math.hypot(pt.x - a1.cx, pt.y - a1.cy)).toBeCloseTo(a1.rx, 6); // the arc follows the pointer
      radii.push(a1.rx);
    }
    // the two directions along the normal change the radius in OPPOSITE senses (a
    // monotone pull, no dead zone): which sense is the arc's own geometry (the
    // waist circles all pass through the fixed pinch; the body's centre also
    // rides its tangency with the neck)
    expect((radii[0] - a.rx) * (radii[1] - a.rx)).toBeLessThan(0);
    expect(Math.min(Math.abs(radii[0] - a.rx), Math.abs(radii[1] - a.rx))).toBeGreaterThan(0.01);
  });

  it.each(CASES)('%s %s: a continuous drag (the Frame tab loop: fresh handle each move) is monotone, with no branch jump', (id, key, prim) => {
    for (const sense of [1, -1]) {
      let rec = normalizeFrameRecord({ templateId: id });
      const p0 = prof(rec), h0 = handle(rec, key), a = p0.primitives[prim];
      const n = { x: (h0.anchor.x - a.cx) / a.rx, y: (h0.anchor.y - a.cy) / a.rx };
      const radii = [a.rx];
      for (let d = 0.02; d <= 0.4001; d += 0.02) {
        const h = handle(rec, key); // frame-panel.js re-reads ed._frameHandles on every move
        const pt = { x: h0.anchor.x + n.x * d * sense, y: h0.anchor.y + n.y * d * sense };
        rec = normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, p0.region) });
        const a1 = prof(rec).primitives[prim];
        const v = rec.seeds[key];
        // the arc stays under the pointer the whole way, until the drag reaches the true limit
        if (v > h.range.min && v < h.range.max) expect(Math.hypot(pt.x - a1.cx, pt.y - a1.cy)).toBeCloseTo(a1.rx, 6);
        radii.push(a1.rx);
      }
      // monotone over the first 0.2 in (further along a straight line the waist
      // legitimately turns back: the smallest circle through the pinch that
      // reaches the pointer's height is R = that height, so it cannot keep shrinking)
      const steps = radii.slice(1, 11).map((r, i) => r - radii[i]);
      const dir = Math.sign(steps.find((x) => Math.abs(x) > 1e-9));
      expect(steps.every((x) => x * dir >= -1e-9), `${id} ${sense}: ${radii.map((r) => r.toFixed(3))}`).toBe(true);
    }
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
    const next = normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, { x: h.anchor.x + 0.2, y: h.anchor.y - 0.1 }, prof(rec).region) });
    expect(next.seeds.waistRadius).not.toBeCloseTo(prof(rec).params.waistRadius, 4);
    const pinch1 = handle(next, 'waistReach').anchor;
    expect(pinch1.x).toBeCloseTo(pinch0.x, 12);
    expect(pinch1.y).toBeCloseTo(pinch0.y, 12);
    expect(frameInnerProfile(FRAME_DEFS, next, { widthIn: 7, heightIn: 9 }).defects).toEqual([]);
  });
});

describe('radiusThroughPoint', () => {
  const circleAt = (v) => ({ cx: v, cy: 0, r: v }); // every circle through the origin, centred on +x
  it('solves the circle through the point; out of range -> the nearer end', () => {
    expect(radiusThroughPoint(circleAt, { min: 0.1, max: 10 }, 1, { x: 1, y: 1 })).toBeCloseTo(1, 9); // (1-1)^2 + 1 = 1
    expect(radiusThroughPoint(circleAt, { min: 0.1, max: 10 }, 1, { x: 2, y: 0 })).toBeCloseTo(1, 9);
    expect(radiusThroughPoint(circleAt, { min: 0.1, max: 10 }, 1, { x: 0.01, y: 5 })).toBe(10); // needs R = 1250
    expect(radiusThroughPoint(circleAt, { min: 0.5, max: 10 }, 1, { x: 0.2, y: 0.1 })).toBe(0.5); // needs R = 0.125
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
    const n = { x: (h.anchor.x - a.cx) / a.rx, y: (h.anchor.y - a.cy) / a.rx };
    setFrameRecord(handleDragPatch(rec, h, { x: h.anchor.x + n.x * 0.2, y: h.anchor.y + n.y * 0.2 }, p0.region));
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
  it('the ONE table: position = round white, radius = diamond in the editor\'s existing blue accent (Fred\'s ruling)', () => {
    expect(HANDLE_KINDS).toEqual({ position: { shape: 'circle', fill: '#ffffff' }, radius: { shape: 'diamond', fill: HANDLE_HOVER_FILL } });
  });

  it('every frame handle declares its kind: the radius ones are exactly the arc inventory', () => {
    for (const id of Object.keys(ARC_RADIUS_HANDLE)) {
      const hs = handlesOf(normalizeFrameRecord({ templateId: id }));
      expect(hs.every((h) => h.handleKind === 'position' || h.handleKind === 'radius')).toBe(true);
      expect(hs.filter((h) => h.handleKind === 'radius').map((h) => h.key).sort()).toEqual(Object.values(ARC_RADIUS_HANDLE[id]).sort());
    }
  });

  it('drawParamHandle: a circle for position, a diamond (scaled half-diagonal) for radius; hover keeps the shape', () => {
    const calls = [];
    const el = (type, a) => { const e = { type, a, fill(v) { e.f = v; return e; }, stroke(v) { e.s = v; return e; }, center(x, y) { e.c = [x, y]; return e; } }; calls.push(e); return e; };
    const layer = { circle: (d) => el('circle', d), polygon: (pts) => el('polygon', pts) };
    const pos = drawParamHandle(layer, handleKindVisual('position', 0.1, '#5d4037', false), 1, 2, 0.03);
    expect([pos.type, pos.a, pos.c, pos.f, pos.s.color]).toEqual(['circle', 0.2, [1, 2], '#ffffff', '#5d4037']);
    const rad = drawParamHandle(layer, handleKindVisual('radius', 0.1, '#5d4037', false), 1, 2, 0.03);
    const r = 0.1 * HANDLE_DIAMOND_SCALE;
    expect(rad.type).toBe('polygon');
    expect(rad.a).toEqual([[1, 2 - r], [1 + r, 2], [1, 2 + r], [1 - r, 2]]);
    expect(rad.f).toBe(HANDLE_HOVER_FILL);
    expect(handleKindVisual('radius', 0.1, '#5d4037', true).shape).toBe('diamond');
    expect(handleKindVisual(undefined, 0.1, '#5d4037', false)).toMatchObject({ shape: 'circle', fill: '#ffffff' }); // unknown -> position
  });
});
