/**
 * T86 item 27 (Fred, for 37's pattern builder F35-31e): a CUSTOM BOND from a tile -- generateBricks' `customBond`
 * (layouts/bond.js customRow). The built-in bonds written as tiles lay byte-identical bricks (pin); the spec's 2-course
 * tile {[1, 1/2, 1], offset 1/2} on T1 lays exactly its pieces (declared lengths, in order, on the course grid), no
 * overlap, and the wall region minus the joints is covered (no void wider than a joint).
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { generateBricks, ENGINE_OPTIONS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // pairwise + sampled checks: see heavy-test-timeout.js

const SET = BRICK_SETS[0], W = 7, H = 9, SCALE = 1 / SET.brickLengthIn;
const S = scaledSet(SET, SCALE), L = S.brickLengthIn, J = SET.grout.widthIn, PITCH = L + J;
const area = (p) => Math.abs(signedArea(p));
const board = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }), board: { widthIn: W, heightIn: H } }, 0, 0);
const frame = { primitives: buildRibbonPrimitives(sil.primitives), bands: FRAME_PRESETS.single_soldier };
const lay = (extra) => generateBricks({ boardOutline: board, set: SET, seed: 3, scale: SCALE, suppression: 0, clumping: 0, frame, ...extra }).bricks;
const box = (p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
/** the course count of a lay: its bottom course's index from the top + 1 (the bottom course is always laid) */
const coursesOf = (bricks) => { const y0 = Math.min(...bricks.map((b) => box(b.polygon).y0)); return Math.round((Math.max(...bricks.map((b) => box(b.polygon).y0)) - y0) / (S.brickHeightIn + J)) + 1; };
const TILE = { courses: [{ pieces: [1, 0.5, 1], offset: 0 }, { pieces: [1, 0.5, 1], offset: 0.5 }] };

describe('custom bond from a tile (T86 item 27)', () => {
  it('is an option the engine honours', () => expect(ENGINE_OPTIONS).toContain('customBond'));
  for (const [name, tile] of [
    ['stretcher', { courses: [{ pieces: [1], offset: 0 }, { pieces: [1], offset: 0.5 }] }],
    ['stack', { courses: [{ pieces: [1], offset: 0 }] }],
  ]) {
    it(`the built-in ${name} bond written as a tile lays the same bricks (pin)`, () => {
      // T86-27 correction: a tile counts its courses from the BOTTOM (COURSE_ROW_ORIGIN), the built-in stagger from the
      // top -- so the tile matches as written on an odd course count, and with its courses reversed on an even one
      const builtin = lay({ zones: [{ pattern: name }] });
      const courses = coursesOf(builtin) % 2 === 1 ? tile.courses : [...tile.courses].reverse();
      const custom = lay({ zones: [{ pattern: name }], customBond: { courses } });
      expect(custom.length).toBe(builtin.length);
      expect(custom.map((b) => b.polygon)).toEqual(builtin.map((b) => b.polygon));
    });
  }
  it('the 2-course tile {[1, 1/2, 1], offset 1/2} on T1: its pieces exactly, no overlap, no void beyond a joint', () => {
    const bricks = lay({ zones: [{ pattern: 'stretcher' }], customBond: TILE });
    const inner = bricksContourBands(frame.primitives, frame.bands, { set: SET, seed: 3, scale: SCALE }).innerPath.filter(Boolean);
    const minX = Math.min(...inner.map((p) => p.x)), maxX = Math.max(...inner.map((p) => p.x)), minY = Math.min(...inner.map((p) => p.y));
    const bad = [];
    // whole (unclipped) pieces: a declared length, starting on the course's grid, in the tile's cyclic order
    const halfLen = L - 0.5 * PITCH;
    // T86-27 correction: tile row = the course counted from the BOTTOM (the bottom course is always laid; its top edge
    // is unclipped where the arch clips the top courses)
    const last = Math.round((Math.max(...bricks.map((b) => box(b.polygon).y0)) - minY) / (S.brickHeightIn + J));
    const byCourse = new Map();
    for (const b of bricks) {
      const q = box(b.polygon);
      if (area(b.polygon) < 0.999 * (q.x1 - q.x0) * (q.y1 - q.y0)) continue; // clipped by the curve
      // a closer at the wall's side (a whole brick cut by half a pitch is as long as a half); 1e-3: the curved side trims a
      // piece that starts AT the side by ~2e-5 in (T86-27 correction: the bottom course now has offset 0 on T1)
      if (q.x0 < minX + 1e-3 || q.x1 > maxX - 1e-3) continue;
      const c = Math.round((q.y0 - minY) / (S.brickHeightIn + J));
      const len = q.x1 - q.x0;
      const p = Math.abs(len - L) < 1e-9 ? 1 : Math.abs(len - halfLen) < 1e-9 ? 0.5 : null;
      if (p === null) { bad.push(`piece of length ${len.toFixed(4)} mid-course`); continue; }
      const u = (q.x0 - minX) / PITCH + TILE.courses[(last - c) % 2].offset;
      if (Math.abs(u * 2 - Math.round(u * 2)) > 1e-6) bad.push(`course ${c} piece off the grid at ${u.toFixed(4)} pitches`);
      if (!byCourse.has(c)) byCourse.set(c, []);
      byCourse.get(c).push({ u: Math.round(u * 2) / 2, p });
    }
    // in each course, consecutive whole pieces follow the tile's cycle [1, 1/2, 1] (period 2.5 pitches)
    let pairs = 0;
    for (const [c, ps] of byCourse) {
      ps.sort((a, b) => a.u - b.u);
      for (const q of ps) {
        const phase = ((q.u % 2.5) + 2.5) % 2.5; // 0 -> 1, 1 -> 1/2, 1.5 -> 1
        const want = phase === 0 ? 1 : phase === 1 ? 0.5 : phase === 1.5 ? 1 : null;
        if (want !== q.p) bad.push(`course ${c}: a ${q.p} piece at phase ${phase}`);
        pairs++;
      }
    }
    for (let i = 0; i < bricks.length; i++) for (let j = i + 1; j < bricks.length; j++) {
      if (area(polygonIntersection(bricks[i].polygon, bricks[j].polygon)) > 1e-6) bad.push(`${bricks[i].id}/${bricks[j].id} overlap`);
    }
    // the region minus the joints: every point a joint and a bit in from the wall's edge is in a piece or within a joint of one
    const r = J * 1.05;
    const voidsOf = (bs) => {
      const out = [];
      for (let x = minX + 0.1; x < W; x += 0.05) for (let y = minY + 0.1; y < H; y += 0.05) {
        if (![[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]].every(([dx, dy]) => pointInPolygon(x + dx, y + dy, inner))) continue;
        // diagonals too: where a vertical and a horizontal joint cross (this tile lines some vertical joints up across
        // courses) the nearest brick is a corner away
        if (![[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [r, -r], [-r, r], [-r, -r]].some(([dx, dy]) => bs.some((b) => pointInPolygon(x + dx, y + dy, b.polygon)))) out.push(`(${x.toFixed(2)},${y.toFixed(2)})`);
      }
      return out;
    };
    const v = voidsOf(bricks);
    expect(bad.slice(0, 5)).toEqual([]);
    expect(pairs).toBeGreaterThan(40);
    expect(v.slice(0, 5)).toEqual([]);
  });
});
