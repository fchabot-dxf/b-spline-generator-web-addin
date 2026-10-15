/**
 * The narrow runners (Fred 2026-10-14: "make 2 or 3 more brick frames ... NARROWER ... 2 or 3 runners"): slim_runner,
 * checker_tile_runner, twin_runner (core/bricks/library.js FRAME_PRESETS; the checker motif BAND_MOTIFS.checker). Each is
 * mitred, declares a small best size, and is clearly shallower than every preset before it; each lays clean at its best
 * size on the rectangle, template_1 (hourglass), template_10, template_18 and template_7, 7x9 and 9x12: no overlaps, nothing
 * off the board, no motif piece under its floor, no bare patch past PATCH_MAX_FACE (tests/bricks-band-motif.test.js style).
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS, BAND_MOTIFS, RELIEF_CHARS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { tess, bareGround, PATCH_MAX_FACE } from './bare-ground.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0];
const RUNNERS = ['slim_runner', 'checker_tile_runner', 'twin_runner'];
const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const centroid = (p) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });
function primitivesOf(board, W, H) {
  if (board === 'rect') return buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: W, y2: H }));
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: board }), board: { widthIn: W, heightIn: H } }, 0, 0);
  return sil && sil.primitives ? buildRibbonPrimitives(sil.primitives) : null;
}
const lay = (prims, preset, L, W, H) => generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1,
  scale: L / SET.brickLengthIn, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS[preset] } });
/** a preset's band depth (in) at brick size L: its declared Set 1 widths, scaled (the icons read the same widths) */
const depthAt = (bands, L) => bands.reduce((s, b) => s + b.widthIn, 0) * (L / SET.brickLengthIn);

describe('the narrow runners are declared', () => {
  it('each: mitred, rows declared, a small best size, known motifs', () => {
    for (const id of RUNNERS) {
      const bands = FRAME_PRESETS[id];
      expect(bands && bands.length, id).toBeGreaterThan(0);
      expect([0.375, 0.75], id).toContain(bands.bestSize);
      for (const b of bands) {
        expect(b.cornerStyle, `${id}: mitred`).toBeUndefined();
        expect(b.rows, id).toBeGreaterThan(0);
        if (b.motif) expect(BAND_MOTIFS[b.motif], `${id} ${b.motif}`).toBeTruthy();
      }
    }
  });
  it('each is at most 0.4 in deep at its best size -- under half the narrowest preset before them', () => {
    const others = Object.entries(FRAME_PRESETS).filter(([id, b]) => b.length && !RUNNERS.includes(id));
    const narrowestOther = Math.min(...others.map(([, b]) => depthAt(b, b.bestSize || 1.25)));
    expect(narrowestOther).toBeCloseTo(1, 6); // header_band, crenellated_battlement at 1.25 in
    for (const id of RUNNERS) {
      const d = depthAt(FRAME_PRESETS[id], FRAME_PRESETS[id].bestSize);
      expect(d, id).toBeLessThanOrEqual(0.4 + 1e-9);
      expect(d, id).toBeLessThan(narrowestOther / 2);
    }
  });
  it('the three read differently: no two share a band stack', () => {
    const stacks = RUNNERS.map((id) => JSON.stringify([FRAME_PRESETS[id].bestSize, ...FRAME_PRESETS[id]]));
    expect(new Set(stacks).size).toBe(RUNNERS.length);
  });
});

