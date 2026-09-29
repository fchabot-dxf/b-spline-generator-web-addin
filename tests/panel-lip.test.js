/**
 * F22 PANEL LIP (Fred: "for the panel I sometimes want a small offset outward ... so I can flush trim at the end"):
 * the frame record's panelLip (declared default 0, range 0 .. Trim offset), the panel's trim outline = the frame
 * outline offset OUTWARD by the lip (the F8 true offset, negative distance), the bars unchanged, lip 0 == today.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, framePayload, panelLipRange } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { HAPTIC_PATTERNS, setHapticEnabled } from '../bspline-frame-builder/b-spline-gen/html/core/haptics.js';
import { frameCutProfile, frameSolidSpec, panelTrimPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { applyFrameToPanel, frameLoopsWorld, sampleOutline, pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { offsetOutlineInward } from '../bspline-frame-builder/b-spline-gen/html/editor/outline-offset.js';
import { FakeTHREE, carvedPanel } from './helpers/drawn-panel.js';

const rec = (id, extra = {}) => normalizeFrameRecord({ templateId: id, ...extra });
/** Distance point -> a line/arc loop, with major arcs handled (every angle wrap). */
function distTo(q, prims) {
  let best = Infinity;
  for (const p of prims) {
    if (p.type === 'L') {
      const dx = p.p1.x - p.p0.x, dy = p.p1.y - p.p0.y, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((q.x - p.p0.x) * dx + (q.y - p.p0.y) * dy) / L2));
      best = Math.min(best, Math.hypot(p.p0.x + t * dx - q.x, p.p0.y + t * dy - q.y));
      continue;
    }
    const a = Math.atan2(q.y - p.cy, q.x - p.cx);
    const on = [-1, 0, 1].some((k) => { const u = (a + k * 2 * Math.PI - p.theta1) / p.dTheta; return u >= 0 && u <= 1; });
    best = Math.min(best, on ? Math.abs(Math.hypot(q.x - p.cx, q.y - p.cy) - p.rx)
      : Math.min(...[p.theta1, p.theta1 + p.dTheta].map((th) => Math.hypot(p.cx + p.rx * Math.cos(th) - q.x, p.cy + p.rx * Math.sin(th) - q.y))));
  }
  return best;
}
const pieceSamples = (p, n = 24) => (p.type === 'L'
  ? Array.from({ length: n + 1 }, (_, k) => ({ x: p.p0.x + (p.p1.x - p.p0.x) * k / n, y: p.p0.y + (p.p1.y - p.p0.y) * k / n }))
  : Array.from({ length: n + 1 }, (_, k) => { const th = p.theta1 + p.dTheta * k / n; return { x: p.cx + p.rx * Math.cos(th), y: p.cy + p.rx * Math.sin(th) }; }));

describe('the record: declared default 0, range 0 .. the Trim offset, old records = 0, sent to Fusion', () => {
  it('declared once (frame-defs extrusion, from the Python)', () => {
    expect(FRAME_DEFS.extrusion.find((s) => s.key === 'panelLip')).toMatchObject({ default: 0, min: 0, max: 'boundingboxoffset', unit: 'in' });
  });
  it('old / fresh records read 0; a value is kept inside 0 .. boundingboxoffset (which follows its own override)', () => {
    expect(rec('template_1').panelLip).toBe(0);
    expect(normalizeFrameRecord({ templateId: 'template_1', frameBottomZ: -1 }).panelLip).toBe(0); // a record saved before F22
    expect(rec('template_1', { panelLip: 0.0625 }).panelLip).toBe(0.0625);
    expect(rec('template_1', { panelLip: 5 }).panelLip).toBe(0.25);              // the template's Trim offset default
    expect(rec('template_1', { panelLip: -1 }).panelLip).toBe(0);
    expect(rec('template_1', { panelLip: 'x' }).panelLip).toBe(0);
    expect(rec('template_1', { params: { boundingboxoffset: 0.5 }, panelLip: 5 }).panelLip).toBe(0.5);
    expect(panelLipRange(FRAME_DEFS, rec('template_1', { params: { boundingboxoffset: 0.5 } }))).toEqual({ min: 0, max: 0.5 });
  });
  it('the payload carries it (a plain value, never a frame param)', () => {
    const p = framePayload(FRAME_DEFS, rec('template_2', { panelLip: 0.0625 }));
    expect(p.panelLip).toBe(0.0625);
    expect(Object.keys(p.params)).not.toContain('panelLip');
  });

  describe('H13: a genuinely out-of-range panelLip fires haptic(\'limit\')', () => {
    let vibrate;
    beforeEach(() => {
      setHapticEnabled(true);
      vibrate = vi.fn();
      navigator.vibrate = vibrate;
    });
    afterEach(() => { delete navigator.vibrate; });

    it('fires when the value actually gets clamped', () => {
      rec('template_1', { panelLip: 5 }); // clamped to 0.25 (the template's Trim offset default)
      expect(vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.limit);
    });

    it('does NOT fire when the value is already inside range', () => {
      rec('template_1', { panelLip: 0.0625 });
      expect(vibrate).not.toHaveBeenCalled();
    });

    it('does NOT fire when reloading an already-normalized old record (panelLip absent, defaults to 0)', () => {
      normalizeFrameRecord({ templateId: 'template_1', frameBottomZ: -1 });
      expect(vibrate).not.toHaveBeenCalled();
    });
  });
});

