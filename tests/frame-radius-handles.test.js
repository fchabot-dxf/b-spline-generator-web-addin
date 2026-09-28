/**
 * F27 item 2 (Fred screenshot, Frame tab, Hourglass: the waist's arc radius
 * "can never be set anywhere, it needs a handle, and handle for position
 * should be a different color or shape than handle for radii").
 *
 * (a) every frame-shape arc's radius has a handle (the arc inventory below),
 *     seeded in the record (no new Fusion parameter), and [Send frame] carries
 *     the new radius in the seed geometry. F27 item 2 ARC PULL (Fred: "the more
 *     I look at it the more I'm thinking it's more intuitive to pull the arc
 *     than the arc center"; "Well I still want a handle on the curve itself"):
 *     the handle IS the arc, either side, with a blue dot ON it; the drag
 *     re-solves the radius so the arc passes under the pointer, up to the true
 *     geometric limit. The hourglass waist is a CAD circle (Fred agreed): its
 *     waistReach square at the arc centre ("Then the position for waist reach
 *     can be the arc center") slides it, radius held; its arc (dot on the
 *     pinch) is the rim, following the pointer about the fixed centre.
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
  HANDLE_KINDS, HANDLE_HOVER_FILL, APP_HANDLE_STROKE, handleKindVisual, drawParamHandle, setHandleCursor, paramHandleCursorAxis,
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

/** A point `d` in along the arc's outward-from-centre direction at its parameter `t`. */
const onArc = (a, t, d = 0) => {
  const th = a.theta1 + a.dTheta * t;
  return { x: a.cx + (a.rx + d) * Math.cos(th), y: a.cy + (a.rx + d) * Math.sin(th) };
};
const mirrorX = (p, q) => ({ x: 2 * (p.region.x + p.region.w / 2) - q.x, y: q.y });
/** Drag handle `h` of `rec` to `pt` (ctx: side / grab), the record after it. */
const dragTo = (rec, h, pt, ctx = {}, W = 7, H = 9) => normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof(rec, W, H).region, ctx) });
/** The arc-pull radius params: every arc but the hourglass waist (a CAD circle, below). */
const PULLED = [['template_1', 'cornerRadiusTop', 1], ['template_1', 'cornerRadiusBottom', 3], ['template_2', 'skeletonX', 1], ['template_2', 'bodyRadius', 2]];
const inside = (h, v) => v > h.range.min + 1e-9 && v < h.range.max - 1e-9;

