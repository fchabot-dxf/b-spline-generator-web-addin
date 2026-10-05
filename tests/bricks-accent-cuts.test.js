/**
 * T86 item 26 (Fred, for 37's pattern maker F35-31b): accent cuts at 1/2 and 1/4 brick. `accentCuts: { unit, tile }`
 * splits a running-bond brick where the tile's mark changes inside it (layouts/bond.js applyAccentCuts) and marks
 * every piece (`accentMarked`). On T1's wall (Soldier frame, 1 in bricks), a 4x6 tile: every split piece starts on the
 * cell grid and spans whole cells less one joint; each piece's mark is the tile's at every cell it covers; no two
 * pieces overlap; the union is unchanged (every piece inside one uncut brick, which is its pieces plus their joints).
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { generateBricks, ENGINE_OPTIONS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // pairwise checks: see heavy-test-timeout.js

const SET = BRICK_SETS[0], W = 7, H = 9, SCALE = 1 / SET.brickLengthIn;
const S = scaledSet(SET, SCALE), J = SET.grout.widthIn, PITCH = S.brickLengthIn + J;
const area = (p) => Math.abs(signedArea(p));
const TILE = { rows: 4, cols: 6, cells: Array.from({ length: 4 }, (_, r) => Array.from({ length: 6 }, (_, c) => (r + c) % 3 === 0)) };
const mod = (a, n) => ((a % n) + n) % n;
const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }), board: { widthIn: W, heightIn: H } }, 0, 0);
const frame = { primitives: buildRibbonPrimitives(sil.primitives), bands: FRAME_PRESETS.single_soldier };
const lay = (accentCuts) => generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 3, scale: SCALE, suppression: 0, clumping: 0, zones: [{ pattern: 'stretcher' }], frame, accentCuts }).bricks;
const box = (p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };

function check(unit) {
  const plain = lay(), cut = lay({ unit, tile: TILE });
  const bad = [];
  const minX = Math.min(...plain.flatMap((b) => b.polygon.map((p) => p.x))); // the wall's left edge (the cell grid's origin)
  const u = unit * PITCH;
  // courses, bottom = row 0: the distinct brick-centre heights, from the largest y
  // course centres from intact full-length rectangles only (a brick clipped by the curved edge shifts its centre)
  const intact = plain.map((b) => box(b.polygon)).filter((q, i) => Math.abs(q.x1 - q.x0 - S.brickLengthIn) < 1e-6 && Math.abs(area(plain[i].polygon) - (q.x1 - q.x0) * (q.y1 - q.y0)) < 1e-9);
  const rowsY = [];
  for (const y of intact.map((q) => (q.y0 + q.y1) / 2).sort((a, b) => b - a)) if (!rowsY.length || rowsY[rowsY.length - 1] - y > 0.05) rowsY.push(y);
  const rowOf = (q) => rowsY.findIndex((y) => Math.abs(y - (q.y0 + q.y1) / 2) < 0.05);
  // union unchanged + pieces exact: each cut piece inside exactly one plain brick
  const owner = new Map();
  for (const p of cut) {
    const hosts = plain.filter((b) => area(polygonIntersection(p.polygon, b.polygon)) > 0.5 * area(p.polygon));
    // 1e-4: a piece sharing edges with its brick takes polygonIntersection's perturbed path (~1e-5 sq in)
    if (hosts.length !== 1 || area(p.polygon) - area(polygonIntersection(p.polygon, hosts[0].polygon)) > 1e-4) { bad.push(`${p.id} not inside one uncut brick`); continue; }
    if (!owner.has(hosts[0])) owner.set(hosts[0], []);
    owner.get(hosts[0]).push(p);
  }
  let splits = 0;
  for (const [b, ps] of owner) {
    const qb = box(b.polygon), full = Math.abs(qb.x1 - qb.x0 - S.brickLengthIn) < 1e-6 && area(b.polygon) > 0.999 * (qb.x1 - qb.x0) * (qb.y1 - qb.y0);
    if (ps.length < 2 || !full) continue; // only whole, unclipped bricks are checked exactly
    splits++;
    const joints = (ps.length - 1) * J * (qb.y1 - qb.y0);
    if (Math.abs(area(b.polygon) - ps.reduce((s, p) => s + area(p.polygon), 0) - joints) > 1e-6) bad.push(`brick ${b.id}: pieces + joints != the brick`);
    const row = rowOf(qb);
    for (const p of ps) {
      const q = box(p.polygon), k0 = (q.x0 - minX) / u, cells = (q.x1 - q.x0 + J) / u;
      if (Math.abs(k0 - Math.round(k0)) > 1e-6) bad.push(`${p.id} starts off the cell grid (${k0.toFixed(4)})`);
      if (Math.abs(cells - Math.round(cells)) > 1e-6) bad.push(`${p.id} is not whole cells less a joint (${cells.toFixed(4)})`);
      for (let k = Math.round(k0); k < Math.round(k0) + Math.round(cells); k++) {
        if (!!TILE.cells[mod(row, 4)][mod(k, 6)] !== p.accentMarked) bad.push(`${p.id} cell ${k} marked ${p.accentMarked}, tile says otherwise`);
      }
    }
  }
  for (let i = 0; i < cut.length; i++) for (let j = i + 1; j < cut.length; j++) {
    if (area(polygonIntersection(cut[i].polygon, cut[j].polygon)) > 1e-6) bad.push(`${cut[i].id}/${cut[j].id} overlap`);
  }
  return { bad, splits, marked: cut.filter((b) => b.accentMarked).length, total: cut.length, plain };
}

describe('accent cuts (T86 item 26)', () => {
  it('is an option the engine honours', () => expect(ENGINE_OPTIONS).toContain('accentCuts'));
  it('no accentCuts: the lay as before, nothing marked', () => {
    const a = lay(), b = lay(undefined);
    expect(b.map((x) => x.polygon)).toEqual(a.map((x) => x.polygon));
    expect(a.some((x) => 'accentMarked' in x)).toBe(false);
  });
  for (const unit of [0.5, 0.25]) {
    it(`a 4x6 tile at ${unit} on T1 running bond: cut exactly at the boundaries, marks as the tile, no overlap, union unchanged`, () => {
      const r = check(unit);
      expect(r.bad.slice(0, 5)).toEqual([]);
      expect(r.splits).toBeGreaterThan(10);
      expect(r.marked).toBeGreaterThan(5);
      expect(r.marked).toBeLessThan(r.total);
    });
  }
  it('unit 1: no cuts, every brick marked by the cell under its centre', () => {
    const plain = lay(), cut = lay({ unit: 1, tile: TILE });
    expect(cut.map((x) => x.polygon)).toEqual(plain.map((x) => x.polygon));
    expect(cut.every((x) => typeof x.accentMarked === 'boolean')).toBe(true);
    expect(cut.some((x) => x.accentMarked) && cut.some((x) => !x.accentMarked)).toBe(true);
  });
});
