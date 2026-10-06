/**
 * FB-APP S3 (F7) amendments (Fred: "I just don't want it to break the sim, and
 * have to worry about the frame part looking way wrong"; "no special logic,
 * code it right and prove it by tests"):
 *   - a sweep over templates x board sizes x frame-bottom values x SCULPTED
 *     panels: every bar is valid (top above bottom, finite, inside the board,
 *     tops ON the underside, sampled at least every terrain cell);
 *   - a LOOSE volume sanity check against the live-recorded Fusion goldens
 *     (it is a visual simulation: within 10%, not a tuning target);
 *   - frame geometry is rebuilt only when frame inputs or the panel change,
 *     never per render frame.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameSolidSpec } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { applyFrameToPanel, samplePairedOutlines, toWorld } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { FakeTHREE, carvedPanel, drawnFaces } from './helpers/drawn-panel.js';

/** A sculpted panel as the app builds it: top z = f(x,y) + 0.6, the underside
 *  0.6 in below it along the surface normal (so near f, but off the x,y grid,
 *  as the thicken step makes it). */
const sculptedPanel = (W, H, nx, nz, f) => carvedPanel(W, H, nx, nz, (x, y) => f(x, y) + 0.6, 0.6);

const SCULPTS = {
  flat: () => 0.2,
  waves: (x, y) => 0.4 + 0.3 * Math.sin(1.7 * x) * Math.cos(1.3 * y),
  tilt: (x, y) => 0.8 + 0.05 * x - 0.04 * y,
};
const BOARDS = [[7, 9], [9, 7], [12, 6], [5, 5], [4, 3.5]];
const BOTTOMS = [-2, -1, -0.25];

describe('sweep: every bar is valid', () => {
  // advisor (2026-10-05): one test PER TEMPLATE (the cases are independent) -- the single 90 s test timed out in nearly
  // every full run with 4 seats sharing the CPU; each template's boards x bottoms x sculpts stays well under 30 s
  let checked = 0;
  it.each(FRAME_DEFS.templates.map((t) => [t.id, t]))('%s: boards x frame bottom x sculpted panels', (_id, tpl) => {
    const bad = [];
    for (const [W, H] of BOARDS) {
      for (const z0 of BOTTOMS) {
        for (const [sname, f] of Object.entries(SCULPTS)) {
          const nx = Math.round(W / 0.1) + 1, nz = Math.round(H / 0.1) + 1;
          const { mesh, solid, grid } = sculptedPanel(W, H, nx, nz, f);
          const solidZ = drawnFaces([solid]);
          const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: tpl.id, frameBottomZ: z0 }), { widthIn: W, heightIn: H });
          if (!spec || !spec.innerPrimitives) continue; // board too small for this frame: no bars, by the declared fit rule
          const bars = applyFrameToPanel(FakeTHREE, mesh, grid, spec).find((m) => m.name === 'frame-bars');
          const p = bars.geometry.attributes.position.array;
          const tag = `${tpl.id} ${W}x${H} z0=${z0} ${sname}`;
          for (let i = 0; i < p.length; i += 3) {
            const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
            if (![x, y, z].every(Number.isFinite)) { bad.push(`${tag}: non-finite vertex`); break; }
            if (Math.abs(x) > W / 2 + 1e-6 || Math.abs(y) > H / 2 + 1e-6) { bad.push(`${tag}: outside the board`); break; }
            if (Math.abs(z - z0) < 1e-9) continue; // a bottom vertex
            if (z <= z0) { bad.push(`${tag}: top not above bottom`); break; }
            if (Math.abs(z - Math.min(...solidZ(x, y))) > 1e-4) { bad.push(`${tag}: top off the DRAWN underside`); break; }
          }
          checked++;
        }
      }
    }
    expect(bad).toEqual([]);
  }, 30000);
  it('the sweep covered more than 40 solids in all', () => expect(checked).toBeGreaterThan(40));

  it('the bar top has rows ACROSS the ring width too, one per terrain cell', () => {
    const W = 7, H = 9, nx = 71, nz = 91; // 0.1 in cells
    const { mesh, grid } = sculptedPanel(W, H, nx, nz, SCULPTS.waves);
    const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: 'template_1', frameBottomZ: -1 }), { widthIn: W, heightIn: H });
    const bars = applyFrameToPanel(FakeTHREE, mesh, grid, spec).find((m) => m.name === 'frame-bars');
    const n = samplePairedOutlines(spec.outerPrimitives, spec.innerPrimitives, 0.1).outer.length;
    const verts = bars.geometry.attributes.position.array.length / 3;
    const rows = verts / n - 2 - 1; // top rows+1, plus the outer & inner bottom loops
    expect(rows).toBeGreaterThanOrEqual(Math.ceil(0.75 / 0.1)); // frame_thickness 0.75 in / 0.1 in cells
  });

  it('the bar top is sampled at least every terrain cell (so it can follow the sculpt)', () => {
    const W = 7, H = 9, cell = 0.1;
    const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: 'template_1' }), { widthIn: W, heightIn: H });
    const { outer, inner } = samplePairedOutlines(spec.outerPrimitives, spec.innerPrimitives, cell);
    for (const loop of [outer, inner]) {
      for (let k = 0; k < loop.length; k++) {
        const a = loop[k], b = loop[(k + 1) % loop.length];
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(cell + 1e-9);
      }
    }
  });
});