describe('(a) F27 item 2 arc pull (Fred: "more intuitive to pull the arc than the arc center"): the arc IS the radius handle', () => {
  it.each(Object.keys(ARC_RADIUS_HANDLE))('%s: every radius handle grips its arc on BOTH sides, its dot ON the right arc', (id) => {
    for (const [W, H] of BOARDS) {
      const rec = normalizeFrameRecord({ templateId: id });
      const p = prof(rec, W, H), n = p.primitives.length;
      for (const [i, key] of Object.entries(ARC_RADIUS_HANDLE[id])) {
        const h = handle(rec, key, W, H);
        expect(h.axis).toBe('arc');
        expect(h.handleKind).toBe('radius');
        expect([h.segment, h.mirrorSegment]).toEqual([Number(i), n - 2 - Number(i)]);
        expect(h.arcs).toEqual([p.primitives[i], p.primitives[n - 2 - i]]);
        const a = h.arcs[0];
        expect(Math.hypot(h.anchor.x - a.cx, h.anchor.y - a.cy), `${id} ${W}x${H} ${key}`).toBeCloseTo(a.rx, 9); // ON the arc
        expect(h.valueFromWorld(h.anchor)).toBeCloseTo(p.params[key], 9); // grabbing the dot is no jump
      }
    }
  });

  it.each(PULLED)('%s %s: the dot sits at the arc\'s angular midpoint', (id, key, i) => {
    const rec = normalizeFrameRecord({ templateId: id });
    const h = handle(rec, key), mid = onArc(prof(rec).primitives[i], 0.5);
    expect(h.anchor.x).toBeCloseTo(mid.x, 9);
    expect(h.anchor.y).toBeCloseTo(mid.y, 9);
  });

  it.each(PULLED)('%s %s: dragging the arc (right or mirrored left) re-solves the radius so the arc passes under the pointer, monotone, seed only', (id, key, i) => {
    for (const [W, H] of BOARDS) {
      const rec = normalizeFrameRecord({ templateId: id });
      const p0 = prof(rec, W, H), h = handle(rec, key, W, H), n = p0.primitives.length;
      const values = [];
      for (const d of [-0.12, -0.06, 0.06, 0.12]) {
        for (const t of [0.3, 0.5, 0.7]) {
          const q = onArc(p0.primitives[i], t, d * Math.min(1, p0.primitives[i].rx));
          const next = dragTo(rec, h, q, { side: 0 }, W, H);
          expect(next.params).toEqual({}); // never a parameter (Fred's ruling: no new Fusion params)
          expect(Object.keys(next.seeds)).toEqual([key]);
          const p1 = prof(next, W, H), a1 = p1.primitives[i];
          expect(p1.defects, `${id} ${W}x${H} ${key} d=${d} t=${t}`).toEqual([]);
          if (inside(h, next.seeds[key])) expect(Math.hypot(q.x - a1.cx, q.y - a1.cy), `${id} ${W}x${H} ${key} d=${d}`).toBeCloseTo(a1.rx, 6); // the arc under the pointer
          // the mirrored LEFT arc, grabbed at the mirror point: the same value
          const left = dragTo(rec, h, mirrorX(p0, q), { side: 1 }, W, H);
          expect(left.seeds[key]).toBeCloseTo(next.seeds[key], 9);
          expect(prof(left, W, H).primitives[n - 2 - i].rx).toBeCloseTo(a1.rx, 9);
          if (t === 0.5) values.push(next.seeds[key]);
        }
      }
      // monotone along the normal: outward one way, inward the other
      const diffs = values.slice(1).map((v, k) => v - values[k]);
      expect(diffs.every((x) => x >= -1e-12) || diffs.every((x) => x <= 1e-12), `${id} ${W}x${H} ${key} ${values}`).toBe(true);
      expect(Math.abs(values[3] - values[0])).toBeGreaterThan(1e-4);
    }
  });

  it.each(PULLED)('%s %s: pulled far either way the drag stops AT the true limit (not the Generate band), outline valid', (id, key, i) => {
    for (const [W, H] of BOARDS) {
      const rec = normalizeFrameRecord({ templateId: id });
      const p0 = prof(rec, W, H), h = handle(rec, key, W, H), a = p0.primitives[i];
      const ends = [];
      for (const d of [-a.rx * 0.999, 50]) { // through the centre side / far outside
        // walk there in small steps, the way a real drag re-reads the shape each tick
        let r = rec;
        for (let k = 1; k <= 40; k++) {
          const hk = handle(r, key, W, H);
          r = dragTo(r, hk, onArc(a, 0.5, d * k / 40), { side: 0 }, W, H);
        }
        expect(prof(r, W, H).defects, `${id} ${W}x${H} ${key} ${d}`).toEqual([]);
        ends.push(r.seeds[key]);
      }
      expect(ends.some((v) => v === h.range.min || v === h.range.max), `${id} ${W}x${H} ${key} ${ends} ${JSON.stringify(h.range)}`).toBe(true);
    }
  });
});