describe('the panel trim outline == the frame outline offset OUTWARD by the lip', () => {
  const CASES = [];
  for (const id of ['template_1', 'template_2', 'template_3']) for (const [W, H] of [[7, 9], [12, 6], [9, 12]]) for (const lip of [0.0625, 0.125, 0.25]) CASES.push([id, W, H, lip]);
  it.each(CASES)('%s %sx%s lip %s', (id, W, H, lip) => {
    const r = rec(id, { panelLip: lip });
    const prof = frameCutProfile(FRAME_DEFS, r, { widthIn: W, heightIn: H });
    const lp = panelTrimPrimitives(prof, r);
    expect(lp).toEqual(offsetOutlineInward(prof.primitives, -lip).filter((p) => !p.collapsed)); // the ONE shared function
    const poly = sampleOutline(prof.primitives, 48);
    for (const p of lp) {
      for (const q of pieceSamples(p)) {
        expect(pointInPolygon(q.x, q.y, poly)).toBe(false);                   // outside the frame outline
        const d = distTo(q, prof.primitives);
        expect(d).toBeGreaterThan(lip - 1e-6);                                // never closer than the lip
        if (p.type === 'A') expect(d).toBeCloseTo(lip, 6);                    // arcs: concentric, exactly the lip
      }
    }
    // every straight piece of the lip is exactly the lip away along its interior (a corner may be farther: a miter)
    for (const p of lp.filter((q) => q.type === 'L')) {
      const mid = { x: (p.p0.x + p.p1.x) / 2, y: (p.p0.y + p.p1.y) / 2 };
      expect(distTo(mid, prof.primitives)).toBeCloseTo(lip, 6);
    }
  });
});

describe('3D: the panel follows the lip, the bars do not; lip 0 == today', () => {
  const BOARD = { widthIn: 7, heightIn: 9 };
  const panel = () => carvedPanel(7, 9, 71, 91, () => 2, 1.5);
  const bars = (extra) => extra.find((m) => m.name === 'frame-bars').geometry.attributes.position.array;

  it('lip 0: no panel loop (the outline itself), the SAME trimmed mesh as a spec from before F22', () => {
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    expect(spec.panelPrimitives).toBeNull();
    const { mesh, grid } = panel();
    const loops = frameLoopsWorld(spec, grid);
    expect(loops.panel).toBe(loops.outer); // the outline loop itself, not a copy
    const today = { ...spec }; delete today.panelPrimitives;
    const a = panel(), b = panel();
    const ea = applyFrameToPanel(FakeTHREE, a.mesh, a.grid, spec), eb = applyFrameToPanel(FakeTHREE, b.mesh, b.grid, today);
    expect(Array.from(a.mesh.geometry.index.array)).toEqual(Array.from(b.mesh.geometry.index.array));
    expect(ea.map((m) => Array.from(m.geometry.attributes.position.array))).toEqual(eb.map((m) => Array.from(m.geometry.attributes.position.array)));
    void mesh;
  });

  it('lip 0.125: the panel keeps a ring outside the outline (trimmed on the lip loop), the bars are identical', () => {
    const s0 = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    const s1 = frameSolidSpec(FRAME_DEFS, rec('template_1', { panelLip: 0.125 }), BOARD);
    const a = panel(), b = panel();
    const e0 = applyFrameToPanel(FakeTHREE, a.mesh, a.grid, s0), e1 = applyFrameToPanel(FakeTHREE, b.mesh, b.grid, s1);
    expect(b.mesh.geometry.index.array.length).toBeGreaterThan(a.mesh.geometry.index.array.length);
    expect(Array.from(bars(e1))).toEqual(Array.from(bars(e0)));
    // every kept panel triangle lies inside the lip loop, and some lie outside the outline
    const { panel: lipLoop, outer } = frameLoopsWorld(s1, b.grid);
    const ix = b.mesh.geometry.index.array, pos = b.mesh.geometry.attributes.position.array;
    let outsideOutline = 0;
    for (let t = 0; t < ix.length; t += 3) {
      const cx = (pos[ix[t] * 3] + pos[ix[t + 1] * 3] + pos[ix[t + 2] * 3]) / 3, cy = (pos[ix[t] * 3 + 1] + pos[ix[t + 1] * 3 + 1] + pos[ix[t + 2] * 3 + 1]) / 3;
      expect(pointInPolygon(cx, cy, lipLoop)).toBe(true);
      if (!pointInPolygon(cx, cy, outer)) outsideOutline++;
    }
    expect(outsideOutline).toBeGreaterThan(0);
    // the panel's edge wall stands on the lip loop (not on the outline)
    const wall = e1.find((m) => m.name === 'frame-panel-wall').geometry.attributes.position.array;
    const near = (x, y, loop) => loop.some((q) => Math.hypot(q.x - x, q.y - y) < 1e-4); // Float32 positions
    for (let k = 0; k < wall.length; k += 3) expect(near(wall[k], wall[k + 1], lipLoop)).toBe(true);
    expect(near(wall[0], wall[1], outer)).toBe(false); // non-vacuous: not the outline's own points
  });
});