describe('loose volume sanity vs the live-recorded Fusion goldens (a visual sim)', () => {
  // MEASURED (app ring area x 1 in vs Fusion's 4 bars), F8 AMEND, with the inner
  // edge the TRUE offset of the outline (editor/outline-offset.js): T1 7x9 -0.18%,
  // T1 12x6 -0.09%, T2 7x9 -0.00%, T2 12x6 -0.35%. Before (F7, inner edge = the
  // template re-solved on the inset safe zone, and the pre-F8 outline): -11.1%,
  // -18.9%, -5.4%, -10.3%. The residual is the outline's own S4 parity gap.
  const TOL = 0.01;
  const shoelace = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
  it.each([['template_1', 7, 9], ['template_1', 12, 6], ['template_2', 7, 9], ['template_2', 12, 6]])('%s %dx%d', (id, W, H) => {
    // Goldens: flat core underside z=0, frame bottom -1 in -> bar volume = ring area x 1 in.
    const g = JSON.parse(readFileSync(`tests/fixtures/frame-parity/${id}_${W}x${H}.json`, 'utf-8'));
    const fusion = Object.values(g.bars).reduce((s, b) => s + b.volume, 0);
    const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: id }), { widthIn: W, heightIn: H });
    const { outer, inner } = samplePairedOutlines(spec.outerPrimitives, spec.innerPrimitives, 0.02);
    const app = shoelace(toWorld(outer, W, H)) - shoelace(toWorld(inner, W, H));
    expect(Math.abs(app - fusion) / fusion).toBeLessThan(TOL);
  });
});

describe('frame geometry is rebuilt only when frame inputs or the panel change', () => {
  it('render ticks never rebuild it; refreshFrame rebuilds it once', async () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    const { TerrainPreview } = await import('../bspline-frame-builder/b-spline-gen/html/core/preview/index.js');
    const provider = vi.fn(() => null);
    const fake = Object.create(TerrainPreview.prototype);
    Object.assign(fake, {
      _orbit: { step: () => true }, _viewCube: null, _renderer: { render: vi.fn() }, _scene: { add() {}, remove() {} },
      _camera: {}, _mesh: { geometry: { index: { array: [0, 1, 2] }, attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } }, userData: {}, setIndex() {} } },
      _canvas: { classList: { add() {} } }, _worstPts: [], _leaders: { update() {}, setData() {} }, _sculpt: { updateValueBoxPos() {} },
      _lastGrid: { W: 7, H: 9, nx: 2, nz: 2, topPos: null, botPos: null }, _frameMeshes: [], _frameProvider: provider,
      _THREE: FakeTHREE,
    });
    fake._startLoop();
    const loop = requestAnimationFrame.mock.calls[0][0];
    for (let i = 0; i < 20; i++) loop();
    expect(provider).not.toHaveBeenCalled();
    fake.refreshFrame();
    expect(provider).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
