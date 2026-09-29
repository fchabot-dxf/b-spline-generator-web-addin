/**
 * F8 BLOCKER (Fred, live: "the TOP side isn't adjusted to the BOTTOM face of
 * the height-map board"; bars poking through the terrain; a flat white ledge).
 *
 * MEASURED in the app (tools/repro/frame_bartop_measure.mjs, T1 + T2, 7x9,
 * carve 1.5): the bar tops were NOT flat and never above the drawn top face.
 * Two causes:
 *   1. the thickened underside is offset along the surface NORMAL, so its
 *      vertices sit off the x,y grid (0.15 in at Thicken 0.2, 0.52 in at 1.0),
 *      but the bars sampled it as a regular grid: bar top vs the drawn bottom
 *      face up to 0.37 in off (Thicken 1.0);
 *   2. the panel was trimmed by triangle CENTROID: a sawtooth gap inside the
 *      outline where the bar shows from above (7% of the ring at Resolution
 *      0.4, up to 0.26 in in from the outline).
 * Plus the outline wall had no vertex colours (the white ledge).
 *
 * So everything here is checked against the DRAWN faces read back from the
 * built meshes (the real buildSolidMesh, a normal-offset underside), never
 * against the grid arrays.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameSolidSpec } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { applyFrameToPanel, frameLoopsWorld, pointInPolygon, clipPanelToOutline } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { buildHeightField } from '../bspline-frame-builder/b-spline-gen/html/core/preview/terrain-mesh.js';
import { FakeTHREE, carvedPanel, drawnFaces, PANEL_COLOUR } from './helpers/drawn-panel.js';

const TERRAIN = (x, y) => 1.2 + 0.5 * Math.sin(1.9 * x) * Math.cos(1.4 * y) + 0.25 * Math.sin(3.1 * y + 0.4 * x);
const W = 7, H = 9;
const build = (spacing, thick) => carvedPanel(W, H, Math.round(W / spacing) + 1, Math.round(H / spacing) + 1, TERRAIN, thick);

const CASES = [];
for (const id of ['template_1', 'template_2', 'template_3', 'template_4', 'template_5']) for (const [spacing, thick] of [[0.4, 0.2], [0.15, 1.0], [0.05, 0.2]]) CASES.push([id, spacing, thick]);

describe('bar tops vs the DRAWN panel faces (normal-offset underside)', () => {
  it.each(CASES)('%s spacing %s thicken %s', (id, spacing, thick) => {
    const { mesh, solid, grid } = build(spacing, thick);
    const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: id, frameBottomZ: -1 }), { widthIn: W, heightIn: H });
    const extra = applyFrameToPanel(FakeTHREE, mesh, grid, spec);
    const bars = extra.find((m) => m.name === 'frame-bars');
    const { outer, inner } = frameLoopsWorld(spec, grid);
    const solidZ = drawnFaces([solid]);
    const panelZ = drawnFaces([mesh, ...extra.filter((m) => m.name === 'frame-panel-rim')]);
    const barZ = drawnFaces([bars]);

    // 1. every bar top vertex sits ON the drawn underside (the lowest panel face there)
    const bp = bars.geometry.attributes.position.array;
    let worstBottom = 0;
    for (let i = 0; i < bp.length; i += 3) {
      if (bp[i + 2] <= -1 + 1e-9) continue; // the bar bottom
      worstBottom = Math.max(worstBottom, Math.abs(bp[i + 2] - Math.min(...solidZ(bp[i], bp[i + 1]))));
    }
    // 2. seen from above, no bar is ever the topmost surface inside the outline
    // 3. and no panel face is drawn outside the outline
    let barShows = 0, panelOutside = 0;
    // a lattice that never lands exactly ON the outline's straight edges (a boundary point is neither in nor out)
    const step = spacing / 3.7, o = 0.371 * step;
    for (let x = -W / 2 + o; x < W / 2; x += step) for (let y = -H / 2 + o; y < H / 2; y += step) {
      const pz = panelZ(x, y);
      if (!pointInPolygon(x, y, outer)) { if (pz.length) panelOutside++; continue; }
      if (pointInPolygon(x, y, inner)) continue;
      const bz = barZ(x, y).filter((z) => z > -1 + 1e-9);
      if (bz.length && (!pz.length || Math.max(...pz) < Math.max(...bz) - 1e-6)) barShows++;
    }
    expect({ worstBottom: +worstBottom.toFixed(4), barShows, panelOutside }).toEqual({ worstBottom: expect.any(Number), barShows: 0, panelOutside: 0 });
    expect(worstBottom).toBeLessThan(1e-4);
  });

  it('the outline wall carries the panel colours (no white ledge) and spans the drawn faces', () => {
    const { mesh, solid, grid } = build(0.4, 0.5);
    const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: 'template_1' }), { widthIn: W, heightIn: H });
    const wall = applyFrameToPanel(FakeTHREE, mesh, grid, spec).find((m) => m.name === 'frame-panel-wall');
    expect(wall.material.vertexColors).toBe(true);
    const col = wall.geometry.attributes.color.array;
    expect(Math.max(...Array.from(col).map((c, i) => Math.abs(c - PANEL_COLOUR[i % 3])))).toBeLessThan(1e-6);
    const solidZ = drawnFaces([solid]);
    const P = wall.geometry.attributes.position.array;
    // every wall vertex sits on the drawn bottom or top face (F17: creased normals split vertices, so the
    // wall is no longer laid out as (bottom, top) pairs)
    let bottoms = 0, tops = 0;
    for (let i = 0; i < P.length; i += 3) {
      const zs = solidZ(P[i], P[i + 1]);
      const onBottom = Math.abs(P[i + 2] - Math.min(...zs)) < 1e-4, onTop = Math.abs(P[i + 2] - Math.max(...zs)) < 1e-4;
      expect(onBottom || onTop).toBe(true);
      bottoms += onBottom; tops += onTop;
    }
    expect(bottoms).toBeGreaterThan(0);
    expect(tops).toBeGreaterThan(0);
  });
});

describe('exact trim: the clipped top face covers exactly the outline', () => {
  const area = (P, I) => { let s = 0; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; s += Math.abs((P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[c] - P[a]) * (P[b + 1] - P[a + 1])) / 2; } return s; };
  const polyArea = (q) => Math.abs(q.reduce((s, p, i) => { const r = q[(i + 1) % q.length]; return s + p.x * r.y - r.x * p.y; }, 0)) / 2;
  // coarse grids: a concave stretch of the outline can cross one triangle twice (two pieces)
  it.each([['template_1', 1.0], ['template_1', 0.4], ['template_2', 1.0], ['template_2', 0.4], ['template_1', 0.15]])('%s spacing %s', (id, spacing) => {
    const nx = Math.round(W / spacing) + 1, nz = Math.round(H / spacing) + 1;
    const top = buildHeightField(new Float32Array(nx * nz).fill(1), nx, nz, W, H);
    const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: id }), { widthIn: W, heightIn: H });
    const { cell, outer } = frameLoopsWorld(spec, { W, H, nx, nz });
    const { kept, rim } = clipPanelToOutline(top.pos, top.indices, outer, {}, cell);
    expect(area(top.pos, kept) + area(rim.position, rim.index)).toBeCloseTo(polyArea(outer), 9);
  });
});