describe('the checker tile runner lays its checkerboard (7x10 rectangle)', () => {
  const W = 7, H = 10, rect = primitivesOf('rect', W, H);
  const topSide = (bricks, row) => bricks.filter((b) => { const c = centroid(b.polygon); return b.bandIndex === 0 && b.rowIndex === row && c.y < c.x && c.y < W - c.x; })
    .sort((a, b) => centroid(a.polygon).x - centroid(b.polygon).x);
  it('every cell of the top side reads the declared tile; the corner squares the declared solid block', () => {
    const r = lay(rect, 'checker_tile_runner', 0.75, W, H), { tile, corner } = BAND_MOTIFS.checker.grid, R = tile.length;
    for (let row = 0; row < R; row++) {
      const run = topSide(r.frameBricks, row), n = run.length;
      expect(n, `row ${row}`).toBeGreaterThan(20);
      run.forEach((b, j) => {
        const c = row + j, cEnd = row + (n - 1 - j);
        const want = c < R ? corner[row][c] : cEnd < R ? corner[row][cEnd] : tile[row][c % tile[row].length];
        expect(b.relief, `row ${row} column ${c}`).toBe(RELIEF_CHARS[want]);
      });
    }
  });
  it('the tiles are square cells: one brick height (less a joint) along, one course deep (the outer row reaches the edge)', () => {
    const r = lay(rect, 'checker_tile_runner', 0.75, W, H), s = scaledSet(SET, 1), J = s.grout.widthIn, face = s.brickHeightIn - J;
    for (const row of [0, 1]) for (const b of topSide(r.frameBricks, row).slice(2, -2)) {
      const xs = b.polygon.map((p) => p.x), ys = b.polygon.map((p) => p.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(face, 6);
      // the joint rule (contour-bands.js rowDepths): the stack's outer edge (the board) has no joint
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(row === 0 ? face + J / 2 : face, 6);
    }
  });
});

const TEMPLATES = ['rect', 'template_1', 'template_10', 'template_18', 'template_7'];
const CASES = TEMPLATES.flatMap((tpl) => [[7, 9], [9, 12]].flatMap(([W, H]) => RUNNERS.map((p) => [tpl, W, H, FRAME_PRESETS[p].bestSize, p])));

describe('the narrow runners lay cleanly at their best size', () => {
  it.each(CASES)('%s %sx%s at %s in, %s', (tpl, W, H, L, preset) => {
    const prims = primitivesOf(tpl, W, H);
    expect(prims, tpl).toBeTruthy();
    const r = lay(prims, preset, L, W, H), s = scaledSet(SET, L / SET.brickLengthIn), J = s.grout.widthIn, contour = tess(prims);
    const bands = FRAME_PRESETS[preset];
    expect(r.frameBricks.length).toBeGreaterThan(0);
    // the stack is laid as declared: every band, every row (the fit rule had nothing to drop on a narrow runner)
    for (let k = 0; k < bands.length; k++) for (let row = 0; row < bands[k].rows; row++)
      expect(r.frameBricks.some((b) => b.bandIndex === k && b.rowIndex === row), `band ${k} row ${row}`).toBe(true);
    for (const b of r.frameBricks) if (bands[b.bandIndex].motif) expect(b.relief, b.id).toBeDefined();
    // a motif-cut band's floor (a quarter of its square cell), pinned on the rectangle where nothing is cut
    if (tpl === 'rect') for (const b of r.frameBricks.filter((x) => BAND_MOTIFS[bands[x.bandIndex].motif] && BAND_MOTIFS[bands[x.bandIndex].motif].grid))
      expect(area(b.polygon), `${b.id}`).toBeGreaterThanOrEqual(0.25 * (s.brickHeightIn - J) ** 2 - 1e-9);
    // no sliver anywhere: every piece at least 3/4 of the run merge's floor (a quarter of its pitch x one course face) --
    // a mitred corner closer may sit under the floor itself (MEASURED 0.79 on T7 9x12 twin_runner, as bricks-band-motif notes)
    const floorOf = (band) => 0.25 * (band.pattern === 'stretcher' ? s.brickLengthIn : s.brickHeightIn) * (s.brickHeightIn - J);
    const slivers = r.frameBricks.filter((b) => area(b.polygon) < 0.75 * floorOf(bands[b.bandIndex])).map((b) => b.id);
    expect(slivers, 'frame slivers').toEqual([]);
    // no two frame pieces overlap
    const fb = r.frameBricks, bx = fb.map((b) => { const xs = b.polygon.map((p) => p.x), ys = b.polygon.map((p) => p.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; });
    const bad = [];
    for (let i = 0; i < fb.length; i++) for (let j = i + 1; j < fb.length; j++) {
      const a = bx[i], b = bx[j];
      if (a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]) continue;
      const o = area(polygonIntersection(fb[i].polygon, fb[j].polygon));
      if (o > 1e-4) bad.push(`${fb[i].id}/${fb[j].id} ${o.toFixed(5)}`);
    }
    expect(bad, 'frame pieces overlapping').toEqual([]);
    const segDist = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };
    const outside = (b) => b.polygon.some((p) => !pointInPolygon(p.x, p.y, contour) && Math.min(...contour.map((a, i) => segDist(p, a, contour[(i + 1) % contour.length]))) > J);
    expect(r.frameBricks.filter(outside).length, 'frame pieces outside the outline').toBe(0);
    const bare = bareGround(contour, [...r.frameBricks, ...r.bricks], J, { W, H });
    expect(bare.largestSqIn / (s.brickLengthIn * s.brickHeightIn), 'largest bare patch, share of one brick face').toBeLessThanOrEqual(PATCH_MAX_FACE);
  });
});
