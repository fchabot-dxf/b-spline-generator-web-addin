/**
 * 2026-10-09 (seat A; the phone map, photo board: the frame step was 41% of the busy time, the bars' creased normals
 * ~10 ms of each rebuild on desktop): creasedNormals (core/preview/frame-mesh.js) writes preallocated outputs and
 * reuses a corner's new vertex when an earlier corner of the same vertex averaged the same faces. Its output --
 * positions, normals, index, source -- is pinned here to the digests of the code BEFORE the change
 * (fixtures/creased-normals-digests.json), on the real frame geometry: the bars ring and the panel's outline wall
 * built over a real thickened panel's own surface, for every frame template x 2 boards x 2 terrains, plus the
 * window bars and wall. A deliberate change re-pins: PIN=1 npx vitest run <this file>.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameSolidSpec } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameLoopsWorld, panelSurface, ringArrays, wallArrays, creasedNormals, samplePairedOutlines, toWorld } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { generateHeightmap, resolveGrid } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { buildThickenData } from '../bspline-frame-builder/b-spline-gen/html/core/engine/build-thicken-data.js';
import { buildHeightField, buildSolidMesh } from '../bspline-frame-builder/b-spline-gen/html/core/preview/terrain-mesh.js';

const PINNED = 'tests/fixtures/creased-normals-digests.json';
const THREE = new Proxy({}, { get(t, name) { if (!(name in t)) t[name] = class { constructor(...a) { this.attributes = {}; this.userData = {}; if (name === 'BufferAttribute') [this.array, this.itemSize] = a; else if (a[0] && a[0].attributes) [this.geometry, this.material] = a; } setAttribute(k, v) { this.attributes[k] = v; } setIndex(i) { this.index = i; } computeVertexNormals() {} computeBoundingBox() {} computeBoundingSphere() {} }; return t[name]; } });

const digest = (c) => {
  const h = createHash('sha1');
  h.update(Buffer.from(Float64Array.from(c.positions).buffer)); h.update(Buffer.from(Float64Array.from(c.normals).buffer));
  h.update(Buffer.from(Int32Array.from(c.index).buffer)); h.update(Buffer.from(Int32Array.from(c.source).buffer));
  return `${c.source.length}:${h.digest('hex')}`;
};

describe('creasedNormals: byte-identical to the pre-change code on the real frame geometry', () => {
  it('bars ring + outline wall (+ window bars / wall) for every template x 2 boards x 2 terrains', () => {
    const got = {};
    for (const [W, H, sp] of [[7, 9, 0.05], [9, 12, 0.1]]) for (const seed of [42, 7]) {
      const { nx, nz } = resolveGrid(W, H, sp);
      const p = { ...P, widthIn: W, heightIn: H, seed, smoothIntensity: 0.4, thickenEnabled: true };
      const { heights } = generateHeightmap({ ...p, nx, nz }, { mask: null });
      const field = buildHeightField(heights, nx, nz, W, H);
      const mesh = buildSolidMesh(THREE, field.pos, buildThickenData(heights, nx, nz, p, {}).data.offsetPts, nx, nz, {});
      const pos = mesh.geometry.attributes.position.array, full = Array.from(mesh.geometry.index.array ?? mesh.geometry.index);
      const surf = panelSurface(pos, full, W, H, nx, nz);
      const bot = (q) => surf.at(q.x, q.y)?.lo.z ?? 0, top = (q) => surf.at(q.x, q.y)?.hi.z ?? 0;
      for (const t of FRAME_DEFS.templates) {
        for (const win of [false, true]) {
          const rec = normalizeFrameRecord(win ? { templateId: t.id, insetWindow: { enabled: true, cx: W / 2, cy: H * 0.45, w: W * 0.3, h: H * 0.25 } } : { templateId: t.id });
          const spec = frameSolidSpec(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
          if (!spec) continue;
          const { cell, outer, inner, panel } = frameLoopsWorld(spec, { W, H, nx, nz });
          const key = `${W}x${H}@${sp} s${seed} ${t.id}${win ? ' window' : ''}`;
          if (inner && !win) got[`${key} bars`] = digest(creasedNormals(...Object.values(ringArrays(outer, inner, spec.frameBottomZ, bot, cell)).slice(0, 2)));
          if (!win) got[`${key} wall`] = digest(creasedNormals(...Object.values(wallArrays(panel, bot, top))));
          const w = spec.insetWindow; // the window bars + its hole's wall, as applyFrameToPanel builds them
          if (win) expect(w, `${key}: the window is on`).toBeTruthy();
          if (w) {
            const pr = samplePairedOutlines(rectToPrimitives(w.outer), rectToPrimitives(w.inner), cell);
            got[`${key} window bars`] = digest(creasedNormals(...Object.values(ringArrays(toWorld(pr.outer, W, H), toWorld(pr.inner, W, H), spec.frameBottomZ, bot, cell)).slice(0, 2)));
            const hole = toWorld(samplePairedOutlines(rectToPrimitives(w.hole), rectToPrimitives(w.hole), cell).outer, W, H);
            got[`${key} window wall`] = digest(creasedNormals(...Object.values(wallArrays(hole, bot, top))));
          }
        }
      }
    }
    // panelSurface.at itself (the walls' colours read its hits' t / u / v / w too): a lattice over the board
    for (const [W, H, sp] of [[7, 9, 0.05], [9, 12, 0.1]]) {
      const { nx, nz } = resolveGrid(W, H, sp);
      const p = { ...P, widthIn: W, heightIn: H, seed: 42, smoothIntensity: 0.4, thickenEnabled: true };
      const { heights } = generateHeightmap({ ...p, nx, nz }, { mask: null });
      const field = buildHeightField(heights, nx, nz, W, H);
      const mesh = buildSolidMesh(THREE, field.pos, buildThickenData(heights, nx, nz, p, {}).data.offsetPts, nx, nz, {});
      // the solid (top + underside: two hits a point) and the top-only panel (one hit: lo IS hi)
      for (const [kind, surf] of [['solid', panelSurface(mesh.geometry.attributes.position.array, Array.from(mesh.geometry.index.array ?? mesh.geometry.index), W, H, nx, nz)],
        ['top', panelSurface(field.pos, Array.from(field.indices), W, H, nx, nz)]]) {
      const h = createHash('sha1');
      let hits = 0, same = 0;
      for (let k = 0; k <= 200; k++) for (let m = 0; m <= 200; m++) {
        const s = surf.at(-W / 2 - 0.1 + (W + 0.2) * k / 200, -H / 2 - 0.1 + (H + 0.2) * m / 200);
        if (!s) { h.update('-'); continue; }
        hits++; if (s.lo === s.hi) same++;
        h.update(Buffer.from(Float64Array.of(s.lo.t, s.lo.u, s.lo.v, s.lo.w, s.lo.z, s.hi.t, s.hi.u, s.hi.v, s.hi.w, s.hi.z, s.lo === s.hi ? 1 : 0).buffer));
        expect(Object.keys(s.lo)).toEqual(['t', 'u', 'v', 'w', 'z']);
      }
      expect(hits).toBeGreaterThan(30000);
      if (kind === 'top') expect(same).toBeGreaterThan(hits * 0.9); // one hit is lo AND hi (two only on a shared edge)
      got[`${W}x${H} ${kind} panelSurface.at`] = `${hits}/${same}:${h.digest('hex')}`;
      }
    }
    if (process.env.PIN === '1') writeFileSync(PINNED, JSON.stringify(got, null, 1) + '\n');
    const pinned = JSON.parse(readFileSync(PINNED, 'utf8'));
    expect(new Set(Object.values(got)).size).toBeGreaterThan(150); // 76 bars + 76 walls + the window's, all different
    expect(got).toEqual(pinned);
  }, 300000);
});
