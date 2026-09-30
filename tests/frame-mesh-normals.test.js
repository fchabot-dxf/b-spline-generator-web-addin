/**
 * F17 item 4 (Fred, phone shot of the 3D frame from below: the shading was
 * BLURRED at the bars' hard edges): smooth vertex normals were shared across
 * the 90-degree edges between the bars' top, bottom and walls. The frame meshes
 * now use creased normals (frame-mesh.js creasedNormals, FRAME_CREASE_ANGLE_DEG):
 * every flat face keeps its own normal at a hard edge; smooth surfaces stay smooth.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameSolidSpec } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  applyFrameToPanel, creasedNormals, ringArrays, FRAME_CREASE_ANGLE_DEG,
} from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { FakeTHREE, carvedPanel } from './helpers/drawn-panel.js';

const faceNormal = (P, I, t) => {
  const p = (k) => [P[3 * I[t + k]], P[3 * I[t + k] + 1], P[3 * I[t + k] + 2]];
  const [a, b, c] = [p(0), p(1), p(2)];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n);
  return l ? n.map((x) => x / l) : null;
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rect = (w, h) => [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }];
const circle = (r, n) => Array.from({ length: n }, (_, k) => ({ x: r * Math.cos(2 * Math.PI * k / n), y: r * Math.sin(2 * Math.PI * k / n) }));

/** For every face: its corner normals vs its own face normal (min dot); and faces meeting at a hard edge sharing a vertex. */
function audit(P, I, N) {
  let worstFlat = 1, sharedHard = 0;
  const faces = [];
  for (let t = 0; t < I.length; t += 3) faces.push({ t, n: faceNormal(P, I, t) });
  const cosCrease = Math.cos(FRAME_CREASE_ANGLE_DEG * Math.PI / 180);
  const byVertex = new Map();
  for (const f of faces) for (let k = 0; k < 3; k++) {
    const v = I[f.t + k];
    if (!byVertex.has(v)) byVertex.set(v, []);
    byVertex.get(v).push(f);
  }
  for (const list of byVertex.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (list[i].n && list[j].n && dot(list[i].n, list[j].n) < cosCrease) sharedHard++;
    }
  }
  return { faces, sharedHard, corner: (t, k) => [N[3 * I[t + k]], N[3 * I[t + k] + 1], N[3 * I[t + k] + 2]], worstFlat };
}

describe('creasedNormals: hard edges stay hard', () => {
  it('a rectangular bar ring (flat top, bottom, walls): every corner normal is its own face\'s; no vertex is shared across a hard edge', () => {
    const r = ringArrays(rect(3.5, 4.5), rect(2.75, 3.75), -1, () => 0);
    const c = creasedNormals(r.positions, r.index);
    const a = audit(c.positions, c.index, c.normals);
    expect(a.sharedHard).toBe(0);
    let worst = 1;
    for (const f of a.faces) for (let k = 0; k < 3; k++) worst = Math.min(worst, dot(a.corner(f.t, k), f.n));
    expect(worst).toBeGreaterThan(1 - 1e-9);                           // flat faces: exactly their face normal
    // a side face's corner normals are perpendicular to that face's edges (horizontal normals on vertical walls)
    for (const f of a.faces.filter((q) => Math.abs(q.n[2]) < 1e-9)) for (let k = 0; k < 3; k++) expect(Math.abs(a.corner(f.t, k)[2])).toBeLessThan(1e-9);
  });

  it('the same ring BEFORE (shared vertices, computeVertexNormals-style averaging) would blur: the uncreased input shares hard-edge vertices', () => {
    const r = ringArrays(rect(3.5, 4.5), rect(2.75, 3.75), -1, () => 0);
    expect(audit(r.positions, r.index, []).sharedHard).toBeGreaterThan(0);
  });

  it('a round ring (64 steps, 5.6 deg per step) keeps its walls SMOOTH around the curve (below the crease angle)', () => {
    const r = ringArrays(circle(3.5, 64), circle(2.75, 64), -1, () => 0);
    const c = creasedNormals(r.positions, r.index);
    const a = audit(c.positions, c.index, c.normals);
    const walls = a.faces.filter((f) => Math.abs(f.n[2]) < 1e-9);
    // a wall corner's normal is the average of the neighbouring wall faces, so it differs from its own face's
    let averaged = 0;
    for (const f of walls) for (let k = 0; k < 3; k++) if (dot(a.corner(f.t, k), f.n) < 1 - 1e-6) averaged++;
    expect(averaged).toBeGreaterThan(walls.length);
    expect(a.sharedHard).toBe(0);
  });

  it('a bar top following a gently curved underside stays smooth across rows', () => {
    const r = ringArrays(rect(3.5, 4.5), rect(2.75, 3.75), -1, (p) => 0.05 * Math.sin(p.x) * Math.cos(p.y), 0.1);
    const c = creasedNormals(r.positions, r.index);
    const a = audit(c.positions, c.index, c.normals);
    const tops = a.faces.filter((f) => f.n[2] > 0.9 && f.n[2] < 1 - 1e-9);
    let averaged = 0;
    for (const f of tops) for (let k = 0; k < 3; k++) if (dot(a.corner(f.t, k), f.n) < 1 - 1e-9) averaged++;
    expect(tops.length).toBeGreaterThan(10);
    expect(averaged).toBeGreaterThan(tops.length);
  });
});

describe('the real frame meshes (applyFrameToPanel): bars and outline wall', () => {
  it.each(['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6'])('%s: the bars\' bottom and walls keep their own flat normals; no hard edge is shared', (id) => {
    const W = 7, H = 9;
    const { mesh, grid } = carvedPanel(W, H, 36, 46, (x, y) => 1.2 + 0.3 * Math.sin(1.9 * x) * Math.cos(1.4 * y), 0.4);
    const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: id, frameBottomZ: -1 }), { widthIn: W, heightIn: H });
    const extra = applyFrameToPanel(FakeTHREE, mesh, grid, spec);
    for (const name of ['frame-bars', 'frame-panel-wall']) {
      const g = extra.find((m) => m.name === name).geometry;
      const P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array ?? g.index;
      const a = audit(P, I, N);
      expect(a.sharedHard, name).toBe(0);
      // the bars' flat bottom: every corner normal is straight down/up (Fred's view from below)
      if (name === 'frame-bars') {
        const bottoms = a.faces.filter((f) => f.n && Math.abs(f.n[2]) > 1 - 1e-9 && P[3 * I[f.t] + 2] <= -1 + 1e-9);
        expect(bottoms.length).toBeGreaterThan(0);
        for (const f of bottoms) for (let k = 0; k < 3; k++) expect(Math.abs(a.corner(f.t, k)[2])).toBeGreaterThan(1 - 1e-9);
      }
    }
  });
});
