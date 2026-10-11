/**
 * Frame motifs phase 1 (core/bricks/band-motif.js + library.js BAND_MOTIFS / RELIEF_LEVELS / the 6 motif presets): every
 * piece of a motif band carries a relief and the height map lifts / sinks it by the declared amount; the motif lattice lines
 * up row to row; the six presets lay with mitred joints, no overlaps, nothing off the board, no piece under its band's own
 * floor (a quarter of the band's module piece) and no bare patch past PATCH_MAX_FACE, on the rectangle and the curved
 * templates. Default: 7x10 rect + template_1 (hourglass) + template_18 at each preset's recommended size;
 * MOTIF_SWEEP_FULL=1 runs every template, 7x10 and 9x12, at 1 and 1.25 in.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks, buildSpatialIndex, sampleHeight } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS, FRAME_PRESET_SIZES, BAND_MOTIFS, RELIEF_LEVELS, RELIEF_CHARS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { motifRowPlan } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/band-motif.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { tess, bareGround, PATCH_MAX_FACE } from './bare-ground.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0];
const MOTIF_PRESETS = Object.keys(FRAME_PRESET_SIZES);
const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const centroid = (p) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });
function primitivesOf(board, W, H) {
  if (board === 'rect') return buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: W, y2: H }));
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: board }), board: { widthIn: W, heightIn: H } }, 0, 0);
  return sil && sil.primitives ? buildRibbonPrimitives(sil.primitives) : null;
}
const lay = (prims, preset, L, W, H) => generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1,
  scale: L / SET.brickLengthIn, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS[preset] } });

describe('BAND_MOTIFS / the motif presets are declared data', () => {
  it('relief levels: raised up, flush 0, recessed down, all inside the relief budget', () => {
    expect(RELIEF_LEVELS.raised).toBeGreaterThan(0);
    expect(RELIEF_LEVELS.flush).toBe(0);
    expect(RELIEF_LEVELS.recessed).toBeLessThan(0);
    expect(SET.reliefIn + RELIEF_LEVELS.raised).toBeLessThanOrEqual(SET.reliefMaxIn);
    expect(SET.reliefIn + RELIEF_LEVELS.recessed).toBeGreaterThan(0);
  });
  it('every motif is a fill, 1D rows or a grid whose tiles use only relief characters, corner tile R x R', () => {
    for (const [id, m] of Object.entries(BAND_MOTIFS)) {
      const kinds = ['fill', 'rows', 'grid'].filter((k) => m[k]);
      expect(kinds.length, id).toBe(1);
      if (m.fill) expect(RELIEF_LEVELS[m.fill], id).toBeDefined();
      if (m.rows) for (const r of m.rows) for (const [len, rel] of r.seq) { expect(len, id).toBeGreaterThan(0); expect(RELIEF_LEVELS[rel], id).toBeDefined(); }
      if (m.grid) {
        const { tile, corner } = m.grid;
        expect(corner.length, id).toBe(tile.length);
        for (const line of [...tile, ...corner]) for (const ch of line) expect(RELIEF_CHARS[ch], `${id} '${ch}'`).toBeDefined();
        for (const line of corner) expect(line.length, id).toBe(tile.length);
        expect(new Set(tile.map((l) => l.length)).size, id).toBe(1);
      }
    }
  });
  it('the six motif presets each declare a recommended size and name known motifs; every band declares its rows', () => {
    expect(MOTIF_PRESETS.sort()).toEqual(['dentil_corbel', 'dentil_cornice', 'diaper_lattice', 'recessed_panel', 'soldier_string', 'zigzag_band']);
    expect(FRAME_PRESET_SIZES).toMatchObject({ dentil_corbel: 1, dentil_cornice: 1, recessed_panel: 1.25, zigzag_band: 1.25, diaper_lattice: 1.25, soldier_string: 1.25 });
    for (const id of MOTIF_PRESETS) for (const b of FRAME_PRESETS[id]) {
      expect(b.rows, id).toBeGreaterThan(0);
      if (b.motif) expect(BAND_MOTIFS[b.motif], `${id} ${b.motif}`).toBeTruthy();
      expect(b.cornerStyle, `${id}: mitred`).toBeUndefined();
    }
  });
});

describe('the motif lays as declared (7x10 rectangle)', () => {
  const W = 7, H = 10, rect = primitivesOf('rect', W, H);
  // the top side's run: pieces above both corner mitres (y < x and y < W - x at the centroid)
  const topSide = (bricks, band, row) => bricks.filter((b) => { const c = centroid(b.polygon); return b.bandIndex === band && b.rowIndex === row && c.y < c.x && c.y < W - c.x; })
    .sort((a, b) => centroid(a.polygon).x - centroid(b.polygon).x);

  it('each motif piece carries its relief, and its heightOffset is the plain lay + RELIEF_LEVELS', () => {
    const r = lay(rect, 'zigzag_band', 1.25, W, H);
    const z = r.frameBricks.filter((b) => b.bandIndex === 1);
    expect(new Set(z.map((b) => b.relief))).toEqual(new Set(['raised', 'flush']));
    // the offset is the piece's own jitter + the level: raised pieces sit RELIEF_LEVELS.raised above the band's flush ones on average
    const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const up = mean(z.filter((b) => b.relief === 'raised').map((b) => b.heightOffset)), flat = mean(z.filter((b) => b.relief === 'flush').map((b) => b.heightOffset));
    expect(up - flat).toBeGreaterThan(RELIEF_LEVELS.raised - 2 * SET.heightJitterIn);
  });

  it('the zigzag: every row of the top side reads the declared tile, the corner squares the declared diamond', () => {
    const r = lay(rect, 'zigzag_band', 1.25, W, H), { tile, corner } = BAND_MOTIFS.zigzag.grid, R = tile.length;
    for (let row = 0; row < R; row++) {
      const run = topSide(r.frameBricks, 1, row);
      const n = run.length;
      run.forEach((b, j) => {
        const c = row + j, cEnd = row + (n - 1 - j);
        const want = c < R ? corner[row][c] : cEnd < R ? corner[row][cEnd] : tile[row][c % tile[row].length];
        expect(b.relief, `row ${row} column ${c}`).toBe(RELIEF_CHARS[want]);
      });
    }
  });

  it('the grid lines up row to row: cell joints on one lattice (one row depth along per row at the mitre)', () => {
    const r = lay(rect, 'diaper_lattice', 1.25, W, H), s = scaledSet(SET, 1.25 / 0.75);
    const xs = (row) => topSide(r.frameBricks, 0, row).slice(1, -1).map((b) => Math.min(...b.polygon.map((p) => p.x)));
    const x0 = xs(0);
    for (let row = 1; row < 5; row++) for (const x of xs(row)) {
      const k = (x - x0[0]) / s.brickHeightIn;
      expect(Math.abs(k - Math.round(k)), `row ${row} x ${x.toFixed(3)}`).toBeLessThan(1e-6);
    }
  });

  it('the corbel table: each inner raised header is centred under an outer raised stretcher', () => {
    const r = lay(rect, 'dentil_corbel', 1, W, H);
    const mid = (row) => topSide(r.frameBricks, 3, row).slice(1, -1).filter((b) => b.relief === 'raised').map((b) => centroid(b.polygon).x);
    const outer = mid(0), inner = mid(1);
    expect(inner.length).toBeGreaterThanOrEqual(2);
    for (const x of inner) expect(Math.min(...outer.map((o) => Math.abs(o - x))), `header at ${x.toFixed(3)}`).toBeLessThan(1e-6);
  });

  it('the dentil course alternates raised half-brick dentils and flush gaps; its corner pieces are raised', () => {
    const r = lay(rect, 'dentil_corbel', 1, W, H), run = topSide(r.frameBricks, 1, 0);
    expect(run[0].relief).toBe('raised');
    expect(run[run.length - 1].relief).toBe('raised');
    const middle = run.slice(1, -1).map((b) => b.relief);
    for (let k = 1; k < middle.length; k++) expect(middle[k]).not.toBe(middle[k - 1]);
  });

  it('the cornice: the double course raised, the dentil gaps recessed', () => {
    const r = lay(rect, 'dentil_cornice', 1, W, H);
    expect(r.frameBricks.filter((b) => b.bandIndex === 0).every((b) => b.relief === 'raised')).toBe(true);
    const gaps = r.frameBricks.filter((b) => b.bandIndex === 1 && b.relief === 'recessed');
    expect(gaps.length).toBeGreaterThan(8);
    expect(r.frameBricks.filter((b) => b.bandIndex === 2).every((b) => b.relief === undefined)).toBe(true); // a plain course
  });

  it('the recessed panel: the ring raised, every wall brick inside recessed -- and the height map reads both', () => {
    const r = lay(rect, 'recessed_panel', 1.25, W, H), s = scaledSet(SET, 1.25 / 0.75);
    expect(r.frameBricks.filter((b) => b.bandIndex === 2).every((b) => b.relief === 'raised')).toBe(true);
    expect(r.bricks.length).toBeGreaterThan(10);
    expect(r.bricks.every((b) => b.relief === 'recessed')).toBe(true);
    const index = buildSpatialIndex([...r.bricks, ...r.frameBricks], 1);
    const at = (b) => { const c = centroid(b.polygon); return sampleHeight(r, index, c.x, c.y, s, 0); };
    const ring = r.frameBricks.filter((b) => b.bandIndex === 2), border = r.frameBricks.filter((b) => b.bandIndex === 0);
    const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
    expect(mean(ring.map(at)) - mean(border.map(at))).toBeGreaterThan(0.04);
    expect(mean(border.map(at)) - mean(r.bricks.map(at))).toBeGreaterThan(0.04);
  });

  it('motifRowPlan: the start piece leaves a closer floor past the mitre; the sequence is the slots a joint short', () => {
    const plan = motifRowPlan(BAND_MOTIFS.corbel_table, { row: 1, d0: 1.084, d1: 1.333, bandStart: 0.8, L: 1, H: 0.2667, J: 0.034 });
    expect(plan.sequence.map((x) => +x.toFixed(3))).toEqual([1.216, 0.466]); // the flush 1.25 slot first, then the raised header
    expect(plan.forcedFStart * plan.pitch).toBeCloseTo(0.75 - 0.284 - 0.034, 6);
  });
});

const FULL = process.env.MOTIF_SWEEP_FULL === '1';
const TEMPLATES = FULL ? ['rect', ...FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k))] : ['rect', 'template_1', 'template_18'];
const CASES = TEMPLATES.flatMap((tpl) => (FULL ? [[7, 10], [9, 12]] : [[7, 10]]).flatMap(([W, H]) =>
  MOTIF_PRESETS.flatMap((p) => (FULL ? [1, 1.25] : [FRAME_PRESET_SIZES[p]]).map((L) => [tpl, W, H, L, p]))));

describe(`the motif presets lay cleanly (${FULL ? 'full sweep' : 'fast set'})`, () => {
  it.each(CASES)('%s %sx%s at %s in, %s', (tpl, W, H, L, preset) => {
    const prims = primitivesOf(tpl, W, H);
    if (!prims) return;
    const r = lay(prims, preset, L, W, H), s = scaledSet(SET, L / SET.brickLengthIn), J = s.grout.widthIn, contour = tess(prims);
    expect(r.frameBricks.length).toBeGreaterThan(0);
    // grids on a curve are laid flush; every motif-band piece is tagged
    for (const b of r.frameBricks) if (FRAME_PRESETS[preset][b.bandIndex] && FRAME_PRESETS[preset][b.bandIndex].motif) expect(b.relief, b.id).toBeDefined();
    // the band's own floor: a quarter of its smallest module piece (a grid's square header, a 1D motif's shortest slot)
    const floorOf = (band) => {
      const m = BAND_MOTIFS[band.motif];
      if (!m || m.fill) return 0.25 * s.brickHeightIn * (band.pattern === 'soldier' ? s.brickLengthIn : s.brickHeightIn);
      const unit = m.unit === 'H' ? s.brickHeightIn : s.brickLengthIn;
      const shortest = m.grid ? 1 : Math.min(...m.rows.flatMap((row) => row.seq.map(([len]) => len)));
      return 0.25 * (shortest * unit - J) * ((m.rowDepth || 1) * s.brickHeightIn - J);
    };
    const bands = FRAME_PRESETS[preset];
    // the fit rule's own drops and the medial yield may leave a piece small on a neck (as for every preset): the floor
    // is pinned on the rectangle, where nothing is cut
    if (tpl === 'rect') for (const b of r.frameBricks) expect(area(b.polygon), `${b.id} band ${b.bandIndex}`).toBeGreaterThanOrEqual(floorOf(bands[b.bandIndex]) - 1e-9);
    // no two frame pieces overlap
    const fb = r.frameBricks, bx = fb.map((b) => { const xs = b.polygon.map((p) => p.x), ys = b.polygon.map((p) => p.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; });
    const bad = [];
    for (let i = 0; i < fb.length; i++) for (let j = i + 1; j < fb.length; j++) {
      const a = bx[i], b = bx[j];
      if (a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]) continue;
      const o = area(polygonIntersection(fb[i].polygon, fb[j].polygon));
      if (o > 1e-3) bad.push(`${fb[i].id}/${fb[j].id} ${o.toFixed(4)}`);
    }
    expect(bad, 'frame pieces overlapping').toEqual([]);
    const segDist = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };
    const outside = (b) => b.polygon.some((p) => !pointInPolygon(p.x, p.y, contour) && Math.min(...contour.map((a, i) => segDist(p, a, contour[(i + 1) % contour.length]))) > J);
    expect(r.frameBricks.filter(outside).length, 'frame pieces outside the outline').toBe(0);
    const bare = bareGround(contour, [...r.frameBricks, ...r.bricks], J, { W, H });
    expect(bare.largestSqIn / (s.brickLengthIn * s.brickHeightIn), 'largest bare patch, share of one brick face').toBeLessThanOrEqual(PATCH_MAX_FACE);
  });
});
