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
  it('relief levels: raised up, flush 0, recessed down; raised within the cap; the declared 1/8 in both ways', () => {
    expect(RELIEF_LEVELS.raised).toBeGreaterThan(0);
    expect(RELIEF_LEVELS.flush).toBe(0);
    expect(RELIEF_LEVELS.recessed).toBeLessThan(0);
    expect(SET.reliefIn + RELIEF_LEVELS.raised).toBeLessThanOrEqual(SET.reliefMaxIn);
    // Fred 2026-10-11: bolder, 1/8 in both ways -- a recessed top AT the ground is accepted ("allow it, it's my
    // responsibility"); the old pin "reliefIn + recessed > 0" was a guard he declined, so the declared values are pinned
    expect(RELIEF_LEVELS).toEqual({ raised: 0.125, flush: 0, recessed: -0.125 });
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
  it('the motif presets each declare a recommended size and name known motifs; every band declares its rows', () => {
    expect(MOTIF_PRESETS.sort()).toEqual(['dentil_corbel', 'dentil_cornice', 'diaper_lattice', 'greek_key_mosaic', 'recessed_panel', 'soldier_string', 'zigzag_band']);
    expect(FRAME_PRESET_SIZES).toMatchObject({ dentil_corbel: 1, dentil_cornice: 1, recessed_panel: 1.25, zigzag_band: 1.25, diaper_lattice: 1.25, soldier_string: 1.25, greek_key_mosaic: 0.375 });
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
    const xs = (row) => topSide(r.frameBricks, 1, row).slice(1, -1).map((b) => Math.min(...b.polygon.map((p) => p.x)));
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
// the full sweep's sizes; a preset declared for the small chips sweeps those (the Greek key's 12 rows are 4 in deep at 1.25 in)
const FULL_SIZES = { greek_key_mosaic: [0.375] };
const CASES = TEMPLATES.flatMap((tpl) => (FULL ? [[7, 10], [9, 12]] : [[7, 10]]).flatMap(([W, H]) =>
  MOTIF_PRESETS.flatMap((p) => (FULL ? FULL_SIZES[p] || [1, 1.25] : [FRAME_PRESET_SIZES[p]]).map((L) => [tpl, W, H, L, p]))));

describe(`the motif presets lay cleanly (${FULL ? 'full sweep' : 'fast set'})`, () => {
  it.each(CASES)('%s %sx%s at %s in, %s', (tpl, W, H, L, preset) => {
    const prims = primitivesOf(tpl, W, H);
    if (!prims) return;
    const r = lay(prims, preset, L, W, H), s = scaledSet(SET, L / SET.brickLengthIn), J = s.grout.widthIn, contour = tess(prims);
    expect(r.frameBricks.length).toBeGreaterThan(0);
    // grids on a curve are laid flush; every motif-band piece is tagged
    for (const b of r.frameBricks) if (FRAME_PRESETS[preset][b.bandIndex] && FRAME_PRESETS[preset][b.bandIndex].motif) expect(b.relief, b.id).toBeDefined();
    // the band's own floor: a quarter of its smallest module piece (a grid's square header, a 1D motif's shortest slot)
    // (a plain or fill band: the run merge's own floor, a quarter of its pitch x its row depth -- piece-plan.js mergeSlivers)
    const floorOf = (band) => {
      const m = BAND_MOTIFS[band.motif];
      if (!m || m.fill) return 0.25 * (band.pattern === 'stretcher' ? s.brickLengthIn : s.brickHeightIn) * ((band.pattern === 'soldier' ? s.brickLengthIn : s.brickHeightIn) - J);
      const unit = m.unit === 'H' ? s.brickHeightIn : s.brickLengthIn;
      const shortest = m.grid ? 1 : Math.min(...m.rows.flatMap((row) => row.seq.map(([len]) => len)));
      return 0.25 * (shortest * unit - J) * ((m.rowDepth || 1) * s.brickHeightIn - J);
    };
    const bands = FRAME_PRESETS[preset];
    // the floor is pinned for the motif-CUT bands (their cut is band-motif.js's) on the rectangle, where nothing is cut: a
    // plain or fill band's run is cut as every preset's is (its corner closer may sit under the floor where the run merge
    // would pass its ceiling -- MEASURED 0.8 of the floor on a 1.25 in stretcher course, as on soldier_stretcher)
    if (tpl === 'rect') for (const b of r.frameBricks.filter((x) => BAND_MOTIFS[bands[x.bandIndex].motif] && !BAND_MOTIFS[bands[x.bandIndex].motif].fill)) expect(area(b.polygon), `${b.id} band ${b.bandIndex}`).toBeGreaterThanOrEqual(floorOf(bands[b.bandIndex]) - 1e-9);
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

// Fred 2026-10-11 (the zigzag "looks like scattered light squares"): a grid motif must READ -- its raised cells, the tile
// repeated along the band, are ONE shape joined edge to edge (4-neighbours), never a scatter of cells touching only at
// their corners (the old period-4 zigzag and the single-cell diaper both were)
describe('a grid motif reads as one continuous figure', () => {
  const components = (tile, repeats = 3) => {
    const R = tile.length, C = tile[0].length * repeats, on = (r, c) => r >= 0 && r < R && c >= 0 && c < C && tile[r][c % tile[0].length] === 'R';
    const seen = new Set(); let n = 0;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (!on(r, c) || seen.has(`${r},${c}`)) continue;
      n++;
      for (const st = [[r, c]]; st.length;) { const [a, b] = st.pop(); if (seen.has(`${a},${b}`)) continue; seen.add(`${a},${b}`);
        for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (on(a + da, b + db)) st.push([a + da, b + db]); }
    }
    return n;
  };
  it.each(['zigzag', 'diaper'])('%s: its tile, repeated, is one edge-joined figure', (id) => {
    expect(components(BAND_MOTIFS[id].grid.tile)).toBe(1);
  });
  it('the zigzag is a symmetric V: every course mirror-symmetric about the peak column, its arms 2 cells wide', () => {
    const { tile } = BAND_MOTIFS.zigzag.grid, n = tile[0].length;
    for (const row of tile) for (let k = 0; k < n; k++) expect(row[k], `${row} column ${k}`).toBe(row[(n - k) % n]);
    // the arms (every course but the valley's) carry 2+ raised cells on each side
    for (const row of tile.slice(0, -1)) expect([...row].filter((c) => c === 'R').length, row).toBeGreaterThanOrEqual(3);
  });
});

// 2026-10-11 (Fred, shots/advisor/frames/ref5_greek_key_mosaic.jpg): the Greek key MOSAIC -- small square tiles, green =
// raised, white = flush, one band of 12 tile rows at the smallest size chip
describe('the Greek key mosaic', () => {
  const { tile, corner } = BAND_MOTIFS.greek_key.grid;
  // the photo, read tile by tile (columns 0-11 of the 4080 px frame: two whole periods, both the same; the photo's own
  // right end is laid a column off -- the mosaic's, not the pattern's), its 6 key rows top to bottom; G = green
  const PHOTO_KEY = ['GGGG.GGGGG.G', '...G.G...G.G', '.G.G.G.G.G.G', '.GGG.G.GGG.G', '.....G.....G', 'GGGGGGGGGGGG'];
  const PHOTO_STRIPS = { above: ['.', 'G', '.'], below: ['.', 'G', '.'] }; // white / green / white either side of the key

  it('the preset is declared: one 12-row header band of the greek_key grid, best at the 0.375 in chip', () => {
    expect([...FRAME_PRESETS.greek_key_mosaic]).toEqual([{ widthIn: 2.4, rows: 12, pattern: 'header', motif: 'greek_key' }]);
    expect(FRAME_PRESETS.greek_key_mosaic.bestSize).toBe(0.375);
    expect(BAND_MOTIFS.greek_key.unit).toBe('H'); // square cells, one brick height
    expect(tile.length).toBe(12);
    expect(new Set(tile.map((l) => l.length))).toEqual(new Set([6]));
  });

  it('one period of the tile is the photo meander; the strips either side are the photo rows', () => {
    const asPhoto = (line) => [...line].map((c) => (c === 'R' ? 'G' : '.')).join('');
    for (let r = 0; r < 6; r++) expect(asPhoto(tile[3 + r].repeat(2)), `key row ${r}`).toBe(PHOTO_KEY[r]);
    PHOTO_STRIPS.above.forEach((c, r) => expect(asPhoto(tile[r]), `strip row ${r}`).toBe(c.repeat(6)));
    PHOTO_STRIPS.below.forEach((c, r) => expect(asPhoto(tile[9 + r]), `strip row ${9 + r}`).toBe(c.repeat(6)));
  });

  it('the key rows, repeated, are one edge-joined figure (a running meander on its baseline)', () => {
    // three periods on a loop (the run goes on both ways: a period's top bar hangs off the stem of the one before)
    const key = tile.slice(3, 9), R = key.length, C = 18, on = (r, c) => r >= 0 && r < R && key[r][((c % C) + C) % C % 6] === 'R';
    const seen = new Set(), st = [[R - 1, 0]];
    while (st.length) { const [a, b0] = st.pop(), b = ((b0 % C) + C) % C; if (seen.has(`${a},${b}`) || !on(a, b)) continue; seen.add(`${a},${b}`); for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) st.push([a + da, b + db]); }
    expect(seen.size).toBe(key.join('').repeat(3).split('').filter((c) => c === 'R').length);
  });

  it('the corner tile: 12 x 12, symmetric about the diagonal (both runs read it); the strips turn as an L, the key as a ring', () => {
    expect(corner.length).toBe(12);
    for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) expect(corner[r][c], `corner ${r},${c}`).toBe(corner[c][r]);
    // past the diagonal each strip row runs on as declared in the tile (the L)
    for (const r of [0, 1, 2, 9, 10, 11]) for (let c = r; c < 12; c++) expect(corner[r][c], `strip ${r},${c}`).toBe(tile[r][0]);
    // the key's corner block: a ring of raised cells (rows / columns 3 and 8) around a raised 2 x 2 centre
    for (let k = 3; k <= 8; k++) { expect(corner[3][k]).toBe('R'); expect(corner[8][k]).toBe('R'); }
    expect(corner.slice(4, 8).map((l) => l.slice(3, 9))).toEqual(['R....R', 'R.RR.R', 'R.RR.R', 'R....R']);
  });

  it('laid on the 7x10 rectangle at 0.375 in: the tiles square (0.066 in), the top side reads the tile and the corner', () => {
    const W = 7, H = 10, L = 0.375, s = scaledSet(SET, L / SET.brickLengthIn), J = s.grout.widthIn, r = lay(primitivesOf('rect', W, H), 'greek_key_mosaic', L, W, H);
    const top = (row) => r.frameBricks.filter((b) => { const c = centroid(b.polygon); return b.rowIndex === row && c.y < c.x && c.y < W - c.x; })
      .sort((a, b) => centroid(a.polygon).x - centroid(b.polygon).x);
    for (let row = 0; row < 12; row++) {
      const run = top(row), n = run.length;
      // the middle tiles are squares, one tile edge = a brick height less a joint; the outer row is half a joint deeper (the
      // shared joint rule: the stack's own outer edge, the board, has no joint)
      for (const b of run.slice(1, -1)) {
        const xs = b.polygon.map((p) => p.x), ys = b.polygon.map((p) => p.y);
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(s.brickHeightIn - J, 6);
        expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(s.brickHeightIn - (row ? J : J / 2), 6);
      }
      // the start piece spans the mitre's cell and the next (column row + 1); every piece reads the declared cell
      run.forEach((b, j) => {
        const c = row + 1 + j, cEnd = row + 1 + (n - 1 - j);
        const want = c < 12 ? corner[row][c] : cEnd < 12 ? corner[row][cEnd] : tile[row][c % 6];
        expect(b.relief, `row ${row} column ${c}`).toBe(RELIEF_CHARS[want]);
      });
    }
    expect(s.brickHeightIn - J).toBeCloseTo(0.066, 6);
  });
});

// the Greek key's clean lay at its own size on the rectangle and the two curved templates the brief names; a tile is the
// unit here (a bare patch is measured against ONE TILE face, not a brick's). GK_KNOWN: measured exceptions --
//  - floor: template_1 9x12 and template_10 9x12, row 7 at the waist arcs' line junctions: 4 pieces at 0.63 / 0.58 of the
//    floor (a plain 12-row header band lays the same four, and more -- the junction cut, not the motif);
//  - bare: the line / arc junctions of template_1 9x12 and template_10 7x10 leave a two-scan-point joint triangle (0.0032
//    sq in, 0.32 of a 0.1 in tile face; one scan point is 0.16 of it). A plain 12-row header band leaves it too.
const GK_KNOWN = { floor: { 'template_1 9x12': 0.62, 'template_10 9x12': 0.57 }, bare: { 'template_1 9x12': 0.33, 'template_10 7x10': 0.33 } };
const GK_CASES = ['rect', 'template_1', 'template_10'].flatMap((tpl) => [[7, 10], [9, 12]].map(([W, H]) => [tpl, W, H]));
describe('the Greek key mosaic lays cleanly at 0.375 in', () => {
  it.each(GK_CASES)('%s %sx%s', (tpl, W, H) => {
    const L = FRAME_PRESETS.greek_key_mosaic.bestSize, prims = primitivesOf(tpl, W, H);
    const r = lay(prims, 'greek_key_mosaic', L, W, H), s = scaledSet(SET, L / SET.brickLengthIn), J = s.grout.widthIn, contour = tess(prims);
    const key = `${tpl} ${W}x${H}`, cell = s.brickHeightIn, floor = 0.25 * (cell - J) ** 2;
    expect(r.frameBricks.length).toBeGreaterThan(0);
    expect(new Set(r.frameBricks.map((b) => b.rowIndex)).size, 'all 12 rows laid').toBe(12);
    const fb = r.frameBricks, bx = fb.map((b) => { const xs = b.polygon.map((p) => p.x), ys = b.polygon.map((p) => p.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; });
    const bad = [];
    for (let i = 0; i < fb.length; i++) for (let j = i + 1; j < fb.length; j++) {
      const a = bx[i], b = bx[j];
      if (a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]) continue;
      const o = area(polygonIntersection(fb[i].polygon, fb[j].polygon));
      if (o > 1e-5) bad.push(`${fb[i].id}/${fb[j].id} ${o.toFixed(5)}`);
    }
    expect(bad, 'tiles overlapping').toEqual([]);
    const smallest = Math.min(...fb.map((b) => area(b.polygon)));
    expect(smallest / floor, 'smallest piece, share of the floor (a quarter tile face)').toBeGreaterThanOrEqual(GK_KNOWN.floor[key] ?? 1 - 1e-9);
    const bare = bareGround(contour, [...fb, ...r.bricks], J, { W, H });
    expect(bare.largestSqIn / (cell * cell), 'largest bare patch, share of one tile face').toBeLessThanOrEqual(GK_KNOWN.bare[key] ?? PATCH_MAX_FACE);
  });
});