describe('(a) the hourglass WAIST is a CAD circle (Fred): centre square + rim', () => {
  const T1 = () => normalizeFrameRecord({ templateId: 'template_1' });

  it('the waist dot sits ON THE PINCH, the waistReach square at the arc CENTRE, on the same line', () => {
    for (const [W, H] of BOARDS) {
      const p = prof(T1(), W, H), a = p.primitives[2];
      const dot = handle(T1(), 'waistRadius', W, H).anchor, sq = handle(T1(), 'waistReach', W, H).anchor;
      expect(dot.x).toBeCloseTo(a.cx - a.rx, 9);
      expect(dot.y).toBeCloseTo(a.cy, 9);
      expect(sq.x).toBeCloseTo(Math.min(a.cx, p.region.x + p.region.w), 9);
      expect(sq.y).toBeCloseTo(a.cy, 9);
    }
  });

  it('grabbing the waist arc ANYWHERE (either side): the rim follows the pointer about a FIXED centre -- one drag writes waistRadius AND waistReach', () => {
    for (const [W, H] of BOARDS) {
      const rec = T1(), p0 = prof(rec, W, H), a = p0.primitives[2], h = handle(rec, 'waistRadius', W, H);
      for (const t of [0.2, 0.5, 0.8]) {
        for (const d of [-0.08, 0.08]) {
          const q = onArc(a, t, d * a.rx);
          for (const [side, pt] of [[0, q], [1, mirrorX(p0, q)]]) {
            const next = dragTo(rec, h, pt, { side }, W, H);
            expect(Object.keys(next.seeds).sort()).toEqual(['waistRadius', 'waistReach']);
            const p1 = prof(next, W, H), a1 = p1.primitives[2];
            expect(p1.defects).toEqual([]);
            expect(a1.cx, `${W}x${H} t=${t} d=${d} side=${side}`).toBeCloseTo(a.cx, 9); // the centre never moves
            expect(a1.cy).toBeCloseTo(a.cy, 9);
            expect(a1.rx).toBeCloseTo(Math.hypot(q.x - a.cx, q.y - a.cy), 9); // r = |pointer - centre|
          }
        }
      }
    }
  });

  it('the dot dragged horizontally just moves the pinch (the centre stays put)', () => {
    const rec = T1(), p0 = prof(rec), a = p0.primitives[2], h = handle(rec, 'waistRadius');
    const next = dragTo(rec, h, { x: h.anchor.x - 0.2, y: h.anchor.y });
    const dot = handle(next, 'waistRadius').anchor;
    expect(dot.x).toBeCloseTo(h.anchor.x - 0.2, 9);
    expect(handle(next, 'waistReach').anchor.x).toBeCloseTo(handle(rec, 'waistReach').anchor.x, 9);
    expect(prof(next).primitives[2].cx).toBeCloseTo(a.cx, 9);
    expect(frameInnerProfile(FRAME_DEFS, next, { widthIn: 7, heightIn: 9 }).defects).toEqual([]);
  });

  it('pulled past a limit, the waist stops AT it with the centre still fixed (whichever of the two params binds first)', () => {
    for (const [W, H] of BOARDS) {
      const rec = T1(), p0 = prof(rec, W, H), a = p0.primitives[2];
      const limits = [];
      for (const far of [{ x: a.cx - 1e3, y: a.cy }, { x: a.cx, y: a.cy }]) { // a huge rim / no rim at all
        const h = handle(rec, 'waistRadius', W, H);
        const next = dragTo(rec, h, far, {}, W, H);
        const p1 = prof(next, W, H);
        expect(p1.defects, `${W}x${H} ${JSON.stringify(far)}`).toEqual([]);
        expect(p1.primitives[2].cx).toBeCloseTo(a.cx, 9);
        const R = handle(next, 'waistRadius', W, H).range, Rr = handle(next, 'waistReach', W, H).range;
        const atLimit = [next.seeds.waistRadius - R.min, R.max - next.seeds.waistRadius, next.seeds.waistReach - Rr.min, Rr.max - next.seeds.waistReach]
          .some((x) => Math.abs(x) < 1e-6);
        limits.push(atLimit);
      }
      expect(limits, `${W}x${H}`).toEqual([true, true]);
    }
  });

  it('the waistReach square slides the whole waist sideways, its radius held (the centre follows the pointer)', () => {
    for (const [W, H] of BOARDS) {
      const rec = T1(), p0 = prof(rec, W, H), a = p0.primitives[2], h = handle(rec, 'waistReach', W, H);
      if (a.cx > p0.region.x + p0.region.w) continue; // parked: its own test below
      for (const dx of [-0.1, 0.05]) {
        const next = dragTo(rec, h, { x: h.anchor.x + dx, y: h.anchor.y }, { grab: { value: h.value } }, W, H);
        const a1 = prof(next, W, H).primitives[2];
        expect(prof(next, W, H).defects).toEqual([]);
        expect(a1.rx).toBeCloseTo(a.rx, 9); // the radius held
        const R = handle(next, 'waistRadius', W, H).range, Rr = h.range;
        const limited = [next.seeds.waistRadius - R.min, R.max - next.seeds.waistRadius, next.seeds.waistReach - Rr.min, Rr.max - next.seeds.waistReach]
          .some((x) => Math.abs(x) < 1e-6);
        if (!limited) expect(a1.cx, `${W}x${H} ${dx}`).toBeCloseTo(a.cx + dx, 9); // the centre under the pointer
        else expect((a1.cx - a.cx) * dx).toBeGreaterThanOrEqual(0); // or stopped at the limit on the way
      }
    }
  });

  it('a FLAT waist (centre past the frame edge) parks its square on the edge: grabbing it there is no jump, pulling it in is continuous', () => {
    const rec0 = T1();
    // a flat waist: 40% of the way to its largest radius (at the very largest, a deeper pinch with that radius held
    // is infeasible, so the square stops at once -- the limit, not a jump)
    const r0 = handle(rec0, 'waistRadius');
    const flat = normalizeFrameRecord({ ...rec0, seeds: { waistRadius: r0.value + (r0.range.max - r0.value) * 0.4 } });
    const p = prof(flat), a = p.primitives[2], edge = p.region.x + p.region.w;
    expect(a.cx).toBeGreaterThan(edge + 0.5); // non-vacuous: the centre really is off the frame
    const h = handle(flat, 'waistReach'), grab = { value: h.value };
    expect(h.anchor.x).toBeCloseTo(edge, 9);
    expect(h.valueFromWorld({ x: edge, y: h.anchor.y }, { grab })).toBeCloseTo(h.value, 12); // no jump on the grab
    expect(h.valueFromWorld({ x: edge + 1, y: h.anchor.y }, { grab })).toBeCloseTo(h.value, 12); // past the edge: unchanged
    let prev = h.value;
    for (const dx of [0.001, 0.01, 0.1, 0.5, 1]) {
      const v = h.valueFromWorld({ x: edge - dx, y: h.anchor.y }, { grab });
      expect(v).toBeGreaterThanOrEqual(prev); // inward = a deeper pinch, monotone
      prev = v;
    }
    expect(h.valueFromWorld({ x: edge - 0.001, y: h.anchor.y }, { grab }) - h.value).toBeLessThan(0.01); // continuous
    const tighter = dragTo(flat, h, { x: edge - 0.5, y: h.anchor.y }, { grab });
    expect(prof(tighter).defects).toEqual([]);
    expect(prof(tighter).primitives[2].rx).toBeCloseTo(a.rx, 9); // radius held
    expect(prof(tighter).primitives[2].cx).toBeLessThan(a.cx);
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
    // F27 item 2 arc pull: grab the LEFT waist arc and pull it (the CAD-circle rim)
    const a = p0.primitives[8], th = a.theta1 + a.dTheta * 0.3;
    const pt = { x: a.cx + (a.rx + 0.2) * Math.cos(th), y: a.cy + (a.rx + 0.2) * Math.sin(th) };
    setFrameRecord(handleDragPatch(rec, h, pt, p0.region, { side: 1 }));
    const rw = normalizeFrameRecord(P.frame).seeds.waistRadius * hwOf(p0);
    expect(rw).toBeCloseTo(p0.primitives[2].rx + 0.2, 9);
    expect(sendFrame()).toBe(true);
    const s = sent();
    const seeds = normalizeFrameRecord(P.frame).seeds;
    expect(s.seeds).toEqual({ waistRadius: seeds.waistRadius, waistReach: seeds.waistReach }); // the centre held: the pinch moved too
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
    // F27 item 2 arc pull: the body arc pulled in toward its centre (a flatter shoulder = a bigger radius)
    const u = { x: (h.anchor.x - a.cx) / a.rx, y: (h.anchor.y - a.cy) / a.rx };
    setFrameRecord(handleDragPatch(rec, h, { x: h.anchor.x - 0.1 * u.x, y: h.anchor.y - 0.1 * u.y }, p0.region, { side: 0 }));
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
  it('the ONE table: position = the app\'s white/blue square, radius = a dot (ON its arc) in the editor\'s existing blue accent (Fred)', () => {
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
    setHandleCursor('hover', 'plain'); // a radius handle: the normal pointer (Fred: "For radius ... just a normal cursor")
    expect(cls()).toEqual(['handle-axis-plain', 'handle-hover-ready']);
    setHandleCursor(null, 'x');
    expect(cls()).toEqual([]);
    expect(paramHandleCursorAxis({ handleKind: 'position', axis: 'y' })).toBe('y');
    expect(paramHandleCursorAxis({ handleKind: 'radius', axis: 'x' })).toBe('plain');
    expect(paramHandleCursorAxis(null)).toBe(null);
    // a position handle slides on x or y; a radius handle is its arc (F27 item 2 arc pull), the normal pointer
    for (const id of Object.keys(ARC_RADIUS_HANDLE)) {
      for (const h of handlesOf(normalizeFrameRecord({ templateId: id }))) {
        expect(h.axis, `${id} ${h.key}`).toMatch(h.handleKind === 'radius' ? /^arc$/ : /^[xy]$/);
        expect(paramHandleCursorAxis(h)).toBe(h.handleKind === 'radius' ? 'plain' : h.axis);
      }
    }
  });
});
